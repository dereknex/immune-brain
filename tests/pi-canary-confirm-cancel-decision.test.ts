// 2026-08-16-008 acc-cancel-decision-trail.
// A cancelled literal-user confirmation records exactly one durable
// unresolved_user_decision finding bound to the operation and snapshot
// digest, without applying the underlying verdict or approval; repeated
// cancels deduplicate; resolve-user-decision closes the decision trail and
// survives session restart (kernel state, not session memory).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordCancelledUserDecision, buildUserDecisionOperation } from "../plugins/immune-brain/.pi-extension/imm-canary-work.ts";
import { capabilityActionFor, createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";

const TASK = "canary-decision-trail-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "decision trail",
	acceptance: [{ id: "A1", assertion: "a1", verification: "true" }],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "b".repeat(64);
const NOW = "2026-08-16T10:00:00.000Z";

function makeReviewRoot(): { root: string; app: ReturnType<typeof createCanaryApplication>; registry: ReturnType<typeof createMutationAuthorityRegistry> } {
	const root = mkdtempSync(join(tmpdir(), "dec-trail-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(
		join(root, ".imm", "workspace.json"),
		JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2) + "\n",
	);
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
			now: NOW,
		},
		registry,
	);
	const mutationRegistry = createMutationAuthorityRegistry();
	const app = createCanaryApplication(mutationRegistry);
	const token = () => readTaskIntent(root, TASK).token;
	app.execute({
		root,
		task_id: TASK,
		operation: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "ok", actor_id: "executor-1" },
		prior_intent_token: token(),
		diffProvider: () => DIFF,
		now: NOW,
	});
	app.execute({
		root,
		task_id: TASK,
		operation: { op: "submit_review", actor_id: "executor-1" },
		prior_intent_token: token(),
		diffProvider: () => DIFF,
		now: NOW,
	});
	return { root, app, registry: mutationRegistry };
}

function openUserDecisions(root: string) {
	const record = readTaskRecordV2(root, TASK);
	return record.record?.findings.filter(
		(f) => f.kind === "unresolved_user_decision" && f.status === "open",
	) ?? [];
}

function applyResolve(
	root: string,
	app: ReturnType<typeof createCanaryApplication>,
	registry: ReturnType<typeof createMutationAuthorityRegistry>,
	findingId: string,
) {
	const record = readTaskRecordV2(root, TASK);
	const action = capabilityActionFor({
		op: "resolve_user_decision",
		task_id: TASK,
		at: NOW,
		actor_id: "literal-user",
		finding_id: findingId,
		resolution: `resume after literal-user decision: test`,
	});
	const capability = createMutationAuthorityCapabilityForTest(registry, {
		authority_kind: "user",
		task_id: TASK,
		action_digest: digestOfAction(action as never),
		expected_record_hash: record.revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "literal-user",
		confirmation_ref: "conf-resolve",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
	});
	app.execute({
		root,
		task_id: TASK,
		operation: {
			op: "resolve_user_decision",
			capability,
			finding_id: findingId,
			resolution: `resume after literal-user decision: test`,
			actor_id: "literal-user",
		} as never,
		prior_intent_token: readTaskIntent(root, TASK).token,
		diffProvider: () => DIFF,
		now: NOW,
	});
}

describe("cancelled confirmation decision trail", () => {
	test("recordCancelledUserDecision records exactly one open kernel finding bound to operation and snapshot", async () => {
		const { root, app } = makeReviewRoot();
		try {
			const ctx = { cwd: root } as never;
			const first = await recordCancelledUserDecision(ctx, TASK, "record-review-verdict", "sha256:snap");
			expect(first).toEqual({ recorded: true, finding_id: "user-decision-record-review-verdict" });
			let open = openUserDecisions(root);
			expect(open).toHaveLength(1);
			expect(open[0].id).toBe("user-decision-record-review-verdict");
			expect(open[0].source).toBe("kernel");
			expect(open[0].summary).toContain("record-review-verdict confirmation cancelled");
			expect(open[0].summary).toContain("sha256:snap");
			// Repeated cancel deduplicates onto the same open decision.
			const second = await recordCancelledUserDecision(ctx, TASK, "record-review-verdict", "sha256:snap");
			expect(second).toEqual({ recorded: false, finding_id: "user-decision-record-review-verdict" });
			open = openUserDecisions(root);
			expect(open).toHaveLength(1);
			// The underlying review approval was never applied.
			const record = readTaskRecordV2(root, TASK);
			expect(record.record?.approvals.filter((a) => a.kind === "review")).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("non-canonical user decision ids are rejected by the kernel", async () => {
		const { root, app } = makeReviewRoot();
		try {
			const ctx = { cwd: root } as never;
			await expect(
				recordCancelledUserDecision(ctx, TASK, "../evil", "sha256:snap"),
			).rejects.toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("buildUserDecisionOperation derives the exact open decision and resolve closes it durably", async () => {
		const { root, app, registry } = makeReviewRoot();
		try {
			await recordCancelledUserDecision({ cwd: root } as never, TASK, "record-review-verdict", "sha256:snap");
			// Session "restart": a fresh operation builder reads only kernel state.
			const op = buildUserDecisionOperation(readTaskRecordV2(root, TASK).record!);
			expect(op.op).toBe("resolve_user_decision");
			expect(op.resolution).toContain("resume after literal-user decision");
			applyResolve(root, app, registry, op.finding_id);
			const record = readTaskRecordV2(root, TASK);
			const finding = record.record?.findings.find((f) => f.id === op.finding_id);
			expect(finding?.status).toBe("resolved");
			expect(openUserDecisions(root)).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
