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
	capabilityActionFor,
	createCanaryApplication,
	type CanaryOperation,
} from "../plugins/immune-brain/runtime/kernel/canary_application";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { findingsDigestV2, REVIEW_REWORK_ROUND_BUDGET } from "../plugins/immune-brain/runtime/kernel/reducer";
import { anchorForEvidence } from "../plugins/immune-brain/runtime/kernel/refutation";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { captureReviewManifest } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import { taskRevisionDiffHash } from "../plugins/immune-brain/runtime/workspace_scope";

const TASK = "canary-rework-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "rework authority",
	acceptance: [
		{ id: "A1", assertion: "a1", verification: "v1" },
		{ id: "A2", assertion: "a2", verification: "v2" },
	],
	scope_hint: [
		"src/task.ts",
		`docs/specs/${TASK}.spec.md`,
		`docs/specs/archive/${TASK}.spec.md`,
	],
	risk: "material",
	revision: 1,
	owner: "user",
} as const;
const DIFF = "sha256:" + "c".repeat(64);

let root: string;
let mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>;
let app: ReturnType<typeof createCanaryApplication>;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-rework-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "docs", "specs", "archive"), { recursive: true });
	writeFileSync(join(root, "src", "task.ts"), "export {};\n");
	writeFileSync(join(root, "docs", "specs", `${TASK}.spec.md`), "# Rework authority\n");
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	// The Kernel hashes the parsed (deduped, sorted) scope_hint, not the raw
	// fixture literal, so the capability binding must use the same
	// content_hash enrollment recomputes inside the store lock.
	const intentHash = readTaskIntent(root, TASK).content_hash;
	const enrollmentRegistry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: intentHash,
		preparation_digest: prep.digest,
		actor_id: "user",
		confirmation_ref: "pi-confirm-enroll",
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
	const record = readTaskRecordRaw(root, TASK).record;
	return readTaskIntent(root, TASK, record?.intent_ref.path).token;
}

function currentIntentHash() {
	return readTaskRecordRaw(root, TASK).record!.intent_ref.content_hash;
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

/** Freeze the artifact snapshot and atomically settle QA. */
function toReview(at = "2026-08-12T10:00:02.000Z") {
	execFileSync("git", ["add", "-A"], { cwd: root });
	execute({ op: "freeze_artifacts", actor_id: "executor-1" }, at);
	execFileSync("git", ["add", "-A"], { cwd: root });
	const approval = {
		id: `ap-qa-${at}`,
		kind: "qa",
		authority_role: "qa",
		task_revision: 1,
		intent_content_hash: currentIntentHash(),
		diff_hash: DIFF,
		actor_id: "qa-1",
		summary: "descriptor passed",
	};
	const action = capabilityActionFor({ op: "record_approval", task_id: TASK, at, actor_id: "qa-1", approval });
	const capability = createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: "qa",
		task_id: TASK,
		action_digest: digestOfAction(action),
		expected_record_hash: readTaskRecordRaw(root, TASK).revision,
		intent_revision: 1,
		intent_content_hash: currentIntentHash(),
		diff_hash: DIFF,
		actor_id: "qa-1",
		confirmation_ref: "conf-qa",
		findings_digest: null,
	});
	return execute({ op: "record_approval", approval, capability, actor_id: "qa-1" }, at);
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

const REVIEW_AT = "2026-08-12T10:00:02.000Z";
const QA_ATTESTATION_ID = `ap-qa-${REVIEW_AT}`;
const REVIEW_EVIDENCE = {
	trigger: "the shared boundary matcher accepts an unrelated acceptance",
	caller_chain: ["runtime/kernel/reducer.ts", "sharesAcceptanceBoundary()"],
	violated: { kind: "acceptance", ref: "A1" },
};
// A second claim on the same acceptance, with its own derived anchor.
const OTHER_EVIDENCE = {
	...REVIEW_EVIDENCE,
	caller_chain: ["runtime/kernel/completion.ts"],
};
const ANCHOR = anchorForEvidence(REVIEW_EVIDENCE as never);
const OTHER_ANCHOR = anchorForEvidence(OTHER_EVIDENCE as never);

function reviewFinding(overrides: Record<string, unknown>) {
	return {
		id: "rw-1",
		kind: "blocking",
		status: "open",
		acceptance_id: "A1",
		source: "review",
		review_round: null,
		summary: "review finding",
		...overrides,
	};
}

function reworkCapability(kind: "review" | "qa" | "user", overrides: Record<string, unknown> = {}) {
	const record = readTaskRecordRaw(root, TASK);
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
		intent_content_hash: currentIntentHash(),
		diff_hash: DIFF,
		actor_id: actorId,
		confirmation_ref: "conf-rework",
		findings_digest: findingsDigestV2([...FINDINGS] as never[]),
		...overrides,
	});
}

