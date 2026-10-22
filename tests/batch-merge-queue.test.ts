import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { localRunId, readTaskRecordRaw, recoverKernelStoreFollowUps } from "../plugins/immune-brain/runtime/kernel/storage";
import { readRunRowByTask, readWorkspaceRow, updateRunTerminal, withKernelTransaction, writeWorkspaceRow } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { createBatchKernelPort, deriveChildRedoEnrollment } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { createLaneWorktree, recreateLaneWorktree, removeLaneWorktree, withParentWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";
import { runBatchGitPreflight, type BatchRunnerGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { createDefaultLaneGitPort, runLaneBatch } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { readBatchLaneRunState, writeBatchLaneRunState, type BatchLaneRunReport } from "../plugins/immune-brain/runtime/unattended/batch_state";
import type { StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";

const NOW = "2026-10-20T00:00:00.000Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], {
		encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function fixture(scripts: Record<string, string>, dependencies: Record<string, string[]> = {}, setup?: (root: string) => void) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "batch-queue-")));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	for (const [id, script] of Object.entries(scripts)) {
		writeFileSync(join(root, `docs/plans/${id}.intent.json`), JSON.stringify({
			contract: "assurance_kernel/task_intent/v1", task_id: id, owner: "user", goal: `deliver ${id}`,
			acceptance: [{ id: "AC1", assertion: `${id} works`, verification: JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["-e", script], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
				environment: { prepare: null, writable_paths: [] },
			}) }], scope_hint: [`${id}.txt`], risk: "material", revision: 1,
		}));
	}
	setup?.(root);
	git(root, "add", "-A"); git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	const children = Object.keys(scripts).map((id, i) => {
		const read = readTaskIntent(root, id);
		return { task_id: id, slice_id: `S${i + 1}`, blocked_by: dependencies[id] ?? [], status: "enrollable" as const,
			reason: null, intent_path: read.intent_ref.path, intent_revision: 1, intent_content_hash: read.content_hash };
	});
	const binding = { batch_id: "queue", initiative_slug: "queue", plan_digest: computeBatchPlanDigest(children),
		branch: "main", base_head: base, budget: { max_children: children.length, qa_failure_limit: 3 },
		actor_id: "user", confirmation_ref: "confirm", nonce: "nonce" };
	const registry = createBatchAuthorityRegistry();
	const capability = registry.issue(binding, children, NOW);
	const kernel = createBatchKernelPort({ root, registry, capability, binding, enrollmentRegistry: createEnrollmentAuthorityRegistry(),
		advanceTask: async () => { throw new Error("unfrozen implementation must stay with the Executor"); },
		resume: { isResuming: false, existingBatch: null, batchBranch: "refs/heads/imm/queue" },
		overrides: { projectTask: async (lane, id) => {
			const fresh = await projectAssurance(lane, id);
			// Tests supply terminal Kernel facts; real Enrollment and the merge guard remain production code.
			if (fresh.projection.lifecycle === "done") fresh.projection.completion_ready = true;
			return fresh;
		} },
	});
	const lanePort = createDefaultLaneGitPort();
	const port: BatchRunnerGitPort = {
		preflight: runBatchGitPreflight,
		lookupBatchCommit: async () => null,
		commitChild: async (lane, id, batchId) => {
			git(lane, "add", "-A"); git(lane, "commit", "-qm", `imm(${id}): deliver\n\nImmune-Brain-Batch: ${batchId}`);
			return { commit: git(lane, "rev-parse", "HEAD") };
		},
	};
	const input: StartBatchInput = { ...binding, root, children, registry, capability, confirmation_time: NOW, now: NOW,
		kernel, git: Object.assign(port, { lane: lanePort }), max_parallel: children.length };
	let report: BatchLaneRunReport;
	const tick = async () => report = await runLaneBatch(input, readBatchLaneRunState(root, "queue"));
	const laneOf = (id: string) => report.children.find(c => c.task_id === id)!.lane!.path;
	// Simulate a child's QA/Review settlement, preserving its actual enrolled run identity.
	const settle = (id: string, body = "delivered\n", second = 1) => {
		const lane = laneOf(id);
		writeFileSync(join(lane, `${id}.txt`), body);
		const record = readTaskRecordRaw(lane, id).record!;
		const bytes = `${JSON.stringify({ ...record, lifecycle: "done", artifact_state: "frozen" })}\n`;
		const at = `2026-10-20T00:00:${String(second).padStart(2, "0")}.000Z`;
		withKernelTransaction(lane, db => {
			const run = readRunRowByTask(db, id)!;
			const proof = JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: id, lifecycle_status: "terminal",
				terminal_lifecycle: "done", terminal_event_id: `terminal-${run.run_id}`,
				final_record_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, terminalized_at: at });
			updateRunTerminal(db, run.run_id, "done", bytes, proof, at);
			writeWorkspaceRow(db, readWorkspaceRow(db).revision, null, at);
		});
		recoverKernelStoreFollowUps(lane, id);
	};
	return { root, base, input, tick, laneOf, settle, lanePort };
}

