import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { projectTaskStatus } from "../assurance/coordinator";
import { readTaskIntent } from "../kernel/intent";
import { readAuditTaskPair, readSecureProjectFile, readSettledTaskEvidence, revisionForContent } from "../kernel/storage";
import { auditRunRecordPath, auditRunTerminalProofPath } from "../kernel/storage_paths";
import { captureGitTaskRevisionSnapshot, pathMatchesScope } from "../workspace_scope";
import { readParentConsolidationReceipt } from "./batch_state";
import { parseFinalVerification } from "./batch_final_verification";

export interface DeliveryRun { task_id: string; run_id: string }
export interface DeliveryConsolidation extends DeliveryRun { source_runs: DeliveryRun[] }
export const consolidationSchema = {
	type: "object", additionalProperties: false, required: ["task_id", "run_id", "source_runs"],
	properties: {
		task_id: { type: "string" }, run_id: { type: "string" },
		source_runs: { type: "array", minItems: 1, maxItems: 16, items: {
			type: "object", additionalProperties: false, required: ["task_id", "run_id"],
			properties: { task_id: { type: "string" }, run_id: { type: "string" } },
		} },
	},
} as const;

function object(value: unknown, keys: string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value) ||
		Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("invalid delivery_consolidation shape");
	return value as Record<string, unknown>;
}
function run(value: unknown): DeliveryRun {
	const raw = object(value, ["task_id", "run_id"]);
	if (typeof raw.task_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw.task_id) ||
		typeof raw.run_id !== "string" || !/^run-[A-Za-z0-9][A-Za-z0-9._-]{0,123}$/.test(raw.run_id))
		throw new Error("invalid consolidation task/run identity");
	return { task_id: raw.task_id, run_id: raw.run_id };
}
export function parseDeliveryConsolidation(value: unknown): DeliveryConsolidation | undefined {
	if (value === undefined) return undefined;
	const raw = object(value, ["task_id", "run_id", "source_runs"]);
	const final = run({ task_id: raw.task_id, run_id: raw.run_id });
	if (!Array.isArray(raw.source_runs) || !raw.source_runs.length || raw.source_runs.length > 16)
		throw new Error("consolidation requires 1–16 source runs");
	const sources = raw.source_runs.map(run).sort((a, b) => a.task_id.localeCompare(b.task_id));
	if (new Set([final.task_id, ...sources.map(source => source.task_id)]).size !== sources.length + 1)
		throw new Error("duplicate/self consolidation selection");
	return { ...final, source_runs: sources };
}
export function consolidationDigest(value: unknown): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
function git(root: string, argv: string[]): string {
	const result = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`consolidation Git inspection failed: ${argv[0]}`);
	return result.stdout;
}
export interface ConsolidationEnvelope {
	initiative_slug: string;
	plan_digest: string;
	selection: DeliveryConsolidation;
	parent_tasks: Array<{ task_id: string; intent_hash: string }>;
	branch: string;
	head: string;
	final_commands: string[];
	/** All source approvals are historical; only the final run approves the composed bytes. */
	runs: Array<{ task_id: string; run_id: string; record_hash: string; proof_hash: string;
		intent_hash: string; review_revision: unknown }>;
	delivery_diff_hash: string;
	manifest: Array<{ path: string; mode: string | null; oid: string | null }>;
}
export interface ConsolidationReceipt {
	contract: "assurance_kernel/parent_delivery_consolidation/v1";
	envelope: ConsolidationEnvelope;
	digest: string;
	commit: string | null;
}

