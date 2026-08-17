import { describe, expect, it } from "bun:test";
import {
	normalizeExecutionEvidence,
	recordExecution,
	reviewPass,
	validateReadyForReviewEvidence,
} from "../plugins/immune-brain/runtime/state_ledger";

const failedCheck = {
	command: "bun test tests/example.test.ts",
	status: "failed",
	exit_code: 1,
	summary: "1 test failed",
};

describe("structured execution evidence", () => {
	it("rejects legacy passing evidence outside the migration layer", () => {
		expect(() =>
			normalizeExecutionEvidence({
				changed_files: "src/a.ts,tests/a.test.ts",
				verification_command: "bun test tests/a.test.ts",
				verification_result: "2 tests passed",
			}),
		).toThrow("run imm-migrate");
	});

	it("records structured failed evidence for independent QA", () => {
		const evidence = validateReadyForReviewEvidence({
			changed_files: ["src/a.ts"],
			status: "failed",
			checks: [failedCheck],
		});

		expect(evidence.evidence_schema).toBe("structured-v1");
		expect(evidence.status).toBe("failed");
		expect(evidence).not.toHaveProperty("verification_result");
		expect(evidence).not.toHaveProperty("verification_command");
	});

	it("records structured blocked evidence without inventing an exit code", () => {
		const evidence = validateReadyForReviewEvidence({
			changed_files: ["src/a.ts"],
			status: "blocked",
			checks: [
				{
					command: "deploy smoke test",
					status: "blocked",
					exit_code: null,
					summary: "missing credentials",
				},
			],
		});

		expect(evidence.status).toBe("blocked");
	});

	it("rejects a failure_exit outside the stable reason enum", () => {
		expect(() =>
			validateReadyForReviewEvidence({
				changed_files: ["src/a.ts"],
				status: "failed",
				failure_exit: "something went wrong",
				checks: [failedCheck],
			}),
		).toThrow(
			"failure_exit must be one of repeated same error, tool failure, no progress, missing credentials, unclear target or verification.",
		);
	});

	it("rejects a failure_exit recorded alongside passing evidence", () => {
		expect(() =>
			validateReadyForReviewEvidence({
				changed_files: ["src/a.ts"],
				status: "passed",
				failure_exit: "tool failure",
				checks: [
					{
						command: "bun test tests/example.test.ts",
						status: "passed",
						exit_code: 0,
						summary: "2 tests passed",
					},
				],
			}),
		).toThrow("failure_exit cannot accompany passing execution evidence.");
	});

	it("rejects inconsistent structured status and exit codes", () => {
		expect(() =>
			validateReadyForReviewEvidence({
				changed_files: ["src/a.ts"],
				status: "passed",
				checks: [failedCheck],
			}),
		).toThrow("does not match checks status failed");

		expect(() =>
			normalizeExecutionEvidence({
				changed_files: ["src/a.ts"],
				status: "passed",
				checks: [{ ...failedCheck, status: "passed", exit_code: 1 }],
			}),
		).toThrow("cannot pass without exit_code 0");
	});

	it("requires command passes to prove exit code 0 and supports explicit manual checks", () => {
		expect(() =>
			normalizeExecutionEvidence({
				changed_files: ["src/a.ts"],
				status: "passed",
				checks: [
					{
						command: "bun test",
						status: "passed",
						exit_code: null,
						summary: "looks good",
					},
				],
			}),
		).toThrow("cannot pass without exit_code 0");

		expect(
			validateReadyForReviewEvidence({
				changed_files: ["docs/a.md"],
				status: "passed",
				checks: [
					{
						kind: "manual",
						command: "inspect rendered document",
						status: "passed",
						exit_code: null,
						summary: "layout is complete",
					},
				],
			}).status,
		).toBe("passed");
	});

	it("prevents QA pass for structured failed evidence", () => {
		const state = {
			steps: {
				"1": {
					state: "ready_for_review",
					execution_evidence: validateReadyForReviewEvidence({
						changed_files: ["src/a.ts"],
						status: "failed",
						checks: [failedCheck],
					}),
				},
			},
		};

		expect(() => reviewPass(state, 1)).toThrow(
			"QA pass requires passed execution evidence",
		);
		expect(state.steps["1"].state).toBe("ready_for_review");
	});

	it("rejects executing probe Steps without committed child evidence", () => {
		const state = {
			steps: {
				"1": {
					state: "executing",
					parallel_probes: [
						{ scope: "runtime", output: "evidence", readonly: true },
					],
				},
			},
		};
		expect(() =>
			recordExecution(state, 1, {
				changed_files: ["src/a.ts"],
				status: "passed",
				checks: [
					{
						command: "bun test",
						status: "passed",
						exit_code: 0,
						summary: "passed",
					},
				],
			}),
		).toThrow("has no committed work probe evidence");
	});

	it("keeps all legacy failure text fail-closed", () => {
		expect(() =>
			validateReadyForReviewEvidence({
				changed_files: ["src/a.ts"],
				verification_result: "FAIL: 1 test failed",
			}),
		).toThrow("run imm-migrate");
	});
});
