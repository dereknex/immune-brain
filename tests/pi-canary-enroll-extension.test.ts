// Simulates the Pi loader (default export factory), verifies the foreground
// Tool surface and zero writes on every rejection path.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
} from "../plugins/immune-brain/runtime/authority_commit_receipts";
import { assertTaskIntentPreparationStable } from "../plugins/immune-brain/.pi-extension/imm-canary-enroll";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import {
	buildMigrationDryRunReport,
	migrationDryRunDigest,
} from "../plugins/immune-brain/runtime/commands/kernel";

type Mode = "tui" | "rpc" | "json" | "print";

interface FakeUI {
	confirmCalls: Array<{ title: string; body: string }>;
	customCalls: Array<{ body: string; collapsedBody: string }>;
	notifyCalls: Array<{ text: string; kind: string }>;
	widgetCalls: Array<{ key: string; content: string[] | undefined; options?: { placement?: string } }>;
	confirmResult: boolean;
	signal?: AbortSignal;
	beforeConfirm?: () => void;
	customError?: Error;
}

function makeFakeUI(confirmResult: boolean): FakeUI {
	return { confirmCalls: [], customCalls: [], notifyCalls: [], widgetCalls: [], confirmResult };
}

function makeCtx(root: string, ui: FakeUI, mode: Mode, cwdOverride?: string) {
	return {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		cwd: cwdOverride ?? root,
		isIdle: () => true,
		ui: {
			setWidget: (key: string, content: string[] | undefined, options?: { placement?: string }) => {
				ui.widgetCalls.push({ key, content, options });
			},
			custom: async (
				factory: (tui: unknown, theme: { fg: (_color: string, text: string) => string; bold: (text: string) => string }, keybindings: unknown, done: (result: boolean) => void) => { render: (width: number) => string[]; handleInput?: (data: string) => void },
			) => {
				if (ui.customError) throw ui.customError;
				let selected: boolean | undefined;
				const component = factory(
					{ requestRender: () => undefined },
					{ fg: (_color, text) => text, bold: (text) => text },
					{},
					(result) => { selected = result; },
				);
				const collapsedBody = component.render(120).join("\n");
				component.handleInput?.("d");
				const body = component.render(120).join("\n");
				ui.customCalls.push({ body, collapsedBody });
				ui.confirmCalls.push({ title: "Enrollment confirmation", body });
				ui.beforeConfirm?.();
				if (ui.signal?.aborted) return false;
				if (ui.confirmResult) component.handleInput?.("\r");
				else {
					component.handleInput?.("\u001b[B");
					component.handleInput?.("\r");
				}
				return selected ?? ui.confirmResult;
			},
			notify: (text: string, kind: string) => {
				ui.notifyCalls.push({ text, kind });
			},
		},
	};
}

async function loadExtension() {
	const mod = await import("../plugins/immune-brain/.pi-extension/imm-canary-enroll");
	return mod.default;
}

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "p2b1-ext-"));
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	writeFileSync(
		join(root, ".imm", "memory", "current_iteration.json"),
		JSON.stringify(
			{
				plan_path: "docs/plans/example.md",
				plan_signature: "sig",
				steps: {},
				runtime_status: "idle",
				requires_replan: false,
				active_step: null,
				plan_terminal: null,
			},
			null,
			2,
		),
	);
	return root;
}

