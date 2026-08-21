// Phase 3 foreground Tool and native Review bridge contract.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";
import { snapshotDigest, type SnapshotDescriptor } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import {
	TASK_RAIL_KEY,
	USER_ATTENTION_EVENT,
	clearTerminalTaskRailOnInput,
	presentTaskRail,
} from "../plugins/immune-brain/.pi-extension/pi-canary-interaction";
import { routeManagedRequest } from "../plugins/immune-brain/runtime/managed_path_router";

const TASK = "canary-ext-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "foreground extension surface",
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
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));

type Handler = (event: unknown, ctx?: unknown) => unknown;
interface RegisteredTool {
	name: string;
	parameters: { type: string; properties?: Record<string, unknown>; anyOf?: unknown[] };
	execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<any>;
	renderCall?: (args: unknown, theme: any) => { render: (width: number) => string[] };
	renderResult?: (result: unknown, options: unknown, theme: any) => { render: (width: number) => string[] };
}
interface RegisteredCommand { handler: (args: string, ctx: unknown) => Promise<void> }
interface FakeUI {
	confirmCalls: Array<{ title: string; body: string }>;
	selectCalls: Array<{ title: string; options: string[] }>;
	inputCalls: Array<{ title: string; placeholder?: string }>;
	notifyCalls: Array<{ text: string; kind: string }>;
	widgetCalls: Array<{ key: string; content: string[] | undefined; options?: { placement?: string } }>;
}

function makeUI(): FakeUI {
	return { confirmCalls: [], selectCalls: [], inputCalls: [], notifyCalls: [], widgetCalls: [] };
}
function makeCtx(root: string, ui: FakeUI, mode = "tui", decision: string | null = "Approve", note = "Address the requested changes", confirmDecision = true) {
	return {
		mode,
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: (text: string, kind: string) => ui.notifyCalls.push({ text, kind }),
			setStatus: () => { throw new Error("Footer must remain untouched"); },
			setWidget: (key: string, content: string[] | undefined, options?: { placement?: string }) => {
				ui.widgetCalls.push({ key, content, options });
			},
			select: async (title: string, options: string[]) => {
				ui.selectCalls.push({ title, options });
				return decision ?? undefined;
			},
			input: async (title: string, placeholder?: string) => {
				ui.inputCalls.push({ title, placeholder });
				return note;
			},
			confirm: async (title: string, body: string) => { ui.confirmCalls.push({ title, body }); return confirmDecision; },
		},
	};
}

function makeEnrolledRoot(managedBootstrap = false): string {
	const root = mkdtempSync(join(tmpdir(), "phase3-ext-"));
	if (managedBootstrap) {
		routeManagedRequest({ root, request: "Implement the managed task" });
	}
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
	return root;
}

function makeStaleClaimRoot(): string {
	const root = makeEnrolledRoot(true);
	const claimPath = join(root, ".imm", "tasks", ".backend-claim.json");
	const claimBytes = readFileSync(claimPath, "utf8");
	const registry = createMutationAuthorityRegistry();
	const app = createCanaryApplication(registry);
	const at = "2026-08-12T10:00:01.000Z";
	const diffHash = `sha256:${"a".repeat(64)}`;
	const record = readTaskRecordV2(root, TASK);
	const actionDigest = createHash("sha256").update(JSON.stringify({
		type: "stop",
		event_id: `stop:${TASK}:${at}`,
		at,
		actor_id: "user",
		reason: "fixture",
	})).digest("hex");
	const capability = createMutationAuthorityCapabilityForTest(registry, {
		authority_kind: "user",
		task_id: TASK,
		action_digest: actionDigest,
		expected_record_hash: record.revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: diffHash,
		actor_id: "user-1",
		confirmation_ref: "stale-fixture-confirmation",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
	});
	app.execute({
		root,
		task_id: TASK,
		operation: { op: "stop", capability, reason: "fixture", actor_id: "user" },
		prior_intent_token: readTaskIntent(root, TASK).token,
		diffProvider: () => diffHash,
		now: at,
	});
	writeFileSync(claimPath, claimBytes);
	return root;
}

function loadSurface(dependencies: Record<string, unknown> = {}) {
	const tools: RegisteredTool[] = [];
	const commands: Record<string, RegisteredCommand> = {};
	const events: Record<string, Handler[]> = {};
	const busEvents: Record<string, Handler[]> = {};
	const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI, dependencies?: Record<string, unknown>) => void;
	const pi = {
		registerTool: (tool: RegisteredTool) => tools.push(tool),
		registerCommand: (name: string, command: RegisteredCommand) => { commands[name] = command; },
		on: (name: string, handler: Handler) => { (events[name] ??= []).push(handler); },
		events: {
			on: (name: string, handler: Handler) => { (busEvents[name] ??= []).push(handler); },
			emit: (name: string, payload: Record<string, unknown>) => {
				emitted.push({ name, payload });
				for (const handler of busEvents[name] ?? []) handler(payload);
			},
		},
		registerMessageRenderer: () => { throw new Error("follow-up renderer must not be registered"); },
		sendMessage: () => { throw new Error("assurance follow-up must not be sent"); },
	} as unknown as ExtensionAPI;
	factory(pi, dependencies);
	return { tools, commands, events, emitted };
}

