import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { localRunId } from "../plugins/immune-brain/runtime/kernel/storage";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { runLaneBatch } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { prepareBatchLaneRunState, readBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import type { BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { createLaneWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";
import type { StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const BEFORE = "2026-01-01T00:00:00.000Z";
const NOW = "2026-02-01T00:00:00.000Z";
const LATER = "2026-03-01T00:00:00.000Z";
const BUNDLE = "plugins/immune-brain/dist/claude/mcp-server.mjs";
// The coordinator under test loads this repository's own plugin build.
const LOADED = readFileSync(join(import.meta.dir, "..", BUNDLE));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=t@t", ...args],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function write(root: string, path: string, content: string | Buffer) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

type Integrated = "differs" | "equal" | "not_plugin_source";

function fixture(integrated: Integrated = "differs") {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "reload-gate-")));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	write(root, ".gitignore", ".imm/state/\n");
	if (integrated !== "not_plugin_source") write(root, "plugins/immune-brain/.claude-plugin/plugin.json", "{\"name\":\"immune-brain\"}\n");
	write(root, BUNDLE, "// the build before the batch\n");
	for (const task_id of ["a", "b", "c"]) write(root, `docs/plans/${task_id}.intent.json`, JSON.stringify({
		contract: "assurance_kernel/task_intent/v1", task_id, owner: "user", goal: `deliver ${task_id}`,
		acceptance: [{ id: "AC1", assertion: "works", verification: "bun -e 'process.exit(0)'" }],
		scope_hint: task_id === "a" ? ["plugins/**"] : [`${task_id}.txt`], risk: "material", revision: 1,
	}));
	git(root, "add", "-A"); git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	git(root, "branch", "imm/reload");
	const children = ["a", "b", "c"].map((task_id, i) => {
		const read = readTaskIntent(root, task_id);
		return { task_id, slice_id: `S${i + 1}`, status: "enrollable" as const, reason: null, blocked_by: [],
			intent_path: read.intent_ref.path, intent_revision: 1, intent_content_hash: read.content_hash };
	});
	const binding = { batch_id: "reload-batch", initiative_slug: "reload", plan_digest: computeBatchPlanDigest(children),
		branch: "refs/heads/imm/reload", base_head: base, budget: { max_children: 3, qa_failure_limit: 2 },
		actor_id: "user", confirmation_ref: "confirmation", nonce: "nonce" };
	const record = prepareBatchLaneRunState({ ...binding, children, confirmation_time: BEFORE, now: BEFORE, max_parallel: 2 });
	record.batch_state = "running";

	// c is in flight in its own Lane.
	const laneC = createLaneWorktree(root, "reload", "c", base);
	const readC = readTaskIntent(laneC, "c");
	const seeded = seedKernelRunForTest(laneC, { task_id: "c", record: { contract: "assurance_kernel/task_record/v4", task_id: "c",
		intent_snapshot: readC.intent, intent_ref: { path: readC.intent_ref.path, content_hash: readC.content_hash }, lifecycle: "active",
		artifact_state: "active", baseline: readC.content_hash, git_base_head: base, attestations: [], history: [], findings: [] } });

	// a integrated a commit that changed the generated bundle, with its settled audit.
	const intentA = readTaskIntent(root, "a");
	git(root, "checkout", "-q", "imm/reload");
	write(root, BUNDLE, integrated === "equal" ? LOADED : "// a build no Host has loaded\n");
	const audit = { contract: "assurance_kernel/task_record/v4", task_id: "a", intent_snapshot: intentA.intent,
		intent_ref: { path: intentA.intent_ref.path, content_hash: intentA.content_hash }, lifecycle: "done", artifact_state: "frozen",
		baseline: intentA.content_hash, git_base_head: base, attestations: [], findings: [], history: [] };
	const bytes = JSON.stringify(audit, null, 2) + "\n";
	write(root, ".imm/audit/a/task-record.json", bytes);
	write(root, ".imm/audit/a/terminal-proof.json", JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: "a", lifecycle_status: "terminal",
		terminal_lifecycle: "done", terminal_event_id: "evt-a", final_record_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, terminalized_at: BEFORE }));
	git(root, "add", "-A"); git(root, "commit", "-qm", "integrate a");
	const commit = git(root, "rev-parse", "HEAD");
	git(root, "checkout", "-q", "main");

	record.commits = [commit];
	record.children = record.children.map(c => c.task_id === "a"
		? { ...c, state: "integrated", commit, lane: { path: join(root, ".git/imm/worktrees/reload/a"), branch: "imm-lane/reload/a", base_head: base, lane_commit: commit } }
		: c.task_id === "c"
			? { ...c, state: "enrolled", lane: { path: laneC, branch: "imm-lane/reload/c", base_head: base, lane_commit: null, run_id: seeded.run_id } }
			: c);
	writeBatchLaneRunState(root, record);
	function input(confirmation_time = NOW, existing: BatchLaneRunStateRecord = record): StartBatchInput {
		const registry = createBatchAuthorityRegistry();
		const capability = registry.issue(binding, children, confirmation_time);
		const kernel = createBatchKernelPort({ root, enrollmentRegistry: createEnrollmentAuthorityRegistry(), registry, capability, binding,
			advanceTask: async () => { throw new Error("unfrozen children belong to their Executor"); },
			resume: { isResuming: true, existingBatch: existing, batchBranch: binding.branch } });
		return { root, ...binding, registry, capability, children, kernel, confirmation_time, now: confirmation_time, max_parallel: 2 };
	}
	return { root, record, commit, laneC, runC: seeded.run_id, input };
}

