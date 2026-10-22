import { createHash } from "node:crypto";
import { snapshotDigest, QaPreparationError, qaPrepareObservation, type AssuranceVerdict, type SnapshotDescriptor, type QaCheckDiagnostic, type QaPreparationReason, type QaVerificationProgressInput } from "./coordinator";
export { QaPreparationError, type QaCheckDiagnostic, type QaPreparationReason, type QaVerificationProgressInput } from "./coordinator";
import { assertDeliveryClean, materializeDeliveryWorkspace, writeDeliveryTree } from "./delivery_workspace";
import { runFixedVerification, resolveVerificationCommand, assertCommandIdentity, verificationPath, readQaBaseline, VerificationAbortedError, VerificationCleanupError, VerificationLaunchError, type FrozenCommand, type VerificationDescriptor, type VerificationCommand, type QaBaseline } from "./verification";
import { qaFindingId, qaBaselineFindingId, PRE_EXISTING_BASELINE_PREFIX } from "./qa_findings";
import { captureGitTaskRevisionSnapshot, inScopeTrackedDrift, usesBranchDelivery } from "../workspace_scope";
import { readTaskRecordRaw } from "../kernel/storage";

function recordForSnapshot(snapshot: SnapshotDescriptor) {
	const record = readTaskRecordRaw(snapshot.root, snapshot.task_id).record;
	if (!record || record.contract !== "assurance_kernel/task_record/v4" || !record.git_base_head)
		throw new Error("QA delivery requires a TaskRecord v4 git_base_head");
	return record;
}

