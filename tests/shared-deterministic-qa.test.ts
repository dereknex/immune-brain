import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeterministicQa, QaPreparationError, type QaVerificationProgressInput } from "../plugins/immune-brain/runtime/assurance/qa";
import { snapshotDigest, type SnapshotDescriptor } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { VerificationAbortedError, VerificationCleanupError, VerificationLaunchError } from "../plugins/immune-brain/runtime/assurance/verification";
import { parseVerificationDescriptor } from "../plugins/immune-brain/runtime/verification_descriptor";

const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "imm-shared-qa-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const descriptor = (id: string, argv = [id], environment = {}) => parseVerificationDescriptor(JSON.stringify({
	contract: "assurance_kernel/verification_descriptor/v2",
	command: { executable: "novel-tools-2099", argv, cwd: ".", timeout_ms: 1000, max_output_bytes: 8192 },
	...(Object.keys(environment).length ? { environment } : {}),
}));
function snapshot(taskId: string, acceptance: Array<{ id: string; argv?: string[]; environment?: object }>): SnapshotDescriptor {
	const root = temp();
	return {
		contract: "assurance_kernel/assurance_snapshot/v2", role: "qa", task_id: taskId, root,
		acceptance: acceptance.map(item => ({ id: item.id, assertion: item.id, verification: descriptor(item.id, item.argv, item.environment).command.executable })),
		dirty_files: [], root,
	} as unknown as SnapshotDescriptor;
}
const descriptors = (snapshot: SnapshotDescriptor, items: Array<{ id: string; argv?: string[]; environment?: object }>) =>
	new Map(items.map(item => [item.id, descriptor(item.id, item.argv, item.environment)]));
const fakeRunner = {} as never;
const deliveryRoots: string[] = [];
const fakeDelivery = (_root: string) => {
	const root = temp(); deliveryRoots.push(root);
	return { root, tree: "tree", seal: "[]", cleanup: () => rmSync(root, { recursive: true, force: true }) };
};
const injection = (options = {}) => ({
	...options,
	_materializeDeliveryWorkspace: (_root: string) => fakeDelivery(_root),
	_writeDeliveryTree: (root: string) => "tree",
	_resolveVerificationCommand: () => fakeRunner,
});

