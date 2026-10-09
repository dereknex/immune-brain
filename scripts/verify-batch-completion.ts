#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { readSecureProjectBytes } from "../plugins/immune-brain/runtime/kernel/storage";
import { parseTaskRecord } from "../plugins/immune-brain/runtime/kernel/validation";
import { parseTaskTombstone } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { parseBatchLaneRunState, parseBatchRunState, type BatchLaneRunReport, type BatchRunReport } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { pathMatchesScope } from "../plugins/immune-brain/runtime/workspace_scope";

const CODES = ["state_report_mismatch", "commit_order_mismatch", "lineage_mismatch", "missing_commit_evidence", "wrong_run_evidence", "stopped_lifecycle", "scope_mismatch", "malformed_report", "unstable_evidence", "invalid_input", "read_failed"] as const;
type Code = typeof CODES[number];
class ObservationError extends Error { constructor(readonly code: Code) { super(code); } }
function fail(code: Code): never { throw new ObservationError(code); }
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const decode = (raw: Uint8Array): string => {
	try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); }
	catch { fail("read_failed"); }
};
const gitBytes = (root: string, args: string[]) => {
	const result = spawnSync("git", ["-C", root, ...args]);
	if (result.status !== 0 || result.error) fail("read_failed");
	return result.stdout;
};
const git = (root: string, args: string[]) => decode(gitBytes(root, args));
const inside = (root: string, path: string) => {
	const full = resolve(root, path);
	const rel = relative(root, full);
	if (!rel || rel.startsWith("..") || rel.split(/[\\/]/).includes("..")) fail("invalid_input");
	let cursor = root;
	for (const part of rel.split(/[\\/]/).filter(Boolean)) {
		cursor = join(cursor, part);
		try { if (lstatSync(cursor).isSymbolicLink()) fail("invalid_input"); }
		catch (error) { if (error instanceof ObservationError) throw error; if ((error as { code?: string }).code !== "ENOENT") fail("read_failed"); }
	}
	return rel.split(sep).join("/");
};
const bytes = (root: string, path: string) => readSecureProjectBytes(root, inside(root, path));
const scopePath = (path: string) => !/[\\]|\s\/|\/\s|^\s|\s$/.test(path) && !path.split("/").some((part) => !part || part === "." || part === "..");
const allowed = (path: string, task: string, scope: string[]) => path === `.imm/audit/${task}` || path.startsWith(`.imm/audit/${task}/`) || scope.some((item) => item.includes("*") || item.includes("?") ? pathMatchesScope(path, item) : path === item || path.startsWith(`${item}/`));
const ids = (children: Array<{ task_id: string; slice_id: string; blocked_by: string[]; state: string; commit: string | null }>) => children.map(({ task_id, slice_id, blocked_by, state, commit }) => ({ task_id, slice_id, blocked_by, state, commit }));
const oid = (value: unknown): string => { if (typeof value !== "string" || !OID.test(value)) fail("invalid_input"); return value; };

