import { createHash } from "node:crypto";
import { snapshotDigest, type SnapshotDescriptor, type AssuranceVerdict } from "./coordinator";
import { assertDeliveryClean, materializeDeliveryWorkspace, removeTaskOwnedTree, writeDeliveryTree } from "./delivery_workspace";
import { runFixedVerification, resolveVerificationCommand, assertCommandIdentity, verificationPath, VerificationAbortedError, VerificationCleanupError, VerificationLaunchError, type FrozenCommand, type VerificationDescriptor, type VerificationCommand } from "./verification";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { qaFindingId } from "./qa_findings";
import { captureGitTaskRevisionSnapshot } from "../workspace_scope";
import { readTaskRecord } from "../kernel/storage";

export interface QaVerificationProgressInput {
	index: number;
	total: number;
	acceptance_id: string;
	phase: "running" | "passed" | "failed";
	elapsed_ms: number;
}

function deliveryTreeForSnapshot(
	snapshot: SnapshotDescriptor,
	writeTree: typeof writeDeliveryTree,
): string {
	if (snapshot.review_revision?.review_tree) return snapshot.review_revision.review_tree;
	const record = readTaskRecord(snapshot.root, snapshot.task_id).record;
	if (!record || record.contract !== "assurance_kernel/task_record/v4" || !record.git_base_head)
		throw new Error("QA delivery requires a TaskRecord v4 git_base_head");
	const captured = captureGitTaskRevisionSnapshot(
		snapshot.root,
		record.intent_snapshot.scope_hint,
		record.git_base_head,
		snapshot.task_id,
	);
	const digest = `sha256:${createHash("sha256").update(JSON.stringify(captured)).digest("hex")}`;
	if (digest !== snapshot.diff_hash)
		throw new Error("QA delivery identity does not match the frozen snapshot");
	return writeDeliveryTree(snapshot.root, captured);
}

export class QaPreparationError extends Error {
	constructor(public readonly stage: "resolution" | "prepare" | "integrity", public readonly acceptance_ids: string[], public readonly reason: string) {
		super(`QA ${stage} failed (${reason}); affected checks=${acceptance_ids.join(",")}`);
		this.name = "QaPreparationError";
	}
}

