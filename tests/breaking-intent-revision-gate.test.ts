// Gate for 2026-08-19-009-wire-breaking-intent-revision.
// Proves the imm_kernel_canary schema accepts approve_breaking_intent_revision
// and dispatches it through the existing capability-bound mintCapability +
// TUI confirmation route, and that approval clears replan_required and resumes
// the task under its existing enrollment (no successor intent, no second
// enrollment).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";

const TASK = "canary-breaking-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "approve breaking intent revision",
	acceptance: [{
		id: "A1",
		assertion: "a1",
		verification: JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v1", runner_id: "bun", runner_version: "1.3.14", argv: ["test"], cwd: ".", timeout_ms: 1_000, max_output_bytes: 1_024 }),
	}],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);

interface RegisteredTool {
	name: string;
	parameters: { type: string; properties?: Record<string, unknown>; anyOf?: unknown[] };
	execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<any>;
}
interface FakeUI {
	confirmCalls: Array<{ title: string; body: string }>;
	notifyCalls: Array<{ text: string; kind: string }>;
}
function makeUI(): FakeUI {
	return { confirmCalls: [], notifyCalls: [] };
}
function makeCtx(root: string, ui: FakeUI, mode = "tui") {
	return {
		mode,
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: (text: string, kind: string) => ui.notifyCalls.push({ text, kind }),
			confirm: async (title: string, body: string) => { ui.confirmCalls.push({ title, body }); return true; },
		},
	};
}

function makeEnrolledRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "breaking-gate-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), JSON.stringify(INTENT, null, 2) + "\n");
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"), "export const task = 'baseline';\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(join(root, ".imm", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2) + "\n");
	const registry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: prep.digest,
		readiness_digest: "sha256:r",
		evidence_digest: "sha256:e",
		waiver_gate: "observation_window_days",
		actor_id: "user",
		confirmation_ref: "c",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "n",
	};
	enrollCanaryTask(root, {
		task_id: TASK,
		intent_path: binding.intent_path,
		intent_revision: 1,
		preparation_digest: binding.preparation_digest,
		readiness_digest: binding.readiness_digest,
		evidence_digest: binding.evidence_digest,
		capability: registry.issue(binding),
		capability_binding: binding,
		now: "2026-08-12T10:00:00.000Z",
	}, registry);
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"), "export const task = 'changed';\n");
	execFileSync("git", ["add", "--", "plugins/immune-brain/.pi-extension/task.ts"], { cwd: root });
	return root;
}

function seedParkedReplanRequired(root: string): string {
	const path = join(root, ".imm", "tasks", `${TASK}.json`);
	const record = JSON.parse(readFileSync(path, "utf8"));
	record.phase = "review";
	const findingId = "rework:review-limit:replan-required";
	record.findings.push({
		id: findingId,
		kind: "replan_required",
		status: "open",
		acceptance_id: null,
		source: "kernel",
		review_round: 3,
		summary: "Review rework limit reached",
	});
	writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
	return findingId;
}

function walkOpKinds(schema: Record<string, unknown>, out: string[]): void {
	if (Array.isArray(schema.anyOf)) for (const item of schema.anyOf as Record<string, unknown>[]) walkOpKinds(item, out);
	const properties = schema.properties as Record<string, unknown> | undefined;
	const op = properties?.op as { const?: string } | undefined;
	if (op?.const) out.push(op.const);
	for (const value of Object.values(properties ?? {})) {
		if (value && typeof value === "object") walkOpKinds(value as Record<string, unknown>, out);
	}
}

function loadSurface(): { tool: RegisteredTool } {
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI) => void;
	let tool: RegisteredTool | undefined;
	const pi = {
		on: () => {},
		registerMessageRenderer: () => {},
		registerTool: (registered: RegisteredTool) => {
			if (registered.name === "imm_kernel_canary") tool = registered;
		},
	} as unknown as ExtensionAPI;
	factory(pi);
	if (!tool) throw new Error("imm_kernel_canary tool not registered");
	return { tool };
}

const breakingIntent = () => ({
	...INTENT,
	revision: 2,
	acceptance: [{ ...INTENT.acceptance[0], assertion: "changed assertion" }],
});

