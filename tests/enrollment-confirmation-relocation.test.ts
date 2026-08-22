// Validates 2026-08-20-015 relocate-enrollment-confirmation.
// Three acceptances: single confirmation for routine, post-confirmation rehearsal invalidates with zero writes, digest binding.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
} from "../plugins/immune-brain/runtime/authority_commit_receipts";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";

type Mode = "tui" | "rpc" | "json" | "print";

interface FakeUI {
	confirmCalls: Array<{ title: string; body: string }>;
	customCalls: Array<{ body: string; collapsedBody: string }>;
	notifyCalls: Array<{ text: string; kind: string }>;
	confirmResult: boolean;
	signal?: AbortSignal;
	beforeConfirm?: () => void;
}

function makeFakeUI(confirmResult: boolean): FakeUI {
	return { confirmCalls: [], customCalls: [], notifyCalls: [], confirmResult };
}

function makeCtx(root: string, ui: FakeUI, mode: Mode, cwdOverride?: string) {
	return {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		cwd: cwdOverride ?? root,
		isIdle: () => true,
		ui: {
			custom: async (
				factory: (tui: unknown, theme: { fg: (_color: string, text: string) => string; bold: (text: string) => string }, keybindings: unknown, done: (result: boolean) => void) => { render: (width: number) => string[]; handleInput?: (data: string) => void },
			) => {
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
	const root = mkdtempSync(join(tmpdir(), "enroll-reloc-"));
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

function makeEligibleRepo(
	root: string,
	taskId: string,
	risk: "routine" | "material" | "critical" = "routine",
	opts: { acceptShouldPass?: boolean } = {},
): void {
	const shouldPass = opts.acceptShouldPass ?? true;
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "t@t"]);
	git(root, ["config", "user.name", "t"]);
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "docs", "evidence", "assurance-kernel"), { recursive: true });
	mkdirSync(join(root, "scripts"), { recursive: true });
	writeFileSync(join(root, "scripts", "accept.ts"), shouldPass ? "process.exit(0);\n" : "process.exit(7);\n");
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
					{
						id: "A1",
						assertion: "artifact exists",
						verification: JSON.stringify({
							contract: "assurance_kernel/verification_descriptor/v1",
							runner_id: "bun",
							runner_version: "1.3.14",
							argv: ["run", "scripts/accept.ts"],
							cwd: ".",
							timeout_ms: 5_000,
							max_output_bytes: 16_384,
						}),
					},
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
		const after = sh(`state-after-${n}-${taskId}`);
		const pathIdentity = sh(`state-path-${n}-${taskId}`);
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
			targets: [{ path: ".imm/memory/current_iteration.json", before_sha256: null, after_sha256: after }],
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

	// readiness evidence
	const { buildMigrationDryRunReport, migrationDryRunDigest } = require("../plugins/immune-brain/runtime/commands/kernel") as typeof import("../plugins/immune-brain/runtime/commands/kernel");
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

async function captureToolFailure(promise: Promise<unknown>): Promise<Record<string, unknown>> {
	return promise.then(
		() => { throw new Error("expected Tool failure"); },
		(error: unknown) => JSON.parse(error instanceof Error ? error.message : String(error)),
	);
}

async function runTool(root: string, ui: FakeUI, updates: string[] = [], action: "enroll" | "new" = "enroll", taskId = "enroll-task-001"): Promise<any> {
	const factory = await loadExtension();
	let tool: { execute: (...args: any[]) => Promise<any> } | undefined;
	factory({
		registerCommand: () => undefined,
		registerTool: (candidate: { execute: (...args: any[]) => Promise<any> }) => { tool = candidate; },
	} as never);
	if (!tool) throw new Error("enrollment Tool not registered");
	return tool.execute(
		"tool-call",
		{ action, task_id: taskId },
		ui.signal,
		(update: { details?: { stage?: string } }) => {
			if (update.details?.stage) updates.push(update.details.stage);
		},
		makeCtx(root, ui, "tui"),
	);
}

describe("enrollment confirmation relocation", () => {
	test("acc-single-confirmation-routine: routine task proceeds with exactly one host confirmation", async () => {
		const TASK = "enroll-task-001";
		const root = makeRoot();
		try {
			makeEligibleRepo(root, TASK, "routine", { acceptShouldPass: true });
			const before = authoritySnapshot(root);
			expect(before).toContain("tasks:");
			const ui = makeFakeUI(true);
			const updates: string[] = [];
			const result = await runTool(root, ui, updates, "new", TASK);
			// Exactly one host confirmation (ctx.ui.custom) for routine task
			expect(ui.confirmCalls.length).toBe(1);
			expect(ui.customCalls.length).toBe(1);
			// Confirmation is bound to intent content hash: details contain intent digest
			expect(ui.confirmCalls[0].body).toContain("Intent digest:");
			expect(ui.confirmCalls[0].body).toContain("Goal: publish the canary");
			// Enrollment completes without second human stop; routine proceeds through QA in real flow, here we verify enrollment completed
			expect(result.details.state).toBe("completed");
			expect(result.details.summary).toMatch(/enrollment completed/i);
			// Progress shows awaiting_confirmation before snapshotting/rehearsing (relocated before machine work)
			const confirmIdx = updates.indexOf("awaiting_confirmation");
			const rehearseIdx = updates.indexOf("rehearsing");
			expect(confirmIdx).toBeGreaterThanOrEqual(0);
			expect(rehearseIdx).toBeGreaterThanOrEqual(0);
			expect(confirmIdx).toBeLessThan(rehearseIdx);
			// Authority was written exactly once
			expect(readdirSync(join(root, ".imm", "tasks")).sort()).toEqual([".backend-claim.json", `${TASK}.json`]);
			expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("acc-post-confirmation-rehearsal-invalidates: descriptor failure after confirmation blocks with zero writes", async () => {
		const TASK = "enroll-task-001";
		const root = makeRoot();
		try {
			makeEligibleRepo(root, TASK, "routine", { acceptShouldPass: false });
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(true);
			const result = await captureToolFailure(runTool(root, ui, [], "new", TASK));
			// Confirmation happened before rehearsal failure
			expect(ui.confirmCalls.length).toBe(1);
			expect(ui.customCalls.length).toBe(1);
			// Rehearsal failure is a host-visible Tool error.
			expect(result).toMatchObject({
				contract: "immune_brain/tool_failure/v1",
				state: "blocked",
				message: expect.stringMatching(/Descriptor rehearsal blocked/i),
			});
			// Invalidates authorization: zero authority writes (not rolled back)
			expect(authoritySnapshot(root)).toBe(before);
			expect(readdirSync(join(root, ".imm", "tasks")).sort()).toEqual([]);
			expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(false);
			expect(existsSync(join(root, ".imm", "backend_claim.json"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("acc-digest-binding: confirmation rejected if intent changes after it is given", async () => {
		const TASK = "enroll-task-001";
		const root = makeRoot();
		try {
			makeEligibleRepo(root, TASK, "routine", { acceptShouldPass: true });
			const before = authoritySnapshot(root);
			const intentBefore = readTaskIntent(root, TASK).content_hash;
			const ui = makeFakeUI(true);
			ui.beforeConfirm = () => {
				// Mutate intent content while keeping revision 1: digest binding must fail
				writeFileSync(
					join(root, "docs", "plans", `${TASK}.intent.json`),
					`${JSON.stringify(
						{
							contract: "assurance_kernel/task_intent/v1",
							task_id: TASK,
							goal: "publish the canary v2 (drifted after confirmation)",
							owner: "user",
							risk: "routine",
							revision: 1,
							scope_hint: ["publish"],
							acceptance: [
								{
									id: "A1",
									assertion: "artifact exists",
									verification: JSON.stringify({
										contract: "assurance_kernel/verification_descriptor/v1",
										runner_id: "bun",
										runner_version: "1.3.14",
										argv: ["run", "scripts/accept.ts"],
										cwd: ".",
										timeout_ms: 5_000,
										max_output_bytes: 16_384,
									}),
								},
							],
						},
						null,
						2,
					)}\n`,
				);
			};
			const result = await captureToolFailure(runTool(root, ui, [], "new", TASK));
			const intentAfter = (() => {
				try {
					return readTaskIntent(root, TASK).content_hash;
				} catch {
					return "unreadable";
				}
			})();
			expect(intentAfter).not.toBe(intentBefore);
			expect(ui.confirmCalls.length).toBe(1);
			expect(result).toMatchObject({
				contract: "immune_brain/tool_failure/v1",
				state: "blocked",
				message: expect.stringMatching(/Intent changed after confirmation|Workspace changed after confirmation/i),
			});
			// Zero writes
			expect(authoritySnapshot(root)).toBe(before);
			expect(readdirSync(join(root, ".imm", "tasks")).sort()).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