export async function runDeterministicQa(
	snapshot: SnapshotDescriptor,
	descriptors: Map<string, VerificationDescriptor>,
	options: {
		signal?: AbortSignal;
		onProgress?: (progress: QaVerificationProgressInput) => void;
		// Coordination tests inject a fake executor without creating a real delivery.
		_runFixedVerification?: typeof runFixedVerification;
		_resolveVerificationCommand?: typeof resolveVerificationCommand;
		_materializeDeliveryWorkspace?: typeof materializeDeliveryWorkspace;
		_writeDeliveryTree?: typeof writeDeliveryTree;
	} = {},
): Promise<AssuranceVerdict> {
	if (snapshot.role !== "qa") throw new Error("deterministic QA requires qa role");
	const live = () => { if (options.signal?.aborted) throw new VerificationAbortedError(); };
	live();
	const groups = new Map<string, Array<{ id: string; index: number; descriptor: VerificationDescriptor }>>();
	for (const [index, item] of snapshot.acceptance.entries()) {
		const descriptor = descriptors.get(item.id);
		if (!descriptor) throw new Error(`verification descriptor missing for ${item.id}`);
		const key = JSON.stringify(descriptor.environment);
		const group = groups.get(key) ?? [];
		group.push({ id: item.id, index, descriptor });
		groups.set(key, group);
	}
	const tree = snapshot.review_revision?.review_tree
		?? (options._writeDeliveryTree ? "tree" : deliveryTreeForSnapshot(snapshot, writeDeliveryTree));
	const path = verificationPath();
	const findings: NonNullable<AssuranceVerdict["findings"]> = [];
	const evidence: unknown[] = [];
	const allCommands: FrozenCommand[] = [];
	for (const [environmentKey, group] of groups) {
		live();
		const ids = group.map(item => item.id);
		const environment = group[0]!.descriptor.environment;
		const delivery = (options._materializeDeliveryWorkspace ?? materializeDeliveryWorkspace)(snapshot.root, tree);
		const home = mkdtempSync(join(tmpdir(), "imm-qa-home-"));
		const clean = () => {
			if (options._materializeDeliveryWorkspace) return;
			try { assertDeliveryClean(delivery.root, tree, delivery.seal, environment.writable_paths); }
			catch { throw new QaPreparationError("integrity", ids, "protected_input_or_output_drift"); }
		};
		const groupCommands: FrozenCommand[] = [];
		const deliveryPrefix = `${realpathSync(delivery.root)}${sep}`;
		const execute = async (command: VerificationCommand, stage: "prepare" | "check") => {
			live(); clean();
			let frozen: FrozenCommand;
			try { frozen = (options._resolveVerificationCommand ?? resolveVerificationCommand)(delivery.root, command, path); }
			catch { throw new QaPreparationError("resolution", ids, "executable_or_cwd_unavailable"); }
			let result;
			try { result = await (options._runFixedVerification ?? runFixedVerification)(delivery.root, command, frozen, { signal: options.signal, home, path }); }
			catch (error) {
				if (error instanceof VerificationLaunchError) throw new QaPreparationError("resolution", ids, "process_launch_failed");
				if (error instanceof VerificationCleanupError) throw new QaPreparationError("resolution", ids, "process_cleanup_failed");
				throw error;
			}
			live(); clean();
			groupCommands.push(frozen);
			if (frozen?.entry) {
				if (!command.executable.startsWith("./")) allCommands.push(frozen);
				else if (frozen.interpreter && !frozen.interpreter.path.startsWith(deliveryPrefix))
					allCommands.push({ entry: frozen.interpreter, interpreter: null, interpreter_args: [] });
			}
			// Paths and process output are not persisted. Identity hashes describe
			// observed entries, not a claim about every transitive dependency.
			evidence.push({ stage, environment: createHash("sha256").update(environmentKey).digest("hex"),
				command: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
				entry: frozen?.entry?.content_hash ?? null, interpreter: frozen?.interpreter?.content_hash ?? null,
				exit_code: result.exit_code, timed_out: result.timed_out, output_limited: result.output_limited });
			if (Buffer.byteLength(JSON.stringify(evidence)) > 16_384)
				throw new QaPreparationError("prepare", ids, "execution_metadata_limit_exceeded");
			return result;
		};
		try {
			clean();
			if (environment.prepare) {
				const result = await execute(environment.prepare, "prepare");
				if (result.exit_code !== 0 || result.timed_out || result.output_limited)
					throw new QaPreparationError("prepare", ids, result.timed_out ? "timeout" : result.output_limited ? "output_limit" : "nonzero_exit");
			}
			for (const item of group) {
				const started = Date.now();
				const progress = (phase: QaVerificationProgressInput["phase"]) => options.onProgress?.({
					index: item.index + 1, total: snapshot.acceptance.length, acceptance_id: item.id, phase, elapsed_ms: Date.now() - started,
				});
				progress("running");
				const result = await execute(item.descriptor.command, "check");
				const failed = result.exit_code !== 0 || result.timed_out || result.output_limited;
				progress(failed ? "failed" : "passed");
				if (failed) findings.push({ id: qaFindingId(item.id, snapshotDigest(snapshot)), kind: "blocking", acceptance_id: item.id,
					summary: `verification failed (exit ${result.exit_code}${result.timed_out ? ", timed out" : ""}${result.output_limited ? ", output limit" : ""}) stdout=${Buffer.byteLength(result.stdout)}B stderr=${Buffer.byteLength(result.stderr)}B`, findings_digest: "" });
			}
			// Recheck while project entries still exist; cleanup removes them.
			for (const frozen of groupCommands) {
				if (frozen?.entry) assertCommandIdentity(frozen);
			}
		} finally { try { delivery.cleanup(); } finally { removeTaskOwnedTree(home); } }
	}
	live();
	// Host entries survive materialization cleanup and must still match before approval.
	for (const frozen of allCommands) {
		if (frozen?.entry) assertCommandIdentity(frozen);
	}
	const base = { contract: "assurance_kernel/assurance_verdict/v2" as const, role: "qa" as const,
		task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot) };
	if (findings.length) return { ...base, decision: "rework", findings };
	const executionDigest = createHash("sha256").update(JSON.stringify({
		tree, platform: process.platform, arch: process.arch, observations: evidence,
	})).digest("hex");
	return { ...base, decision: "pass", approval: { kind: "qa", authority_role: "qa",
		summary: `all ${snapshot.acceptance.length} project verification check(s) passed; execution=sha256:${executionDigest}` } };
}

