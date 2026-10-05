import { afterAll, afterEach, describe, expect, it, mock, setSystemTime } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
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
const { default: registerPiWork } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
import { readAuditTaskPair } from "../plugins/immune-brain/runtime/kernel/storage";
import { readBatchRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";

// Real-ports acceptance seam for the registered Pi batch entry. Every fixture
// child is `routine`: these tests exercise tracked implementation, Kernel
// ownership, deterministic QA in a delivery materialization, settlement/export
// and the runner's Git commits. They carry no Review coverage, and a green run
// here is not evidence of a loaded live build or of native Host interaction.
const VERIFIER = join(process.cwd(), "scripts/verify-batch-completion.ts");
const RUNBOOK = readFileSync(join(process.cwd(), "docs/agents/pi-batch-acceptance.md"), "utf8");
const RUNBOOK_COMMANDS = [...RUNBOOK.matchAll(/```sh\n([\s\S]*?)```/g)]
	.flatMap(block => block[1]!.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#")));
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
	git(root, "init", "-q", "-b", "main"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.com");
	git(root, "add", "-A"); git(root, "commit", "-qm", "fixture Intents and original source");
	const base = git(root, "rev-parse", "HEAD");
	const observation: GithubInitiativeObservation = { contract: "immune_brain/github_initiative_observation/v1", initiative_id: slug, issue_number: 100,
		tasks: tasks.map((task, i) => ({ task_id: task, slice_id: `S${i + 1}`, issue_number: 101 + i, blocked_by: i ? [tasks[0]!] : [] })) };
	let gates = 0;
	let answer: () => Selection | Promise<Selection> = () => "confirm";
	let batchTool: any, workTool: any;
	// One Host session: both real extensions are registered with only the
	// Initiative observation and native-dialog seams injected.
	const restart = () => {
		const tools: any[] = [];
		const pi = { registerTool: (tool: unknown) => tools.push(tool), registerCommand() {}, on() {}, events: { on() {}, emit() {} } } as never;
		registerPiWork(pi);
		registerPiBatch(pi, { readInitiative: async () => observation });
		batchTool = tools.find(t => t.name === "start_unattended_batch");
		workTool = tools.find(t => t.name === "imm_kernel_canary");
	};
	restart();
	const ctx = () => ({ cwd: root, mode: "tui", ui: { setWidget() {}, setStatus() {}, notify() {}, custom: async () => { gates++; return answer(); } } });
	const call = async (tool: any, params: unknown): Promise<any> => {
		try {
			const response = await tool.execute(randomUUID(), params, undefined, undefined, ctx());
			return JSON.parse(response.content[0].text);
		} catch (error) { return { state: "refused", reason: error instanceof Error ? error.message : String(error) }; }
	};
	return { root, slug, tasks, base, restart, observation,
		batch: () => call(batchTool, { initiative_slug: slug }),
		kernel: (task: string, action: Record<string, unknown>) => call(workTool, { task_id: task, action }),
		implement: (n: number, content = "implemented\n") => { writeFileSync(join(root, `src/child-${n}.txt`), content); git(root, "add", `src/child-${n}.txt`); },
		// Terminal evidence is Git-tracked: the operator stages the exported pair
		// before re-entering the runner, which rejects untracked bytes.
		stageEvidence: (task: string) => git(root, "add", `.imm/audit/${task}`),
		gates: () => gates,
		answer: (fn: typeof answer) => { answer = fn; },
		state: (batchId: string) => readBatchRunState(root, batchId)!,
		verify: (batchId: string) => {
			const result = spawnSync("bun", [VERIFIER, "--batch-id", batchId, "--json"], { cwd: root, encoding: "utf8" });
			return { status: result.status, out: JSON.parse(result.stdout) };
		},
		statePath: (batchId: string) => join(root, ".imm/state/batches", `${batchId}.json`),
		head: () => git(root, "rev-parse", "HEAD"),
		commits: () => git(root, "rev-list", "--reverse", `${base}..HEAD`).split("\n").filter(Boolean),
		files: (commit: string) => git(root, "show", "--name-only", "--format=", commit).split("\n").filter(Boolean).sort(),
		// Runs one fenced `sh` example from the operator runbook against this fixture.
		runbook: (prefix: string, vars: Record<string, string>) => {
			const line = RUNBOOK_COMMANDS.find(command => command.startsWith(prefix));
			if (!line) throw new Error(`runbook has no executable example starting with: ${prefix}`);
			const command = line.replace(/<([a-z-]+)>/g, (_, key: string) => {
				if (!(key in vars)) throw new Error(`runbook example uses an unbound placeholder: <${key}>`);
				return vars[key]!;
			}).replace("scripts/verify-batch-completion.ts", VERIFIER);
			return spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8" });
		},
	};
}

/** Implement, run real QA to settlement, and stage the exported evidence pair. */
async function settle(f: Awaited<ReturnType<typeof fixture>>, n: number) {
	const task = f.tasks[n - 1]!;
	f.implement(n);
	const qa = await f.kernel(task, { op: "advance_assurance" });
	expect(qa).toMatchObject({ state: "completed", diagnostics: [{ acceptance_id: `acc-${n}`, outcome: "passed", exit_code: 0 }],
		task_state: { lifecycle: "done", fresh_approval_kinds: ["qa"], risk: "routine" } });
	f.stageEvidence(task);
	return qa;
}

describe("registered Pi batch entry with real Kernel, QA and Git (routine fixture)", () => {
	it("hands off to the Executor before any QA and repeats that handoff without a second Enrollment, gate, QA run or commit", async () => {
		const f = await fixture("acceptance-handoff");
		const first = await f.batch();
		expect(first).toMatchObject({ state: "started", report: { batch_state: "running", commits: [],
			children: [{ task_id: f.tasks[0], state: "enrolled", commit: null }, { task_id: f.tasks[1], state: "pending", commit: null }],
			handoff: { role: "executor", task_id: f.tasks[0], next_obligation: "submit_assurance" } } });
		expect(f.gates()).toBe(1);
		expect(f.head()).toBe(f.base);
		const owned = await f.kernel(f.tasks[0]!, { op: "status" });
		expect(owned).toMatchObject({ run_id: first.report.handoff.run_id, record_revision: first.report.handoff.record_revision,
			lifecycle: "active", artifact_state: "active", fresh_approval_kinds: [], missing_approval_kinds: ["qa"] });
		// The runbook's loaded-build check compares this field with package.json.
		expect(owned.plugin_version).toBe(JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")).version);
		expect(readAuditTaskPair(f.root, f.tasks[0]!)).toBeNull();

		const again = await f.batch();
		expect(again.batch_id).toBe(first.batch_id);
		expect(again.report.handoff).toEqual(first.report.handoff);
		expect(again.report.children).toEqual(first.report.children);
		expect(f.gates()).toBe(1);
		expect(f.head()).toBe(f.base);
		expect(await f.kernel(f.tasks[0]!, { op: "status" })).toMatchObject({ run_id: owned.run_id, record_revision: owned.record_revision });
		expect((await f.kernel(f.tasks[1]!, { op: "status" })).state).toBe("refused");
		expect(f.verify(first.batch_id)).toMatchObject({ out: { complete: false } });
		expect(f.verify(first.batch_id).status).not.toBe(0);
	}, 120000);

	it("commits each settled child exactly once in order and reports a completion the S0 verifier accepts, using the runbook commands", async () => {
		const f = await fixture("acceptance-serial");
		const first = await f.batch();
		f.implement(1);
		expect(await f.kernel(f.tasks[0]!, { op: "advance_assurance" })).toMatchObject({ state: "completed", task_state: { lifecycle: "done" } });
		// Settlement exports untracked terminal evidence; re-entry refuses it until staged.
		const unstaged = await f.batch();
		expect(unstaged.state).toBe("refused");
		expect(unstaged.reason).toContain("working tree has unstaged or untracked changes");
		expect(f.commits()).toEqual([]);
		expect(f.runbook("git add .imm/audit/", { "task-id": f.tasks[0]! }).status).toBe(0);

		const second = await f.batch();
		expect(second).toMatchObject({ state: "started", batch_id: first.batch_id, report: { batch_state: "running",
			// The runbook tells operators this reason is the normal path, not a failure.
			children: [{ task_id: f.tasks[0], state: "committed", reason: "crash after settlement; resuming at commit" }, { task_id: f.tasks[1], state: "enrolled", commit: null }],
			handoff: { role: "executor", task_id: f.tasks[1], next_obligation: "submit_assurance" } } });
		expect(f.commits()).toEqual(second.report.commits);
		expect(f.commits()).toHaveLength(1);
		const run1 = first.report.handoff.run_id;
		expect(f.files(f.commits()[0]!)).toEqual([`.imm/audit/${f.tasks[0]}/${run1}/task-record.json`, `.imm/audit/${f.tasks[0]}/${run1}/terminal-proof.json`, "src/child-1.txt"]);
		// A repeated continuation neither recommits the first child nor re-enrolls the second.
		const repeated = await f.batch();
		expect(repeated.report.handoff).toEqual(second.report.handoff);
		expect(f.commits()).toHaveLength(1);
		const partial = f.runbook("bun scripts/verify-batch-completion.ts", { "batch-id": first.batch_id });
		expect(partial.status).not.toBe(0);
		expect(JSON.parse(partial.stdout).complete).toBe(false);

		await settle(f, 2);
		const third = await f.batch();
		expect(third).toMatchObject({ batch_id: first.batch_id, report: { batch_state: "completed",
			children: [{ task_id: f.tasks[0], state: "committed" }, { task_id: f.tasks[1], state: "committed" }] } });
		expect(third.report.handoff).toBeUndefined();
		expect(f.commits()).toEqual(third.report.commits);
		expect(f.commits()).toHaveLength(2);
		expect(f.files(f.commits()[1]!).filter(path => !path.startsWith(".imm/audit/"))).toEqual(["src/child-2.txt"]);
		expect(f.gates()).toBe(1);
		expect(f.runbook("git status --porcelain", {}).stdout).toBe("");
		expect(f.runbook("git log --format=%H", { "base-head": f.base }).stdout.trim().split("\n").reverse()).toEqual(third.report.commits);
		const verified = f.runbook("bun scripts/verify-batch-completion.ts", { "batch-id": first.batch_id });
		expect(verified.status).toBe(0);
		expect(JSON.parse(verified.stdout)).toMatchObject({ complete: true, batch_state: "completed", report_state: "completed", code: null,
			children: [{ task_id: f.tasks[0], commit: third.report.commits[0] }, { task_id: f.tasks[1], commit: third.report.commits[1] }] });
	}, 120000);

	it("repairs a real failing check by its exact finding, resumes the obligation on a recreated Host adapter, and continues the same batch", async () => {
		const f = await fixture("acceptance-repair");
		const first = await f.batch();
		f.implement(1, "wrong\n");
		const failed = await f.kernel(f.tasks[0]!, { op: "advance_assurance" });
		expect(failed).toMatchObject({ state: "rework", operation: "qa", diagnostics: [{ acceptance_id: "acc-1", outcome: "nonzero_exit", exit_code: 3 }],
			recovery: { category: "repair", task_id: f.tasks[0], run_id: first.report.handoff.run_id, next_obligation: "resolve_findings", acceptance_ids: ["acc-1"] } });
		const findings: string[] = failed.recovery.finding_ids;
		expect(findings).toHaveLength(1);

		// The Host adapter is recreated: only fresh Kernel projection carries the obligation.
		f.restart();
		expect(await f.kernel(f.tasks[0]!, { op: "status" })).toMatchObject({ run_id: first.report.handoff.run_id, lifecycle: "active",
			next_obligation: "resolve_findings", blocking_finding_ids: findings, fresh_approval_kinds: [] });
		const parked = await f.batch();
		expect(parked).toMatchObject({ state: "started", batch_id: first.batch_id, report: { batch_state: "running", commits: [],
			children: [{ state: "enrolled" }, { state: "pending" }], recovery: { category: "repair", finding_ids: findings, next_obligation: "resolve_findings" } } });
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
			task_state: { run_id: first.report.handoff.run_id, lifecycle: "done", blocking_finding_ids: [] } });
		expect(fresh.operation_id).not.toBe(failed.operation_id);
		f.stageEvidence(f.tasks[0]!);

		f.restart();
		const second = await f.batch();
		expect(second).toMatchObject({ batch_id: first.batch_id, report: { children: [{ state: "committed" }, { state: "enrolled" }], handoff: { task_id: f.tasks[1] } } });
		expect(second.report.recovery).toBeUndefined();
		await settle(f, 2);
		f.restart();
		expect((await f.batch()).report.batch_state).toBe("completed");
		expect(f.commits()).toHaveLength(2);
		expect(f.gates()).toBe(1);
		expect(f.verify(first.batch_id)).toMatchObject({ status: 0, out: { complete: true } });
	}, 120000);

	it("resumes a child parked on foreground Review with no gate however far the clock advanced, then completes", async () => {
		const f = await fixture("acceptance-clockless");
		const first = await f.batch();
		await settle(f, 1);
		const second = await f.batch();
		f.implement(2);
		const before = f.state(first.batch_id);
		expect(before).not.toHaveProperty("authorization_expires_at");
		expect(before.budget).not.toHaveProperty("deadline_at");
		const evidence = () => ({ head: f.head(), index: git(f.root, "write-tree"),
			audit: git(f.root, "rev-parse", `HEAD:.imm/audit/${f.tasks[0]}`) });
		const kept = evidence();

		// Thirty days later the single confirmation still binds: no gate opens.
		setSystemTime(new Date(Date.parse(before.confirmation_time) + 30 * 24 * 3600_000));
		f.answer(() => { throw new Error("a clockless resume must not open a gate"); });
		const resumed = await f.batch();
		expect(resumed).toMatchObject({ state: "started", batch_id: first.batch_id, report: { batch_state: "running", commits: second.report.commits,
			children: [{ state: "committed" }, { state: "enrolled" }], handoff: second.report.handoff } });
		expect(f.gates()).toBe(1);
		expect(evidence()).toEqual(kept);
		expect(await f.kernel(f.tasks[1]!, { op: "status" })).toMatchObject({ run_id: second.report.handoff.run_id, lifecycle: "active", next_obligation: "submit_assurance" });

		await settle(f, 2);
		expect((await f.batch()).report.batch_state).toBe("completed");
		expect(f.gates()).toBe(1);
		expect(f.commits()).toHaveLength(2);
		expect(f.verify(first.batch_id)).toMatchObject({ status: 0, out: { complete: true } });
	}, 120000);
});
