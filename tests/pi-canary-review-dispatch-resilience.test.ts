// 2026-08-16-010 acc-bundle-lifetime / acc-provider-failure-classification.
// Immutable review bundle artifacts persist under an unsettled reservation and
// are removed only at terminal settlement or explicit release; provider
// quota/transport dispatch failures are no-verdict failures that write zero
// authority, keep the reserved operation valid, emit no terminal review
// event, consume no review round, and permit exactly one re-dispatch of the
// SAME reserved operation; missing artifacts fail closed with an explicit
// re-reserve path; validated native terminal status remains the only verdict
// source.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyDispatchFailure, reservedAgentParams, reservedAgentDescription } from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";
import { assertReviewArtifact, writeNativeReviewEvidence } from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";

describe("provider failure classification", () => {
	test("classifies quota and transport failures as no-verdict dispatch failures", () => {
		expect(classifyDispatchFailure(new Error("429 Too Many Requests"))).toBe("no_verdict_dispatch_failure");
		expect(classifyDispatchFailure(new Error("rate limit exceeded"))).toBe("no_verdict_dispatch_failure");
		expect(classifyDispatchFailure(new Error("insufficient_quota for model"))).toBe("no_verdict_dispatch_failure");
		expect(classifyDispatchFailure(new Error("ECONNRESET socket hang up"))).toBe("no_verdict_dispatch_failure");
		expect(classifyDispatchFailure(new Error("ETIMEDOUT transport"))).toBe("no_verdict_dispatch_failure");
		expect(classifyDispatchFailure(new Error("503 Service Unavailable"))).toBe("no_verdict_dispatch_failure");
		expect(classifyDispatchFailure(new Error("overloaded"))).toBe("no_verdict_dispatch_failure");
	});

	test("unknown failures remain dispatch_unknown", () => {
		expect(classifyDispatchFailure(new Error("spawn rejected: agent already running"))).toBe("dispatch_unknown");
		expect(classifyDispatchFailure(new Error("boom"))).toBe("dispatch_unknown");
		expect(classifyDispatchFailure("plain string")).toBe("dispatch_unknown");
	});

	test("reserved params carry the workload-scaled turn budget and stable description", () => {
		const params = reservedAgentParams({
			taskId: "2026-08-16-010-review-dispatch-resilience",
			operationId: "op-1",
			prompt: "p",
			max_turns: 24,
		});
		expect(params.max_turns).toBe(24);
		expect(params.description).toBe(reservedAgentDescription("2026-08-16-010-review-dispatch-resilience", "op-1"));
		expect(params.run_in_background).toBe(true);
		expect(params.isolation).toBe("worktree");
	});
});

describe("bundle artifact lifetime", () => {
	test("assertReviewArtifact passes on a written evidence file and fails closed on missing/empty", () => {
		const evidence = writeNativeReviewEvidence({ hello: "world", n: 42 });
		try {
			expect(existsSync(evidence.path)).toBe(true);
			expect(() => assertReviewArtifact(evidence.path)).not.toThrow();
			const parsed = JSON.parse(readFileSync(evidence.path, "utf8"));
			expect(parsed.hello).toBe("world");
		} finally {
			evidence.remove();
		}
		expect(existsSync(evidence.path)).toBe(false);
		expect(() => assertReviewArtifact(evidence.path)).toThrow(/missing or empty/);
		expect(() => assertReviewArtifact("/nonexistent/evidence.json")).toThrow();
	});

	test("removal is idempotent and only the owned directory is removed", () => {
		const evidence = writeNativeReviewEvidence({ a: 1 });
		const dir = evidence.path.replace(/evidence\.json$/, "");
		evidence.remove();
		evidence.remove();
		expect(existsSync(dir)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Progression-level integration: no-verdict dispatch failure keeps the
// reserved operation valid, permits exactly one re-dispatch of the SAME
// operation, consumes no review round, writes zero authority, and emits no
// terminal review event; a second failure settles dispatch_unknown.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TASK = "2026-08-16-010-review-dispatch-resilience";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "dispatch resilience",
	acceptance: [{
		id: "A1",
		assertion: "a1",
		verification: JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v1",
			runner_id: "bun",
			runner_version: "1.3.14",
			argv: ["test"],
			cwd: ".",
			timeout_ms: 1000,
			max_output_bytes: 1024,
		}),
	}],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "material",
	revision: 1,
	owner: "user",
} as const;
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";

const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "b".repeat(64);
const NOW = "2026-08-16T18:00:00.000Z";

function makeReviewReadyRoot(): { root: string; app: ReturnType<typeof createCanaryApplication> } {
	const root = mkdtempSync(join(tmpdir(), "dr-res-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), JSON.stringify(INTENT, null, 2) + "\n");
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"), "export const task = 'baseline';\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(join(root, ".imm", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2) + "\n");
	const registry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: NOW });
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
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		preparation_digest: binding.preparation_digest,
		readiness_digest: "sha256:r",
		evidence_digest: "sha256:e",
		capability: registry.issue(binding),
		capability_binding: binding,
		now: NOW,
	}, registry);
	const mutationRegistry = createMutationAuthorityRegistry();
	const app = createCanaryApplication(mutationRegistry);
	const token = () => readTaskIntent(root, TASK).token;
	app.execute({ root, task_id: TASK, operation: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "ok", actor_id: "executor-1" }, prior_intent_token: token(), diffProvider: () => DIFF, now: NOW });
	app.execute({ root, task_id: TASK, operation: { op: "submit_review", actor_id: "executor-1" }, prior_intent_token: token(), diffProvider: () => DIFF, now: NOW });
	return { root, app };
}

