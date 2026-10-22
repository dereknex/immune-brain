import { afterAll, afterEach, describe, expect, it, mock, setSystemTime } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Delivery QA has no Host peer packages. A seam is installed only when the real
// import fails; the native dialog double below never instantiates TUI widgets.
try { await import("typebox"); } catch {
	const optional = Symbol("optional");
	mock.module("typebox", () => ({ Type: {
		String: (options = {}) => ({ type: "string", ...options }), Number: () => ({ type: "number" }),
		Boolean: () => ({ type: "boolean" }), Null: () => ({ type: "null" }), Unknown: () => ({}),
		Literal: (value: unknown) => ({ const: value }), Array: (items: object) => ({ type: "array", items }),
		Union: (anyOf: object[]) => ({ anyOf }), Optional: (schema: object) => ({ ...schema, [optional]: true }),
		Record: (_key: object, value: object) => ({ type: "object", additionalProperties: value }),
		Object: (properties: Record<string, any>, options = {}) => ({ type: "object", properties,
			required: Object.entries(properties).filter(([, value]) => !value[optional]).map(([key]) => key), ...options }),
	} }));
}
try { await import("@earendil-works/pi-coding-agent"); } catch {
	mock.module("@earendil-works/pi-coding-agent", () => ({ DynamicBorder: class {} }));
}
try { await import("@earendil-works/pi-tui"); } catch {
	mock.module("@earendil-works/pi-tui", () => ({ Text: class {}, Container: class {}, SelectList: class {},
		sliceByColumn: (s: string, start: number, width?: number) => s.slice(start, width === undefined ? undefined : start + width),
		truncateToWidth: (s: string, width: number) => s.slice(0, width), visibleWidth: (s: string) => s.length }));
}
const { default: registerPiBatch } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
const { default: registerPiEnrollment } = await import("../plugins/immune-brain/.pi-extension/imm-canary-enroll");
const { default: registerPiWork, recordPiPhaseInput } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
// The phase entry gate (ADR 0019) sits in front of this Tool. These tests
// exercise what lies behind it, so their session records a real run entry
// through the function the input handler calls;
// tests/pi-phase-entry-gate.test.ts owns the refusals.
const RUN_ENTRY_SESSION = { getSessionId: () => "pi-batch-acceptance-tests" };
recordPiPhaseInput({ text: "/skill:imm-run", source: "interactive" }, { sessionManager: RUN_ENTRY_SESSION });
import { readAuditTaskPair } from "../plugins/immune-brain/runtime/kernel/storage";
import { readAnyBatchRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";

// Real-ports acceptance seam for the registered Pi batch entry. Every fixture
// child is `routine`: these tests exercise tracked implementation, Kernel
// ownership, deterministic QA in a delivery materialization, settlement/export
// and the runner's Git commits. They carry no Review coverage, and a green run
// here is not evidence of a loaded live build or of native Host interaction.
// The serial runbook/S0 examples are retired here; Lane commits and their real
// Kernel evidence are checked directly, without claiming live Host acceptance.
const PROGRESSION = Symbol.for("immune_brain.pi_assurance_progression");
const priorProgression = Object.getOwnPropertyDescriptor(globalThis, PROGRESSION);
const roots: string[] = [];
afterEach(() => {
	setSystemTime();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
afterAll(() => {
	if (priorProgression) Object.defineProperty(globalThis, PROGRESSION, priorProgression);
	else Reflect.deleteProperty(globalThis, PROGRESSION);
	mock.restore();
});

function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

type Selection = "confirm" | "decline" | "cancel";

async function fixture(slug: string) {
	const root = mkdtempSync(join(tmpdir(), "imm-pi-acceptance-")); roots.push(root);
	const tasks = [1, 2].map(n => `${slug}-c${n}`);
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	for (const [i, task] of tasks.entries()) {
		const n = i + 1;
		writeFileSync(join(root, `src/child-${n}.txt`), "original\n");
		writeFileSync(join(root, `docs/plans/${task}.intent.json`), `${JSON.stringify({
			contract: "assurance_kernel/task_intent/v1", task_id: task, goal: `implement child ${n}`, owner: "user", risk: "routine", revision: 1,
			scope_hint: [`docs/plans/${task}.intent.json`, `src/child-${n}.txt`],
			acceptance: [{ id: `acc-${n}`, assertion: `child ${n} is implemented`, verification: JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["-e", `if (await Bun.file('src/child-${n}.txt').text() !== 'implemented\\n') process.exit(3);`],
					cwd: ".", timeout_ms: 10000, max_output_bytes: 8192 }, environment: { writable_paths: [] },
			}) }],
		}, null, 2)}\n`);
	}
	mkdirSync(join(root, "docs/initiatives"), { recursive: true });
	writeFileSync(join(root, `docs/initiatives/${slug}.md`), `# Parent\n## S1: predecessor\nTasks:\n- ${tasks[0]}\n## S2: target\nTasks:\n- ${tasks[1]}\nBlocked by: ${tasks[0]}\n`);
	git(root, "init", "-q", "-b", "main"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.com");
	git(root, "add", "-A"); git(root, "commit", "-qm", "fixture Intents and original source");
	const base = git(root, "rev-parse", "HEAD");
	const observation: GithubInitiativeObservation = { contract: "immune_brain/github_initiative_observation/v1", initiative_id: slug, issue_number: 100,
		tasks: tasks.map((task, i) => ({ task_id: task, slice_id: `S${i + 1}`, issue_number: 101 + i, blocked_by: i ? [tasks[0]!] : [] })) };
	let gates = 0;
	let answer: () => Selection | Promise<Selection> = () => "confirm";
	let batchTool: any, workTool: any, enrollmentTool: any;
	let entryPending = true;
	const handlers = new Map<string, Function[]>();
	// One Host session: both real extensions are registered with only the
	// Initiative observation and native-dialog seams injected.
	const restart = () => {
		const tools: any[] = [];
		handlers.clear(); entryPending = true;
		const pi = { registerTool: (tool: unknown) => tools.push(tool), registerCommand() {},
			on(name: string, callback: Function) { handlers.set(name, [...(handlers.get(name) ?? []), callback]); }, events: { on() {}, emit() {} } } as never;
		registerPiWork(pi);
		registerPiEnrollment(pi);
		registerPiBatch(pi, { readInitiative: async () => observation });
		batchTool = tools.find(t => t.name === "start_unattended_batch");
		workTool = tools.find(t => t.name === "imm_kernel_canary");
		enrollmentTool = tools.find(t => t.name === "imm_canary_enrollment");
	};
	restart();
	const lanePaths = new Map<string, string>();
	const lane = (task: string) => {
		const path = lanePaths.get(task);
		if (!path) throw new Error(`no enrolled Lane for ${task}`);
		return path;
	};
	const ctx = (cwd: string) => ({ cwd, mode: "tui", sessionManager: RUN_ENTRY_SESSION, ui: { setWidget() {}, setStatus() {}, notify() {}, custom: async () => { gates++; return answer(); } } });
	const emit = async (name: string, event: object, cwd: string) => { for (const callback of handlers.get(name) ?? []) await callback(event, ctx(cwd)); };
	const enter = async (text: string, cwd = root) => { entryPending = false; await emit("input", { text, source: "interactive" }, cwd); };
	const call = async (tool: any, params: any, cwd = root): Promise<any> => {
		if (entryPending) await enter(`/imm-run ${slug}`, root);
		const id = randomUUID(), event = { toolName: tool.name, toolCallId: id, input: params };
		try {
			await emit("tool_call", event, cwd);
			const response = await tool.execute(id, params, undefined, undefined, ctx(cwd));
			await emit("tool_result", { ...response, ...event, isError: false }, cwd);
			return tool.name === "imm_canary_enrollment" ? response.details : JSON.parse(response.content[0].text);
		} catch (error) {
			await emit("tool_result", { ...event, isError: true, content: [{ type: "text", text: String(error) }] }, cwd);
			return { state: "refused", reason: error instanceof Error ? error.message : String(error) };
		}
	};
	return { root, slug, tasks, base, restart, observation, enter,
		enroll: (task: string) => call(enrollmentTool, { action: "new", task_id: task }),
		batch: async () => {
			const result = await call(batchTool, { initiative_slug: slug, final_verification: ["bun --version"] });
			for (const child of result.report?.children ?? []) if (child.lane) lanePaths.set(child.task_id, child.lane.path);
			return result;
		},
		lane,
		coordinatorStatus: (task: string) => call(workTool, { task_id: task, action: { op: "status" } }),
		kernel: (task: string, action: Record<string, unknown>) => call(workTool, { task_id: task, action }, lane(task)),
		implement: (n: number, content = "implemented\n") => { const cwd = lane(tasks[n - 1]!); writeFileSync(join(cwd, `src/child-${n}.txt`), content); git(cwd, "add", `src/child-${n}.txt`); },
		gates: () => gates,
		answer: (fn: typeof answer) => { answer = fn; },
		state: (batchId: string) => readAnyBatchRunState(root, batchId)!,
		statePath: (batchId: string) => join(root, ".imm/state/batches", `${batchId}.json`),
		head: () => git(root, "rev-parse", "HEAD"),
		// Runtime advances the Parent branch without moving the user's HEAD/index.
		batchRef: () => `refs/heads/imm/${slug}`,
		commits: () => git(root, "rev-list", "--reverse", `${base}..refs/heads/imm/${slug}`).split("\n").filter(Boolean),
		files: (commit: string) => git(root, "show", "--name-only", "--format=", commit).split("\n").filter(Boolean).sort(),

	};
}

/** Real Lane QA settles only the child; the Parent must explicitly tick next. */
async function settle(f: Awaited<ReturnType<typeof fixture>>, n: number) {
	const task = f.tasks[n - 1]!;
	f.implement(n);
	const qa = await f.kernel(task, { op: "advance_assurance" });
	expect(qa).toMatchObject({ state: "completed", diagnostics: [{ acceptance_id: `acc-${n}`, outcome: "passed", exit_code: 0 }],
		task_state: { lifecycle: "done", fresh_approval_kinds: ["qa"], risk: "routine" } });
	expect(qa).not.toHaveProperty("batch");
	return qa;
}

describe("registered Pi batch entry with real Kernel, QA and Git (routine fixture)", () => {
	it("explicit Slice settles without integrating or executing its authorized sibling", async () => {
		const f = await fixture("acceptance-isolated");
		const first = await f.batch();
		await f.enter(`/imm-run ${f.tasks[0]}`, f.lane(f.tasks[0]!));
		await f.kernel(f.tasks[0]!, { op: "status" });
		const settled = await settle(f, 1);
		expect(settled).not.toHaveProperty("batch");
		expect(f.state(first.batch_id).children[1]?.state).toBe("pending");
		expect(f.head()).toBe(f.base); expect(f.gates()).toBe(1);
	}, 60000);

	it("Local Slice dependency refusal happens before Pi Enrollment's native gate", async () => {
		const f = await fixture("acceptance-local-dependency");
		await f.enter(`/imm-run ${f.tasks[1]}`);
		expect(await f.enroll(f.tasks[1]!)).toMatchObject({ state: "refused", reason: expect.stringContaining(`Isolated Slice prerequisites are not integrated: ${f.tasks[0]}`) });
		expect(f.gates()).toBe(0); expect(f.head()).toBe(f.base);
	}, 60000);

	it("hands off to the Executor before any QA and repeats that handoff without a second Enrollment, gate, QA run or commit", async () => {
		const f = await fixture("acceptance-handoff");
		const first = await f.batch();
		expect(first).toMatchObject({ state: "started", report: { batch_state: "running", commits: [],
			children: [{ task_id: f.tasks[0], state: "enrolled", commit: null }, { task_id: f.tasks[1], state: "pending", commit: null }],
			handoffs: [{ role: "executor", task_id: f.tasks[0], lane_path: f.lane(f.tasks[0]!), next_obligation: "submit_assurance" }] } });
		expect(f.gates()).toBe(1);
		expect(f.head()).toBe(f.base);
		const owned = await f.kernel(f.tasks[0]!, { op: "status" });
		expect(owned).toMatchObject({ run_id: first.report.handoffs[0].run_id, record_revision: first.report.handoffs[0].record_revision,
			lifecycle: "active", artifact_state: "active", fresh_approval_kinds: [], missing_approval_kinds: ["qa"] });
		// The runbook's loaded-build check compares this field with package.json.
		expect(owned.plugin_version).toBe(JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")).version);
		expect(readAuditTaskPair(f.root, f.tasks[0]!)).toBeNull();

		const again = await f.batch();
		expect(again.batch_id).toBe(first.batch_id);
		expect(again.report.handoffs).toEqual(first.report.handoffs);
		expect(again.report.children).toEqual(first.report.children);
		expect(f.gates()).toBe(1);
		expect(f.head()).toBe(f.base);
		expect(await f.kernel(f.tasks[0]!, { op: "status" })).toMatchObject({ run_id: owned.run_id, record_revision: owned.record_revision });
		for (const task of f.tasks) {
			const status = await f.coordinatorStatus(task);
			expect(status.run_id).toBeNull();
			expect(status.lifecycle).not.toBe("active");
		}
		expect(first.report).not.toHaveProperty("handoff");
		expect(f.state(first.batch_id)).toMatchObject({ contract: "assurance_kernel/batch_run_state/v2", max_parallel: 1, branch: f.batchRef() });
		expect(readAuditTaskPair(f.lane(f.tasks[0]!), f.tasks[0]!)).toBeNull();
	}, 120000);

	it("commits each settled Lane exactly once in order on the Parent branch without changing the user branch/index", async () => {
		const f = await fixture("acceptance-lanes");
		// Unrelated staged and unstaged user bytes must survive every Lane tick.
		writeFileSync(join(f.root, "user.txt"), "staged\n"); git(f.root, "add", "user.txt");
		writeFileSync(join(f.root, "user.txt"), "unstaged\n");
		const userIndex = readFileSync(join(f.root, ".git/index"));
		const first = await f.batch();
		await settle(f, 1);
		expect(f.state(first.batch_id).children.map(c => c.state)).toEqual(["enrolled", "pending"]);
		expect(f.commits()).toEqual([]);
		const second = await f.batch();
		expect(second).toMatchObject({ state: "started", batch_id: first.batch_id, report: { batch_state: "running",
			children: [{ task_id: f.tasks[0], state: "released" }, { task_id: f.tasks[1], state: "enrolled", commit: null }],
			handoffs: [{ role: "executor", task_id: f.tasks[1], next_obligation: "submit_assurance" }] } });
		expect(f.commits()).toEqual(second.report.commits);
		expect(f.commits()).toHaveLength(1);
		const run1 = first.report.handoffs[0].run_id;
		expect(f.files(f.commits()[0]!)).toEqual([`.imm/audit/${f.tasks[0]}/${run1}/task-record.json`, `.imm/audit/${f.tasks[0]}/${run1}/terminal-proof.json`, "src/child-1.txt"]);
		// A repeated continuation neither recommits the first child nor re-enrolls the second.
		const repeated = await f.batch();
		expect(repeated.report.handoffs).toEqual(second.report.handoffs);
		expect(f.commits()).toHaveLength(1);
		expect(f.state(first.batch_id).batch_state).toBe("running");

		await settle(f, 2);
		const third = await f.batch();
		expect(third).toMatchObject({ batch_id: first.batch_id, report: { batch_state: "completed",
			children: [{ task_id: f.tasks[0], state: "released" }, { task_id: f.tasks[1], state: "released" }] } });
		expect(third.report.handoffs).toEqual([]);
		expect(f.commits()).toEqual(third.report.commits);
		expect(f.commits()).toHaveLength(2);
		expect(f.files(f.commits()[1]!).filter(path => !path.startsWith(".imm/audit/"))).toEqual(["src/child-2.txt"]);
		expect(f.gates()).toBe(1);
		expect(readFileSync(join(f.root, ".git/index"))).toEqual(userIndex);
		expect(readFileSync(join(f.root, "user.txt"), "utf8")).toBe("unstaged\n");
		for (const n of [1, 2]) expect(readFileSync(join(f.root, `src/child-${n}.txt`), "utf8")).toBe("original\n");
		expect(f.head()).toBe(f.base);
		expect(git(f.root, "rev-list", "--reverse", `${f.base}..${f.batchRef()}`).split("\n")).toEqual(third.report.commits);
		for (const [i, commit] of third.report.commits.entries()) {
			const task = f.tasks[i]!;
			const paths = f.files(commit).filter(path => path.startsWith(`.imm/audit/${task}/`));
			expect(paths).toHaveLength(2);
			const record = JSON.parse(git(f.root, "show", `${commit}:${paths.find(p => p.endsWith("task-record.json"))}`));
			const proof = JSON.parse(git(f.root, "show", `${commit}:${paths.find(p => p.endsWith("terminal-proof.json"))}`));
			expect(record).toMatchObject({ task_id: task, lifecycle: "done" });
			expect(proof).toMatchObject({ task_id: task, terminal_lifecycle: "done" });
			expect(git(f.root, "show", `${commit}:src/child-${i + 1}.txt`)).toBe("implemented");
			expect(git(f.root, "show", "-s", "--format=%P", commit)).toBe(i ? third.report.commits[i - 1] : f.base);
		}
		const completed = await f.batch();
		expect(completed).toMatchObject({ state: "started", report: { batch_state: "completed" } });
		expect(completed.report.commits).toEqual(third.report.commits);
		expect(f.commits()).toHaveLength(2);
	}, 120000);

	it("repairs a real failing check by its exact finding, resumes the obligation on a recreated Host adapter, and continues the same batch", async () => {
		const f = await fixture("acceptance-repair");
		const first = await f.batch();
		f.implement(1, "wrong\n");
		const failed = await f.kernel(f.tasks[0]!, { op: "advance_assurance" });
		expect(failed).toMatchObject({ state: "rework", operation: "qa", diagnostics: [{ acceptance_id: "acc-1", outcome: "nonzero_exit", exit_code: 3 }],
			recovery: { category: "repair", task_id: f.tasks[0], run_id: first.report.handoffs[0].run_id, next_obligation: "resolve_findings", acceptance_ids: ["acc-1"] } });
		const findings: string[] = failed.recovery.finding_ids;
		expect(findings).toHaveLength(1);

		// The Host adapter is recreated: only fresh Kernel projection carries the obligation.
		f.restart();
		expect(await f.kernel(f.tasks[0]!, { op: "status" })).toMatchObject({ run_id: first.report.handoffs[0].run_id, lifecycle: "active",
			next_obligation: "resolve_findings", blocking_finding_ids: findings, fresh_approval_kinds: [] });
		const parked = await f.batch();
		expect(parked).toMatchObject({ state: "started", batch_id: first.batch_id, report: { batch_state: "running", commits: [],
			children: [{ state: "enrolled" }, { state: "pending" }], handoffs: [{ role: "executor", task_id: f.tasks[0], next_obligation: "resolve_findings" }] } });
		expect(f.gates()).toBe(1);
		expect(f.commits()).toEqual([]);

		// Repairing the bytes alone does not clear the obligation.
		f.implement(1);
		const undisposed = await f.kernel(f.tasks[0]!, { op: "advance_assurance" });
		expect(undisposed.state).toBe("refused");
		expect(undisposed.reason).toContain("Kernel requires resolve_findings");
		expect((await f.kernel(f.tasks[0]!, { op: "resolve_finding", finding_id: "qa-not-the-finding" })).state).toBe("refused");
		expect(await f.kernel(f.tasks[0]!, { op: "resolve_finding", finding_id: findings[0] })).toMatchObject({ lifecycle: "active" });
		const fresh = await f.kernel(f.tasks[0]!, { op: "advance_assurance" });
		expect(fresh).toMatchObject({ state: "completed", diagnostics: [{ outcome: "passed", exit_code: 0 }],
			task_state: { run_id: first.report.handoffs[0].run_id, lifecycle: "done", blocking_finding_ids: [] } });
		expect(fresh.operation_id).not.toBe(failed.operation_id);

		expect(fresh).not.toHaveProperty("batch");
		const second = await f.batch();
		expect(second).toMatchObject({ batch_id: first.batch_id, report: { children: [{ state: "released" }, { state: "enrolled" }], handoffs: [{ task_id: f.tasks[1] }] } });
		expect(second.report.recovery).toBeUndefined();
		f.restart();
		// Re-select the Parent from its persisted batch receipt in the recreated adapter.
		expect((await f.batch()).report.handoffs[0].task_id).toBe(f.tasks[1]);
		await settle(f, 2);
		expect((await f.batch()).report.batch_state).toBe("completed");
		expect(f.commits()).toHaveLength(2);
		expect(f.gates()).toBe(1);
	}, 120000);

	it("resumes an active routine Lane with no gate however far the clock advanced, then completes", async () => {
		const f = await fixture("acceptance-clockless");
		const first = await f.batch();
		await settle(f, 1);
		const second = await f.batch();
		f.implement(2);
		const before = f.state(first.batch_id);
		expect(before).not.toHaveProperty("authorization_expires_at");
		expect(before.budget).not.toHaveProperty("deadline_at");
		const evidence = () => ({ head: f.head(), index: git(f.root, "write-tree"),
			audit: git(f.root, "rev-parse", `${f.batchRef()}:.imm/audit/${f.tasks[0]}`) });
		const kept = evidence();

		// Thirty days later the single confirmation still binds: no gate opens.
		setSystemTime(new Date(Date.parse(before.confirmation_time) + 30 * 24 * 3600_000));
		f.answer(() => { throw new Error("a clockless resume must not open a gate"); });
		const resumed = await f.batch();
		expect(resumed).toMatchObject({ state: "started", batch_id: first.batch_id, report: { batch_state: "running", commits: second.report.commits,
			children: [{ state: "released" }, { state: "enrolled" }], handoffs: second.report.handoffs } });
		expect(f.gates()).toBe(1);
		expect(evidence()).toEqual(kept);
		expect(await f.kernel(f.tasks[1]!, { op: "status" })).toMatchObject({ run_id: second.report.handoffs[0].run_id, lifecycle: "active", next_obligation: "submit_assurance" });

		// Thirty days on, the closeout still continues without a gate.
		await settle(f, 2);
		expect((await f.batch()).report.batch_state).toBe("completed");
		expect(f.gates()).toBe(1);
		expect(f.commits()).toHaveLength(2);
	}, 120000);
});
