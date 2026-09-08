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
import { readTaskRecord, readAuditTaskPair } from "../plugins/immune-brain/runtime/kernel/storage";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";

const TASK = "canary-user-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "user authority",
	acceptance: [{ id: "A1", assertion: "a1", verification: "true" }],
	scope_hint: ["plugins/immune-brain/.pi-extension", "docs/specs/stop.spec.md", "docs/specs/archive/stop.spec.md"],
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
	mkdirSync(join(root, "docs", "specs"), { recursive: true });
	writeFileSync(join(root, "docs/specs/stop.spec.md"), "# Stop fixture\n");
	mkdirSync(join(root, ".imm/state"), { recursive: true });
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
		join(root, ".imm/state/workspace.json"),
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
	const path = join(root, ".imm/state/tasks", `${TASK}.json`);
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
	const path = join(root, ".imm/state/tasks", `${TASK}.json`);
	const record = JSON.parse(readFileSync(path, "utf8"));
	record.artifact_state = "active";
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
	shutdown: () => Promise<void>;
	tool: {
		execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ content: Array<{ text: string }>; details?: Record<string, unknown> }>;
	};
} {
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI) => void;
	let tool: { execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ content: Array<{ text: string }>; details?: Record<string, unknown> }> } | undefined;
	const handlers = new Map<string, () => Promise<void>>();
	const pi = {
		on: (event: string, handler: () => Promise<void>) => { handlers.set(event, handler); },
		registerMessageRenderer: () => {},
		registerCommand: () => undefined,
		registerTool: (registered: { name: string; execute: typeof tool extends infer T ? T : never }) => {
			if (registered.name === "imm_kernel_canary") tool = registered as never;
		},
	} as unknown as ExtensionAPI;
	factory(pi, dependencies);
	if (!tool) throw new Error("foreground Tool not registered");
	return { tool, shutdown: async () => { await handlers.get("session_shutdown")?.(); } };
}

