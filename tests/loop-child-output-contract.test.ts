import { describe, expect, it } from "bun:test";
import {
	validateQaChildOutput,
	validateReviewChildOutput,
} from "../plugins/immune-brain/runtime/loop_contract";

const REVIEW_EXPECTATION = {
	review_gate: "imm-code-review",
	changed_files_signature: "sha256:abc123",
};

describe("imm-loop QA child output contract", () => {
	it("rejects a rework decision that omits repair_target", () => {
		const result = validateQaChildOutput(
			{ decision: "rework", evidence: "verification failed", target_id: "1" },
			{ target_id: "1" },
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("qa_output_invalid");
		expect(result.violations).toContain(
			"repair_target is required for a rework decision",
		);
	});

	it("rejects a pass decision that smuggles in a repair_target", () => {
		const result = validateQaChildOutput(
			{
				decision: "pass",
				evidence: "all checks green",
				target_id: "1",
				repair_target: "tighten the assertion",
			},
			{ target_id: "1" },
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("qa_output_invalid");
		expect(result.violations).toContain(
			"repair_target must be omitted for a pass decision",
		);
	});

	it("rejects a decision bound to a stale target_id", () => {
		const result = validateQaChildOutput(
			{ decision: "pass", evidence: "all checks green", target_id: "1" },
			{ target_id: "2" },
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("qa_output_invalid");
		expect(result.violations).toContain(
			"target_id must equal the current target 2",
		);
	});

	it("rejects a decision value outside the QA enum", () => {
		const result = validateQaChildOutput(
			{ decision: "approve", evidence: "looks fine to me", target_id: "1" },
			{ target_id: "1" },
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("qa_output_invalid");
		expect(result.violations).toContain(
			"decision must be one of pass, rework, replan",
		);
	});

	it("rejects a decision whose evidence is blank", () => {
		const result = validateQaChildOutput(
			{ decision: "pass", evidence: "   ", target_id: "1" },
			{ target_id: "1" },
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("qa_output_invalid");
		expect(result.violations).toContain("evidence must be a non-empty string");
	});

	it("rejects unknown fields that could widen authority", () => {
		const result = validateQaChildOutput(
			{
				decision: "pass",
				evidence: "all checks green",
				target_id: "1",
				gate_pass: true,
			},
			{ target_id: "1" },
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("qa_output_invalid");
		expect(result.violations).toContain("unknown field: gate_pass");
	});

	it("accepts a well-formed rework decision and normalizes it", () => {
		const result = validateQaChildOutput(
			{
				decision: "rework",
				evidence: "step 3 assertion still fails",
				target_id: "1",
				repair_target: "restore the boundary assertion",
			},
			{ target_id: "1" },
		);

		expect(result).toEqual({
			valid: true,
			decision: "rework",
			evidence: "step 3 assertion still fails",
			target_id: "1",
			repair_target: "restore the boundary assertion",
			notes: "restore the boundary assertion",
			artifacts: null,
		});
	});

	it("accepts the artifacts and notes that imm-qa is told to emit", () => {
		const result = validateQaChildOutput(
			{
				decision: "rework",
				evidence: "step 3 assertion still fails",
				target_id: "1",
				repair_target: "restore the boundary assertion",
				artifacts: "logs/run-3.txt",
				notes: "the error branch is still uncovered",
			},
			{ target_id: "1" },
		);

		expect(result).toMatchObject({
			valid: true,
			artifacts: "logs/run-3.txt",
			notes: "the error branch is still uncovered",
		});
	});

	it("rejects a replan decision that records no reason", () => {
		const result = validateQaChildOutput(
			{
				decision: "replan",
				evidence: "the Step target is malformed",
				target_id: "1",
			},
			{ target_id: "1" },
		);

		expect(result).toMatchObject({
			valid: false,
			violations: ["notes is required for a replan decision"],
		});
	});
});

describe("imm-loop reviewer child output contract", () => {
	it("rejects a pass decision that still reports findings", () => {
		const result = validateReviewChildOutput(
			{
				decision: "pass",
				evidence_ref: "review:round-1",
				findings: ["scope guard is missing on the new command"],
				review_gate: "imm-code-review",
				changed_files_signature: "sha256:abc123",
			},
			REVIEW_EXPECTATION,
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("reviewer_output_invalid");
		expect(result.violations).toContain(
			"findings must be empty for a pass decision",
		);
	});

	it("rejects a decision carrying a stale changed_files_signature", () => {
		const result = validateReviewChildOutput(
			{
				decision: "pass",
				evidence_ref: "review:round-1",
				findings: [],
				review_gate: "imm-code-review",
				changed_files_signature: "sha256:stale",
			},
			REVIEW_EXPECTATION,
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("reviewer_output_invalid");
		expect(result.violations).toContain(
			"changed_files_signature must equal sha256:abc123",
		);
	});

	it("rejects a decision recorded against a different review gate", () => {
		const result = validateReviewChildOutput(
			{
				decision: "pass",
				evidence_ref: "review:round-1",
				findings: [],
				review_gate: "imm-ui-review",
				changed_files_signature: "sha256:abc123",
			},
			REVIEW_EXPECTATION,
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("reviewer_output_invalid");
		expect(result.violations).toContain(
			"review_gate must equal imm-code-review",
		);
	});

	it("rejects a follow_up decision missing its repair contract", () => {
		const result = validateReviewChildOutput(
			{
				decision: "follow_up",
				evidence_ref: "review:round-1",
				findings: ["scope guard is missing on the new command"],
				review_gate: "imm-code-review",
				changed_files_signature: "sha256:abc123",
			},
			REVIEW_EXPECTATION,
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("reviewer_output_invalid");
		expect(result.violations).toEqual([
			"scope is required for a follow_up decision",
			"change_goal is required for a follow_up decision",
			"verification_hint is required for a follow_up decision",
		]);
	});

	it("rejects a replan decision that proves no cross-boundary issue", () => {
		const result = validateReviewChildOutput(
			{
				decision: "replan",
				evidence_ref: "review:round-1",
				findings: [],
				review_gate: "imm-code-review",
				changed_files_signature: "sha256:abc123",
			},
			REVIEW_EXPECTATION,
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("reviewer_output_invalid");
		expect(result.violations).toContain(
			"findings must be non-empty for a replan decision",
		);
	});

	it("rejects a decision value outside the reviewer enum", () => {
		const result = validateReviewChildOutput(
			{
				decision: "rework",
				evidence_ref: "review:round-1",
				findings: ["assertion is too loose"],
				review_gate: "imm-code-review",
				changed_files_signature: "sha256:abc123",
			},
			REVIEW_EXPECTATION,
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("reviewer_output_invalid");
		expect(result.violations).toContain(
			"decision must be one of pass, follow_up, replan",
		);
	});

	it("rejects unknown fields that could widen authority", () => {
		const result = validateReviewChildOutput(
			{
				decision: "pass",
				evidence_ref: "review:round-1",
				findings: [],
				review_gate: "imm-code-review",
				changed_files_signature: "sha256:abc123",
				approve_successor: "docs/plans/next.md",
			},
			REVIEW_EXPECTATION,
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("reviewer_output_invalid");
		expect(result.violations).toContain("unknown field: approve_successor");
	});

	it("rejects a decision whose evidence_ref is blank", () => {
		const result = validateReviewChildOutput(
			{
				decision: "pass",
				evidence_ref: "",
				findings: [],
				review_gate: "imm-code-review",
				changed_files_signature: "sha256:abc123",
			},
			REVIEW_EXPECTATION,
		);

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("reviewer_output_invalid");
		expect(result.violations).toContain(
			"evidence_ref must be a non-empty string",
		);
	});

	it("accepts a well-formed follow_up decision and normalizes it", () => {
		const result = validateReviewChildOutput(
			{
				decision: "follow_up",
				evidence_ref: "review:round-1",
				findings: ["scope guard is missing on the new command"],
				review_gate: "imm-code-review",
				changed_files_signature: "sha256:abc123",
				scope: ["plugins/immune-brain/runtime/loop_contract.ts"],
				change_goal: "reject unknown child fields",
				verification_hint: "bun test tests/loop-child-output-contract.test.ts",
			},
			REVIEW_EXPECTATION,
		);

		expect(result).toEqual({
			valid: true,
			decision: "follow_up",
			evidence_ref: "review:round-1",
			findings: ["scope guard is missing on the new command"],
			review_gate: "imm-code-review",
			changed_files_signature: "sha256:abc123",
			scope: ["plugins/immune-brain/runtime/loop_contract.ts"],
			change_goal: "reject unknown child fields",
			verification_hint: "bun test tests/loop-child-output-contract.test.ts",
		});
	});
});
