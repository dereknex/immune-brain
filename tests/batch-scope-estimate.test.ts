import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureReviewManifest } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import { buildSnapshot } from "../plugins/immune-brain/runtime/assurance/verdict_authority";
import { runDeterministicQa } from "../plugins/immune-brain/runtime/assurance/qa";
import { parseTaskIntentV1, canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordRaw, recoverKernelStoreFollowUps } from "../plugins/immune-brain/runtime/kernel/storage";
import { readRunRowByTask, readWorkspaceRow, updateRunTerminal, withKernelTransaction, writeWorkspaceRow } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { commitBatchChild, lookupBatchCommit } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { integrateGuardedLaneCommit } from "../plugins/immune-brain/runtime/unattended/batch_integration";
import { createLaneWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";
import { captureGitTaskRevisionSnapshot, taskDeliveryIdentity, taskDiffHash, writeEnrollmentBaseline } from "../plugins/immune-brain/runtime/workspace_scope";
import { parseVerificationDescriptor } from "../plugins/immune-brain/runtime/verification_descriptor";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fixture(script = "if(require('node:fs').readFileSync('outside.txt','utf8')!=='delivered')process.exit(1)") {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "scope-estimate-")));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(root, "outside.txt"), "base");
	writeFileSync(join(root, "deleted.txt"), "delete me");
	const verification = JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", script], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] } });
	const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: "child", owner: "user",
		goal: "deliver a branch beyond its estimate", scope_hint: ["estimated.txt"], risk: "material", revision: 1,
		acceptance: [{ id: "AC1", assertion: "outside.txt is delivered", verification }] });
	writeFileSync(join(root, "docs/plans/child.intent.json"), JSON.stringify(intent));
	git(root, "add", "-A"); git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	git(root, "update-ref", "refs/heads/imm/estimate", base);
	const lane = createLaneWorktree(root, "estimate", "child", base);
	writeEnrollmentBaseline(lane);
	const intentHash = canonicalIntentHash(intent);
	const record = { contract: "assurance_kernel/task_record/v4", task_id: "child", intent_snapshot: intent,
		intent_ref: { path: "docs/plans/child.intent.json", content_hash: intentHash }, lifecycle: "active", artifact_state: "frozen",
		baseline: intentHash, git_base_head: base, findings: [], attestations: [], history: [] };
	seedKernelRunForTest(lane, { task_id: "child", record });
	const deliver = (committed: boolean) => {
		writeFileSync(join(lane, "outside.txt"), "delivered");
		writeFileSync(join(lane, "added.txt"), "new");
		rmSync(join(lane, "deleted.txt"));
		git(lane, "add", "--", "outside.txt", "added.txt", "deleted.txt");
		if (committed) git(lane, "commit", "-qm", "implementation");
	};
	const snapshot = () => buildSnapshot({ root: lane, task_id: "child", role: "qa", record_revision: "record", workspace_revision: "workspace",
		intent_revision: 1, intent_content_hash: intentHash, diff_hash: taskDeliveryIdentity(lane, record).diff_hash,
		lifecycle: "active", artifact_state: "frozen", acceptance: intent.acceptance, fresh_acceptance_ids: [], missing_acceptance_ids: ["AC1"], stale_attestation_ids: [] });
	const qa = () => runDeterministicQa(snapshot(), new Map([["AC1", parseVerificationDescriptor(verification)]]));
	const settle = () => {
		const current = readTaskRecordRaw(lane, "child").record!;
		const bytes = `${JSON.stringify({ ...current, lifecycle: "done", attestations: [{ id: "qa", kind: "qa", authority_role: "qa", task_revision: 1,
			intent_content_hash: intentHash, diff_hash: snapshot().diff_hash, actor_id: "qa", summary: "passed",
			acceptance_results: [{ acceptance_id: "AC1", status: "passed", summary: "passed" }] }] })}\n`;
		withKernelTransaction(lane, db => {
			const run = readRunRowByTask(db, "child")!;
			const proof = JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: "child", lifecycle_status: "terminal", terminal_lifecycle: "done",
				terminal_event_id: `terminal-${run.run_id}`, final_record_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, terminalized_at: "2026-10-20T00:00:00.000Z" });
			updateRunTerminal(db, run.run_id, "done", bytes, proof, "2026-10-20T00:00:00.000Z");
			writeWorkspaceRow(db, readWorkspaceRow(db).revision, null, "2026-10-20T00:00:00.000Z");
		});
		recoverKernelStoreFollowUps(lane, "child");
	};
	return { root, lane, base, intent, deliver, snapshot, qa, settle };
}