function parseToolState(result: { content: Array<{ text: string }>; details?: Record<string, unknown> }): Record<string, unknown> {
	if (result.details && typeof result.details.state === "string") return result.details;
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

async function captureToolFailure(promise: Promise<unknown>): Promise<Record<string, unknown>> {
	return promise.then(
		() => { throw new Error("expected Tool failure"); },
		(error: unknown) => JSON.parse(error instanceof Error ? error.message : String(error)),
	);
}

function authorityBytes(root: string): { record: string; claim: string } {
	return {
		record: readFileSync(join(root, ".imm/state/tasks", `${TASK}.json`), "utf8"),
		claim: readFileSync(join(root, ".imm/state/active-claim.json"), "utf8"),
	};
}

function ctxFor(root: string, ui: FakeUI, confirmResult: boolean | (() => Promise<boolean>), mode = "tui") {
	return {
		mode,
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: (text: string, kind: string) => ui.notifyCalls.push({ text, kind }),
			custom: async (factory: any) => {
				let selected: string | undefined;
				const component = factory(
					{ requestRender: () => undefined },
					{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
					{},
					(result: string | undefined) => { selected = result; },
				);
				component.handleInput?.("d");
				const body = component.render(120).join("\n");
				ui.confirmCalls.push({ title: body, body });
				const approved = typeof confirmResult === "function" ? await confirmResult() : confirmResult;
				if (!approved) component.handleInput?.("\u001b[B");
				component.handleInput?.("\r");
				return selected;
			},
		},
	};
}

describe("pi canary user authority", () => {
	test("request_stop confirms and settles the exact active task", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tool } = loadSurface();
			const ui = makeUI();
			const result = await tool.execute("stop-active", { task_id: TASK, action: { op: "request_stop" } }, undefined, undefined, ctxFor(root, ui, true));
			expect(parseToolState(result)).toMatchObject({ state: "applied", operation: "stop", lifecycle: "stopped" });
			expect(ui.confirmCalls).toHaveLength(1);
			expect(ui.confirmCalls[0].body).toContain("stop");
			expect(readBackendClaim(root)).toBeNull();
			expect(readAuditTaskPair(root, TASK).record?.lifecycle).toBe("stopped");
			expect(readFileSync(join(root, "plugins/immune-brain/.pi-extension/owned.ts"), "utf8")).toBe("task snapshot\n");
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	for (const frozen of [false, true]) {
		test(`request_stop cancellation and confirmation preserve work (frozen=${frozen})`, async () => {
			const root = makeEnrolledRoot();
			try {
				const { tool } = loadSurface();
				if (frozen) await tool.execute("freeze", { task_id: TASK, action: { op: "freeze_artifacts" } }, undefined, undefined, ctxFor(root, makeUI(), true));
				const before = authorityBytes(root);
				const cancelled = await tool.execute("cancel-stop", { task_id: TASK, action: { op: "request_stop" } }, undefined, undefined, ctxFor(root, makeUI(), false));
				expect(parseToolState(cancelled).state).toBe("cancelled");
				expect(authorityBytes(root)).toEqual(before);
				await tool.execute("confirm-stop", { task_id: TASK, action: { op: "request_stop", reason: "forged", actor_id: "forged", capability: {} } }, undefined, undefined, ctxFor(root, makeUI(), true));
				const terminal = readAuditTaskPair(root, TASK);
				expect(terminal.record?.lifecycle).toBe("stopped");
				expect(JSON.stringify(terminal)).not.toContain("forged");
				expect(readBackendClaim(root)).toBeNull();
				const ui = makeUI();
				await captureToolFailure(tool.execute("repeat-stop", { task_id: TASK, action: { op: "request_stop" } }, undefined, undefined, ctxFor(root, ui, true)));
				expect(ui.confirmCalls).toHaveLength(0);
				expect(readAuditTaskPair(root, TASK)).toEqual(terminal);
			} finally { rmSync(root, { recursive: true, force: true }); }
		});
	}

	test("request_stop discards a Tool abort during confirmation", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tool } = loadSurface();
			const before = authorityBytes(root);
			const controller = new AbortController();
			const result = await tool.execute("abort-stop", { task_id: TASK, action: { op: "request_stop" } }, controller.signal, undefined, ctxFor(root, makeUI(), async () => { controller.abort(); return true; }));
			expect(parseToolState(result).state).toBe("cancelled");
			expect(authorityBytes(root)).toEqual(before);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	for (const kind of ["timeout", "session_shutdown"] as const) {
		test(`request_stop ignores a ${kind} confirmation`, async () => {
			const root = makeEnrolledRoot();
			try {
				const { tool, shutdown } = loadSurface();
				const before = authorityBytes(root);
				const context = ctxFor(root, makeUI(), async () => { await shutdown(); return true; });
				if (kind === "timeout") context.ui.custom = async () => undefined;
				const call = tool.execute("interrupted-stop", { task_id: TASK, action: { op: "request_stop" } }, undefined, undefined, context);
				if (kind === "timeout") expect(parseToolState(await call).state).toBe("cancelled");
				else await captureToolFailure(call);
				expect(authorityBytes(root)).toEqual(before);
			} finally { rmSync(root, { recursive: true, force: true }); }
		});
	}

	for (const kind of ["non-tui", "foreign-task", "provider-error", "drift", "concurrent"] as const) {
		test(`request_stop fails closed for ${kind}`, async () => {
			const root = makeEnrolledRoot();
			try {
				const { tool } = loadSurface();
				const before = authorityBytes(root);
				const ui = makeUI();
				const context = ctxFor(root, ui, async () => {
					if (kind === "provider-error") throw new Error("dialog unavailable");
					if (kind === "drift") {
						writeFileSync(join(root, "plugins/immune-brain/.pi-extension/owned.ts"), "concurrent change\n");
						execFileSync("git", ["add", "."], { cwd: root });
					}
					if (kind === "concurrent") {
						const otherUi = makeUI();
						await captureToolFailure(tool.execute("second-stop", { task_id: TASK, action: { op: "request_stop" } }, undefined, undefined, ctxFor(root, otherUi, true)));
						expect(otherUi.confirmCalls).toHaveLength(0);
						return false;
					}
					return true;
				}, kind === "non-tui" ? "rpc" : "tui");
				const call = tool.execute("negative-stop", { task_id: kind === "foreign-task" ? "another-task" : TASK, action: { op: "request_stop" } }, undefined, undefined, context);
				if (kind === "concurrent") expect(parseToolState(await call).state).toBe("cancelled");
				else await captureToolFailure(call);
				expect(authorityBytes(root)).toEqual(before);
				if (kind === "non-tui" || kind === "foreign-task") expect(ui.confirmCalls).toHaveLength(0);
			} finally { rmSync(root, { recursive: true, force: true }); }
		});
	}

	test("request_stop rejects running assurance before opening confirmation", async () => {
		const root = makeEnrolledRoot();
		let release!: () => void;
		let entered!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const ready = new Promise<void>((resolve) => { entered = resolve; });
		const { tool } = loadSurface({ advanceBeforeProjection: async () => { entered(); await gate; } });
		const controller = new AbortController();
		const running = tool.execute("qa", { task_id: TASK, action: { op: "advance_assurance" } }, controller.signal, undefined, ctxFor(root, makeUI(), true)).catch(() => undefined);
		try {
			await ready;
			const before = authorityBytes(root);
			const ui = makeUI();
			const failure = await captureToolFailure(tool.execute("stop", { task_id: TASK, action: { op: "request_stop" } }, undefined, undefined, ctxFor(root, ui, true)));
			expect(failure.message).toMatch(/already running/i);
			expect(ui.confirmCalls).toHaveLength(0);
			expect(authorityBytes(root)).toEqual(before);
		} finally {
			controller.abort();
			release();
			await running;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("stop confirmation rejects concurrent assurance before preparation", async () => {
		const root = makeEnrolledRoot();
		let preparations = 0;
		const { tool } = loadSurface({ advanceBeforeProjection: async () => { preparations++; } });
		try {
			const before = authorityBytes(root);
			const result = await tool.execute("stop", { task_id: TASK, action: { op: "request_stop" } }, undefined, undefined, ctxFor(root, makeUI(), async () => {
				await captureToolFailure(tool.execute("qa", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, ctxFor(root, makeUI(), true)));
				expect(preparations).toBe(0);
				return false;
			}));
			expect(parseToolState(result).state).toBe("cancelled");
			expect(authorityBytes(root)).toEqual(before);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

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

	test("deriveAuthorizationOperation follows Kernel readiness", () => {
		expect(deriveAuthorizationOperation({
			readiness: { state: "resolve_user_decision", blocked: null },
		})).toEqual({ operation: "resolve-user-decision" });
		expect(deriveAuthorizationOperation({
			readiness: { state: "authorize_rework", blocked: null },
		})).toEqual({ operation: "authorize-rework" });
		expect(deriveAuthorizationOperation({
			readiness: { state: "none", blocked: "resolve-user-decision requires exactly one open user decision; found 2" },
		}).blocked).toMatch(/exactly one open user decision/);
		expect(deriveAuthorizationOperation({
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
			const record = JSON.parse(readFileSync(join(root, ".imm/state/tasks", `${TASK}.json`), "utf8"));
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
			const missingResult = await captureToolFailure(tool.execute(
				"req-missing",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, missing, true),
			));
			expect(missingResult).toMatchObject({
				contract: "immune_brain/tool_failure/v1",
				state: "blocked",
				message: expect.stringMatching(/no unique host-derived authorization operation/i),
			});
			expect(missing.confirmCalls).toHaveLength(0);
			expect(authorityBytes(root)).toEqual(initial);

			const nonTui = makeUI();
			const nonTuiResult = await captureToolFailure(tool.execute(
				"req-print",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, nonTui, true, "print"),
			));
			expect(nonTuiResult).toMatchObject({
				contract: "immune_brain/tool_failure/v1",
				state: "blocked",
				message: expect.stringMatching(/TUI-only/i),
			});
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
			const result = await captureToolFailure(tool.execute(
				"req-race",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, true),
			));
			expect(result).toMatchObject({
				contract: "immune_brain/tool_failure/v1",
				state: "blocked",
				message: "TaskRecord changed while deriving authorization operation",
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
			const second = await captureToolFailure(tool.execute(
				"req-dup",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, secondUi, true),
			));
			expect(second).toMatchObject({
				contract: "immune_brain/tool_failure/v1",
				state: "blocked",
				message: expect.stringMatching(/already has an open invocation/i),
			});
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

	test("request_authorization lets the user continue a task parked for replan", async () => {
		const root = makeEnrolledRoot();
		try {
			seedOpenReplanRequired(root);
			const { tool } = loadSurface();
			const ui = makeUI();
			const result = await tool.execute(
				"req-rework",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, true),
			);
			expect(parseToolState(result)).toMatchObject({ state: "applied", operation: "authorize-rework", lifecycle: "active" });
			expect(ui.confirmCalls).toHaveLength(1);
			expect(ui.confirmCalls[0].title).toContain("authorize-rework");
			const record = readTaskRecord(root, TASK).record;
			expect(record?.findings.find((finding) => finding.kind === "replan_required")?.status).toBe("resolved");
			expect(readAuditTaskPair(root, TASK)).toBeNull();
			expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("cancelling parked replan authorization writes nothing", async () => {
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
			expect(parseToolState(result)).toMatchObject({ state: "cancelled", operation: "authorize-rework" });
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
			const result = await captureToolFailure(tool.execute(
				"req-stop",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctxFor(root, ui, true),
			));
			expect(result).toMatchObject({
				contract: "immune_brain/tool_failure/v1",
				state: "blocked",
				message: expect.stringMatching(/no unique host-derived authorization operation/i),
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
