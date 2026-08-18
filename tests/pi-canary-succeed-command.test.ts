// 2026-08-16-009 acc-succeed-atomic / acc-enrollment-authority-contract.
// The successor command collapses stop + claim release + intent derivation +
// atomic enrollment into one confirmed, marker-guarded operation with
// all-before/all-after crash recovery; cancellation before commit writes
// nothing; the derivation preserves scope_hint and verification descriptors.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	deriveSuccessorIntent,
	successorIdFor,
	succeedCanaryTask,
	recoverPendingSuccessionLocked,
	registerSucceedCommand,
	parseSucceedArgs,
} from "../plugins/immune-brain/.pi-extension/imm-canary-succeed.ts";
import { taskDiffHash } from "../plugins/immune-brain/runtime/workspace_scope";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { capabilityActionFor } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordV2, readTaskRecordV2Raw } from "../plugins/immune-brain/runtime/kernel/storage";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";

const PRED = "2026-08-16-015-confirm-cancel-decision-trail";
const SUCC = "2026-08-16-016-confirm-cancel-decision-trail";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: PRED,
	goal: "predecessor goal",
	acceptance: [
		{
			id: "A1",
			assertion: "a1",
			verification: JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v1",
				runner_id: "bun",
				runner_version: "1.3.14",
				argv: ["test", "tests/x.test.ts"],
				cwd: ".",
				timeout_ms: 300000,
				max_output_bytes: 262144,
			}),
		},
	],
	scope_hint: ["plugins/immune-brain/.pi-extension", "tests/x.test.ts"],
	risk: "material",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);
const NOW = "2026-08-16T16:00:00.000Z";

