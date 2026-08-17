// P2B2 U2: Pi lifecycle extension surface. Covers the exact registered surface
// (one ordinary tool + two TUI commands), the closed tool schema with
// privileged kinds structurally absent, TUI-only mutation gate, claim-gated
// routing, and zero writes on every rejection path.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";

const TASK = "canary-ext-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "extension surface",
	acceptance: [{
		id: "A1",
		assertion: "a1",
		verification: JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v1",
			runner_id: "bun",
			runner_version: "1.3.14",
			argv: ["test"],
			cwd: ".",
			timeout_ms: 1_000,
			max_output_bytes: 1_024,
		}),
	}],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);

interface FakeUI {
	notifyCalls: Array<{ text: string; kind: string }>;
	confirmCalls: Array<{ title: string; body: string }>;
	statusCalls: Array<{ key: string; text: string | undefined }>;
	widgetCalls: Array<{ key: string; value: unknown }>;
}
function makeUI(): FakeUI {
	return { notifyCalls: [], confirmCalls: [], statusCalls: [], widgetCalls: [] };
}
function makeCtx(root: string, ui: FakeUI, mode: string) {
	return {
		mode,
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: (text: string, kind: string) => ui.notifyCalls.push({ text, kind }),
			setStatus: (key: string, text: string | undefined) => ui.statusCalls.push({ key, text }),
			setWidget: (key: string, value: unknown) => ui.widgetCalls.push({ key, value }),
			confirm: async (title: string, body: string) => {
				ui.confirmCalls.push({ title, body });
				return true;
			},
		},
	};
}

interface RegisteredTool {
	name: string;
	parameters: { type: string; properties?: Record<string, unknown>; anyOf?: unknown[] };
	execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
}
interface RegisteredCommand {
	handler: (args: string, ctx: unknown) => Promise<void>;
}

function loadSurface(dependencies: Record<string, unknown> = {}): {
	tools: RegisteredTool[];
	commands: Record<string, RegisteredCommand>;
	events: Record<string, Array<() => unknown>>;
	messages: Array<{ message: any; options: any }>;
	messageRenderers: Record<string, (...args: any[]) => unknown>;
} {
	const tools: RegisteredTool[] = [];
	const commands: Record<string, RegisteredCommand> = {};
	const events: Record<string, Array<() => unknown>> = {};
	const messages: Array<{ message: any; options: any }> = [];
	const messageRenderers: Record<string, (...args: any[]) => unknown> = {};
	// Force a fresh module instance per load.
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI, dependencies?: Record<string, unknown>) => void;
	const pi = {
		registerTool: (t: RegisteredTool) => tools.push(t),
		registerCommand: (name: string, spec: RegisteredCommand) => {
			commands[name] = spec;
		},
		on: (name: string, handler: () => unknown) => {
			(events[name] ??= []).push(handler);
		},
		registerMessageRenderer: (name: string, renderer: (...args: any[]) => unknown) => {
			messageRenderers[name] = renderer;
		},
		sendMessage: (message: unknown, options: unknown) => messages.push({ message, options }),
	} as unknown as ExtensionAPI;
	factory(pi, dependencies);
	return { tools, commands, events, messages, messageRenderers };
}

function emitCompletedAgentResult(
	events: Record<string, Array<() => unknown>>,
	agentId: string,
	toolCallId: string,
	verdict: string,
): void {
	for (const handler of events.tool_execution_end ?? []) {
		(handler as (event: unknown) => void)({
			toolName: "get_subagent_result",
			toolCallId,
			args: { agent_id: agentId },
			isError: false,
			result: {
				content: [{ type: "text", text: `Agent: ${agentId}\nStatus: completed\n\n${verdict}` }],
			},
		});
	}
}

function emitFailedAgentResult(
	events: Record<string, Array<() => unknown>>,
	agentId: string,
	toolCallId: string,
): void {
	for (const handler of events.tool_execution_end ?? []) {
		(handler as (event: unknown) => void)({
			toolName: "get_subagent_result",
			toolCallId,
			args: { agent_id: agentId },
			isError: false,
			result: {
				content: [{ type: "text", text: `Agent: ${agentId}\nStatus: failed\n\nnative agent stopped` }],
			},
		});
	}
}

function makeEnrolledRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "p2b2-ext-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	writeFileSync(
		join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"),
		"export const task = 'baseline';\n",
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
	writeFileSync(
		join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"),
		"export const task = 'staged';\n",
	);
	execFileSync("git", ["add", "plugins/immune-brain/.pi-extension/task.ts"], { cwd: root });
	return root;
}

function walkOpKinds(schema: Record<string, unknown>, out: string[]): void {
	if (schema.anyOf && Array.isArray(schema.anyOf)) {
		for (const item of schema.anyOf as Record<string, unknown>[]) walkOpKinds(item, out);
		return;
	}
	const properties = schema.properties as Record<string, unknown> | undefined;
	const op = properties?.op as { const?: string } | undefined;
	if (op?.const) out.push(op.const);
}

