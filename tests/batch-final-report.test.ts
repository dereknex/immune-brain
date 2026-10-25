import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalIntentHash, intentAuthorityHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { buildBatchFinalReport, returnBatchToCoordinator } from "../plugins/immune-brain/runtime/unattended/batch_final_report";
import { runFinalVerification } from "../plugins/immune-brain/runtime/unattended/batch_final_verification";
import { writeBatchLaneRunState, readBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import type { BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]) {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fixture(mode = "manual") {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-final-report-")));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	writeFileSync(join(root, "AGENTS.md"), `- Git integration: ${mode}\n`);
	writeFileSync(join(root, "value.txt"), "base\n");
	mkdirSync(join(root, ".imm"));
	writeFileSync(join(root, ".imm/risk-floor.json"), JSON.stringify({ contract: "assurance_kernel/risk_floor/v1", critical: { changed_only: ["extra.txt"] } }));
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: "child", owner: "user", goal: "Deliver child",
		scope_hint: ["value.txt"], risk: "material", revision: 1,
		acceptance: [{ id: "AC1", assertion: "value delivered", verification: "bun --version" }, { id: "AC2", assertion: "extra delivered", verification: "bun --version" }] });
	git(root, "checkout", "-qb", "imm/example");
	writeFileSync(join(root, "value.txt"), "delivered\n");
	writeFileSync(join(root, "extra.txt"), "outside estimate\n");
	const hash = canonicalIntentHash(intent);
	const auditPath = join(root, ".imm/audit/child");
	mkdirSync(auditPath, { recursive: true });
	const record = { contract: "assurance_kernel/task_record/v4", task_id: "child", intent_snapshot: intent,
		intent_ref: { path: "docs/plans/child.intent.json", content_hash: hash }, lifecycle: "done", artifact_state: "frozen", baseline: hash, git_base_head: base,
		attestations: [{ id: "qa-current", kind: "qa", authority_role: "qa", task_revision: 1, intent_content_hash: hash, diff_hash: `sha256:${"1".repeat(64)}`,
			actor_id: "qa", summary: "passed", acceptance_results: [{ acceptance_id: "AC1", status: "passed", summary: "passed" }, { acceptance_id: "AC2", status: "passed", summary: "passed" }] }], findings: [], history: [] };
	const bytes = JSON.stringify(record, null, 2) + "\n";
	writeFileSync(join(auditPath, "task-record.json"), bytes);
	writeFileSync(join(auditPath, "terminal-proof.json"), JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: "child", lifecycle_status: "terminal", terminal_lifecycle: "done",
		terminal_event_id: "evt-child", final_record_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, terminalized_at: "2026-01-01T00:00:00.000Z" }));
	git(root, "add", ".");
	git(root, "commit", "-qm", "child");
	const head = git(root, "rev-parse", "HEAD");
	git(root, "checkout", "-q", "main");
	const batch: BatchLaneRunStateRecord = { contract: "assurance_kernel/batch_run_state/v2", progress_mode: "parent_branch", batch_id: "batch-example", initiative_slug: "example", plan_digest: `sha256:${"2".repeat(64)}`,
		base_head: base, branch: "refs/heads/imm/example", confirmation_time: "2026-01-01T00:00:00.000Z", budget: { max_children: 2, qa_failure_limit: 2 }, max_parallel: 1, batch_state: "running",
		children: [{ task_id: "child", slice_id: "S1", blocked_by: [], state: "integrated", reason: null, commit: head, qa_failures: 0, redo_grants: 2,
			lane: { path: join(root, "removed-lane"), branch: "imm-lane/example/child", base_head: base, lane_commit: head } }], commits: [head], created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
	const snapshot = () => ({ head: git(root, "rev-parse", "HEAD"), branch: git(root, "rev-parse", "--abbrev-ref", "HEAD"), index: readFileSync(join(root, ".git/index")).toString("hex"), value: readFileSync(join(root, "value.txt"), "utf8") });
	const verify = async (command = "git status --short") => batch.final_verification_result = await runFinalVerification(root, [command], { parent_head: head });
	return { root, base, head, batch, snapshot, verify };
}

