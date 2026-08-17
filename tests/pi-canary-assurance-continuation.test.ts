import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";

const TASK = "assurance-continuation-task";
const BUNDLE_DIGEST = `sha256:${"e".repeat(64)}`;
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "continue from QA to one native review",
	acceptance: [{
		id: "A1",
		assertion: "continuation is observable",
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

function enrolledRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "assurance-continuation-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), `${JSON.stringify(INTENT, null, 2)}\n`);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(join(root, ".imm", "workspace.json"), `${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2)}\n`);
	const registry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-14T00:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: canonicalIntentHash(INTENT),
		preparation_digest: prep.digest,
		readiness_digest: "sha256:ready",
		evidence_digest: "sha256:evidence",
		waiver_gate: "observation_window_days",
		actor_id: "user",
		confirmation_ref: "test",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "continuation-test",
	};
	enrollCanaryTask(root, {
		task_id: TASK,
		intent_path: binding.intent_path,
		intent_revision: 1,
		preparation_digest: prep.digest,
		readiness_digest: binding.readiness_digest,
		evidence_digest: binding.evidence_digest,
		capability: registry.issue(binding),
		capability_binding: binding,
		now: "2026-08-14T00:00:00.000Z",
	}, registry);
	return root;
}

interface RegisteredTool {
	execute: (id: string, params: unknown, signal: AbortSignal, onUpdate: unknown, ctx: unknown) => Promise<{ details?: Record<string, unknown> }>;
}

function context(root: string) {
	return {
		mode: "tui",
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify() {},
			confirm: async () => true,
			setStatus() {},
			setWidget() {},
		},
	};
}

describe("QA to Review parent continuation", () => {
	test("QA pass starts one reviewer and one correlated follow-up without writing review authority", async () => {
		const root = enrolledRoot();
		const messages: Array<{ message: any; options: any }> = [];
		const events: Record<string, Array<(event: unknown) => void>> = {};
		let reviewSpawns = 0;
		let reviewSnapshot: any;
		try {
			const tools: RegisteredTool[] = [];
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const pi = {
				registerTool: (tool: RegisteredTool) => tools.push(tool),
				registerMessageRenderer() {},
				registerCommand() {},
				on: (name: string, handler: (event: unknown) => void) => {
					(events[name] ??= []).push(handler);
				},
				sendMessage: (message: unknown, options: unknown) => messages.push({ message, options }),
			} as unknown as ExtensionAPI;
			mod.default(pi, {
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					const snapshot = mod.buildSnapshot({
						root,
						task_id: taskId,
						role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: ["A1"],
						missing_acceptance_ids: [],
						stale_evidence_ids: [],
						acceptance: [],
						dirty_files: [],
						review_bundle_digest: role === "review" ? BUNDLE_DIGEST : null,
					});
					if (role === "review") reviewSnapshot = snapshot;
					return { snapshot, descriptors: new Map(), reviewBundle: role === "review" ? { task_id: taskId } : undefined };
				},
				runQa: async (snapshot: any) => ({
					contract: "assurance_kernel/assurance_verdict/v2",
					role: "qa",
					task_id: TASK,
					snapshot_digest: mod.snapshotDigest(snapshot),
					decision: "pass",
					approval: { kind: "qa", authority_role: "qa", summary: "deterministic checks passed" },
				}),
				writeReviewEvidence: () => ({
					path: join(root, ".imm", "review.json"),
					digest: BUNDLE_DIGEST,
					remove() {},
				}),
				startReview: async () => {
					reviewSpawns += 1;
					return {
						agentId: "native-reviewer-1",
						result: Promise.resolve({
							agentId: "native-reviewer-1",
							status: "completed",
							result: JSON.stringify({
								contract: "assurance_kernel/assurance_verdict/v2",
								role: "review",
								task_id: TASK,
								snapshot_digest: mod.snapshotDigest(reviewSnapshot),
								decision: "pass",
								approval: { kind: "review", authority_role: "reviewer", summary: "review passed" },
							}),
						}),
						stop: async () => {},
					};
				},
			});
			const tool = tools[0];
			const ctx = context(root);
			const signal = new AbortController().signal;
			await tool.execute("evidence", { task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "fresh" } }, signal, undefined, ctx);
			const started = await tool.execute("advance", { task_id: TASK, action: { op: "advance_assurance" } }, signal, undefined, ctx);
			expect(started.details?.state).toBe("started");
			for (let attempt = 0; attempt < 80 && messages.length === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));

			expect(reviewSpawns).toBe(1);
			for (const handler of events.tool_execution_end ?? []) {
				handler({
					toolName: "get_subagent_result",
					toolCallId: "continuation-review-result",
					args: { agent_id: "native-reviewer-1" },
					isError: false,
					result: { content: [{ type: "text", text: `Agent: native-reviewer-1\nStatus: completed\n\n${JSON.stringify({
						contract: "assurance_kernel/assurance_verdict/v2",
						role: "review",
						task_id: TASK,
						snapshot_digest: mod.snapshotDigest(reviewSnapshot),
						decision: "pass",
						approval: { kind: "review", authority_role: "reviewer", summary: "review passed" },
					})}` }] },
				});
			}
			for (let attempt = 0; attempt < 80 && messages.length === 0; attempt += 1)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(messages).toHaveLength(1);
			expect(messages[0].options).toMatchObject({ triggerTurn: true, deliverAs: "followUp" });
			expect(messages[0].message.details).toMatchObject({
				task_id: TASK,
				role: "review",
				terminal: "verdict_ready",
				record_revision: expect.stringMatching(/^sha256:/),
				intent_content_hash: canonicalIntentHash(INTENT),
				diff_hash: expect.stringMatching(/^sha256:/),
			});
			const record = JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8"));
			expect(record.approvals.map((approval: { kind: string }) => approval.kind)).toEqual(["qa"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test("pre-spawn Review cancellation emits no correlated terminal follow-up", async () => {
		const root = enrolledRoot();
		const messages: Array<{ message: any; options: any }> = [];
		let releaseSnapshot!: () => void;
		let markSnapshotStarted!: () => void;
		const snapshotGate = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
		const snapshotStarted = new Promise<void>((resolve) => { markSnapshotStarted = resolve; });
		let reviewSpawns = 0;
		try {
			const tools: RegisteredTool[] = [];
			const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
			const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
			const pi = {
				registerTool: (tool: RegisteredTool) => tools.push(tool),
				registerMessageRenderer() {},
				registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
					commands[name] = command;
				},
				on() {},
				sendMessage: (message: unknown, options: unknown) => messages.push({ message, options }),
			} as unknown as ExtensionAPI;
			mod.default(pi, {
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => {
					const snapshot = mod.buildSnapshot({
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
						review_bundle_digest: BUNDLE_DIGEST,
					});
					markSnapshotStarted();
					await snapshotGate;
					return { snapshot, descriptors: new Map(), reviewBundle: { task_id: taskId } };
				},
				startReview: async () => {
					reviewSpawns += 1;
					throw new Error("native spawn must not run after startup cancellation");
				},
			});
			const ctx = context(root);
			await commands["imm-canary-assure"].handler(`${TASK} review`, ctx);
			await snapshotStarted;
			await commands["imm-canary-assure"].handler(`${TASK} cancel`, ctx);
			releaseSnapshot();
			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(reviewSpawns).toBe(0);
			expect(messages).toHaveLength(0);
		} finally {
			releaseSnapshot?.();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