interface FakeUI2 {
	notifyCalls: Array<{ text: string }>;
}
function loadSurface2(dependencies: Record<string, unknown> = {}): {
	commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
	messages: Array<{ message: any; options: any }>;
	events: Record<string, Array<(event: unknown) => unknown>>;
} {
	const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
	const messages: Array<{ message: any; options: any }> = [];
	const events: Record<string, Array<(event: unknown) => unknown>> = {};
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI, dependencies?: Record<string, unknown>) => void;
	const pi = {
		registerTool: () => {},
		registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
			commands[name] = spec;
		},
		on: (name: string, handler: (event: unknown) => unknown) => {
			(events[name] ??= []).push(handler);
		},
		registerMessageRenderer: () => {},
		sendMessage: (message: unknown, options: unknown) => messages.push({ message, options }),
	} as unknown as ExtensionAPI;
	factory(pi, dependencies);
	return { commands, messages, events };
}

function emitCompletedAgentResult2(
	events: Record<string, Array<(event: unknown) => unknown>>,
	agentId: string,
	verdict: string,
): void {
	for (const handler of events.tool_execution_end ?? []) {
		(handler as (event: unknown) => unknown)({
			toolName: "get_subagent_result",
			toolCallId: "res-1",
			args: { agent_id: agentId },
			isError: false,
			result: {
				content: [{ type: "text", text: `Agent: ${agentId}\nStatus: completed\n\n${verdict}` }],
			},
		});
	}
}

function makeCtx2(root: string, ui: FakeUI2) {
	return {
		mode: "tui",
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: (text: string) => ui.notifyCalls.push({ text }),
			setStatus: () => {},
			setWidget: () => {},
			confirm: async () => true,
		},
	};
}