function reviewRevision(overrides: Record<string, string> = {}) {
	return {
		contract: "assurance_kernel/review_revision_identity/v1" as const,
		base_head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
		review_commit: "c".repeat(40),
		review_tree: "d".repeat(40),
		manifest_digest: "sha256:" + "e".repeat(64),
		...overrides,
	};
}

function requestReviewRework(
	findings: Record<string, unknown>[],
	at: string,
	revision?: ReturnType<typeof reviewRevision>,
	authority: "review" | "qa" | "user" = "review",
) {
	const action = capabilityActionFor({
		op: "request_rework",
		task_id: TASK,
		at,
		actor_id: "reviewer-1",
		findings: findings as never[],
		...(revision ? { review_revision: revision } : {}),
	});
	const capability = createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: authority,
		task_id: TASK,
		action_digest: digestOfAction(action),
		expected_record_hash: readTaskRecordRaw(root, TASK).revision,
		intent_revision: 1,
		intent_content_hash: currentIntentHash(),
		diff_hash: DIFF,
		actor_id: "reviewer-1",
		confirmation_ref: `conf-${at}`,
		findings_digest: findingsDigestV2(findings as never[]),
	});
	return execute(
		{
			op: "request_rework",
			capability,
			findings: findings as never[],
			actor_id: "reviewer-1",
			...(revision ? { review_revision: revision } : {}),
		},
		at,
	);
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
		const record = readTaskRecordRaw(root, TASK);
		expect(record.record).toMatchObject({ lifecycle: "active", artifact_state: "frozen" });
		expect(record.record?.findings).toHaveLength(0);
	});

	test("user capability requests rework without reviewer escalation", () => {
		toReview();
		const cap = reworkCapability("user");
		const result = execute(
			{ op: "request_rework", capability: cap, findings: [...FINDINGS] as never[], actor_id: "literal-user" },
			"2026-08-12T10:00:03.000Z",
		);
		expect(result.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
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
		expect(result.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
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
		expect(result.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
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

	const acceptanceFinding = (id: string, evidence: typeof REVIEW_EVIDENCE) =>
		reviewFinding({ id, anchor: anchorForEvidence(evidence as never), evidence });
	const SECURITY_EVIDENCE = {
		trigger: "the descriptor writes outside the authorized directory",
		caller_chain: ["runtime/kernel/enrollment.ts", "enrollCanaryTask()"],
		violated: { kind: "security_boundary", ref: "boundary:authorization" },
	} as const;

	test("a repeated blocking defect on a covered acceptance returns to execution without a user gate", () => {
		toReview();
		const first = requestReviewRework(
			[acceptanceFinding("rw-accept-1", REVIEW_EVIDENCE)],
			"2026-08-12T10:00:03.000Z",
		);
		expect(first.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
		expect(first.record.findings.some((f) => f.kind === "replan_required")).toBe(false);
		toReview("2026-08-12T10:00:04.000Z");
		const second = requestReviewRework(
			[acceptanceFinding("rw-accept-2", OTHER_EVIDENCE)],
			"2026-08-12T10:00:05.000Z",
		);
		expect(second.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
		expect(second.record.findings.some((f) => f.kind === "replan_required")).toBe(false);
		expect(second.record.findings.find((f) => f.id === "rw-accept-2")?.status).toBe("open");
	});

	test("ordinary rework pauses once the review round budget is exhausted", () => {
		const rounds: number[] = [];
		for (let round = 1; round <= REVIEW_REWORK_ROUND_BUDGET + 1; round += 1) {
			toReview(`2026-08-12T11:00:0${round}.000Z`);
			const finding = reviewFinding({
				id: `rw-budget-${round}`,
				anchor: anchorForEvidence(REVIEW_EVIDENCE as never),
				evidence: REVIEW_EVIDENCE,
			});
			const result = requestReviewRework([finding], `2026-08-12T11:01:0${round}.000Z`);
			const parked = result.record.findings.some((f) => f.kind === "replan_required" && f.status === "open");
			if (parked) rounds.push(round);
		}
		expect(rounds).toEqual([REVIEW_REWORK_ROUND_BUDGET + 1]);
	});

	test("a repeated security boundary parks on a replan boundary", () => {
		const security = (id: string) =>
			reviewFinding({
				id,
				acceptance_id: null,
				anchor: anchorForEvidence(SECURITY_EVIDENCE as never),
				evidence: SECURITY_EVIDENCE,
			});
		toReview();
		const first = requestReviewRework([security("rw-boundary-1")], "2026-08-12T10:00:03.000Z");
		expect(first.record.findings.some((f) => f.kind === "replan_required")).toBe(false);
		toReview("2026-08-12T10:00:04.000Z");
		const second = requestReviewRework([security("rw-boundary-2")], "2026-08-12T10:00:05.000Z");
		const boundary = second.record.findings.find((f) => f.kind === "replan_required");
		expect(boundary).toBeDefined();
		expect(boundary?.review_round).toBe(2);
		expect(second.record.findings.some((f) => f.kind === "unresolved_user_decision")).toBe(false);
		execFileSync("git", ["add", "-A"], { cwd: root });

		const authorizedAt = "2026-08-12T10:00:06.000Z";
		const authorizeAction = capabilityActionFor({
			op: "authorize_rework",
			task_id: TASK,
			at: authorizedAt,
			actor_id: "literal-user",
		});
		const authorizeCapability = createMutationAuthorityCapabilityForTest(mutationRegistry, {
			authority_kind: "user",
			task_id: TASK,
			action_digest: digestOfAction(authorizeAction),
			expected_record_hash: readTaskRecordRaw(root, TASK).revision,
			intent_revision: 1,
			intent_content_hash: currentIntentHash(),
			diff_hash: DIFF,
			actor_id: "literal-user",
			confirmation_ref: "confirm-authorize-rework",
			findings_digest: null,
		});
		const resumed = execute(
			{ op: "authorize_rework", capability: authorizeCapability, actor_id: "literal-user" },
			authorizedAt,
		);
		expect(resumed.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
		expect(resumed.record.findings.find((f) => f.kind === "replan_required")?.status).toBe("resolved");
		expect(resumed.record.findings.find((f) => f.id === "rw-boundary-2")?.status).toBe("open");
		expect(resumed.record.history.at(-1)?.authority?.authority_kind).toBe("user");
	});

	test("repeating a live-refuted claim never exhausts the rework budget", () => {
		toReview();
		requestReviewRework(
			[reviewFinding({ id: "rw-refuted-base", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:03.000Z",
		);
		execFileSync("git", ["add", "-A"], { cwd: root });
		execute(
			{ op: "refute_finding", finding_id: "rw-refuted-base", attestation_id: QA_ATTESTATION_ID, actor_id: "executor-1" },
			"2026-08-12T10:00:03.500Z",
		);
		let parked = false;
		for (let round = 1; round <= REVIEW_REWORK_ROUND_BUDGET + 2; round += 1) {
			toReview(`2026-08-12T12:00:0${round}.000Z`);
			const repeat = requestReviewRework(
				[reviewFinding({ id: `rw-refuted-${round}`, anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
				`2026-08-12T12:01:0${round}.000Z`,
			);
			expect(repeat.record.findings.find((finding) => finding.id === `rw-refuted-${round}`)?.status).toBe("refuted");
			if (repeat.record.findings.some((finding) => finding.kind === "replan_required" && finding.status === "open"))
				parked = true;
		}
		expect(parked).toBe(false);
	});

	test("a repeated advisory Review does not force a replan", () => {
		const advisory = (id: string) => [{
			id,
			kind: "advisory",
			status: "open",
			acceptance_id: null,
			source: "review",
			review_round: null,
			summary: "non-blocking provenance note",
		}];
		toReview();
		requestReviewRework(advisory("rw-advisory-1"), "2026-08-12T10:00:03.000Z");
		toReview("2026-08-12T10:00:04.000Z");
		const result = requestReviewRework(advisory("rw-advisory-2"), "2026-08-12T10:00:05.000Z");
		expect(result.record.findings.some((finding) => finding.kind === "replan_required")).toBe(false);
		expect(result.record.findings.find((finding) => finding.id === "rw-advisory-2")?.kind).toBe("advisory");
	});

	test("an advisory Review followed by the first blocking Review does not force a replan", () => {
		toReview();
		requestReviewRework([{
			id: "rw-advisory-first",
			kind: "advisory",
			status: "open",
			acceptance_id: null,
			source: "review",
			review_round: null,
			summary: "advisory first",
		}], "2026-08-12T10:00:03.000Z");
		toReview("2026-08-12T10:00:04.000Z");
		const result = requestReviewRework([{
			...FINDINGS[0],
			id: "rw-first-blocking",
		}], "2026-08-12T10:00:05.000Z");
		expect(result.record.findings.some((finding) => finding.kind === "replan_required")).toBe(false);
		expect(result.record.findings.find((finding) => finding.id === "rw-first-blocking")?.kind).toBe("blocking");
	});

	test("a QA blocking rework followed by the first blocking Review does not force a replan", () => {
		toReview();
		const qaResult = execute(
			{ op: "request_rework", capability: reworkCapability("qa"), findings: [...FINDINGS] as never[], actor_id: "reviewer-1" },
			"2026-08-12T10:00:03.000Z",
		);
		expect(qaResult.record.findings.find((finding) => finding.id === "rw-1")).toMatchObject({
			source: "execution",
			review_round: null,
		});
		toReview("2026-08-12T10:00:04.000Z");
		const result = requestReviewRework([{
			...FINDINGS[0],
			id: "rw-first-review-blocking",
		}], "2026-08-12T10:00:05.000Z");
		expect(result.record.findings.some((finding) => finding.kind === "replan_required")).toBe(false);
		expect(result.record.findings.find((finding) => finding.id === "rw-first-review-blocking")?.review_round).toBe(1);
	});

	test("QA rework after a Review rework does not write replan_required", () => {
		toReview();
		execute(
			{ op: "request_rework", capability: reworkCapability("review"), findings: [...FINDINGS] as never[], actor_id: "reviewer-1" },
			"2026-08-12T10:00:03.000Z",
		);
		toReview("2026-08-12T10:00:04.000Z");
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
		expect(result.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
		expect(result.record.findings.some((f) => f.kind === "replan_required")).toBe(false);
	});

	test("a second-round blocking Review on a different acceptance boundary does not park", () => {
		toReview();
		requestReviewRework([
			reviewFinding({ id: "rw-a1", acceptance_id: "A1" }),
		], "2026-08-12T10:00:03.000Z");
		toReview("2026-08-12T10:00:04.000Z");
		const result = requestReviewRework([
			reviewFinding({ id: "rw-a2", acceptance_id: "A2" }),
		], "2026-08-12T10:00:05.000Z");
		expect(result.record.findings.some((finding) => finding.kind === "replan_required")).toBe(false);
		expect(result.record.findings.find((finding) => finding.id === "rw-a2")?.status).toBe("open");
	});

	test("null acceptance boundaries park only on the same violated ref", () => {
		const nullFinding = (id: string, ref: string) => {
			const evidence = { ...REVIEW_EVIDENCE, violated: { kind: "security_boundary", ref } };
			return reviewFinding({
				id,
				acceptance_id: null,
				anchor: anchorForEvidence(evidence as never),
				evidence,
			});
		};
		toReview();
		requestReviewRework([nullFinding("rw-null-1", "boundary:parse")], "2026-08-12T10:00:03.000Z");
		toReview("2026-08-12T10:00:04.000Z");
		const unrelated = requestReviewRework([nullFinding("rw-null-2", "boundary:render")], "2026-08-12T10:00:05.000Z");
		expect(unrelated.record.findings.some((finding) => finding.kind === "replan_required")).toBe(false);
		toReview("2026-08-12T10:00:06.000Z");
		const related = requestReviewRework([nullFinding("rw-null-3", "boundary:parse")], "2026-08-12T10:00:07.000Z");
		expect(related.record.findings.some((finding) => finding.kind === "replan_required")).toBe(true);
	});

	test("request_rework inherits counterevidence only from a live anchor match", () => {
		toReview();
		requestReviewRework(
			[reviewFinding({ id: "rw-refuted", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:03.000Z",
		);
		execFileSync("git", ["add", "-A"], { cwd: root });
		const refuted = execute(
			{ op: "refute_finding", finding_id: "rw-refuted", attestation_id: QA_ATTESTATION_ID, actor_id: "executor-1" },
			"2026-08-12T10:00:03.500Z",
		);
		expect(refuted.record.findings.find((finding) => finding.id === "rw-refuted")).toMatchObject({
			status: "refuted",
			counterevidence: { attestation_id: QA_ATTESTATION_ID, acceptance_id: "A1" },
		});
		toReview("2026-08-12T10:00:04.000Z");
		const repeat = requestReviewRework(
			[reviewFinding({ id: "rw-repeat", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:05.000Z",
		);
		expect(repeat.record.findings.find((finding) => finding.id === "rw-repeat")).toMatchObject({
			status: "refuted",
			counterevidence: { attestation_id: QA_ATTESTATION_ID, acceptance_id: "A1" },
		});
		expect(repeat.record.findings.some((finding) => finding.kind === "replan_required")).toBe(false);
	});

	test("a different anchor is admitted open even when a refutation exists", () => {
		toReview();
		requestReviewRework(
			[reviewFinding({ id: "rw-refuted", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:03.000Z",
		);
		execFileSync("git", ["add", "-A"], { cwd: root });
		execute(
			{ op: "refute_finding", finding_id: "rw-refuted", attestation_id: QA_ATTESTATION_ID, actor_id: "executor-1" },
			"2026-08-12T10:00:03.500Z",
		);
		toReview("2026-08-12T10:00:04.000Z");
		const result = requestReviewRework(
			[reviewFinding({ id: "rw-new", anchor: OTHER_ANCHOR, evidence: OTHER_EVIDENCE })],
			"2026-08-12T10:00:05.000Z",
		);
		expect(result.record.findings.find((finding) => finding.id === "rw-new")?.status).toBe("open");
	});

	test("a live refutation resets the replan boundary for its acceptance", () => {
		toReview();
		requestReviewRework(
			[reviewFinding({ id: "rw-refuted", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:03.000Z",
		);
		execFileSync("git", ["add", "-A"], { cwd: root });
		execute(
			{ op: "refute_finding", finding_id: "rw-refuted", attestation_id: QA_ATTESTATION_ID, actor_id: "executor-1" },
			"2026-08-12T10:00:03.500Z",
		);
		toReview("2026-08-12T10:00:04.000Z");
		// A prior finding that is still refuted by live evidence is not an
		// outstanding dispute, so a different claim on the same acceptance is
		// not a repeat offence and does not park the task.
		const result = requestReviewRework(
			[reviewFinding({ id: "rw-new", anchor: OTHER_ANCHOR, evidence: OTHER_EVIDENCE })],
			"2026-08-12T10:00:05.000Z",
		);
		expect(result.record.findings.some((finding) => finding.kind === "replan_required")).toBe(false);
		expect(result.record.findings.find((finding) => finding.id === "rw-new")?.status).toBe("open");
	});

	test("an advisory finding inherits a live refutation for the same claim", () => {
		toReview();
		requestReviewRework(
			[reviewFinding({ id: "rw-refuted", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:03.000Z",
		);
		execFileSync("git", ["add", "-A"], { cwd: root });
		execute(
			{ op: "refute_finding", finding_id: "rw-refuted", attestation_id: QA_ATTESTATION_ID, actor_id: "executor-1" },
			"2026-08-12T10:00:03.500Z",
		);
		toReview("2026-08-12T10:00:04.000Z");
		const result = requestReviewRework(
			[reviewFinding({ id: "rw-advisory-repeat", kind: "advisory", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:05.000Z",
		);
		expect(result.record.findings.find((finding) => finding.id === "rw-advisory-repeat")).toMatchObject({
			status: "refuted",
			counterevidence: { attestation_id: QA_ATTESTATION_ID, acceptance_id: "A1" },
		});
	});

	test("request_rework rejects an anchor that is not the digest of its own evidence", () => {
		toReview();
		// The anchor decides whether this claim inherits a refutation, so a
		// caller cannot bind it to evidence it does not describe...
		expect(() =>
			requestReviewRework(
				[reviewFinding({ id: "rw-forged", anchor: ANCHOR, evidence: OTHER_EVIDENCE })],
				"2026-08-12T10:00:03.000Z",
			),
		).toThrow();
		// ...and anchor and evidence must travel together.
		expect(() =>
			requestReviewRework(
				[reviewFinding({ id: "rw-orphan", anchor: ANCHOR })],
				"2026-08-12T10:00:03.000Z",
			),
		).toThrow();
	});

	test("a re-reported claim inherits the refutation across acceptance metadata", () => {
		toReview();
		requestReviewRework(
			[reviewFinding({ id: "rw-refuted", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:03.000Z",
		);
		execFileSync("git", ["add", "-A"], { cwd: root });
		execute(
			{ op: "refute_finding", finding_id: "rw-refuted", attestation_id: QA_ATTESTATION_ID, actor_id: "executor-1" },
			"2026-08-12T10:00:03.500Z",
		);
		toReview("2026-08-12T10:00:04.000Z");
		// The anchor is the claim identity; the acceptance label it is re-reported
		// under does not change the claim, so the inherited binding keeps the
		// acceptance its QA evidence was actually proved on.
		const result = requestReviewRework(
			[reviewFinding({ id: "rw-same-claim", acceptance_id: "A2", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })],
			"2026-08-12T10:00:05.000Z",
		);
		expect(result.record.findings.find((finding) => finding.id === "rw-same-claim")).toMatchObject({
			status: "refuted",
			acceptance_id: "A2",
			counterevidence: { attestation_id: QA_ATTESTATION_ID, acceptance_id: "A1" },
		});
	});

	test("a QA rework cannot carry review provenance", () => {
		toReview();
		const at = "2026-08-12T10:00:03.000Z";
		const qaFindings = [reviewFinding({ id: "qa-provenance", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })];
		const action = capabilityActionFor({
			op: "request_rework",
			task_id: TASK,
			at,
			actor_id: "qa-1",
			findings: qaFindings as never[],
		});
		const capability = createMutationAuthorityCapabilityForTest(mutationRegistry, {
			authority_kind: "qa",
			task_id: TASK,
			action_digest: digestOfAction(action),
			expected_record_hash: readTaskRecordRaw(root, TASK).revision,
			intent_revision: 1,
			intent_content_hash: currentIntentHash(),
			diff_hash: DIFF,
			actor_id: "qa-1",
			confirmation_ref: "conf-qa-provenance",
			findings_digest: findingsDigestV2(qaFindings as never[]),
		});
		expect(() =>
			execute(
				{ op: "request_rework", capability, findings: qaFindings as never[], actor_id: "qa-1" },
				at,
			),
		).toThrow();
	});

	test("findingsDigestV2 binds the anchor and evidence of a rework capability", () => {
		const base = reviewFinding({ anchor: ANCHOR, evidence: REVIEW_EVIDENCE });
		expect(findingsDigestV2([base as never])).toBe(findingsDigestV2([{ ...base } as never]));
		expect(findingsDigestV2([base as never])).not.toBe(
			findingsDigestV2([{ ...base, anchor: `sha256:${"b".repeat(64)}` } as never]),
		);
		expect(findingsDigestV2([base as never])).not.toBe(
			findingsDigestV2([
				{ ...base, evidence: { ...REVIEW_EVIDENCE, caller_chain: ["other"] } } as never,
			]),
		);
	});
});

describe("review rework persists the reviewed revision", () => {
	const finding = () => [reviewFinding({ id: "rw-rev", anchor: ANCHOR, evidence: REVIEW_EVIDENCE })];

	test("a Review rework stores its revision on the round history entry", () => {
		toReview();
		const revision = reviewRevision();
		const result = requestReviewRework(finding(), "2026-08-12T10:00:03.000Z", revision);
		const entry = result.record.history.at(-1);
		expect(entry?.type).toBe("request_rework");
		expect(entry?.reason.split("\n")[0]).toBe("review_round_1");
		expect(entry?.review_revision).toEqual(revision);
		// The stored record re-parses: the optional field is legal persisted data.
		expect(readTaskRecordRaw(root, TASK).record?.history.at(-1)?.review_revision).toEqual(revision);
	});

	test("a Review rework without a revision stays valid for legacy callers", () => {
		toReview();
		const result = requestReviewRework(finding(), "2026-08-12T10:00:03.000Z");
		expect(result.record.history.at(-1)?.review_revision).toBeUndefined();
		expect(result.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
	});

	test("a revision naming another base is rejected with zero writes", () => {
		toReview();
		const before = readTaskRecordRaw(root, TASK).revision;
		expect(() =>
			requestReviewRework(finding(), "2026-08-12T10:00:03.000Z", reviewRevision({ base_head: "f".repeat(40) })),
		).toThrow(/base_head must equal the Enrollment git_base_head/);
		expect(readTaskRecordRaw(root, TASK).revision).toBe(before);
	});

	test("QA and user rework cannot carry a review revision", () => {
		for (const authority of ["qa", "user"] as const) {
			toReview(`2026-08-12T10:0${authority === "qa" ? 1 : 2}:02.000Z`);
			const plain = [{ ...FINDINGS[0], id: `rw-${authority}` }];
			expect(() =>
				requestReviewRework(plain, `2026-08-12T10:0${authority === "qa" ? 1 : 2}:03.000Z`, reviewRevision(), authority),
			).toThrow(/cannot carry a review revision/);
		}
	});
});

describe("review manifest rework delta", () => {
	const HEAD = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	function manifestFor(round: number, prior: { review_commit: string; review_tree: string } | null) {
		const scope = [`docs/specs/${TASK}.spec.md`, "src/task.ts"];
		return captureReviewManifest(root, {
			taskId: TASK,
			baseHead: HEAD(),
			scopeHint: scope,
			expectedDiffHash: taskRevisionDiffHash(root, scope, HEAD()),
			intentRevision: 1,
			intentContentHash: currentIntentHash(),
			recordRevision: "r:" + "1".repeat(64),
			workspaceRevision: "w:" + "2".repeat(64),
			lifecycle: "active",
			artifactState: "frozen",
			risk: "material",
			outcomes: {},
			delta: { round, prior },
		});
	}
	function stage(path: string, text: string) {
		writeFileSync(join(root, path), text);
		execFileSync("git", ["add", "-A"], { cwd: root });
	}

	test("round 3 lists exactly the paths the latest rework changed", () => {
		stage("src/task.ts", "export const a = 1;\n");
		stage(`docs/specs/${TASK}.spec.md`, "# v1\n");
		const round2 = manifestFor(2, null);
		expect(round2.delta_paths).toBeUndefined();
		expect(round2.delta_skipped).toBeUndefined();
		// Rework touches only the spec; src/task.ts is byte-identical to round 2.
		stage(`docs/specs/${TASK}.spec.md`, "# v2\n");
		const round3 = manifestFor(3, { review_commit: round2.review_commit, review_tree: round2.review_tree });
		expect(round3.prior_review_commit).toBe(round2.review_commit);
		expect(round3.delta_paths).toEqual([`docs/specs/${TASK}.spec.md`]);
		expect(round3.manifest_digest).not.toBe(round2.manifest_digest);
	});

	test("a missing or unresolvable prior revision skips the rule instead of blocking", () => {
		stage("src/task.ts", "export const a = 1;\n");
		const legacy = manifestFor(3, null);
		expect(legacy.delta_skipped).toBe("prior_review_revision_absent");
		expect(legacy.delta_paths).toBeUndefined();
		const pruned = manifestFor(3, { review_commit: "a".repeat(40), review_tree: "b".repeat(40) });
		expect(pruned.delta_skipped).toBe("prior_review_revision_unresolvable");
	});

	test("rounds 1 and 2 add no delta fields so their digest is unchanged", () => {
		stage("src/task.ts", "export const a = 1;\n");
		const withoutDelta = (() => {
			const scope = [`docs/specs/${TASK}.spec.md`, "src/task.ts"];
			return captureReviewManifest(root, {
				taskId: TASK,
				baseHead: HEAD(),
				scopeHint: scope,
				expectedDiffHash: taskRevisionDiffHash(root, scope, HEAD()),
				intentRevision: 1,
				intentContentHash: currentIntentHash(),
				recordRevision: "r:" + "1".repeat(64),
				workspaceRevision: "w:" + "2".repeat(64),
				lifecycle: "active",
				artifactState: "frozen",
				risk: "material",
				outcomes: {},
			});
		})();
		expect(manifestFor(1, null).manifest_digest).toBe(withoutDelta.manifest_digest);
		expect(manifestFor(2, null).manifest_digest).toBe(withoutDelta.manifest_digest);
	});
});

describe("budget exhaustion decision", () => {
	const BOUNDARY_SECURITY_EVIDENCE = {
		trigger: "an unauthenticated caller reaches the privileged path",
		caller_chain: ["runtime/claude/mcp_server.ts"],
		violated: { kind: "security_boundary", ref: "literal-user-authority" },
	};
	let clock = 0;
	const stamp = () =>
		`2026-08-12T13:${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock++ % 60).padStart(2, "0")}.000Z`;

	function blockingRound(label: string) {
		toReview(stamp());
		return requestReviewRework(
			[reviewFinding({ id: label, anchor: anchorForEvidence(REVIEW_EVIDENCE as never), evidence: REVIEW_EVIDENCE })],
			stamp(),
		);
	}

	const openBoundary = (record: { findings: { kind: string; status: string }[] }) =>
		record.findings.some((f) => f.kind === "replan_required" && f.status === "open");

	/** A genuinely parked record: the budget is spent by real blocking Review rounds. */
	function parkAtBudget() {
		let result = blockingRound("park-0");
		for (let round = 1; round <= REVIEW_REWORK_ROUND_BUDGET; round += 1) result = blockingRound(`park-${round}`);
		const boundary = result.record.findings.find((f) => f.kind === "replan_required" && f.status === "open");
		expect(boundary?.replan_cause).toBe("budget_exhausted");
		expect(result.record.lifecycle).toBe("active");
		execFileSync("git", ["add", "-A"], { cwd: root });
		return result;
	}

	function decide(
		op: "authorize_rework" | "accept_residual_risk",
		fields: { rounds?: number; reason?: string; kind?: "user" | "review" | "qa" } = {},
	) {
		const at = stamp();
		const action = capabilityActionFor({
			op,
			task_id: TASK,
			at,
			actor_id: "literal-user",
			...(fields.rounds !== undefined ? { rounds: fields.rounds } : {}),
			...(fields.reason !== undefined ? { reason: fields.reason } : {}),
		});
		const capability = createMutationAuthorityCapabilityForTest(mutationRegistry, {
			authority_kind: fields.kind ?? "user",
			task_id: TASK,
			action_digest: digestOfAction(action),
			expected_record_hash: readTaskRecordRaw(root, TASK).revision,
			intent_revision: 1,
			intent_content_hash: currentIntentHash(),
			diff_hash: DIFF,
			actor_id: "literal-user",
			confirmation_ref: `confirm-${op}-${at}`,
			findings_digest: null,
		});
		return execute(
			op === "authorize_rework"
				? { op, capability, actor_id: "literal-user", ...(fields.rounds !== undefined ? { rounds: fields.rounds } : {}) }
				: { op, capability, actor_id: "literal-user", reason: fields.reason ?? "" },
			at,
		);
	}

	test("a grant of three rounds parks again at the third further blocking round, not before", () => {
		parkAtBudget();
		const granted = decide("authorize_rework", { rounds: 3 });
		expect(granted.record.review_round_budget_extension).toBe(3);
		expect(granted.record.findings.find((f) => f.kind === "replan_required")?.status).toBe("resolved");
		const parkedAt: number[] = [];
		for (let round = 1; round <= 3; round += 1) {
			if (openBoundary(blockingRound(`granted-${round}`).record)) parkedAt.push(round);
		}
		expect(parkedAt).toEqual([3]);
	});

	test("a legacy grant without rounds extends the budget by exactly one", () => {
		parkAtBudget();
		expect(decide("authorize_rework").record.review_round_budget_extension).toBe(1);
		expect(openBoundary(blockingRound("legacy-1").record)).toBe(true);
	});

	test("a grant outside 1-5 is rejected with zero writes", () => {
		parkAtBudget();
		const before = readTaskRecordRaw(root, TASK).revision;
		expect(() => decide("authorize_rework", { rounds: 6 })).toThrow(/rounds/);
		expect(() => decide("authorize_rework", { rounds: 0 })).toThrow(/rounds/);
		expect(readTaskRecordRaw(root, TASK).revision).toBe(before);
	});

	test("accepting residual risk settles the boundary and moves the open findings to accepted_risk", () => {
		parkAtBudget();
		const openBefore = readTaskRecordRaw(root, TASK)
			.record!.findings.filter((f) => f.kind === "blocking" && f.source === "review" && f.status === "open")
			.map((f) => f.id);
		expect(openBefore.length).toBeGreaterThan(0);
		const accepted = decide("accept_residual_risk", { reason: "reviewed by the owner; follow-up filed" });
		expect(accepted.record.findings.find((f) => f.kind === "replan_required")?.status).toBe("resolved");
		for (const id of openBefore) expect(accepted.record.findings.find((f) => f.id === id)?.status).toBe("accepted_risk");
		expect(accepted.record.residual_risk_acceptance).toMatchObject({
			reason: "reviewed by the owner; follow-up filed",
			actor_id: "literal-user",
			finding_ids: openBefore,
		});
		expect(accepted.record.history.at(-1)?.authority?.authority_kind).toBe("user");
		expect(accepted.record.lifecycle).toBe("active");
	});

	test("an accepted risk completes once QA is green, without a Review approval", () => {
		parkAtBudget();
		decide("accept_residual_risk", { reason: "owner accepts the remaining findings" });
		toReview(stamp());
		const done = app.execute({
			root,
			task_id: TASK,
			operation: { op: "complete", actor_id: "executor-1" },
			prior_intent_token: token(),
			diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
			now: stamp(),
		});
		expect(done.record.lifecycle).toBe("done");
		expect(done.record.attestations.some((item) => item.kind === "review")).toBe(false);
	});

	test("an accept without literal-user authority or without a reason is rejected with zero writes", () => {
		parkAtBudget();
		const before = readTaskRecordRaw(root, TASK).revision;
		expect(() => decide("accept_residual_risk", { reason: "ok", kind: "review" })).toThrow(/literal-user|authority/i);
		expect(() => decide("accept_residual_risk", { reason: "ok", kind: "qa" })).toThrow(/literal-user|authority/i);
		expect(() => decide("accept_residual_risk", { reason: "   " })).toThrow(/reason/i);
		expect(readTaskRecordRaw(root, TASK).revision).toBe(before);
	});

	test("a repeated security boundary offers no residual-risk exit", () => {
		const security = (id: string) =>
			reviewFinding({
				id,
				acceptance_id: null,
				anchor: anchorForEvidence(BOUNDARY_SECURITY_EVIDENCE as never),
				evidence: BOUNDARY_SECURITY_EVIDENCE,
			});
		toReview(stamp());
		requestReviewRework([security("sec-1")], stamp());
		toReview(stamp());
		const parked = requestReviewRework([security("sec-2")], stamp());
		expect(parked.record.findings.find((f) => f.kind === "replan_required")?.replan_cause).toBe(
			"repeated_security_boundary",
		);
		execFileSync("git", ["add", "-A"], { cwd: root });
		const before = readTaskRecordRaw(root, TASK).revision;
		expect(() => decide("accept_residual_risk", { reason: "accepted" })).toThrow(/budget exhaustion/);
		expect(readTaskRecordRaw(root, TASK).revision).toBe(before);
	});

	test("accept_residual_risk is rejected when no boundary is open", () => {
		toReview(stamp());
		const before = readTaskRecordRaw(root, TASK).revision;
		expect(() => decide("accept_residual_risk", { reason: "nothing to accept" })).toThrow(/budget exhaustion/);
		expect(readTaskRecordRaw(root, TASK).revision).toBe(before);
	});
});