const pass = "process.exit(0)";
const mergedCheck = "const fs=require('node:fs'); process.exit(fs.existsSync('a.txt') && fs.readFileSync('b.txt','utf8').trim() === 'old' ? 1 : 0)";

describe("Parent merge queue", () => {
	test("no-touch integration parks the child without a redo or Parent advance", async () => {
		const fx = fixture({ a: pass });
		await fx.tick();
		mkdirSync(join(fx.laneOf("a"), ".github/workflows"), { recursive: true });
		writeFileSync(join(fx.laneOf("a"), ".github/workflows/ci.yml"), "changed\n");
		fx.settle("a");
		const report = await fx.tick();
		expect(report.children[0]!.state).toBe("needs_human");
		expect(report.children[0]!.reason).toContain("no_touch_path_changed: .github/workflows/ci.yml");
		expect(report.children[0]!.redo_grants ?? 0).toBe(0);
		expect(git(fx.root, "rev-parse", "refs/heads/imm/queue")).toBe(fx.base);
	}, 30000);
	test("derived outputs regenerate from both settled children without spending a redo", async () => {
		const fx = fixture({ a: pass, b: pass }, {}, root => {
			mkdirSync(join(root, "docs/agents"), { recursive: true });
			writeFileSync(join(root, "bundle.txt"), "base");
			writeFileSync(join(root, "generate.ts"), `const fs=require('node:fs'); const expected=['a','b'].map(id=>fs.existsSync(id+'.txt')?fs.readFileSync(id+'.txt','utf8'):'').join('');
if(process.argv.includes('--check')) process.exit(fs.readFileSync('bundle.txt','utf8')===expected?0:1); fs.writeFileSync('bundle.txt',expected);`);
			writeFileSync(join(root, "docs/agents/derived-files.json"), JSON.stringify({ contract: "immune_brain/derived_files/v1", entries: [{
				id: "bundle", sources: ["a.txt", "b.txt", "generate.ts"], outputs: ["bundle.txt"],
				generate: { executable: "bun", argv: ["generate.ts"] }, check: { executable: "bun", argv: ["generate.ts", "--check"] },
			}] }));
		});
		const integrate = fx.lanePort.integrate;
		fx.lanePort.integrate = input => {
			expect(input.declaration_head).toBe(fx.base);
			return integrate(input);
		};
		await fx.tick();
		for (const [id, second] of [["a", 1], ["b", 2]] as const) {
			writeFileSync(join(fx.laneOf(id), "bundle.txt"), `${id}\n`);
			fx.settle(id, `${id}\n`, second);
		}
		const report = await fx.tick();
		expect(report.batch_state).toBe("completed");
		expect(report.children.map(child => child.redo_grants ?? 0)).toEqual([0, 0]);
		expect(git(fx.root, "show", `${report.commits[1]}:bundle.txt`)).toBe("a\nb");
		expect(readBatchLaneRunState(fx.root, "queue")!.final_verification_result).toMatchObject({ passed: true, derived_checks: [{ id: "bundle", passed: true }] });
		expect((await fx.tick()).commits).toEqual(report.commits);
	}, 30000);

	test("AC1: integrates in settlement order, rebuilding the second on the first Parent tip", async () => {
		const fx = fixture({ a: pass, b: pass });
		await fx.tick();
		fx.settle("b", "b\n", 1); fx.settle("a", "a\n", 2);
		const integrated: Array<{ task: string; head: string; commit: string }> = [];
		const integrate = fx.lanePort.integrate;
		fx.lanePort.integrate = async input => {
			integrated.push({ task: input.child.task_id, head: input.batch_head, commit: input.lane_commit });
			return integrate(input);
		};
		const report = await fx.tick();
		expect(report.batch_state).toBe("completed");
		expect(git(fx.root, "log", "--format=%s", `${fx.base}..refs/heads/imm/queue`).split("\n")).toEqual(["imm(a): deliver", "imm(b): deliver"]);
		expect(git(fx.root, "rev-parse", `${report.commits[1]}^`)).toBe(report.commits[0]!);
		expect(git(fx.root, "show", `${report.commits[1]}:a.txt`)).toBe("a");
		expect(git(fx.root, "show", `${report.commits[1]}:b.txt`)).toBe("b");
		expect(integrated.map(c => c.task)).toEqual(["b", "a"]);
		expect(integrated[1]!.head).toBe(report.commits[0]!);
		expect(report.commits[0]).toBe(integrated[0]!.commit);
		expect(report.commits[1]).not.toBe(integrated[1]!.commit);
		expect(git(fx.root, "rev-parse", "HEAD")).toBe(fx.base);
	}, 30000);

	test("AC2/AC3: failing merged acceptance leaves Parent unmoved and reenrolls a fresh run on its new tip", async () => {
		const fx = fixture({ a: pass, b: mergedCheck });
		await fx.tick();
		const oldRun = localRunId(fx.laneOf("b"), "b");
		fx.settle("a", "a\n", 1); fx.settle("b", "old\n", 2);
		const redo = await fx.tick();
		expect(redo.children.map(c => c.state)).toEqual(["released", "enrolled"]);
		expect(redo.children[1]).toMatchObject({ redo_grants: 1, lane: { base_head: redo.commits[0], lane_commit: null } });
		expect(git(fx.root, "rev-parse", "refs/heads/imm/queue")).toBe(redo.commits[0]!);
		expect(git(fx.laneOf("b"), "rev-parse", "HEAD")).toBe(redo.commits[0]!);
		expect(existsSync(join(fx.laneOf("b"), "b.txt"))).toBe(false);
		const fresh = readTaskRecordRaw(fx.laneOf("b"), "b").record!;
		expect(fresh).toMatchObject({ lifecycle: "active", artifact_state: "active", attestations: [] });
		expect(localRunId(fx.laneOf("b"), "b")).not.toBe(oldRun);
		expect(redo.handoffs).toContainEqual(expect.objectContaining({ role: "executor", task_id: "b", next_obligation: "submit_assurance" }));
		// Without a new implementation/QA/Review terminal fact it cannot integrate.
		expect((await fx.tick()).commits).toEqual(redo.commits);
		fx.settle("b", "fixed\n", 3);
		const done = await fx.tick();
		expect(done.batch_state).toBe("completed");
		expect(done.children[1]!.redo_grants).toBe(1);
		expect(git(fx.root, "show", `${done.commits[1]}:b.txt`)).toBe("fixed");
	}, 30000);

	test("AC3: a textual conflict recreates the Lane, and its reimplementation integrates", async () => {
		const fx = fixture({ a: pass, b: pass });
		await fx.tick();
		writeFileSync(join(fx.laneOf("a"), "shared.txt"), "from a\n");
		writeFileSync(join(fx.laneOf("b"), "shared.txt"), "from b\n");
		fx.settle("a", "a\n", 1); fx.settle("b", "b\n", 2);
		const redo = await fx.tick();
		expect(redo.children[1]).toMatchObject({ state: "enrolled", redo_grants: 1 });
		expect(readFileSync(join(fx.laneOf("b"), "shared.txt"), "utf8")).toBe("from a\n");
		fx.settle("b", "reimplemented\n", 3);
		expect((await fx.tick()).batch_state).toBe("completed");
	}, 30000);

	for (const interruption of ["before-removal", "after-removal", "after-recreation"] as const)
	test(`resumes a granted redo ${interruption} without spending another grant`, async () => {
		const fx = fixture({ a: pass, b: pass });
		await fx.tick();
		fx.settle("a");
		const first = await fx.tick();
		const head = first.commits[0]!;
		const oldLane = fx.laneOf("b");
		const oldRun = localRunId(oldLane, "b")!;
		fx.settle("b");
		const { commit } = await fx.input.git!.commitChild(oldLane, "b", "queue", fx.base);
		const binding = fx.input.kernel.validateBatchAuthorization({ registry: fx.input.registry, capability: fx.input.capability,
			binding: { batch_id: "queue", plan_digest: fx.input.plan_digest, base_head: fx.base, initiative_slug: "queue", budget: fx.input.budget } });
		await withParentWorktree(fx.root, head, async root => {
			deriveChildRedoEnrollment(root, fx.input.registry, { capability: fx.input.capability, binding,
				task_id: "b", expected_head: head, now: NOW, prior_lane_root: oldLane, prior_run_id: oldRun });
		});
		const record = readBatchLaneRunState(fx.root, "queue")!;
		record.children[1] = { ...record.children[1]!, state: "lane_committed", redo_grants: 1, redo_head: head,
			lane: { ...record.children[1]!.lane!, lane_commit: commit } };
		writeBatchLaneRunState(fx.root, record);
		if (interruption !== "before-removal") {
			expect(removeLaneWorktree(fx.root, oldLane, "imm-lane/queue/b", commit)).toBe(true);
			if (interruption === "after-recreation") createLaneWorktree(fx.root, "queue", "b", head);
		}
		const resumed = await fx.tick();
		expect(resumed.children[1]).toMatchObject({ state: "enrolled", redo_grants: 1, lane: { base_head: head } });
		expect(localRunId(fx.laneOf("b"), "b")).not.toBe(oldRun);
		expect(fx.input.registry.redoGrants(fx.input.capability, "b")).toBe(1);
		expect(resumed.commits).toEqual([head]);
	}, 30000);

	test("never recreates a Lane with a live claim", async () => {
		const fx = fixture({ a: pass });
		await fx.tick();
		const run = localRunId(fx.laneOf("a"), "a");
		expect(() => recreateLaneWorktree(fx.root, "queue", "a", fx.base, fx.base)).toThrow("active claim");
		expect(localRunId(fx.laneOf("a"), "a")).toBe(run);
	}, 30000);

	test("keeps dirty settled Lane data instead of discarding it for an automatic redo", async () => {
		const fx = fixture({ a: pass, b: mergedCheck });
		await fx.tick();
		fx.settle("a", "a\n", 1); fx.settle("b", "old\n", 2);
		const integrate = fx.lanePort.integrate;
		fx.lanePort.integrate = input => {
			if (input.child.task_id === "b") writeFileSync(join(fx.laneOf("b"), "keep.txt"), "user data\n");
			return integrate(input);
		};
		const report = await fx.tick();
		expect(report.children[1]).toMatchObject({ state: "needs_human", reason: expect.stringContaining("clean owned Lane") });
		expect(readFileSync(join(fx.laneOf("b"), "keep.txt"), "utf8")).toBe("user data\n");
	}, 30000);

	test("refuses malformed durable redo metadata", async () => {
		const fx = fixture({ a: pass });
		await fx.tick();
		const record = readBatchLaneRunState(fx.root, "queue")!;
		for (const fields of [{ redo_grants: -1 }, { redo_grants: 3 }, { settled_at: "not-a-time" }, { redo_head: fx.base }]) {
			expect(() => writeBatchLaneRunState(fx.root, { ...record, children: [{ ...record.children[0]!, ...fields }] })).toThrow(/invalid (redo|settled)/);
		}
	}, 30000);

	test("AC4: third conflict parks only that child, skips its dependents and reports redo count 2", async () => {
		const fx = fixture({ a: pass, b: mergedCheck, dependent: pass, independent: pass }, { dependent: ["b"] });
		await fx.tick();
		fx.settle("a", "a\n", 1); fx.settle("b", "old\n", 2);
		for (let attempt = 1; attempt <= 2; attempt++) {
			const redo = await fx.tick();
			expect(redo.children[1]).toMatchObject({ state: "enrolled", redo_grants: attempt });
			// The redo passes its own frozen acceptance; a newer Parent change then conflicts.
			writeFileSync(join(fx.laneOf("b"), "shared.txt"), `lane attempt ${attempt}\n`);
			fx.settle("b", "fixed\n", 2 + attempt);
			const head = git(fx.root, "rev-parse", "refs/heads/imm/queue");
			await withParentWorktree(fx.root, head, async root => {
				writeFileSync(join(root, "shared.txt"), `new Parent ${attempt}\n`);
				git(root, "add", "--", "shared.txt"); git(root, "commit", "-qm", `Parent advances ${attempt}`);
				git(fx.root, "update-ref", "refs/heads/imm/queue", git(root, "rev-parse", "HEAD"), head);
			});
		}
		fx.settle("independent", "independent\n", 5);
		const done = await fx.tick();
		expect(done.batch_state).toBe("needs_human");
		expect(done.children.map(c => c.state)).toEqual(["released", "needs_human", "skipped_blocked", "released"]);
		expect(done.children[1]).toMatchObject({ redo_grants: 2, reason: expect.stringContaining("batch_integration_redo_exhausted") });
		expect(done.commits).toHaveLength(2);
		expect(git(fx.root, "show", `refs/heads/imm/queue:independent.txt`)).toBe("independent");
		const summary = JSON.parse(readFileSync(join(fx.root, ".imm/state/batches/queue.report.json"), "utf8"));
		expect(summary.children[1]).toMatchObject({ task_id: "b", redo_grants: 2, reason: expect.stringContaining("batch_integration_redo_exhausted") });
	}, 30000);
});