describe("breaking intent revision gate", () => {
	test("acc-operation-exposed: schema accepts the operation and dispatches through the confirmation route", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tool } = loadSurface();
			const schema = tool.parameters as unknown as Record<string, any>;
			const kinds: string[] = [];
			walkOpKinds(schema, kinds);
			expect(kinds).toContain("approve_breaking_intent_revision");
			expect(kinds).not.toContain("request_rework");
			expect(kinds).not.toContain("record_user_approval");

			const ui = makeUI();
			const intentPath = join(root, "docs", "plans", `${TASK}.intent.json`);
			const beforeInode = statSync(intentPath).ino;
			const result = await tool.execute(
				"break-approve",
				{ task_id: TASK, action: { op: "approve_breaking_intent_revision", next_intent: breakingIntent() } },
				undefined,
				undefined,
				makeCtx(root, ui),
			);
			expect(result.details).toMatchObject({
				state: "applied",
				operation: "approve-breaking-intent-revision",
				phase: "working",
			});
			expect(ui.confirmCalls).toHaveLength(1);
			expect(ui.confirmCalls[0].title).toContain("approve-breaking-intent-revision");
			expect(ui.confirmCalls[0].body).toContain("Next Intent: rev 2");
			expect(statSync(intentPath).ino).toBe(beforeInode);
			expect(JSON.parse(readFileSync(intentPath, "utf8"))).toMatchObject({ revision: 2, task_id: TASK });
			const record = JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(record).toMatchObject({ intent_revision: 2 });
			expect(record.intent_ref.content_hash).toBe(
				canonicalIntentHash({
					...INTENT,
					revision: 2,
					acceptance: [{ ...INTENT.acceptance[0], assertion: "changed assertion" }],
				}),
			);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("acc-revision-resumes-execution: approval clears replan_required under the existing enrollment", async () => {
		const root = makeEnrolledRoot();
		try {
			const findingId = seedParkedReplanRequired(root);
			const { tool } = loadSurface();
			const ui = makeUI();
			const result = await tool.execute(
				"break-resume",
				{ task_id: TASK, action: { op: "approve_breaking_intent_revision", next_intent: breakingIntent() } },
				undefined,
				undefined,
				makeCtx(root, ui),
			);
			expect(result.details).toMatchObject({
				state: "applied",
				operation: "approve-breaking-intent-revision",
				phase: "working",
			});
			const record = JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(record.phase).toBe("working");
			expect(record.intent_revision).toBe(2);
			expect(record.findings.find((finding: { id: string }) => finding.id === findingId)?.status).toBe("resolved");
			// Same enrollment: claim remains active on the same task, no successor
			// TaskRecord or second backend claim exists.
			expect(readBackendClaim(root)).toMatchObject({ task_id: TASK, lifecycle_status: "active" });
			expect(existsSync(join(root, ".imm", "tasks", `${TASK}.backend-claim.json`))).toBe(false);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("cancel and non-TUI paths perform zero writes", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tool } = loadSurface();
			const intentPath = join(root, "docs", "plans", `${TASK}.intent.json`);
			const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
			const claimPath = join(root, ".imm", "tasks", ".backend-claim.json");
			const snapshot = () => ({
				intent: readFileSync(intentPath, "utf8"),
				record: readFileSync(recordPath, "utf8"),
				claim: readFileSync(claimPath, "utf8"),
			});
			const before = snapshot();

			const cancelledUi = makeUI();
			const cancelCtx = makeCtx(root, cancelledUi);
			const cancelled = await tool.execute(
				"break-cancel",
				{ task_id: TASK, action: { op: "approve_breaking_intent_revision", next_intent: breakingIntent() } },
				undefined,
				undefined,
				{
					...cancelCtx,
					ui: {
						...cancelCtx.ui,
						confirm: async (title: string, body: string) => {
							cancelledUi.confirmCalls.push({ title, body });
							return false;
						},
					},
				},
			);
			expect(cancelled.details).toMatchObject({ state: "cancelled", operation: "approve-breaking-intent-revision" });
			expect(cancelledUi.confirmCalls).toHaveLength(1);
			expect(snapshot()).toEqual(before);

			const nonTuiUi = makeUI();
			const nonTui = await tool.execute(
				"break-print",
				{ task_id: TASK, action: { op: "approve_breaking_intent_revision", next_intent: breakingIntent() } },
				undefined,
				undefined,
				makeCtx(root, nonTuiUi, "print"),
			);
			expect(String(nonTui.content[0].text)).toMatch(/TUI-only/i);
			expect(nonTuiUi.confirmCalls).toHaveLength(0);
			expect(snapshot()).toEqual(before);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
});