export function parseConsolidationReceipt(value: unknown): ConsolidationReceipt {
	const raw = object(value, ["contract", "envelope", "digest", "commit"]);
	if (raw.contract !== "assurance_kernel/parent_delivery_consolidation/v1" ||
		(typeof raw.commit !== "string" && raw.commit !== null) ||
		(typeof raw.commit === "string" && !/^[a-f0-9]{40,64}$/.test(raw.commit))) throw new Error("invalid consolidation receipt");
	const e = object(raw.envelope, ["initiative_slug", "plan_digest", "selection", "parent_tasks", "branch", "head",
		"final_commands", "runs", "delivery_diff_hash", "manifest"]);
	const selection = parseDeliveryConsolidation(e.selection)!;
	if (JSON.stringify(selection) !== JSON.stringify(e.selection) || typeof e.initiative_slug !== "string" ||
		!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(e.initiative_slug) || typeof e.branch !== "string" || !e.branch ||
		typeof e.head !== "string" || !/^[a-f0-9]{40,64}$/.test(e.head) ||
		!Array.isArray(e.parent_tasks) || !e.parent_tasks.length || !Array.isArray(e.runs) ||
		!Array.isArray(e.manifest) || !e.manifest.length || !Array.isArray(e.final_commands) ||
		e.final_commands.some(c => typeof c !== "string") || typeof raw.digest !== "string" ||
		raw.digest !== consolidationDigest(e)) throw new Error("consolidation receipt digest/shape mismatch");
	const hash = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
	if (!hash(e.plan_digest) || !hash(e.delivery_diff_hash) || !parseFinalVerification(e.final_commands)?.length)
		throw new Error("invalid consolidation proof/commands");
	const expectedRuns = [selection, ...selection.source_runs].map(({ task_id, run_id }) => ({ task_id, run_id }));
	if (e.runs.length !== expectedRuns.length) throw new Error("consolidation run contributions missing");
	for (let index = 0; index < e.runs.length; index++) {
		const binding = object(e.runs[index], ["task_id", "run_id", "record_hash", "proof_hash", "intent_hash", "review_revision"]);
		if (JSON.stringify(run({ task_id: binding.task_id, run_id: binding.run_id })) !== JSON.stringify(expectedRuns[index]) ||
			!hash(binding.record_hash) || !hash(binding.proof_hash) || !hash(binding.intent_hash))
			throw new Error("consolidation run contribution binding mismatch");
	}
	const parentIds = e.parent_tasks.map(value => {
		const task = object(value, ["task_id", "intent_hash"]);
		if (typeof task.task_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(task.task_id) || !hash(task.intent_hash))
			throw new Error("invalid consolidation Parent binding");
		return task.task_id;
	});
	if (new Set(parentIds).size !== parentIds.length) throw new Error("duplicate consolidation Parent contribution");
	const paths = e.manifest.map(value => {
		const entry = object(value, ["path", "mode", "oid"]);
		if (typeof entry.path !== "string" || !entry.path || entry.path.startsWith("/") || entry.path.includes("\\") ||
			entry.path.split("/").some(part => !part || part === "." || part === "..") ||
			(entry.mode !== "100644" && entry.mode !== "100755" && entry.mode !== null) ||
			(entry.oid !== null && (typeof entry.oid !== "string" || !/^[a-f0-9]{40,64}$/.test(entry.oid))) ||
			((entry.mode === null) !== (entry.oid === null))) throw new Error("invalid consolidation file identity");
		return entry.path;
	});
	if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify([...paths].sort()))
		throw new Error("consolidation manifest is not canonical");
	return raw as unknown as ConsolidationReceipt;
}

async function runEvidence(root: string, identity: DeliveryRun) {
	const settled = readSettledTaskEvidence(root, identity.task_id);
	if (!settled || settled.runId !== identity.run_id || settled.proof.terminal_lifecycle !== "done")
		throw new Error(`consolidation requires the exact settled done run: ${identity.task_id}`);
	const record = settled.record;
	if (record.contract !== "assurance_kernel/task_record/v4") throw new Error("consolidation requires v4 immutable Git delivery records");
	const pair = readAuditTaskPair(root, identity.task_id, identity.run_id);
	if (!pair || JSON.stringify(pair.record) !== JSON.stringify(settled.record) || JSON.stringify(pair.proof) !== JSON.stringify(settled.proof))
		throw new Error(`consolidation source audit mismatch: ${identity.task_id}`);
	const current = readTaskIntent(root, identity.task_id, settled.record.intent_ref.path);
	if (current.content_hash !== settled.record.intent_ref.content_hash) throw new Error("consolidation Intent changed");
	const status = await projectTaskStatus(root, identity.task_id);
	if (status.error || status.projection.run_id !== identity.run_id || !status.projection.completion_ready)
		throw new Error(`consolidation run has no completion proof: ${identity.task_id}`);
	const review = [...record.attestations].reverse().find(a => a.kind === "review")?.review_revision ?? null;
	if (review) {
		if (git(root, ["rev-parse", `${review.review_commit}^{tree}`]).trim() !== review.review_tree ||
			git(root, ["rev-parse", `${review.review_commit}^@`]).trim() !== review.base_head)
			throw new Error("consolidation immutable Review revision mismatch");
	}
	return { settled: { ...settled, record }, binding: { task_id: identity.task_id, run_id: identity.run_id,
		record_hash: revisionForContent(readSecureProjectFile(root, auditRunRecordPath(identity.task_id, identity.run_id))),
		proof_hash: revisionForContent(readSecureProjectFile(root, auditRunTerminalProofPath(identity.task_id, identity.run_id))),
		intent_hash: current.content_hash, review_revision: review } };
}