describe("pi canary enroll extension", () => {
	test("confirmation deadwood is removed: no tier predicate and no pi-plan-approved branch", () => {
		const source = readFileSync(
			new URL("../plugins/immune-brain/.pi-extension/imm-canary-enroll.ts", import.meta.url),
			"utf8",
		);
		expect(source).not.toContain("requiresEnrollmentConfirmation");
		expect(source).not.toContain("pi-plan-approved");
		expect(source).toContain("pi-confirm-");
	});

	test("registers one foreground Tool and no Slash Command", async () => {
		const commands: string[] = [];
		const tools: string[] = [];
		const factory = await loadExtension();
		const pi = {
			registerCommand: (name: string) => commands.push(name),
			registerTool: (tool: { name: string }) => tools.push(tool.name),
		};
		factory(pi as never);
		expect(commands).toEqual([]);
		expect(tools).toEqual(["imm_canary_enrollment"]);
	});

	async function directTool(root: string, ui: FakeUI, mode: Mode, taskId: string) {
		const factory = await loadExtension();
		let tool: { execute: (...args: any[]) => Promise<any> } | undefined;
		factory({
			registerCommand: () => undefined,
			registerTool: (candidate: { execute: (...args: any[]) => Promise<any> }) => { tool = candidate; },
		} as never);
		if (!tool) throw new Error("enrollment Tool not registered");
		return tool.execute(
			"tool-call",
			{ action: "enroll", task_id: taskId },
			ui.signal,
			undefined,
			makeCtx(root, ui, mode),
		);
	}

	async function capturedToolFailure(promise: Promise<unknown>) {
		try {
			await promise;
			throw new Error("expected Tool failure");
		} catch (error) {
			const failure = JSON.parse(error instanceof Error ? error.message : String(error));
			expect(failure.contract).toBe("immune_brain/tool_failure/v1");
			return failure;
		}
	}

	test("non-TUI modes reject before any readiness read or confirm", async () => {
		const root = makeRoot();
		const ui = makeFakeUI(true);
		for (const mode of ["rpc", "json", "print"] as Mode[]) {
			const result = await capturedToolFailure(directTool(root, ui, mode, "task-001"));
			expect(result.state).toBe("blocked");
			expect(result.message).toMatch(/TUI-only/i);
			expect(ui.confirmCalls.length).toBe(0);
		}
		expect(readdirSync(join(root, ".imm", "tasks"))).toEqual([]);
	});

	test("missing intent sidecar rejects before any confirm", async () => {
		const root = makeRoot();
		const ui = makeFakeUI(true);
		const result = await capturedToolFailure(directTool(root, ui, "tui", "task-001"));
		expect(result.state).toBe("blocked");
		expect(result.message).toMatch(/TaskIntent is required/i);
		expect(ui.confirmCalls.length).toBe(0);
		expect(readdirSync(join(root, ".imm", "tasks"))).toEqual([]);
	});

	test("tracked malformed intent reports canonical validation before rehearsal", async () => {
		const root = makeRoot();
		execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["config", "user.name", "test"], { cwd: root, stdio: "ignore" });
		writeFileSync(
			join(root, "docs", "plans", "task-001.intent.json"),
			JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: "task-001",
				owner: "user",
				risk: "routine",
				revision: 1,
				scope_hint: [],
				acceptance: [],
			}),
		);
		execFileSync("git", ["add", "docs/plans/task-001.intent.json"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["commit", "-qm", "malformed intent fixture"], { cwd: root, stdio: "ignore" });
		const result = await capturedToolFailure(directTool(root, makeFakeUI(true), "tui", "task-001"));
		expect(result.state).toBe("blocked");
		expect(result.message).toMatch(/TaskIntent validation failed/i);
		expect(result.message).toMatch(/intent\.goal/i);
		expect(result.message).not.toMatch(/TaskIntent is required/i);
	});

	test("malformed task id rejects before any confirm", async () => {
		const root = makeRoot();
		const ui = makeFakeUI(true);
		const result = await capturedToolFailure(directTool(root, ui, "tui", "../evil"));
		expect(result.state).toBe("blocked");
		expect(result.message).toMatch(/invalid task id/i);
		expect(ui.confirmCalls.length).toBe(0);
	});
});

