// Read-only eligibility for a first, zero-commit plan reconfirmation.
import { spawnSync } from "node:child_process";
import { computeBatchPlanDigest, type BatchPlanChild as DigestChild } from "../kernel/batch_authority";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../kernel/intent";
import { projectAssurance } from "../kernel/assurance_projection";
import { localRunId, readAuditTaskPair, readSecureProjectBytes, readWorkspaceStateRaw } from "../kernel/storage";
import { readRunRowByTask, withKernelRead } from "../kernel/sqlite_store";
import { taskRevisionIdentity, taskCommitRevisionIdentity, pathMatchesScope } from "../workspace_scope";
import { projectTask } from "../kernel/completion";
import { isTerminalBatchState, type BatchRunStateRecord } from "./batch_state";
import type { BatchPlanChild } from "./types";

const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const batchAuthor = process.env.GIT_AUTHOR_NAME || "Immune-Brain Batch";
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
function refuse(): never { throw new Error("plan_digest mismatch: batch plan reconfirmation is not eligible"); }
function matchesLocalProof(localJson: string | null, exported: object): boolean {
	return localJson !== null && JSON.stringify(Object.entries(JSON.parse(localJson)).sort()) === JSON.stringify(Object.entries(exported).sort());
}
function git(root: string, args: string[]): string {
	const r = spawnSync("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: 262144, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
	if (r.status !== 0) refuse();
	return decode(r.stdout);
}
// Recognize only the first commit/persist crash window; never query Git with
// an OID read from mutable evidence. The existing Git port performs final adoption.
export function ownUnpersistedBatchHead(root: string, record: BatchRunStateRecord, head: string): boolean {
	try {
		if (!oid.test(head) || !oid.test(record.base_head) || !id.test(record.batch_id) || record.commits.length ||
			record.children[0]?.state !== "settled" || record.children.some(c => c.commit !== null)) return false;
		const task = record.children[0].task_id;
		if (!id.test(task)) return false;
		const evidence = JSON.parse(decode(readSecureProjectBytes(root, `.imm/state/batches/commits/${record.batch_id}-${task}.json`)));
		if (evidence.contract !== "assurance_kernel/batch_commit_evidence/v1" || evidence.batch_id !== record.batch_id ||
			evidence.task_id !== task || evidence.commit !== head || evidence.parent_head !== record.base_head) return false;
		if (git(root, ["symbolic-ref", "--short", "HEAD"]).trim() !== record.branch) return false;
		const parents = git(root, ["rev-list", "--parents", "-n", "1", head]).trim().split(/\s+/).slice(1);
		if (parents.length !== 1 || parents[0] !== record.base_head) return false;
		const metadata = git(root, ["show", "-s", "--format=%an%x00%s%x00%(trailers:key=Immune-Brain-Batch,valueonly)", head]).split("\0");
		if (metadata[0] !== batchAuthor || !metadata[1]?.startsWith(`imm(${task}):`) || metadata[2]?.trim() !== record.batch_id) return false;
		const run = localRunId(root, task);
		if (!run || !id.test(run)) return false;
		const pair = readAuditTaskPair(root, task, run);
		if (!pair || pair.record.contract !== "assurance_kernel/task_record/v4" || pair.record.lifecycle !== "done" || pair.proof.terminal_lifecycle !== "done") return false;
		const local = withKernelRead(root, db => readRunRowByTask(db, task));
		if (!local || local.run_id !== run || local.state !== "done" || !matchesLocalProof(local.terminal_proof_json, pair.proof)) return false;
		for (const file of ["task-record.json", "terminal-proof.json"]) {
			const path = `.imm/audit/${task}/${run}/${file}`;
			if (!readSecureProjectBytes(root, path).equals(Buffer.from(git(root, ["show", `${head}:${path}`])))) return false;
		}
		const paths = git(root, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-z", "-r", head]).split("\0").filter(Boolean);
		if (!paths.length || paths.some(path => !path.startsWith(`.imm/audit/${task}/${run}/`) &&
			!pair.record.intent_snapshot.scope_hint.some(s => pathMatchesScope(path, s)))) return false;
		const identity = taskCommitRevisionIdentity(root, pair.record.intent_snapshot.scope_hint, pair.record.git_base_head, head);
		if (!projectTask(pair.record.intent_snapshot, pair.record, identity.diff_hash, pair.record.intent_ref.content_hash, identity.changed_paths).complete) return false;
		return git(root, ["rev-parse", "HEAD"]).trim() === head;
	} catch { return false; }
}

export interface ReconfirmationSnapshot {
	root: string;
	plan_digest: string;
	stateBytes: Buffer;
	/** Synchronous read-only check repeated under the state owner's lock. */
	assertUnchanged(): void;
}

// Ephemeral captured observations, not authority: the runner independently
// validates the native capability. Entries expire and are discarded on application.
const confirmations = new Map<string, { snapshot: ReconfirmationSnapshot; expires: number }>();
export function retainReconfirmation(nonce: string, expires: string, snapshot: ReconfirmationSnapshot): void {
	for (const [key, value] of confirmations) if (value.expires <= Date.now()) confirmations.delete(key);
	if (confirmations.has(nonce)) refuse();
	confirmations.set(nonce, { snapshot, expires: Date.parse(expires) });
}
export function takeReconfirmation(nonce: string): ReconfirmationSnapshot {
	const found = confirmations.get(nonce); confirmations.delete(nonce);
	if (!found || found.expires <= Date.now()) refuse();
	return found.snapshot;
}

export async function captureBatchReconfirmation(root: string, record: BatchRunStateRecord, children: BatchPlanChild[]): Promise<ReconfirmationSnapshot> {
	if (!id.test(record.batch_id) || !oid.test(record.base_head) || isTerminalBatchState(record.batch_state) || record.commits.length ||
		record.children.some(c => c.commit !== null || c.state === "committed") || record.children.length !== children.length || !children.length) refuse();
	const assertNoCommitEvidence = () => {
		for (const child of record.children) {
			if (!id.test(child.task_id)) refuse();
			const path = `.imm/state/batches/commits/${record.batch_id}-${child.task_id}.json`;
			let missing = false;
			try { readSecureProjectBytes(root, path); }
			catch (error) {
				if (error instanceof Error && error.message === `source_missing: ${path}`) missing = true;
				else refuse();
			}
			if (!missing) refuse();
		}
	};
	assertNoCommitEvidence();
	const statePath = `.imm/state/batches/${record.batch_id}.json`;
	const stateBytes = readSecureProjectBytes(root, statePath);
	if (JSON.stringify(JSON.parse(decode(stateBytes))) !== JSON.stringify(record)) refuse();
	const files = new Map<string, Buffer>();
	const capture = (path: string) => { const bytes = readSecureProjectBytes(root, path); files.set(path, bytes); return bytes; };
	const oldChildren: DigestChild[] = [];
	const changed: Array<{ task: string; run: string; identity: string; local: string }> = [];
	let scope: string[] | null = null;
	const workspace = readWorkspaceStateRaw(root);
	if (workspace.state.current_working !== null) refuse();
	for (const [index, child] of children.entries()) {
		const previous = record.children[index]!;
		if (!id.test(child.task_id) || child.task_id !== previous.task_id || child.slice_id !== previous.slice_id ||
			JSON.stringify(child.blocked_by) !== JSON.stringify(previous.blocked_by) || child.intent_path !== `docs/plans/${child.task_id}.intent.json`) refuse();
		const old = parseTaskIntentV1(JSON.parse(git(root, ["show", `${record.base_head}:${child.intent_path}`])));
		if (old.task_id !== child.task_id) refuse();
		const oldHash = canonicalIntentHash(old);
		oldChildren.push({ task_id: child.task_id, blocked_by: [...child.blocked_by], intent_path: child.intent_path, intent_revision: old.revision, intent_content_hash: oldHash });
		const currentBytes = capture(child.intent_path);
		const current = parseTaskIntentV1(JSON.parse(decode(currentBytes)));
		const currentHash = canonicalIntentHash(current);
		const tracked = readTaskIntent(root, child.task_id, child.intent_path);
		if (currentHash !== tracked.content_hash || currentHash !== child.intent_content_hash || current.revision !== child.intent_revision) refuse();
		if (currentHash === oldHash) continue;
		if (scope !== null || previous.state === "pending" || previous.state === "skipped_blocked" || current.revision <= old.revision || current.goal !== old.goal || current.owner !== old.owner) refuse();
		const run = localRunId(root, child.task_id);
		if (!run || !id.test(run)) refuse();
		const local = withKernelRead(root, db => readRunRowByTask(db, child.task_id));
		if (!local || local.run_id !== run || local.state !== "done" || local.enrollment_event_id !== `enroll-${child.task_id}-${local.created_at}` ||
			Date.parse(local.created_at) > Date.parse(record.updated_at)) refuse();
		const pair = readAuditTaskPair(root, child.task_id, run);
		if (!pair || pair.record.contract !== "assurance_kernel/task_record/v4") refuse();
		const r = pair.record;
		if (r.lifecycle !== "done" || r.intent_ref.content_hash !== currentHash || canonicalIntentHash(r.intent_snapshot) !== currentHash ||
			r.git_base_head !== record.base_head || pair.proof.terminal_lifecycle !== "done") refuse();
		const terminal = r.history.at(-1);
		if (terminal?.type !== "complete" || terminal.from_state !== "active:frozen" || terminal.to_state !== "done:frozen" || terminal.id !== pair.proof.terminal_event_id) refuse();
		const recordPath = `.imm/audit/${child.task_id}/${run}/task-record.json`;
		const proofPath = `.imm/audit/${child.task_id}/${run}/terminal-proof.json`;
		if (!capture(recordPath).equals(Buffer.from(local.record_json))) refuse();
		const capturedProof = JSON.parse(decode(capture(proofPath)));
		if (!matchesLocalProof(local.terminal_proof_json, capturedProof) || !matchesLocalProof(local.terminal_proof_json, pair.proof)) refuse();
		const identity = taskRevisionIdentity(root, r.intent_snapshot.scope_hint, r.git_base_head, r.task_id);
		const projection = await projectAssurance(root, child.task_id, (cwd, task) => {
			if (task.contract !== "assurance_kernel/task_record/v4" || !task.git_base_head) refuse();
			return taskRevisionIdentity(cwd, task.intent_snapshot.scope_hint, task.git_base_head, task.task_id);
		});
		if (projection.error || projection.claim || projection.projection.run_id !== run || projection.projection.lifecycle !== "done" ||
			!projection.projection.completion_ready || projection.projection.intent_content_hash !== currentHash || projection.projection.diff_hash !== identity.diff_hash ||
			!projection.projection.fresh_approval_kinds.includes("qa") ||
			(projection.projection.risk !== "routine" && !projection.projection.fresh_approval_kinds.includes("review"))) refuse();
		scope = r.intent_snapshot.scope_hint;
		changed.push({ task: child.task_id, run, identity: JSON.stringify(identity), local: JSON.stringify(local) });
	}
	if (computeBatchPlanDigest(oldChildren) !== record.plan_digest || changed.length !== 1 || scope === null) refuse();
	const confirmedScope = scope;
	const owner = changed[0]!;
	const status = () => git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]);
	const statusBytes = status();
	const entries = statusBytes.split("\0").filter(Boolean);
	// This bounded path refuses renames; staged regular edits/additions/deletions
	// are enough for a revised child and cannot hide a second source path.
	for (const entry of entries) {
		const code = entry.slice(0, 2), path = entry.slice(3);
		if (code[1] !== " " || !["A", "M", "D"].includes(code[0]!) ||
			(!path.startsWith(`.imm/audit/${owner.task}/${owner.run}/`) &&
			!confirmedScope.some(s => pathMatchesScope(path, s)))) refuse();
	}
	const flagsBytes = git(root, ["ls-files", "-v"]);
	const flags = flagsBytes.split("\n").filter(Boolean);
	if (flags.some(line => line[0] === "S" || line[0] !== line[0]?.toUpperCase())) refuse();
	const head = () => git(root, ["rev-parse", "HEAD"]).trim();
	const branch = () => git(root, ["symbolic-ref", "--short", "HEAD"]).trim();
	if (head() !== record.base_head || branch() !== record.branch) refuse();
	const assertDeliveryUnchanged = () => {
		for (const c of changed) {
			const pair = readAuditTaskPair(root, c.task, c.run);
			if (!pair || pair.record.contract !== "assurance_kernel/task_record/v4" || !pair.record.git_base_head) refuse();
			const local = withKernelRead(root, db => readRunRowByTask(db, c.task));
			const diff = taskRevisionIdentity(root, pair.record.intent_snapshot.scope_hint, pair.record.git_base_head, c.task);
			if (localRunId(root, c.task) !== c.run || JSON.stringify(local) !== c.local || JSON.stringify(diff) !== c.identity) refuse();
		}
	};
	const assertUnchanged = () => {
		assertNoCommitEvidence();
		if (!readSecureProjectBytes(root, statePath).equals(stateBytes) || head() !== record.base_head || branch() !== record.branch || status() !== statusBytes || git(root, ["ls-files", "-v"]) !== flagsBytes ||
			readWorkspaceStateRaw(root).revision !== workspace.revision) refuse();
		for (const [path, bytes] of files) if (!readSecureProjectBytes(root, path).equals(bytes)) refuse();
		assertDeliveryUnchanged();
	};
	assertUnchanged();
	const plan_digest = computeBatchPlanDigest(oldChildren.map((old, index) => ({ ...old,
		intent_revision: children[index]!.intent_revision!, intent_content_hash: children[index]!.intent_content_hash! })));
	return { root, plan_digest, stateBytes, assertUnchanged };
}