function deliveryTreeForSnapshot(snapshot: SnapshotDescriptor): string {
	if (snapshot.review_revision?.review_tree) return snapshot.review_revision.review_tree;
	const record = recordForSnapshot(snapshot);
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

export async function runDeterministicQa(
	snapshot: SnapshotDescriptor,
	descriptors: Map<string, VerificationDescriptor>,
	options: {
		signal?: AbortSignal;
		onProgress?: (progress: QaVerificationProgressInput) => void;
		/**
		 * Task QA runs in the task's working directory. Only the Lane batch
		 * integration recheck asks for a copy: its merge candidate is never
		 * checked out, so there is no working directory to run in.
		 */
		delivery?: "materialized";
		// Coordination tests inject a fake executor without a real repository.
		_runFixedVerification?: typeof runFixedVerification;
		_resolveVerificationCommand?: typeof resolveVerificationCommand;
		_materializeDeliveryWorkspace?: typeof materializeDeliveryWorkspace;
		/** Replaces the frozen tree and, in place, the comparison with it. */
		_frozenTree?: { tree: string; drift?: () => string[] };
		/** Replaces the Enrollment `base_head` the project baseline is read from. */
		_baseHead?: string;
	} = {},
): Promise<AssuranceVerdict> {
	if (snapshot.role !== "qa") throw new Error("deterministic QA requires qa role");
	const live = () => { if (options.signal?.aborted) throw new VerificationAbortedError(); };
	live();
	type QaItem = { id: string; index: number; descriptor: VerificationDescriptor; baseline?: string };
	const groups = new Map<string, QaItem[]>();
	for (const [index, item] of snapshot.acceptance.entries()) {
		const descriptor = descriptors.get(item.id);
		if (!descriptor) throw new Error(`verification descriptor missing for ${item.id}`);
		const key = JSON.stringify(descriptor.environment);
		const group = groups.get(key) ?? [];
		group.push({ id: item.id, index, descriptor });
		groups.set(key, group);
	}
	const materialized = options.delivery === "materialized";
	// The project baseline comes from the Enrollment base_head tree, never the
	// delivery. Only task QA in the working directory carries it: the Lane batch
	// integration recheck reruns acceptance descriptors on a merge candidate.
	const baselineHead = materialized ? undefined : options._baseHead
		?? (options._frozenTree ? undefined : recordForSnapshot(snapshot).git_base_head);
	const baseline: QaBaseline | null = baselineHead ? readQaBaseline(snapshot.root, baselineHead) : null;
	const totalChecks = snapshot.acceptance.length + (baseline?.checks.length ?? 0);
	for (const [offset, check] of (baseline?.checks ?? []).entries()) {
		// Baseline checks run after every acceptance descriptor, so they never share
		// a group with one. Diagnostics reuse the acceptance index space past the
		// acceptance count and name the check as `baseline:<id>`.
		const key = `baseline:${JSON.stringify(check.descriptor.environment)}`;
		const group = groups.get(key) ?? [];
		group.push({ id: `baseline:${check.id}`, index: snapshot.acceptance.length + offset, descriptor: check.descriptor, baseline: check.id });
		groups.set(key, group);
	}
	const tree = options._frozenTree?.tree ?? deliveryTreeForSnapshot(snapshot);
	const drift = materialized ? null : options._frozenTree
		? options._frozenTree.drift ?? (() => [])
		: (() => {
			const record = recordForSnapshot(snapshot);
			const branchDelivery = usesBranchDelivery(snapshot.root, snapshot.task_id);
			const paths = branchDelivery
				? Object.keys(captureGitTaskRevisionSnapshot(snapshot.root, record.intent_snapshot.scope_hint, record.git_base_head, snapshot.task_id).changed_paths)
				: record.intent_snapshot.scope_hint;
			return () => inScopeTrackedDrift(snapshot.root, tree, paths, branchDelivery ? paths : []);
		})();
	const path = verificationPath();
	// Rerun one failed baseline check against the materialized base_head tree,
	// under the same descriptor. Anything short of the identical failure, a
	// materialization or prepare problem included, leaves the finding blocking.
	const failsIdenticallyAtBase = async (item: QaItem, observed: { exit_code: number; timed_out: boolean; output_limited: boolean }, baseTree: string): Promise<boolean> => {
		live();
		let copy: ReturnType<typeof materializeDeliveryWorkspace>;
		try { copy = (options._materializeDeliveryWorkspace ?? materializeDeliveryWorkspace)(snapshot.root, baseTree); }
		catch { return false; }
		const diagnostic = (reason: QaPreparationReason, stage: QaCheckDiagnostic["stage"]): QaCheckDiagnostic[] => [{ acceptance_id: item.id,
			descriptor_ref: `acceptance/${item.index}/verification/command`,
			descriptor_digest: `sha256:${createHash("sha256").update(JSON.stringify(item.descriptor)).digest("hex")}`,
			stage, outcome: reason, elapsed_ms: 0, exit_code: null, stdout_bytes: null, stderr_bytes: null }];
		const run = async (command: VerificationCommand) => {
			const frozen = (options._resolveVerificationCommand ?? resolveVerificationCommand)(copy.root, command, path);
			return (options._runFixedVerification ?? runFixedVerification)(copy.root, command, frozen, { signal: options.signal, path });
		};
		try {
			const prepare = item.descriptor.environment.prepare;
			if (prepare) {
				const prepared = await run(prepare);
				if (prepared.exit_code !== 0 || prepared.timed_out || prepared.output_limited) return false;
			}
			const result = await run(item.descriptor.command);
			live();
			return result.exit_code === observed.exit_code && result.timed_out === observed.timed_out && result.output_limited === observed.output_limited;
		} catch (error) {
			if (error instanceof VerificationAbortedError) throw error;
			if (error instanceof VerificationCleanupError) throw new QaPreparationError("resolution", [item.id], "process_cleanup_failed", diagnostic("process_cleanup_failed", "resolution"));
			return false;
		} finally {
			try { copy.cleanup(); }
			catch { throw new QaPreparationError("integrity", [item.id], "delivery_cleanup_failed", diagnostic("delivery_cleanup_failed", "integrity")); }
		}
	};
	const findings: NonNullable<AssuranceVerdict["findings"]> = [];
	const evidence: unknown[] = [];
	const allCommands: Array<{ frozen: FrozenCommand; diagnostics: QaCheckDiagnostic[] }> = [];
	const baselineFailures: Array<{ item: QaItem; finding: (typeof findings)[number]; observed: { exit_code: number; timed_out: boolean; output_limited: boolean } }> = [];
	for (const [environmentKey, group] of groups) {
		live();
		const ids = group.map(item => item.id);
		const environment = group[0]!.descriptor.environment;
		const diagnostics = (stage: QaCheckDiagnostic["stage"], outcome: QaCheckDiagnostic["outcome"], affected = group,
			commandStage: "prepare" | "check" = "check", elapsed = 0, result?: { exit_code: number; stdout: string; stderr: string }): QaCheckDiagnostic[] =>
			affected.map(item => ({ acceptance_id: item.id,
				descriptor_ref: `acceptance/${item.index}/verification/${commandStage === "prepare" ? "environment/prepare" : "command"}`,
				descriptor_digest: `sha256:${createHash("sha256").update(JSON.stringify(item.descriptor)).digest("hex")}`,
				stage, outcome, elapsed_ms: elapsed, exit_code: result?.exit_code ?? null,
				stdout_bytes: result ? Buffer.byteLength(result.stdout) : null, stderr_bytes: result ? Buffer.byteLength(result.stderr) : null }));
		const delivery = (() => {
			if (!materialized) return { root: snapshot.root, seal: undefined, cleanup: () => {} };
			let copy: ReturnType<typeof materializeDeliveryWorkspace> | undefined;
			try {
				copy = (options._materializeDeliveryWorkspace ?? materializeDeliveryWorkspace)(snapshot.root, tree);
				return { root: copy.root, seal: copy.seal as string | undefined, cleanup: copy.cleanup };
			} catch {
				let reason: QaPreparationReason = "delivery_unavailable";
				try { copy?.cleanup(); }
				catch { reason = "delivery_cleanup_failed"; }
				throw new QaPreparationError("prepare", ids, reason, diagnostics("prepare", reason));
			}
		})();
		const clean = () => {
			let paths: string[] | undefined;
			try {
				if (drift) { paths = drift(); if (!paths.length) return; }
				else {
					if (!options._materializeDeliveryWorkspace) assertDeliveryClean(delivery.root, tree, delivery.seal, environment.writable_paths);
					return;
				}
			} catch { paths = undefined; }
			throw new QaPreparationError("integrity", ids, "protected_input_or_output_drift", diagnostics("integrity", "protected_input_or_output_drift"),
				paths ? qaPrepareObservation(0, "", "working_directory", paths) : undefined);
		};
		const groupCommands: FrozenCommand[] = [];
		const execute = async (command: VerificationCommand, stage: "prepare" | "check", affected = group) => {
			const started = performance.now();
			const fail = (errorStage: QaCheckDiagnostic["stage"], reason: QaPreparationReason) =>
				new QaPreparationError(errorStage, affected.map(item => item.id), reason, diagnostics(errorStage, reason, affected, stage, Math.round(performance.now() - started)));
			live(); clean();
			let frozen: FrozenCommand;
			try { frozen = (options._resolveVerificationCommand ?? resolveVerificationCommand)(delivery.root, command, path); }
			catch { throw fail("resolution", "executable_or_cwd_unavailable"); }
			let result;
			try { result = await (options._runFixedVerification ?? runFixedVerification)(delivery.root, command, frozen, { signal: options.signal, path }); }
			catch (error) {
				if (error instanceof VerificationAbortedError) throw error;
				if (error instanceof VerificationLaunchError) throw fail("resolution", "process_launch_failed");
				if (error instanceof VerificationCleanupError) throw fail("resolution", "process_cleanup_failed");
				throw fail(stage, "execution_failed");
			}
			live(); clean();
			groupCommands.push(frozen);
			if (frozen?.entry && !command.executable.startsWith("./"))
				allCommands.push({ frozen, diagnostics: diagnostics("integrity", "command_identity_changed", affected, stage, Math.round(performance.now() - started), result) });
			// Paths and process output are not persisted. Identity hashes describe
			// observed entries, not a claim about every transitive dependency.
			evidence.push({ stage, environment: createHash("sha256").update(environmentKey).digest("hex"),
				command: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
				entry: frozen?.entry?.content_hash ?? null,
				exit_code: result.exit_code, timed_out: result.timed_out, output_limited: result.output_limited });
			if (Buffer.byteLength(JSON.stringify(evidence)) > 16_384)
				throw fail("prepare", "execution_metadata_limit_exceeded");
			return result;
		};
		try {
			clean();
			if (environment.prepare) {
				const prepareStarted = performance.now();
				const result = await execute(environment.prepare, "prepare");
				if (result.exit_code !== 0 || result.timed_out || result.output_limited)
					throw new QaPreparationError("prepare", ids, result.timed_out ? "timeout" : result.output_limited ? "output_limit" : "nonzero_exit",
						diagnostics("prepare", result.timed_out ? "timeout" : result.output_limited ? "output_limit" : "nonzero_exit", group, "prepare", Math.round(performance.now() - prepareStarted), result),
						qaPrepareObservation(environment.prepare.timeout_ms, result.stderr, materialized ? "isolated_materialization" : "working_directory"));
			}
			for (const item of group) {
				const started = performance.now();
				const progress = (phase: QaVerificationProgressInput["phase"], outcome: QaCheckDiagnostic["outcome"], result?: { exit_code: number; stdout: string; stderr: string }) => options.onProgress?.({
					index: item.index + 1, total: totalChecks, acceptance_id: item.id, phase, elapsed_ms: Math.round(performance.now() - started),
					diagnostic: diagnostics("check", outcome, [item], "check", Math.round(performance.now() - started), result)[0],
				});
				progress("running", "running");
				const result = await execute(item.descriptor.command, "check", [item]);
				const failed = result.exit_code !== 0 || result.timed_out || result.output_limited;
				progress(failed ? "failed" : "passed", result.timed_out ? "timeout" : result.output_limited ? "output_limit" : failed ? "nonzero_exit" : "passed", result);
				if (failed) {
					const finding = { id: item.baseline ? qaBaselineFindingId(item.baseline, snapshotDigest(snapshot)) : qaFindingId(item.id, snapshotDigest(snapshot)),
						kind: "blocking" as const, acceptance_id: item.baseline ? null : item.id,
						summary: `${item.baseline ? `baseline check ${item.baseline} ` : ""}verification failed (exit ${result.exit_code}${result.timed_out ? ", timed out" : ""}${result.output_limited ? ", output limit" : ""}) stdout=${Buffer.byteLength(result.stdout)}B stderr=${Buffer.byteLength(result.stderr)}B`, findings_digest: "" };
					findings.push(finding);
					if (item.baseline) baselineFailures.push({ item, finding, observed: { exit_code: result.exit_code, timed_out: result.timed_out, output_limited: result.output_limited } });
				}
			}
			// Recheck while a materialized copy still exists; its cleanup removes project entries.
			try {
				for (const frozen of groupCommands) if (frozen?.entry) assertCommandIdentity(frozen);
			} catch { throw new QaPreparationError("integrity", ids, "command_identity_changed", diagnostics("integrity", "command_identity_changed")); }
		} finally {
			try { delivery.cleanup(); }
			catch { throw new QaPreparationError("integrity", ids, "delivery_cleanup_failed", diagnostics("integrity", "delivery_cleanup_failed")); }
		}
	}
	live();
	// A baseline failure also present at base_head is disclosed, not blocking. Only
	// baseline checks get this tolerance; an acceptance descriptor never does.
	const disclosed: NonNullable<AssuranceVerdict["findings"]> = [];
	for (const failure of baselineFailures) {
		if (!baseline || !(await failsIdenticallyAtBase(failure.item, failure.observed, baseline.tree))) continue;
		findings.splice(findings.indexOf(failure.finding), 1);
		disclosed.push({ ...failure.finding, kind: "advisory", summary: `${PRE_EXISTING_BASELINE_PREFIX} ${failure.finding.summary}` });
	}
	// Host entries must still match before approval.
	for (const entry of allCommands) {
		try { if (entry.frozen?.entry) assertCommandIdentity(entry.frozen); }
		catch { throw new QaPreparationError("integrity", entry.diagnostics.map(item => item.acceptance_id), "command_identity_changed", entry.diagnostics); }
	}
	const base = { contract: "assurance_kernel/assurance_verdict/v2" as const, role: "qa" as const,
		task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot) };
	if (findings.length) return { ...base, decision: "rework", findings };
	const disclosure = disclosed.length
		? `; ${disclosed.map(item => item.summary).join("; ")}` : "";
	const executionDigest = createHash("sha256").update(JSON.stringify({
		tree, platform: process.platform, arch: process.arch, observations: evidence,
	})).digest("hex");
	return { ...base, decision: "pass", approval: { kind: "qa", authority_role: "qa",
		summary: `all ${totalChecks} project verification check(s) passed${disclosure}; execution=sha256:${executionDigest}` },
		...(disclosed.length ? { findings: disclosed } : {}) };
}

