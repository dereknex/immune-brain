// Phase 3 foreground Tool and native Review bridge contract.

import { describe, expect, test } from "bun:test";
import { Check } from "typebox/value";
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
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";
import { PLUGIN_VERSION } from "../plugins/immune-brain/runtime/plugin_version";
import { createMcpRuntime } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { captureReviewManifest } from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle";
import { snapshotDigest, type SnapshotDescriptor } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import {
	TASK_RAIL_KEY,
	USER_ATTENTION_EVENT,
	clearTerminalTaskRailOnInput,
	presentTaskRail,
	presentTaskRailResult,
} from "../plugins/immune-brain/.pi-extension/pi-canary-interaction";

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
	scope_hint: [
		"plugins/immune-brain/.pi-extension",
		"docs/specs/canary-ext-task.spec.md",
		"docs/specs/archive/canary-ext-task.spec.md",
	],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));

type Handler = (event: unknown, ctx?: unknown) => unknown;
interface RegisteredTool {
	name: string;
	parameters: { type: string; properties?: Record<string, unknown>; anyOf?: unknown[] };
	prepareArguments?: (args: unknown) => unknown;
	execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<any>;
	renderCall?: (args: unknown, theme: any) => { render: (width: number) => string[] };
	renderResult?: (result: unknown, options: unknown, theme: any) => { render: (width: number) => string[] };
}
interface RegisteredCommand { handler: (args: string, ctx: unknown) => Promise<void> }
interface FakeUI {
	confirmCalls: Array<{ title: string; body: string }>;
	selectCalls: Array<{ title: string; options: string[] }>;
	customCalls: Array<{ body: string; collapsedBody: string; closed: boolean }>;
	inputCalls: Array<{ title: string; placeholder?: string }>;
	notifyCalls: Array<{ text: string; kind: string }>;
	widgetCalls: Array<{
		key: string;
		content: string[] | ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
		options?: { placement?: string };
	}>;
}

