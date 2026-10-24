import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { localRunId, readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { runLaneBatch } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { prepareBatchLaneRunState, readBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { createLaneWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";
import type { StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const BEFORE = "2026-01-01T00:00:00.000Z";
const NOW = "2026-02-01T00:00:00.000Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=t@t", ...args],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture(mode = "stopped", grants = 0) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "parked-revive-")));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	for (const task_id of ["a", "b", "c"]) writeFileSync(join(root, `docs/plans/${task_id}.intent.json`), JSON.stringify({
		contract: "assurance_kernel/task_intent/v1", task_id, owner: "user", goal: `deliver ${task_id}`,
		acceptance: [{ id: "AC1", assertion: "works", verification: "bun -e 'process.exit(0)'" }],
		scope_hint: [`${task_id}.txt`], risk: "material", revision: 1,
	}));
	git(root, "add", "-A"); git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	git(root, "branch", "imm/revive");
	const children = ["a", "b", "c"].map((task_id, i) => {
		const read = readTaskIntent(root, task_id);
		return { task_id, slice_id: `S${i + 1}`, status: "enrollable" as const, reason: null,
			blocked_by: task_id === "b" ? ["a"] : [], intent_path: read.intent_ref.path,
			intent_revision: 1, intent_content_hash: read.content_hash };
	});
	const binding = { batch_id: "revive-batch", initiative_slug: "revive", plan_digest: computeBatchPlanDigest(children),
		branch: "refs/heads/imm/revive", base_head: base, budget: { max_children: 3, qa_failure_limit: 2 },
		actor_id: "user", confirmation_ref: "fresh-confirmation", nonce: "fresh-nonce" };
	const record = prepareBatchLaneRunState({ ...binding, children, confirmation_time: BEFORE, now: BEFORE, max_parallel: 2 });
	record.batch_state = "needs_human";
	const paths: Record<string, string> = {};
	const runs: Record<string, string> = {};
	for (const taskId of ["a", "c"]) {
		const lane = createLaneWorktree(root, "revive", taskId, base);
		paths[taskId] = lane;
		const read = readTaskIntent(lane, taskId);
		const lifecycle = taskId === "c" || mode === "active" || mode === "decision" || mode === "replan" ? "active" : "stopped";
		const decision = mode.endsWith("decision");
		const replan = mode.endsWith("replan");
		const kind = decision ? "unresolved_user_decision" : "replan_required";
		const seeded = seedKernelRunForTest(lane, { task_id: taskId,
			...(lifecycle === "stopped" ? { terminal: { lifecycle } } : {}), record: {
				contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: read.intent,
				intent_ref: { path: read.intent_ref.path, content_hash: read.content_hash }, lifecycle, artifact_state: lifecycle === "stopped" ? "frozen" : "active",
				baseline: read.content_hash, git_base_head: base, attestations: [], history: [],
				findings: taskId === "a" && (decision || replan) ? [{ id: "pending", kind,
					status: "open", source: "execution", acceptance_id: null, summary: "requires user", review_round: 1 }] : [],
			} });
		runs[taskId] = seeded.run_id;
		record.children = record.children.map(c => c.task_id === taskId ? { ...c, state: "needs_human", reason: "parked",
			...(taskId === "a" ? { redo_grants: grants } : {}),
			lane: { path: lane, branch: `imm-lane/revive/${taskId}`, base_head: base, lane_commit: null, run_id: seeded.run_id } } : c);
	}
	record.children[1] = { ...record.children[1]!, state: "skipped_blocked", reason: "dependency a parked" };
	if (mode === "unreadable") {
		rmSync(join(paths.a!, ".imm/state"), { recursive: true, force: true });
		mkdirSync(join(paths.a!, ".imm/state"));
		writeFileSync(join(paths.a!, ".imm/state/kernel.sqlite"), "not sqlite");
	}
	if (mode === "lost") rmSync(paths.a!, { recursive: true, force: true });
	writeBatchLaneRunState(root, record);
	writeFileSync(join(root, "parent.txt"), "new Parent tip\n");
	git(root, "add", "parent.txt"); git(root, "commit", "-qm", "advance Parent");
	const head = git(root, "rev-parse", "HEAD");
	git(root, "update-ref", binding.branch, head, base);
	function input(confirmation_time = NOW): StartBatchInput {
		const registry = createBatchAuthorityRegistry();
		const capability = registry.issue(binding, children, confirmation_time);
		const kernel = createBatchKernelPort({ root, enrollmentRegistry: createEnrollmentAuthorityRegistry(), registry, capability, binding,
			advanceTask: async () => { throw new Error("unfrozen children belong to their Executor"); },
			resume: { isResuming: true, existingBatch: record, batchBranch: binding.branch } });
		return { root, ...binding, registry, capability, children, kernel, confirmation_time, now: NOW, max_parallel: 2 };
	}
	return { root, record, paths, runs, head, input };
}

