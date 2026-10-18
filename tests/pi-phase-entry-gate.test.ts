// Pi phase entry gate (ADR 0019, Spec explicit-phase-entry T3). The registered
// `input` handler records literal entries; `imm_canary_enrollment` and
// `start_unattended_batch` refuse before the authority dialog without a live
// imm-run entry. Every case drives the registered handler and Tool `execute`.

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
afterAll(() => mock.restore());

const { default: registerPiWork } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
const { default: registerPiEnroll } = await import("../plugins/immune-brain/.pi-extension/imm-canary-enroll");
const { default: registerPiBatch } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
const { PHASE_ENTRY_RECOVERY, RUN_ENTRY_REQUIRED } = await import("../plugins/immune-brain/runtime/assurance/phase_entry");
const { readBackendClaim } = await import("../plugins/immune-brain/runtime/kernel/backend_claim");
const { revokePiPhaseEntry } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
const { batchStatePath } = await import("../plugins/immune-brain/runtime/kernel/storage_paths");
const { readRunRowByTask, updateRunRecord, withKernelTransaction } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");

const TASK = "phase-entry-child";
const SLUG = "phase-entry-init";
const roots: string[] = [];
let agentDir = "";
let previousAgentDir: string | undefined;

beforeAll(() => {
	// The user's own Pi prompt templates must not decide these cases.
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	agentDir = mkdtempSync(join(tmpdir(), "pi-phase-entry-agent-"));
	mkdirSync(join(agentDir, "prompts"), { recursive: true });
	writeFileSync(join(agentDir, "prompts", "loop.md"), "---\ndescription: run (imm-loop)\n---\n/skill:imm-loop ${@:-resume}\n");
	writeFileSync(join(agentDir, "prompts", "planner.md"), "---\ndescription: plan\n---\n/skill:imm-planner $@\n");
	writeFileSync(join(agentDir, "prompts", "both.md"), "Use imm-planner, then imm-run.\n");
	// Symlinked templates: one whose target is over the alias bound, one within it.
	writeFileSync(join(agentDir, "big-target.md"), `/skill:imm-run $@\n${"x".repeat(64 * 1024)}`);
	symlinkSync(join(agentDir, "big-target.md"), join(agentDir, "prompts", "big.md"));
	writeFileSync(join(agentDir, "small-target.md"), "/skill:imm-run $@\n");
	symlinkSync(join(agentDir, "small-target.md"), join(agentDir, "prompts", "linked.md"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	for (const root of [...roots, agentDir]) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** A committed routine TaskIntent that Enrollment can prepare up to its dialog. */
function fixtureRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-phase-entry-"));
	roots.push(root);
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "docs", "specs"), { recursive: true });
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	mkdirSync(join(root, "scripts"), { recursive: true });
	writeFileSync(join(root, "scripts", "accept.ts"), "process.exit(0);\n");
	writeFileSync(join(root, "docs", "plans", "fixture.txt"), "fixture\n");
	writeFileSync(join(root, "docs", "specs", `${TASK}.spec.md`), "# Phase entry child\n");
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: TASK,
		goal: "phase entry gate fixture",
		acceptance: [{ id: "A1", assertion: "the acceptance script exits zero", verification: JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v2",
			command: { executable: "bun", argv: ["run", "scripts/accept.ts"], cwd: ".", timeout_ms: 5_000, max_output_bytes: 16_384 },
		}) }],
		scope_hint: ["docs/plans/fixture.txt", `docs/specs/${TASK}.spec.md`, `docs/specs/archive/${TASK}.spec.md`],
		risk: "routine",
		revision: 1,
		owner: "user",
	}, null, 2)}\n`);
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.name", "Fixture");
	git(root, "config", "user.email", "fixture@example.com");
	git(root, "add", "-A");
	git(root, "commit", "-qm", "fixture intent");
	return root;
}

/** One Pi session: the three real extensions behind one fake Host. */
function stableIdentity(): { getSessionId: () => string } {
	const id = `session-${randomUUID()}`;
	return { getSessionId: () => id };
}

function session(root: string, identity: { getSessionId?: () => unknown } | null = stableIdentity()) {
	const tools: Array<{ name: string; execute: (...args: any[]) => Promise<any> }> = [];
	// Pi runs every extension's handler for an event, in registration order.
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const emit = async (name: string, event: unknown) => {
		let first: unknown;
		for (const handler of handlers.get(name) ?? []) {
			const result = await handler(event, ctx);
			if (first === undefined) first = result;
		}
		return first;
	};
	const pi = {
		registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => tools.push(tool),
		registerCommand() {},
		on: (name: string, handler: (event: any, ctx: any) => unknown) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		events: { on() {}, emit() {} },
	} as never;
	registerPiWork(pi);
	registerPiEnroll(pi);
	registerPiBatch(pi, { readInitiative: async () => ({
		contract: "immune_brain/github_initiative_observation/v1",
		initiative_id: SLUG,
		issue_number: 100,
		tasks: [{ task_id: TASK, slice_id: "S1", issue_number: 101, blocked_by: [] }],
	}) as never });
	// Each dialog takes the next queued answer, then declines.
	const dialogs = { count: 0, answers: [] as string[] };
	const ctx = {
		cwd: root,
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		...(identity ? { sessionManager: identity } : {}),
		// The native dialog double: it counts each opening and declines unless an answer is queued.
		ui: { setWidget() {}, setStatus() {}, notify() {}, input: async () => undefined, custom: async () => { dialogs.count++; return dialogs.answers.shift() ?? "decline"; } },
	};
	const tool = (name: string) => {
		const found = tools.find((candidate) => candidate.name === name);
		if (!found) throw new Error(`${name} was not registered`);
		return found;
	};
	// A refusal throws a JSON failure; a declined dialog may settle either way.
	const failureOf = async (promise: Promise<unknown>): Promise<{ code?: string; state?: string; message?: string; next_action?: string }> => {
		try {
			await promise;
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			try { return JSON.parse(text); } catch { return { message: text }; }
		}
		return {};
	};
	return {
		ctx,
		dialogs,
		input: async (text: string, source: "interactive" | "rpc" | "extension" = "interactive") => {
			if (!handlers.has("input")) throw new Error("no input handler was registered");
			return emit("input", { type: "input", text, source });
		},
		shutdown: () => emit("session_shutdown", { type: "session_shutdown" }),
		settle: (outcome: string, canContinue: boolean) => emit("agent_before_settle", { type: "agent_before_settle", outcome, continue: false,
			context: { canContinue, pendingMessages: [] } }),
		enroll: () => failureOf(tool("imm_canary_enrollment").execute(randomUUID(), { action: "new", task_id: TASK }, undefined, undefined, ctx)),
		batch: () => failureOf(tool("start_unattended_batch").execute(randomUUID(), { initiative_slug: SLUG }, undefined, undefined, ctx)),
		retire: () => failureOf(tool("retire_stale_batch").execute("toolu_retire", { initiative_slug: SLUG }, undefined, undefined, ctx)),
		authorize: () => failureOf(tool("imm_kernel_canary").execute(randomUUID(), { task_id: TASK, action: { op: "request_authorization" } }, undefined, undefined, ctx)),
	};
}

const STALE_BATCH = `batch-${SLUG}-0123abcd`;
const STALE_DIGEST = `sha256:${"c".repeat(64)}`;

/** A parked serial batch record for the Initiative: retirable, nothing in flight. */
function staleBatch(root: string): { bytes: () => Buffer; report: () => any } {
	const head = git(root, "rev-parse", "HEAD");
	const path = join(root, batchStatePath(STALE_BATCH));
	mkdirSync(join(root, ".imm", "state", "batches"), { recursive: true });
	writeFileSync(path, `${JSON.stringify({
		contract: "assurance_kernel/batch_run_state/v1",
		batch_id: STALE_BATCH,
		initiative_slug: SLUG,
		base_head: head,
		branch: `imm/${SLUG}`,
		plan_digest: STALE_DIGEST,
		confirmation_time: "2026-10-01T00:00:00.000Z",
		batch_state: "needs_human",
		children: [{ task_id: TASK, slice_id: "S1", state: "pending", commit: null, blocked_by: [], reason: null }],
		commits: [],
		consecutive_qa_failures: 0,
		budget: { max_children: 1, qa_failure_limit: 2 },
		created_at: "2026-10-01T00:00:00.000Z",
		updated_at: "2026-10-01T00:00:00.000Z",
	}, null, 2)}\n`);
	const reportPath = join(root, ".imm", "state", "batches", `${STALE_BATCH}.report.json`);
	return {
		bytes: () => readFileSync(path),
		report: () => existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null,
	};
}

const REFUSED = {
	state: "blocked",
	code: RUN_ENTRY_REQUIRED,
	next_action: PHASE_ENTRY_RECOVERY[RUN_ENTRY_REQUIRED],
};

describe("Pi phase entry gate", () => {
	test("a session with no imm-run entry refuses both tools before the dialog and writes nothing", async () => {
		const root = fixtureRoot();
		const pi = session(root);
		const head = git(root, "rev-parse", "HEAD");

		expect(await pi.enroll()).toMatchObject({ ...REFUSED, message: "enroll needs a literal-user imm-run entry in this session" });
		expect(await pi.batch()).toMatchObject({ ...REFUSED, message: "start_unattended_batch needs a literal-user imm-run entry in this session" });

		expect(pi.dialogs.count).toBe(0);
		expect(readBackendClaim(root)).toBeNull();
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
		expect(git(root, "status", "--porcelain", "--", "docs")).toBe("");
	});

	test("confirming a design, or mentioning imm-run mid-sentence, is not an entry", async () => {
		const pi = session(fixtureRoot());
		for (const text of ["确认", "confirm", "全部建议，然后 /skill:imm-run", "go ahead and run imm-run for S1", " /skill:imm-run", "/unknown-command", "/both"]) {
			await pi.input(text);
			expect(await pi.enroll()).toMatchObject(REFUSED);
			expect(await pi.batch()).toMatchObject(REFUSED);
		}
		expect(pi.dialogs.count).toBe(0);
	});

	test("a symlinked template is bounded by its target, not by the link", async () => {
		const pi = session(fixtureRoot());
		await pi.input("/big");
		expect(await pi.enroll()).toMatchObject(REFUSED);
		expect(pi.dialogs.count).toBe(0);
		await pi.input("/linked");
		await pi.enroll();
		expect(pi.dialogs.count).toBe(1);
	});

	test("an entry carried by extension-sourced input is not the user's", async () => {
		const pi = session(fixtureRoot());
		expect(await pi.input("/skill:imm-run", "extension")).toEqual({ action: "continue" });
		expect(await pi.enroll()).toMatchObject(REFUSED);
		expect(await pi.batch()).toMatchObject(REFUSED);
		expect(pi.dialogs.count).toBe(0);
	});

	for (const entry of ["/skill:imm-run", `/skill:imm-run ${TASK}`, "/imm-run", "/loop", `/loop ${TASK}`]) {
		test(`the literal entry ${JSON.stringify(entry)} lets Enrollment reach its dialog`, async () => {
			const pi = session(fixtureRoot());
			expect(await pi.input(entry)).toEqual({ action: "continue" });
			const failure = await pi.enroll();
			expect(pi.dialogs.count).toBe(1);
			expect(failure.code).not.toBe(RUN_ENTRY_REQUIRED);
		});
	}

	test("a literal entry lets the batch start reach its dialog", async () => {
		const pi = session(fixtureRoot());
		await pi.input("/skill:imm-run");
		const failure = await pi.batch();
		expect(pi.dialogs.count).toBe(1);
		expect(failure.code).not.toBe(RUN_ENTRY_REQUIRED);
	});

	test("a run entry stays live across later ordinary prompts in the session", async () => {
		const pi = session(fixtureRoot());
		await pi.input("/skill:imm-run");
		await pi.input("continue S2");
		await pi.input("继续");
		await pi.enroll();
		expect(pi.dialogs.count).toBe(1);
	});

	for (const plan of ["/skill:imm-planner", "/skill:imm-brainstorm topic", "/planner"]) {
		test(`a later plan entry ${JSON.stringify(plan)} revokes the run entry until imm-run is entered again`, async () => {
			const pi = session(fixtureRoot());
			await pi.input("/skill:imm-run");
			await pi.input(plan);
			expect(await pi.enroll()).toMatchObject(REFUSED);
			expect(await pi.batch()).toMatchObject(REFUSED);
			expect(pi.dialogs.count).toBe(0);

			await pi.input("/skill:imm-run");
			await pi.enroll();
			expect(pi.dialogs.count).toBe(1);
		});
	}

	test("an entry belongs to its session: another session and a session without identity both refuse", async () => {
		const root = fixtureRoot();
		const entered = session(root);
		await entered.input("/skill:imm-run");

		const other = session(root);
		expect(await other.enroll()).toMatchObject(REFUSED);
		expect(await other.batch()).toMatchObject(REFUSED);
		expect(other.dialogs.count).toBe(0);

		for (const identity of [null, {}, { getSessionId: () => "" }, { getSessionId: () => { throw new Error("no session"); } }]) {
			const anonymous = session(root, identity as never);
			await anonymous.input("/skill:imm-run");
			expect(await anonymous.enroll()).toMatchObject(REFUSED);
			expect(await anonymous.batch()).toMatchObject(REFUSED);
			expect(anonymous.dialogs.count).toBe(0);
		}
	});

	test("a separately loaded copy of the extension module sees the same entry", async () => {
		// Pi loads each extension file as its own module graph.
		const copy = await import(`../plugins/immune-brain/.pi-extension/imm-canary-work.ts?copy=${randomUUID()}`);
		const identity = stableIdentity();
		const root = fixtureRoot();
		expect(copy.piRunEntryRefusal("enroll", { cwd: root, sessionManager: identity })).toMatchObject({ reason_code: RUN_ENTRY_REQUIRED });
		const pi = session(root, identity);
		await pi.input("/skill:imm-run");
		expect(copy.piRunEntryRefusal("enroll", { cwd: root, sessionManager: identity })).toBeNull();
	});
	test("under a literal entry, enroll and batch start each open one dialog, a decline claims nothing, and retirement opens none (ADR 0025)", async () => {
		const root = fixtureRoot();
		const pi = session(root);
		await pi.input("/skill:imm-run");

		await pi.enroll();
		expect(pi.dialogs.count).toBe(1);
		expect(readBackendClaim(root)).toBeNull();
		await pi.batch();
		expect(pi.dialogs.count).toBe(2);
		expect(readBackendClaim(root)).toBeNull();

		// The same live entry later retires a parked batch with no dialog.
		const batch = staleBatch(root);
		expect(await pi.retire()).toEqual({});
		expect(pi.dialogs.count).toBe(2);
		const report = batch.report();
		expect(report?.batch_state).toBe("superseded");
		expect(report?.retirement?.confirmation_ref).toMatch(/^pi-entry-[0-9a-f]{16}$/);
		expect(report?.retirement?.plan_digest).toBe(STALE_DIGEST);
	});

	test("without a live entry token retirement refuses before any dialog and writes nothing", async () => {
		const cases: Array<[string, (root: string) => Promise<ReturnType<typeof session>>]> = [
			["no prior entry", async (root) => session(root)],
			["only extension-sourced input naming imm-run", async (root) => {
				const pi = session(root);
				await pi.input("/skill:imm-run", "extension");
				return pi;
			}],
			["another session's entry", async (root) => {
				await session(root).input("/skill:imm-run");
				return session(root);
			}],
			["an entry ended by session shutdown", async (root) => {
				const pi = session(root);
				await pi.input("/skill:imm-run");
				await pi.shutdown();
				return pi;
			}],
			["an entry made in another workspace", async (root) => {
				const identity = stableIdentity();
				await session(fixtureRoot(), identity).input("/skill:imm-run");
				return session(root, identity);
			}],
			["an entry ended by a run pause", async (root) => {
				const identity = stableIdentity();
				const pi = session(root, identity);
				await pi.input("/skill:imm-run");
				// The continuation boundary's pause port (pi-run-continuation revokeEntry).
				revokePiPhaseEntry(identity.getSessionId());
				return pi;
			}],
			["an entry ended by a user interrupt (AC4)", async (root) => {
				const pi = session(root);
				await pi.input("/skill:imm-run");
				await pi.settle("aborted", false);
				return pi;
			}],
		];
		for (const [name, make] of cases) {
			const root = fixtureRoot();
			const batch = staleBatch(root);
			const before = batch.bytes();
			const pi = await make(root);
			expect({ name, failure: await pi.retire() }).toMatchObject({ name, failure: { ...REFUSED, message: "retire_stale_batch needs a literal-user imm-run entry in this session" } });
			expect({ name, dialogs: pi.dialogs.count }).toEqual({ name, dialogs: 0 });
			expect(batch.bytes().equals(before)).toBe(true);
			expect(batch.report()).toBeNull();
		}
	});
	test("a live entry token does not stand in for a rework-exit choice: its dialog still opens", async () => {
		const root = fixtureRoot();
		const pi = session(root);
		await pi.input("/skill:imm-run");
		pi.dialogs.answers.push("confirm");
		await pi.enroll();
		expect(readBackendClaim(root)?.task_id).toBe(TASK);

		// The Kernel parks the task for a replan; leaving rework is the user's choice.
		withKernelTransaction(root, (db) => {
			const run = readRunRowByTask(db, TASK)!;
			const record = JSON.parse(run.record_json);
			record.artifact_state = "active";
			record.findings.push({ id: "rework:review-limit:replan-required", kind: "replan_required", status: "open",
				acceptance_id: null, source: "kernel", review_round: 3, summary: "Review rework limit reached" });
			updateRunRecord(db, run.run_id, run.revision, `${JSON.stringify(record, null, 2)}\n`, new Date().toISOString());
		});
		const opened = pi.dialogs.count;
		await pi.authorize();
		expect(pi.dialogs.count).toBe(opened + 1);
		const record = JSON.parse(withKernelTransaction(root, (db) => readRunRowByTask(db, TASK)!.record_json));
		expect(record.findings.find((finding: { kind: string }) => finding.kind === "replan_required")?.status).toBe("open");
	});
});