function makeUI(): FakeUI {
	return { confirmCalls: [], selectCalls: [], customCalls: [], inputCalls: [], notifyCalls: [], widgetCalls: [] };
}
function makeCtx(root: string, ui: FakeUI, mode = "tui", decision: string | null = "Approve", note = "Address the requested changes", confirmDecision = true) {
	return {
		mode,
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: (text: string, kind: string) => ui.notifyCalls.push({ text, kind }),
			setStatus: () => { throw new Error("Footer must remain untouched"); },
			setWidget: (
				key: string,
				content: string[] | ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined,
				options?: { placement?: string },
			) => {
				ui.widgetCalls.push({ key, content, options });
			},
			custom: async (factory: any) => {
				let selected: string | undefined;
				let closed = false;
				const component = factory(
					{ requestRender: () => undefined },
					{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
					{},
					(result: string | undefined) => { selected = result; closed = true; },
				);
				const collapsedBody = component.render(120).join("\n");
				component.handleInput?.("d");
				const body = component.render(120).join("\n");
				if (decision === null) component.handleInput?.("\u001b");
				else {
					const downCount = decision === "Request rework" ? 1 : decision === "Reject" ? 2 : confirmDecision ? 0 : 1;
					for (let index = 0; index < downCount; index += 1) component.handleInput?.("\u001b[B");
					component.handleInput?.("\r");
				}
				ui.customCalls.push({ body, collapsedBody, closed });
				return selected;
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

function makeEnrolledRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "phase3-ext-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "docs", "specs"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), JSON.stringify(INTENT, null, 2) + "\n");
	writeFileSync(join(root, "docs", "specs", "canary-ext-task.spec.md"), "# Canary extension task\n");
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"), "export const task = 'baseline';\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(join(root, ".imm/state/workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2) + "\n");
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
	enrollCanaryTask(root, {
		task_id: TASK,
		intent_path: binding.intent_path,
		intent_revision: 1,
		preparation_digest: binding.preparation_digest,
		capability: registry.issue(binding),
		capability_binding: binding,
		now: "2026-08-12T10:00:00.000Z",
	}, registry);
	return root;
}

function makeStaleClaimRoot(): string {
	const root = makeEnrolledRoot();
	const claimPath = join(root, ".imm/state/active-claim.json");
	const claimBytes = readFileSync(claimPath, "utf8");
	const registry = createMutationAuthorityRegistry();
	const app = createCanaryApplication(registry);
	const at = "2026-08-12T10:00:01.000Z";
	const diffHash = `sha256:${"a".repeat(64)}`;
	const record = readTaskRecord(root, TASK);
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
	// Terminal audit evidence is tracked; commit it so the layout is ready.
	execFileSync("git", ["add", "--", ".imm/audit/", "docs/plans/archive/"], { cwd: root });
	execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "fixture terminal"], { cwd: root });
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
	const record = readTaskRecord(root, TASK).record;
	const reviewRevision = role === "review" && record?.contract === "assurance_kernel/task_record/v4"
		? (() => {
				const acceptance = record.intent_snapshot.acceptance;
				const manifest = captureReviewManifest(root, {
					taskId: TASK,
					baseHead: record.git_base_head,
					scopeHint: record.intent_snapshot.scope_hint,
					expectedDiffHash: state.diff_hash ?? "sha256:diff",
					intentRevision: state.intent_revision ?? record.intent_snapshot.revision,
					intentContentHash: state.intent_content_hash ?? record.intent_ref.content_hash,
					recordRevision: state.record_revision ?? "record-1",
					workspaceRevision: state.workspace_revision ?? "workspace-1",
					lifecycle: state.lifecycle ?? "active",
					artifactState: state.artifact_state ?? "frozen",
					risk: record.intent_snapshot.risk,
					outcomes: Object.fromEntries(acceptance.map((item: { id: string }) => [
						item.id,
						{ status: "passed" as const, summary: `host-attested QA: all ${acceptance.length} fixed verification descriptor(s) passed` },
					])),
				});
				return {
					contract: "assurance_kernel/review_revision_identity/v1" as const,
					base_head: manifest.base_head,
					review_commit: manifest.review_commit,
					review_tree: manifest.review_tree,
					manifest_digest: manifest.manifest_digest,
				};
			})()
		: undefined;
	return {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: TASK,
		role,
		record_revision: state.record_revision ?? "record-1",
		workspace_revision: state.workspace_revision ?? "workspace-1",
		intent_revision: state.intent_revision ?? 1,
		intent_content_hash: state.intent_content_hash ?? "sha256:intent",
		diff_hash: state.diff_hash ?? "sha256:diff",
		lifecycle: state.lifecycle ?? "active",
		artifact_state: state.artifact_state ?? "frozen",
		risk: "routine",
		fresh_acceptance_ids: ["A1"],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		acceptance: [{ id: "A1", assertion: "a1", verification: "{}" }],
		dirty_files: ["plugins/immune-brain/.pi-extension/task.ts"],
		review_bundle_digest: role === "review" ? "sha256:bundle" : null,
		...(reviewRevision ? { review_revision: reviewRevision } : {}),
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

async function capturedToolFailure(promise: Promise<unknown>): Promise<Record<string, unknown>> {
	try {
		await promise;
		throw new Error("expected Tool failure");
	} catch (error) {
		const parsed = JSON.parse(error instanceof Error ? error.message : String(error));
		expect(parsed.contract).toBe("immune_brain/tool_failure/v1");
		return parsed;
	}
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
			const firstResult = await first.tools[0].execute("first", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, makeCtx(root, makeUI()));
			expect(JSON.parse(firstResult.content[0].text).state).toBe("review_ready");
			expect(qaRuns).toBe(1);

			for (const handler of first.events.session_shutdown ?? []) await handler({});

			const freshParent = loadSurface(dependencies);
			const resumed = await freshParent.tools[0].execute("resume", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, makeCtx(root, makeUI()));
			expect(JSON.parse(resumed.content[0].text).state).toBe("review_ready");
			expect(qaRuns).toBe(1);
			const record = JSON.parse(readFileSync(join(root, `.imm/state/tasks/${TASK}.json`), "utf8"));
			expect(record.attestations.filter((attestation: { kind: string }) => attestation.kind === "qa")).toHaveLength(1);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	describe("foreground canary assurance extension", () => {
	test("registers assurance and Loop routing Tools plus the read-only /imm-tasks command", () => {
		const { tools, commands } = loadSurface();
		expect(tools.map((tool) => tool.name)).toEqual(["imm_kernel_canary", "imm_loop_action"]);
		expect(Object.keys(commands)).toEqual(["imm-tasks"]);
	});

	test("Pi status reports the shared plugin version", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tools } = loadSurface();
			const result = await tools[0].execute(
				"status",
				{ task_id: TASK, action: { op: "status" } },
				undefined,
				undefined,
				makeCtx(root, makeUI()),
			);
			expect(JSON.parse(result.content[0].text).plugin_version).toBe(PLUGIN_VERSION);
			expect(result.details.plugin_version).toBe(PLUGIN_VERSION);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("compact-task-rail-hierarchy: renders compact Tool rows and keeps one bounded Task Rail lifecycle", async () => {
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
					lifecycle: "done",
					artifact_state: "frozen",
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

		const fakeTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
		const extractWidgetLines = (callContent: unknown, width = 120): string[] | undefined => {
			if (!callContent) return undefined;
			if (Array.isArray(callContent)) return callContent;
			if (typeof callContent === "function") {
				const comp = callContent({}, fakeTheme);
				return comp?.render ? comp.render(width) : undefined;
			}
			return undefined;
		};

		const ui = makeUI();
		const ctx = makeCtx(process.cwd(), ui);
		const secondUi = makeUI();
		const secondCtx = makeCtx(process.cwd(), secondUi);
		presentTaskRail(ctx, { task_id: "task-rail", state: "Completed", result: "Acceptance complete", next: "No action required" });
		presentTaskRail(secondCtx, { task_id: "task-rail-2", state: "Stopped", result: "Task stopped", next: "No action required" });
		expect(ui.widgetCalls.at(-1)).toMatchObject({ key: TASK_RAIL_KEY, options: { placement: "aboveEditor" } });
		expect(extractWidgetLines(ui.widgetCalls.at(-1)?.content)?.join("\n")).toContain("Task task-rail · ✓ Completed");
		const longUi = makeUI();
		const longTaskId = `task-${"x".repeat(80)}-tail`;
		presentTaskRail(makeCtx(process.cwd(), longUi), { task_id: longTaskId, state: "Working", result: "One result", next: "One action" });
		const longRail = extractWidgetLines(longUi.widgetCalls.at(-1)?.content) ?? [];
		expect(longRail).toHaveLength(3);
		expect(longRail[0]).toContain("task-");
		expect(longRail[0]).toContain("-tail · ● Working");
		expect(longRail[0]).not.toContain(longTaskId);
		expect(longRail[1]).toBe("Result: One result");
		expect(longRail[2]).toBe("Next: One action");
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
		for (const changed of [
			"../plugins/immune-brain/.pi-extension/imm-canary-work.ts",
		] as const) {
			const workSource = readFileSync(new URL(changed, import.meta.url), "utf8");
			for (const forbidden of ["setStatus(", "setTimeout(", "setInterval(", "HERDR_", "herdr:blocked", "\\x07"])
				expect(workSource).not.toContain(forbidden);
		}
	});

	test("task-rail-progress: renders optional acceptance-progress and phase rows and stays three rows without them", () => {
		const ui = makeUI();
		const ctx = makeCtx(process.cwd(), ui);
		const fakeTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never;
		presentTaskRail(ctx, {
			task_id: "progress-task",
			state: "Verifying",
			result: "QA running",
			next: "Wait for the foreground Tool result",
			phase: "verifying",
			acceptance_progress: { current: 2, total: 5, acceptance_id: "acc-2", state: "running", elapsed_ms: 340 },
		});
		const widget = ui.widgetCalls.at(-1)?.content;
		expect(typeof widget).toBe("function");
		const lines = (widget as (tui: unknown, theme: unknown) => { render(width: number): string[] })({}, fakeTheme).render(120);
		expect(lines[0]).toContain("Task progress-task · ● Verifying");
		expect(lines[1]).toBe("Phase: verifying");
		expect(lines[2]).toContain("Acceptance: 2/5 ● acc-2 340ms");
		expect(lines[3]).toBe("Result: QA running");
		expect(lines[4]).toBe("Next: Wait for the foreground Tool result");
		expect(lines).toHaveLength(5);

		const passedUi = makeUI();
		presentTaskRail(makeCtx(process.cwd(), passedUi), {
			task_id: "progress-task",
			state: "Verifying",
			result: "QA item done",
			next: "Continue",
			acceptance_progress: { current: 5, total: 5, acceptance_id: "acc-5", state: "passed" },
		});
		const passedLines = ((passedUi.widgetCalls.at(-1)?.content) as (tui: unknown, theme: unknown) => { render(width: number): string[] })({}, fakeTheme).render(120);
		expect(passedLines[1]).toContain("Acceptance: 5/5 ✓ acc-5");

		const bareUi = makeUI();
		presentTaskRail(makeCtx(process.cwd(), bareUi), {
			task_id: "bare-task", state: "Working", result: "No progress", next: "Follow the Obligation",
		});
		const bareLines = ((bareUi.widgetCalls.at(-1)?.content) as (tui: unknown, theme: unknown) => { render(width: number): string[] })({}, fakeTheme).render(120);
		expect(bareLines).toHaveLength(3);
		expect(bareLines[0]).toBe("Task bare-task · ● Working");
		expect(bareLines[1]).toBe("Result: No progress");
		expect(bareLines[2]).toBe("Next: Follow the Obligation");

		const relayedUi = makeUI();
		presentTaskRailResult(makeCtx(process.cwd(), relayedUi), "relay-task", {
			state: "running",
			operation: "qa",
			stage: "verifying",
			current: 1,
			total: 3,
			acceptance_id: "acc-1",
			acceptance_phase: "running",
			elapsed_ms: 12,
			result: "verifying",
			next_action: "wait",
		});
		const relayedLines = ((relayedUi.widgetCalls.at(-1)?.content) as (tui: unknown, theme: unknown) => { render(width: number): string[] })({}, fakeTheme).render(120);
		expect(relayedLines[0]).toContain("relay-task");
		expect(relayedLines[0]).toContain("Verifying");
		expect(relayedLines[1]).toBe("Phase: verifying");
		expect(relayedLines[2]).toContain("Acceptance: 1/3 ● acc-1 12ms");
	});

	test("imm-tasks overlay lists the active task and pending TaskIntent drafts without mutation", async () => {
		const { commands } = loadSurface();
		const command = commands["imm-tasks"];
		expect(command).toBeDefined();
		const ui = makeUI();
		const root = makeEnrolledRoot();
		try {
			// A second, not-enrolled draft sidecar in docs/plans.
			writeFileSync(
				join(root, "docs/plans", "canary-ext-pending.intent.json"),
			JSON.stringify({ ...INTENT, task_id: "canary-ext-pending" }, null, 2) + "\n",
			);
			writeFileSync(join(root, "docs/plans", "malformed.intent.json"), "not json\n");
			writeFileSync(join(root, "docs/plans", "_invalid-name.intent.json"), "{}\n");
			writeFileSync(
				join(root, "docs/plans", "identity-mismatch.intent.json"),
				JSON.stringify({ ...INTENT, task_id: "another-task" }, null, 2) + "\n",
			);
			writeFileSync(
				join(root, "docs/plans", "settled-sidecar.intent.json"),
				JSON.stringify({ ...INTENT, task_id: "settled-sidecar" }, null, 2) + "\n",
			);
			writeFileSync(
				join(root, "docs/plans", "broken-tombstone.intent.json"),
				JSON.stringify({ ...INTENT, task_id: "broken-tombstone" }, null, 2) + "\n",
			);
			mkdirSync(join(root, ".imm/audit/settled-sidecar"), { recursive: true });
			writeFileSync(
				join(root, ".imm/audit/settled-sidecar/terminal-proof.json"),
				JSON.stringify({
					contract: "assurance_kernel/task_tombstone/v2",
					task_id: "settled-sidecar",
					lifecycle_status: "terminal",
					terminal_lifecycle: "done",
					terminal_event_id: "settled-event",
					final_record_hash: `sha256:${"a".repeat(64)}`,
					terminalized_at: "2026-09-04T00:00:00.000Z",
				}, null, 2) + "\n",
			);
			mkdirSync(join(root, ".imm/audit/broken-tombstone"), { recursive: true });
			writeFileSync(join(root, ".imm/audit/broken-tombstone/terminal-proof.json"), "{}\n");
			const ctx = makeCtx(root, ui, "tui", null);
			await command.handler("", ctx);
			expect(ui.customCalls).toHaveLength(1);
			expect(ui.customCalls[0].closed).toBe(true);
			const body = ui.customCalls[0].body;
			expect(body).toContain("Managed Tasks (read-only)");
			expect(body).toContain("Active:");
			expect(body).toContain(TASK);
			expect(body).toContain("Pending enrollment (1):");
			expect(body).toContain("canary-ext-pending");
			expect(body).toContain("Planning");
			expect(body).not.toContain("malformed");
			expect(body).not.toContain("_invalid-name");
			expect(body).not.toContain("identity-mismatch");
			expect(body).not.toContain("another-task");
			expect(body).not.toContain("settled-sidecar");
			expect(body).not.toContain("broken-tombstone");
			// Settled history is excluded (BR-DEC-3): no audit rows appear.
			expect(body).not.toContain("audit");
			// Read-only: the handler mutates no Kernel state; the workspace claim survives.
			const claim = await readBackendClaim(root);
			expect(claim?.task_id).toBe(TASK);
			// Non-TUI hosts get no overlay and no error.
			const rpcUi = makeUI();
			await command.handler("", makeCtx(root, rpcUi, "rpc"));
			expect(rpcUi.customCalls).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
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

	test("prepareArguments recovers only JSON-string non-array object actions and keeps strict schemas", async () => {
		const { tools } = loadSurface();
		const loop = tools.find((candidate) => candidate.name === "imm_loop_action")!;
		const kernel = tools.find((candidate) => candidate.name === "imm_kernel_canary")!;
		for (const tool of [loop, kernel]) {
			expect(tool.prepareArguments).toBeDefined();
			expect(tool.prepareArguments!({ action: { op: "status" } })).toEqual({ action: { op: "status" } });
			expect(tool.prepareArguments!({ action: "not-json", extra: 1 })).toEqual({ action: "not-json", extra: 1 });
			expect(tool.prepareArguments!({ action: "[1,2]" })).toEqual({ action: "[1,2]" });
			expect(tool.prepareArguments!({ action: "null" })).toEqual({ action: "null" });
			expect(tool.prepareArguments!({ action: "42" })).toEqual({ action: "42" });
			expect(tool.prepareArguments!({ action: '"str"' })).toEqual({ action: '"str"' });
			expect(tool.prepareArguments!({})).toEqual({});
			expect(tool.prepareArguments!(null)).toBeNull();
			expect(tool.prepareArguments!("x")).toBe("x");
			expect(tool.prepareArguments!({ action: { op: "status" }, context: "{\"a\":1}" })).toEqual({
				action: { op: "status" },
				context: '{"a":1}',
			});
		}

		const loopArgs = (action: string) => loop.prepareArguments!({ action });
		const kernelArgs = (action: string) => kernel.prepareArguments!({ task_id: "task-1", action });
		const validLoop = loopArgs(JSON.stringify({ op: "route", ownership: "loop", target: "step" }));
		const validKernel = kernelArgs(JSON.stringify({ op: "status" }));
		expect(validLoop).toEqual({ action: { op: "route", ownership: "loop", target: "step" } });
		expect(validKernel).toEqual({ task_id: "task-1", action: { op: "status" } });
		expect(Check(loop.parameters as any, validLoop)).toBe(true);
		expect(Check(kernel.parameters as any, validKernel)).toBe(true);

		for (const action of ["not-json", "[1,2]", "null", "42", '"str"']) {
			expect(Check(loop.parameters as any, loopArgs(action))).toBe(false);
			expect(Check(kernel.parameters as any, kernelArgs(action))).toBe(false);
		}
		expect(Check(loop.parameters as any, loopArgs(JSON.stringify({ op: "unknown" })))).toBe(false);
		expect(Check(kernel.parameters as any, kernelArgs(JSON.stringify({ op: "unknown" })))).toBe(false);
		expect(Check(loop.parameters as any, loopArgs(JSON.stringify({
			op: "route",
			ownership: "loop",
			target: "step",
			context: "nested-string",
		})))).toBe(false);
		expect(Check(kernel.parameters as any, kernelArgs(JSON.stringify({
			op: "record_finding",
			finding: { id: "f-1", kind: "invalid", acceptance_id: null, summary: "bad kind" },
		})))).toBe(false);
	});

	test("keeps the shipped Tool action fix and cleanup Issue contract reference", () => {
		const sourcePath = join(process.cwd(), "plugins", "immune-brain", ".pi-extension", "imm-canary-work.ts");
		const changelogPath = join(process.cwd(), "CHANGELOG.md");
		expect(existsSync(sourcePath)).toBe(true);
		expect(existsSync(changelogPath)).toBe(true);
		const source = readFileSync(sourcePath, "utf8");
		const changelog = readFileSync(changelogPath, "utf8");
		expect(source).toContain("github.com/dereknex/immune-brain/issues/14");
		expect(source).toContain("two consecutive");
		expect(source).toContain("30 days");
		expect(changelog).toContain("Normalize JSON-string Tool action arguments before schema validation");
		expect(changelog).toContain("f0b99a0");
	});

	test("keeps ordinary host input host-native and preserves explicit Skill entry", { timeout: 15000 }, async () => {
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
			expect(mutation).toEqual({ action: "continue" });
			expect(existsSync(join(managed, "AGENTS.md"))).toBe(false);

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
			)).toEqual({ action: "continue" });
		} finally {
			rmSync(managed, { recursive: true, force: true });
			rmSync(readOnly, { recursive: true, force: true });
		}
	});

	test("does not inspect partial bootstrap state for ordinary host input", { timeout: 15000 }, async () => {
		const root = mkdtempSync(join(tmpdir(), "managed-rejected-"));
		try {
			mkdirSync(join(root, ".imm", "memory"), { recursive: true });
			const { events } = loadSurface();
			const ctx = makeCtx(root, makeUI());
			const images = [{ type: "image", data: "fixture", mimeType: "image/png" }];
			const result = await events.input![0](
				{ source: "interactive", text: "Implement the login form", images },
				ctx,
			) as { action: string };
			expect(result).toEqual({ action: "continue" });
			expect(await events.tool_call![0]({ toolName: "bash", input: { command: "true" } })).not.toHaveProperty("block");

			expect(await events.input![0](
				{ source: "interactive", text: "/help", streamingBehavior: "steer" },
				ctx,
			)).toEqual({ action: "continue" });
			expect(await events.tool_call![0]({ toolName: "read", input: { path: "README.md" } })).not.toHaveProperty("block");

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

	test("keeps an active backend claim visible without rewriting user input", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		try {
			const { events } = loadSurface();
			const result = await events.input![0](
				{ source: "interactive", text: "Explain what remains" },
				makeCtx(root, makeUI()),
			);
			expect(result).toEqual({ action: "continue" });
			expect(events.before_agent_start).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("repairs a proven stale claim without user confirmation", { timeout: 15000 }, async () => {
		const root = makeStaleClaimRoot();
		const claimPath = join(root, ".imm/state/active-claim.json");
		const recordPath = join(root, `.imm/audit/${TASK}/task-record.json`);
		const tombstonePath = join(root, `.imm/audit/${TASK}/terminal-proof.json`);
		try {
			const { tools, emitted } = loadSurface();
			const tool = tools.find((candidate) => candidate.name === "imm_kernel_canary")!;
			const recordBefore = readFileSync(recordPath, "utf8");
			const tombstoneBefore = readFileSync(tombstonePath, "utf8");
			const ui = makeUI();
			const repaired = await tool.execute(
				"repair",
				{ task_id: TASK, action: { op: "repair_authority_state" } },
				undefined,
				undefined,
				makeCtx(root, ui),
			);
			expect(repaired.details).toMatchObject({
				state: "recovered_retry",
				operation: "repair_authority_state",
				authority: { state: "terminal_owner", owner_task_id: TASK },
			});
			expect(existsSync(claimPath)).toBe(false);
			expect(readFileSync(recordPath, "utf8")).toBe(recordBefore);
			expect(readFileSync(tombstonePath, "utf8")).toBe(tombstoneBefore);
			expect(ui.customCalls).toHaveLength(0);
			expect(emitted.filter((event) => event.name === USER_ATTENTION_EVENT)).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("Claude MCP repairs a proven stale claim without interactive authority", { timeout: 15000 }, async () => {
		const root = makeStaleClaimRoot();
		const claimPath = join(root, ".imm/state/active-claim.json");
		const recordPath = join(root, `.imm/audit/${TASK}/task-record.json`);
		const tombstonePath = join(root, `.imm/audit/${TASK}/terminal-proof.json`);
		try {
			const recordBefore = readFileSync(recordPath, "utf8");
			const tombstoneBefore = readFileSync(tombstonePath, "utf8");
			const mcp = createMcpRuntime({
				cwd: root,
				env: { CLAUDE_CODE_PERMISSION_MODE: "manual" },
				interactive: false,
			});
			mcp.bindClientHandshake({ version: "2.1.236", interactive: false });
			await expect(mcp.callTool("repair_authority_state", { task_id: TASK })).resolves.toMatchObject({
				state: "terminal_owner",
				owner_task_id: TASK,
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
		expect(kinds).toContain("freeze_artifacts");
		expect(kinds).not.toContain("cancel_assurance");
		const submitReview = schema.properties.action.anyOf.find(
			(item: Record<string, any>) => item.properties?.op?.const === "submit_review",
		);
		expect(Object.keys(submitReview.properties)).toEqual(["op", "verdict"]);
		expect(submitReview.required).toContain("verdict");
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
			scope_hint: [...INTENT.scope_hint, "plugins/immune-brain/.pi-extension/nested"],
			acceptance: [...INTENT.acceptance, { id: "A2", assertion: "a2", verification: INTENT.acceptance[0].verification }],
		};
		const normalizedNextIntent = { ...nextIntent, scope_hint: [...INTENT.scope_hint] };
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
			expect(JSON.parse(readFileSync(join(successRoot, ".imm/state/tasks", `${TASK}.json`), "utf8"))).toMatchObject({
				intent_snapshot: { revision: 2 },
				intent_ref: { content_hash: canonicalIntentHash(parseTaskIntentV1(normalizedNextIntent)) },
			});

			const failurePath = join(failureRoot, "docs", "plans", `${TASK}.intent.json`);
			const priorBytes = readFileSync(failurePath, "utf8");
			const failureInode = statSync(failurePath).ino;
			const incompatible = { ...nextIntent, goal: "breaking goal" };
			const failed = await capturedToolFailure(revise(loadSurface().tools[0], failureRoot, incompatible));
			expect(failed).toMatchObject({
				contract: "immune_brain/tool_failure/v1",
				tool: "imm_kernel_canary",
				operation: "revise_intent",
				state: "failed",
				code: "mutation_failed",
			});
			expect(statSync(failurePath).ino).toBe(failureInode);
			expect(readFileSync(failurePath, "utf8")).toBe(priorBytes);
			expect(JSON.parse(readFileSync(join(failureRoot, ".imm/state/tasks", `${TASK}.json`), "utf8"))).toMatchObject({ intent_snapshot: { revision: 1 } });
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
		const result = await tool.execute("advance", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, (update: unknown) => updates.push(update), makeCtx(root, makeUI()));
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.state).toBe("review_ready");
		expect(parsed.next_action).toBe("invoke the foreground reviewer and submit its verdict");
		expect(parsed.task_state).toMatchObject({ lifecycle: "active", artifact_state: "frozen", record_revision: expect.any(String) });
		expect(parsed.agent_params.run_in_background).toBe(false);
		const progressUpdate = updates.find((item) =>
			(item as { details?: { acceptance_id?: string } }).details?.acceptance_id === "A1"
		) as { details: Record<string, unknown> } | undefined;
		expect(progressUpdate?.details).toMatchObject({
			stage: "verifying",
			current: 1,
			total: 1,
			acceptance_id: "A1",
			acceptance_phase: "passed",
			elapsed_ms: 1,
		});
		const invalid = await capturedToolFailure(tool.execute("submit-invalid", { task_id: TASK, action: { op: "submit_review", verdict: { decision: "pass" } } }, undefined, undefined, makeCtx(root, makeUI())));
		expect(invalid).toMatchObject({ code: "verdict_invalid", next_action: "fix the verdict payload and resubmit submit_review; the Review reservation remains active; do not re-dispatch the reviewer" });
		const repeatedAdvance = await capturedToolFailure(tool.execute("advance-again", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, makeCtx(root, makeUI())));
		expect(repeatedAdvance).toMatchObject({ code: "verdict_invalid", next_action: "fix the verdict payload and resubmit submit_review; the Review reservation remains active; do not re-dispatch the reviewer" });
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
			const result = await capturedToolFailure(tool.execute(
				"advance",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				controller.signal,
				undefined,
				makeCtx(root, makeUI()),
			));
			expect(result.state).toBe("review_preparation_failed");
			const record = JSON.parse(readFileSync(join(root, `.imm/state/tasks/${TASK}.json`), "utf8"));
			expect(record.attestations.some((attestation: { kind: string }) => attestation.kind === "qa")).toBe(true);
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
			const result = await capturedToolFailure(tool.execute(
				"advance",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				controller.signal,
				undefined,
				makeCtx(root, makeUI()),
			));
			expect(result.state).toBe("review_preparation_failed");
			expect(removed).toBe(true);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("Parent-submitted Review verdict material Review auto-completes", { timeout: 15000 }, async () => {
		const root = makeEnrolledRoot();
		try {
			let latestReviewSnapshot!: SnapshotDescriptor;
			const { tools } = loadSurface({
				buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection?: Record<string, any> }) => {
					const built = { snapshot: minimalSnapshot(role, rootPath, current), descriptors: new Map(), reviewBundle: role === "review" ? ({ dirty_files: {}, outcomes: {}, bundle_digest: "sha256:bundle" } as never) : null };
					if (role === "review") latestReviewSnapshot = built.snapshot;
					return built;
				},
				runQa: async (snapshot: SnapshotDescriptor) => ({ contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: TASK, snapshot_digest: snapshotDigest(snapshot), decision: "pass", approval: { kind: "qa", authority_role: "qa", summary: "passed" } }),
				writeReviewEvidence: () => ({ path: join(root, "review.json"), remove: () => {} }),
			});
			const tool = tools[0];
			await tool.execute("advance", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, makeCtx(root, makeUI()));
			const verdict = { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: TASK, snapshot_digest: snapshotDigest(latestReviewSnapshot), decision: "pass", approval: { kind: "review", authority_role: "reviewer", summary: "passed" } };
			const submitted = await tool.execute("submit", { task_id: TASK, action: { op: "submit_review", verdict } }, undefined, undefined, makeCtx(root, makeUI()));
			expect(JSON.parse(submitted.content[0].text)).toMatchObject({
				state: "completed",
				next_action: "none",
				task_state: { lifecycle: "done", artifact_state: "frozen" },
			});
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
			const pending = tool.execute("cancel", { task_id: TASK, action: { op: "advance_assurance" } }, controller.signal, undefined, makeCtx(root, makeUI()));
			controller.abort();
			release();
			expect(JSON.parse((await pending).content[0].text).state).toBe("cancelled");
			expect(applyCount).toBe(0);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
});
