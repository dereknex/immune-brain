import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	observeNativeParent, advanceNativeParent, observeParentCompletion, integrateSettledCriticalSlices,
	runBatchGitPreflight,
	commitBatchChild,
	lookupBatchCommit,
	createDefaultBatchGitPort,
	classifyBatchLineage,
	type NativeParentEffects, type NativeParentGate,
} from "../plugins/immune-brain/runtime/unattended/batch_git";
import { batchRefName } from "../plugins/immune-brain/runtime/unattended/batch_ref";
import { integrateLaneCommit } from "../plugins/immune-brain/runtime/unattended/batch_integration";
import { runFinalVerification } from "../plugins/immune-brain/runtime/unattended/batch_final_verification";
import { expectedBatchHead } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import {
	startBatch, completedParentReport,
	resumeBatch,
	type BatchRunnerKernelPort,
	type StartBatchInput,
} from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { prepareBatchLaneRunState, writeBatchLaneRunState, readBatchRunState, prepareBatchRunState, writeBatchRunState, writeBatchRunReport } from "../plugins/immune-brain/runtime/unattended/batch_state";
import {
	createBatchAuthorityRegistry,
	computeBatchPlanDigest,
} from "../plugins/immune-brain/runtime/kernel/batch_authority";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import { readAuditTaskPair, recoverKernelStoreFollowUps, readSettledTaskEvidence, revisionForContent } from "../plugins/immune-brain/runtime/kernel/storage";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

// Commit-safety fixtures script settlement; explicitly model Parent-ready turns.
async function finishScriptedHandoffs(input: StartBatchInput, report: Awaited<ReturnType<typeof startBatch>>) {
	for (let turns = 0; report.handoff && turns < input.children.length; turns++) {
		const taskId = report.handoff.task_id;
		const owns = input.kernel.ownsTaskClaim.bind(input.kernel);
		input.kernel.ownsTaskClaim = (id) => id === taskId || owns(id);
		const project = input.kernel.projectTask.bind(input.kernel);
		input.kernel.projectTask = async (root, id) => {
			const fresh = await project(root, id);
			return id === taskId ? { ...fresh, claim: { task_id: id, lifecycle_status: "active" },
				projection: { ...fresh.projection, lifecycle: "active", artifact_state: "frozen" } } as typeof fresh : fresh;
		};
		report = await startBatch(input);
	}
	expect(report.handoff).toBeUndefined();
	return report;
}

// Synthetic commit fixtures have no matching current Kernel run authority.
// Real settlement/adoption is covered by both public Hosts in batch-plan-reconfirmation.test.ts.
async function expectProvenanceRefusal(input: StartBatchInput): Promise<void> {
	const capture = () => ({
		state: readFileSync(join(input.root, ".imm/state/batches", `${input.batch_id}.json`)),
		index: readFileSync(join(input.root, ".git/index")),
		head: git(input.root, ["rev-parse", "HEAD"]),
	});
	const before = capture();
	await expect(resumeBatch(input, input.kernel.projectTask.bind(input.kernel))).rejects.toThrow("provenance");
	expect(capture()).toEqual(before);
}

const CONFIRMATION_TIME = "2026-01-01T00:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function git(root: string, args: string[]): string {
	const res = spawnSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	if (res.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
	}
	return res.stdout.trim();
}

function initGitRepo(): { root: string; baseHead: string } {
	const root = mkdtempSync(join(tmpdir(), "batch-commit-test-"));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.name", "Test"]);
	git(root, ["config", "user.email", "test@example.com"]);

	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	git(root, ["add", ".gitignore"]);
	git(root, ["commit", "-m", "initial commit"]);
	const baseHead = git(root, ["rev-parse", "HEAD"]);
	return { root, baseHead };
}