const laneB = (root: string) => join(root, ".git/imm/worktrees/reload/b");

test("an integrated build change creates no Lane for pending b, pauses naming the commit and keeps c running", async () => {
	const fx = fixture("differs");
	const report = await runLaneBatch(fx.input(), fx.record);
	expect(report.batch_state).toBe("needs_human");
	expect(report.reason).toContain("runtime_reload_required");
	expect(report.reason).toContain(fx.commit);
	expect(existsSync(laneB(fx.root))).toBe(false);
	const b = report.children.find(c => c.task_id === "b")!;
	expect(b.state).toBe("pending");
	expect(report.children.find(c => c.task_id === "c")).toMatchObject({ state: "enrolled", lane: { run_id: fx.runC } });
	expect(report.handoffs).toContainEqual(expect.objectContaining({ role: "executor", task_id: "c", lane_path: fx.laneC }));
	expect(localRunId(fx.laneC, "c")).toBe(fx.runC);
	expect(readBatchLaneRunState(fx.root, fx.record.batch_id)!.children.find(c => c.task_id === "b")!.runtime_reload).toEqual({ commit: fx.commit, parent_bundle: expect.stringMatching(/^sha256:/), state: "required" });
});

for (const integrated of ["equal", "not_plugin_source"] as const) test(`${integrated === "equal" ? "an equal build" : "a repository that is not the plugin source"} admits b without a pause`, async () => {
	const fx = fixture(integrated);
	const report = await runLaneBatch(fx.input(), fx.record);
	expect(report.batch_state).toBe("running");
	expect(report.children.find(c => c.task_id === "b")!.state).toBe("enrolled");
	expect(report.children.find(c => c.task_id === "b")!.runtime_skew_acknowledged).toBeUndefined();
	expect(readBatchLaneRunState(fx.root, fx.record.batch_id)!.children.find(c => c.task_id === "b")!.runtime_reload).toBeUndefined();
});

test("a resume without a fresh confirmation keeps the pause", async () => {
	const fx = fixture();
	await runLaneBatch(fx.input(), fx.record);
	const again = await runLaneBatch(fx.input(BEFORE), readBatchLaneRunState(fx.root, fx.record.batch_id)!);
	expect(again.batch_state).toBe("needs_human");
	expect(again.reason).toContain("fresh literal-user confirmation");
	expect(existsSync(laneB(fx.root))).toBe(false);
});

test("a fresh resume while the build still differs admits pending b with runtime_skew_acknowledged", async () => {
	const fx = fixture("differs");
	await runLaneBatch(fx.input(), fx.record);
	const paused = readBatchLaneRunState(fx.root, fx.record.batch_id)!;
	const resumed = await runLaneBatch(fx.input(LATER, paused), paused);
	expect(resumed.batch_state).toBe("running");
	const b = resumed.children.find(c => c.task_id === "b")!;
	expect(b.state).toBe("enrolled");
	expect(git(laneB(fx.root), "rev-parse", "HEAD")).toBe(fx.commit);
	expect(b.runtime_skew_acknowledged).toEqual({ commit: fx.commit, parent_bundle: paused.children.find(c => c.task_id === "b")!.runtime_reload!.parent_bundle,
		loaded_bundle: `sha256:${createHash("sha256").update(LOADED).digest("hex")}` });
	expect(readBatchLaneRunState(fx.root, fx.record.batch_id)!.children.find(c => c.task_id === "b")!.runtime_reload?.state).toBe("acknowledged");
});

test("a fresh resume once the Parent tip build equals the loaded build records no acknowledgement", async () => {
	const fx = fixture();
	await runLaneBatch(fx.input(), fx.record);
	const paused = readBatchLaneRunState(fx.root, fx.record.batch_id)!;
	// The loaded build caught up with the Parent tip (stands in for a Host reload).
	git(fx.root, "checkout", "-q", "imm/reload");
	write(fx.root, BUNDLE, LOADED);
	git(fx.root, "commit", "-qam", "loaded build");
	const head = git(fx.root, "rev-parse", "HEAD");
	git(fx.root, "checkout", "-q", "main");
	paused.commits = [...paused.commits, head];
	writeBatchLaneRunState(fx.root, paused);
	const resumed = await runLaneBatch(fx.input(LATER, paused), paused);
	expect(resumed.batch_state).toBe("running");
	const b = resumed.children.find(c => c.task_id === "b")!;
	expect(b.state).toBe("enrolled");
	expect(b.runtime_skew_acknowledged).toBeUndefined();
});