for (const mode of ["stopped", "unreadable", "lost"]) test(`fresh resume revives ${mode} child at Parent tip while retaining the independent owned run`, async () => {
	const fx = fixture(mode);
	const args = fx.input();
	const report = await runLaneBatch(args, fx.record);
	expect(report.children.map(c => c.state)).toEqual(["enrolled", "pending", "enrolled"]);
	expect(report.batch_state).toBe("running");
	const child = report.children[0]!;
	expect(child.lane!.base_head).toBe(fx.head);
	expect(child.redo_grants).toBe(1);
	expect(child.lane!.run_id).not.toBe(fx.runs.a);
	expect(report.children[2]!.lane!.run_id).toBe(fx.runs.c);
	expect(git(fx.paths.a!, "rev-parse", "HEAD")).toBe(fx.head);
	expect(readTaskRecordRaw(fx.paths.a!, "a").record).toMatchObject({ lifecycle: "active", attestations: [], git_base_head: fx.head });
	expect(localRunId(fx.paths.a!, "a")).toBe(child.lane!.run_id);
	expect(args.registry.redoGrants(args.capability, "a")).toBe(1);
	expect(args.registry.isChildConsumed(args.capability, "a")).toBe(true);
	const next = await runLaneBatch(args, readBatchLaneRunState(fx.root, fx.record.batch_id)!);
	expect(next.children[0]!.redo_grants).toBe(1);
	expect(next.children[0]!.lane!.run_id).toBe(child.lane!.run_id);
});

for (const mode of ["decision", "replan", "stopped-decision", "stopped-replan", "exhausted", "dirty"]) test(`${mode} child remains parked without blocking the independent run`, async () => {
	const fx = fixture(mode, mode === "exhausted" ? 2 : 0);
	if (mode === "dirty") writeFileSync(join(fx.paths.a!, "scratch.txt"), "preserve me");
	const report = await runLaneBatch(fx.input(), fx.record);
	expect(report.children.map(c => c.state)).toEqual(["needs_human", "skipped_blocked", "enrolled"]);
	expect(report.children[2]!.lane!.run_id).toBe(fx.runs.c);
	expect(localRunId(fx.paths.a!, "a")).toBe(fx.runs.a);
	if (mode === "dirty") expect(readFileSync(join(fx.paths.a!, "scratch.txt"), "utf8")).toBe("preserve me");
});

for (const removed of [false, true]) test(`a durable parked redo waits for capacity and resumes ${removed ? "after" : "before"} Lane removal without a second grant`, async () => {
	const fx = fixture();
	fx.record.max_parallel = 1;
	writeBatchLaneRunState(fx.root, fx.record);
	const first = await runLaneBatch({ ...fx.input(), max_parallel: 1 }, fx.record);
	expect(first.children.map(c => c.state)).toEqual(["needs_human", "skipped_blocked", "enrolled"]);
	expect(first.children[0]!.redo_grants).toBe(1);
	expect(first.children[0]!.redo_head).toBe(fx.head);
	expect(localRunId(fx.paths.a!, "a")).toBe(fx.runs.a);
	const pending = readBatchLaneRunState(fx.root, fx.record.batch_id)!;
	// The independent Executor parked between ticks, freeing its one running slot.
	pending.children[2] = { ...pending.children[2]!, state: "needs_human", reason: "Executor parked" };
	writeBatchLaneRunState(fx.root, pending);
	if (removed) rmSync(fx.paths.a!, { recursive: true, force: true });
	const args = { ...fx.input(), max_parallel: 1 };
	const resumed = await runLaneBatch(args, pending);
	expect(resumed.children.map(c => c.state)).toEqual(["enrolled", "pending", "needs_human"]);
	expect(resumed.children[0]!.redo_grants).toBe(1);
	expect(resumed.children[0]!.redo_head).toBeUndefined();
	expect(args.registry.redoGrants(args.capability, "a")).toBe(1);
	expect(git(fx.paths.a!, "rev-parse", "HEAD")).toBe(fx.head);
});

test("resume without a new confirmation has no effect", async () => {
	const fx = fixture();
	const before = readFileSync(join(fx.root, `.imm/state/batches/${fx.record.batch_id}.json`), "utf8");
	const report = await runLaneBatch(fx.input(BEFORE), fx.record);
	expect(report.batch_state).toBe("needs_human");
	expect(report.reason).toContain("fresh literal-user confirmation");
	expect(readFileSync(join(fx.root, `.imm/state/batches/${fx.record.batch_id}.json`), "utf8")).toBe(before);
	expect(existsSync(fx.paths.a!)).toBe(true);
});