function writeChildAudit(
	root: string,
	taskId: string,
	lifecycle = "done",
	baseHead = "b".repeat(40),
	intentOverride?: Record<string, unknown>,
): void {
	const auditDir = join(root, ".imm", "audit", taskId);
	mkdirSync(auditDir, { recursive: true });
	const rawIntent = intentOverride ?? {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `Goal for ${taskId}`,
		scope_hint: [`src/${taskId}.ts`],
		acceptance: [
			{
				id: `acc-${taskId}`,
				assertion: "assert something",
				verification: "bun test",
			},
		],
		risk: "material",
		revision: 1,
	};
	const intent = parseTaskIntentV1(rawIntent);
	const intentHash = canonicalIntentHash(intent);
	const record = {
		contract: "assurance_kernel/task_record/v4",
		task_id: taskId,
		intent_snapshot: intent,
		intent_ref: {
			path: `docs/plans/archive/${taskId}.intent.json`,
			content_hash: intentHash,
		},
		lifecycle,
		artifact_state: "frozen",
		baseline: intentHash,
		git_base_head: baseHead,
		attestations: [],
		findings: [],
		history: [],
	};
	const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
	writeFileSync(join(auditDir, "task-record.json"), recordBytes);
	const recordHash = new Bun.CryptoHasher("sha256").update(recordBytes).digest("hex");
	const proof = {
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: taskId,
		lifecycle_status: "terminal",
		terminal_lifecycle: lifecycle,
		terminal_event_id: `evt-term-${taskId}`,
		final_record_hash: `sha256:${recordHash}`,
		terminalized_at: new Date().toISOString(),
	};
	writeFileSync(join(auditDir, "terminal-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
}

function writeTaskIntent(
	root: string,
	taskId: string,
	goal: string,
	scopeHint: string[],
): string {
	const plansDir = join(root, "docs", "plans");
	mkdirSync(plansDir, { recursive: true });
	const intentPath = `docs/plans/${taskId}.intent.json`;
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal,
		scope_hint: scopeHint,
		acceptance: [
			{
				id: `acc-${taskId}`,
				assertion: "assert something",
				verification: "bun test",
			},
		],
		risk: "material",
		revision: 1,
	};
	writeFileSync(join(root, intentPath), `${JSON.stringify(intent, null, 2)}\n`);
	return intentPath;
}

describe("Lane Parent delivery proof", () => {
	it("proves replayed Lane production on the coordinator and rejects mismatched candidates or missing producer evidence", async () => {
		const repo = initGitRepo(); const lane = `${repo.root}-lane`;
		try {
			const taskId = "lane-child", paths = [`src/${taskId}.ts`, `docs/plans/${taskId}.intent.json`, `docs/plans/archive/${taskId}.intent.json`];
			writeTaskIntent(repo.root, taskId, "Lane delivery", paths);
			const intent = JSON.parse(readFileSync(join(repo.root, paths[1]!), "utf8"));
			mkdirSync(join(repo.root, "docs/plans/archive")); writeFileSync(join(repo.root, paths[2]!), JSON.stringify(intent));
			git(repo.root, ["add", "docs"]); git(repo.root, ["commit", "-m", "plan"]);
			const base = git(repo.root, ["rev-parse", "HEAD"]);
			git(repo.root, ["worktree", "add", "-b", "lane", lane, base]);
			writeChildAudit(lane, taskId, "done", base, intent);
			mkdirSync(join(lane, "src")); writeFileSync(join(lane, paths[0]!), "export const delivered = true;\n");
			const produced = await commitBatchChild({ root: lane, taskId, batchId: "lane-proof", expectedHead: base, branch: "lane" });
			writeFileSync(join(repo.root, "sibling.txt"), "independent\n"); git(repo.root, ["add", "sibling.txt"]); git(repo.root, ["commit", "-m", "independent delivery"]);
			const predecessor = git(repo.root, ["rev-parse", "HEAD"]);
			const landed = integrateLaneCommit({ root: repo.root, branch: "main", batch_head: predecessor, lane_base: base, lane_commit: produced.commit });
			expect(landed.commit).not.toBe(produced.commit);
			const now = new Date().toISOString();
			const record = prepareBatchLaneRunState({ batch_id: "lane-proof", initiative_slug: "lane-parent", base_head: base, branch: "main",
				plan_digest: `sha256:${"c".repeat(64)}`, confirmation_time: now, now, max_parallel: 2,
				budget: { max_children: 1, qa_failure_limit: 2 }, children: [{ task_id: taskId, slice_id: "S1", blocked_by: [], status: "enrollable",
					risk: "material", intent_path: paths[1]!, intent_revision: 1, intent_content_hash: canonicalIntentHash(parseTaskIntentV1(intent)), scope_hint: paths, reason: null, exclusion: null }] });
			record.batch_state = "completed"; record.children[0]!.state = "integrated"; record.children[0]!.commit = landed.commit;
			record.children[0]!.lane = { path: lane, branch: "lane", base_head: base, lane_commit: produced.commit };
			record.commits = [landed.commit]; record.final_verification_result = await runFinalVerification(repo.root, ["bun --version"]);
			writeBatchLaneRunState(repo.root, record);
			expect((await observeParentCompletion(repo.root, "lane-parent", [taskId])).complete).toBe(true);
			// Settlement is delivery (content-delivery-authority D1): commit candidates and producer files are not authority.
			record.children[0]!.commit = predecessor; record.commits = [predecessor]; writeBatchLaneRunState(repo.root, record);
			rmSync(join(lane, ".imm/state/batches/commits"), { recursive: true });
			expect((await observeParentCompletion(repo.root, "lane-parent", [taskId])).complete).toBe(true);
		} finally { rmSync(repo.root, { recursive: true, force: true }); rmSync(lane, { recursive: true, force: true }); }
	});
});

describe("native Parent completion without ordinary grants", () => {
	function seedParentHistory(root: string, base: string, intent: Record<string, unknown>, paths: string[],
		state: ReturnType<typeof prepareBatchRunState>["batch_state"] = "superseded") {
		const now = new Date().toISOString();
		const record = prepareBatchRunState({ batch_id: "prior-parent", initiative_slug: "native-parent", base_head: base,
			branch: "main", plan_digest: `sha256:${"c".repeat(64)}`, confirmation_time: now, now,
			budget: { max_children: 1, qa_failure_limit: 2 }, children: [{ task_id: "delivered", slice_id: "S1", blocked_by: [],
				status: "already_settled", risk: "material", intent_path: "docs/plans/delivered.intent.json", intent_revision: 1,
				intent_content_hash: canonicalIntentHash(parseTaskIntentV1(intent)), scope_hint: paths, reason: null, exclusion: null }] });
		record.batch_state = state;
		if (state === "completed") {
			record.children[0]!.state = "committed"; record.children[0]!.commit = base; record.commits = [base];
		}
		writeBatchRunState(root, record);
		if (state === "superseded") writeBatchRunReport(root, { contract: "assurance_kernel/batch_run_report/v1", batch_id: record.batch_id,
			initiative_slug: record.initiative_slug, batch_state: state, children: record.children, commits: record.commits,
			reason: "retired after plan revision", next_action: "preserve settled children", created_at: now });
		return () => readdirSync(join(root, ".imm/state/batches")).filter(name => name.startsWith("prior-parent.")).sort()
			.map(name => [name, readFileSync(join(root, ".imm/state/batches", name))]);
	}
	it.each(["fast_forward", "diverged", "wrong_branch"])("checks native Enrollment precondition lineage: %s", async (movement) => {
		const repo = initGitRepo();
		try {
			const now = new Date().toISOString();
			const batch = prepareBatchRunState({ batch_id: "native-lineage", initiative_slug: "native-parent", base_head: repo.baseHead,
				branch: "main", plan_digest: `sha256:${"c".repeat(64)}`, confirmation_time: now, now,
				budget: { max_children: 1, qa_failure_limit: 2 }, children: [{ task_id: "ordinary", slice_id: "S2", blocked_by: ["critical"],
					status: "enrollable", risk: "material", intent_path: "docs/plans/ordinary.intent.json", intent_revision: 1,
					intent_content_hash: `sha256:${"d".repeat(64)}`, scope_hint: ["src/ordinary.ts"], reason: null, exclusion: null }] });
			batch.batch_state = "running"; writeBatchRunState(repo.root, batch);
			const paths = ["src/critical.ts", "docs/plans/critical.intent.json", "docs/plans/archive/critical.intent.json"];
			writeTaskIntent(repo.root, "critical", "Goal for critical", paths);
			const intent = JSON.parse(readFileSync(join(repo.root, paths[1]!), "utf8")); intent.risk = "critical";
			writeFileSync(join(repo.root, paths[1]!), JSON.stringify(intent)); mkdirSync(join(repo.root, "docs/plans/archive"));
			writeFileSync(join(repo.root, paths[2]!), JSON.stringify(intent));
			git(repo.root, ["add", "docs/plans"]); git(repo.root, ["commit", "-m", "chore(imm): commit Enrollment preconditions for critical"]);
			const enrolledHead = git(repo.root, ["rev-parse", "HEAD"]);
			writeChildAudit(repo.root, "critical", "done", enrolledHead, intent);
			mkdirSync(join(repo.root, "src")); writeFileSync(join(repo.root, paths[0]!), "export const critical = true;\n");
			if (movement === "diverged") {
				git(repo.root, ["checkout", "--orphan", "unrelated"]); git(repo.root, ["add", "docs/plans"]); git(repo.root, ["commit", "-m", "unrelated history"]);
			} else if (movement === "wrong_branch") git(repo.root, ["checkout", "-b", "other"]);
			const reader = async () => ({ initiative_slug: "native-parent", carrier: "local" as const, tasks: [{ task_id: "critical", slice_id: "S1", blocked_by: [] }] });
			if (movement !== "fast_forward") {
				const before = readFileSync(join(repo.root, ".imm/state/batches/native-lineage.json"));
				await expect(integrateSettledCriticalSlices(repo.root, "native-parent", reader)).rejects.toThrow("batch_head_lineage_broken");
				expect(readFileSync(join(repo.root, ".imm/state/batches/native-lineage.json"))).toEqual(before);
			} else {
				await integrateSettledCriticalSlices(repo.root, "native-parent", reader);
				const stored = readBatchRunState(repo.root, "native-lineage")!;
				expect(stored.adopted_heads?.[0]).toEqual({ from: repo.baseHead, to: enrolledHead });
				expect(expectedBatchHead(stored)).toBe(git(repo.root, ["rev-parse", "HEAD"]));
				expect(await lookupBatchCommit({ root: repo.root, taskId: "critical", batchId: "native-lineage.critical", branch: "main" })).not.toBeNull();
			}
		} finally { rmSync(repo.root, { recursive: true, force: true }); }
	});
	it("routes a critical-only Parent directly to one native task gate", async () => {
		const repo = initGitRepo();
		try {
			writeTaskIntent(repo.root, "critical", "Goal for critical", ["src/critical.ts"]);
			const path = join(repo.root, "docs/plans/critical.intent.json");
			const intent = JSON.parse(readFileSync(path, "utf8")); intent.risk = "critical";
			writeFileSync(path, JSON.stringify(intent)); git(repo.root, ["add", "docs/plans"]); git(repo.root, ["commit", "-m", "plan"]);
			const reader = async () => ({ initiative_slug: "native-parent", carrier: "local" as const, tasks: [
				{ task_id: "critical", slice_id: "S1", blocked_by: [] },
			] });
			const before = git(repo.root, ["rev-parse", "HEAD"]);
			const result = await advanceNativeParent(repo.root, "native-parent", ["bun --version"], reader);
			expect(result).toMatchObject({ state: "native_parent", batch_id: null, action: "enroll", task_id: "critical" });
			expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(before);
			expect(readBatchRunState(repo.root, "native-parent")).toBeNull();
		} finally { rmSync(repo.root, { recursive: true, force: true }); }
	});
	it.each([
		{ history: false, command: "bun --version", passed: true },
		{ history: true, command: "bun --version", passed: true },
		{ history: true, command: "bun -e process.exitCode=7", passed: false },
	])("verifies and replays delivered-only Parent without a commit: history=$history, passed=$passed", async ({ history, command, passed }) => {
		const repo = initGitRepo();
		try {
			const paths = ["src/delivered.ts", "docs/plans/delivered.intent.json", "docs/plans/archive/delivered.intent.json"];
			writeTaskIntent(repo.root, "delivered", "Goal for delivered", paths);
			const intent = JSON.parse(readFileSync(join(repo.root, "docs/plans/delivered.intent.json"), "utf8"));
			mkdirSync(join(repo.root, "docs/plans/archive"));
			writeFileSync(join(repo.root, "docs/plans/archive/delivered.intent.json"), JSON.stringify(intent));
			git(repo.root, ["add", "docs/plans"]); git(repo.root, ["commit", "-m", "plan"]);
			const baseline = git(repo.root, ["rev-parse", "HEAD"]);
			writeChildAudit(repo.root, "delivered", "done", baseline, intent);
			mkdirSync(join(repo.root, "src")); writeFileSync(join(repo.root, "src/delivered.ts"), "export const delivered = true;\n");
			const reader = async () => ({ initiative_slug: "native-parent", carrier: "local" as const, tasks: [
				{ task_id: "delivered", slice_id: "S1", blocked_by: [] },
			] });
			const historyBytes = history ? seedParentHistory(repo.root, baseline, intent, paths) : () => [];
			const beforeHistory = historyBytes();
			const disclosed: NativeParentEffects[] = [];
			const gate: NativeParentGate = async (effects) => { disclosed.push(effects); return null; };
			const result = await advanceNativeParent(repo.root, "native-parent", [command], reader, undefined, gate);
			expect(disclosed).toEqual([{ initiative_slug: "native-parent", plan_digest: expect.stringMatching(/^sha256:/),
				children: [{ task_id: "delivered", slice_id: "S1" }], final_commands: [command] }]);
			expect(result).toMatchObject({ state: "native_parent", action: passed ? "complete" : "repair", proof: { complete: passed },
				final_verification: { passed, results: [{ command, exit_code: passed ? 0 : 7 }] } });
			expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(baseline);
			expect((await advanceNativeParent(repo.root, "native-parent", undefined, reader))?.action).toBe(passed ? "complete" : "repair");
			expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(baseline);
			expect(historyBytes()).toEqual(beforeHistory);
			expect(readBatchRunState(repo.root, "native-parent")).toBeNull();
			expect((await observeParentCompletion(repo.root, "native-parent", ["delivered"])).complete).toBe(passed);
			// The user may carry the bytes in any history; equal scoped content keeps the verification (D3).
			git(repo.root, ["checkout", "--orphan", "unrelated-history"]);
			git(repo.root, ["add", "."]); git(repo.root, ["commit", "-m", "user-owned commit of the delivered bytes"]);
			expect((await observeParentCompletion(repo.root, "native-parent", ["delivered"])).complete).toBe(passed);
		} finally { rmSync(repo.root, { recursive: true, force: true }); }
	});
	it.each([false, true].flatMap(history => [false, true].flatMap(remainingCritical =>
		[undefined, [], ["bun marker.ts"]].map(commands => ({ history, remainingCritical, commands })))))(
		"opens no Git or command effect without accepting gate (history=$history, critical=$remainingCritical, commands=$commands)", async ({ history, remainingCritical, commands }) => {
		for (const gate of [undefined, async () => ({ state: "rejected" as const, reason: "native interaction declined", recovery_action: "wait" }),
			async () => ({ state: "cancelled" as const, reason: "native interaction cancelled", recovery_action: "wait" })]) {
			const repo = initGitRepo();
			try {
				const paths = ["src/delivered.ts", "docs/plans/delivered.intent.json", "docs/plans/archive/delivered.intent.json"];
				writeTaskIntent(repo.root, "delivered", "Goal for delivered", paths);
				const intent = JSON.parse(readFileSync(join(repo.root, "docs/plans/delivered.intent.json"), "utf8"));
				mkdirSync(join(repo.root, "docs/plans/archive"));
				writeFileSync(join(repo.root, "docs/plans/archive/delivered.intent.json"), JSON.stringify(intent));
				writeFileSync(join(repo.root, "marker.ts"), "require('node:fs').writeFileSync('ran.txt', 'ran');\n");
				if (remainingCritical) {
					const criticalPath = writeTaskIntent(repo.root, "critical", "remaining critical task", ["src/critical.ts"]);
					const critical = JSON.parse(readFileSync(join(repo.root, criticalPath), "utf8"));
					critical.risk = "critical"; writeFileSync(join(repo.root, criticalPath), JSON.stringify(critical));
				}
				git(repo.root, ["add", "docs/plans", "marker.ts"]); git(repo.root, ["commit", "-m", "plan"]);
				const baseline = git(repo.root, ["rev-parse", "HEAD"]);
				writeChildAudit(repo.root, "delivered", "done", baseline, intent);
				mkdirSync(join(repo.root, "src")); writeFileSync(join(repo.root, "src/delivered.ts"), "export const delivered = true;\n");
				const reader = async () => ({ initiative_slug: "native-parent", carrier: "local" as const, tasks: [
					{ task_id: "delivered", slice_id: "S1", blocked_by: [] },
					...(remainingCritical ? [{ task_id: "critical", slice_id: "S2", blocked_by: ["delivered"] }] : []),
				] });
				const historyBytes = history ? seedParentHistory(repo.root, baseline, intent, paths) : () => [];
				const beforeHistory = historyBytes();
				const result = await advanceNativeParent(repo.root, "native-parent", commands, reader, undefined, gate);
				// Only new final commands need the native gate; settled delivery itself opens none (D2).
				if (commands?.length && !remainingCritical) expect(result).toMatchObject({ state: expect.stringMatching(/^(rejected|cancelled)$/) });
				else expect(result).toMatchObject({ state: "native_parent", action: remainingCritical ? "enroll" : "verify" });
				expect(historyBytes()).toEqual(beforeHistory);
				expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(baseline);
				expect(existsSync(join(repo.root, "ran.txt"))).toBe(false);
				expect((await observeNativeParent(repo.root, "native-parent", reader))?.native).toBeNull();
			} finally { rmSync(repo.root, { recursive: true, force: true }); }
		}
	});
	it.each(["running", "needs_human", "completed", "failed", "budget_stopped", "rejected"] as const)("retains existing batch route for %s history", async (state) => {
		const repo = initGitRepo();
		try {
			const snapshot = seedParentHistory(repo.root, repo.baseHead, {
				contract: "assurance_kernel/task_intent/v1", task_id: "delivered", owner: "user", goal: "delivered",
				scope_hint: ["src/delivered.ts"], risk: "material", revision: 1,
				acceptance: [{ id: "AC1", assertion: "delivered", verification: "bun test" }],
			}, ["src/delivered.ts"], state);
			const before = snapshot();
			const observed = await observeNativeParent(repo.root, "native-parent", async () => { throw new Error("existing batch must own routing"); });
			expect(observed).toBeNull();
			expect(snapshot()).toEqual(before);
			expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
		} finally { rmSync(repo.root, { recursive: true, force: true }); }
	});
	it("returns the current successful Parent observation while preserving the first failed terminal report", async () => {
		const repo = initGitRepo(); const previous = process.env.GDR_COMPLETION_TEST_FAILURE;
		try {
			const paths = ["src/delivered.ts", "docs/plans/delivered.intent.json", "docs/plans/archive/delivered.intent.json"];
			writeTaskIntent(repo.root, "delivered", "Goal for delivered", paths);
			const intent = JSON.parse(readFileSync(join(repo.root, "docs/plans/delivered.intent.json"), "utf8"));
			mkdirSync(join(repo.root, "docs/plans/archive")); mkdirSync(join(repo.root, "docs/initiatives"));
			writeFileSync(join(repo.root, "docs/plans/archive/delivered.intent.json"), JSON.stringify(intent));
			writeFileSync(join(repo.root, "docs/initiatives/native-parent.md"), "# Parent\n## S1: delivered\nTasks:\n- delivered\n");
			writeFileSync(join(repo.root, "verify.ts"), "process.exit(Number(process.env.GDR_COMPLETION_TEST_FAILURE ?? 0));\n");
			git(repo.root, ["add", "docs", "verify.ts"]); git(repo.root, ["commit", "-m", "plan"]);
			const baseline = git(repo.root, ["rev-parse", "HEAD"]);
			writeChildAudit(repo.root, "delivered", "done", baseline, intent);
			mkdirSync(join(repo.root, "src")); writeFileSync(join(repo.root, "src/delivered.ts"), "export const delivered = true;\n");
			const reader = async () => ({ initiative_slug: "native-parent", carrier: "local" as const,
				tasks: [{ task_id: "delivered", slice_id: "S1", blocked_by: [] }] });
			const commands = ["bun verify.ts"];
			process.env.GDR_COMPLETION_TEST_FAILURE = "1";
			const failed = await advanceNativeParent(repo.root, "native-parent", commands, reader, undefined, async () => null);
			expect(failed?.final_verification?.passed).toBe(false);
			// The user commits the settled bytes in their own way; the head-bound batch record below binds that HEAD.
			git(repo.root, ["add", "-A"]); git(repo.root, ["commit", "-m", "user commit"]);
			const head = git(repo.root, ["rev-parse", "HEAD"]); const now = new Date().toISOString();
			const batch = prepareBatchRunState({ batch_id: "completion-replay", initiative_slug: "native-parent", base_head: baseline,
				branch: "main", plan_digest: `sha256:${"c".repeat(64)}`, confirmation_time: now, now,
				budget: { max_children: 1, qa_failure_limit: 2 }, final_verification: commands,
				children: [{ task_id: "delivered", slice_id: "S1", blocked_by: [], status: "already_settled", risk: "material",
					intent_path: "docs/plans/delivered.intent.json", intent_revision: 1, intent_content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
					scope_hint: paths, reason: null, exclusion: null }] });
			batch.batch_state = "completed"; batch.children[0]!.state = "committed"; batch.children[0]!.commit = head; batch.commits = [head];
			batch.final_verification_result = failed!.final_verification!; writeBatchRunState(repo.root, batch);
			const historical = { contract: "assurance_kernel/batch_run_report/v1" as const, batch_id: batch.batch_id,
				initiative_slug: batch.initiative_slug, batch_state: batch.batch_state, children: batch.children, commits: batch.commits,
				final_verification: batch.final_verification_result, reason: "final verification failed", next_action: "repair", created_at: now };
			writeBatchRunReport(repo.root, historical);
			process.env.GDR_COMPLETION_TEST_FAILURE = "0";
			batch.final_verification_result = await runFinalVerification(repo.root, commands); writeBatchRunState(repo.root, batch);
			const current = await completedParentReport(repo.root, "native-parent", reader,
				{ markTerminal: async () => ({ status: "updated", message: "Parent closure confirmed on integrated HEAD" }) });
			expect(current?.tracker).toEqual({ status: "updated", message: "Parent closure confirmed on integrated HEAD" });
			expect(current?.final_verification?.passed).toBe(true); expect(current?.next_action).toContain("passed");
			expect(writeBatchRunReport(repo.root, historical).final_verification.passed).toBe(false);
		} finally {
			if (previous === undefined) delete process.env.GDR_COMPLETION_TEST_FAILURE; else process.env.GDR_COMPLETION_TEST_FAILURE = previous;
			rmSync(repo.root, { recursive: true, force: true });
		}
	});
});

describe("acc-batch-hidden-ref-preflight", () => {
	let repo: { root: string; baseHead: string };
	const BATCH_ID = "batch-preflight-1";
	const REF = `refs/imm/batches/${BATCH_ID}`;
	const refExists = () => spawnSync("git", ["-C", repo.root, "rev-parse", "--verify", "--quiet", REF]).status === 0;
	const preflight = (extra: { blocking_scopes?: string[] } = {}) =>
		runBatchGitPreflight({ root: repo.root, initiative_slug: "my-initiative", base_head: repo.baseHead, batch_id: BATCH_ID, ...extra });
	const userState = () => ({
		branch: git(repo.root, ["symbolic-ref", "--short", "HEAD"]),
		head: git(repo.root, ["rev-parse", "HEAD"]),
		index: readFileSync(join(repo.root, ".git", "index")).toString("hex"),
	});

	beforeEach(() => {
		repo = initGitRepo();
		writeFileSync(join(repo.root, "owned.txt"), "committed\n");
		git(repo.root, ["add", "owned.txt"]);
		git(repo.root, ["commit", "-m", "add owned"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);
	});

	afterEach(() => {
		rmSync(repo.root, { recursive: true, force: true });
	});

	it.each([
		["modified tracked files", () => writeFileSync(join(repo.root, "owned.txt"), "dirty\n")],
		["untracked non-ignored files", () => writeFileSync(join(repo.root, "owned-new.txt"), "hello")],
	])("rejects with dirty_working_tree when %s lie inside an unsettled child's scope", (_kind, dirty) => {
		dirty();
		const before = userState();
		const res = preflight({ blocking_scopes: ["owned*.txt"] });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe("dirty_working_tree");
		expect(userState()).toEqual(before);
		expect(refExists()).toBe(false);
		expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
	});

	it("treats dirt outside every unsettled child's scope as the user's own and creates the hidden ref", () => {
		writeFileSync(join(repo.root, "owned.txt"), "user's own edit\n");
		writeFileSync(join(repo.root, "scratch.txt"), "user's untracked file\n");
		const before = userState();
		const res = preflight({ blocking_scopes: ["src/**"] });
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.branch).toBe(REF);
		expect(git(repo.root, ["rev-parse", REF])).toBe(repo.baseHead);
		expect(userState()).toEqual(before);
		expect(readFileSync(join(repo.root, "owned.txt"), "utf8")).toBe("user's own edit\n");
	});

	it("Finding 2: an in-scope untracked file is still blocking when status.showUntrackedFiles=no", () => {
		git(repo.root, ["config", "status.showUntrackedFiles", "no"]);
		writeFileSync(join(repo.root, "owned-hidden.txt"), "hello");
		const res = preflight({ blocking_scopes: ["owned*.txt"] });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe("dirty_working_tree");
		expect(refExists()).toBe(false);
	});

	it.each([
		["assume-unchanged", ["--assume-unchanged"]],
		["combined assume-unchanged and skip-worktree (tag s)", ["--skip-worktree", "--assume-unchanged"]],
	])("Finding 1/2: an in-scope file carrying %s flags blocks instead of hiding dirt", (_kind, flags) => {
		for (const flag of flags) git(repo.root, ["update-index", flag, "owned.txt"]);
		const before = userState();
		const res = preflight({ blocking_scopes: ["owned.txt"] });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe("dirty_working_tree");
		expect(userState()).toEqual(before);
		expect(refExists()).toBe(false);
	});

	it("rejects with uncommitted_head when repository has zero commits", () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "empty-git-"));
		try {
			git(emptyDir, ["init", "-b", "main"]);
			const res = runBatchGitPreflight({
				root: emptyDir,
				initiative_slug: "my-initiative",
				base_head: "0".repeat(40),
				batch_id: BATCH_ID,
			});
			expect(res.ok).toBe(false);
			if (!res.ok) {
				expect(res.reason).toBe("uncommitted_head");
			}
			expect(existsSync(join(emptyDir, ".imm", "state", "batches"))).toBe(false);
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it("Finding 5: rejects with not_a_git_repository when root is not a git directory", () => {
		const nonGit = mkdtempSync(join(tmpdir(), "non-git-"));
		try {
			const res = runBatchGitPreflight({ root: nonGit, initiative_slug: "my-initiative", base_head: repo.baseHead, batch_id: BATCH_ID });
			expect(res.ok).toBe(false);
			if (!res.ok) {
				expect(res.reason).toBe("not_a_git_repository");
			}
			expect(existsSync(join(nonGit, ".imm"))).toBe(false);
		} finally {
			rmSync(nonGit, { recursive: true, force: true });
		}
	});

	it("Finding 5: rejects with not_repository_root when root is a subdirectory of a git repo", () => {
		const subDir = join(repo.root, "sub", "dir");
		mkdirSync(subDir, { recursive: true });
		const res = runBatchGitPreflight({ root: subDir, initiative_slug: "my-initiative", base_head: repo.baseHead, batch_id: BATCH_ID });
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("not_repository_root");
		}
		expect(existsSync(join(subDir, ".imm"))).toBe(false);
	});

	it("rejects with batch_branch_exists when the batch's hidden ref already holds a different commit, and accepts the same commit as a retry", () => {
		git(repo.root, ["update-ref", REF, repo.baseHead]);
		const retry = preflight();
		expect(retry.ok).toBe(true);
		git(repo.root, ["update-ref", REF, git(repo.root, ["rev-parse", "HEAD^"])]);
		const before = userState();
		const res = preflight();
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe("batch_branch_exists");
		expect(git(repo.root, ["rev-parse", REF])).toBe(git(repo.root, ["rev-parse", "HEAD^"]));
		expect(userState()).toEqual(before);
	});

	it("on passing preflight creates only the hidden ref and never checks out, commits or runs hooks", () => {
		const hooksDir = join(repo.root, ".git", "hooks");
		mkdirSync(hooksDir, { recursive: true });
		const marker = join(repo.root, "hook-ran");
		for (const hook of ["post-checkout", "pre-commit", "post-commit", "reference-transaction"]) {
			writeFileSync(join(hooksDir, hook), `#!/bin/sh\n: > "${marker}"\nexit 1\n`);
			spawnSync("chmod", ["+x", join(hooksDir, hook)]);
		}
		const before = userState();
		const res = preflight();
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.branch).toBe(REF);
		expect(git(repo.root, ["rev-parse", REF])).toBe(repo.baseHead);
		expect(userState()).toEqual(before);
		expect(existsSync(marker)).toBe(false);
		expect(() => git(repo.root, ["rev-parse", "--verify", "refs/heads/imm/my-initiative"])).toThrow();
	});
});

