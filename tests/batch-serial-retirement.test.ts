import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { projectBatchPreflight } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import { readStaleBatchLookup, retireStaleBatch } from "../plugins/immune-brain/runtime/unattended/batch_disposition";
import { startBatch, type BatchRunnerKernelPort, type StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { prepareBatchRunState, readAnyBatchRunState, writeBatchRunState, type BatchLaneRunReport } from "../plugins/immune-brain/runtime/unattended/batch_state";

import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { readSettledRunEvidence } from "../plugins/immune-brain/runtime/kernel/storage";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { projectTaskStatus } from "../plugins/immune-brain/runtime/assurance/coordinator";

const now = "2026-01-01T00:00:00.000Z";
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(independent = false) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-retirement-")));
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	const children = ["first", "second"].map((task_id, index) => {
		const intent_path = `docs/plans/${task_id}.intent.json`;
		writeFileSync(join(root, intent_path), JSON.stringify({
			contract: "assurance_kernel/task_intent/v1", task_id, owner: "user", risk: "routine", revision: 1,
			goal: `Deliver ${task_id}`, scope_hint: [`${task_id}.txt`], acceptance: [{ id: "A1", assertion: "delivery exists", verification: JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["-e", `if (await Bun.file('${task_id}.txt').text() !== 'delivered\\n') process.exit(1)`], cwd: ".", timeout_ms: 10000, max_output_bytes: 4096 },
				environment: { prepare: null, writable_paths: [] },
			}) }],
		}));
		return { task_id, slice_id: `S${index + 1}`, blocked_by: index && !independent ? ["first"] : [], status: "enrollable" as const,
			reason: null, intent_path, intent_revision: 1, intent_content_hash: canonicalIntentHash(parseTaskIntentV1(JSON.parse(readFileSync(join(root, intent_path), "utf8")))) };
	});
	git(root, "init", "-q", "-b", "main"); git(root, "add", "."); git(root, "commit", "-qm", "plan");
	const base = git(root, "rev-parse", "HEAD");
	const registry = createBatchAuthorityRegistry();
	const plan_digest = computeBatchPlanDigest(children);
	const budget = { max_children: 2, qa_failure_limit: 3 };
	const binding = { batch_id: "retirement-batch", initiative_slug: "retirement", plan_digest, branch: "main", base_head: base,
		budget, actor_id: "user", confirmation_ref: "confirmed", nonce: "retirement" };
	const capability = registry.issue(binding, children, now);
	// Only the Kernel lifecycle is scripted. Worktree creation, scheduling, Git
	// commits, candidate verification, integration, serialization and cleanup are real.
	const enrolled = new Map<string, string>(); const settled = new Set<string>();
	const kernel: BatchRunnerKernelPort = {
		enrollTask: async ({ root: lane, task_id }) => { enrolled.set(task_id, lane); return { record_revision: "r1" }; },
		advanceTask: async () => { throw new Error("unfrozen delivery must not run QA"); },
		ownsTaskClaim: task => enrolled.has(task),
		validateBatchAuthorization: ({ registry, capability }) => registry.inspect(capability, binding),
		projectTask: async (_root, task_id) => ({ task_id, error: null,
			claim: enrolled.has(task_id) && !settled.has(task_id) ? { task_id, lifecycle_status: "active" } : null,
			projection: { run_id: enrolled.has(task_id) ? `run-${task_id}` : null, record_revision: "r1", lifecycle: settled.has(task_id) ? "done" : "active",
				artifact_state: "active", completion_ready: settled.has(task_id), open_user_decision_count: 0, replan_required_ids: [], next_obligation: "submit_assurance" },
		} as unknown as AssuranceProjectionResult),
	};
	const input: StartBatchInput = { root, ...binding, children, registry, capability, confirmation_time: now, now, kernel };
	const snapshot = () => ({ head: git(root, "rev-parse", "HEAD"), branch: git(root, "symbolic-ref", "HEAD"), refs: git(root, "show-ref"),
		index: readFileSync(join(root, ".git/index")), status: git(root, "status", "--porcelain=v1"), worktrees: git(root, "worktree", "list", "--porcelain") });
	return { root, input, enrolled, settled, base, snapshot, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("serial runner retirement", () => {
	for (const max_parallel of [undefined, 1]) it(`AC1: max_parallel=${max_parallel ?? "omitted"} runs one runtime-created Lane at a time`, async () => {
		const f = fixture();
		try {
			writeFileSync(join(f.root, "user.txt"), "staged\n"); git(f.root, "add", "user.txt");
			writeFileSync(join(f.root, "user.txt"), "unstaged\n");
			const before = f.snapshot();
			const input = { ...f.input, ...(max_parallel === undefined ? {} : { max_parallel }) };
			const tick = async () => await startBatch(input) as unknown as BatchLaneRunReport;
			const first = await tick();
			expect(first).toMatchObject({ batch_state: "running", max_parallel: 1, children: [{ state: "enrolled" }, { state: "pending" }] });
			expect(first.handoffs).toMatchObject([{ role: "executor", task_id: "first" }]);
			expect(f.enrolled.size).toBe(1);
			const statePath = join(f.root, ".imm/state/batches/retirement-batch.json");
			expect(readAnyBatchRunState(f.root, input.batch_id)).toMatchObject({ contract: "assurance_kernel/batch_run_state/v2", max_parallel: 1, branch: "refs/heads/imm/retirement" });
			const persisted = readFileSync(statePath);
			expect((await tick()).handoffs).toEqual(first.handoffs);
			expect(readFileSync(statePath)).toEqual(persisted);
			for (const [index, task] of ["first", "second"].entries()) {
				const lane = f.enrolled.get(task)!;
				expect(lane).toBe(join(f.root, ".git/imm/worktrees/retirement", task));
				expect(git(lane, "branch", "--show-current")).toBe(`imm-lane/retirement/${task}`);
				expect(existsSync(join(lane, "user.txt"))).toBe(false);
				if (index) expect(readFileSync(join(lane, "first.txt"), "utf8")).toBe("delivered\n");
				writeFileSync(join(lane, `${task}.txt`), "delivered\n");
				const intent = readTaskIntent(lane, task);
				seedKernelRunForTest(lane, { task_id: task, run_id: `run-${task}`, terminal: { lifecycle: "done" }, record: {
					contract: "assurance_kernel/task_record/v4", task_id: task, intent_snapshot: intent.intent,
					intent_ref: { path: `docs/plans/${task}.intent.json`, content_hash: intent.content_hash }, lifecycle: "done", artifact_state: "frozen",
					baseline: `sha256:${"a".repeat(64)}`, git_base_head: git(lane, "rev-parse", "HEAD"), attestations: [], findings: [], history: [],
				} });
				const evidence = readSettledRunEvidence(lane, task)!;
				const audit = join(lane, `.imm/audit/${task}/run-${task}`);
				mkdirSync(audit, { recursive: true });
				writeFileSync(join(audit, "task-record.json"), evidence.record_json);
				writeFileSync(join(audit, "terminal-proof.json"), evidence.proof_json);
				git(lane, "add", `${task}.txt`, ".imm/audit");
				f.settled.add(task);
				const report = await tick();
				expect(report.commits, JSON.stringify(report)).toHaveLength(index + 1);
				expect(git(f.root, "show", `${report.commits[index]}:${task}.txt`)).toBe("delivered");
				expect(existsSync(lane)).toBe(false);
				if (!index) {
					expect(report.children.map(c => c.state)).toEqual(["released", "enrolled"]);
					expect(report.handoffs).toMatchObject([{ role: "executor", task_id: "second" }]);
				} else expect(report).toMatchObject({ batch_state: "completed", children: [{ state: "released" }, { state: "released" }], handoffs: [] });
			}
			const after = f.snapshot();
			for (const key of ["head", "branch", "index", "status", "worktrees"] as const) expect(after[key]).toEqual(before[key]);
			expect(git(f.root, "log", "--format=%P", `${f.base}..refs/heads/imm/retirement`).split("\n")).toHaveLength(2);
		} finally { f.cleanup(); }
	}, 60000);

	it.each(["dependency", "reverse-dependency", "cycle", "missing-dependency", "removed-child", "slice"])(
		"AC1: resume refuses changed Parent topology (%s) without touching the existing Lane or authorization", async variant => {
			const f = fixture(true);
			try {
				await startBatch(f.input);
				const original = f.input.children.map(child => ({ task_id: child.task_id, slice_id: child.slice_id, blocked_by: [...child.blocked_by] }));
				let tasks = original;
				const options = { root: f.root, initiative_slug: "retirement", now, readInitiative: async () => ({
					contract: "immune_brain/local_initiative_observation/v1" as const, initiative_id: "retirement", tasks,
				}) };
				const path = join(f.root, ".imm/state/batches/retirement-batch.json");
				const bytes = readFileSync(path); const before = f.snapshot();
				expect((await projectBatchPreflight(options)).ok).toBe(true);
				// Carrier enumeration order is not topology; the plan normalizes it.
				tasks = [...original].reverse();
				expect((await projectBatchPreflight(options)).ok).toBe(true);
				tasks = structuredClone(original);
				if (variant === "dependency") tasks[1]!.blocked_by = ["first"];
				if (variant === "reverse-dependency") tasks[0]!.blocked_by = ["second"];
				if (variant === "cycle") { tasks[0]!.blocked_by = ["second"]; tasks[1]!.blocked_by = ["first"]; }
				if (variant === "missing-dependency") tasks[0]!.blocked_by = ["absent"];
				if (variant === "removed-child") tasks.pop();
				if (variant === "slice") tasks[0]!.slice_id = "changed";
				expect(await projectBatchPreflight(options)).toMatchObject({ ok: false, reason: expect.stringContaining("plan changed") });
				expect(readFileSync(path)).toEqual(bytes); expect(f.snapshot()).toEqual(before);
				expect([...f.enrolled.keys()]).toEqual(["first"]);
			} finally { f.cleanup(); }
		}, 60000);

	it("AC2: v1 is readable and explicitly retireable, but neither preflight nor runner resumes it", async () => {
		const f = fixture();
		try {
			const record = prepareBatchRunState({ ...f.input, branch: "imm/retirement" });
			record.batch_state = "running";
			writeBatchRunState(f.root, record);
			const path = join(f.root, ".imm/state/batches/retirement-batch.json");
			const bytes = readFileSync(path); const before = f.snapshot();
			const runtime = new ClaudeRuntime({ cwd: f.root, sessionId: "legacy-status" });
			const expectedBatch = { corrupt: false, record: { contract: record.contract, batch_id: record.batch_id,
				initiative_slug: "retirement", batch_state: "running", children: record.children, commits: record.commits, branch: record.branch } };
			// The Claude public status path and the shared Pi status projection both expose evidence, not a resume grant.
			expect((await runtime.status("retirement")).batch).toMatchObject(expectedBatch);
			expect((await projectTaskStatus(f.root, "retirement")).batch).toMatchObject(expectedBatch);
			expect(readFileSync(path)).toEqual(bytes); expect(f.snapshot()).toEqual(before);
			expect(readAnyBatchRunState(f.root, record.batch_id)).toMatchObject({ contract: record.contract, children: record.children });
			expect(readStaleBatchLookup(f.root, "retirement").kind).toBe("retirable");
			const preflight = await projectBatchPreflight({ root: f.root, initiative_slug: "retirement", now });
			expect(preflight).toMatchObject({ ok: false, reason: expect.stringContaining("batch_record_shape_retired"), recovery_action: expect.stringContaining("retire_stale_batch") });
			for (const max_parallel of [undefined, 1, 2]) {
				const refused = await startBatch({ ...f.input, max_parallel });
				expect(refused).toMatchObject({ batch_state: "rejected", reason: expect.stringContaining("batch_record_shape_retired"), next_action: expect.stringContaining("retire_stale_batch") });
				expect(readFileSync(path)).toEqual(bytes); expect(f.snapshot()).toEqual(before);
			}
			let gates = 0;
			const retired = await retireStaleBatch({ root: f.root, initiative_slug: "retirement", now, gate: async facts => {
				gates++; expect(facts).toMatchObject({ batch_id: record.batch_id, children: record.children.map(c => ({ task_id: c.task_id, state: c.state })) });
				return { kind: "confirmed", request_id: "retire-confirmed" };
			} });
			expect(retired.outcome).toBe("retired"); expect(gates).toBe(1);
			expect(readAnyBatchRunState(f.root, record.batch_id)).toMatchObject({ contract: record.contract, batch_state: "superseded", children: record.children, commits: record.commits, branch: record.branch });
			const retiredBytes = readFileSync(path);
			expect((await runtime.status("retirement")).batch).toMatchObject({ ...expectedBatch,
				record: { ...expectedBatch.record, batch_state: "superseded" } });
			expect(readFileSync(path)).toEqual(retiredBytes);
			expect(f.snapshot()).toEqual(before); expect(f.enrolled.size).toBe(0);
		} finally { f.cleanup(); }
	});
});
