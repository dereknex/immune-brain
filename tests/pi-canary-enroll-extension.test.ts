// P2B1 U2: Pi extension surface tests.
// Simulates the Pi loader (default export factory), verifies exactly one
// command registers, TUI-only gate, missing-evidence fail-closed BEFORE any
// confirm, and zero writes on every rejection path.

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
import {
	buildMigrationDryRunReport,
	migrationDryRunDigest,
} from "../plugins/immune-brain/runtime/commands/kernel";

type Mode = "tui" | "rpc" | "json" | "print";

interface FakeUI {
	confirmCalls: Array<{ title: string; body: string }>;
	notifyCalls: Array<{ text: string; kind: string }>;
	confirmResult: boolean;
	signal?: AbortSignal;
	beforeConfirm?: () => void;
}

function makeFakeUI(confirmResult: boolean): FakeUI {
	return { confirmCalls: [], notifyCalls: [], confirmResult };
}

function makeCtx(root: string, ui: FakeUI, mode: Mode, cwdOverride?: string) {
	return {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		cwd: cwdOverride ?? root,
		signal: ui.signal,
		ui: {
			confirm: async (title: string, body: string) => {
				ui.confirmCalls.push({ title, body });
				if (ui.signal?.aborted) throw new DOMException("aborted", "AbortError");
				ui.beforeConfirm?.();
				return ui.confirmResult;
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
	test("registers exactly one command with TUI-only enrollment", async () => {
		const commands: string[] = [];
		const factory = await loadExtension();
		const pi = {
			registerCommand: (name: string, _spec: unknown) => {
				commands.push(name);
			},
		};
		factory(pi as never);
		expect(commands).toEqual(["imm-canary-enroll"]);
	});

	test("non-TUI modes reject before any readiness read or confirm", async () => {
		const root = makeRoot();
		const ui = makeFakeUI(true);
		const factory = await loadExtension();
		const registered: Array<{ handler: (args: string, ctx: unknown) => Promise<void> }> = [];
		factory({ registerCommand: (_n: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => registered.push(spec) } as never);
		for (const mode of ["rpc", "json", "print"] as Mode[]) {
			const ctx = makeCtx(root, ui, mode);
			await registered[0].handler("task-001", ctx);
			expect(ui.confirmCalls.length).toBe(0);
			expect(ui.notifyCalls.some((n) => /TUI-only/i.test(n.text))).toBe(true);
		}
		// zero writes
		expect(readdirSync(join(root, ".imm", "tasks"))).toEqual([]);
	});

	test("missing intent sidecar rejects BEFORE any confirm", async () => {
		const root = makeRoot();
		const ui = makeFakeUI(true);
		const factory = await loadExtension();
		const registered: Array<{ handler: (args: string, ctx: unknown) => Promise<void> }> = [];
		factory({ registerCommand: (_n: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => registered.push(spec) } as never);
		const ctx = makeCtx(root, ui, "tui");
		await registered[0].handler("task-001", ctx);
		expect(ui.confirmCalls.length).toBe(0);
		expect(ui.notifyCalls.some((n) => /TaskIntent is required/i.test(n.text))).toBe(true);
		expect(readdirSync(join(root, ".imm", "tasks"))).toEqual([]);
	});

	test("malformed task id rejects before any confirm", async () => {
		const root = makeRoot();
		const ui = makeFakeUI(true);
		const factory = await loadExtension();
		const registered: Array<{ handler: (args: string, ctx: unknown) => Promise<void> }> = [];
		factory({ registerCommand: (_n: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => registered.push(spec) } as never);
		const ctx = makeCtx(root, ui, "tui");
		await registered[0].handler("../evil", ctx);
		expect(ui.confirmCalls.length).toBe(0);
		expect(ui.notifyCalls.some((n) => /invalid task id/i.test(n.text))).toBe(true);
	});
});

describe("pi canary enroll handler integration", () => {
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
	function makeEligibleRepo(root: string, taskId: string): void {
		git(root, ["init", "-q"]);
		git(root, ["config", "user.email", "t@t"]);
		git(root, ["config", "user.name", "t"]);
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, "docs", "evidence", "assurance-kernel"), { recursive: true });
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

	async function runHandler(root: string, ui: FakeUI): Promise<void> {
		const factory = await loadExtension();
		const registered: Array<{ handler: (args: string, ctx: unknown) => Promise<void> }> = [];
		factory({ registerCommand: (_n: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => registered.push(spec) } as never);
		await registered[0].handler(TASK, makeCtx(root, ui, "tui"));
	}

	test("declined confirmation cancels enrollment with zero writes", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(false);
			await runHandler(root, ui);
			expect(ui.confirmCalls.length).toBe(1);
			expect(ui.notifyCalls.some((n) => /Enrollment cancelled/i.test(n.text))).toBe(true);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("AbortSignal abort rejects before any write", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const before = authoritySnapshot(root);
			const ui = makeFakeUI(true);
			ui.signal = AbortSignal.abort();
			await expect(runHandler(root, ui)).rejects.toThrow(/abort/i);
			expect(ui.confirmCalls.length).toBe(1);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("one-shot: second identical invocation after enrollment cannot enroll again", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b1-enroll-"));
		try {
			makeEligibleRepo(root, TASK);
			const first = makeFakeUI(true);
			await runHandler(root, first);
			expect(first.notifyCalls.some((n) => /canary enrolled/i.test(n.text))).toBe(true);
			expect(readdirSync(join(root, ".imm", "tasks")).sort()).toEqual([".backend-claim.json", `${TASK}.json`]);
			const second = makeFakeUI(true);
			await runHandler(root, second);
			expect(second.notifyCalls.some((n) => /rehearsal failed.*already exists/i.test(n.text))).toBe(true);
			expect(readdirSync(join(root, ".imm", "tasks")).sort()).toEqual([".backend-claim.json", `${TASK}.json`]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

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
			await runHandler(root, ui);
			expect(ui.confirmCalls.length).toBe(1);
			expect(ui.notifyCalls.some((n) => /workspace changed after confirmation/i.test(n.text))).toBe(true);
			expect(authoritySnapshot(root)).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