describe("Lane branch delivery with scope estimates", () => {
	for (const committed of [false, true]) test(`AC1/AC2: reviews, settles and integrates the complete ${committed ? "committed" : "staged"} Lane delta`, async () => {
		const fx = fixture(); fx.deliver(committed);
		const identity = fx.snapshot().diff_hash;
		const hash = taskDiffHash(fx.lane, fx.intent.scope_hint, "child");
		// Coordinator edits, including a staged file matching the estimate, are never child work.
		writeFileSync(join(fx.root, "estimated.txt"), "coordinator only");
		git(fx.root, "add", "--", "estimated.txt");
		writeFileSync(join(fx.root, "outside.txt"), "coordinator dirt");
		expect(fx.snapshot().diff_hash).toBe(identity);
		expect(taskDiffHash(fx.lane, fx.intent.scope_hint, "child")).toBe(hash);
		const manifest = captureReviewManifest(fx.lane, { taskId: "child", baseHead: fx.base, scopeHint: fx.intent.scope_hint,
			expectedDiffHash: identity, intentRevision: 1, intentContentHash: canonicalIntentHash(fx.intent), recordRevision: "record", workspaceRevision: "workspace",
			lifecycle: "active", artifactState: "frozen", risk: "material", outcomes: {} });
		expect(Object.keys(manifest.changed_paths)).toEqual(["added.txt", "deleted.txt", "outside.txt"]);
		expect(manifest.beyond_estimate).toEqual(["added.txt", "deleted.txt", "outside.txt"]);
		expect((await fx.qa()).decision).toBe("pass");
		fx.settle();
		const delivered = await commitBatchChild({ root: fx.lane, taskId: "child", batchId: "estimate", expectedHead: fx.base, branch: "imm-lane/estimate/child" });
		expect((await lookupBatchCommit({ root: fx.lane, taskId: "child", batchId: "estimate", expectedHead: fx.base, branch: "imm-lane/estimate/child" }))?.commit).toBe(delivered.commit);
		expect(fx.snapshot().diff_hash).toBe(identity);
		expect(taskDiffHash(fx.lane, fx.intent.scope_hint, "child")).toBe(hash);
		expect(git(fx.lane, "status", "--porcelain")).toBe("");
		const integrated = await integrateGuardedLaneCommit({ root: fx.root, branch: "refs/heads/imm/estimate", batch_head: fx.base,
			lane_base: fx.base, lane_commit: delivered.commit, child: { task_id: "child", intent_path: "docs/plans/child.intent.json" }, siblings: [] });
		expect(git(fx.root, "show", `${integrated.commit}:outside.txt`)).toBe("delivered");
		expect(git(fx.root, "diff", "--name-only", fx.base, integrated.commit)).not.toContain("estimated.txt");
		expect(readFileSync(join(fx.root, "outside.txt"), "utf8")).toBe("coordinator dirt");
		expect(git(fx.root, "rev-parse", "HEAD")).toBe(fx.base);
	}, 30000);

	test("AC2: QA detects tracked drift on a delivered file outside the estimate", async () => {
		const fx = fixture("require('node:fs').writeFileSync('outside.txt','changed by QA')"); fx.deliver(true);
		await expect(fx.qa()).rejects.toMatchObject({ reason: "protected_input_or_output_drift" });
	});

	for (const committed of [false, true]) test(`AC2: QA rejects recreation of a ${committed ? "committed" : "staged"} deleted delivery path`, async () => {
		const fx = fixture("require('node:fs').writeFileSync('deleted.txt','resurrected by QA')"); fx.deliver(committed);
		await expect(fx.qa()).rejects.toMatchObject({ reason: "protected_input_or_output_drift" });
	});

	test("AC2: QA ignores a tracked file outside the branch delta", async () => {
		const fx = fixture("require('node:fs').writeFileSync('.gitignore','.imm/state/\\n# environment\\n')"); fx.deliver(true);
		expect((await fx.qa()).decision).toBe("pass");
	});

	for (const committed of [false, true]) for (const window of ["before-ref", "before-index"] as const)
	test(`recovers ${window} interruption with ${committed ? "committed" : "staged"} implementation`, async () => {
		const fx = fixture(); fx.deliver(committed);
		expect((await fx.qa()).decision).toBe("pass"); fx.settle();
		const oldHead = git(fx.lane, "rev-parse", "HEAD");
		const oldIndex = git(fx.lane, "write-tree");
		const request = { root: fx.lane, taskId: "child", batchId: "estimate", expectedHead: fx.base, branch: "imm-lane/estimate/child" };
		const produced = await commitBatchChild(request);
		// Recreate the durable state at each interrupted write boundary.
		if (window === "before-ref") git(fx.lane, "update-ref", "HEAD", oldHead, produced.commit);
		git(fx.lane, "read-tree", oldIndex);
		expect(await lookupBatchCommit(request)).toEqual(produced);
		expect(git(fx.lane, "rev-parse", "HEAD")).toBe(produced.commit);
		expect(git(fx.lane, "status", "--porcelain")).toBe("");
		expect(await lookupBatchCommit(request)).toEqual(produced);
	}, 30000);

	for (const mutation of ["delivery", "head"] as const)
	test(`interrupted commit refuses changed ${mutation} without overwriting it`, async () => {
		const fx = fixture(); fx.deliver(true);
		expect((await fx.qa()).decision).toBe("pass"); fx.settle();
		const oldHead = git(fx.lane, "rev-parse", "HEAD");
		const oldIndex = git(fx.lane, "write-tree");
		const request = { root: fx.lane, taskId: "child", batchId: "estimate", expectedHead: fx.base, branch: "imm-lane/estimate/child" };
		const produced = await commitBatchChild(request);
		git(fx.lane, "update-ref", "HEAD", oldHead, produced.commit); git(fx.lane, "read-tree", oldIndex);
		if (mutation === "head") git(fx.lane, "commit", "--allow-empty", "-qm", "unexpected commit");
		else { writeFileSync(join(fx.lane, "outside.txt"), "keep changed bytes"); git(fx.lane, "add", "--", "outside.txt"); }
		const head = git(fx.lane, "rev-parse", "HEAD"), index = git(fx.lane, "write-tree");
		await expect(lookupBatchCommit(request)).rejects.toThrow(mutation === "head" ? "diverged" : "drifted");
		expect(git(fx.lane, "rev-parse", "HEAD")).toBe(head);
		expect(git(fx.lane, "write-tree")).toBe(index);
	});

	test("settlement refuses a changed beyond-estimate delivery after QA", async () => {
		const fx = fixture(); fx.deliver(true);
		expect((await fx.qa()).decision).toBe("pass");
		fx.settle();
		writeFileSync(join(fx.lane, "outside.txt"), "changed after QA");
		git(fx.lane, "add", "--", "outside.txt");
		const head = git(fx.lane, "rev-parse", "HEAD");
		await expect(commitBatchChild({ root: fx.lane, taskId: "child", batchId: "estimate", expectedHead: fx.base, branch: "imm-lane/estimate/child" }))
			.rejects.toThrow("drifted from the reviewed delivery");
		expect(git(fx.lane, "rev-parse", "HEAD")).toBe(head);
		expect(readFileSync(join(fx.lane, "outside.txt"), "utf8")).toBe("changed after QA");
	});

	test("rejects unstaged delivery changes before recording a snapshot", () => {
		const fx = fixture(); fx.deliver(true);
		writeFileSync(join(fx.lane, "outside.txt"), "not frozen");
		expect(() => captureGitTaskRevisionSnapshot(fx.lane, fx.intent.scope_hint, fx.base, "child")).toThrow(/unstaged/);
	});
});
