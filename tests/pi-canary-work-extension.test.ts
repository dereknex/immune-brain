// Phase 3 foreground Tool and native Review bridge contract.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { snapshotDigest, type SnapshotDescriptor } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";

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
const INTENT_HASH = canonicalIntentHash(INTENT);

type Handler = (event: unknown) => unknown;
interface RegisteredTool {
	name: string;
	parameters: { type: string; properties?: Record<string, unknown>; anyOf?: unknown[] };
	execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<any>;
}
interface RegisteredCommand { handler: (args: string, ctx: unknown) => Promise<void> }
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
			setStatus: () => { throw new Error("Footer must remain untouched"); },
			setWidget: () => { throw new Error("assurance Widget must remain untouched"); },
			confirm: async (title: string, body: string) => { ui.confirmCalls.push({ title, body }); return true; },
		},
	};
}

function makeEnrolledRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "phase3-ext-"));
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

function loadSurface(dependencies: Record<string, unknown> = {}) {
	const tools: RegisteredTool[] = [];
	const commands: Record<string, RegisteredCommand> = {};
	const events: Record<string, Handler[]> = {};
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI, dependencies?: Record<string, unknown>) => void;
	const pi = {
		registerTool: (tool: RegisteredTool) => tools.push(tool),
		registerCommand: (name: string, command: RegisteredCommand) => { commands[name] = command; },
		on: (name: string, handler: Handler) => { (events[name] ??= []).push(handler); },
		registerMessageRenderer: () => { throw new Error("follow-up renderer must not be registered"); },
		sendMessage: () => { throw new Error("assurance follow-up must not be sent"); },
	} as unknown as ExtensionAPI;
	factory(pi, dependencies);
	return { tools, commands, events };
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

describe("foreground canary assurance extension", () => {
	test("registers only the ordinary tool and literal-user command", () => {
		const { tools, commands } = loadSurface();
		expect(tools.map((tool) => tool.name)).toEqual(["imm_kernel_canary"]);
		expect(Object.keys(commands).sort()).toEqual(["imm-canary-authorize", "imm-canary-succeed"]);
	});

	test("schema removes command-owned cancellation", () => {
		const { tools } = loadSurface();
		const kinds: string[] = [];
		walkOpKinds(tools[0].parameters as unknown as Record<string, unknown>, kinds);
		expect(kinds).toContain("advance_assurance");
		expect(kinds).toContain("submit_review");
		expect(kinds).not.toContain("cancel_assurance");
	});

	test("advance emits bounded foreground updates and returns exact Agent params", async () => {
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
		expect(parsed.agent_params.run_in_background).toBe(false);
		expect(updates.some((item) => JSON.stringify(item).includes("verifying"))).toBe(true);
	} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("cancellation after invocation commit cannot abandon the Kernel QA mutation", async () => {
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

	test("cancellation while constructing a Review reservation removes its evidence", async () => {
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

	test("foreground Agent events are bridged once, then submit_review awaits authorization", async () => {
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
			expect(JSON.parse(submitted.content[0].text)).toMatchObject({ state: "awaiting_user" });
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("host cancellation reaches the foreground QA Tool and performs no QA authority write", async () => {
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
