import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeterministicQa, QaPreparationError } from "../plugins/immune-brain/runtime/assurance/qa";
import {
	AssuranceCoordinator,
	QA_PREPARE_STDERR_TAIL_BYTES,
	qaPrepareStderrTail,
	type AssuranceCoordinatorPorts,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import { parseVerificationDescriptor } from "../plugins/immune-brain/runtime/verification_descriptor";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";

const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "imm-prepare-diag-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const TASK = "prepare-diagnostics";
const PREPARE_TIMEOUT_MS = 7654;
const prepare = { executable: "novel-prepare-2099", argv: ["install"], cwd: ".", timeout_ms: PREPARE_TIMEOUT_MS, max_output_bytes: 8192 };
const descriptor = (withPrepare: boolean) => parseVerificationDescriptor(JSON.stringify({
	contract: "assurance_kernel/verification_descriptor/v2",
	command: { executable: "novel-check-2099", argv: ["A1"], cwd: ".", timeout_ms: 1000, max_output_bytes: 8192 },
	environment: { prepare: withPrepare ? prepare : null, writable_paths: [] },
}));
const snapshot = (): SnapshotDescriptor => ({
	contract: "assurance_kernel/assurance_snapshot/v2", role: "qa", task_id: TASK, root: temp(),
	record_revision: "record-1", workspace_revision: "workspace-1", intent_revision: 1,
	intent_content_hash: "sha256:intent", diff_hash: "sha256:diff", lifecycle: "active", artifact_state: "frozen", risk: "material",
	fresh_acceptance_ids: ["A1"], missing_acceptance_ids: [], stale_attestation_ids: [],
	acceptance: [{ id: "A1", assertion: "A1", verification: "{}" }], dirty_files: [], review_bundle_digest: null,
} as unknown as SnapshotDescriptor);

type Outcome = { exit_code: number; timed_out: boolean; output_limited: boolean; stdout: string; stderr: string };
const outcomes = {
	timeout: (stderr: string): Outcome => ({ exit_code: 1, timed_out: true, output_limited: false, stdout: "", stderr }),
	nonzero_exit: (stderr: string): Outcome => ({ exit_code: 3, timed_out: false, output_limited: false, stdout: "", stderr }),
	output_limit: (stderr: string): Outcome => ({ exit_code: 1, timed_out: false, output_limited: true, stdout: "", stderr }),
};
const PASS: Outcome = { exit_code: 0, timed_out: false, output_limited: false, stdout: "", stderr: "" };

const fakeDelivery = () => { const root = temp(); return { root, tree: "tree", seal: "[]", cleanup: () => rmSync(root, { recursive: true, force: true }) }; };
function qa(s: SnapshotDescriptor, withPrepare: boolean, run: (stage: "prepare" | "check") => Outcome) {
	return runDeterministicQa(s, new Map([["A1", descriptor(withPrepare)]]), {
		_frozenTree: { tree: "tree" },
		_resolveVerificationCommand: () => ({}) as never,
		_runFixedVerification: async (_root, command) => run(command.executable === prepare.executable ? "prepare" : "check"),
	});
}
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as QaPreparationError);