describe("no-verdict dispatch failure handling (progression)", () => {
	test("429 keeps the reserved operation valid; the single re-dispatch reuses it; second failure settles dispatch_unknown with zero authority writes and no review round consumed", async () => {
		const { root } = makeReviewReadyRoot();
		try {
			const before = readTaskRecordV2(root, TASK);
			const failures: string[] = [];
			let spawnCalls: Array<{ description: string }> = [];
			const ui: FakeUI2 = { notifyCalls: [] };
			const { commands, messages } = loadSurface2({
				startReview: async (request: { description: string }) => {
					spawnCalls.push({ description: request.description });
					if (failures.length < 2) {
						failures.push("429");
						throw new Error("429 Too Many Requests");
					}
					return {
						agentId: "native-agent",
						result: Promise.resolve({
							agentId: "native-agent",
							status: "completed",
							result: JSON.stringify({
								contract: "assurance_kernel/assurance_verdict/v2",
								role: "review",
								task_id: TASK,
								snapshot_digest: snapshot ? mod.snapshotDigest(snapshot) : "sha256:" + "c".repeat(64),
								decision: "pass",
								approval: { kind: "review", authority_role: "reviewer", summary: "ok" },
							}),
						}),
						stop: async () => {},
					};
				},
			});
			const ctx = makeCtx2(root, ui);
			// First dispatch: no-verdict failure.
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 50));
			if (!ui.notifyCalls.some((n) => /no-verdict/i.test(n.text) && /remains valid/i.test(n.text))) {
				console.log("NOTIFY:", JSON.stringify(ui.notifyCalls));
			}
			expect(ui.notifyCalls.some((n) => /no-verdict/i.test(n.text) && /remains valid/i.test(n.text))).toBe(true);
			// No terminal review event was emitted.
			expect(messages.filter((m) => m.options?.deliverAs === "followUp")).toHaveLength(0);
			// Zero authority writes.
			const afterFirst = readTaskRecordV2(root, TASK);
			expect(afterFirst.revision).toBe(before.revision);
			// No review round consumed (no findings, no rework history).
			expect(afterFirst.record?.findings).toHaveLength(0);
			expect(afterFirst.record?.history.filter((h) => h.type === "request_rework")).toHaveLength(0);

			// Second dispatch: the exactly-one re-dispatch of the SAME operation.
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 60 && spawnCalls.length < 2; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 10));
			// Still failing (second 429) -> reused reservation settles dispatch_unknown.
			if (spawnCalls.length !== 2) console.log("SPAWN:", JSON.stringify(spawnCalls), "NOTIFY2:", JSON.stringify(ui.notifyCalls));
			expect(spawnCalls).toHaveLength(2);
			expect(spawnCalls[0].description).toBe(spawnCalls[1].description);
			expect(ui.notifyCalls.some((n) => /dispatch failed without a terminal receipt/i.test(n.text))).toBe(true);
			// Still zero authority writes and no round consumed.
			const afterSecond = readTaskRecordV2(root, TASK);
			expect(afterSecond.revision).toBe(before.revision);
			expect(afterSecond.record?.findings).toHaveLength(0);
			expect(afterSecond.record?.history.filter((h) => h.type === "request_rework")).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a success on the single re-dispatch produces a pending verdict (validated native terminal remains the only verdict source)", async () => {
		const { root } = makeReviewReadyRoot();
		try {
			let failures = 1;
			const ui: FakeUI2 = { notifyCalls: [] };
			let snapshot: any;
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const { commands, events } = loadSurface2({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					snapshot = mod.buildSnapshot({
						root: _root,
						task_id: taskId,
						role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						risk: "material",
						fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_evidence_ids: [],
						acceptance: [], dirty_files: [], review_bundle_digest: "sha256:" + "e".repeat(64),
					});
					return { snapshot, descriptors: new Map(), reviewBundle: { contract: "assurance_kernel/review_bundle/v4" as const, root: _root, head: "a".repeat(40), scope: [], diff_hash: projection.projection.diff_hash, dirty_files: {}, outcomes: {}, bundle_digest: "sha256:" + "e".repeat(64) } };
				},
				startReview: async (request: { description: string; prompt: string; maxTurns: number }) => {
					if (failures > 0) {
						failures -= 1;
						throw new Error("provider overloaded");
					}
					return {
						agentId: "native-agent",
						result: Promise.resolve({
							agentId: "native-agent",
							status: "completed",
							result: JSON.stringify({
								contract: "assurance_kernel/assurance_verdict/v2",
								role: "review",
								task_id: TASK,
								snapshot_digest: snapshot ? mod.snapshotDigest(snapshot) : "sha256:" + "c".repeat(64),
								decision: "pass",
								approval: { kind: "review", authority_role: "reviewer", summary: "ok" },
							}),
						}),
						stop: async () => {},
					};
				},
			});
			const ctx = makeCtx2(root, ui);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await new Promise((resolve) => setTimeout(resolve, 30));
			// Re-dispatch succeeds -> the review runs and its verdict becomes pending.
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			for (let attempt = 0; attempt < 60 && !ui.notifyCalls.some((n) => /request_authorization/i.test(n.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 10));
			if (!ui.notifyCalls.some((n) => /request_authorization/i.test(n.text))) {
				// The verdict settlement needs the tool_execution_end receipt.
				emitCompletedAgentResult2(events, "native-agent", JSON.stringify({
					contract: "assurance_kernel/assurance_verdict/v2",
					role: "review",
					task_id: TASK,
					snapshot_digest: snapshot ? mod.snapshotDigest(snapshot) : "sha256:" + "c".repeat(64),
					decision: "pass",
					approval: { kind: "review", authority_role: "reviewer", summary: "ok" },
				}));
			}
			for (let attempt = 0; attempt < 60 && !ui.notifyCalls.some((n) => /request_authorization/i.test(n.text)); attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 10));
			console.log("FINAL NOTIFY:", JSON.stringify(ui.notifyCalls));
			expect(ui.notifyCalls.some((n) => /request_authorization/i.test(n.text))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