describe("D24 final report and coordinator return", () => {
	test("reports approved acceptance vs QA, whole child diff, projected risk and redo count after Lane removal", async () => {
		const fx = fixture();
		await fx.verify();
		const before = fx.snapshot();
		const report = await buildBatchFinalReport(fx.root, fx.batch);
		expect(report).toMatchObject({ head: fx.head, children: [{ task_id: "child", acceptance: [{ id: "AC1", qa: "passed" }, { id: "AC2", qa: "passed" }], beyond_estimate: ["extra.txt"], declared_risk: "material", projected_risk: "critical", redo_count: 2, parked_reason: null }], final_verification: { passed: true, head: fx.head } });
		expect(fx.snapshot()).toEqual(before);
		fx.batch.final_report = report;
		fx.batch.batch_state = "completed";
		writeBatchLaneRunState(fx.root, fx.batch);
		expect(readBatchLaneRunState(fx.root, fx.batch.batch_id)?.final_report).toEqual(report);
	});

	test("manual leaves the Parent branch, coordinator tree and index unchanged", async () => {
		const fx = fixture();
		await fx.verify();
		const before = fx.snapshot();
		expect(returnBatchToCoordinator(fx.root, fx.head, fx.batch.final_verification_result!)).toEqual({ mode: "manual", status: "manual", reason: null });
		expect(fx.snapshot()).toEqual(before);
		expect(git(fx.root, "rev-parse", "imm/example")).toBe(fx.head);
	});

	test("auto fast-forwards only the coordinator's existing branch and is idempotent", async () => {
		const fx = fixture("auto");
		await fx.verify();
		for (let i = 0; i < 2; i++) expect(returnBatchToCoordinator(fx.root, fx.head, fx.batch.final_verification_result!)).toMatchObject({ status: "fast_forwarded", reason: null });
		expect(git(fx.root, "symbolic-ref", "--short", "HEAD")).toBe("main");
		expect(git(fx.root, "rev-parse", "HEAD")).toBe(fx.head);
		expect(readFileSync(join(fx.root, "value.txt"), "utf8")).toBe("delivered\n");
		expect(git(fx.root, "rev-parse", "imm/example")).toBe(fx.head);
	});

	for (const dirty of ["tracked", "staged", "untracked", "diverged", "detached"]) test(`auto stops without modifying a ${dirty} coordinator`, async () => {
		const fx = fixture("auto");
		await fx.verify();
		if (dirty === "tracked" || dirty === "staged") {
			writeFileSync(join(fx.root, "value.txt"), "local\n");
			if (dirty === "staged") git(fx.root, "add", "value.txt");
		} else if (dirty === "untracked") writeFileSync(join(fx.root, "local.txt"), "local\n");
		else if (dirty === "diverged") git(fx.root, "commit", "--allow-empty", "-qm", "user commit");
		else git(fx.root, "checkout", "--detach", "-q");
		const before = fx.snapshot();
		const report = await buildBatchFinalReport(fx.root, fx.batch);
		report.return_to_coordinator = returnBatchToCoordinator(fx.root, fx.head, fx.batch.final_verification_result!);
		expect(report.return_to_coordinator).toMatchObject({ status: "blocked", reason: dirty === "diverged" ? "coordinator_head_diverged" : dirty === "detached" ? "coordinator_branch_unavailable" : "coordinator_working_tree_dirty" });
		expect(fx.snapshot()).toEqual(before);
		expect(report.children).toHaveLength(1);
	});

	test("failed or missing final verification never moves auto, but keeps the report", async () => {
		const fx = fixture("auto");
		const before = fx.snapshot();
		for (const final of [null, await fx.verify("git no-such-command")]) {
			expect(returnBatchToCoordinator(fx.root, fx.head, final)).toMatchObject({ status: "blocked", reason: "final_verification_not_passed" });
		}
		expect((await buildBatchFinalReport(fx.root, fx.batch)).final_verification?.passed).toBe(false);
		expect(fx.snapshot()).toEqual(before);
	});

	for (const state of ["needs_human", "skipped_blocked"] as const) test(`${state} report uses approved uncommitted planning evidence`, async () => {
		const fx = fixture();
		const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: "parked", owner: "user", goal: "parked child", scope_hint: ["parked.txt"], risk: "routine", revision: 1, acceptance: [{ id: "AC1", assertion: "delivered", verification: "bun --version" }] });
		// This approved input exists only in the coordinator, not either committed tree.
		mkdirSync(join(fx.root, "docs/plans"), { recursive: true });
		const intentPath = "docs/plans/parked.intent.json";
		writeFileSync(join(fx.root, intentPath), JSON.stringify(intent));
		fx.batch.intent_identities = { parked: { intent_path: intentPath, intent_revision: intent.revision, intent_content_hash: canonicalIntentHash(intent),
			...(state === "skipped_blocked" ? { intent_authority_hash: intentAuthorityHash(intent) } : {}),
		} };
		fx.batch.children.push({ task_id: "parked", slice_id: "S2", blocked_by: [], state, reason: "redo budget exhausted", commit: null, lane: null, qa_failures: 0, redo_grants: 2 });
		const before = fx.snapshot();
		expect((await buildBatchFinalReport(fx.root, fx.batch)).children[1]).toMatchObject({ acceptance: [{ id: "AC1", qa: null }], beyond_estimate: null, projected_risk: null, redo_count: 2, parked_reason: "redo budget exhausted" });
		expect(fx.snapshot()).toEqual(before);
		writeFileSync(join(fx.root, intentPath), JSON.stringify({ ...intent, acceptance: [{ ...intent.acceptance[0], id: "unapproved" }] }));
		await expect(buildBatchFinalReport(fx.root, fx.batch)).rejects.toThrow("planning evidence changed");
	});

	test("carries a child's runtime_skew_acknowledged and omits it otherwise", async () => {
		const fx = fixture();
		expect((await buildBatchFinalReport(fx.root, fx.batch)).children[0]).not.toHaveProperty("runtime_skew_acknowledged");
		const skew = { commit: fx.head, parent_bundle: `sha256:${"3".repeat(64)}`, loaded_bundle: `sha256:${"4".repeat(64)}` };
		fx.batch.children[0]!.runtime_skew_acknowledged = skew;
		expect((await buildBatchFinalReport(fx.root, fx.batch)).children[0]!.runtime_skew_acknowledged).toEqual(skew);
	});

	test("missing committed audit is a failure, not a green final report", async () => {
		const fx = fixture();
		fx.batch.children[0]!.task_id = "missing";
		await expect(buildBatchFinalReport(fx.root, fx.batch)).rejects.toThrow("missing settled evidence");
	});
});
