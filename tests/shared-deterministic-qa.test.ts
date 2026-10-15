import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeterministicQa, QaPreparationError, type QaVerificationProgressInput } from "../plugins/immune-brain/runtime/assurance/qa";
import { snapshotDigest, type SnapshotDescriptor } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { VerificationAbortedError, VerificationCleanupError, VerificationLaunchError } from "../plugins/immune-brain/runtime/assurance/verification";
import { parseVerificationDescriptor } from "../plugins/immune-brain/runtime/verification_descriptor";
import { inScopeTrackedDrift } from "../plugins/immune-brain/runtime/workspace_scope";

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
	_frozenTree: { tree: "tree" },
	_resolveVerificationCommand: () => fakeRunner,
});
// The Lane batch integration recheck is the only caller that still runs in a copy.
const copied = (options = {}) => ({ ...injection(options), delivery: "materialized" as const,
	_materializeDeliveryWorkspace: (_root: string) => fakeDelivery(_root) });

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
	test("diagnostics identify the canonical check without exposing output or arguments", async () => {
		const secret = "credential-canary-qa-s2";
		const items = [{ id: "A1", argv: [secret] }], s = snapshot("safe-diagnostics", items);
		const progress: QaVerificationProgressInput[] = [];
		await runDeterministicQa(s, descriptors(s, items), injection({
			onProgress: item => progress.push(item),
			_runFixedVerification: async () => ({ exit_code: 1, timed_out: false, output_limited: true, stdout: secret, stderr: secret }),
		}));
		expect(progress.at(-1)).toMatchObject({ diagnostic: {
			acceptance_id: "A1", descriptor_ref: "acceptance/0/verification/command", stage: "check",
			outcome: "output_limit", exit_code: 1, stdout_bytes: Buffer.byteLength(secret), stderr_bytes: Buffer.byteLength(secret),
		} });
		expect(progress.at(-1)?.diagnostic?.descriptor_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(JSON.stringify(progress)).not.toContain(secret);
	});
	test.each(["materialize", "resolve", "execute", "cleanup"] as const)("%s failure exposes classified metadata, not arbitrary argument/environment error text", async (phase) => {
		const secret = "credential-error-canary-S2", items = [{ id: "A1", argv: [secret] }], s = snapshot("safe-errors", items);
		const fail = () => { throw new Error(`SECRET_ENV=${secret}; argv=${secret}`); };
		const options = { ...copied(), _runFixedVerification: async () => ({ exit_code: 0, timed_out: false, output_limited: false, stdout: "", stderr: "" }) };
		if (phase === "materialize") options._materializeDeliveryWorkspace = fail;
		if (phase === "resolve") options._resolveVerificationCommand = fail;
		if (phase === "execute") options._runFixedVerification = async () => fail();
		if (phase === "cleanup") options._materializeDeliveryWorkspace = root => ({ ...fakeDelivery(root), cleanup: fail });
		const error = await runDeterministicQa(s, descriptors(s, items), options).then(() => null, error => error);
		expect(error).toBeInstanceOf(QaPreparationError);
		expect(error.diagnostics).toMatchObject([{ acceptance_id: "A1", descriptor_ref: "acceptance/0/verification/command",
			outcome: ({ materialize: "delivery_unavailable", resolve: "executable_or_cwd_unavailable", execute: "execution_failed", cleanup: "delivery_cleanup_failed" })[phase] }]);
		expect(JSON.stringify({ message: error.message, diagnostics: error.diagnostics })).not.toContain(secret);
	});
	test("a prepare failure keeps the stderr tail out of diagnostics and the error message", async () => {
		const secret = "prepare-tail-canary-S1";
		const prepare = { executable: "novel-prepare-2099", argv: [], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 };
		const items = [{ id: "A1", environment: { prepare, writable_paths: [] } }], s = snapshot("prepare-tail", items);
		const error = await runDeterministicQa(s, descriptors(s, items), injection({
			_runFixedVerification: async () => ({ exit_code: 2, timed_out: false, output_limited: false, stdout: "", stderr: secret }),
		})).then(() => null, error => error);
		expect(error).toBeInstanceOf(QaPreparationError);
		expect(error.prepare_observation.stderr_tail).toBe(secret);
		expect(JSON.stringify({ message: error.message, diagnostics: error.diagnostics })).not.toContain(secret);
		expect(error.diagnostics).toMatchObject([{ stage: "prepare", outcome: "nonzero_exit", stderr_bytes: Buffer.byteLength(secret) }]);
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
	test("prepare runs once per distinct environment, in the working directory", async () => {
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
					return { exit_code: 0, timed_out: false, output_limited: false, stdout: "", stderr: "" };
				}
				return { exit_code: 0, timed_out: false, output_limited: false, stdout: "", stderr: "" };
			},
		}));
		expect(runs).toEqual(["prepare", "A1", "A2", "prepare", "B1"]);
		expect(prepared).toEqual([s.root, s.root]);
		expect(verdict.decision).toBe("pass");
	});
	test("a failed prepared check is a normal finding while prepare failure is an operation error", async () => {
		const prepare = { executable: "missing-prepare-tool-2099", argv: [], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 };
		const items = [{ id: "A1", environment: { prepare, writable_paths: [] } }], s = snapshot("prep-failure", items);
		await expect(runDeterministicQa(s, descriptors(s, items), {
			_frozenTree: { tree: "tree" },
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
		const s = { ...snapshot("prepared-interpreter", [{ id: "A1" }]), root };
		const verdict = await runDeterministicQa(s, new Map([["A1", parsed]]), { _frozenTree: { tree: "tree" } });
		expect(verdict.decision).toBe("pass");
	});
	test("the batch integration recheck still runs in a materialized copy, not the working directory", async () => {
		const items = [{ id: "A1" }], s = snapshot("copied", items); const ran: string[] = [];
		const verdict = await runDeterministicQa(s, descriptors(s, items), copied({
			_runFixedVerification: async (root: string) => { ran.push(root); return { exit_code: 0, timed_out: false, output_limited: false, stdout: "", stderr: "" }; },
		}));
		expect(verdict.decision).toBe("pass");
		expect(ran).toEqual([deliveryRoots.at(-1)!]); expect(ran[0]).not.toBe(s.root);
	});
});

describe("task QA in the working directory", () => {
	const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
	const scope = ["src", "check.sh", "rewrite.sh"];
	// A real repository whose index is the frozen delivery: tracked in-scope and
	// out-of-scope files, plus an ignored directory holding an installed dependency.
	function repository() {
		const root = temp();
		git(root, "init", "-q"); git(root, "config", "user.email", "qa@example.invalid"); git(root, "config", "user.name", "qa");
		mkdirSync(join(root, "src")); mkdirSync(join(root, "deps"));
		writeFileSync(join(root, "src/a.txt"), "frozen\n"); writeFileSync(join(root, "notes.txt"), "outside\n");
		writeFileSync(join(root, ".gitignore"), "deps/\nuntracked-output\n"); writeFileSync(join(root, "deps/installed"), "dependency\n");
		writeFileSync(join(root, "check.sh"), "#!/bin/sh\ngrep -q dependency deps/installed && echo ran > untracked-output\n");
		writeFileSync(join(root, "rewrite.sh"), "#!/bin/sh\necho changed > src/a.txt\n");
		chmodSync(join(root, "check.sh"), 0o755); chmodSync(join(root, "rewrite.sh"), 0o755);
		git(root, "add", "-A"); git(root, "commit", "-q", "-m", "base");
		return { root, tree: git(root, "rev-parse", "HEAD^{tree}") };
	}
	const run = (root: string, tree: string, executable: string) => {
		const parsed = parseVerificationDescriptor(JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2",
			command: { executable, argv: [], cwd: ".", timeout_ms: 20000, max_output_bytes: 8192 } }));
		const s = { ...snapshot("in-place", [{ id: "A1" }]), root };
		return runDeterministicQa(s, new Map([["A1", parsed]]), { _frozenTree: { tree, drift: () => inScopeTrackedDrift(root, tree, scope) } });
	};
	const outside = () => readdirSync(tmpdir()).filter(name => name.startsWith("imm-delivery")).sort();

	test("a check uses a dependency from an ignored directory, may write output, and nothing is created outside the repository", async () => {
		const { root, tree } = repository(); const before = outside();
		// Out-of-scope tracked content is the user's environment and is not compared.
		writeFileSync(join(root, "notes.txt"), "edited outside the scope\n");
		expect((await run(root, tree, "./check.sh")).decision).toBe("pass");
		expect(readdirSync(root)).toContain("untracked-output");
		expect(outside()).toEqual(before);
	});
	test("an in-scope tracked edit outside the frozen snapshot refuses before any command runs", async () => {
		const { root, tree } = repository();
		writeFileSync(join(root, "src/a.txt"), "edited after the freeze\n");
		const error = await run(root, tree, "./check.sh").then(() => null, error => error);
		expect(error).toMatchObject({ name: "QaPreparationError", stage: "integrity", reason: "protected_input_or_output_drift" });
		expect(error.prepare_observation).toMatchObject({ conditions: { delivery: "working_directory" }, drift_paths: ["src/a.txt"] });
		expect(JSON.stringify({ message: error.message, diagnostics: error.diagnostics })).not.toContain("src/a.txt");
		expect(readdirSync(root)).not.toContain("untracked-output");
	});
	test("a check that rewrites an in-scope tracked file fails as drift", async () => {
		const { root, tree } = repository();
		const error = await run(root, tree, "./rewrite.sh").then(() => null, error => error);
		expect(error).toMatchObject({ name: "QaPreparationError", reason: "protected_input_or_output_drift" });
		expect(error.prepare_observation.drift_paths).toEqual(["src/a.txt"]);
	});
	test("the comparison ignores Git repository bindings inherited from the hosting process", () => {
		const { root, tree } = repository(), other = temp();
		git(other, "init", "-q");
		const saved = { dir: process.env.GIT_DIR, index: process.env.GIT_INDEX_FILE };
		process.env.GIT_DIR = join(other, ".git"); process.env.GIT_INDEX_FILE = join(other, ".git/index");
		try {
			expect(inScopeTrackedDrift(root, tree, scope)).toEqual([]);
			writeFileSync(join(root, "src/a.txt"), "edited\n");
			expect(inScopeTrackedDrift(root, tree, scope)).toEqual(["src/a.txt"]);
		} finally {
			if (saved.dir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved.dir;
			if (saved.index === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = saved.index;
		}
	});
	test("the comparison reads bytes: a deleted, added or mode-changed in-scope file differs, an identical rewrite does not", () => {
		const { root, tree } = repository();
		writeFileSync(join(root, "src/a.txt"), "frozen\n");
		expect(inScopeTrackedDrift(root, tree, scope)).toEqual([]);
		chmodSync(join(root, "src/a.txt"), 0o755); writeFileSync(join(root, "src/b.txt"), "new\n"); git(root, "add", "src/b.txt");
		rmSync(join(root, "check.sh"));
		expect(inScopeTrackedDrift(root, tree, scope)).toEqual(["check.sh", "src/a.txt", "src/b.txt"]);
	});
});

describe("project QA baseline", () => {
	const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
	const verification = (executable: string) => ({ contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable, argv: [], cwd: ".", timeout_ms: 20000, max_output_bytes: 8192 } });
	// `fails.sh` exits nonzero while a file named `broken` exists in its tree.
	function repository(options: { baseline?: boolean; brokenAtBase?: boolean } = {}) {
		const root = temp();
		git(root, "init", "-q"); git(root, "config", "user.email", "qa@example.invalid"); git(root, "config", "user.name", "qa");
		mkdirSync(join(root, "src")); mkdirSync(join(root, "docs/agents"), { recursive: true });
		writeFileSync(join(root, "src/a.txt"), "frozen\n");
		writeFileSync(join(root, "fails.sh"), "#!/bin/sh\ntest ! -e broken\n");
		writeFileSync(join(root, "red.sh"), "#!/bin/sh\nexit 1\n");
		writeFileSync(join(root, "ok.sh"), "#!/bin/sh\nexit 0\n");
		for (const name of ["fails.sh", "red.sh", "ok.sh"]) chmodSync(join(root, name), 0o755);
		if (options.baseline !== false)
			writeFileSync(join(root, "docs/agents/qa-baseline.json"), JSON.stringify({ contract: "assurance_kernel/qa_baseline/v1",
				checks: [{ id: "guard", verification: verification("./fails.sh") }] }));
		if (options.brokenAtBase) writeFileSync(join(root, "broken"), "red\n");
		git(root, "add", "-A"); git(root, "commit", "-q", "-m", "base");
		return { root, head: git(root, "rev-parse", "HEAD"), tree: git(root, "rev-parse", "HEAD^{tree}") };
	}
	const run = (repo: { root: string; head: string; tree: string }, acceptance: string) => {
		const s = { ...snapshot("baseline", [{ id: "A1" }]), root: repo.root };
		return runDeterministicQa(s, new Map([["A1", parseVerificationDescriptor(JSON.stringify(verification(acceptance)))]]),
			{ _baseHead: repo.head, _frozenTree: { tree: repo.tree, drift: () => inScopeTrackedDrift(repo.root, repo.tree, ["src"]) } });
	};

	test("a failing baseline check blocks with a null acceptance id, read from base_head and not the delivery", async () => {
		const repo = repository();
		// The delivery deletes its own baseline declaration and introduces the failure.
		rmSync(join(repo.root, "docs/agents/qa-baseline.json")); writeFileSync(join(repo.root, "broken"), "new\n");
		const verdict = await run(repo, "./ok.sh");
		expect(verdict.decision).toBe("rework");
		expect(verdict.findings).toHaveLength(1);
		expect(verdict.findings![0]).toMatchObject({ kind: "blocking", acceptance_id: null });
		expect(verdict.findings![0].id).toStartWith("qa-baseline-guard-");
		expect(verdict.findings![0].summary).not.toContain("pre-existing baseline failure:");
	});
	test("a baseline check that also fails on the base_head tree is advisory and disclosed on a pass", async () => {
		const repo = repository({ brokenAtBase: true });
		const verdict = await run(repo, "./ok.sh");
		expect(verdict.decision).toBe("pass");
		expect(verdict.findings).toHaveLength(1);
		expect(verdict.findings![0]).toMatchObject({ kind: "advisory", acceptance_id: null });
		expect(verdict.findings![0].summary).toStartWith("pre-existing baseline failure:");
		expect(verdict.approval?.summary).toContain("pre-existing baseline failure:");
	});
	test("a failing acceptance descriptor never receives the pre-existing tolerance", async () => {
		const repo = repository({ brokenAtBase: true });
		const verdict = await run(repo, "./red.sh");
		expect(verdict.decision).toBe("rework");
		expect(verdict.findings!.filter(item => item.kind === "blocking" && item.acceptance_id === "A1")).toHaveLength(1);
		expect(verdict.findings!.some(item => item.kind === "advisory")).toBe(false);
	});
	test("an absent baseline file adds no checks", async () => {
		const repo = repository({ baseline: false, brokenAtBase: true });
		const verdict = await run(repo, "./ok.sh");
		expect(verdict.decision).toBe("pass");
		expect(verdict.approval?.summary).toStartWith("all 1 project verification check(s) passed;");
		expect(verdict.findings).toBeUndefined();
	});
});
