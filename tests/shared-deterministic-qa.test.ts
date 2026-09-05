import { describe, expect, test } from "bun:test";
import { runDeterministicQa, type QaVerificationProgressInput } from "../plugins/immune-brain/runtime/assurance/qa";
import { snapshotDigest, type SnapshotDescriptor } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { VerificationAbortedError, type FrozenRunner, type VerificationDescriptor } from "../plugins/immune-brain/runtime/assurance/verification";

const snapshot = {
	role: "qa", task_id: "shared-qa", root: "/tmp/shared-qa",
	acceptance: ["A1", "A2"].map(id => ({ id, assertion: id, verification: "fixed" })),
} as SnapshotDescriptor;
const descriptors = new Map(snapshot.acceptance.map(item => [item.id, { argv: [item.id] } as VerificationDescriptor]));
const runner = {} as FrozenRunner;

describe("shared deterministic QA", () => {
	test("runs every descriptor once, aggregates failures and reports ordered progress", async () => {
		const calls: string[] = [];
		const progress: QaVerificationProgressInput[] = [];
		const stdout = "PRIVATE_KEY=unrecognized-credential\n\u2717 expected 2";
		const stderr = "DATABASE_URL=postgres://user:password@host/db\nTOKEN=private";
		const verdict = await runDeterministicQa(snapshot, descriptors, runner, {
			onProgress: item => progress.push(item),
			runVerification: async (_root, descriptor) => {
				calls.push(descriptor.argv[0]);
				return { exit_code: 1, timed_out: descriptor.argv[0] === "A2", stdout, stderr, output_truncated: false };
			},
		});
		expect(calls).toEqual(["A1", "A2"]);
		expect(progress.map(item => `${item.acceptance_id}:${item.phase}`)).toEqual(["A1:running", "A1:failed", "A2:running", "A2:failed"]);
		expect(verdict.decision).toBe("rework");
		expect(verdict.snapshot_digest).toBe(snapshotDigest(snapshot));
		expect(verdict.findings?.map(item => item.acceptance_id)).toEqual(["A1", "A2"]);
		expect(verdict.findings?.[1].summary).toContain("timed out");
		expect(verdict.findings?.[0].summary).toBe(`verification failed (exit 1) stdout=${Buffer.byteLength(stdout)}B stderr=${Buffer.byteLength(stderr)}B`);
		for (const output of ["unrecognized-credential", "postgres://", "private", "expected 2"]) {
			expect(JSON.stringify(verdict)).not.toContain(output);
		}
	});

	test("cancellation never returns a verdict or starts the next descriptor", async () => {
		const controller = new AbortController();
		let calls = 0;
		await expect(runDeterministicQa(snapshot, descriptors, runner, {
			signal: controller.signal,
			runVerification: async () => {
				calls++;
				controller.abort();
				return { exit_code: 0, timed_out: false, stdout: "", stderr: "", output_truncated: false };
			},
		})).rejects.toBeInstanceOf(VerificationAbortedError);
		expect(calls).toBe(1);
	});

	test("rejects a wrong role and missing descriptors before execution", async () => {
		await expect(runDeterministicQa({ ...snapshot, role: "review" }, descriptors, runner)).rejects.toThrow("requires qa role");
		await expect(runDeterministicQa(snapshot, new Map(), runner)).rejects.toThrow("descriptor missing for A1");
	});
});