function reportOf(root: string, batch: string, lane: boolean): { report: BatchRunReport & Partial<BatchLaneRunReport>; raw: Buffer } {
	const path = inside(root, `.imm/state/batches/${batch}.report.json`);
	let raw: Buffer; let parsed: unknown;
	try { raw = bytes(root, path); parsed = JSON.parse(decode(raw)); }
	catch (error) { if (error instanceof ObservationError) throw error; fail("malformed_report"); }
	const report = parsed as Partial<BatchRunReport>;
	if (report?.contract !== "assurance_kernel/batch_run_report/v1" || report.batch_id !== batch || typeof report.initiative_slug !== "string" || report.initiative_slug.length === 0 || !Array.isArray(report.children) || !Array.isArray(report.commits)) fail("malformed_report");
	// A lane report carries handoffs[] and max_parallel and never the serial handoff.
	if (lane && (!Array.isArray((report as Partial<BatchLaneRunReport>).handoffs) || "handoff" in report || typeof (report as Partial<BatchLaneRunReport>).max_parallel !== "number")) fail("malformed_report");
	return { report: report as BatchRunReport & Partial<BatchLaneRunReport>, raw: raw! };
}
function evidenceOf(raw: Buffer, batch: string, task: string) {
	let parsed: Record<string, unknown>;
	try { parsed = JSON.parse(decode(raw)) as Record<string, unknown>; }
	catch { fail("missing_commit_evidence"); }
	if (parsed.contract !== "assurance_kernel/batch_commit_evidence/v1" || parsed.batch_id !== batch || parsed.task_id !== task || typeof parsed.commit !== "string" || !OID.test(parsed.commit) || typeof parsed.parent_head !== "string" || !OID.test(parsed.parent_head)) fail("missing_commit_evidence");
	return { commit: parsed.commit, parent: parsed.parent_head };
}
export function verify(root: string, batch: string, afterCapture?: (path: string) => void) {
	const capture = (path: string) => { const raw = bytes(root, path); afterCapture?.(path); return raw; };
	const statePath = inside(root, `.imm/state/batches/${batch}.json`);
	const stateRaw = capture(statePath);
	const stateText = decode(stateRaw);
	// A v2 record is only ever parsed as v2; the v1 parser and its results are untouched.
	const lane = ((): boolean => { try { return (JSON.parse(stateText) as { contract?: unknown } | null)?.contract === "assurance_kernel/batch_run_state/v2"; } catch { return false; } })();
	// A v2 record that breaks its own invariants (for example completed with an unintegrated child) contradicts itself: state_report_mismatch, never read_failed.
	const state = lane ? ((): ReturnType<typeof parseBatchLaneRunState> => { try { return parseBatchLaneRunState(stateText, batch); } catch { return fail("state_report_mismatch"); } })() : parseBatchRunState(stateText, batch);
	const { report, raw: reportRaw } = reportOf(root, batch, lane);
	afterCapture?.(`.imm/state/batches/${batch}.report.json`);
	if (typeof state.initiative_slug !== "string" || state.initiative_slug.length === 0 || state.batch_state !== "completed" || report.batch_state !== "completed" || state.initiative_slug !== report.initiative_slug || JSON.stringify(ids(state.children)) !== JSON.stringify(ids(report.children)) || JSON.stringify(state.commits) !== JSON.stringify(report.commits)) fail("state_report_mismatch");
	if ("max_parallel" in state && state.max_parallel !== report.max_parallel) fail("state_report_mismatch");
	// Lane children integrate in settle order, so their plan order need not equal the commit order.
	const done = lane ? ["integrated", "released"] : ["committed"];
	if (state.children.some((child) => !done.includes(child.state) || !child.commit) || new Set(state.commits).size !== state.commits.length || (lane ? [...state.children.map((child) => child.commit)].sort().join() !== [...state.commits].sort().join() : state.children.map((child) => child.commit).join() !== state.commits.join())) fail("commit_order_mismatch");
	const branch = git(root, ["symbolic-ref", "--short", "HEAD"]).trim();
	const head = oid(git(root, ["rev-parse", "--verify", "-q", "HEAD"]).trim());
	// An adopted commit is the user's own work on the batch branch: the chain may
	// step over it, but only as a recorded descendant of the head it moved from.
	const follow = (from: string): string => {
		let current = from;
		for (const adoption of state.adopted_heads ?? []) {
			if (oid(adoption.from) !== current) continue;
			const to = oid(adoption.to);
			if (to === current || spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", current, to], { stdio: "ignore" }).status !== 0) fail("lineage_mismatch");
			current = to;
		}
		return current;
	};
	const lastCommit = state.commits.at(-1);
	if (branch !== (state.branch ?? `imm/${state.initiative_slug}`) || !lastCommit || head !== follow(oid(lastCommit))) fail("lineage_mismatch");
	let parent = oid(state.base_head);
	const consumed: Array<{ path: string; raw: Buffer }> = [{ path: statePath, raw: stateRaw }, { path: inside(root, `.imm/state/batches/${batch}.report.json`), raw: reportRaw }];
	const children = [];
	const ordered = lane ? [...state.children].sort((a, b) => state.commits.indexOf(a.commit!) - state.commits.indexOf(b.commit!)) : state.children;
	for (const [index, child] of ordered.entries()) {
		const commit = oid(child.commit);
		parent = follow(parent);
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(child.task_id)) fail("invalid_input");
		// Lane commit evidence lives in the Lane's own store; the batch-branch lineage below is the authority.
		if (!lane) {
			const evidencePath = inside(root, `.imm/state/batches/commits/${batch}-${child.task_id}.json`);
			const evidenceRaw = capture(evidencePath);
			consumed.push({ path: evidencePath, raw: evidenceRaw });
			const evidence = evidenceOf(evidenceRaw, batch, child.task_id);
			if (evidence.commit !== commit || evidence.parent !== parent) fail("missing_commit_evidence");
		}
		const metadata = git(root, ["log", "-n", "1", "--format=%H%x00%(trailers:key=Immune-Brain-Batch,valueonly)%x00%an%x00%s", commit, "--"]).trimEnd().split("\0");
		if (metadata[0] !== commit || metadata[1]?.trim() !== batch || metadata[2] !== (process.env.GIT_AUTHOR_NAME || "Immune-Brain Batch") || !metadata[3]?.startsWith(`imm(${child.task_id}):`)) fail("missing_commit_evidence");
		const parents = git(root, ["rev-list", "--parents", "-n", "1", commit]).trim().split(/\s+/).slice(1);
		if (parents.length !== 1 || parents[0] !== parent) fail("lineage_mismatch");
		const delta = git(root, ["diff-tree", "--no-commit-id", "--name-only", "-z", "-r", parent, commit]).split("\0").filter(Boolean);
		const runs = [...new Set(delta.flatMap((path) => {
			const parts = path.split("/");
			return parts.length === 5 && parts[0] === ".imm" && parts[1] === "audit" && parts[2] === child.task_id && ["task-record.json", "terminal-proof.json"].includes(parts[4]!) ? [parts[3]!] : [];
		}))];
		if (runs.length !== 1) fail("wrong_run_evidence");
		const run = runs[0];
		const pairPaths = [`.imm/audit/${child.task_id}/${run}/task-record.json`, `.imm/audit/${child.task_id}/${run}/terminal-proof.json`];
		if (!pairPaths.every((path) => delta.includes(path))) fail("wrong_run_evidence");
		if (!/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(run)) fail("wrong_run_evidence");
		const captured = pairPaths.map((path) => ({ path, raw: capture(path) }));
		const record = parseTaskRecord(JSON.parse(decode(captured[0]!.raw)));
		const proof = parseTaskTombstone(JSON.parse(decode(captured[1]!.raw)));
		const recordHash = `sha256:${new Bun.CryptoHasher("sha256").update(captured[0]!.raw).digest("hex")}`;
		if (record.task_id !== child.task_id || proof.final_record_hash !== recordHash) fail("wrong_run_evidence");
		for (const item of captured) {
			consumed.push(item);
			if (!gitBytes(root, ["show", `${commit}:${item.path}`]).equals(item.raw)) fail("unstable_evidence");
		}
		if (record.lifecycle !== "done" || proof.terminal_lifecycle !== "done") fail("stopped_lifecycle");
		const terminal = record.history.at(-1);
		if (proof.task_id !== child.task_id || proof.terminal_event_id !== terminal?.id || terminal?.type !== "complete" || terminal.from_state !== "active:frozen" || terminal.to_state !== "done:frozen") fail("wrong_run_evidence");
		const scope = record.intent_snapshot.scope_hint.filter((item: unknown): item is string => typeof item === "string");
		if (scope.some((item) => !scopePath(item)) || delta.some((path) => !scopePath(path) || !allowed(path, child.task_id, scope))) fail("scope_mismatch");
		children.push({ task_id: child.task_id, run_id: run, commit, parent });
		parent = commit;
		if (index !== state.commits.indexOf(commit)) fail("commit_order_mismatch");
	}
	const againBranch = git(root, ["symbolic-ref", "--short", "HEAD"]).trim();
	const againHead = oid(git(root, ["rev-parse", "--verify", "-q", "HEAD"]).trim());
	if (againBranch !== branch || againHead !== head || consumed.some((item) => !bytes(root, item.path).equals(item.raw))) fail("unstable_evidence");
	return { contract: "immune_brain/batch_completion_observation/v1", batch_id: batch, complete: true, batch_state: state.batch_state, report_state: report.batch_state, children, code: null };
}

if (import.meta.main) {
const args = process.argv.slice(2); let batch = "", json = false;
try {
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--json") json = true;
		else if (args[i] === "--batch-id" && args[i + 1] && !batch) batch = args[++i];
		else fail("invalid_input");
	}
	if (!json || !/^batch-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(batch)) fail("invalid_input");
	const root = process.cwd();
	if (git(root, ["rev-parse", "--show-toplevel"]).trim() !== resolve(root)) fail("invalid_input");
	inside(root, `.imm/state/batches/${batch}.json`);
	console.log(JSON.stringify(await verify(root, batch)));
	process.exit(0);
} catch (error) {
	const code = error instanceof ObservationError ? error.code : "read_failed";
	const status = code === "invalid_input" || code === "read_failed" || code === "malformed_report" ? 2 : 1;
	console.log(JSON.stringify({ contract: "immune_brain/batch_completion_observation/v1", batch_id: batch || null, complete: false, code }));
	process.exit(status);
}
}