function minimalSnapshot(role: "qa" | "review", root: string, current?: { projection?: Record<string, any> }): SnapshotDescriptor {
	const state = current?.projection ?? {};
	return {
		contract: "assurance_kernel/assurance_snapshot/v1",
		task_id: TASK,
		role,
		record_revision: state.record_revision ?? "record-1",
		workspace_revision: state.workspace_revision ?? "workspace-1",
		intent_revision: state.intent_revision ?? 1,
		intent_content_hash: state.intent_content_hash ?? "sha256:intent",
		diff_hash: state.diff_hash ?? "sha256:diff",
		phase: state.phase ?? "review",
		risk: "routine",
		fresh_acceptance_ids: ["A1"],
		missing_acceptance_ids: [],
		stale_evidence_ids: [],
		acceptance: [{ id: "A1", assertion: "a1", verification: "{}" }],
		dirty_files: ["plugins/immune-brain/.pi-extension/task.ts"],
		review_bundle_digest: role === "review" ? "sha256:bundle" : null,
		root,
	};
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

async function recordEvidence(tool: RegisteredTool, root: string): Promise<void> {
	const ui = makeUI();
	await tool.execute("evidence", { task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "fresh" } }, undefined, undefined, makeCtx(root, ui));
}

async function preparePendingReview(root: string): Promise<RegisteredTool & { commands: Record<string, RegisteredCommand>; emitted: Array<{ name: string; payload: Record<string, unknown> }> }> {
	let reviewSnapshot!: SnapshotDescriptor;
	const { tools, commands, events, emitted } = loadSurface({
		buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection?: Record<string, any> }) => {
			const snapshot = minimalSnapshot(role, rootPath, current);
			if (role === "review") reviewSnapshot = snapshot;
			return {
				snapshot,
				descriptors: new Map(),
				reviewBundle: role === "review" ? ({ dirty_files: {}, outcomes: {}, bundle_digest: "sha256:bundle" } as never) : null,
			};
		},
		runQa: async (snapshot: SnapshotDescriptor) => ({
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "qa",
			task_id: TASK,
			snapshot_digest: snapshotDigest(snapshot),
			decision: "pass",
			approval: { kind: "qa", authority_role: "qa", summary: "passed" },
		}),
		writeReviewEvidence: () => ({ path: join(root, "review.json"), remove: () => {} }),
	});
	const tool = tools[0];
	await recordEvidence(tool, root);
	const ready = JSON.parse((await tool.execute(
		"advance",
		{ task_id: TASK, action: { op: "advance_assurance" } },
		undefined,
		undefined,
		makeCtx(root, makeUI()),
	)).content[0].text);
	for (const handler of events.tool_call ?? [])
		handler({ toolName: "Agent", toolCallId: "agent-call", input: ready.agent_params });
	const verdict = JSON.stringify({
		contract: "assurance_kernel/assurance_verdict/v2",
		role: "review",
		task_id: TASK,
		snapshot_digest: snapshotDigest(reviewSnapshot),
		decision: "pass",
		approval: { kind: "review", authority_role: "reviewer", summary: "passed" },
	});
	for (const handler of events.tool_result ?? [])
		handler({ toolName: "Agent", toolCallId: "agent-call", input: ready.agent_params, details: { status: "completed", agentId: "agent-1" }, content: [{ type: "text", text: verdict }] });
	for (const handler of events.tool_execution_end ?? [])
		handler({ toolName: "Agent", toolCallId: "agent-call", args: ready.agent_params, isError: false });
	const submitted = await tool.execute(
		"submit",
		{ task_id: TASK, action: { op: "submit_review" } },
		undefined,
		undefined,
		makeCtx(root, makeUI()),
	);
	expect(JSON.parse(submitted.content[0].text)).toMatchObject({ state: "awaiting_user" });
	return Object.assign(tool, { commands, emitted });
}

	test("a fresh Parent resumes Review preparation from the Kernel projection after interruption", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		let qaRuns = 0;
		const dependencies = {
			buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection?: Record<string, any> }) => ({
				snapshot: minimalSnapshot(role, rootPath, current),
				descriptors: new Map(),
				reviewBundle: role === "review" ? ({ dirty_files: {}, outcomes: {}, bundle_digest: "sha256:bundle" } as never) : null,
			}),
			runQa: async (snapshot: SnapshotDescriptor) => {
				qaRuns += 1;
				return { contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: TASK, snapshot_digest: snapshotDigest(snapshot), decision: "pass", approval: { kind: "qa", authority_role: "qa", summary: "passed" } };
			},
			writeReviewEvidence: () => ({ path: join(root, "review.json"), remove: () => {} }),
		};
		try {
			const first = loadSurface(dependencies);
			await recordEvidence(first.tools[0], root);
			const firstResult = await first.tools[0].execute("first", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, makeCtx(root, makeUI()));
			expect(JSON.parse(firstResult.content[0].text).state).toBe("review_ready");
			expect(qaRuns).toBe(1);

			for (const handler of first.events.session_shutdown ?? []) await handler({});

			const freshParent = loadSurface(dependencies);
			const resumed = await freshParent.tools[0].execute("resume", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, makeCtx(root, makeUI()));
			expect(JSON.parse(resumed.content[0].text).state).toBe("review_ready");
			expect(qaRuns).toBe(1);
			const record = JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(record.approvals.filter((approval: { kind: string }) => approval.kind === "qa")).toHaveLength(1);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	describe("foreground canary assurance extension", () => {
	test("registers assurance and Loop routing Tools without commands", () => {
		const { tools, commands } = loadSurface();
		expect(tools.map((tool) => tool.name)).toEqual(["imm_kernel_canary", "imm_loop_action"]);
		expect(Object.keys(commands)).toEqual([]);
	});

	test("renders compact Tool rows and keeps one bounded Task Rail lifecycle", async () => {
		const { tools } = loadSurface();
		const loop = tools.find((tool) => tool.name === "imm_loop_action")!;
		const theme = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		};
		expect(loop.renderCall?.({ action: { op: "route", target: "step" } }, theme).render(120).join("\n"))
			.toContain("imm_loop_action route step");
		const result = await loop.execute(
			"compact",
			{ action: { op: "route", ownership: "plan", target: "step", context: { task_id: "task-1", target_id: "step-1" } } },
			undefined,
			undefined,
			makeCtx(process.cwd(), makeUI()),
		);
		const rendered = loop.renderResult?.(result, {}, theme).render(120).join("\n") ?? "";
		expect(rendered).toContain("State: projected");
		expect(rendered).toContain("Result: Loop selected executor");
		expect(rendered).toContain("Next: Follow executor authority");
		expect(rendered).not.toContain("\"entry\"");

		const kernel = tools.find((tool) => tool.name === "imm_kernel_canary")!;
		const finalCard = kernel.renderResult?.({
			content: [],
			details: {
				state: "applied",
				task_state: {
					phase: "done",
					fresh_acceptance_ids: ["A1", "A2"],
					missing_acceptance_ids: [],
					fresh_approval_kinds: ["qa", "review"],
					blocking_finding_ids: [],
					unresolved_user_decision_ids: [],
					replan_required_ids: [],
					diff_hash: "sha256:1234567890abcdef",
				},
			},
		}, {}, theme).render(120).join("\n") ?? "";
		expect(finalCard).toContain("Acceptance: 2/2 fresh");
		expect(finalCard).toContain("QA / Review: qa, review");
		expect(finalCard).toContain("Residual blockers: 0");
		expect(finalCard).toContain("Repository health: not assessed");
		expect(finalCard).toContain("Git: task diff sha256:12345678");

		const ui = makeUI();
		const ctx = makeCtx(process.cwd(), ui);
		const secondUi = makeUI();
		const secondCtx = makeCtx(process.cwd(), secondUi);
		presentTaskRail(ctx, { task_id: "task-rail", state: "Completed", result: "Acceptance complete", next: "No action required" });
		presentTaskRail(secondCtx, { task_id: "task-rail-2", state: "Stopped", result: "Task stopped", next: "No action required" });
		expect(ui.widgetCalls.at(-1)).toMatchObject({ key: TASK_RAIL_KEY, options: { placement: "aboveEditor" } });
		expect(ui.widgetCalls.at(-1)?.content?.join("\n")).toContain("Task task-rail · Completed");
		clearTerminalTaskRailOnInput(ctx);
		expect(ui.widgetCalls.at(-1)).toEqual({ key: TASK_RAIL_KEY, content: undefined, options: undefined });
		expect(secondUi.widgetCalls).toHaveLength(1);
		clearTerminalTaskRailOnInput(secondCtx);
		expect(secondUi.widgetCalls.at(-1)).toEqual({ key: TASK_RAIL_KEY, content: undefined, options: undefined });

		const failedUi = makeUI();
		const failedCtx = makeCtx(process.cwd(), failedUi);
		failedCtx.ui.setWidget = () => { throw new Error("renderer unavailable"); };
		presentTaskRail(failedCtx, { task_id: "task-rail-failure", state: "Blocked", result: "Renderer failed", next: "Use Tool result" });
		presentTaskRail(failedCtx, { task_id: "task-rail-failure", state: "Blocked", result: "Renderer failed", next: "Use Tool result" });
		expect(failedUi.notifyCalls).toEqual([{ text: "Task Rail is unavailable; Tool results remain authoritative.", kind: "warning" }]);

		const source = readFileSync(
			new URL("../plugins/immune-brain/.pi-extension/pi-canary-interaction.ts", import.meta.url),
			"utf8",
		);
		for (const forbidden of ["setStatus(", "setTimeout(", "setInterval(", "HERDR_", "herdr:blocked", "process.stdout", "\\x07"])
			expect(source).not.toContain(forbidden);
	});

	test("exposes Loop action and role dispatch builders through a read-only Tool", async () => {
		const { tools } = loadSurface();
		const tool = tools.find((candidate) => candidate.name === "imm_loop_action");
		expect(tool).toBeDefined();
		const schema = tool!.parameters as unknown as Record<string, any>;
		const dispatchSchema = schema.properties.action.anyOf.find(
			(item: Record<string, any>) => item.properties?.op?.const === "dispatch_role",
		);
		expect(dispatchSchema.properties.role.anyOf.map((item: Record<string, any>) => item.const)).toEqual([
			"qa",
			"code-review",
			"ui-review",
		]);
		const ctx = makeCtx(process.cwd(), makeUI());
		const action = await tool!.execute(
			"loop-action",
			{
				action: {
					op: "route",
					ownership: "plan",
					target: "step",
					context: { task_id: "task-6", target_id: "step-1" },
				},
			},
			undefined,
			undefined,
			ctx,
		);
		expect(JSON.parse(action.content[0].text)).toMatchObject({
			entry: "imm-loop",
			next: "executor",
			context: { role: "executor", tool_policy: "workspace tools" },
		});
		const dispatch = await tool!.execute(
			"role-dispatch",
			{
				action: {
					op: "dispatch_role",
					role: "qa",
					context: { task_id: "task-7", target_id: "step-1" },
				},
			},
			undefined,
			undefined,
			ctx,
		);
		expect(JSON.parse(dispatch.content[0].text)).toMatchObject({
			packet: { role: "qa", tool_policy: "no tools" },
			call: { run_in_background: false },
		});
	});

	test("automatically routes ordinary host input through the Managed Path", { timeout: 15000 }, async () => {
		const managed = mkdtempSync(join(tmpdir(), "managed-input-"));
		const readOnly = mkdtempSync(join(tmpdir(), "managed-read-"));
		try {
			const { events } = loadSurface();
			const handler = events.input?.[0];
			expect(handler).toBeDefined();
			const images = [{ type: "image", data: "fixture", mimeType: "image/png" }];
			const mutation = await handler!(
				{ source: "interactive", text: "Implement the login form", images },
				makeCtx(managed, makeUI()),
			);
			expect(mutation).toEqual({
				action: "transform",
				text: "/skill:imm-planner Implement the login form",
				images,
			});
			expect(existsSync(join(managed, "AGENTS.md"))).toBe(true);

			const explanation = await handler!(
				{ source: "interactive", text: "Explain the login flow" },
				makeCtx(readOnly, makeUI()),
			);
			expect(explanation).toEqual({ action: "continue" });
			expect(existsSync(join(readOnly, "AGENTS.md"))).toBe(false);
			expect(await handler!(
				{ source: "interactive", text: "/skill:imm-planner explicit" },
				makeCtx(readOnly, makeUI()),
			)).toEqual({ action: "continue" });
			expect(await handler!(
				{ source: "interactive", text: "/implement #8" },
				makeCtx(managed, makeUI()),
			)).toEqual({
				action: "transform",
				text: "/skill:imm-planner /implement #8",
			});
		} finally {
			rmSync(managed, { recursive: true, force: true });
			rmSync(readOnly, { recursive: true, force: true });
		}
	});

	test("fails closed and blocks Tool calls when Managed routing rejects state", { timeout: 15000 }, async () => {
		const root = mkdtempSync(join(tmpdir(), "managed-rejected-"));
		try {
			mkdirSync(join(root, ".imm", "memory"), { recursive: true });
			const { events } = loadSurface();
			const ctx = makeCtx(root, makeUI());
			const images = [{ type: "image", data: "fixture", mimeType: "image/png" }];
			const rejected = await events.input![0](
				{ source: "interactive", text: "Implement the login form", images },
				ctx,
			) as { action: string; text: string; images: unknown[] };
			expect(rejected).toMatchObject({ action: "transform", images });
			expect(rejected.text).toContain("Managed Path routing failed closed");
			expect(await events.tool_call![0]({ toolName: "bash", input: { command: "true" } })).toMatchObject({
				block: true,
				reason: expect.stringContaining("failed closed"),
			});

			expect(await events.input![0](
				{ source: "interactive", text: "/help", streamingBehavior: "steer" },
				ctx,
			)).toEqual({ action: "continue" });
			expect(await events.tool_call![0]({ toolName: "read", input: { path: "README.md" } })).toMatchObject({
				block: true,
				reason: expect.stringContaining("failed closed"),
			});

			await events.agent_settled![0]({});
			expect(await events.tool_call![0]({ toolName: "read", input: { path: "README.md" } })).toBeUndefined();

			await events.input![0](
				{ source: "interactive", text: "Implement the login form" },
				ctx,
			);
			expect(await events.input![0](
				{ source: "interactive", text: "/help" },
				ctx,
			)).toEqual({ action: "continue" });
			expect(await events.tool_call![0]({ toolName: "read", input: { path: "README.md" } })).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("routes an active backend claim to Loop before classifying the request text", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot(true);
		try {
			const { events } = loadSurface();
			const result = await events.input![0](
				{ source: "interactive", text: "Explain what remains" },
				makeCtx(root, makeUI()),
			);
			expect(result).toEqual({
				action: "transform",
				text: "/skill:imm-loop Explain what remains",
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("routes a proven stale claim to incumbent Loop and repairs only after native confirmation", { timeout: 15000 }, async () => {
		const root = makeStaleClaimRoot();
		const claimPath = join(root, ".imm", "tasks", ".backend-claim.json");
		const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
		const tombstonePath = join(root, ".imm", "tasks", `${TASK}.backend-claim.json`);
		try {
			const { tools, events } = loadSurface();
			const routed = await events.input![0](
				{ source: "interactive", text: "Implement the next task" },
				makeCtx(root, makeUI()),
			);
			expect(routed).toEqual({
				action: "transform",
				text: "/skill:imm-loop Implement the next task",
			});

			const tool = tools.find((candidate) => candidate.name === "imm_kernel_canary")!;
			const claimBefore = readFileSync(claimPath, "utf8");
			const recordBefore = readFileSync(recordPath, "utf8");
			const tombstoneBefore = readFileSync(tombstonePath, "utf8");
			const cancelledUi = makeUI();
			const cancelled = await tool.execute(
				"repair-cancel",
				{ task_id: TASK, action: { op: "repair_authority_state" } },
				undefined,
				undefined,
				makeCtx(root, cancelledUi, "tui", "Approve", "note", false),
			);
			expect(cancelled.details.state).toBe("cancelled");
			expect(readFileSync(claimPath, "utf8")).toBe(claimBefore);
			expect(cancelledUi.confirmCalls[0].body).toContain("Projection revision: sha256:");

			const repaired = await tool.execute(
				"repair-confirm",
				{ task_id: TASK, action: { op: "repair_authority_state" } },
				undefined,
				undefined,
				makeCtx(root, makeUI()),
			);
			expect(repaired.details).toMatchObject({
				state: "recovered_retry",
				operation: "repair_authority_state",
				authority: { state: "terminal_owner", owner_task_id: TASK },
			});
			expect(existsSync(claimPath)).toBe(false);
			expect(readFileSync(recordPath, "utf8")).toBe(recordBefore);
			expect(readFileSync(tombstonePath, "utf8")).toBe(tombstoneBefore);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("schema removes command-owned cancellation and agent-supplied authority", () => {
		const { tools } = loadSurface();
		const schema = tools[0].parameters as unknown as Record<string, any>;
		const kinds: string[] = [];
		walkOpKinds(schema, kinds);
		expect(kinds).toContain("advance_assurance");
		expect(kinds).toContain("submit_review");
		expect(kinds).toContain("repair_authority_state");
		expect(kinds).not.toContain("cancel_assurance");
		const requestAuthorization = schema.properties.action.anyOf.find(
			(item: Record<string, any>) => item.properties?.op?.const === "request_authorization",
		);
		expect(Object.keys(requestAuthorization.properties)).toEqual(["op"]);
	});

	test("revise_intent preserves sidecar identity, passes the old token, persists success, and rolls back precommit failure", { timeout: 15000 }, async () => {
		const successRoot = makeEnrolledRoot();
		const failureRoot = makeEnrolledRoot();
		const nextIntent = {
			...INTENT,
			revision: 2,
			scope_hint: ["plugins/immune-brain/.pi-extension/nested", "plugins/immune-brain/.pi-extension"],
			acceptance: [...INTENT.acceptance, { id: "A2", assertion: "a2", verification: INTENT.acceptance[0].verification }],
		};
		const normalizedNextIntent = { ...nextIntent, scope_hint: ["plugins/immune-brain/.pi-extension"] };
		const revise = (tool: RegisteredTool, root: string, intent: unknown) => tool.execute(
			"revise",
			{ task_id: TASK, action: { op: "revise_intent", next_intent: intent } },
			undefined,
			undefined,
			makeCtx(root, makeUI()),
		);
		try {
			const successPath = join(successRoot, "docs", "plans", `${TASK}.intent.json`);
			const successInode = statSync(successPath).ino;
			const success = await revise(loadSurface().tools[0], successRoot, nextIntent);
			expect(success.details).toMatchObject({ state: "recorded", operation: "revise_intent" });
			expect(statSync(successPath).ino).toBe(successInode);
			expect(JSON.parse(readFileSync(successPath, "utf8"))).toEqual(parseTaskIntentV1(normalizedNextIntent));
			expect(JSON.parse(readFileSync(join(successRoot, ".imm", "tasks", `${TASK}.json`), "utf8"))).toMatchObject({
				intent_revision: 2,
				intent_ref: { content_hash: canonicalIntentHash(parseTaskIntentV1(normalizedNextIntent)) },
			});

			const failurePath = join(failureRoot, "docs", "plans", `${TASK}.intent.json`);
			const priorBytes = readFileSync(failurePath, "utf8");
			const failureInode = statSync(failurePath).ino;
			const incompatible = { ...nextIntent, goal: "breaking goal" };
			const failed = await revise(loadSurface().tools[0], failureRoot, incompatible);
			expect(failed.content[0].text).toContain("kernel canary mutation failed");
			expect(statSync(failurePath).ino).toBe(failureInode);
			expect(readFileSync(failurePath, "utf8")).toBe(priorBytes);
			expect(JSON.parse(readFileSync(join(failureRoot, ".imm", "tasks", `${TASK}.json`), "utf8"))).toMatchObject({ intent_revision: 1 });
		} finally {
			rmSync(successRoot, { recursive: true, force: true });
			rmSync(failureRoot, { recursive: true, force: true });
		}
	});

	test("advance emits bounded foreground updates and returns exact Agent params", { timeout: 15000 }, async () => {
	const root = makeEnrolledRoot();
	try {
		const updates: unknown[] = [];
		const { tools } = loadSurface({
			buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection?: Record<string, any> }) => ({
				snapshot: minimalSnapshot(role, rootPath, current),
				descriptors: new Map(),
				reviewBundle: role === "review" ? ({ dirty_files: {}, outcomes: {}, bundle_digest: "sha256:bundle" } as never) : null,
			}),
			runQa: async (snapshot: SnapshotDescriptor, _descriptors: Map<string, unknown>, _runner: unknown, options: { onProgress?: (value: unknown) => void }) => {
				options.onProgress?.({ index: 1, total: 1, acceptance_id: "A1", phase: "passed", elapsed_ms: 1 });
				return { contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: TASK, snapshot_digest: snapshotDigest(snapshot), decision: "pass", approval: { kind: "qa", authority_role: "qa", summary: "passed" } };
			},
			writeReviewEvidence: () => ({ path: join(root, "review.json"), remove: () => {} }),
			applyVerdict: async (_ctx: unknown, input: { hooks?: { onCommit?: () => void } }) => input.hooks?.onCommit?.(),
		});
		const tool = tools[0];
		await recordEvidence(tool, root);
		const result = await tool.execute("advance", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, (update: unknown) => updates.push(update), makeCtx(root, makeUI()));
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.state).toBe("review_ready");
		expect(parsed.next_action).toBe("invoke the reserved foreground Agent");
		expect(parsed.task_state).toMatchObject({ phase: "review", record_revision: expect.any(String) });
		expect(parsed.agent_params.run_in_background).toBe(false);
		expect(updates.some((item) => JSON.stringify(item).includes("verifying"))).toBe(true);
	} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("cancellation after invocation commit cannot abandon the Kernel QA mutation", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		const controller = new AbortController();
		try {
			const { tools } = loadSurface({
				buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection?: Record<string, any> }) => ({
					snapshot: minimalSnapshot(role, rootPath, current),
					descriptors: new Map(),
					reviewBundle: role === "review" ? ({ dirty_files: {}, outcomes: {}, bundle_digest: "sha256:bundle" } as never) : null,
				}),
				runQa: async (snapshot: SnapshotDescriptor) => ({
					contract: "assurance_kernel/assurance_verdict/v2",
					role: "qa",
					task_id: TASK,
					snapshot_digest: snapshotDigest(snapshot),
					decision: "pass",
					approval: { kind: "qa", authority_role: "qa", summary: "passed" },
				}),
				qaOnAuthorityCommit: () => controller.abort(),
			});
			const tool = tools[0];
			await recordEvidence(tool, root);
			const result = await tool.execute(
				"advance",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				controller.signal,
				undefined,
				makeCtx(root, makeUI()),
			);
			expect(JSON.parse(result.content[0].text).state).toBe("settlement_unknown");
			const record = JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(record.approvals.some((approval: { kind: string }) => approval.kind === "qa")).toBe(true);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("cancellation while constructing a Review reservation removes its evidence", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		const controller = new AbortController();
		const evidencePath = join(root, "review-construction.json");
		let removed = false;
		try {
			const { tools } = loadSurface({
				buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection?: Record<string, any> }) => ({
					snapshot: minimalSnapshot(role, rootPath, current),
					descriptors: new Map(),
					reviewBundle: role === "review" ? ({ dirty_files: {}, outcomes: {}, bundle_digest: "sha256:bundle" } as never) : null,
				}),
				runQa: async (snapshot: SnapshotDescriptor) => ({
					contract: "assurance_kernel/assurance_verdict/v2",
					role: "qa",
					task_id: TASK,
					snapshot_digest: snapshotDigest(snapshot),
					decision: "pass",
					approval: { kind: "qa", authority_role: "qa", summary: "passed" },
				}),
				writeReviewEvidence: () => {
					controller.abort();
					return { path: evidencePath, remove: () => { removed = true; } };
				},
			});
			const tool = tools[0];
			await recordEvidence(tool, root);
			const result = await tool.execute(
				"advance",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				controller.signal,
				undefined,
				makeCtx(root, makeUI()),
			);
			expect(JSON.parse(result.content[0].text).state).toBe("settlement_unknown");
			expect(removed).toBe(true);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("foreground Agent events are bridged once, then submit_review awaits authorization", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		try {
			let latestReviewSnapshot!: SnapshotDescriptor;
			const { tools, events } = loadSurface({
				buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection?: Record<string, any> }) => {
					const built = { snapshot: minimalSnapshot(role, rootPath, current), descriptors: new Map(), reviewBundle: role === "review" ? ({ dirty_files: {}, outcomes: {}, bundle_digest: "sha256:bundle" } as never) : null };
					if (role === "review") latestReviewSnapshot = built.snapshot;
					return built;
				},
				runQa: async (snapshot: SnapshotDescriptor) => ({ contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: TASK, snapshot_digest: snapshotDigest(snapshot), decision: "pass", approval: { kind: "qa", authority_role: "qa", summary: "passed" } }),
				writeReviewEvidence: () => ({ path: join(root, "review.json"), remove: () => {} }),
				applyVerdict: async (_ctx: unknown, input: { hooks?: { onCommit?: () => void } }) => input.hooks?.onCommit?.(),
			});
			const tool = tools[0];
			await recordEvidence(tool, root);
			const ready = JSON.parse((await tool.execute("advance", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, makeCtx(root, makeUI()))).content[0].text);
			const params = ready.agent_params;
			for (const handler of events.tool_call ?? []) handler({ toolName: "Agent", toolCallId: "agent-call", input: params });
			const verdict = JSON.stringify({ contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: TASK, snapshot_digest: snapshotDigest(latestReviewSnapshot), decision: "pass", approval: { kind: "review", authority_role: "reviewer", summary: "passed" } });
			for (const handler of events.tool_result ?? []) handler({ toolName: "Agent", toolCallId: "agent-call", input: params, details: { status: "completed", agentId: "agent-1" }, content: [{ type: "text", text: verdict }] });
			for (const handler of events.tool_execution_end ?? []) handler({ toolName: "Agent", toolCallId: "agent-call", args: params, isError: false });
			const submitted = await tool.execute("submit", { task_id: TASK, action: { op: "submit_review" } }, undefined, undefined, makeCtx(root, makeUI()));
			const submittedResult = JSON.parse(submitted.content[0].text);
			expect(submittedResult).toMatchObject({ state: "awaiting_user", next_action: "request_authorization", task_state: { phase: "review" } });

			const ui = makeUI();
			const authorized = await tool.execute(
				"authorize",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				makeCtx(root, ui),
			);
			expect(authorized.details).toMatchObject({ state: "applied", operation: "record-review-verdict" });
			const authorizedResult = JSON.parse(authorized.content[0].text);
			expect(authorizedResult).toMatchObject({ state: "applied", task_state: { phase: "review" } });
			expect(authorizedResult.next_action).toMatch(/complete task|advance assurance/);
			const completed = await tool.execute(
				"complete",
				{ task_id: TASK, action: { op: "complete" } },
				undefined,
				undefined,
				makeCtx(root, makeUI()),
			);
			const completedResult = JSON.parse(completed.content[0].text);
			expect(completedResult).toMatchObject({ phase: "done", next_action: "none", task_state: { phase: "done" } });
			expect(ui.selectCalls).toHaveLength(1);
			expect(ui.selectCalls[0].options).toEqual(["Approve", "Request rework", "Reject"]);
			expect(ui.selectCalls[0].title).toContain(`Task: ${TASK}`);
			expect(ui.selectCalls[0].title).toContain("Review: PASS");
			expect(ui.selectCalls[0].title).toContain("QA: passed");
			expect(ui.selectCalls[0].title).toContain("Scope: 1 scoped changed file(s)");
			expect(ui.selectCalls[0].title).toContain("Evidence: sha256:bundle");
			expect(ui.selectCalls[0].title).toContain("Pending operation: record-review-verdict");
			expect(ui.confirmCalls).toHaveLength(0);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("repeated foreground Tool authorization produces the same Kernel transition", { timeout: 30_000 }, async () => {
		const firstRoot = makeEnrolledRoot();
		const secondRoot = makeEnrolledRoot();
		const semanticRecord = (root: string) => {
			const record = JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"));
			const volatileKeys = new Set(["record_revision", "revision", "recorded_at", "created_at", "updated_at", "timestamp", "at", "issued_at", "expires_at"]);
			const canonicalize = (value: unknown, key = ""): unknown => {
				if (volatileKeys.has(key)) return "<volatile>";
				if (typeof value === "string") {
					return value
						.replace(/sha256:[0-9a-f]+/g, "sha256:<digest>")
						.replace(/approval-(qa|review)-[0-9a-f]+/g, "approval-$1:<id>")
						.replace(/(evidence|record_evidence|submit_review|record_approval):[^:\s]+:[^\s]+/g, "$1:<id>")
						.replace(/pi-confirm-[0-9a-f]+/g, "pi-confirm:<ref>");
				}
				if (Array.isArray(value)) return value.map((item) => canonicalize(item));
				if (value && typeof value === "object") {
					return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => [name, canonicalize(item, name)]));
				}
				return value;
			};
			return canonicalize(record);
		};
		try {
			const first = await preparePendingReview(firstRoot);
			const second = await preparePendingReview(secondRoot);
			await first.execute("first-tool-authorize", { task_id: TASK, action: { op: "request_authorization" } }, undefined, undefined, makeCtx(firstRoot, makeUI()));
			await second.execute("second-tool-authorize", { task_id: TASK, action: { op: "request_authorization" } }, undefined, undefined, makeCtx(secondRoot, makeUI()));
			expect(semanticRecord(firstRoot)).toEqual(semanticRecord(secondRoot));
		} finally {
			rmSync(firstRoot, { recursive: true, force: true });
			rmSync(secondRoot, { recursive: true, force: true });
		}
	});

	test("literal user can return or reject a pending Review", { timeout: 15000 }, async () => {
		const reworkRoot = makeEnrolledRoot();
		try {
			const tool = await preparePendingReview(reworkRoot);
			const ui = makeUI();
			const result = await tool.execute(
				"rework",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				makeCtx(reworkRoot, ui, "tui", "Request rework", "Acceptance A1 needs stronger evidence"),
			);
			expect(result.details).toMatchObject({ state: "applied", operation: "record-review-verdict", decision: "rework", phase: "working" });
			expect(ui.inputCalls).toHaveLength(1);
			const record = JSON.parse(readFileSync(join(reworkRoot, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(record.findings.at(-1)).toMatchObject({ kind: "blocking", source: "review", summary: "Acceptance A1 needs stronger evidence" });
		} finally { rmSync(reworkRoot, { recursive: true, force: true }); }

		const rejectRoot = makeEnrolledRoot();
		try {
			const tool = await preparePendingReview(rejectRoot);
			const result = await tool.execute(
				"reject",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				makeCtx(rejectRoot, makeUI(), "tui", "Reject", "The remaining risk is unacceptable"),
			);
			expect(result.details).toMatchObject({ state: "applied", operation: "record-review-verdict", decision: "reject", phase: "stopped" });
			expect(readBackendClaim(rejectRoot)).toBeNull();
			const record = JSON.parse(readFileSync(join(rejectRoot, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(record.history.at(-1)?.reason).toContain("The remaining risk is unacceptable");
		} finally { rmSync(rejectRoot, { recursive: true, force: true }); }
	});

	test("Reject fails closed on a post-selection diff race and remains retryable", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		try {
			const tool = await preparePendingReview(root);
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui", "Reject", "Reject stale changes");
			ctx.ui.select = async (title: string, options: string[]) => {
				ui.selectCalls.push({ title, options });
				writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"), "export const task = 'raced';\n");
				execFileSync("git", ["add", "plugins/immune-brain/.pi-extension/task.ts"], { cwd: root });
				return "Reject";
			};
			const raced = await tool.execute(
				"reject-race",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctx,
			);
			expect(raced.details.state).toBe("blocked");
			expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
			expect(JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8")).phase).toBe("review");

			writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"), "export const task = 'baseline';\n");
			execFileSync("git", ["add", "plugins/immune-brain/.pi-extension/task.ts"], { cwd: root });
			const resumed = await tool.execute(
				"approve-after-race",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				makeCtx(root, makeUI()),
			);
			expect(resumed.details).toMatchObject({ state: "applied", decision: "approve" });
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("cancelling a Review decision writes nothing and keeps it pending", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		try {
			const tool = await preparePendingReview(root);
			const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
			const claimPath = join(root, ".imm", "tasks", ".backend-claim.json");
			const before = { record: readFileSync(recordPath, "utf8"), claim: readFileSync(claimPath, "utf8") };
			const failedUi = makeUI();
			const failedCtx = makeCtx(root, failedUi);
			failedCtx.ui.select = async () => { throw new Error("renderer unavailable"); };
			const failed = await tool.execute(
				"ui-failure",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				failedCtx,
			);
			expect(failed.details).toMatchObject({ state: "blocked", reason: "Review decision UI failed: renderer unavailable" });
			expect({ record: readFileSync(recordPath, "utf8"), claim: readFileSync(claimPath, "utf8") }).toEqual(before);

			const blankRework = await tool.execute(
				"blank-rework",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				makeCtx(root, makeUI(), "tui", "Request rework", "   "),
			);
			expect(blankRework.details).toMatchObject({ state: "cancelled", operation: "record-review-verdict" });
			expect({ record: readFileSync(recordPath, "utf8"), claim: readFileSync(claimPath, "utf8") }).toEqual(before);

			const cancelled = await tool.execute(
				"cancel",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				makeCtx(root, makeUI(), "tui", null),
			);
			expect(cancelled.details).toMatchObject({ state: "cancelled", operation: "record-review-verdict" });
			expect({ record: readFileSync(recordPath, "utf8"), claim: readFileSync(claimPath, "utf8") }).toEqual(before);

			const resumed = await tool.execute(
				"resume",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				makeCtx(root, makeUI()),
			);
			expect(resumed.details).toMatchObject({ state: "applied", operation: "record-review-verdict" });
			const attention = tool.emitted.filter((event) => event.name === USER_ATTENTION_EVENT);
			expect(attention).toHaveLength(8);
			for (let index = 0; index < attention.length; index += 2) {
				const opened = attention[index].payload;
				const closed = attention[index + 1].payload;
				expect(opened).toMatchObject({ active: true, task_id: TASK, reason: "review_authorization" });
				expect(closed).toEqual({
					active: false,
					attention_id: opened.attention_id,
					task_id: TASK,
					reason: "review_authorization",
				});
				expect(JSON.stringify(opened)).not.toMatch(/digest|findings|scope|prompt/i);
			}
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("host cancellation reaches the foreground QA Tool and performs no QA authority write", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		try {
			let release!: () => void;
			const gate = new Promise<void>((resolve) => { release = resolve; });
			let applyCount = 0;
			const controller = new AbortController();
			const { tools } = loadSurface({
				buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection?: Record<string, any> }) => ({ snapshot: minimalSnapshot(role, rootPath, current), descriptors: new Map(), reviewBundle: role === "review" ? ({ dirty_files: {}, outcomes: {}, bundle_digest: "sha256:bundle" } as never) : null }),
				runQa: async () => { await gate; throw new DOMException("aborted", "AbortError"); },
				writeReviewEvidence: () => ({ path: join(root, "review.json"), remove: () => {} }),
				applyVerdict: async () => { applyCount += 1; },
			});
			const tool = tools[0];
			await recordEvidence(tool, root);
			const pending = tool.execute("cancel", { task_id: TASK, action: { op: "advance_assurance" } }, controller.signal, undefined, makeCtx(root, makeUI()));
			controller.abort();
			release();
			expect(JSON.parse((await pending).content[0].text).state).toBe("cancelled");
			expect(applyCount).toBe(0);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
});