describe("shared deterministic QA", () => {
	test("runs every descriptor once, aggregates failures and reports ordered progress without exposing output", async () => {
		const items = [{ id: "A1" }, { id: "A2" }], s = snapshot("shared-qa", items);
		const calls: string[] = [], progress: QaVerificationProgressInput[] = [];
		const stdout = "PRIVATE_KEY=unrecognized-credential\n✗ expected 2", stderr = "DATABASE_URL=postgres://user:password@host/db";
		const verdict = await runDeterministicQa(s, descriptors(s, items), injection({
			onProgress: item => progress.push(item),
			_runFixedVerification: async (_root, command) => { calls.push(command.argv[0]); return { exit_code: 1, timed_out: command.argv[0] === "A2", output_limited: false, stdout, stderr }; },
		}));
		expect(calls).toEqual(["A1", "A2"]);
		expect(progress.map(item => `${item.acceptance_id}:${item.phase}`)).toEqual(["A1:running", "A1:failed", "A2:running", "A2:failed"]);
		expect(verdict).toMatchObject({ decision: "rework", snapshot_digest: snapshotDigest(s) });
		expect(verdict.findings?.map(item => item.acceptance_id)).toEqual(["A1", "A2"]);
		expect(verdict.findings?.[1].summary).toContain("timed out");
		expect(verdict.findings?.[0].summary).toBe(`verification failed (exit 1) stdout=${Buffer.byteLength(stdout)}B stderr=${Buffer.byteLength(stderr)}B`);
		for (const output of ["unrecognized-credential", "postgres://", "expected 2"]) expect(JSON.stringify(verdict)).not.toContain(output);
	});
	test("cancellation never returns a verdict or starts the next descriptor", async () => {
		const controller = new AbortController(); let calls = 0; const items = [{ id: "A1" }], s = snapshot("abort", items);
		await expect(runDeterministicQa(s, descriptors(s, items), injection({ signal: controller.signal, _runFixedVerification: async () => { calls++; controller.abort(); return { exit_code: 0, timed_out: false, output_limited: false, stdout: "", stderr: "" }; } }))).rejects.toBeInstanceOf(VerificationAbortedError);
		expect(calls).toBe(1);
	});
	test("rejects a wrong role and missing descriptors before execution", async () => {
		const items = [{ id: "A1" }], s = snapshot("bad", items);
		await expect(runDeterministicQa({ ...s, role: "review" }, descriptors(s, items), injection())).rejects.toThrow("requires qa role");
		await expect(runDeterministicQa(s, new Map(), injection())).rejects.toThrow("descriptor missing for A1");
	});
	test("prepare runs once for identical environments and isolates distinct environments", async () => {
		const prepareScript = join(temp(), "toolbox"); writeFileSync(prepareScript, "#!/bin/sh\nmkdir -p built\necho prepared >> built/prepare.log\n"); chmodSync(prepareScript, 0o755);
		const prepare = { executable: "./toolbox", argv: ["prepare"], cwd: ".", timeout_ms: 1000, max_output_bytes: 8192 };
		const environment = { prepare, writable_paths: ["built"] };
		const items = [{ id: "A1", environment }, { id: "A2", environment }, { id: "B1", environment: { ...environment, writable_paths: ["built-b"] } }];
		const s = snapshot("grouping", items);
		const prepared: string[] = [], runs: string[] = [];
		const verdict = await runDeterministicQa(s, descriptors(s, items), injection({
			_runFixedVerification: async (root, command) => {
				runs.push(command.argv[0]);
				if (command.argv[0] === "prepare") {
					prepared.push(root);
					mkdirSync(join(root, "built"), { recursive: true });
					if (prepared.length === 2) {
						const dirs = prepared.slice(0, 2);
						expect(dirs[1]).not.toBe(dirs[0]);
					}
					return { exit_code: 0, timed_out: false, output_limited: false, stdout: "", stderr: "" };
				}
				return { exit_code: 0, timed_out: false, output_limited: false, stdout: "", stderr: "" };
			},
		}));
		expect(runs).toEqual(["prepare", "A1", "A2", "prepare", "B1"]);
		expect(prepared).toHaveLength(2); expect(prepared[1]).not.toBe(prepared[0]);
		expect(verdict.decision).toBe("pass");
	});
	test("a failed prepared check is a normal finding while prepare failure is an operation error", async () => {
		const prepare = { executable: "missing-prepare-tool-2099", argv: [], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 };
		const items = [{ id: "A1", environment: { prepare, writable_paths: [] } }], s = snapshot("prep-failure", items);
		await expect(runDeterministicQa(s, descriptors(s, items), {
			_materializeDeliveryWorkspace: () => fakeDelivery(s.root), _writeDeliveryTree: () => "tree",
			_resolveVerificationCommand: () => { throw new Error("unavailable"); },
		})).rejects.toMatchObject({ name: "QaPreparationError", acceptance_ids: ["A1"] });
		const failing = [{ id: "A1" }], snapshot2 = snapshot("check-failure", failing);
		const verdict = await runDeterministicQa(snapshot2, descriptors(snapshot2, failing), injection({ _runFixedVerification: async () => ({ exit_code: 127, timed_out: false, output_limited: false, stdout: "", stderr: "" }) }));
		expect(verdict).toMatchObject({ decision: "rework" });
		expect(verdict.findings?.[0]).toMatchObject({ acceptance_id: "A1" });
		await expect(runDeterministicQa(snapshot2, descriptors(snapshot2, failing), injection({
			_runFixedVerification: async () => { throw new VerificationLaunchError(); },
		}))).rejects.toMatchObject({ name: "QaPreparationError", stage: "resolution", reason: "process_launch_failed" });
	await expect(runDeterministicQa(snapshot2, descriptors(snapshot2, failing), injection({
		_runFixedVerification: async () => { throw new VerificationCleanupError(); },
	}))).rejects.toMatchObject({ name: "QaPreparationError", stage: "resolution", reason: "process_cleanup_failed" });
	});
	test("accepts a prepared project command with a prepared project-local interpreter", async () => {
		const root = temp();
		const prepare = join(root, "prepare");
		writeFileSync(prepare, `#!/bin/sh\nmkdir -p generated\ncp ${JSON.stringify(process.execPath)} generated/local-bun\nprintf '#!%s/generated/local-bun\\nprocess.exit(0)\\n' "$PWD" > generated/check\nchmod +x generated/local-bun generated/check\n`);
		chmodSync(prepare, 0o755);
		const check = { executable: "./generated/check", argv: [], cwd: ".", timeout_ms: 5000, max_output_bytes: 8192 };
		// Preparation copies the whole host binary, so it needs a budget that does not
		// turn a loaded machine into a spurious verification failure.
		const prepareCommand = { ...check, executable: "./prepare", timeout_ms: 20000 };
		const parsed = parseVerificationDescriptor(JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2", command: check,
			environment: { prepare: prepareCommand, writable_paths: ["generated"] } }));
		const s = snapshot("prepared-interpreter", [{ id: "A1" }]);
		const verdict = await runDeterministicQa(s, new Map([["A1", parsed]]), {
			_materializeDeliveryWorkspace: () => ({ root, tree: "tree", seal: "[]", cleanup: () => {} }),
			_writeDeliveryTree: () => "tree",
		});
		expect(verdict.decision).toBe("pass");
	});
});