function makePredecessorRoot(): { root: string; seedReplan(): void } {
	const root = mkdtempSync(join(tmpdir(), "succeed-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "docs", "plans", `${PRED}.intent.json`), JSON.stringify(INTENT, null, 2) + "\n");
	writeFileSync(
		join(root, "plugins", "immune-brain", ".pi-extension", "task.ts"),
		"export const task = 'baseline';\n",
	);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(
		join(root, ".imm", "workspace.json"),
		JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2) + "\n",
	);
	const registry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: PRED, now: NOW });
	const binding: EnrollmentCapabilityBinding = {
		task_id: PRED,
		intent_path: `docs/plans/${PRED}.intent.json`,
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
			task_id: PRED,
			intent_path: `docs/plans/${PRED}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			readiness_digest: "sha256:r",
			evidence_digest: "sha256:e",
			capability: registry.issue(binding),
			capability_binding: binding,
			now: NOW,
		},
		registry,
	);
	const seedReplan = () => {
		const path = join(root, ".imm", "tasks", `${PRED}.json`);
		const record = JSON.parse(readFileSync(path, "utf8"));
		if (record.findings.some((f: { id: string }) => f.id === "replan-1")) return;
		record.findings.push({
			id: "replan-1",
			kind: "replan_required",
			status: "open",
			acceptance_id: null,
			source: "kernel",
			review_round: 2,
			summary: "Review returned this acceptance boundary twice",
		});
		writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
	};
	return { root, seedReplan };
}

function buildSucceedInput(root: string, seedReplan: () => void) {
	seedReplan();
	const intent = readTaskIntent(root, PRED);
	const successorIntent = deriveSuccessorIntent(intent.intent, SUCC);
	writeFileSync(join(root, "docs", "plans", `${SUCC}.intent.json`), JSON.stringify(successorIntent, null, 2) + "\n");
	const stopRegistry = createMutationAuthorityRegistry();
	const current = readTaskRecordV2Raw(root, PRED);
	const diffHash = taskDiffHash(root, intent.intent.scope_hint);
	const stopAction = capabilityActionFor({
		op: "stop",
		task_id: PRED,
		at: NOW,
		actor_id: "literal-user",
		reason: `succession to ${SUCC} (replan_required)`,
	}) as never;
	const stopCapability = stopRegistry.issue({
		authority_kind: "user",
		task_id: PRED,
		action_digest: digestOfAction(stopAction),
		expected_record_hash: current.revision,
		intent_revision: 1,
		intent_content_hash: intent.content_hash,
		diff_hash: diffHash,
		actor_id: "literal-user",
		confirmation_ref: "stop-1",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
	});
	const enrollmentRegistry = createEnrollmentAuthorityRegistry();
	const binding = {
		task_id: SUCC,
		intent_path: `docs/plans/${SUCC}.intent.json`,
		intent_revision: 1,
		intent_content_hash: canonicalIntentHash(successorIntent),
		readiness_digest: "sha256:r",
		evidence_digest: "sha256:e",
		waiver_gate: "observation_window_days",
		actor_id: "user",
		confirmation_ref: "s-1",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "n2",
	};
	return {
		root,
		predecessor_id: PRED,
		successor_id: SUCC,
		successor_intent: successorIntent,
		stop_capability: stopCapability,
		stop_registry: stopRegistry,
		enrollment_binding: binding,
		enrollment_registry: enrollmentRegistry,
	};
}

describe("successor intent derivation", () => {
	test("preserves scope_hint and verification descriptors; changes identity and goal", () => {
		const derived = deriveSuccessorIntent(INTENT, SUCC);
		expect(derived.task_id).toBe(SUCC);
		expect(derived.goal).toContain("[succession from");
		expect(derived.scope_hint).toEqual(INTENT.scope_hint);
		expect(derived.acceptance).toEqual(INTENT.acceptance);
		expect(derived.revision).toBe(INTENT.revision);
		expect(derived.risk).toBe(INTENT.risk);
	});

	test("successorIdFor bumps the numeric component", () => {
		expect(successorIdFor(PRED)).toBe(SUCC);
	});

	test("parseSucceedArgs validates the task id", () => {
		expect(parseSucceedArgs(PRED)).toEqual({ predecessor_id: PRED });
		expect(() => parseSucceedArgs("bad/id")).toThrow(/invalid task id/);
		expect(() => parseSucceedArgs("")).toThrow(/usage/);
	});
});

describe("atomic succession", () => {
	test("stops predecessor, releases claim, enrolls successor, flips workspace, removes marker", () => {
		const { root, seedReplan } = makePredecessorRoot();
		try {
			const input = buildSucceedInput(root, seedReplan);
			const result = succeedCanaryTask({
				...input,
				diffProvider: (r: string, intent: { scope_hint: unknown }) => taskDiffHash(r, intent.scope_hint),
				now: NOW,
			});
			expect(result).toEqual({ predecessor_phase: "stopped", successor_phase: "working" });

			const pred = readTaskRecordV2(root, PRED);
			expect(pred.record?.phase).toBe("stopped");
			const claim = readBackendClaim(root);
			expect(claim?.task_id).toBe(SUCC);
			expect(claim?.lifecycle_status).toBe("active");
			const succ = readTaskRecordV2(root, SUCC);
			expect(succ.record?.phase).toBe("working");
			expect(succ.record?.intent_ref.content_hash).toBe(canonicalIntentHash(input.successor_intent));
			const workspace = JSON.parse(readFileSync(join(root, ".imm", "workspace.json"), "utf8"));
			expect(workspace.current_working).toBe(SUCC);
			expect(existsSync(join(root, ".imm", "tasks", ".succession-transaction.json"))).toBe(false);
			expect(existsSync(join(root, ".imm", "tasks", `${PRED}.backend-claim.json`))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("succeeds when predecessor is in review phase and workspace current_working is null", () => {
		const { root, seedReplan } = makePredecessorRoot();
		try {
			// Shift predecessor phase to "review" and set current_working to null
			seedReplan();
			const predPath = join(root, ".imm", "tasks", `${PRED}.json`);
			const predContent = readFileSync(predPath, "utf8").replace(`"phase": "working"`, `"phase": "review"`);
			writeFileSync(predPath, predContent, "utf8");
			const wsPath = join(root, ".imm", "workspace.json");
			writeFileSync(wsPath, JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }), "utf8");

			const input = buildSucceedInput(root, () => {});
			const result = succeedCanaryTask({
				...input,
				diffProvider: (r: string, intent: { scope_hint: unknown }) => taskDiffHash(r, intent.scope_hint),
				now: NOW,
			});
			expect(result).toEqual({ predecessor_phase: "stopped", successor_phase: "working" });

			const pred = readTaskRecordV2(root, PRED);
			expect(pred.record?.phase).toBe("stopped");
			const claim = readBackendClaim(root);
			expect(claim?.task_id).toBe(SUCC);
			const workspace = JSON.parse(readFileSync(join(root, ".imm", "workspace.json"), "utf8"));
			expect(workspace.current_working).toBe(SUCC);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("precondition failures fail closed with zero writes", () => {
		const { root } = makePredecessorRoot();
		try {
			const input = buildSucceedInput(root, () => {});
			// No replan_required seeded -> the seedReplan override is a no-op.
			expect(() =>
				succeedCanaryTask({
					...input,
					diffProvider: (r: string, intent: { scope_hint: unknown }) => taskDiffHash(r, intent.scope_hint),
					now: NOW,
				}),
			).toThrow(/replan_required/);
			expect(readBackendClaim(root)?.task_id).toBe(PRED);
			expect(readTaskRecordV2(root, PRED).record?.phase).toBe("working");
			expect(readTaskRecordV2Raw(root, SUCC).record).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("crash recovery settles all-before (rollback) and all-after (completion)", () => {
		const { root, seedReplan } = makePredecessorRoot();
		try {
			const input = buildSucceedInput(root, seedReplan);
			const succIntentPath = join(root, "docs", "plans", `${SUCC}.intent.json`);
			const markerPath = join(root, ".imm", "tasks", ".succession-transaction.json");
			const predPath = join(root, ".imm", "tasks", `${PRED}.json`);
			const beforePred = readFileSync(predPath, "utf8");

			// Simulate a crash AFTER the marker write but BEFORE any file write:
			// only the marker exists.
			const marker = {
				contract: "assurance_kernel/succession_transaction/v1",
				predecessor_id: PRED,
				successor_id: SUCC,
				predecessor_before: beforePred,
				predecessor_after: beforePred.replace(`"phase": "working"`, `"phase": "stopped"`),
				successor_before: null,
				successor_after: "{}",
				workspace_before: readFileSync(join(root, ".imm", "workspace.json"), "utf8"),
				workspace_after: readFileSync(join(root, ".imm", "workspace.json"), "utf8"),
				claim_before: JSON.stringify(readBackendClaim(root)),
				claim_after: null,
				tombstone_before: null,
				tombstone_after: "{}",
				now: NOW,
			};
			writeFileSync(markerPath, JSON.stringify(marker, null, 2) + "\n");
			recoverPendingSuccessionLocked(root);
			// All-before: nothing was written -> predecessor unchanged, no marker.
			expect(readFileSync(predPath, "utf8")).toBe(beforePred);
			expect(existsSync(markerPath)).toBe(false);
			expect(readBackendClaim(root)?.task_id).toBe(PRED);

			// All-after: files already match the marker -> completion.
			const fullInput = buildSucceedInput(root, seedReplan);
			succeedCanaryTask({
				...fullInput,
				diffProvider: (r: string, intent: { scope_hint: unknown }) => taskDiffHash(r, intent.scope_hint),
				now: NOW,
			});
			expect(readTaskRecordV2(root, SUCC).record?.phase).toBe("working");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("imm-canary-succeed command surface", () => {
	test("cancel before commit performs zero writes", async () => {
		const { root, seedReplan } = makePredecessorRoot();
		try {
			seedReplan();
			const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
			registerSucceedCommand({
				registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
					commands[name] = spec;
				},
			} as never);
			let confirmed = false;
			const notifies: string[] = [];
			const ctx = {
				mode: "tui",
				cwd: root,
				signal: new AbortController().signal,
				ui: {
					confirm: async () => confirmed,
					notify: (text: string) => notifies.push(text),
				},
			};
			await commands["imm-canary-succeed"].handler(PRED, ctx);
			expect(notifies.some((n) => /zero writes/i.test(n))).toBe(true);
			expect(existsSync(join(root, "docs", "plans", `${SUCC}.intent.json`))).toBe(false);
			expect(readTaskRecordV2(root, PRED).record?.phase).toBe("working");
			expect(readBackendClaim(root)?.task_id).toBe(PRED);
			expect(existsSync(join(root, ".imm", "tasks", ".succession-transaction.json"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("non-TUI modes reject before any mutation", async () => {
		const { root } = makePredecessorRoot();
		try {
			const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
			registerSucceedCommand({
				registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
					commands[name] = spec;
				},
			} as never);
			const notifies: string[] = [];
			await commands["imm-canary-succeed"].handler(PRED, {
				mode: "rpc",
				cwd: root,
				ui: { notify: (text: string) => notifies.push(text) },
			});
			expect(notifies.some((n) => /TUI-only/i.test(n))).toBe(true);
			expect(readTaskRecordV2(root, PRED).record?.phase).toBe("working");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