describe("acc-batch-scope-bounded-commit", () => {
	let repo: { root: string; baseHead: string };

	beforeEach(() => {
		repo = initGitRepo();
		git(repo.root, ["checkout", "-b", "imm/test-initiative", repo.baseHead]);
	});

	afterEach(() => {
		rmSync(repo.root, { recursive: true, force: true });
	});

	it("Finding 2: valid audit fixture passes readAuditTaskPair validation", () => {
		const taskId = "audit-valid";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);
		const pair = readAuditTaskPair(repo.root, taskId);
		expect(pair).not.toBeNull();
		expect(pair!.record.lifecycle).toBe("done");
		expect(pair!.proof.terminal_lifecycle).toBe("done");
	});

	it("Finding 2: refuses to commit if audit task record or proof is tampered with", async () => {
		const taskId = "task-tampered";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);

		// Tamper with record bytes so final_record_hash fails
		const recordFile = join(repo.root, ".imm", "audit", taskId, "task-record.json");
		writeFileSync(recordFile, '{"contract":"corrupted"}\n');

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow();

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("refuses to commit before Kernel reports child done", async () => {
		const taskId = "task-not-done";
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "foo.ts"), "code\n");

		// Case 1: no audit pair
		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/not settled done/);

		// Case 2: audit pair has lifecycle "stopped", not "done"
		writeChildAudit(repo.root, taskId, "stopped", repo.baseHead);
		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/not settled done/);

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});


	it("a settled run's export must be that run's record to commit", async () => {
		const taskId = "task-export-identity";
		const intent = parseTaskIntentV1({
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Export identity guard",
			scope_hint: ["src/feature.ts", "docs/plans/archive/task-export-identity.intent.json"],
			acceptance: [{ id: "A1", assertion: "a1", verification: "true" }],
			risk: "routine",
			revision: 1,
		});
		const record = {
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: { path: "docs/plans/archive/task-export-identity.intent.json", content_hash: canonicalIntentHash(intent) },
			lifecycle: "done",
			artifact_state: "frozen",
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: repo.baseHead,
			attestations: [],
			findings: [],
			history: [],
		};
		const seeded = seedKernelRunForTest(repo.root, { task_id: taskId, record, terminal: { lifecycle: "done" } });
		recoverKernelStoreFollowUps(repo.root, taskId);
		expect(readSettledTaskEvidence(repo.root, taskId)?.runId).toBe(seeded.run_id);

		// The export of the settled run is replaced by a locally consistent
		// stopped pair: its own revision and proof validate, but it is not this
		// run's record, so it may not decide what this commit contains.
		const runDir = join(repo.root, ".imm", "audit", taskId, seeded.run_id);
		const stopped = { ...record, lifecycle: "stopped" };
		const stoppedBytes = `${JSON.stringify(stopped, null, 2)}\n`;
		writeFileSync(join(runDir, "task-record.json"), stoppedBytes);
		writeFileSync(
			join(runDir, "terminal-proof.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/task_tombstone/v2",
					task_id: taskId,
					lifecycle_status: "terminal",
					terminal_lifecycle: "stopped",
					terminal_event_id: `stopped:${taskId}:tampered`,
					final_record_hash: revisionForContent(stoppedBytes),
					terminalized_at: "2026-08-12T10:00:00.000Z",
				},
				null,
				2,
			)}\n`,
		);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "feature.ts"), "code\n");

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-export",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/does not match the settled run/);
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("a proof-only rewrite of the exported pair is refused", async () => {
		const taskId = "task-proof-only-rewrite";
		const intent = parseTaskIntentV1({
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Proof-only rewrite guard",
			scope_hint: ["src/feature.ts", "docs/plans/archive/task-proof-only-rewrite.intent.json"],
			acceptance: [{ id: "A1", assertion: "a1", verification: "true" }],
			risk: "routine",
			revision: 1,
		});
		const record = {
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: { path: "docs/plans/archive/task-proof-only-rewrite.intent.json", content_hash: canonicalIntentHash(intent) },
			lifecycle: "done",
			artifact_state: "frozen",
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: repo.baseHead,
			attestations: [],
			findings: [],
			history: [],
		};
		const seeded = seedKernelRunForTest(repo.root, { task_id: taskId, record, terminal: { lifecycle: "done" } });
		recoverKernelStoreFollowUps(repo.root, taskId);
		expect(readSettledTaskEvidence(repo.root, taskId)?.runId).toBe(seeded.run_id);

		// Only the exported proof is rewritten: the record bytes stay this run's,
		// the hash still binds them, and only the terminal lifecycle lies. The
		// pair is internally consistent, so only comparing the whole proof
		// against the settled run's can refuse it.
		const runDir = join(repo.root, ".imm", "audit", taskId, seeded.run_id);
		const recordPath = join(runDir, "task-record.json");
		const proofPath = join(runDir, "terminal-proof.json");
		const recordBytes = readFileSync(recordPath, "utf8");
		writeFileSync(
			proofPath,
			`${JSON.stringify(
				{
					contract: "assurance_kernel/task_tombstone/v2",
					task_id: taskId,
					lifecycle_status: "terminal",
					terminal_lifecycle: "stopped",
					terminal_event_id: `stopped:${taskId}:proof-only`,
					final_record_hash: revisionForContent(recordBytes),
					terminalized_at: "2026-08-12T10:00:00.000Z",
				},
				null,
				2,
			)}\n`,
		);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "feature.ts"), "code\n");

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-proof-only",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/does not match the settled run/);
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("later-child recovery binds the complete settled proof without writing on refusal", async () => {
		const batchId = "batch-proof-recovery";
		const settleAndCommit = async (taskId: string, expectedHead: string) => {
			const intent = parseTaskIntentV1({
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId, owner: "user", goal: `Implement ${taskId}`,
				scope_hint: [`src/${taskId}.ts`],
				acceptance: [{ id: "A1", assertion: "implemented", verification: "true" }],
				risk: "routine", revision: 1,
			});
			const hash = canonicalIntentHash(intent);
			const record = {
				contract: "assurance_kernel/task_record/v4", task_id: taskId,
				intent_snapshot: intent,
				intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: hash },
				lifecycle: "done", artifact_state: "frozen", baseline: hash,
				git_base_head: expectedHead, attestations: [], findings: [], history: [],
			};
			const seeded = seedKernelRunForTest(repo.root, { task_id: taskId, record, terminal: { lifecycle: "done" } });
			recoverKernelStoreFollowUps(repo.root, taskId);
			mkdirSync(join(repo.root, "src"), { recursive: true });
			writeFileSync(join(repo.root, "src", `${taskId}.ts`), "implemented\n");
			const result = await commitBatchChild({ root: repo.root, taskId, batchId, expectedHead });
			return { ...result, runId: seeded.run_id };
		};
		// Produce both commits through the real runtime, then simulate interruption
		// before the batch runner persists the second child result.
		const first = await settleAndCommit("proof-child-1", repo.baseHead);
		const taskId = "proof-child-2";
		const second = await settleAndCommit(taskId, first.commit);
		const lookup = (expectedHead: string | undefined = first.commit) =>
			lookupBatchCommit({ root: repo.root, taskId, batchId, expectedHead, branch: "imm/test-initiative" });
		expect(await lookup()).toEqual({ commit: second.commit });
		const proofPath = join(repo.root, ".imm/audit", taskId, second.runId, "terminal-proof.json");
		const originalBytes = readFileSync(proofPath);
		const originalProof = JSON.parse(originalBytes.toString());
		const capture = () => {
			const bytes: Record<string, Buffer> = {};
			const walk = (relative: string) => {
				for (const entry of readdirSync(join(repo.root, relative), { withFileTypes: true })) {
					const path = `${relative}/${entry.name}`;
					if (entry.isDirectory()) walk(path);
					else bytes[path] = readFileSync(join(repo.root, path));
				}
			};
			walk(".imm");
			walk(".git/refs");
			for (const path of [".git/index", ".git/HEAD", ".git/packed-refs"]) {
				if (existsSync(join(repo.root, path))) bytes[path] = readFileSync(join(repo.root, path));
			}
			return { head: git(repo.root, ["rev-parse", "HEAD"]), bytes };
		};
		for (const rewrite of [
			{ terminal_lifecycle: "stopped" },
			{ terminal_event_id: `${originalProof.terminal_event_id}:rewritten` },
			{ terminalized_at: new Date(Date.parse(originalProof.terminalized_at) + 1000).toISOString() },
		]) {
			writeFileSync(proofPath, `${JSON.stringify({ ...originalProof, ...rewrite }, null, 2)}\n`);
			const before = capture();
			await expect(lookup()).rejects.toThrow(/does not match the settled run/);
			// Omitting expectedHead must not bypass evidence identity either.
			await expect(lookupBatchCommit({ root: repo.root, taskId, batchId })).rejects.toThrow(/does not match the settled run/);
			expect(capture()).toEqual(before);
			writeFileSync(proofPath, originalBytes);
			expect(await lookup()).toEqual({ commit: second.commit });
		}
	});

	it("commits changes within scope envelope + .imm/audit/<task-id>/** with formatted message and trailer", async () => {
		const taskId = "task-settled-1";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Implement feature X\nSecond line of description",
			scope_hint: ["src/feature.ts", "docs/plans/archive/task-settled-1.intent.json"],
			acceptance: [
				{
					id: `acc-${taskId}`,
					assertion: "assert something",
					verification: "bun test",
				},
			],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "feature.ts"), "export const x = 1;\n");

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-123",
			expectedHead: repo.baseHead,
		});

		expect(res.commit).toBeDefined();
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(res.commit);

		// Lineage check: single parent equals baseHead
		const parents = git(repo.root, ["rev-parse", "HEAD^@"]).split(/\s+/).filter(Boolean);
		expect(parents).toEqual([repo.baseHead]);

		// Message and trailer check
		const commitMessage = git(repo.root, ["log", "-n", "1", "--format=%B"]);
		expect(commitMessage).toContain("imm(task-settled-1): Implement feature X");
		expect(commitMessage).toContain("Immune-Brain-Batch: batch-123");

		const trailer = git(repo.root, [
			"log",
			"-n",
			"1",
			"--format=%(trailers:key=Immune-Brain-Batch,valueonly)",
		]);
		expect(trailer).toBe("batch-123");

		const committedFiles = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", res.commit]).split("\n");
		expect(committedFiles).toContain("src/feature.ts");
		expect(committedFiles).toContain(".imm/audit/task-settled-1/task-record.json");
		expect(committedFiles).toContain(".imm/audit/task-settled-1/terminal-proof.json");
	});

	it("Finding 1: rejects out-of-scope files even if the on-disk intent file was modified to widen scope_hint", async () => {
		const taskId = "task-tamper-intent";
		const authorizedIntent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Authorized Goal",
			scope_hint: ["src/authorized.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, authorizedIntent);

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "authorized.ts"), "authorized\n");
		writeFileSync(join(repo.root, "src", "rogue.ts"), "rogue\n");

		// Attacker modifies mutable on-disk intent file to include rogue.ts:
		writeTaskIntent(repo.root, taskId, "Attacker Goal", ["src/authorized.ts", "src/rogue.ts"]);

		// Must reject because TaskRecord.intent_snapshot does not allow rogue.ts:
		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow("dirty_outside_scope");

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it.each(["rogue.ts", "rogue\n\t\".ts"])("reports escaped changed/staged scope paths without writes: %s", async rogue => {
		const taskId = "task-safe-diagnostics";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);
		writeFileSync(join(repo.root, rogue), "PRIVATE_FILE_CONTENT");
		git(repo.root, ["add", "--", rogue]);
		const index = readFileSync(join(repo.root, ".git/index"));
		let reason = "";
		try {
			await commitBatchChild({ root: repo.root, taskId, batchId: "batch-diag", expectedHead: repo.baseHead });
		} catch (error) { reason = (error as Error).message; }
		expect(reason).toStartWith("dirty_outside_scope: ");
		const detail = JSON.parse(reason.slice("dirty_outside_scope: ".length));
		expect(detail.cause).toBe("changed_paths");
		expect(detail.entries).toContainEqual({ path: rogue });
		expect(detail.omitted).toBe(0);
		expect(reason).not.toContain("\n");
		expect(reason).not.toContain("PRIVATE_FILE_CONTENT");
		expect(readFileSync(join(repo.root, ".git/index"))).toEqual(index);
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("bounds large scope diagnostics and reports omitted entries", async () => {
		const taskId = "task-bounded-diagnostics";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);
		for (let n = 0; n < 32; n++) writeFileSync(join(repo.root, `${"界".repeat(70)}-${n}.txt`), "private");
		let reason = "";
		try {
			await commitBatchChild({ root: repo.root, taskId, batchId: "batch-diag", expectedHead: repo.baseHead });
		} catch (error) { reason = (error as Error).message; }
		expect(reason).toStartWith("dirty_outside_scope: ");
		const detail = JSON.parse(reason.slice("dirty_outside_scope: ".length));
		expect(detail.entries.length).toBeLessThan(24);
		expect(detail.entries.length + detail.omitted).toBe(32);
		expect(detail.omitted).toBeGreaterThan(0);
		expect(Buffer.byteLength(reason)).toBeLessThanOrEqual(4096);
	});

	it("Finding 4: rejects files with trailing whitespace as dirty_outside_scope", async () => {
		const taskId = "task-trailing-space";
		const authorizedIntent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Trailing Space Goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, authorizedIntent);

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");
		// File with trailing space:
		writeFileSync(join(repo.root, "src", "allowed.ts "), "space-infiltrator\n");

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow("dirty_outside_scope");

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("terminates with dirty_outside_scope when modifying another task's audit directory", async () => {
		const taskId = "task-audit-tamper";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);
		writeChildAudit(repo.root, "foreign-task", "done", repo.baseHead);

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow("dirty_outside_scope");

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("terminates as failed with lineage error if current HEAD does not match expected_head", async () => {
		const taskId = "task-lineage";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: "f".repeat(40),
			}),
		).rejects.toThrow(/batch_head_lineage_broken/);
	});

	it("Finding 2: rejects hidden out-of-scope modification carrying assume-unchanged as dirty_outside_scope", async () => {
		const taskId = "task-assume-unchanged";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Assume unchanged goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");

		// Out-of-scope tracked file hidden with --assume-unchanged
		writeFileSync(join(repo.root, "out-of-scope.txt"), "initial\n");
		git(repo.root, ["add", "out-of-scope.txt"]);
		git(repo.root, ["commit", "-m", "add out of scope"]);
		const baseNow = git(repo.root, ["rev-parse", "HEAD"]);

		// Modify out-of-scope file and hide it
		writeFileSync(join(repo.root, "out-of-scope.txt"), "modified-secret\n");
		git(repo.root, ["update-index", "--assume-unchanged", "out-of-scope.txt"]);

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-assume-1",
				expectedHead: baseNow,
			}),
		).rejects.toThrow('"flags":["assume-unchanged"]');
	});

	it("Finding 1: rejects hidden out-of-scope modification carrying combined flags (tag s) as dirty_outside_scope", async () => {
		const taskId = "task-combined-flags";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Combined flags goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");

		writeFileSync(join(repo.root, "out-of-scope-s.txt"), "initial\n");
		git(repo.root, ["add", "out-of-scope-s.txt"]);
		git(repo.root, ["commit", "-m", "add out of scope s"]);
		const baseNow = git(repo.root, ["rev-parse", "HEAD"]);

		writeFileSync(join(repo.root, "out-of-scope-s.txt"), "modified-s\n");
		git(repo.root, ["update-index", "--skip-worktree", "out-of-scope-s.txt"]);
		git(repo.root, ["update-index", "--assume-unchanged", "out-of-scope-s.txt"]);

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-s-1",
				expectedHead: baseNow,
			}),
		).rejects.toThrow('"flags":["assume-unchanged","skip-worktree"]');
	});

	it("Finding 2: commits scoped staged deletion and staged rename without pathspec errors", async () => {
		const taskId = "task-rm-mv";
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "to-delete.ts"), "delete me\n");
		writeFileSync(join(repo.root, "src", "to-rename.ts"), "rename me\n");
		git(repo.root, ["add", "src"]);
		git(repo.root, ["commit", "-m", "add initial files"]);
		const baseNow = git(repo.root, ["rev-parse", "HEAD"]);

		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Delete and rename files",
			scope_hint: ["src/to-delete.ts", "src/to-rename.ts", "src/renamed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", baseNow, intent);

		git(repo.root, ["rm", "src/to-delete.ts"]);
		git(repo.root, ["mv", "src/to-rename.ts", "src/renamed.ts"]);

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-rm-mv-1",
			expectedHead: baseNow,
		});

		expect(res.commit).toBeDefined();
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(res.commit);

		const committedFiles = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", res.commit]).split("\n");
		expect(committedFiles).toContain("src/to-delete.ts");
		expect(committedFiles).toContain("src/renamed.ts");
	});

	it("review round 7: commitBatchChild rejects a same-SHA branch switch before settlement", async () => {
		const taskId = "task-branch-switch";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Branch switch goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		// Switch to a decoy branch at the same SHA as imm/test-initiative
		git(repo.root, ["checkout", "-b", "decoy-branch"]);

		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-branch-switch",
				expectedHead: repo.baseHead,
				branch: "imm/test-initiative",
			}),
		).rejects.toThrow(/batch_head_lineage_broken/);

		// Nothing was committed on the decoy branch
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("Finding 1: pre-commit hook staging unauthorized files is bypassed by --no-verify", async () => {
		const taskId = "task-hook-bypass";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Hook bypass goal",
			scope_hint: ["src/hook-allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "hook-allowed.ts"), "allowed\n");

		// Install malicious/rogue pre-commit hook
		const hooksDir = join(repo.root, ".git", "hooks");
		mkdirSync(hooksDir, { recursive: true });
		const hookFile = join(hooksDir, "pre-commit");
		writeFileSync(hookFile, "#!/bin/sh\necho leak > rogue-from-hook.txt\ngit add rogue-from-hook.txt\n");
		spawnSync("chmod", ["+x", hookFile]);

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-hook-1",
			expectedHead: repo.baseHead,
		});

		expect(res.commit).toBeDefined();
		const committedFiles = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", res.commit]).split("\n");
		expect(committedFiles).not.toContain("rogue-from-hook.txt");
		expect(committedFiles).toContain("src/hook-allowed.ts");
	});

	it("Finding 1: prepare-commit-msg and post-commit hooks are bypassed via core.hooksPath=/dev/null", async () => {
		const taskId = "task-hooks-all";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Hooks all goal",
			scope_hint: ["src/hook-all.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "hook-all.ts"), "allowed\n");

		const hooksDir = join(repo.root, ".git", "hooks");
		mkdirSync(hooksDir, { recursive: true });
		// Hook trying to rewrite message / trailer:
		writeFileSync(join(hooksDir, "prepare-commit-msg"), "#!/bin/sh\necho 'tampered' > \"$1\"\n");
		// Hook trying to amend and add untracked file:
		writeFileSync(join(hooksDir, "post-commit"), "#!/bin/sh\necho bad > bad.txt && git add bad.txt && git commit --amend -C HEAD\n");
		spawnSync("chmod", ["+x", join(hooksDir, "prepare-commit-msg"), join(hooksDir, "post-commit")]);

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-hooks-all",
			expectedHead: repo.baseHead,
		});

		expect(res.commit).toBeDefined();
		const msg = git(repo.root, ["log", "-n", "1", "--format=%B", res.commit]);
		expect(msg).toContain("imm(task-hooks-all): Hooks all goal");
		expect(msg).toContain("Immune-Brain-Batch: batch-hooks-all");

		const committedFiles = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", res.commit]).split("\n");
		expect(committedFiles).not.toContain("bad.txt");
	});

	it("Finding 2: rejects POSIX backslash filename src\\allowed.ts as dirty_outside_scope", async () => {
		const taskId = "task-backslash";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Backslash test",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");
		// Literal backslash in root-level filename on POSIX:
		writeFileSync(join(repo.root, "src\\allowed.ts"), "backslash-attacker\n");

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow("dirty_outside_scope");

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("Finding 3: lookupBatchCommit verifies HEAD and single parent, and detects external HEAD drift", async () => {
		const taskId = "task-lookup";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Lookup test",
			scope_hint: ["src/lookup.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "lookup.ts"), "code\n");

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-xyz",
			expectedHead: repo.baseHead,
		});

		// 1. Success case: current HEAD === commit and parent === expectedHead
		const found = await lookupBatchCommit({
			root: repo.root,
			taskId,
			batchId: "batch-xyz",
			expectedHead: repo.baseHead,
		});
		expect(found).not.toBeNull();
		expect(found!.commit).toBe(commit);

		// 2. A user commit fast-forwarding past the unpersisted batch commit is
		// adopted work, not drift: the own commit is still found.
		writeFileSync(join(repo.root, "external.txt"), "external\n");
		git(repo.root, ["add", "external.txt"]);
		git(repo.root, ["commit", "-m", "external commit"]);

		const past = await lookupBatchCommit({
			root: repo.root,
			taskId,
			batchId: "batch-xyz",
			expectedHead: repo.baseHead,
		});
		expect(past!.commit).toBe(commit);

		// 3. Finding 3: a HEAD that no longer descends from the batch commit is fatal.
		git(repo.root, ["reset", "--hard", repo.baseHead]);
		writeFileSync(join(repo.root, "diverged.txt"), "diverged\n");
		git(repo.root, ["add", "diverged.txt"]);
		git(repo.root, ["commit", "-m", "diverged commit"]);

		await expect(
			lookupBatchCommit({
				root: repo.root,
				taskId,
				batchId: "batch-xyz",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/batch_head_lineage_broken/);
	});

	it("Finding 1: lookupBatchCommit rejects in-scope external commit lacking durable batch commit evidence", async () => {
		const taskId = "task-forged-lookup";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Forged lookup goal",
			scope_hint: ["src/forged.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "forged.ts"), "code\n");
		git(repo.root, ["add", "src/forged.ts"]);

		// External commit matching batch author and trailer, but NOT produced by commitBatchChild
		const msg = `imm(${taskId}): Forged lookup goal\n\nImmune-Brain-Batch: batch-fake-1\n`;
		git(repo.root, [
			"-c",
			"user.name=Immune-Brain Batch",
			"-c",
			"user.email=immune-brain@local",
			"commit",
			"-m",
			msg,
		]);

		await expect(
			lookupBatchCommit({
				root: repo.root,
				taskId,
				batchId: "batch-fake-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/lacks durable batch runner production evidence/);
	});
});

/**
 * A batch recorded before the hidden ref owned its progress keeps its checked-out
 * `imm/<slug>` branch; resume must still read that lineage. The branch is created
 * by hand here because the runtime no longer creates or switches branches.
 */
function legacyBranchPreflight(input: { root: string; initiative_slug: string; base_head: string }) {
	const branch = `imm/${input.initiative_slug}`;
	if (spawnSync("git", ["-C", input.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0)
		return { ok: false as const, reason: "batch_branch_exists" };
	git(input.root, ["checkout", "-q", "-b", branch, input.base_head]);
	return { ok: true as const, branch };
}

describe("batch runner integration: branch and scope-bounded commit", () => {
	let repo: { root: string; baseHead: string };

	beforeEach(() => {
		repo = initGitRepo();
	});

	afterEach(() => {
		rmSync(repo.root, { recursive: true, force: true });
	});

	function makeBatchInput(
		children: BatchPlanChild[],
		kernel: BatchRunnerKernelPort,
		slug = "test-init",
		batchId = "batch-int-1",
	) {
		const registry = createBatchAuthorityRegistry();
		const planDigest = computeBatchPlanDigest(
			children.map((c) => ({
				task_id: c.task_id,
				intent_path: c.intent_path!,
				intent_revision: c.intent_revision!,
				intent_content_hash: c.intent_content_hash!,
				blocked_by: c.blocked_by,
			})),
		);
		const capability = registry.issue(
			{
				batch_id: batchId,
				initiative_slug: slug,
				plan_digest: planDigest,
				branch: batchRefName(batchId),
				base_head: repo.baseHead,
				budget: { max_children: 5, qa_failure_limit: 3 },
				actor_id: "user",
				confirmation_ref: "confirm-1",
				nonce: "nonce-1",
			},
			children,
			CONFIRMATION_TIME,
		);

		return {
			root: repo.root,
			batch_id: batchId,
			initiative_slug: slug,
			registry,
			capability,
			children,
			plan_digest: planDigest,
			base_head: repo.baseHead,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			now: "2026-01-01T01:00:00.000Z",
			kernel,
		};
	}

	it("executes full batch: passing preflight creates the hidden ref, settled children advance lineage without moving the user's branch", async () => {
		const slug = "feature-flow";
		const taskA = "task-a";
		const taskB = "task-b";

		const intentPathA = writeTaskIntent(repo.root, taskA, "Task A goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Task B goal", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "b".repeat(64),
			},
		];

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				return { record_revision: "rev-1" };
			},
			async advanceTask(root, taskId) {
				if (taskId === taskA) {
					mkdirSync(join(root, "src"), { recursive: true });
					writeFileSync(join(root, "src", "a.ts"), "content a\n");
					writeChildAudit(root, taskA, "done", repo.baseHead, {
						contract: "assurance_kernel/task_intent/v1",
						task_id: taskA,
						owner: "user",
						goal: "Task A goal",
						scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
						acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
						risk: "material",
						revision: 1,
					});
				} else if (taskId === taskB) {
					mkdirSync(join(root, "src"), { recursive: true });
					writeFileSync(join(root, "src", "b.ts"), "content b\n");
					const headNow = git(root, ["rev-parse", "HEAD"]);
					writeChildAudit(root, taskB, "done", headNow, {
						contract: "assurance_kernel/task_intent/v1",
						task_id: taskB,
						owner: "user",
						goal: "Task B goal",
						scope_hint: ["src/b.ts", `docs/plans/archive/${taskB}.intent.json`],
						acceptance: [{ id: `acc-${taskB}`, assertion: "assert", verification: "bun test" }],
						risk: "material",
						revision: 1,
					});
				}
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const input = makeBatchInput(children, kernel, slug, "batch-flow-1");
		const report = await finishScriptedHandoffs(input, await startBatch(input));

		expect(report.batch_state).toBe("completed");
		expect(report.commits).toHaveLength(2);

		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);

		const stateRecord = readBatchRunState(repo.root, "batch-flow-1");
		expect(stateRecord).not.toBeNull();
		expect(stateRecord!.branch).toBe(batchRefName("batch-flow-1"));
		expect(git(repo.root, ["rev-parse", stateRecord!.branch])).toBe(report.commits[1]!);
		expect(stateRecord!.commits).toHaveLength(2);

		const commitB = report.commits[1]!;
		const commitA = report.commits[0]!;
		expect(git(repo.root, ["rev-parse", `${commitB}~1`])).toBe(commitA);
		expect(git(repo.root, ["rev-parse", `${commitA}~1`])).toBe(repo.baseHead);

		expect(git(repo.root, ["log", "-n", "1", "--format=%B", commitA])).toContain("imm(task-a): Task A goal");
		expect(git(repo.root, ["log", "-n", "1", "--format=%B", commitB])).toContain("imm(task-b): Task B goal");
	});

	it("leaves a child's out-of-scope file as the user's own: delivered commit excludes it and the batch completes", async () => {
		const slug = "leak-flow";
		const taskA = "task-leak-a";

		const intentPathA = writeTaskIntent(repo.root, taskA, "Task A goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				return { record_revision: "rev-1" };
			},
			async advanceTask(root, taskId) {
				mkdirSync(join(root, "src"), { recursive: true });
				writeFileSync(join(root, "src", "a.ts"), "content a\n");
				writeFileSync(join(root, "unscoped.txt"), "leak\n");
				writeChildAudit(root, taskId, "done", repo.baseHead, {
					contract: "assurance_kernel/task_intent/v1",
					task_id: taskId,
					owner: "user",
					goal: "Task A goal",
					scope_hint: ["src/a.ts", `docs/plans/archive/${taskId}.intent.json`],
					acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
					risk: "material",
					revision: 1,
				});
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const input = makeBatchInput(children, kernel, slug, "batch-leak-1");
		const report = await finishScriptedHandoffs(input, await startBatch(input));

		expect(report.batch_state).toBe("completed");
		expect(report.commits).toHaveLength(1);
		// Only the child's scope reaches the hidden ref; the stray file stays in the working tree, uncommitted.
		const delivered = git(repo.root, ["diff-tree", "-r", "--name-only", "--no-commit-id", report.commits[0]!]).split("\n");
		expect(delivered).toContain("src/a.ts");
		expect(delivered).not.toContain("unscoped.txt");
		expect(readFileSync(join(repo.root, "unscoped.txt"), "utf8")).toBe("leak\n");
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
	});

	it("terminates as rejected when the batch's hidden ref already holds another commit, leaving zero batch state files", async () => {
		const slug = "exist-flow";
		const taskA = "task-exist-a";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [`docs/plans/${taskA}.intent.json`]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const foreignTip = git(repo.root, ["commit-tree", git(repo.root, ["rev-parse", "HEAD^{tree}"]), "-p", repo.baseHead, "-m", "foreign tip"]);
		git(repo.root, ["update-ref", batchRefName("batch-exist-1"), foreignTip]);
		const originalBranch = git(repo.root, ["symbolic-ref", "--short", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("must not be called");
			},
			async advanceTask() {
				throw new Error("must not be called");
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const input = makeBatchInput(children, kernel, slug, "batch-exist-1");
		const report = await startBatch(input);

		expect(report.batch_state).toBe("rejected");
		expect(report.reason).toBe("batch_branch_exists");

		expect(existsSync(join(repo.root, ".imm", "state", "batches", "batch-exist-1.json"))).toBe(false);
		expect(existsSync(join(repo.root, ".imm", "state", "batches", "batch-exist-1.report.json"))).toBe(false);

		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(originalBranch);
		expect(git(repo.root, ["rev-parse", batchRefName("batch-exist-1")])).toBe(foreignTip);
	});

	it("Finding 3: resumeBatch refuses external HEAD drift before commit lookup without writes", async () => {
		const slug = "drift-flow";
		const taskA = "task-drift-a";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		// First: run preflight to create branch
		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle taskA in audit and create its commit
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-drift-1",
			expectedHead: repo.baseHead,
		});

		// External commit moves HEAD past the batch commit before resume
		writeFileSync(join(repo.root, "external.txt"), "external\n");
		git(repo.root, ["add", "external.txt"]);
		git(repo.root, ["commit", "-m", "external commit moving HEAD"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-drift-1");

		// Persist state as if crash happened after settlement before committed-persist
		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-drift-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		await expectProvenanceRefusal(batchInput);
		expect(readBatchRunState(repo.root, "batch-drift-1")!.batch_state).toBe("running");
	});

	it("Finding 3: resumeBatch refuses a forged out-of-scope commit without writes", async () => {
		const slug = "forged-flow";
		const taskA = "task-forged-a";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle taskA in audit with authorized scope strictly src/a.ts
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		// External attacker commits a forged commit with the expected message/trailer but changing forged-leak.txt
		writeFileSync(join(repo.root, "forged-leak.txt"), "leak\n");
		git(repo.root, ["add", "forged-leak.txt"]);
		const forgedMsg = `imm(${taskA}): Goal\n\nImmune-Brain-Batch: batch-forged-1\n`;
		git(repo.root, ["commit", "-m", forgedMsg]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-forged-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-forged-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		await expectProvenanceRefusal(batchInput);
		expect(readBatchRunState(repo.root, "batch-forged-1")!.batch_state).toBe("running");
	});

	it("Finding 1: symlink attack on commit evidence is rejected and target remains untouched", async () => {
		const outsideDir = mkdtempSync(join(tmpdir(), "outside-evidence-"));
		try {
			const sensitiveFile = join(outsideDir, "sensitive.txt");
			writeFileSync(sensitiveFile, "precious content\n");

			const taskId = "task-symlink-attack";
			const intent = {
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: "Symlink attack test",
				scope_hint: ["src/symlink.ts"],
				acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
				risk: "material",
				revision: 1,
			};
			writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
			mkdirSync(join(repo.root, "src"), { recursive: true });
			writeFileSync(join(repo.root, "src", "symlink.ts"), "code\n");

			mkdirSync(join(repo.root, ".imm", "state", "batches"), { recursive: true });
			const { symlinkSync } = await import("node:fs");
			symlinkSync(outsideDir, join(repo.root, ".imm", "state", "batches", "commits"));

			await expect(
				commitBatchChild({
					root: repo.root,
					taskId,
					batchId: "batch-symlink-1",
					expectedHead: repo.baseHead,
				}),
			).rejects.toThrow(/not a real directory|symlink/);

			expect(readFileSync(sensitiveFile, "utf8")).toBe("precious content\n");
		} finally {
			rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("Finding 2: concurrent branch creation does not delete the existing branch", () => {
		const slug = "concurrent-branch";
		const branch = `imm/${slug}`;
		git(repo.root, ["branch", branch, repo.baseHead]);
		const branchCommitBefore = git(repo.root, ["rev-parse", `refs/heads/${branch}`]);

		const res = legacyBranchPreflight({
			root: repo.root,
			initiative_slug: slug,
			base_head: repo.baseHead,
		});

		expect(res.ok).toBe(false);
		expect(res.reason).toBe("batch_branch_exists");

		const branchCommitAfter = git(repo.root, ["rev-parse", `refs/heads/${branch}`]);
		expect(branchCommitAfter).toBe(branchCommitBefore);
	});

	it("Finding 1: resumeBatch refuses an in-scope external commit without durable evidence or writes", async () => {
		const slug = "fake-inscope-flow";
		const taskA = "task-fake-inscope";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		git(repo.root, ["add", "src/a.ts"]);
		const forgedMsg = `imm(${taskA}): Goal\n\nImmune-Brain-Batch: batch-fake-inscope-1\n`;
		git(repo.root, [
			"-c",
			"user.name=Immune-Brain Batch",
			"-c",
			"user.email=immune-brain@local",
			"commit",
			"-m",
			forgedMsg,
		]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-fake-inscope-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-fake-inscope-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		await expectProvenanceRefusal(batchInput);
		expect(readBatchRunState(repo.root, "batch-fake-inscope-1")!.batch_state).toBe("running");
	});

	it("Finding 1: startBatch terminates as failed on post-commit persistence window history rewrite", async () => {
		const slug = "drift-window-flow";
		const taskA = "task-drift-window";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle and commit taskA
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-window-1",
			expectedHead: repo.baseHead,
		});

		// History rewrite drops the batch commit before the batch finishes marking completed
		git(repo.root, ["reset", "--hard", repo.baseHead]);
		writeFileSync(join(repo.root, "external-drift.txt"), "drift\n");
		git(repo.root, ["add", "external-drift.txt"]);
		git(repo.root, ["commit", "-m", "external drift commit"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-window-1");

		// Persist state as if crash happened after commit but while state is still "running"
		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-window-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await startBatch(batchInput);

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-window-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("Finding 1: startBatch adopts a fast-forward commit made in the post-commit persistence window", async () => {
		const slug = "adopt-window-flow";
		const taskA = "task-adopt-window";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle and commit taskA
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-adopt-window-1",
			expectedHead: repo.baseHead,
		});

		// External commit advances HEAD past commit before the batch finishes marking completed
		writeFileSync(join(repo.root, "external-drift.txt"), "drift\n");
		git(repo.root, ["add", "external-drift.txt"]);
		git(repo.root, ["commit", "-m", "external drift commit"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-adopt-window-1");

		// Persist state as if crash happened after commit but while state is still "running"
		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-adopt-window-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const adoptedHead = git(repo.root, ["rev-parse", "HEAD"]);
		const report = await startBatch(batchInput);

		expect(report.batch_state).toBe("completed");

		const stored = readBatchRunState(repo.root, "batch-adopt-window-1");
		expect(stored!.batch_state).toBe("completed");
		expect(stored!.commits).toEqual([commit]);
		expect(stored!.adopted_heads).toEqual([{ from: commit, to: adoptedHead }]);
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(adoptedHead);
	});

	it("review round 7: resumeBatch terminates as failed on same-SHA branch switch before settlement", async () => {
		const slug = "branch-switch-flow";
		const taskA = "task-branch-switch-a";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle taskA in audit; do NOT commit it yet (before settlement)
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		// Same-SHA branch switch away from the batch branch while the child is settled but uncommitted
		git(repo.root, ["checkout", "-b", "decoy-resume"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-branch-switch-1");

		// Persist state as if crash happened after settlement before committed-persist
		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-branch-switch-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-branch-switch-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("review round 8: startBatch persists failed (not thrown) when a committed child's branch is switched", async () => {
		const slug = "switch-committed-flow";
		const taskA = "task-switch-committed";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-switch-committed-1",
			expectedHead: repo.baseHead,
		});

		// Same-SHA branch switch away from the batch branch after the child committed
		git(repo.root, ["checkout", "-b", "decoy-committed"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-switch-committed-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-switch-committed-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		// Must return a failed report, not throw an unhandled validation error
		const report = await startBatch(batchInput);
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-switch-committed-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("review round 8: resumeBatch persists failed when HEAD regresses and the recorded commit becomes unreachable", async () => {
		const slug = "head-regress-flow";
		const taskA = "task-head-regress";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-head-regress-1",
			expectedHead: repo.baseHead,
		});

		// HEAD regression: recorded batch commit becomes unreachable from HEAD
		git(repo.root, ["reset", "--hard", "HEAD~1"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-head-regress-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-head-regress-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		// Must return a failed report, not throw an unhandled validation error
		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-head-regress-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("review round 9: startBatch fails a lineage-broken batch with an in-flight enrolled child (two-child)", async () => {
		const slug = "inflight-switch-flow";
		const taskA = "task-inflight-a";
		const taskB = "task-inflight-b";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal A", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Goal B", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal A",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-inflight-1",
			expectedHead: repo.baseHead,
		});

		// Same-SHA branch switch away from the batch branch while child B is in-flight
		git(repo.root, ["checkout", "-b", "decoy-inflight"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-inflight-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-inflight-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
				{
					task_id: taskB,
					slice_id: "S2",
					blocked_by: [taskA],
					state: "enrolled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		// Must persist a failed report (in-flight child transitioned), not throw
		const report = await startBatch(batchInput);
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-inflight-1");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("committed");
		expect(stored!.children.find((c) => c.task_id === taskB)!.state).toBe("needs_human");
	});

	it("review round 9: resumeBatch fails a lineage-broken batch with an in-flight settled child (two-child)", async () => {
		const slug = "inflight-regress-flow";
		const taskA = "task-inflight-regress-a";
		const taskB = "task-inflight-regress-b";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal A", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Goal B", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal A",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-inflight-2",
			expectedHead: repo.baseHead,
		});

		// Child B is legitimately settled in-flight: its audit pair exists so
		// the recovery path reaches commitBatchChild's own lineage check.
		writeChildAudit(repo.root, taskB, "done", commit, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskB,
			owner: "user",
			goal: "Goal B",
			scope_hint: ["src/b.ts", `docs/plans/archive/${taskB}.intent.json`],
			acceptance: [{ id: `acc-${taskB}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		// HEAD regression: recorded batch commit becomes unreachable while child B is settled in-flight
		git(repo.root, ["reset", "--hard", "HEAD~1"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-inflight-2");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-inflight-2",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
				{
					task_id: taskB,
					slice_id: "S2",
					blocked_by: [taskA],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		// Must persist a failed report (in-flight child transitioned), not throw
		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-inflight-2");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("committed");
		expect(stored!.children.find((c) => c.task_id === taskB)!.state).toBe("needs_human");
	});

	it("review round 10: external HEAD movement before a subsequent child's enrollment fails the batch", async () => {
		const slug = "enroll-drift-flow";
		const taskA = "task-enroll-drift-a";
		const taskB = "task-enroll-drift-b";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal A", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Goal B", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		const kernel: BatchRunnerKernelPort = {
			// Mirrors deriveChildEnrollment's HEAD binding check
			async enrollTask(args) {
				if (args.task_id === taskB) {
					// External HEAD movement after the pre-loop check, before B's enrollment
					git(repo.root, ["commit", "--allow-empty", "-qm", "external movement"]);
				}
				const currentHead = git(repo.root, ["rev-parse", "HEAD"]);
				if (currentHead !== args.batch.binding.expected_head) {
					throw new Error(
						`batch_head_lineage_broken: current HEAD ${currentHead} does not match enrollment expected_head ${args.batch.binding.expected_head}`,
					);
				}
				return { record_revision: "rev-1" };
			},
			async advanceTask(root, taskId) {
				if (taskId === taskA) {
					mkdirSync(join(root, "src"), { recursive: true });
					writeFileSync(join(root, "src", "a.ts"), "content a\n");
					writeChildAudit(root, taskA, "done", repo.baseHead, {
						contract: "assurance_kernel/task_intent/v1",
						task_id: taskA,
						owner: "user",
						goal: "Goal A",
						scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
						acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
						risk: "material",
						revision: 1,
					});
				}
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-enroll-drift-1");

		const report = await finishScriptedHandoffs(batchInput, await startBatch(batchInput));

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-enroll-drift-1");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("committed");
		expect(stored!.children.find((c) => c.task_id === taskB)!.state).toBe("needs_human");
	});

	it("review round 11: resumeBatch fails when the first enrolled child faces external HEAD drift", async () => {
		const slug = "enrolled-drift-flow";
		const taskA = "task-enrolled-drift";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// History rewrite after the initial check, while child A is enrolled: the
		// recorded base is no longer an ancestor of HEAD.
		git(repo.root, ["reset", "-q", "--hard", "HEAD~1"]);
		git(repo.root, ["commit", "--allow-empty", "-qm", "external movement"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				throw new Error("not called");
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-enrolled-drift-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-enrolled-drift-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "enrolled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-enrolled-drift-1");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("needs_human");
	});

	it("review round 11: resumeBatch fails when the first enrolled child faces a same-SHA branch switch", async () => {
		const slug = "enrolled-switch-flow";
		const taskA = "task-enrolled-switch";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Same-SHA branch switch while child A is enrolled
		git(repo.root, ["checkout", "-b", "decoy-enrolled"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				throw new Error("not called");
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-enrolled-switch-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-enrolled-switch-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "enrolled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-enrolled-switch-1");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("needs_human");
	});

	it("review round 12: fabricated settlement cannot authorize first-commit adoption", async () => {
		const slug = "adopt-flow";
		const taskA = "task-adopt-a";
		const taskB = "task-adopt-b";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal A", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Goal B", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Commit A with durable evidence, then crash before committed-persist:
		// state still shows settled with commits [] and no external HEAD movement.
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal A",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});
		const shaA = (await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-adopt-1",
			expectedHead: repo.baseHead,
		})).commit;

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				return { record_revision: "rev-1" };
			},
			async advanceTask(root, taskId) {
				if (taskId === taskA) {
					throw new Error("adopted child must not be re-driven");
				}
				mkdirSync(join(root, "src"), { recursive: true });
				writeFileSync(join(root, "src", "b.ts"), "content b\n");
				const headNow = git(root, ["rev-parse", "HEAD"]);
				writeChildAudit(root, taskId, "done", headNow, {
					contract: "assurance_kernel/task_intent/v1",
					task_id: taskId,
					owner: "user",
					goal: "Goal B",
					scope_hint: ["src/b.ts", `docs/plans/archive/${taskB}.intent.json`],
					acceptance: [{ id: `acc-${taskB}`, assertion: "assert", verification: "bun test" }],
					risk: "material",
					revision: 1,
				});
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-adopt-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-adopt-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			budget: { max_children: 5, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
				{
					task_id: taskB,
					slice_id: "S2",
					blocked_by: [taskA],
					state: "pending" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		await expectProvenanceRefusal(batchInput);
		const stored = readBatchRunState(repo.root, "batch-adopt-1");
		expect(stored!.batch_state).toBe("running");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("settled");
		expect(stored!.commits).toEqual([]);
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(shaA);
	});

	it("review round 13: lookupBatchCommit finds its own commit under grep.extendedRegexp=true", async () => {
		const slug = "extended-grep-flow";
		const taskId = "task-extended-grep";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Extended regexp goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-extended-grep",
			expectedHead: repo.baseHead,
		});

		git(repo.root, ["config", "grep.extendedRegexp", "true"]);
		const found = await lookupBatchCommit({
			root: repo.root,
			taskId,
			batchId: "batch-extended-grep",
			expectedHead: repo.baseHead,
			branch: `imm/${slug}`,
		});
		expect(found).not.toBeNull();
		expect(found!.commit).toBe(res.commit);
	});

	it("review round 14: evidence-direct lookup is not shadowed by a later goal mentioning the marker", async () => {
		const slug = "shadow-flow";
		const taskA = "task-shadow-a";
		legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		const intentA = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Validation goal",
			scope_hint: ["src/a.ts"],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, intentA);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "a\n");
		const shaA = (await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-shadow-1",
			expectedHead: repo.baseHead,
		})).commit;

		// Child B's goal text mentions A's marker; its commit must not shadow A's
		const taskB = "task-shadow-b";
		const intentB = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskB,
			owner: "user",
			goal: `Follow up imm(${taskA}): validation`,
			scope_hint: ["src/b.ts"],
			acceptance: [{ id: `acc-${taskB}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		const headAfterA = git(repo.root, ["rev-parse", "HEAD"]);
		writeChildAudit(repo.root, taskB, "done", headAfterA, intentB);
		writeFileSync(join(repo.root, "src", "b.ts"), "b\n");
		const shaB = (await commitBatchChild({
			root: repo.root,
			taskId: taskB,
			batchId: "batch-shadow-1",
			expectedHead: headAfterA,
		})).commit;
		expect(shaB).not.toBe(shaA);

		const foundA = await lookupBatchCommit({ root: repo.root, taskId: taskA, batchId: "batch-shadow-1" });
		expect(foundA).not.toBeNull();
		expect(foundA!.commit).toBe(shaA);

		const foundB = await lookupBatchCommit({ root: repo.root, taskId: taskB, batchId: "batch-shadow-1" });
		expect(foundB).not.toBeNull();
		expect(foundB!.commit).toBe(shaB);
	});

	it("review round 15: preflight sees a hidden dirty submodule (submodule.ignore=all) only when an unsettled child owns it", () => {
		const srcRepo = mkdtempSync(join(tmpdir(), "sub-src-"));
		try {
			git(srcRepo, ["init", "-q"]);
			git(srcRepo, ["config", "user.name", "T"]);
			git(srcRepo, ["config", "user.email", "t@t"]);
			writeFileSync(join(srcRepo, "f.txt"), "1\n");
			git(srcRepo, ["add", "f.txt"]);
			git(srcRepo, ["commit", "-qm", "init"]);

			git(repo.root, ["-c", "protocol.file.allow=always", "submodule", "add", srcRepo, "vendor/sub"]);
			git(repo.root, ["commit", "-qm", "add submodule"]);
			const baseNow = git(repo.root, ["rev-parse", "HEAD"]);
			git(repo.root, ["config", "submodule.vendor/sub.ignore", "all"]);

			// Dirty the submodule's tracked content; hidden by ignore=all
			writeFileSync(join(repo.root, "vendor", "sub", "f.txt"), "2\n");

			// Dirt in a submodule no unsettled child owns is the user's own.
			const outside = runBatchGitPreflight({
				root: repo.root, initiative_slug: "sub-hidden-a", base_head: baseNow, batch_id: "batch-sub-a", blocking_scopes: ["src/**"],
			});
			expect(outside.ok).toBe(true);

			const owned = runBatchGitPreflight({
				root: repo.root, initiative_slug: "sub-hidden-b", base_head: baseNow, batch_id: "batch-sub-b", blocking_scopes: ["vendor/sub"],
			});
			expect(owned.ok).toBe(false);
			if (!owned.ok) {
				expect(owned.reason).toBe("dirty_working_tree");
			}
			expect(spawnSync("git", ["-C", repo.root, "rev-parse", "--verify", "--quiet", "refs/imm/batches/batch-sub-b"]).status).not.toBe(0);
			expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
		} finally {
			rmSync(srcRepo, { recursive: true, force: true });
		}
	});

	it("review round 15: commitBatchChild rejects a hidden dirty out-of-scope submodule as dirty_outside_scope", async () => {
		const slug = "sub-hidden-b";
		const srcRepo = mkdtempSync(join(tmpdir(), "sub-src-"));
		try {
			git(srcRepo, ["init", "-q"]);
			git(srcRepo, ["config", "user.name", "T"]);
			git(srcRepo, ["config", "user.email", "t@t"]);
			writeFileSync(join(srcRepo, "f.txt"), "1\n");
			git(srcRepo, ["add", "f.txt"]);
			git(srcRepo, ["commit", "-qm", "init"]);

			git(repo.root, ["-c", "protocol.file.allow=always", "submodule", "add", srcRepo, "vendor/sub"]);
			git(repo.root, ["commit", "-qm", "add submodule"]);
			const baseNow = git(repo.root, ["rev-parse", "HEAD"]);
			git(repo.root, ["config", "submodule.vendor/sub.ignore", "all"]);

			legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: baseNow });

			// In-scope change plus a hidden dirty out-of-scope submodule
			const taskId = "task-sub-hidden";
			writeChildAudit(repo.root, taskId, "done", baseNow, {
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: "Sub hidden goal",
				scope_hint: ["src/allowed.ts"],
				acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
				risk: "material",
				revision: 1,
			});
			mkdirSync(join(repo.root, "src"), { recursive: true });
			writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");
			writeFileSync(join(repo.root, "vendor", "sub", "f.txt"), "2\n");

			await expect(
				commitBatchChild({
					root: repo.root,
					taskId,
					batchId: "batch-sub-hidden-1",
					expectedHead: baseNow,
				}),
			).rejects.toThrow("dirty_outside_scope");
		} finally {
			rmSync(srcRepo, { recursive: true, force: true });
		}
	});

	it("review round 16: rejects an in-scope dirty submodule whose contents git add cannot stage", async () => {
		const slug = "sub-inscope-flow";
		const srcRepo = mkdtempSync(join(tmpdir(), "sub-src-"));
		try {
			git(srcRepo, ["init", "-q"]);
			git(srcRepo, ["config", "user.name", "T"]);
			git(srcRepo, ["config", "user.email", "t@t"]);
			writeFileSync(join(srcRepo, "f.txt"), "1\n");
			git(srcRepo, ["add", "f.txt"]);
			git(srcRepo, ["commit", "-qm", "init"]);

			git(repo.root, ["-c", "protocol.file.allow=always", "submodule", "add", srcRepo, "vendor/sub"]);
			git(repo.root, ["commit", "-qm", "add submodule"]);
			const baseNow = git(repo.root, ["rev-parse", "HEAD"]);

			legacyBranchPreflight({ root: repo.root, initiative_slug: slug, base_head: baseNow });

			// Scope INCLUDES the submodule; the child modifies tracked content
			// inside it without committing there, plus an in-scope parent file.
			const taskId = "task-sub-inscope";
			writeChildAudit(repo.root, taskId, "done", baseNow, {
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: "Sub inscope goal",
				scope_hint: ["src/allowed.ts", "vendor/sub"],
				acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
				risk: "material",
				revision: 1,
			});
			mkdirSync(join(repo.root, "src"), { recursive: true });
			writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");
			writeFileSync(join(repo.root, "vendor", "sub", "f.txt"), "2\n");

			await expect(
				commitBatchChild({
					root: repo.root,
					taskId,
					batchId: "batch-sub-inscope-1",
					expectedHead: baseNow,
				}),
			).rejects.toThrow(/residual unstaged changes/);

			// Nothing was committed and no evidence was produced
			expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(
				git(repo.root, ["rev-parse", `imm/${slug}`]),
			);
			expect(existsSync(join(repo.root, ".imm", "state", "batches", "commits", "batch-sub-inscope-1-task-sub-inscope.json"))).toBe(false);
		} finally {
			rmSync(srcRepo, { recursive: true, force: true });
		}
	});
});

function commitFile(root: string, name: string): string {
	writeFileSync(join(root, name), `${name}\n`);
	git(root, ["add", name]);
	git(root, ["commit", "-qm", `commit ${name}`]);
	return git(root, ["rev-parse", "HEAD"]);
}

describe("batch HEAD lineage classification", () => {
	let root: string;
	let base: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "batch-lineage-"));
		git(root, ["init", "-b", "main"]);
		git(root, ["config", "user.name", "Test"]);
		git(root, ["config", "user.email", "test@example.com"]);
		base = commitFile(root, "base.txt");
		git(root, ["checkout", "-qb", "imm/demo"]);
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("reports equal when HEAD is the recorded head", () => {
		expect(classifyBatchLineage({ root, branch: "imm/demo", expectedHead: base, childCommits: [] })).toEqual({
			kind: "equal",
			head: base,
		});
	});

	it("adopts a fast-forward commit on the batch branch", () => {
		const outside = commitFile(root, "outside.txt");
		expect(classifyBatchLineage({ root, branch: "imm/demo", expectedHead: base, childCommits: [] })).toEqual({
			kind: "fast_forward",
			head: outside,
		});
	});

	it("adopts a fast-forward that sits on top of a recorded child commit", () => {
		const child = commitFile(root, "child.txt");
		const outside = commitFile(root, "outside.txt");
		expect(classifyBatchLineage({ root, branch: "imm/demo", expectedHead: child, childCommits: [child] })).toEqual({
			kind: "fast_forward",
			head: outside,
		});
	});

	it("refuses a fast-forward that claims this batch's trailer without recorded evidence", () => {
		writeFileSync(join(root, "forged.txt"), "forged\n");
		git(root, ["add", "forged.txt"]);
		git(root, ["commit", "-qm", "forged\n\nImmune-Brain-Batch: batch-1"]);
		const result = classifyBatchLineage({ root, branch: "imm/demo", expectedHead: base, childCommits: [], batchId: "batch-1" });
		expect(result.kind).toBe("broken");
		if (result.kind === "broken") expect(result.message).toContain("without recorded evidence");
	});

	it("adopts a fast-forward that carries another batch's trailer", () => {
		writeFileSync(join(root, "other.txt"), "other\n");
		git(root, ["add", "other.txt"]);
		git(root, ["commit", "-qm", "other\n\nImmune-Brain-Batch: batch-2"]);
		expect(classifyBatchLineage({ root, branch: "imm/demo", expectedHead: base, childCommits: [], batchId: "batch-1" }).kind).toBe(
			"fast_forward",
		);
	});

	it("keeps a different branch fatal", () => {
		git(root, ["checkout", "-qb", "other"]);
		const result = classifyBatchLineage({ root, branch: "imm/demo", expectedHead: base, childCommits: [] });
		expect(result.kind).toBe("broken");
		if (result.kind === "broken") expect(result.message).toContain("batch_head_lineage_broken");
	});

	it("keeps a detached HEAD fatal", () => {
		git(root, ["checkout", "-q", "--detach"]);
		const result = classifyBatchLineage({ root, branch: "imm/demo", expectedHead: base, childCommits: [] });
		expect(result.kind).toBe("broken");
	});

	it("keeps a recorded head that is not an ancestor of HEAD fatal", () => {
		const child = commitFile(root, "child.txt");
		git(root, ["reset", "-q", "--hard", base]);
		commitFile(root, "diverged.txt");
		const result = classifyBatchLineage({ root, branch: "imm/demo", expectedHead: child, childCommits: [child] });
		expect(result.kind).toBe("broken");
		if (result.kind === "broken") expect(result.message).toContain("batch_head_lineage_broken");
	});

	it("keeps an unreachable recorded child commit fatal even when the head still descends", () => {
		const child = commitFile(root, "child.txt");
		git(root, ["checkout", "-q", "--orphan", "rewritten"]);
		git(root, ["branch", "-D", "imm/demo"]);
		git(root, ["branch", "-m", "imm/demo"]);
		const rewritten = commitFile(root, "rewritten.txt");
		const result = classifyBatchLineage({ root, branch: "imm/demo", expectedHead: rewritten, childCommits: [child] });
		expect(result.kind).toBe("broken");
		if (result.kind === "broken") expect(result.message).toContain(child);
	});
});

describe("expected batch head with adopted commits", () => {
	it("follows the adoption chain from the last child commit", () => {
		const record = {
			base_head: "a".repeat(40),
			commits: ["b".repeat(40)],
			adopted_heads: [
				{ from: "b".repeat(40), to: "c".repeat(40) },
				{ from: "c".repeat(40), to: "d".repeat(40) },
			],
		};
		expect(expectedBatchHead(record)).toBe("d".repeat(40));
	});

	it("follows an adoption recorded before any child commit", () => {
		const record = {
			base_head: "a".repeat(40),
			commits: [],
			adopted_heads: [{ from: "a".repeat(40), to: "c".repeat(40) }],
		};
		expect(expectedBatchHead(record)).toBe("c".repeat(40));
	});

	it("ignores an adoption that predates the last child commit", () => {
		const record = {
			base_head: "a".repeat(40),
			commits: ["e".repeat(40)],
			adopted_heads: [{ from: "a".repeat(40), to: "c".repeat(40) }],
		};
		expect(expectedBatchHead(record)).toBe("e".repeat(40));
	});
});