describe("pi canary work extension surface", () => {
	test("registers exactly one tool, two TUI commands, and one assurance renderer", () => {
		const { tools, commands, messageRenderers } = loadSurface();
		expect(tools.map((t) => t.name)).toEqual(["imm_kernel_canary"]);
		expect(Object.keys(commands).sort()).toEqual(["imm-canary-assure", "imm-canary-authorize"]);
		expect(Object.keys(messageRenderers)).toEqual(["imm-assurance-result"]);
		expect(typeof tools[0].renderCall).toBe("function");
		expect(typeof tools[0].renderResult).toBe("function");
	});

	test("tool schema is closed to ordinary operations; privileged kinds absent", () => {
		const { tools } = loadSurface();
		const schema = tools[0].parameters as unknown as Record<string, unknown>;
		const action = schema.properties?.action as Record<string, unknown>;
		const kinds: string[] = [];
		walkOpKinds(action, kinds);
		expect(kinds.sort()).toEqual(
			["advance_assurance", "cancel_assurance", "complete", "record_evidence", "record_finding", "request_authorization", "resolve_finding", "revise_intent", "status", "submit_review"].sort(),
		);
		const actionVariants = ((schema.properties?.action as { anyOf?: Array<{ properties?: Record<string, unknown> }> }).anyOf ?? []);
		const requestAuth = actionVariants.find((item) => (item.properties?.op as { const?: string } | undefined)?.const === "request_authorization");
		expect(requestAuth?.properties && Object.keys(requestAuth.properties)).toEqual(["op"]);
		for (const privileged of [
			"record_approval",
			"record_user_approval",
			"approve_breaking_intent_revision",
			"stop",
			"resolve_user_decision",
			"request_rework",
		]) {
			expect(kinds).not.toContain(privileged);
		}
	});

	test("tool rejects mutation in non-TUI modes with zero writes", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tools } = loadSurface();
			for (const mode of ["rpc", "json", "print"]) {
				const ui = makeUI();
				const result = await tools[0].execute("c1", { task_id: TASK, action: { op: "submit_review" } }, undefined, undefined, makeCtx(root, ui, mode));
				expect(result.content[0].text).toMatch(/TUI-only/i);
			}
			expect(readdirSync(join(root, ".imm", "tasks")).filter((f) => f.endsWith(".json") && f !== ".backend-claim.json" && !f.includes("transaction")).length).toBe(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("tool status works in any mode and mutation requires a matching claim", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tools } = loadSurface();
			const ui = makeUI();
			const status = await tools[0].execute("c1", { task_id: TASK, action: { op: "status" } }, undefined, undefined, makeCtx(root, ui, "print"));
			expect(status.content[0].text).toContain("phase");
			// Mutation for a task without a claim fails closed.
			const other = await tools[0].execute("c2", { task_id: "no-such-task", action: { op: "submit_review" } }, undefined, undefined, makeCtx(root, ui, "tui"));
			expect(other.content[0].text).toMatch(/no active backend claim|unavailable/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("assure and authorize are TUI-only with zero writes otherwise", async () => {
		const root = makeEnrolledRoot();
		try {
			const { commands } = loadSurface();
			for (const mode of ["rpc", "json", "print"]) {
				const ui = makeUI();
				await commands["imm-canary-assure"].handler(`${TASK} review`, makeCtx(root, ui, mode));
				await commands["imm-canary-authorize"].handler(`${TASK} stop`, makeCtx(root, ui, mode));
				expect(ui.notifyCalls.filter((n) => /TUI-only/i.test(n.text)).length).toBe(2);
				expect(ui.confirmCalls.length).toBe(0);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("invalid args are rejected before any state read", async () => {
		const { commands } = loadSurface();
		const root = mkdtempSync(join(tmpdir(), "p2b2-ext-args-"));
		try {
			const ui = makeUI();
			await commands["imm-canary-assure"].handler("bad-args", makeCtx(root, ui, "tui"));
			expect(ui.notifyCalls.some((n) => /usage|invalid task id/i.test(n.text))).toBe(true);
			await commands["imm-canary-authorize"].handler("task-x bogus-op", makeCtx(root, ui, "tui"));
			expect(ui.notifyCalls.some((n) => /unknown operation/i.test(n.text))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("authorize cancellation performs zero writes", async () => {
		const root = makeEnrolledRoot();
		try {
			const { commands } = loadSurface();
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			ctx.ui.confirm = async () => false;
			await commands["imm-canary-authorize"].handler(`${TASK} begin-drain`, ctx);
			expect(ui.notifyCalls.some((n) => /cancelled/i.test(n.text))).toBe(true);
			expect(existsSync(join(root, ".imm", "tasks", ".backend-claim.json"))).toBe(true);
			expect(
				JSON.parse(
					require("node:fs").readFileSync(join(root, ".imm", "tasks", ".backend-claim.json"), "utf8"),
				).lifecycle_status,
			).toBe("active");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("closed authorization invocations do not poison session shutdown", async () => {
		const root = makeEnrolledRoot();
		try {
			const { commands, events } = loadSurface();
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-authorize"].handler(`${TASK} record-review-verdict`, ctx);
			await commands["imm-canary-authorize"].handler(`${TASK} record-review-verdict`, ctx);
			expect(ui.notifyCalls.filter((call) => /no pending native review verdict/i.test(call.text))).toHaveLength(2);
			await Promise.all((events.session_shutdown ?? []).map((handler) => handler()));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("assure snapshot failures remain visible with their concrete cause", async () => {
		const root = makeEnrolledRoot();
		try {
			const { commands } = loadSurface({
				buildAssurance: async () => { throw new Error("snapshot fixture failed"); },
			});
			const ui = makeUI();
			await commands["imm-canary-assure"].handler(`${TASK} review`, makeCtx(root, ui, "tui"));
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((n) => /native review failed to start/i.test(n.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			const failure = ui.notifyCalls.find((n) => /native review failed to start/i.test(n.text));
			expect(failure).toBeDefined();
			expect(failure!.text).not.toContain("task intent is unreadable or a verification string");
			expect(failure!.text.length).toBeGreaterThan("cannot assure: ".length);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("qa command returns while deterministic verification continues in the background", async () => {
		const root = makeEnrolledRoot();
		let releaseQa!: () => void;
		const qaPending = new Promise<void>((resolve) => {
			releaseQa = resolve;
		});
		let qaStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			qaStarted = resolve;
		});
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root,
						task_id: taskId,
						role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [],
						missing_acceptance_ids: [],
						stale_evidence_ids: [],
						acceptance: [],
						dirty_files: [],
						review_bundle_digest: null,
					}),
					descriptors: new Map(),
				}),
				runQa: async (_snapshot: unknown, _descriptors: unknown, _runner: unknown, options: any) => {
					qaStarted();
					options.onProgress({
						index: 1,
						total: 5,
						acceptance_id: "pi-only-package-surface",
						phase: "running",
						elapsed_ms: 0,
					});
					await qaPending;
					throw new Error("fixture done");
				},
			});
			const ui = makeUI();
			const command = commands["imm-canary-assure"].handler(`${TASK} qa`, makeCtx(root, ui, "tui"));
			await started;
			const returned = await Promise.race([
				command.then(() => true),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
			]);
			expect(returned).toBe(true);
			expect(ui.notifyCalls.some((call) => /background/i.test(call.text))).toBe(true);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
			releaseQa();
			await command;
		} finally {
			releaseQa?.();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("qa cancellation aborts the active verification and performs zero writes", async () => {
		const root = makeEnrolledRoot();
		let qaStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			qaStarted = resolve;
		});
		let qaAborted!: () => void;
		const aborted = new Promise<void>((resolve) => {
			qaAborted = resolve;
		});
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: null,
					}),
					descriptors: new Map(),
				}),
				runQa: async (_snapshot: unknown, _descriptors: unknown, _runner: unknown, options: any) =>
					new Promise((_resolve, reject) => {
						qaStarted();
						options.signal.addEventListener("abort", () => {
							qaAborted();
							reject(new Error("fixture aborted"));
						}, { once: true });
					}),
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
			const before = require("node:fs").readFileSync(recordPath, "utf8");
			await commands["imm-canary-assure"].handler(`${TASK} qa`, ctx);
			await started;
			await commands["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
			await aborted;
			await new Promise((resolve) => setTimeout(resolve, 0));
			const after = require("node:fs").readFileSync(recordPath, "utf8");
			expect(after).toBe(before);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
			expect(ui.notifyCalls.some((call) => /QA cancellation requested/i.test(call.text))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("session shutdown aborts QA and discards a late pass verdict", async () => {
		const root = makeEnrolledRoot();
		let qaStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			qaStarted = resolve;
		});
		let qaAborted!: () => void;
		const aborted = new Promise<void>((resolve) => {
			qaAborted = resolve;
		});
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			let snapshot: any;
			const { commands, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: null,
					});
					return { snapshot, descriptors: new Map() };
				},
				runQa: async (_snapshot: unknown, _descriptors: unknown, _runner: unknown, options: any) =>
					new Promise((resolve) => {
						qaStarted();
						options.signal.addEventListener("abort", () => {
							qaAborted();
							resolve({
								contract: "assurance_kernel/assurance_verdict/v2",
								role: "qa",
								task_id: TASK,
								snapshot_digest: mod.snapshotDigest(snapshot),
								decision: "pass",
								approval: { kind: "qa", authority_role: "qa", summary: "late fixture pass" },
							});
						}, { once: true });
					}),
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
			const before = require("node:fs").readFileSync(recordPath, "utf8");
			await commands["imm-canary-assure"].handler(`${TASK} qa`, ctx);
			await started;
			await Promise.all((events.session_shutdown ?? []).map((handler) => handler()));
			await aborted;
			await new Promise((resolve) => setTimeout(resolve, 0));
			const after = require("node:fs").readFileSync(recordPath, "utf8");
			expect(after).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("qa cancellation wins before authority commit with zero writes", async () => {
		const root = makeEnrolledRoot();
		let reachedCommitGate!: () => void;
		const atCommitGate = new Promise<void>((resolve) => {
			reachedCommitGate = resolve;
		});
		let releaseCommitGate!: () => void;
		const commitGate = new Promise<void>((resolve) => {
			releaseCommitGate = resolve;
		});
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			let snapshot: any;
			const { commands } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: null,
					});
					return { snapshot, descriptors: new Map() };
				},
				runQa: async () => ({
					contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: TASK,
					snapshot_digest: mod.snapshotDigest(snapshot), decision: "pass",
					approval: { kind: "qa", authority_role: "qa", summary: "fixture pass" },
				}),
				qaBeforeAuthorityCommit: async () => {
					reachedCommitGate();
					await commitGate;
				},
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
			const before = require("node:fs").readFileSync(recordPath, "utf8");
			await commands["imm-canary-assure"].handler(`${TASK} qa`, ctx);
			await atCommitGate;
			await commands["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
			releaseCommitGate();
			await new Promise((resolve) => setTimeout(resolve, 25));
			const after = require("node:fs").readFileSync(recordPath, "utf8");
			expect(after).toBe(before);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
			expect(ui.notifyCalls.some((call) => /QA cancellation requested/i.test(call.text))).toBe(true);
		} finally {
			releaseCommitGate?.();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("qa cancellation is rejected after authority commit and the approval settles", async () => {
		const root = makeEnrolledRoot();
		let committed!: () => void;
		const commitObserved = new Promise<void>((resolve) => {
			committed = resolve;
		});
		let commandsRef: Record<string, RegisteredCommand>;
		let ctx: ReturnType<typeof makeCtx>;
		let cancelAttempt: Promise<void> | undefined;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			let snapshot: any;
			const surface = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: ["A1"], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: null,
					});
					return { snapshot, descriptors: new Map() };
				},
				runQa: async () => ({
					contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: TASK,
					snapshot_digest: mod.snapshotDigest(snapshot), decision: "pass",
					approval: { kind: "qa", authority_role: "qa", summary: "fixture pass" },
				}),
				qaOnAuthorityCommit: () => {
					cancelAttempt = commandsRef["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
					committed();
				},
			});
			commandsRef = surface.commands;
			const ui = makeUI();
			ctx = makeCtx(root, ui, "tui");
			await surface.tools[0].execute(
				"e1",
				{ task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "fixture" } },
				undefined, undefined, ctx,
			);
			await surface.tools[0].execute("s1", { task_id: TASK, action: { op: "submit_review" } }, undefined, undefined, ctx);
			await commandsRef["imm-canary-assure"].handler(`${TASK} qa`, ctx);
			await commitObserved;
			await cancelAttempt;
			const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
			for (let attempt = 0; attempt < 100; attempt += 1) {
				const record = JSON.parse(require("node:fs").readFileSync(recordPath, "utf8"));
				if (record.approvals.some((approval: any) => approval.kind === "qa")) break;
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			const record = JSON.parse(require("node:fs").readFileSync(recordPath, "utf8"));
			expect(record.approvals.some((approval: any) => approval.kind === "qa")).toBe(true);
			expect(ui.notifyCalls.some((call) => /crossed the authority commit point/i.test(call.text))).toBe(true);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("qa job ceiling releases ownership when authority settlement never returns", async () => {
		const root = makeEnrolledRoot();
		let committed!: () => void;
		const firstCommit = new Promise<void>((resolve) => { committed = resolve; });
		let commitCount = 0;
		let buildCount = 0;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			let snapshot: any;
			const { commands } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					buildCount += 1;
					snapshot = mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: null,
					});
					return { snapshot, descriptors: new Map() };
				},
				runQa: async () => ({
					contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: TASK,
					snapshot_digest: mod.snapshotDigest(snapshot), decision: "pass",
					approval: { kind: "qa", authority_role: "qa", summary: "fixture pass" },
				}),
				qaOnAuthorityCommit: () => {
					commitCount += 1;
					if (commitCount === 1) committed();
				},
				qaAfterAuthorityCommit: async () => {
					if (commitCount === 1) await new Promise<void>(() => {});
				},
				qaJobTimeoutMs: 20,
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} qa`, ctx);
			await firstCommit;
			await new Promise((resolve) => setTimeout(resolve, 40));
			expect(ui.notifyCalls.some((call) => /authority settlement unknown|job ceiling after authority commit/i.test(call.text))).toBe(true);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);

			await commands["imm-canary-assure"].handler(`${TASK} qa`, ctx);
			for (let attempt = 0; attempt < 50 && buildCount < 2; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(buildCount).toBe(2);
			expect(ui.notifyCalls.filter((call) => /already running/i.test(call.text)).length).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("exports independent phase budgets and workload timing profiles", () => {
		const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
		expect(mod.REVIEW_PREPARATION_TIMEOUT_MS).toBe(30_000);
		expect(mod.REVIEW_DISPATCH_TIMEOUT_MS).toBe(120_000);
		expect(mod.REVIEW_TIMING_PROFILES).toEqual({
			quick: { softDeadlineSeconds: 300, stopThresholdSeconds: 900 },
			standard: { softDeadlineSeconds: 600, stopThresholdSeconds: 1800 },
			heavy: { softDeadlineSeconds: 1200, stopThresholdSeconds: 3600 },
		});
	});

	test("accepts a verdict after the scaled soft deadline and before the independent stop threshold", async () => {
		const root = makeEnrolledRoot();
		let snapshot: any;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands, tools, events } = loadSurface({
				reviewSoftDeadlineMs: 300,
				reviewJobTimeoutMs: 600,
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root,
						task_id: taskId,
						role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [],
						missing_acceptance_ids: [],
						stale_evidence_ids: [],
						acceptance: [],
						dirty_files: [],
						review_bundle_digest: "sha256:" + "4".repeat(64),
					});
					return { snapshot, descriptors: new Map(), reviewBundle: { diff_hash: projection.projection.diff_hash } };
				},
				startReview: async () => ({
					agentId: "native-agent",
					result: new Promise((resolve) => setTimeout(() => resolve({
						status: "completed" as const,
						result: JSON.stringify({
							contract: "assurance_kernel/assurance_verdict/v2",
							role: "review",
							task_id: TASK,
							snapshot_digest: mod.snapshotDigest(snapshot),
							decision: "pass",
							approval: { kind: "review", authority_role: "reviewer", summary: "bounded review passed" },
						}),
					}), 360)),
					stop: async () => {},
				}),
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await tools[0].execute(
				"scaled-boundary-evidence",
				{ task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "fixture" } },
				undefined,
				undefined,
				ctx,
			);
			await tools[0].execute(
				"scaled-boundary-submit",
				{ task_id: TASK, action: { op: "submit_review" } },
				undefined,
				undefined,
				ctx,
			);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 360));
			emitCompletedAgentResult(events, "native-agent", "scaled-boundary-result", JSON.stringify({
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: mod.snapshotDigest(snapshot),
				decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "bounded review passed" },
			}));
			for (let attempt = 0; attempt < 100 && !ui.notifyCalls.some((call) => /awaiting literal-user confirmation/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 10));
			expect(ui.notifyCalls.some((call) => /timed out/i.test(call.text))).toBe(false);
			ctx.ui.confirm = async () => false;
			const pending = await tools[0].execute(
				"scaled-boundary-authorization",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctx,
			);
			expect(pending.details).toMatchObject({ state: "cancelled", operation: "record-review-verdict" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review command returns while the Pi-native subagent continues in the background", async () => {
		const root = makeEnrolledRoot();
		let releaseReview!: () => void;
		const reviewPending = new Promise<void>((resolve) => {
			releaseReview = resolve;
		});
		let reviewStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			reviewStarted = resolve;
		});
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root,
						task_id: taskId,
						role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [],
						missing_acceptance_ids: [],
						stale_evidence_ids: [],
						acceptance: [],
						dirty_files: [],
						review_bundle_digest: "sha256:" + "e".repeat(64),
					}),
					descriptors: new Map(),
					reviewBundle: { diff_hash: projection.projection.diff_hash },
				}),
				startReview: async () => {
					reviewStarted();
					return {
						agentId: "native-agent",
						result: reviewPending.then(() => { throw new Error("fixture done"); }),
						stop: async () => {},
					};
				},
			});
			const ui = makeUI();
			const command = commands["imm-canary-assure"].handler(`${TASK} review`, makeCtx(root, ui, "tui"));
			await started;
			const returned = await Promise.race([
				command.then(() => true),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
			]);
			expect(returned).toBe(true);
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /Pi native subagent native-agent/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
			expect(ui.notifyCalls.some((call) => /Pi native subagent native-agent/i.test(call.text))).toBe(true);
			releaseReview();
			await command;
		} finally {
			releaseReview?.();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review preparation obeys its independent phase budget and never reaches native spawn", async () => {
		const root = makeEnrolledRoot();
		let spawnCalls = 0;
		try {
			const { commands } = loadSurface({
			buildAssurance: async () => new Promise(() => {}),
				startReview: async () => {
					spawnCalls += 1;
					throw new Error("native spawn must not be reached");
				},
				reviewPreparationTimeoutMs: 20,
				reviewSpawnTimeoutMs: 1_000,
			});
			const ui = makeUI();
			await commands["imm-canary-assure"].handler(`${TASK} review`, makeCtx(root, ui, "tui"));
			for (
				let attempt = 0;
				attempt < 250 && !ui.notifyCalls.some((call) => /startup timed out/i.test(call.text));
				attempt += 1
			) await new Promise((resolve) => setTimeout(resolve, 5));
			expect(spawnCalls).toBe(0);
			expect(ui.notifyCalls.some((call) => /startup timed out.*within 20ms/i.test(call.text))).toBe(true);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review startup cancellation keeps ownership until pre-spawn work settles", async () => {
		const root = makeEnrolledRoot();
		let releaseSnapshot!: () => void;
		const snapshotGate = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
		let rejectReview!: (reason?: unknown) => void;
		const reviewResult = new Promise<never>((_resolve, reject) => { rejectReview = reject; });
		let spawnCount = 0;
		let stopCount = 0;
		let shutdownHandlers: Array<() => unknown> = [];
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					await snapshotGate;
					return {
						snapshot: mod.buildSnapshot({
							root, task_id: taskId, role,
							record_revision: projection.projection.record_revision,
							workspace_revision: projection.projection.workspace_revision,
							intent_revision: projection.projection.intent_revision,
							intent_content_hash: projection.projection.intent_content_hash,
							diff_hash: projection.projection.diff_hash,
							phase: projection.projection.phase,
							fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
							acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
						}),
						descriptors: new Map(),
						reviewBundle: { diff_hash: projection.projection.diff_hash },
					};
				},
				startReview: async () => {
					spawnCount += 1;
					return {
						agentId: "native-agent",
						result: reviewResult,
						stop: async () => {
							stopCount += 1;
							rejectReview(new Error("fixture stopped"));
						},
					};
				},
			});
			shutdownHandlers = events.session_shutdown ?? [];
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 0));
			await commands["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			expect(spawnCount).toBe(0);
			releaseSnapshot();
			await new Promise((resolve) => setTimeout(resolve, 20));
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && spawnCount === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(spawnCount).toBe(1);
			emitFailedAgentResult(events, "native-agent", "startup-cleanup-result");
			await Promise.all(shutdownHandlers.map((handler) => handler()));
			expect(stopCount).toBe(1);
		} finally {
			releaseSnapshot?.();
			await Promise.all(shutdownHandlers.map((handler) => handler()));
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review startup cancellation remains local when pre-spawn work rejects", async () => {
		const root = makeEnrolledRoot();
		let releaseSnapshot!: () => void;
		const snapshotGate = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
		let markSnapshotStarted!: () => void;
		const snapshotStarted = new Promise<void>((resolve) => { markSnapshotStarted = resolve; });
		let spawnCount = 0;
		try {
			const { commands, messages } = loadSurface({
				buildAssurance: async () => {
					markSnapshotStarted();
					await snapshotGate;
					throw new Error("snapshot preparation settled after cancellation");
				},
				startReview: async () => {
					spawnCount += 1;
					throw new Error("native spawn must not run");
				},
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await snapshotStarted;
			await commands["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
			releaseSnapshot();
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /cancellation settled locally/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(spawnCount).toBe(0);
			expect(messages).toHaveLength(0);
			expect(ui.notifyCalls.some((call) => /cancellation settled locally/i.test(call.text))).toBe(true);
			expect(ui.notifyCalls.some((call) => /failed to start|startup timed out/i.test(call.text))).toBe(false);
		} finally {
			releaseSnapshot?.();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review startup cancellation ignores a late handle local rejection until host terminal receipt", async () => {
		const root = makeEnrolledRoot();
		let resolveSpawn!: (handle: {
			agentId: string;
			result: Promise<never>;
			stop: () => Promise<void>;
		}) => void;
		const spawn = new Promise<{
			agentId: string;
			result: Promise<never>;
			stop: () => Promise<void>;
		}>((resolve) => { resolveSpawn = resolve; });
		let rejectReview!: (error: Error) => void;
		const result = new Promise<never>((_resolve, reject) => { rejectReview = reject; });
		let markSpawnStarted!: () => void;
		const spawnStarted = new Promise<void>((resolve) => { markSpawnStarted = resolve; });
		let removeCount = 0;
		let stopCount = 0;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands, events, messages } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					}),
					descriptors: new Map(),
					reviewBundle: { diff_hash: projection.projection.diff_hash },
				}),
				writeReviewEvidence: () => ({
					path: "/tmp/locked-review-evidence.json",
					remove: () => { removeCount += 1; },
				}),
				startReview: () => {
					markSpawnStarted();
					return spawn;
				},
				reviewSpawnTimeoutMs: 1_000,
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await spawnStarted;
			await commands["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
			resolveSpawn({
				agentId: "late-injected-agent",
				result,
				stop: async () => { stopCount += 1; },
			});
			for (let attempt = 0; attempt < 40 && stopCount === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(stopCount).toBe(1);
			rejectReview(new Error("local late handle rejection"));
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(removeCount).toBe(0);
			expect(messages).toHaveLength(0);
			emitFailedAgentResult(events, "late-injected-agent", "late-injected-result");
			for (let attempt = 0; attempt < 40 && removeCount === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(removeCount).toBe(1);
			expect(messages.filter((entry) => entry.message?.details?.terminal === "cancelled")).toHaveLength(1);
		} finally {
			rejectReview?.(new Error("test cleanup"));
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review cancellation during native spawn retains unknown settlement after spawn rejection", async () => {
		const root = makeEnrolledRoot();
		let rejectSpawn!: (error: Error) => void;
		const spawn = new Promise<never>((_resolve, reject) => { rejectSpawn = reject; });
		let markSpawnStarted!: () => void;
		const spawnStarted = new Promise<void>((resolve) => { markSpawnStarted = resolve; });
		let removeCount = 0;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands, messages } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					}),
					descriptors: new Map(),
					reviewBundle: { diff_hash: projection.projection.diff_hash },
				}),
				writeReviewEvidence: () => ({
					path: "/tmp/locked-review-evidence.json",
					remove: () => { removeCount += 1; },
				}),
				startReview: () => {
					markSpawnStarted();
					return spawn;
				},
				reviewSpawnTimeoutMs: 1_000,
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await spawnStarted;
			await commands["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
			expect(messages).toHaveLength(0);
			rejectSpawn(new Error("native spawn RPC rejected after cancellation"));
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /terminal settlement remains unknown/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(removeCount).toBe(0);
			expect(messages).toHaveLength(0);
			expect(ui.notifyCalls.some((call) => /terminal settlement remains unknown/i.test(call.text))).toBe(true);
			expect(ui.notifyCalls.some((call) => /failed to start|startup timed out/i.test(call.text))).toBe(false);
		} finally {
			rejectSpawn?.(new Error("test cleanup"));
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review spawn timeout keeps ownership while native settlement is unknown", async () => {
		const root = makeEnrolledRoot();
		let removeCount = 0;
		let spawnCount = 0;
		let rejectSpawn!: (error: Error) => void;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					}),
					descriptors: new Map(),
					reviewBundle: { diff_hash: projection.projection.diff_hash },
				}),
				writeReviewEvidence: () => ({
					path: "/tmp/locked-review-evidence.json",
					remove: () => { removeCount += 1; },
				}),
				startReview: async () => {
					spawnCount += 1;
					return new Promise((_resolve, reject) => { rejectSpawn = reject; });
				},
				reviewSpawnTimeoutMs: 1_000,
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 250 && !ui.notifyCalls.some((call) => /dispatch exceeded 1s/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(removeCount).toBe(0);
			rejectSpawn(new Error("dispatch receipt failed after unknown child creation"));
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /terminal settlement remains unknown/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(removeCount).toBe(0);
			expect(ui.notifyCalls.some((call) => /terminal settlement remains unknown/i.test(call.text))).toBe(true);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(spawnCount).toBe(1);
			expect(ui.notifyCalls.some((call) => /dispatch exceeded 1s/i.test(call.text))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review cancellation retains immutable evidence until native terminal settlement", async () => {
		const root = makeEnrolledRoot();
		let rejectReview!: (error: Error) => void;
		const result = new Promise<never>((_resolve, reject) => { rejectReview = reject; });
		let removeCount = 0;
		let stopCount = 0;
		let spawnCount = 0;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { tools, commands, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					}),
					descriptors: new Map(),
					reviewBundle: { diff_hash: projection.projection.diff_hash },
				}),
				writeReviewEvidence: () => ({
					path: "/tmp/locked-review-evidence.json",
					remove: () => { removeCount += 1; },
				}),
				startReview: async () => {
					spawnCount += 1;
					return {
						agentId: "native-agent",
						result,
						stop: async () => { stopCount += 1; },
					};
				},
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /Pi native subagent/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			await commands["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
			expect(stopCount).toBe(1);
			expect(removeCount).toBe(0);
			const advance = await tools[0].execute(
				"advance-during-review-cancellation",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				new AbortController().signal,
				undefined,
				ctx,
			);
			const advanceResult = JSON.parse(advance.content[0].text);
			expect(advanceResult.state).toBe("blocked");
			expect(advanceResult.reason).toMatch(/awaiting terminal cancellation_requested settlement/i);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(spawnCount).toBe(1);
			rejectReview(new Error("local stop promise rejected"));
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(removeCount).toBe(0);
			emitFailedAgentResult(events, "native-agent", "cancel-terminal-result");
			for (let attempt = 0; attempt < 20 && removeCount === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(removeCount).toBe(1);
		} finally {
			rejectReview?.(new Error("test cleanup"));
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("review timeout retains ownership and immutable evidence until native terminal settlement", async () => {
		const root = makeEnrolledRoot();
		let rejectReview!: (error: Error) => void;
		const result = new Promise<never>((_resolve, reject) => { rejectReview = reject; });
		let removeCount = 0;
		let stopCount = 0;
		let spawnCount = 0;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands, messages, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					}),
					descriptors: new Map(),
					reviewBundle: { diff_hash: projection.projection.diff_hash },
				}),
				writeReviewEvidence: () => ({
					path: "/tmp/locked-review-evidence.json",
					remove: () => { removeCount += 1; },
				}),
				startReview: async () => {
					spawnCount += 1;
					return {
						agentId: "native-agent",
						result,
						stop: async () => { stopCount += 1; },
					};
				},
				reviewJobTimeoutMs: 500,
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 150 && stopCount === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(stopCount).toBe(1);
			expect(removeCount).toBe(0);
			const followUpCount = () => messages.filter((entry) => entry.options?.deliverAs === "followUp").length;
			expect(followUpCount()).toBe(0);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
			expect(ui.notifyCalls.some((call) => /stop threshold.*awaiting terminal settlement/i.test(call.text))).toBe(true);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(spawnCount).toBe(1);
			rejectReview(new Error("local stop promise rejected after timeout"));
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(removeCount).toBe(0);
			expect(followUpCount()).toBe(0);
			emitFailedAgentResult(events, "native-agent", "timeout-terminal-result");
			for (let attempt = 0; attempt < 20 && removeCount === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(removeCount).toBe(1);
			expect(followUpCount()).toBe(1);
			expect(messages[0]?.message?.details?.summary).toContain("terminal settlement after its stop threshold");
		} finally {
			rejectReview?.(new Error("test cleanup"));
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("an already-completed valid verdict wins before the queued deadline callback", async () => {
		const root = makeEnrolledRoot();
		let snapshot: any;
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands, tools, messages, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					});
					return { snapshot, descriptors: new Map(), reviewBundle: { diff_hash: projection.projection.diff_hash } };
				},
				startReview: async () => ({
					agentId: "native-agent",
					result: Promise.resolve({
						agentId: "native-agent",
						status: "completed" as const,
						result: JSON.stringify({
							contract: "assurance_kernel/assurance_verdict/v2",
							role: "review",
							task_id: TASK,
							snapshot_digest: mod.snapshotDigest(snapshot),
							decision: "pass",
							approval: { kind: "review", authority_role: "reviewer", summary: "already completed" },
						}),
					}),
					stop: async () => {},
				}),
				reviewJobTimeoutMs: 500,
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await tools[0].execute(
				"completed-before-deadline-evidence",
				{ task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "fixture" } },
				undefined, undefined, ctx,
			);
			await tools[0].execute(
				"completed-before-deadline-submit",
				{ task_id: TASK, action: { op: "submit_review" } },
				undefined, undefined, ctx,
			);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /is reviewing/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			emitCompletedAgentResult(events, "native-agent", "completed-before-deadline-result", JSON.stringify({
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: mod.snapshotDigest(snapshot),
				decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "already completed" },
			}));
			for (let attempt = 0; attempt < 150 && !ui.notifyCalls.some((call) => /request_authorization/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(ui.notifyCalls.some((call) => /timed out/i.test(call.text))).toBe(false);
			expect(messages.filter((entry) => entry.options?.deliverAs === "followUp")).toHaveLength(1);
			ctx.ui.confirm = async () => false;
			const authorization = await tools[0].execute(
				"completed-before-deadline-authorization",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined, undefined, ctx,
			);
			expect(authorization.details).toMatchObject({ state: "cancelled", operation: "record-review-verdict" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("same-tick review completion and timeout produce exactly one winner", async () => {
		const root = makeEnrolledRoot();
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			let snapshot: any;
			let spawnCount = 0;
			const { commands, tools, messages, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					});
					return { snapshot, descriptors: new Map(), reviewBundle: { diff_hash: projection.projection.diff_hash } };
				},
				startReview: async () => {
					spawnCount += 1;
					const result = new Promise((resolve) => setTimeout(() => resolve({
						agentId: "native-agent",
						status: "completed",
						result: JSON.stringify({
							contract: "assurance_kernel/assurance_verdict/v2",
							role: "review",
							task_id: TASK,
							snapshot_digest: mod.snapshotDigest(snapshot),
							decision: "pass",
							approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
						}),
					}), 400));
					return { agentId: "native-agent", result, stop: async () => {} };
				},
				reviewJobTimeoutMs: 500,
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /is reviewing/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			await new Promise((resolve) => setTimeout(resolve, 400));
			emitCompletedAgentResult(events, "native-agent", "same-tick-result", JSON.stringify({
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: mod.snapshotDigest(snapshot),
				decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
			}));
			for (let attempt = 0; attempt < 150 && !ui.notifyCalls.some((call) => /request_authorization|timed out/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(spawnCount).toBe(1);
			const timedOut = ui.notifyCalls.some((call) => /timed out/i.test(call.text));
			expect(messages.filter((entry) => entry.options?.deliverAs === "followUp")).toHaveLength(1);
			expect(messages[0]?.message?.details?.summary).not.toContain("total deadline");
			ctx.ui.confirm = async () => false;
			const authorization = await tools[0].execute(
				"same-tick-authorization",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctx,
			);
			if (timedOut) {
				expect(authorization.details).toMatchObject({ state: "blocked" });
			} else {
				expect(authorization.details).toMatchObject({ state: "cancelled", operation: "record-review-verdict" });
			}
			expect(
				timedOut || authorization.details?.operation === "record-review-verdict",
			).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reserves one task before awaits so concurrent review commands spawn once", async () => {
		const root = makeEnrolledRoot();
		let releaseSnapshot!: () => void;
		const snapshotGate = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
		let rejectReview!: (reason?: unknown) => void;
		const reviewResult = new Promise<never>((_resolve, reject) => { rejectReview = reject; });
		let spawnCount = 0;
		let stopCount = 0;
		let shutdownHandlers: Array<() => unknown> = [];
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					await snapshotGate;
					return {
						snapshot: mod.buildSnapshot({
							root, task_id: taskId, role,
							record_revision: projection.projection.record_revision,
							workspace_revision: projection.projection.workspace_revision,
							intent_revision: projection.projection.intent_revision,
							intent_content_hash: projection.projection.intent_content_hash,
							diff_hash: projection.projection.diff_hash,
							phase: projection.projection.phase,
							fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
							acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
						}),
						descriptors: new Map(),
						reviewBundle: { diff_hash: projection.projection.diff_hash },
					};
				},
				startReview: async () => {
					spawnCount += 1;
					return {
						agentId: "native-agent",
						result: reviewResult,
						stop: async () => {
							stopCount += 1;
							rejectReview(new Error("fixture stopped"));
						},
					};
				},
			});
			shutdownHandlers = events.session_shutdown ?? [];
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			const first = commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 0));
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			releaseSnapshot();
			await first;
			for (let attempt = 0; attempt < 40 && spawnCount === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(spawnCount).toBe(1);
			expect(ui.notifyCalls.some((call) => /already running/i.test(call.text))).toBe(true);
			emitFailedAgentResult(events, "native-agent", "reservation-cleanup-result");
			await Promise.all(shutdownHandlers.map((handler) => handler()));
			expect(stopCount).toBe(1);
		} finally {
			releaseSnapshot?.();
			await Promise.all(shutdownHandlers.map((handler) => handler()));
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("native verdict remains advisory until literal-user confirmation", async () => {
		const root = makeEnrolledRoot();
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			let snapshot: any;
			let reviewSpawns = 0;
			let reviewRequest: { prompt: string; maxTurns: number } | undefined;
			const { commands, tools, messages, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root,
						task_id: taskId,
						role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						risk: "routine",
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					});
					return { snapshot, descriptors: new Map(), reviewBundle: { contract: "assurance_kernel/review_bundle/v4" as const, root, head: "a".repeat(40), scope: [], diff_hash: projection.projection.diff_hash, dirty_files: {}, outcomes: {}, bundle_digest: "sha256:" + "e".repeat(64) } };
				},
				startReview: async (request: { prompt: string; maxTurns: number }) => {
					reviewRequest = request;
					reviewSpawns += 1;
					return {
						agentId: "native-agent",
						result: Promise.resolve({
							agentId: "native-agent",
							status: "completed",
							result: JSON.stringify({
								contract: "assurance_kernel/assurance_verdict/v2",
								role: "review",
								task_id: TASK,
								snapshot_digest: mod.snapshotDigest(snapshot),
								decision: "pass",
								approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
							}),
						}),
						stop: async () => {},
					};
				},
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await tools[0].execute(
				"record-evidence",
				{ task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "verified" } },
				undefined,
				undefined,
				ctx,
			);
			await tools[0].execute(
				"submit-review",
				{ task_id: TASK, action: { op: "submit_review" } },
				undefined,
				undefined,
				ctx,
			);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && reviewSpawns < 1; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			await new Promise((resolve) => setTimeout(resolve, 0));
			emitCompletedAgentResult(events, "native-agent", "advisory-result-1", JSON.stringify({
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: mod.snapshotDigest(snapshot),
				decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
			}));
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /request_authorization/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(ui.notifyCalls.some((call) => /request_authorization/i.test(call.text))).toBe(true);
			const resultMessage = messages.find((entry) => entry.message.customType === "imm-assurance-result");
			expect(resultMessage?.message.details.presentation).toEqual({
				passed_acceptance_ids: [],
				missing_acceptance_ids: [],
				findings: [],
			});
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			expect(reviewSpawns).toBe(1);
			// routine risk + empty acceptance + minimal bundle => quick workload => 12 turns.
			expect(reviewRequest?.maxTurns).toBe(12);
			expect(reviewRequest?.prompt).toContain("Verify immutable bundle provenance before analyzing findings");
			expect(reviewRequest?.prompt).toContain("Limit repository inspection to the acceptance assertions and dirty_files contents in the immutable bundle");
			expect(reviewRequest?.prompt).toContain("Do not explore unrelated repository paths");
			expect(reviewRequest?.prompt).toContain("Reserve the final turn for exactly one strict JSON verdict");
			expect(ui.notifyCalls.some((call) => /already awaits/i.test(call.text))).toBe(true);
			// Scenario 1: an unrelated dirty file does not block verdict application.
			writeFileSync(join(root, "README.md"), "unrelated dirty file\n");
			ctx.ui.confirm = async (title: string, body: string) => {
				ui.confirmCalls.push({ title, body });
				return true;
			};
			const unrelated = await tools[0].execute(
				"req-unrelated-review",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctx,
			);
			expect(unrelated.details).toMatchObject({ state: "applied", operation: "record-review-verdict" });
			expect(ui.confirmCalls[0].title).toContain("record-review-verdict");
			expect(ui.confirmCalls[0].body).toContain("Review: PASS | Blockers: 0 | Warnings: 0");
			expect(ui.confirmCalls[0].body).toContain("Impact: 0 scoped changed file(s)");
			expect(ui.confirmCalls[0].body).toContain("Authority details");
			expect(ui.confirmCalls[0].body).toContain("Native agent: native-agent");
			expect(ui.confirmCalls[0].body).toContain("Verdict: pass");
			rmSync(join(root, "README.md"));

			// Scenario 2: cancelling the confirmation records exactly one open
			// decision trail finding and discards the pending verdict without
			// applying it.
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && reviewSpawns < 2; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			await new Promise((resolve) => setTimeout(resolve, 0));
			emitCompletedAgentResult(events, "native-agent", "advisory-result-2", JSON.stringify({
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: mod.snapshotDigest(snapshot),
				decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
			}));
			for (let attempt = 0; attempt < 40 && messages.filter((entry) => entry.options?.deliverAs === "followUp").length < 2; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(reviewSpawns).toBe(2);
			const before = require("node:fs").readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8");
			ctx.ui.confirm = async (title: string, body: string) => {
				ui.confirmCalls.push({ title, body });
				return false;
			};
			const requested = await tools[0].execute(
				"req-review-cancel",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctx,
			);
			const after = require("node:fs").readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8");
			const afterRecord = JSON.parse(after);
			const decisions = afterRecord.findings.filter(
				(finding: { kind: string; status: string }) =>
					finding.kind === "unresolved_user_decision" && finding.status === "open",
			);
			expect(decisions).toHaveLength(1);
			expect(decisions[0].id).toBe("user-decision-record-review-verdict");
			expect(decisions[0].summary).toContain("record-review-verdict confirmation cancelled");
			// The cancelled verdict itself was never applied: the review approval
			// count is unchanged between before and after (scenario 1's approval
			// predates the cancel).
			const beforeRecord = JSON.parse(before);
			expect(afterRecord.approvals.filter((a: { kind: string }) => a.kind === "review")).toHaveLength(
				beforeRecord.approvals.filter((a: { kind: string }) => a.kind === "review").length,
			);
			expect(requested.details).toMatchObject({ state: "cancelled", operation: "record-review-verdict" });

			// Scenario 3: the decision trail is resolvable end to end.
			ctx.ui.confirm = async (title: string, body: string) => {
				ui.confirmCalls.push({ title, body });
				return true;
			};
			const resumed = await tools[0].execute(
				"req-resolve",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctx,
			);
			expect(resumed.details).toMatchObject({ state: "applied", operation: "resolve-user-decision", phase: "review" });
			expect(ui.confirmCalls.at(-1)?.body).toContain("user-decision-record-review-verdict");
			const resolvedRecord = JSON.parse(require("node:fs").readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(
				resolvedRecord.findings.find((finding: { id: string }) => finding.id === "user-decision-record-review-verdict")?.status,
			).toBe("resolved");

			// Scenario 4: a stale snapshot between verdict and confirmation fails closed.
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && reviewSpawns < 3; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			await new Promise((resolve) => setTimeout(resolve, 0));
			emitCompletedAgentResult(events, "native-agent", "advisory-result-3", JSON.stringify({
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: mod.snapshotDigest(snapshot),
				decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
			}));
			for (let attempt = 0; attempt < 40 && messages.filter((entry) => entry.options?.deliverAs === "followUp").length < 3; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(reviewSpawns).toBe(3);
			writeFileSync(
				join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"),
				"export const task = 'new staged snapshot';\n",
			);
			execFileSync("git", ["add", "plugins/immune-brain/.pi-extension/task.ts"], { cwd: root });
			const stale = await tools[0].execute(
				"req-stale-review",
				{ task_id: TASK, action: { op: "request_authorization" } },
				undefined,
				undefined,
				ctx,
			);
			expect(stale.details).toMatchObject({
				state: "blocked",
				reason: "assurance snapshot changed before authority application",
			});
			writeFileSync(
				join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"),
				"export const task = 'staged';\n",
			);
			execFileSync("git", ["add", "plugins/immune-brain/.pi-extension/task.ts"], { cwd: root });
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && reviewSpawns < 4; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			await new Promise((resolve) => setTimeout(resolve, 0));
			emitCompletedAgentResult(events, "native-agent", "advisory-result-4", JSON.stringify({
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: mod.snapshotDigest(snapshot),
				decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
			}));
			for (let attempt = 0; attempt < 40 && messages.filter((entry) => entry.options?.deliverAs === "followUp").length < 4; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(reviewSpawns).toBe(4);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 20_000);

	test("session shutdown discards a late affirmative review confirmation", async () => {
		const root = makeEnrolledRoot();
		let releaseConfirm!: (confirmed: boolean) => void;
		const confirmGate = new Promise<boolean>((resolve) => { releaseConfirm = resolve; });
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			let snapshot: any;
			const { commands, events } = loadSurface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root, task_id: taskId, role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					});
					return { snapshot, descriptors: new Map(), reviewBundle: { diff_hash: projection.projection.diff_hash } };
				},
				startReview: async () => ({
					agentId: "native-agent",
					result: Promise.resolve({
						agentId: "native-agent", status: "completed",
						result: JSON.stringify({
							contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: TASK,
							snapshot_digest: mod.snapshotDigest(snapshot), decision: "pass",
							approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
						}),
					}),
					stop: async () => {},
				}),
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /is reviewing/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			emitCompletedAgentResult(events, "native-agent", "shutdown-confirm-result", JSON.stringify({
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: mod.snapshotDigest(snapshot),
				decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
			}));
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((call) => /request_authorization/i.test(call.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			ctx.ui.confirm = async () => confirmGate;
			const before = require("node:fs").readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8");
			const authorize = commands["imm-canary-authorize"].handler(`${TASK} record-review-verdict`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 0));
			await Promise.all((events.session_shutdown ?? []).map((handler) => handler()));
			releaseConfirm(true);
			await authorize;
			const after = require("node:fs").readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8");
			expect(after).toBe(before);
			expect(ui.notifyCalls.some((call) => /session changed/i.test(call.text))).toBe(true);
		} finally {
			releaseConfirm?.(false);
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("standard Agent spawn receipt does not create a pending verdict", async () => {
		const root = makeEnrolledRoot();
		try {
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			let snapshot: ReturnType<typeof mod.buildSnapshot> | undefined;
			const { commands, events, tools, messages } = loadSurface({
				buildAssurance: async (_cwd: string, taskId: string, role: string, projection: { projection: Record<string, string> }) => {
					snapshot = mod.buildSnapshot({
						root,
						task_id: taskId,
						role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						risk: "routine",
						fresh_acceptance_ids: [],
						missing_acceptance_ids: [],
						stale_evidence_ids: [],
						acceptance: INTENT.acceptance,
						dirty_files: [],
						review_bundle_digest: "sha256:" + "e".repeat(64),
					});
					return { snapshot, descriptors: new Map(), reviewBundle: { contract: "assurance_kernel/review_bundle/v4" as const, root, head: "a".repeat(40), scope: [], diff_hash: projection.projection.diff_hash, dirty_files: {}, outcomes: {}, bundle_digest: "sha256:" + "e".repeat(64) } };
				},
			});
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			await tools[0].execute(
				"record-evidence",
				{ task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "verified" } },
				undefined,
				undefined,
				ctx,
			);
			await tools[0].execute(
				"submit-review",
				{ task_id: TASK, action: { op: "submit_review" } },
				undefined,
				undefined,
				ctx,
			);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 80 && !messages.some((item) => /standard Agent tool/i.test(item.message?.content ?? "")); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			const dispatch = messages.find((item) => /standard Agent tool/i.test(item.message?.content ?? ""));
			expect(dispatch?.options).toMatchObject({ deliverAs: "followUp", triggerTurn: true });
			const params = dispatch?.message?.details?.agent_params;
			expect(params).toMatchObject({
				subagent_type: "general-purpose",
				isolated: true,
				inherit_context: false,
				isolation: "worktree",
				run_in_background: true,
				max_turns: 12,
			});
			for (const handler of events.tool_execution_start ?? []) {
				(handler as (event: unknown) => void)({
					toolName: "Agent",
					toolCallId: "call-spawn",
					args: params,
				});
			}
			for (const handler of events.tool_execution_end ?? []) {
				(handler as (event: unknown) => void)({
					toolName: "Agent",
					toolCallId: "call-spawn",
					isError: false,
					args: params,
					result: { details: { agentId: "agent-1", status: "background" } },
				});
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(messages.some((item) => item.message?.details?.terminal === "verdict_ready")).toBe(false);
			const digest = snapshot ? mod.snapshotDigest(snapshot) : "";
			for (const handler of events.tool_execution_end ?? []) {
				(handler as (event: unknown) => void)({
					toolName: "get_subagent_result",
					toolCallId: "call-result",
					isError: false,
					result: {
						content: [{
							type: "text",
							text: `Agent: agent-1\nType: general-purpose | Status: completed | Duration: 1200ms\n\n${JSON.stringify({
								contract: "assurance_kernel/assurance_verdict/v2",
								role: "review",
								task_id: TASK,
								snapshot_digest: digest,
								decision: "pass",
								approval: { kind: "review", authority_role: "reviewer", summary: "verified" },
							})}`,
						}],
					},
				});
			}
			for (let attempt = 0; attempt < 40 && !messages.some((item) => item.message?.details?.terminal === "verdict_ready"); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(messages.some((item) => item.message?.details?.terminal === "verdict_ready")).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("advance_assurance fails closed while a replan boundary is open", async () => {
		const root = makeEnrolledRoot();
		try {
			const { tools } = loadSurface();
			const ui = makeUI();
			const ctx = makeCtx(root, ui, "tui");
			const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
			const record = JSON.parse(readFileSync(recordPath, "utf8"));
			record.phase = "review";
			record.findings = [{
				id: "H3:replan-required",
				kind: "replan_required",
				status: "open",
				acceptance_id: "A1",
				source: "kernel",
				review_round: 2,
				summary: "durable replan",
			}];
			writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
			const result = await tools[0].execute(
				"advance-parked",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				undefined,
				undefined,
				ctx,
			);
			expect(result.details).toMatchObject({
				state: "blocked",
				reason: expect.stringMatching(/durable replan/i),
			});
			expect(ui.confirmCalls.length).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("assure for a task without a claim fails closed", async () => {
		const root = makeEnrolledRoot();
		try {
			const { commands } = loadSurface();
			const ui = makeUI();
			await commands["imm-canary-assure"].handler("no-such-task review", makeCtx(root, ui, "tui"));
			for (let attempt = 0; attempt < 40 && !ui.notifyCalls.some((n) => /failed to start|no active backend claim/i.test(n.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(ui.notifyCalls.some((n) => /failed to start|no active backend claim/i.test(n.text))).toBe(true);
			expect(ui.statusCalls).toEqual([]);
			expect(ui.widgetCalls).toEqual([]);
			expect(ui.confirmCalls.length).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