describe("QA prepare diagnostics", () => {
	test.each(["timeout", "nonzero_exit", "output_limit"] as const)("%s in prepare carries the conditions, the declared timeout and the stderr tail", async (reason) => {
		const error = await failure(qa(snapshot(), true, stage => stage === "prepare" ? outcomes[reason]("resolving\nerror: registry unreachable\n") : PASS));
		expect(error).toBeInstanceOf(QaPreparationError);
		expect(error).toMatchObject({ stage: "prepare", reason, prepare_observation: {
			conditions: { delivery: "working_directory" },
			declared_timeout_ms: PREPARE_TIMEOUT_MS,
			stderr_tail: "resolving\nerror: registry unreachable\n",
		} });
	});

	test("the batch integration recheck reports the materialized copy as its conditions", async () => {
		const error = await failure(runDeterministicQa(snapshot(), new Map([["A1", descriptor(true)]]), {
			delivery: "materialized", _frozenTree: { tree: "tree" }, _materializeDeliveryWorkspace: fakeDelivery,
			_resolveVerificationCommand: () => ({}) as never, _runFixedVerification: async () => outcomes.nonzero_exit("x"),
		}));
		expect(error?.prepare_observation?.conditions).toEqual({ delivery: "isolated_materialization", worktree_node_modules: "absent" });
	});

	test("a failing check returns neither the conditions nor any output text", async () => {
		const secret = "check-stderr-canary-S1";
		const verdict = await qa(snapshot(), true, stage => stage === "check" ? outcomes.nonzero_exit(secret) : PASS);
		expect(verdict).toMatchObject({ decision: "rework" });
		expect(JSON.stringify(verdict)).not.toContain(secret);
		expect(JSON.stringify(verdict)).not.toContain("prepare_observation");

		const crashed = await failure(qa(snapshot(), false, () => { throw new Error(secret); }));
		expect(crashed).toBeInstanceOf(QaPreparationError);
		expect(crashed!.stage).toBe("check");
		expect(crashed!.prepare_observation).toBeUndefined();
		expect(JSON.stringify({ message: crashed!.message, diagnostics: crashed!.diagnostics })).not.toContain(secret);
	});

	test("stderr over the bound keeps only its end", async () => {
		const stderr = `${"a".repeat(5000)}${"z".repeat(QA_PREPARE_STDERR_TAIL_BYTES - 3)}END`;
		const error = await failure(qa(snapshot(), true, stage => stage === "prepare" ? outcomes.nonzero_exit(stderr) : PASS));
		const tail = error!.prepare_observation!.stderr_tail;
		expect(Buffer.byteLength(tail)).toBe(QA_PREPARE_STDERR_TAIL_BYTES);
		expect(tail.endsWith("zzEND")).toBe(true);
		expect(tail.startsWith("a")).toBe(false);
	});

	test("empty stderr yields an empty tail, still with the conditions", async () => {
		const error = await failure(qa(snapshot(), true, stage => stage === "prepare" ? outcomes.timeout("") : PASS));
		expect(error!.prepare_observation).toMatchObject({ stderr_tail: "", declared_timeout_ms: PREPARE_TIMEOUT_MS });
	});

	test("control characters other than newline and tab are removed", () => {
		expect(qaPrepareStderrTail("a\u001b[31mred\u001b[0m\tb\r\nc\u0000d\u007fe\u0085f\u0007")).toBe("a[31mred[0m\tb\ncdef");
	});

	test("the bound never begins inside a multi-byte character", () => {
		const tail = qaPrepareStderrTail(`${"é".repeat(QA_PREPARE_STDERR_TAIL_BYTES)}`);
		expect(tail).not.toContain("�");
		expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(QA_PREPARE_STDERR_TAIL_BYTES);
		expect(Buffer.byteLength(tail)).toBeGreaterThan(QA_PREPARE_STDERR_TAIL_BYTES - 2);
	});
});

