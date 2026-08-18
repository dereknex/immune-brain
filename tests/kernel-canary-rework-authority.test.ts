// P2B2 U1: request_rework Kernel authority. Covers direct request_rework
// rejection without a consumed QA/review capability, normalized findings
// digest binding, review/qa/user acceptance, and rework->working
// with review_round and escalation behavior.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createCanaryApplication,
	type CanaryOperation,
} from "../plugins/immune-brain/runtime/kernel/canary_application";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { findingsDigestV2 } from "../plugins/immune-brain/runtime/kernel/reducer_v2";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";

const TASK = "canary-rework-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "rework authority",
	acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
	scope_hint: ["plugins/immune-brain/runtime/kernel"],
	risk: "material",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "c".repeat(64);

let root: string;
let mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>;
let app: ReturnType<typeof createCanaryApplication>;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-rework-"));
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
		JSON.stringify(
			{ contract: "assurance_kernel/workspace/v1", current_working: null },
			null,
			2,
		) + "\n",
	);
	const enrollmentRegistry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: prep.digest,
		readiness_digest: "sha256:readiness",
		evidence_digest: "sha256:evidence",
		waiver_gate: "observation_window_days",
		actor_id: "user",
		confirmation_ref: "pi-confirm-enroll",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "nonce-enroll",
	};
	enrollCanaryTask(
		root,
		{
			task_id: TASK,
			intent_path: `docs/plans/${TASK}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			capability: enrollmentRegistry.issue(binding),
			capability_binding: binding,
			now: "2026-08-12T10:00:00.000Z",
		},
		enrollmentRegistry,
	);
	mutationRegistry = createMutationAuthorityRegistry();
	app = createCanaryApplication(mutationRegistry);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function token() {
	return readTaskIntent(root, TASK).token;
}

function execute(op: CanaryOperation, at: string) {
	return app.execute({
		root,
		task_id: TASK,
		operation: op,
		prior_intent_token: token(),
		diffProvider: () => DIFF,
		now: at,
	});
}

/** Bring the task into review phase with one recorded evidence item. */
function toReview() {
	execute(
		{ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "one", actor_id: "executor-1" },
		"2026-08-12T10:00:01.000Z",
	);
	execute({ op: "submit_review", actor_id: "executor-1" }, "2026-08-12T10:00:02.000Z");
}

const FINDINGS = [
	{
		id: "rw-1",
		kind: "blocking",
		status: "open",
		acceptance_id: "A1",
		source: "review",
		review_round: null,
		summary: "evidence does not satisfy the assertion",
	},
] as const;

function reworkCapability(kind: "review" | "qa" | "user", overrides: Record<string, unknown> = {}) {
	const record = readTaskRecordV2(root, TASK);
	const findings = [...FINDINGS] as never[];
	const actorId = kind === "user" ? "literal-user" : "reviewer-1";
	const action = {
		type: "request_rework",
		event_id: `request_rework:${TASK}:2026-08-12T10:00:03.000Z`,
		at: "2026-08-12T10:00:03.000Z",
		actor_id: actorId,
		expected_record_hash: undefined,
		expected_workspace_hash: undefined,
		diff_hash: undefined,
		findings,
	} as Record<string, unknown>;
	const digest = (a: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(a)).digest("hex");
	return createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: kind,
		task_id: TASK,
		action_digest: digest(action),
		expected_record_hash: record.revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: actorId,
		confirmation_ref: "conf-rework",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: findingsDigestV2([...FINDINGS] as never[]),
		...overrides,
	});
}

describe("request_rework authority", () => {
	test("direct request_rework without capability is rejected with zero writes", () => {
		toReview();
		expect(() =>
			execute(
				{ op: "request_rework", capability: {}, findings: [...FINDINGS] as never[], actor_id: "executor-1" },
				"2026-08-12T10:00:03.000Z",
			),
		).toThrow(/capability|authority/i);
		const record = readTaskRecordV2(root, TASK);
		expect(record.record?.phase).toBe("review");
		expect(record.record?.findings).toHaveLength(0);
	});

	test("user capability requests rework without reviewer escalation", () => {
		toReview();
		const cap = reworkCapability("user");
		const result = execute(
			{ op: "request_rework", capability: cap, findings: [...FINDINGS] as never[], actor_id: "literal-user" },
			"2026-08-12T10:00:03.000Z",
		);
		expect(result.record.phase).toBe("working");
		expect(result.record.findings[0].summary).toBe(FINDINGS[0].summary);
		expect(result.record.history.at(-1)?.authority?.authority_kind).toBe("user");
		expect(mutationRegistry.isConsumed(cap)).toBe(true);
	});

	test("review capability applies normalized findings and moves to working", () => {
		toReview();
		const cap = reworkCapability("review");
		const result = execute(
			{ op: "request_rework", capability: cap, findings: [...FINDINGS] as never[], actor_id: "reviewer-1" },
			"2026-08-12T10:00:03.000Z",
		);
		expect(result.record.phase).toBe("working");
		expect(result.record.findings).toHaveLength(1);
		expect(result.record.findings[0].source).toBe("review");
		expect(result.record.findings[0].review_round).toBe(1);
		expect(mutationRegistry.isConsumed(cap)).toBe(true);
	});

	test("qa capability applies rework findings", () => {
		toReview();
		const cap = reworkCapability("qa");
		const result = execute(
			{ op: "request_rework", capability: cap, findings: [...FINDINGS] as never[], actor_id: "reviewer-1" },
			"2026-08-12T10:00:03.000Z",
		);
		expect(result.record.phase).toBe("working");
		expect(result.record.findings[0].id).toBe("rw-1");
	});

	test("findings digest mismatch is rejected without consuming", () => {
		toReview();
		const cap = reworkCapability("review", {
			findings_digest: `sha256:${"e".repeat(64)}`,
		});
		expect(() =>
			execute(
				{ op: "request_rework", capability: cap, findings: [...FINDINGS] as never[], actor_id: "reviewer-1" },
				"2026-08-12T10:00:03.000Z",
			),
		).toThrow(/findings digest mismatch/i);
		expect(mutationRegistry.isConsumed(cap)).toBe(false);
	});

	test("capability bound to different findings is rejected", () => {
		toReview();
		const cap = reworkCapability("review");
		const otherFindings = [
			{ id: "rw-other", kind: "blocking", status: "open", acceptance_id: "A1", source: "review", review_round: null, summary: "different" },
		];
		expect(() =>
			execute(
				{ op: "request_rework", capability: cap, findings: otherFindings as never[], actor_id: "reviewer-1" },
				"2026-08-12T10:00:03.000Z",
			),
		).toThrow(/digest mismatch/i);
		expect(mutationRegistry.isConsumed(cap)).toBe(false);
	});

	test("second Review rework parks on a replan boundary", () => {
		toReview();
		const cap1 = reworkCapability("review");
		execute(
			{ op: "request_rework", capability: cap1, findings: [...FINDINGS] as never[], actor_id: "reviewer-1" },
			"2026-08-12T10:00:03.000Z",
		);
		// Re-submit and re-review: round 2 escalates.
		execute({ op: "submit_review", actor_id: "executor-1" }, "2026-08-12T10:00:04.000Z");
		const secondFindings = [
			{
				id: "rw-2",
				kind: "blocking",
				status: "open",
				acceptance_id: "A1",
				source: "review",
				review_round: null,
				summary: "still not satisfied",
			},
		];
		const cap2 = reworkCapability("review", {
			action_digest: createHash("sha256")
				.update(
					JSON.stringify({
						type: "request_rework",
						event_id: `request_rework:${TASK}:2026-08-12T10:00:05.000Z`,
						at: "2026-08-12T10:00:05.000Z",
						actor_id: "reviewer-1",
						findings: secondFindings,
					}),
				)
				.digest("hex"),
			findings_digest: findingsDigestV2(secondFindings as never[]),
		});
		const result = execute(
			{ op: "request_rework", capability: cap2, findings: secondFindings as never[], actor_id: "reviewer-1" },
			"2026-08-12T10:00:05.000Z",
		);
		expect(result.record.phase).toBe("review");
		const boundary = result.record.findings.find(
			(f) => f.kind === "replan_required",
		);
		expect(boundary).toBeDefined();
		expect(boundary?.review_round).toBe(2);
		expect(result.record.findings.some((f) => f.kind === "unresolved_user_decision")).toBe(false);
	});

	test("QA rework after a Review rework does not write replan_required", () => {
		toReview();
		execute(
			{ op: "request_rework", capability: reworkCapability("review"), findings: [...FINDINGS] as never[], actor_id: "reviewer-1" },
			"2026-08-12T10:00:03.000Z",
		);
		execute({ op: "submit_review", actor_id: "executor-1" }, "2026-08-12T10:00:04.000Z");
		const qaFindings = [
			{
				id: "qa-2",
				kind: "blocking",
				status: "open",
				acceptance_id: "A1",
				source: "review",
				review_round: null,
				summary: "qa still failing",
			},
		];
		const cap = reworkCapability("qa", {
			action_digest: createHash("sha256")
				.update(
					JSON.stringify({
						type: "request_rework",
						event_id: `request_rework:${TASK}:2026-08-12T10:00:05.000Z`,
						at: "2026-08-12T10:00:05.000Z",
						actor_id: "reviewer-1",
						findings: qaFindings,
					}),
				)
				.digest("hex"),
			findings_digest: findingsDigestV2(qaFindings as never[]),
		});
		const result = execute(
			{ op: "request_rework", capability: cap, findings: qaFindings as never[], actor_id: "reviewer-1" },
			"2026-08-12T10:00:05.000Z",
		);
		expect(result.record.phase).toBe("working");
		expect(result.record.findings.some((f) => f.kind === "replan_required")).toBe(false);
	});
});
