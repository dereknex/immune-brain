// P2B2 U2: literal-user authority. Covers the TUI-only gate, exact operation
// union, confirmation requirement (cancellation/timeout/abort = zero writes),
// and the confirmed begin-drain path with capability-bound application.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildUserDecisionOperation, deriveAuthorizationOperation } from "../plugins/immune-brain/.pi-extension/imm-canary-work.ts";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";

const TASK = "canary-user-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "user authority",
	acceptance: [{ id: "A1", assertion: "a1", verification: "true" }],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));

interface FakeUI {
	notifyCalls: Array<{ text: string; kind: string }>;
	confirmCalls: Array<{ title: string; body: string }>;
}
function makeUI(): FakeUI {
	return { notifyCalls: [], confirmCalls: [] };
}

function makeEnrolledRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "p2b2-user-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "owned.ts"), "baseline\n");
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(
		join(root, ".imm", "workspace.json"),
		JSON.stringify(
			{ contract: "assurance_kernel/workspace/v1", current_working: null },
			null,
			2,
		) + "\n",
	);
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
	enrollCanaryTask(
		root,
		{
			task_id: TASK,
			intent_path: `docs/plans/${TASK}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			readiness_digest: "sha256:r",
			evidence_digest: "sha256:e",
			capability: registry.issue(binding),
			capability_binding: binding,
			now: "2026-08-12T10:00:00.000Z",
		},
		registry,
	);
		writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "owned.ts"), "task snapshot\n");
	execFileSync("git", ["add", "--", "plugins/immune-brain/.pi-extension/owned.ts"], { cwd: root });
	return root;
}

function seedOpenUserDecision(root: string): string {
	const path = join(root, ".imm", "tasks", `${TASK}.json`);
	const record = JSON.parse(readFileSync(path, "utf8"));
	const id = "decision-review-limit";
	record.findings.push({
		id,
		kind: "unresolved_user_decision",
		status: "open",
		acceptance_id: null,
		source: "kernel",
		review_round: 2,
		summary: "Review returned this boundary twice",
	});
	writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
	return id;
}

function seedOpenReplanRequired(root: string): void {
	const path = join(root, ".imm", "tasks", `${TASK}.json`);
	const record = JSON.parse(readFileSync(path, "utf8"));
	record.phase = "review";
	record.findings.push({
		id: "rework:review-limit:replan-required",
		kind: "replan_required",
		status: "open",
		acceptance_id: null,
		source: "kernel",
		review_round: 3,
		summary: "Review rework limit reached",
	});
	writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
}

function loadSurface(dependencies: Record<string, unknown> = {}): {
	tool: {
		execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ content: Array<{ text: string }>; details?: Record<string, unknown> }>;
	};
} {
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI) => void;
	let tool: { execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ content: Array<{ text: string }>; details?: Record<string, unknown> }> } | undefined;
	const pi = {
		on: () => {},
		registerMessageRenderer: () => {},
		registerTool: (registered: { name: string; execute: typeof tool extends infer T ? T : never }) => {
			if (registered.name === "imm_kernel_canary") tool = registered as never;
		},
	} as unknown as ExtensionAPI;
	factory(pi, dependencies);
	if (!tool) throw new Error("foreground Tool not registered");
	return { tool };
}

function parseToolState(result: { content: Array<{ text: string }>; details?: Record<string, unknown> }): Record<string, unknown> {
	if (result.details && typeof result.details.state === "string") return result.details;
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function authorityBytes(root: string): { record: string; claim: string } {
	return {
		record: readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"),
		claim: readFileSync(join(root, ".imm", "tasks", ".backend-claim.json"), "utf8"),
	};
}

function ctxFor(root: string, ui: FakeUI, confirmResult: boolean | (() => Promise<boolean>), mode = "tui") {
	return {
		mode,
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: (text: string, kind: string) => ui.notifyCalls.push({ text, kind }),
			confirm: async (title: string, body: string) => {
				ui.confirmCalls.push({ title, body });
				return typeof confirmResult === "function" ? confirmResult() : confirmResult;
			},
		},
	};
}

describe("pi canary user authority", () => {
	test("user-decision operation is host-built from exactly one open decision", () => {
		const open = {
			id: "decision-1",
			kind: "unresolved_user_decision",
			status: "open",
			summary: "review limit reached",
		};
		expect(buildUserDecisionOperation({ findings: [open] })).toEqual({
			op: "resolve_user_decision",
			finding_id: "decision-1",
			resolution: "resume after literal-user decision: review limit reached",
		});
		expect(() => buildUserDecisionOperation({ findings: [] })).toThrow(/exactly one open user decision/i);
		expect(() => buildUserDecisionOperation({ findings: [open, { ...open, id: "decision-2" }] })).toThrow(
			/exactly one open user decision/i,
		);
	});

	test("deriveAuthorizationOperation prefers pending review then Kernel readiness", () => {
		// The Kernel-facts truth table moved to tests/kernel-assurance-projection.test.ts;
		// the adapter composes only the Pi-session pending-verdict fact with the
		// projection's Kernel readiness.
		expect(deriveAuthorizationOperation({
			hasPendingReviewVerdict: true,
			readiness: { state: "resolve_user_decision", blocked: null },
		})).toEqual({ operation: "record-review-verdict" });
		expect(deriveAuthorizationOperation({
			hasPendingReviewVerdict: true,
			readiness: { state: "record_user_approval", blocked: null },
		})).toEqual({ operation: "record-review-verdict" });
		expect(deriveAuthorizationOperation({
			hasPendingReviewVerdict: false,
			readiness: { state: "resolve_user_decision", blocked: null },
		})).toEqual({ operation: "resolve-user-decision" });
		expect(deriveAuthorizationOperation({
			hasPendingReviewVerdict: false,
			readiness: { state: "record_user_approval", blocked: null },
		})).toEqual({ operation: "record-user-approval" });
		expect(deriveAuthorizationOperation({
			hasPendingReviewVerdict: true,
			readiness: { state: "none", blocked: null },
			hasOpenReplanRequired: true,
		})).toEqual({ operation: "record-review-verdict" });
		expect(deriveAuthorizationOperation({
			hasPendingReviewVerdict: false,
			readiness: { state: "none", blocked: null },
			hasOpenReplanRequired: true,
		})).toEqual({ operation: "stop" });
		expect(deriveAuthorizationOperation({
			hasPendingReviewVerdict: false,
			readiness: { state: "none", blocked: "resolve-user-decision requires exactly one open user decision; found 2" },
		}).blocked).toMatch(/exactly one open user decision/);
		expect(deriveAuthorizationOperation({
			hasPendingReviewVerdict: false,
			readiness: { state: "none", blocked: null },
		}).blocked).toMatch(/no unique host-derived authorization operation/);
	});

	test("request_authorization derives resolve-user-decision and applies through the shared confirm path", async () => {
		const root = makeEnrolledRoot();
		try {
			const findingId = seedOpenUserDecision(root);
			const { tool } = loadSurface();
			const ui = makeUI();
			const result = await tool.execute(
				"req-1",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, true),
			);
			const state = parseToolState(result);
			expect(state).toMatchObject({ state: "applied", operation: "resolve-user-decision" });
			expect(ui.confirmCalls).toHaveLength(1);
			expect(ui.confirmCalls[0].title).toContain("resolve-user-decision");
			expect(ui.confirmCalls[0].body).toContain(`Finding: ${findingId}`);
			const record = JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(record.findings.find((finding: { id: string }) => finding.id === findingId)?.status).toBe("resolved");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("request_authorization cancel, abort, timeout, non-TUI, and missing unique operation write nothing", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tool } = loadSurface();
			const initial = authorityBytes(root);
			const missing = makeUI();
			const missingResult = await tool.execute(
				"req-missing",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, missing, true),
			);
			expect(parseToolState(missingResult).state).toBe("blocked");
			expect(missing.confirmCalls).toHaveLength(0);
			expect(authorityBytes(root)).toEqual(initial);

			const nonTui = makeUI();
			const nonTuiResult = await tool.execute(
				"req-print",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, nonTui, true, "print"),
			);
			expect(String(nonTuiResult.content[0].text)).toMatch(/TUI-only/i);
			expect(nonTui.confirmCalls).toHaveLength(0);
			expect(authorityBytes(root)).toEqual(initial);

			seedOpenUserDecision(root);
			const pending = authorityBytes(root);
			const cancelled = makeUI();
			const cancelledResult = await tool.execute(
				"req-cancel",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, cancelled, false),
			);
			expect(parseToolState(cancelledResult).state).toBe("cancelled");
			expect(cancelled.confirmCalls).toHaveLength(1);
			expect(authorityBytes(root)).toEqual(pending);

			const aborted = makeUI();
			const abortedResult = await tool.execute(
				"req-abort",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, aborted, async () => {
					throw new Error("aborted");
				}),
			);
			expect(parseToolState(abortedResult).state).toBe("cancelled");
			expect(aborted.confirmCalls).toHaveLength(1);
			expect(authorityBytes(root)).toEqual(pending);

			const timedOut = makeUI();
			const timedOutResult = await tool.execute(
				"req-timeout",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, timedOut, async () => {
					throw new Error("confirmation timed out");
				}),
			);
			expect(parseToolState(timedOutResult).state).toBe("cancelled");
			expect(timedOut.confirmCalls).toHaveLength(1);
			expect(authorityBytes(root)).toEqual(pending);
			expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
		// Drives five full authorization paths end to end; the 5s default tips over
		// under whole-suite load even though the flow itself is unchanged.
	}, 30_000);

	test("request_authorization rejects a TaskRecord revision race before confirmation", async () => {
		const root = makeEnrolledRoot();
		try {
			let raced: { record: string; claim: string } | undefined;
			const { tool } = loadSurface({
				authorizationBeforeRecordRead: async () => {
					seedOpenUserDecision(root);
					raced = authorityBytes(root);
				},
			});
			const ui = makeUI();
			const result = await tool.execute(
				"req-race",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, true),
			);
			expect(parseToolState(result)).toMatchObject({
				state: "blocked",
				reason: "TaskRecord changed while deriving authorization operation",
			});
			expect(ui.confirmCalls).toHaveLength(0);
			expect(authorityBytes(root)).toEqual(raced!);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("in-flight request_authorization does not open a second dialog", async () => {
		const root = makeEnrolledRoot();
		let release!: (value: boolean) => void;
		const gate = new Promise<boolean>((resolve) => {
			release = resolve;
		});
		try {
			seedOpenUserDecision(root);
			const baseline = authorityBytes(root);
			const { tool } = loadSurface();
			const ui = makeUI();
			const first = tool.execute(
				"req-open",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, () => gate),
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			const secondUi = makeUI();
			const second = await tool.execute(
				"req-dup",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, secondUi, true),
			);
			expect(parseToolState(second).state).toBe("blocked");
			expect(secondUi.confirmCalls).toHaveLength(0);
			expect(authorityBytes(root)).toEqual(baseline);
			release(false);
			expect(parseToolState(await first).state).toBe("cancelled");
			expect(ui.confirmCalls).toHaveLength(1);
			expect(authorityBytes(root)).toEqual(baseline);
		} finally {
			release?.(false);
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("request_authorization confirms stop for a parked replan task and releases its claim", async () => {
		const root = makeEnrolledRoot();
		try {
			seedOpenReplanRequired(root);
			const { tool } = loadSurface();
			const ui = makeUI();
			const result = await tool.execute(
				"req-stop",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, true),
			);
			expect(parseToolState(result)).toMatchObject({ state: "applied", operation: "stop", phase: "stopped" });
			expect(ui.confirmCalls).toHaveLength(1);
			expect(ui.confirmCalls[0].title).toContain("stop");
			expect(readTaskRecordV2(root, TASK).record?.phase).toBe("stopped");
			expect(readBackendClaim(root)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("cancelling parked replan stop writes nothing", async () => {
		const root = makeEnrolledRoot();
		try {
			seedOpenReplanRequired(root);
			const initial = authorityBytes(root);
			const { tool } = loadSurface();
			const ui = makeUI();
			const result = await tool.execute(
				"req-stop-cancel",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, false),
			);
			expect(parseToolState(result)).toMatchObject({ state: "cancelled", operation: "stop" });
			expect(ui.confirmCalls).toHaveLength(1);
			expect(authorityBytes(root)).toEqual(initial);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("request_authorization with no unique operation stays blocked", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tool } = loadSurface();
			const ui = makeUI();
			const result = await tool.execute(
				"req-stop",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, true),
			);
			expect(parseToolState(result).state).toBe("blocked");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