describe("pi canary enroll handler integration", () => {
	async function capturedToolFailure(promise: Promise<unknown>) {
		try {
			await promise;
			throw new Error("expected Tool failure");
		} catch (error) {
			const failure = JSON.parse(error instanceof Error ? error.message : String(error));
			expect(failure.contract).toBe("immune_brain/tool_failure/v1");
			return failure;
		}
	}

	const TASK = "enroll-task-001";

	function git(root: string, args: string[]): void {
		execFileSync("git", args, { cwd: root, stdio: "ignore" });
	}

	function stableStringify(value: unknown): string {
		if (value === null || value === undefined) return "null";
		if (typeof value !== "object") return JSON.stringify(value);
		if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(", ")}]`;
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}: ${stableStringify(record[key])}`).join(", ")}}`;
	}

	function sh(value: string): string {
		return `sha256:${createHash("sha256").update(value).digest("hex")}`;
	}

	// Complete eligible fixture: 3 committed receipts (hash-chained prepared +
	// committed per attempt) with matching v2 observations (3 full lifecycles,
	// all required families), plus a valid evidence bundle whose migration
	// digest is computed from the live fixture ledger.
	function makeEligibleRepo(
		root: string,
		taskId: string,
		risk: "routine" | "material" | "critical" = "routine",
	): void {
		git(root, ["init", "-q"]);
		git(root, ["config", "user.email", "t@t"]);
		git(root, ["config", "user.name", "t"]);
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, "docs", "evidence", "assurance-kernel"), { recursive: true });
		mkdirSync(join(root, "scripts"), { recursive: true });
		writeFileSync(join(root, "scripts", "accept.ts"), "process.exit(0);\n");
		mkdirSync(join(root, ".imm", "memory"), { recursive: true });
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		writeFileSync(
			join(root, ".imm", "memory", "current_iteration.json"),
			JSON.stringify(
				{
					plan_path: "docs/plans/example.md",
					plan_signature: "sig",
					steps: {},
					runtime_status: "idle",
					requires_replan: false,
					active_step: null,
					plan_terminal: null,
				},
				null,
				2,
			),
		);
		writeFileSync(
			join(root, "docs", "plans", `${taskId}.intent.json`),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/task_intent/v1",
					task_id: taskId,
					goal: "publish the canary",
					owner: "user",
					risk,
					revision: 1,
					scope_hint: ["publish"],
					acceptance: [
						{ id: "A1", assertion: "artifact exists", verification: JSON.stringify({
							contract: "assurance_kernel/verification_descriptor/v1",
							runner_id: "bun",
							runner_version: "1.3.14",
							argv: ["run", "scripts/accept.ts"],
							cwd: ".",
							timeout_ms: 5_000,
							max_output_bytes: 16_384,
						}) },
					],
				},
				null,
				2,
			)}\n`,
		);

		let previous: string | null = null;
		const receiptLines: string[] = [];
		const committedIds: string[] = [];
		const observationLines: string[] = [];
		for (let n = 1; n <= 3; n += 1) {
			const attemptId = `00000000-0000-4000-8000-00000000000${n}`;
			const after = sh(`state-after-${n}`);
			const pathIdentity = sh(`state-path-${n}`);
			const ledgerRevision = `rev-${n}`;
			const planPath = `docs/plans/plan-${n}.md`;
			const planSignature = sh(`plan-sig-${n}`);
			const sourceRef = `imm-work record-execution ${n}`;
			const sourceEvents = [
				{ id: `a${n}`, action: "activate_step", at: `2026-08-01T00:00:0${n}Z` },
				{ id: `e${n}`, action: "record_execution_evidence", at: `2026-08-02T00:00:0${n}Z` },
				{ id: `r${n}`, action: "review_step", at: `2026-08-03T00:00:0${n}Z` },
				{ id: `f${n}`, action: "finish_reset", at: `2026-08-04T00:00:0${n}Z` },
			];
			const seed = {
				contract: "assurance_kernel/authority_observation_seed/v2",
				observer_version: AUTHORITY_OBSERVER_VERSION_V2,
				source_kind: "state_mutation",
				source_ref: sourceRef,
				state_path_identity: pathIdentity,
				committed_bytes_sha256: after,
				committed_revision: ledgerRevision,
				committed_at: `2026-08-0${n}T00:00:00Z`,
				plan_path: planPath,
				plan_signature: planSignature,
				source_events: sourceEvents,
				shadow: { phase: "done", reason: "finished", ambiguous: false, source_states: [] },
				divergence: { detected: false, fields: [] },
			};
			const body = (status: string, prevHash: string | null) => ({
				contract: "assurance_kernel/authority_commit_receipt/v2",
				attempt_id: attemptId,
				source_kind: "state_mutation",
				status,
				state_path_identity: pathIdentity,
				targets: [
					{ path: ".imm/memory/current_iteration.json", before_sha256: null, after_sha256: after },
				],
				before_sha256: null,
				after_sha256: after,
				ledger_revision: ledgerRevision,
				source_ref: sourceRef,
				previous_record_hash: prevHash,
				recorded_at: `2026-08-0${n}T00:00:00Z`,
				observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
				observation_seed: seed,
			});
			const preparedBody = body("prepared", previous);
			const preparedId = sh(`assurance-kernel-authority-commit-receipt/v2\0${stableStringify(preparedBody)}`);
			receiptLines.push(JSON.stringify({ ...preparedBody, record_id: preparedId }));
			const committedBody = body("committed", preparedId);
			const committedId = sh(`assurance-kernel-authority-commit-receipt/v2\0${stableStringify(committedBody)}`);
			receiptLines.push(JSON.stringify({ ...committedBody, record_id: committedId }));
			committedIds.push(committedId);
			previous = committedId;

			const observationCore = {
				contract: "assurance_kernel/v3_authority_observation/v2",
				receipt_record_id: committedId,
				receipt_attempt_id: attemptId,
				receipt_protocol: "assurance_kernel/authority_commit_receipt/v2",
				receipt_status: "committed",
				source_kind: "state_mutation",
				source_ref: sourceRef,
				state_path_identity: pathIdentity,
				committed_bytes_sha256: after,
				ledger_revision: ledgerRevision,
				plan_path: planPath,
				plan_signature: planSignature,
				source_events: sourceEvents,
				shadow: { phase: "done", reason: "finished", ambiguous: false, source_states: [] },
				divergence: { detected: false, fields: [] },
				observer_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
				observer_version: AUTHORITY_OBSERVER_VERSION_V2,
				committed_at: `2026-08-0${n}T00:00:00Z`,
				observed_at: `2026-08-0${n}T00:00:01Z`,
			};
			observationLines.push(
				JSON.stringify({
					...observationCore,
					observation_id: sh(`assurance-kernel-v3-observation/v2\0${stableStringify(observationCore)}`),
				}),
			);
		}
		writeFileSync(
			join(root, ".imm", "memory", ".current_iteration.authority_commit_receipts.jsonl"),
			`${receiptLines.join("\n")}\n`,
		);
		writeFileSync(
			join(root, ".imm", "memory", ".current_iteration.automatic_observations.jsonl"),
			`${observationLines.join("\n")}\n`,
		);
		git(root, ["add", "-A"]);
		git(root, ["commit", "-qm", "fixture state"]);

		const digest = migrationDryRunDigest(buildMigrationDryRunReport(root));
		writeFileSync(
			join(root, "docs", "evidence", "assurance-kernel", "readiness.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/readiness_evidence/v1",
					generated_at: "2026-08-10T00:00:00Z",
					observer_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
					observer_version: AUTHORITY_OBSERVER_VERSION_V2,
					migration_dry_run: { digest, writes_performed: false },
					rollback_rehearsal: {
						result: "passed",
						at: "2026-08-09T00:00:00Z",
						summary: "rollback rehearsal passed",
						receipt_record_ids: committedIds,
					},
				},
				null,
				2,
			)}\n`,
		);
		git(root, ["add", "-A"]);
		git(root, ["commit", "-qm", "evidence"]);
	}

	function authoritySnapshot(root: string): string {
		const parts: string[] = [];
		for (const path of [
			".imm/memory/current_iteration.json",
			".imm/memory/.current_iteration.authority_commit_receipts.jsonl",
			".imm/memory/.current_iteration.automatic_observations.jsonl",
		]) {
			const full = join(root, path);
			try {
				parts.push(`${path}:${readFileSync(full, "utf8")}`);
			} catch {
				parts.push(`${path}:ENOENT`);
			}
		}
		parts.push(`tasks:${readdirSync(join(root, ".imm", "tasks")).sort().join(",")}`);
		parts.push(`workspace:${existsSync(join(root, ".imm", "workspace.json"))}`);
		parts.push(`backend:${existsSync(join(root, ".imm", "backend_claim.json"))}`);
		return parts.join("\n");
	}

	async function runTool(
		root: string,
		ui: FakeUI,
		updates: string[] = [],
		action: "enroll" | "new" = "enroll",
		emitted: Array<{ name: string; payload: Record<string, unknown> }> = [],
		sessionShutdown: Array<(event: unknown, ctx: ReturnType<typeof makeCtx>) => Promise<void>> = [],
	): Promise<any> {
		const factory = await loadExtension();
		let tool: { execute: (...args: any[]) => Promise<any> } | undefined;
		factory({
			registerCommand: () => undefined,
			registerTool: (candidate: { execute: (...args: any[]) => Promise<any> }) => { tool = candidate; },
			on: (name: string, handler: (event: unknown, ctx: ReturnType<typeof makeCtx>) => Promise<void>) => {
				if (name === "session_shutdown") sessionShutdown.push(handler);
			},
			events: {
				emit: (name: string, payload: Record<string, unknown>) => emitted.push({ name, payload }),
			},
		} as never);
		if (!tool) throw new Error("enrollment Tool not registered");
		return tool.execute(
			"tool-call",
			{ action, task_id: TASK },
			ui.signal,
			(update: { details?: { stage?: string } }) => {
				if (update.details?.stage) updates.push(update.details.stage);
			},
			makeCtx(root, ui, "tui"),
		);
	}


	test("rejects a TaskIntent changed between preflight and immutable preparation", () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const preflight = readTaskIntent(root, TASK);
			const intentPath = join(root, "docs", "plans", `${TASK}.intent.json`);
			const changed = JSON.parse(readFileSync(intentPath, "utf8")) as { risk: string };
			changed.risk = "material";
			writeFileSync(intentPath, `${JSON.stringify(changed, null, 2)}\n`);
			git(root, ["add", intentPath]);
			const preparation = preparePiCanary(root, { task_id: TASK, now: new Date().toISOString() });
			expect(() => assertTaskIntentPreparationStable(preflight, preparation)).toThrow(
				/changed during preparation/i,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("shared-authority-dialog-shell: routine new waits for confirmation and displays the immutable staged intent", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const updates: string[] = [];
			const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
			const shutdown: Array<(event: unknown, ctx: ReturnType<typeof makeCtx>) => Promise<void>> = [];
			const ui = makeFakeUI(true);
			const result = await runTool(root, ui, updates, "new", emitted, shutdown);
			expect(result.details.state).toBe("completed");
			expect(ui.confirmCalls).toHaveLength(1);
			expect(ui.customCalls[0].collapsedBody).toContain("Details collapsed; press d to expand.");
			expect(ui.customCalls[0].body).toContain("Acceptance descriptors:");
			expect(ui.confirmCalls[0].body).toContain("Goal: publish the canary");
			expect(ui.confirmCalls[0].body).toContain("Risk: routine");
			expect(ui.confirmCalls[0].body).toContain("Scope: publish");
			expect(ui.confirmCalls[0].body).toContain("A1: artifact exists");
			const stagedDigest = `sha256:${createHash("sha256").update(execFileSync("git", ["ls-files", "--stage", "-z"], { cwd: root })).digest("hex")}`;
			expect(ui.confirmCalls[0].body).toContain(`Staged digest: ${stagedDigest}`);
			expect(updates).toContain("awaiting_confirmation");
			expect(emitted).toHaveLength(2);
			expect(emitted[0]).toMatchObject({
				name: "immune-brain:user-attention.v1",
				payload: { active: true, task_id: TASK, reason: "enrollment" },
			});
			expect(emitted[1]).toEqual({
				name: "immune-brain:user-attention.v1",
				payload: {
					active: false,
					attention_id: emitted[0].payload.attention_id,
					task_id: TASK,
					reason: "enrollment",
				},
			});
			expect(JSON.stringify(emitted)).not.toMatch(/digest|descriptor|scope|prompt/i);
			expect(ui.widgetCalls.some((call) => call.options?.placement === "aboveEditor"
				&& call.content?.join("\n").includes(`Task ${TASK} · Approval required`))).toBe(true);
			expect(shutdown).toHaveLength(1);
			await shutdown[0]({}, makeCtx(root, ui, "tui"));
			expect(ui.widgetCalls.at(-1)).toMatchObject({ key: "immune-brain.task-rail", content: undefined });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("material new retains the confirmation gate", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK, "material");
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(false);
			const result = await runTool(root, ui, [], "new");
			expect(ui.confirmCalls.length).toBe(1);
			expect(result.details.state).toBe("rejected");
			expect(result.details.summary).toMatch(/confirmation was rejected/i);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("critical new retains the confirmation gate", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK, "critical");
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(false);
			const result = await runTool(root, ui, [], "new");
			expect(ui.confirmCalls.length).toBe(1);
			expect(result.details.state).toBe("rejected");
			expect(result.details.summary).toMatch(/confirmation was rejected/i);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("routine explicit rehearsal waiver retains confirmation and zero writes", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			writeFileSync(join(root, "scripts", "accept.ts"), "process.exit(1);\n");
			git(root, ["add", "scripts/accept.ts"]);
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(false);
			const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
			const result = await runTool(root, ui, [], "enroll", emitted);
			expect(ui.confirmCalls.length).toBe(1);
			expect(result.details.state).toBe("rejected");
			expect(result.details.summary).toMatch(/confirmation was rejected/i);
			expect(emitted.map((event) => event.payload.reason)).toEqual(["descriptor_waiver", "descriptor_waiver"]);
			expect(emitted.map((event) => event.payload.active)).toEqual([true, false]);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("declined confirmation returns rejection with zero writes", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(false);
			const result = await runTool(root, ui);
			expect(ui.confirmCalls.length).toBe(1);
			expect(result.details.state).toBe("rejected");
			expect(result.details.summary).toMatch(/confirmation was rejected/i);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("AbortSignal cancellation returns only after child settlement with zero writes", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(true);
			ui.signal = AbortSignal.abort(new Error("host cancelled"));
			const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
			const result = await runTool(root, ui, [], "enroll", emitted);
			expect(result.details.state).toBe("cancelled");
			expect(ui.confirmCalls.length).toBe(0);
			expect(emitted).toEqual([]);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("UI abort during confirmation returns cancellation with zero writes", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const before = authoritySnapshot(root);
			const controller = new AbortController();
			const ui = makeFakeUI(true);
			ui.signal = controller.signal;
			ui.beforeConfirm = () => controller.abort(new Error("user aborted confirmation"));
			const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
			const result = await runTool(root, ui, [], "enroll", emitted);
			expect(ui.confirmCalls).toHaveLength(1);
			expect(result.details.state).toBe("cancelled");
			expect(emitted.map((event) => event.payload.active)).toEqual([true, false]);
			expect(emitted[1].payload.attention_id).toBe(emitted[0].payload.attention_id);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("authority dialog failure closes attention with zero authority writes", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(true);
			ui.customError = new Error("renderer unavailable");
			const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
			const failure = await capturedToolFailure(runTool(root, ui, [], "enroll", emitted));
			expect(failure.state).toBe("failed");
			expect(failure.message).toContain("renderer unavailable");
			expect(emitted.map((event) => event.payload.active)).toEqual([true, false]);
			expect(emitted[1].payload.attention_id).toBe(emitted[0].payload.attention_id);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("one-shot: second identical invocation after enrollment cannot enroll again", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const updates: string[] = [];
			const first = await runTool(root, makeFakeUI(true), updates);
			expect(first.details.state).toBe("completed");
			expect(first.details.summary).toMatch(/enrollment completed/i);
			expect(updates).toEqual([
				"preparing",
				"awaiting_confirmation",
				"snapshotting",
				"rehearsing",
				"revalidating",
				"rehearsing",
				"committing",
			]);
			expect(readdirSync(join(root, ".imm", "tasks")).sort()).toEqual([".backend-claim.json", `${TASK}.json`]);
			const second = await runTool(root, makeFakeUI(true));
			expect(second.details.state).toBe("route_incumbent");
			expect(second.details.next_action).toContain("imm-loop");
			expect(second.details.summary).toMatch(/already owns/i);
			expect(readdirSync(join(root, ".imm", "tasks")).sort()).toEqual([".backend-claim.json", `${TASK}.json`]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
		// Runs two complete enrollment attempts including descriptor rehearsal; the 5s
		// default tips over under whole-suite load even though the flow itself is unchanged.
	}, 30_000);

	test("post-confirm same-revision intent content drift aborts before writes", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(true);
			ui.beforeConfirm = () => {
				// Mutate intent content while keeping revision 1: same-revision drift.
				writeFileSync(
					join(root, "docs", "plans", `${TASK}.intent.json`),
					`${JSON.stringify(
						{
							contract: "assurance_kernel/task_intent/v1",
							task_id: TASK,
							goal: "publish the canary v2 (drifted)",
							owner: "user",
							risk: "routine",
							revision: 1,
							scope_hint: ["publish"],
							acceptance: [
								{ id: "A1", assertion: "artifact exists", verification: "test -f artifact" },
							],
						},
						null,
						2,
					)}\n`,
				);
			};
			const result = await capturedToolFailure(runTool(root, ui));
			expect(ui.confirmCalls.length).toBe(1);
			expect(result.state).toBe("blocked");
			expect(result.message).toMatch(/changed after confirmation|Descriptor rehearsal blocked/i);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