describe("QA prepare diagnostics through the coordinator", () => {
	function coordinator(runQa: AssuranceCoordinatorPorts["runQa"]) {
		const fresh = {
			error: null,
			claim: { task_id: TASK, lifecycle_status: "active" },
			projection: { lifecycle: "active", artifact_state: "frozen", risk: "material", next_obligation: "run_qa",
				record_revision: "record-1", workspace_revision: "workspace-1", intent_revision: 1, intent_content_hash: "sha256:intent",
				diff_hash: "sha256:diff", fresh_acceptance_ids: ["A1"], missing_acceptance_ids: [], stale_attestation_ids: [],
				blocking_finding_ids: [], unresolved_user_decision_ids: [], replan_required_ids: [], completion_ready: false,
				authorization: { state: "none", blocked: null } },
		} as unknown as AssuranceProjectionResult;
		let applied = 0;
		const ports = {
			host: { host: "fake", prepareReview: () => { throw new Error("unused"); }, releaseReview: () => undefined },
			confirmationReference: ({ actorId }: { actorId: string }) => `fixture:${actorId}`,
			projectTask: async () => fresh,
			readTaskRecord: async () => ({ revision: "record-1", record: { findings: [] } }),
			readTaskIntent: async () => ({ token: "intent-token" }),
			buildAssurance: async () => ({ snapshot: snapshot(), descriptors: new Map([["A1", descriptor(true)]]), reviewBundle: null }),
			runQa,
			writeReviewEvidence: () => { throw new Error("unused"); },
			applyVerdict: async () => { applied += 1; },
			applyOrdinaryOperation: async () => undefined,
		} as unknown as AssuranceCoordinatorPorts;
		return { coordinator: new AssuranceCoordinator(ports, ports as never), applied: () => applied };
	}
	const real = (run: (stage: "prepare" | "check") => Outcome): AssuranceCoordinatorPorts["runQa"] => (s, d) =>
		runDeterministicQa(s, d, {
			_frozenTree: { tree: "tree" }, _resolveVerificationCommand: () => ({}) as never,
			_runFixedVerification: async (_root, command) => run(command.executable === prepare.executable ? "prepare" : "check"),
		});

	test("a prepare failure returns the observation beside, not inside, the diagnostics", async () => {
		const secret = "tail-canary-S1";
		const h = coordinator(real(stage => stage === "prepare" ? outcomes.timeout(`log\n${secret}\n`) : PASS));
		const result = await h.coordinator.advance(TASK, { cwd: "/tmp/prepare-diagnostics" }) as unknown as Record<string, any>;
		expect(result).toMatchObject({ state: "failed", environment_failure: true,
			prepare_observation: { declared_timeout_ms: PREPARE_TIMEOUT_MS, stderr_tail: `log\n${secret}\n`,
				conditions: { delivery: "working_directory" } } });
		// The run happened in the working directory, so a reproduction there is equivalent.
		expect(result.reason).not.toContain("not equivalent");
		expect(JSON.stringify(result.diagnostics)).not.toContain(secret);
		expect(JSON.stringify(result.recovery)).not.toContain(secret);
		expect(h.applied()).toBe(0);
	});

	test("a failing check returns no prepare observation and no output", async () => {
		const secret = "check-tail-canary-S1";
		const h = coordinator(real(stage => stage === "check" ? outcomes.nonzero_exit(secret) : PASS));
		const result = await h.coordinator.advance(TASK, { cwd: "/tmp/prepare-diagnostics" });
		expect(result).not.toHaveProperty("prepare_observation");
		expect(JSON.stringify(result)).not.toContain(secret);
	});

	test("a check-stage preparation error carries no observation even when one is injected", async () => {
		const injected = { conditions: { delivery: "isolated_materialization", worktree_node_modules: "absent" },
			declared_timeout_ms: 1, stderr_tail: "leak" } as never;
		const h = coordinator(async () => { throw new QaPreparationError("check", ["A1"], "execution_failed", [], injected); });
		const result = await h.coordinator.advance(TASK, { cwd: "/tmp/prepare-diagnostics" });
		expect(result).toMatchObject({ state: "failed", environment_failure: true });
		expect(JSON.stringify(result)).not.toContain("leak");
	});

	test("the Loop contract states the stage-specific output rule", () => {
		const contract = readFileSync(join(import.meta.dir, "../plugins/immune-brain/dist/imm-run.md"), "utf8").replace(/\s+/g, " ");
		expect(contract).toContain("`prepare_observation`");
		expect(contract).toContain("at most 2048 bytes of the end of stderr");
		expect(contract).toContain("A failing `check` stage returns no output text at all.");
	});
});