/** Read-only preparation: no index, association, receipt, or Git ref writes before the native gate. */
export async function prepareDeliveryConsolidation(root: string, initiativeSlug: string, planDigest: string,
	parentTaskIds: string[], selection: DeliveryConsolidation, commands: string[]): Promise<ConsolidationEnvelope> {
	selection = parseDeliveryConsolidation(selection)!;
	const all = [selection, ...selection.source_runs];
	if (!selection.source_runs.some(source => parentTaskIds.includes(source.task_id)))
		throw new Error("consolidation must select an original Parent contribution");
	const sources = [];
	for (const identity of all) sources.push(await runEvidence(root, identity));
	const final = sources[0]!.settled.record;
	if (final.intent_snapshot.risk === "routine" || !sources[0]!.binding.review_revision || !final.git_base_head)
		throw new Error("final consolidation requires fresh QA and independent material/critical Review");
	const snapshot = captureGitTaskRevisionSnapshot(root, final.intent_snapshot.scope_hint, final.git_base_head, selection.task_id);
	const diffHash = consolidationDigest(snapshot);
	if (!final.attestations.some(a => a.kind === "qa" && a.diff_hash === diffHash && a.task_revision === final.intent_snapshot.revision &&
		a.intent_content_hash === final.intent_ref.content_hash && a.acceptance_results.length === final.intent_snapshot.acceptance.length &&
		a.acceptance_results.every(r => r.status === "passed")) ||
		!final.attestations.some(a => a.kind === "review" && a.diff_hash === diffHash && a.review_revision &&
			a.task_revision === final.intent_snapshot.revision && a.intent_content_hash === final.intent_ref.content_hash))
		throw new Error("final composed bytes do not match fresh QA/Review");
	const finalScope = final.intent_snapshot.scope_hint;
	for (const source of sources.slice(1)) {
		const record = source.settled.record;
		if (!record.git_base_head) throw new Error("source run has no Git delivery base");
		const review = source.binding.review_revision;
		if (!review) throw new Error("source run has no immutable Review delivery");
		for (const path of git(root, ["diff", "--name-only", "--no-renames", "-z", record.git_base_head, review.review_commit]).split("\0").filter(Boolean))
			if (!finalScope.some(scope => pathMatchesScope(path, scope))) throw new Error(`source contribution is not covered by final Review scope: ${path}`);
	}
	const auditPaths = new Set(all.flatMap(identity => [auditRunRecordPath(identity.task_id, identity.run_id), auditRunTerminalProofPath(identity.task_id, identity.run_id)]));
	const dirty = [...new Set([...git(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]).split("\0"),
		...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")].filter(Boolean))].sort();
	const unstaged = git(root, ["diff", "--name-only", "-z"]).split("\0").filter(Boolean);
	if (unstaged.some(path => !auditPaths.has(path))) throw new Error("consolidation has unstaged delivery drift");
	const manifest = dirty.map(path => {
		if (!finalScope.some(scope => pathMatchesScope(path, scope)) && !auditPaths.has(path)) throw new Error(`dirty_outside_scope: ${path}`);
		if (!existsSync(join(root, path))) return { path, mode: null, oid: null };
		const stat = lstatSync(join(root, path));
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("consolidation only accepts regular delivery files");
		const oid = git(root, ["hash-object", "--", path]).trim();
		const staged = git(root, ["ls-files", "--stage", "--", path]);
		const mode = staged ? staged.split(" ")[0]! : stat.mode & 0o111 ? "100755" : "100644";
		return { path, mode, oid };
	});
	const parentTasks = parentTaskIds.map(task_id => ({ task_id, intent_hash: readTaskIntent(root, task_id).content_hash }));
	return { initiative_slug: initiativeSlug, plan_digest: planDigest, selection, parent_tasks: parentTasks,
		branch: git(root, ["symbolic-ref", "--short", "HEAD"]).trim(), head: git(root, ["rev-parse", "HEAD"]).trim(),
		final_commands: commands, runs: sources.map(source => source.binding), delivery_diff_hash: diffHash, manifest };
}

/** Verify committed content against the accepted manifest, not against a historical source bundle. */
export async function verifyConsolidatedCommit(root: string, receipt: ConsolidationReceipt): Promise<void> {
	parseConsolidationReceipt(receipt);
	const { envelope: e, commit } = receipt;
	if (!commit) throw new Error("consolidation commit receipt is pending");
	// Recovery must preserve the whole checkout, not just the reviewed scope snapshot.
	if (git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).length)
		throw new Error("consolidation recovery requires a clean workspace");
	if (git(root, ["ls-files", "-v", "-z"]).split("\0").some(entry => entry && !entry.startsWith("H ")))
		throw new Error("consolidation recovery rejects hidden index flags");
	const message = git(root, ["show", "-s", "--format=%B", commit]);
	if (!message.startsWith(`imm(${e.selection.task_id}): `) ||
		!message.split("\n").includes(`Immune-Brain-Task: ${e.selection.task_id}`))
		throw new Error("consolidation commit lacks the selected final task identity");
	if (git(root, ["rev-parse", `${commit}^@`]).trim() !== e.head ||
		git(root, ["symbolic-ref", "--short", "HEAD"]).trim() !== e.branch ||
		spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", commit, "HEAD"], { stdio: "ignore" }).status !== 0)
		throw new Error("consolidation commit lineage mismatch");
	const paths = git(root, ["diff-tree", "--no-commit-id", "--no-renames", "--name-only", "-r", "-z", e.head, commit]).split("\0").filter(Boolean).sort();
	if (JSON.stringify(paths) !== JSON.stringify(e.manifest.map(entry => entry.path))) throw new Error("consolidation commit manifest differs");
	for (const entry of e.manifest) {
		const tree = git(root, ["ls-tree", "-z", commit, "--", entry.path]);
		const identity = tree ? tree.split("\t")[0]!.split(" ") : null;
		if ((identity?.[0] ?? null) !== entry.mode || (identity?.[2] ?? null) !== entry.oid)
			throw new Error("consolidation committed bytes/mode mismatch");
	}
	for (const identity of e.runs) {
		const current = (await runEvidence(root, identity)).binding;
		if (JSON.stringify(current) !== JSON.stringify(identity)) throw new Error("consolidation source proof changed");
		for (const path of [auditRunRecordPath(identity.task_id, identity.run_id), auditRunTerminalProofPath(identity.task_id, identity.run_id)])
			if (git(root, ["show", `${commit}:${path}`]) !== readSecureProjectFile(root, path)) throw new Error("committed source audit mismatch");
	}
	for (const parent of e.parent_tasks)
		if (readTaskIntent(root, parent.task_id).content_hash !== parent.intent_hash) throw new Error("consolidated Parent Intent changed");
	const final = readSettledTaskEvidence(root, e.selection.task_id)!.record;
	if (final.contract !== "assurance_kernel/task_record/v4") throw new Error("final consolidation record changed contract");
	const live = captureGitTaskRevisionSnapshot(root, final.intent_snapshot.scope_hint, final.git_base_head, e.selection.task_id);
	if (consolidationDigest(live) !== e.delivery_diff_hash) throw new Error("consolidated delivery changed after commit");
}

export async function observeConsolidatedDeliveries(root: string, slug: string, requiredIds: readonly string[]) {
	const receipt = readParentConsolidationReceipt(root, slug);
	if (!receipt || !receipt.commit) return null;
	if (JSON.stringify(receipt.envelope.parent_tasks.map(task => task.task_id).sort()) !== JSON.stringify([...requiredIds].sort()))
		throw new Error("consolidation Parent contribution set changed");
	await verifyConsolidatedCommit(root, receipt);
	return receipt;
}
