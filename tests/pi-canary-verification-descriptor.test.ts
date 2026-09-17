import { describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDeliveryClean, DeliveryWorkspaceError, materializeDeliveryWorkspace, removeTaskOwnedTree, writeDeliveryTree } from "../plugins/immune-brain/runtime/assurance/delivery_workspace";
import { captureGitTaskRevisionSnapshot } from "../plugins/immune-brain/runtime/workspace_scope";
import { parseVerificationDescriptor, canonicalDescriptorBytes, resolveVerificationCommand, assertCommandIdentity, runFixedVerification, findingsDigest } from "../plugins/immune-brain/.pi-extension/pi-canary-verification";
import { VerificationCleanupError, verificationPath } from "../plugins/immune-brain/runtime/assurance/verification";

const command = (overrides = {}) => ({ executable: "bun", argv: ["-e", "1"], cwd: ".", timeout_ms: 30000, max_output_bytes: 8192, ...overrides });
const good = (overrides = {}) => parseVerificationDescriptor(JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2", command: command(overrides) }));
function temp(prefix = "imm-command-test-") { return mkdtempSync(join(tmpdir(), prefix)); }
function remove(root: string) { rmSync(root, { recursive: true, force: true }); }
function git(root: string, args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function gitRepo() {
	const root = temp(); git(root, ["init", "-q"]); git(root, ["config", "user.email", "test@example.com"]); git(root, ["config", "user.name", "Test"]);
	writeFileSync(join(root, "ok.ts"), "export const ok = 1;\n"); git(root, ["add", "ok.ts"]); git(root, ["commit", "-qm", "base"]); return root;
}
function tree(root: string) { return git(root, ["rev-parse", "HEAD^{tree}"]); }
async function run(root: string, overrides = {}, signal?: AbortSignal) {
	const c = good(overrides).command, path = verificationPath();
	return runFixedVerification(root, c, resolveVerificationCommand(root, c, path), { home: root, path, signal });
}

describe("project command verification", () => {
	test("canonical v2 descriptors have explicit empty environment defaults", () => {
		expect(canonicalDescriptorBytes(good())).toBe(canonicalDescriptorBytes(good()));
		expect(good().environment).toEqual({ prepare: null, writable_paths: [] });
		for (const executable of ["novel-tool-2099", "python3", "go", "pnpm", "./tools/custom"])
			expect(good({ executable }).command.executable).toBe(executable);
	});
	test("retired descriptors, malformed objects and unknown fields fail closed", () => {
		for (const raw of ["null", "[]", "1", "bun test", "", JSON.stringify({ contract: "invalid" }), JSON.stringify({ ...good(), forged: true })])
			expect(() => parseVerificationDescriptor(raw)).toThrow();
		expect(() => parseVerificationDescriptor(JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v1" }))).toThrow("verification_contract_migration_required");
	});
	test("literal argument arrays preserve shell characters without evaluation", async () => {
		const root = temp();
		try {
			const literals = ["a b", "$(touch stolen)", "a;b", "*.ts", "", "../input"];
			const result = await run(root, { argv: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", ...literals] });
			expect(JSON.parse(result.stdout)).toEqual(literals);
			expect(result.exit_code).toBe(0);
		} finally { remove(root); }
	});
	test("path, argument, output and deadline bounds are enforced", () => {
		for (const cwd of ["/absolute", "../escape", "a/../../b", "a\\b", ".git", ""])
			expect(() => good({ cwd })).toThrow();
		for (const executable of ["/bin/sh", "../tool", "a/b", "./../tool"])
			expect(() => good({ executable })).toThrow();
		for (const argv of [Array(65).fill("x"), ["x".repeat(513)], ["a\nb"]]) expect(() => good({ argv })).toThrow();
		for (const timeout_ms of [0, -1, 1.5, 600001]) expect(() => good({ timeout_ms })).toThrow();
		for (const max_output_bytes of [0, 262145]) expect(() => good({ max_output_bytes })).toThrow();
	});
	test("unknown project executable is bound by bytes and its interpreter", async () => {
		const root = temp();
		try {
			const file = join(root, "unheard-of-tool"); writeFileSync(file, "#!/bin/sh\nprintf unknown-tool\n"); chmodSync(file, 0o755);
			const c = good({ executable: "./unheard-of-tool", argv: [] }).command;
			const frozen = resolveVerificationCommand(root, c);
			expect(frozen.entry.content_hash).toMatch(/^sha256:/); expect(frozen.interpreter).not.toBeNull();
			const result = await runFixedVerification(root, c, frozen, { home: root, path: verificationPath() });
			expect(result.stdout).toBe("unknown-tool"); expect(result.exit_code).toBe(0);
			writeFileSync(file, "#!/bin/sh\nexit 1\n"); expect(() => assertCommandIdentity(frozen)).toThrow("identity changed");
		} finally { remove(root); }
	});
	test("resolved host tools retain their invocation path while binding real bytes", () => {
		const root = temp();
		try {
			const alias = join(root, "tool-alias");
			symlinkSync("/bin/sh", alias);
			const frozen = resolveVerificationCommand(root, good({ executable: "tool-alias", argv: ["-c", "exit 0"] }).command, root);
			expect(frozen.entry.invocation_path).toBe(alias);
			expect(frozen.entry.path).not.toBe(alias);
			expect(() => assertCommandIdentity(frozen)).not.toThrow();
		} finally { remove(root); }
	});
	test("missing tools and escaping cwd or executable links are rejected", () => {
		const root = temp();
		try {
			expect(() => resolveVerificationCommand(root, good({ executable: "missing-tool-2099" }).command)).toThrow("unavailable");
			symlinkSync("/", join(root, "escape"));
			expect(() => resolveVerificationCommand(root, good({ cwd: "escape" }).command)).toThrow("escapes");
			expect(() => resolveVerificationCommand(root, good({ executable: "./escape/bin/sh" }).command)).toThrow("escapes");
		} finally { remove(root); }
	});
	test("nonzero exits, cancellation, deadlines and combined output limits survive generalization", async () => {
		const root = temp();
		try {
			expect((await run(root, { argv: ["-e", "process.exit(9)"] })).exit_code).toBe(9);
			const controller = new AbortController();
			const pending = run(root, { argv: ["-e", "setInterval(()=>{},1000)"] }, controller.signal);
			setTimeout(() => controller.abort(), 30); await expect(pending).rejects.toThrow("aborted");
			expect((await run(root, { argv: ["-e", "setInterval(()=>{},1000)"], timeout_ms: 40 })).timed_out).toBe(true);
			const loud = await run(root, { argv: ["-e", "process.stdout.write('x'.repeat(5000));process.stderr.write('y'.repeat(5000));setInterval(()=>{},1000)"], max_output_bytes: 8192 });
			expect(loud.output_limited).toBe(true); expect(loud.exit_code).not.toBe(0);
			expect(Buffer.byteLength(loud.stdout) + Buffer.byteLength(loud.stderr)).toBeLessThanOrEqual(8192);
		} finally { remove(root); }
	});
	test("deadline settles when a detached descendant keeps inherited pipes open", async () => {
		const root = temp();
		try {
			const script = join(root, "detached.ts");
			writeFileSync(script, [
				'import { spawn } from "node:child_process";',
				'import { writeFileSync } from "node:fs";',
				'const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { detached: true, stdio: ["ignore", "inherit", "inherit"] });',
				'writeFileSync("detached.pid", String(child.pid)); child.unref();',
			].join("\n"));
			const started = performance.now();
			const result = await run(root, { argv: ["run", script], timeout_ms: 80 });
			expect(result.timed_out).toBe(true);
			expect(performance.now() - started).toBeLessThan(6000);
			const pid = Number(readFileSync(join(root, "detached.pid"), "utf8"));
			// The result settles only once cleanup is confirmed, so no grace period
			// is needed before the descendant is proven gone.
			expect(() => process.kill(pid, 0)).toThrow();
		} finally { remove(root); }
	});
	test("successful checks clean detached descendants with closed pipes", async () => {
		const root = temp();
		try {
			const script = join(root, "detached-success.ts");
			writeFileSync(script, [
				'import { spawn } from "node:child_process";',
				'import { writeFileSync } from "node:fs";',
				'const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { detached: true, stdio: "ignore" });',
				'writeFileSync("detached-success.pid", String(child.pid)); child.unref();',
			].join("\n"));
			const result = await run(root, { argv: ["run", script] });
			expect(result.exit_code).toBe(0);
			const pid = Number(readFileSync(join(root, "detached-success.pid"), "utf8"));
			// Cleanup is proven before the successful result is returned.
			expect(() => process.kill(pid, 0)).toThrow();
		} finally { remove(root); }
	});
	// The `ps` scanner seam only exists off Linux: procfs discovery ignores it.
	if (process.platform === "darwin") {
	test("process discovery failure blocks success instead of leaking QA authority", async () => {
		const root = temp(); let pid = 0;
		try {
			const script = join(root, "detached-scanner-failure.ts"), scanner = join(root, "broken-ps");
			writeFileSync(script, [
				'import { spawn } from "node:child_process";',
				'import { writeFileSync } from "node:fs";',
				'const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { detached: true, stdio: "ignore" });',
				'writeFileSync("detached-scanner-failure.pid", String(child.pid)); child.unref();',
			].join("\n"));
			writeFileSync(scanner, "#!/bin/sh\nexit 1\n"); chmodSync(scanner, 0o755);
			const c = good({ argv: ["run", script] }).command, path = verificationPath();
			await expect(runFixedVerification(root, c, resolveVerificationCommand(root, c, path), {
				home: root, path, _processScanner: scanner,
			})).rejects.toBeInstanceOf(VerificationCleanupError);
			pid = Number(readFileSync(join(root, "detached-scanner-failure.pid"), "utf8"));
		} finally {
			if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
			remove(root);
		}
	});
	test("a scanner failure still kills a running check and fails cleanup closed", async () => {
		const root = temp();
		try {
			const script = join(root, "scanner-failure-running.ts"), scanner = join(root, "broken-ps");
			writeFileSync(script, [
				'import { writeFileSync } from "node:fs";',
				'writeFileSync("scanner-failure-running.pid", String(process.pid));',
				'setInterval(() => {}, 10000);',
			].join("\n"));
			writeFileSync(scanner, "#!/bin/sh\nexit 1\n"); chmodSync(scanner, 0o755);
			const c = good({ argv: ["run", script], timeout_ms: 1000 }).command, path = verificationPath();
			// Discovery is broken while the check is still running: the known child is
			// killed anyway, and the unproven cleanup outranks the timeout outcome.
			await expect(runFixedVerification(root, c, resolveVerificationCommand(root, c, path), {
				home: root, path, _processScanner: scanner,
			})).rejects.toBeInstanceOf(VerificationCleanupError);
			const pid = Number(readFileSync(join(root, "scanner-failure-running.pid"), "utf8"));
			expect(() => process.kill(pid, 0)).toThrow();
		} finally { remove(root); }
	});
	}
	test("procfs discovery ignores table entries that do not carry the run token", async () => {
		// Two live bystanders are placed in the table with environments that only
		// resemble the marker. They must survive, which proves selection happens on the
		// exact inherited environment rather than on a table entry or a command line.
		const root = temp(), proc = join(root, "proc");
		const bystanders = [
			spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" }),
			spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" }),
		];
		try {
			const entry = (pid: number, environment: string) => {
				mkdirSync(join(proc, String(pid)), { recursive: true });
				writeFileSync(join(proc, String(pid), "environ"), environment);
			};
			entry(bystanders[0]!.pid!, "IMM_VERIFICATION_PROCESS_TOK=near-miss");
			entry(bystanders[1]!.pid!, "PATH=/usr/bin\0SOME_OTHER=x");
			mkdirSync(join(proc, "not-a-pid"), { recursive: true });
			mkdirSync(join(proc, "999996"), { recursive: true }); // an exited process keeps no readable environ
			const c = good({ argv: ["-e", "1"] }).command, path = verificationPath();
			const result = await runFixedVerification(root, c, resolveVerificationCommand(root, c, path), {
				home: root, path, _procRoot: proc,
			});
			expect(result.exit_code).toBe(0);
			for (const bystander of bystanders) expect(() => process.kill(bystander.pid!, 0)).not.toThrow();
		} finally {
			for (const bystander of bystanders) { try { bystander.kill("SIGKILL"); } catch { /* Already exited. */ } }
			remove(root);
		}
	});
	test("an unreadable process table fails cleanup closed and still kills the known child", async () => {
		const root = temp();
		try {
			const script = join(root, "unreadable-table-running.ts"), scanner = join(root, "broken-ps");
			writeFileSync(script, [
				'import { writeFileSync } from "node:fs";',
				'writeFileSync("unreadable-table.pid", String(process.pid));',
				'setInterval(() => {}, 10000);',
			].join("\n"));
			writeFileSync(scanner, "#!/bin/sh\nexit 1\n"); chmodSync(scanner, 0o755);
			const c = good({ argv: ["run", script], timeout_ms: 1000 }).command, path = verificationPath();
			// Neither platform can prove anything about the table here, so the run must
			// fail closed while the directly known child is still terminated first.
			await expect(runFixedVerification(root, c, resolveVerificationCommand(root, c, path), {
				home: root, path, _procRoot: join(root, "missing-proc"), _processScanner: scanner,
			})).rejects.toBeInstanceOf(VerificationCleanupError);
			expect(() => process.kill(Number(readFileSync(join(root, "unreadable-table.pid"), "utf8")), 0)).toThrow();
		} finally { remove(root); }
	});
	test("procfs discovery cleans an inherited token carrier and fails closed without a table", async () => {
		// Linux cannot use the BSD `ps` environment modifier, so the procfs branch is
		// proved on every host by emulating the platform against a synthetic process
		// table: a detached carrier found only through the table must be killed before
		// the result settles, and a table that cannot be read must fail closed.
		const root = temp();
		const platform = Object.getOwnPropertyDescriptor(process, "platform");
		let carrierPid = 0;
		try {
			Object.defineProperty(process, "platform", { value: "linux", configurable: true });
			const proc = join(root, "proc");
			mkdirSync(proc, { recursive: true });
			const script = join(root, "procfs-carrier.ts");
			writeFileSync(script, [
				'import { spawn } from "node:child_process";',
				'import { mkdirSync, writeFileSync } from "node:fs";',
				'const proc = process.argv[2];',
				'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: "ignore" });',
				'mkdirSync(proc + "/" + child.pid, { recursive: true });',
				'writeFileSync(proc + "/" + child.pid + "/environ", Object.entries(process.env).map(([key, value]) => key + "=" + value).join("\\0"));',
				'writeFileSync("procfs-carrier.pid", String(child.pid)); child.unref();',
			].join("\n"));
			const c = good({ argv: ["run", script, proc] }).command, path = verificationPath();
			expect((await runFixedVerification(root, c, resolveVerificationCommand(root, c, path), {
				home: root, path, _procRoot: proc,
			})).exit_code).toBe(0);
			carrierPid = Number(readFileSync(join(root, "procfs-carrier.pid"), "utf8"));
			expect(carrierPid).not.toBe(0);
			expect(() => process.kill(carrierPid, 0)).toThrow();
			await expect(runFixedVerification(root, c, resolveVerificationCommand(root, c, path), {
				home: root, path, _procRoot: join(root, "absent-proc"),
			})).rejects.toBeInstanceOf(VerificationCleanupError);
			carrierPid = Number(readFileSync(join(root, "procfs-carrier.pid"), "utf8"));
		} finally {
			if (platform) Object.defineProperty(process, "platform", platform);
			if (carrierPid) { try { process.kill(carrierPid, "SIGKILL"); } catch { /* Already exited. */ } }
			remove(root);
		}
	});
	test("findings digest remains identical to the Kernel algorithm", async () => {
		const { findingsDigestV2 } = await import("../plugins/immune-brain/runtime/kernel/reducer");
		const values = [{ id: "f-1", kind: "blocking", acceptance_id: "A1", summary: "broken" }, { id: "f-2", kind: "advisory", acceptance_id: null, summary: "nit" }];
		expect(findingsDigest(values)).toBe(findingsDigestV2(values as never));
	});
});

describe("delivery workspace materialization", () => {
	test("QA sees frozen tree bytes, preserving the live worktree and index", () => {
		const root = gitRepo();
		try {
			const base = git(root, ["rev-parse", "HEAD"]), snapshot = captureGitTaskRevisionSnapshot(root, ["ok.ts"], base);
			writeFileSync(join(root, "extra.ts"), "extra"); git(root, ["add", "extra.ts"]);
			const before = git(root, ["diff", "--cached", "--name-only"]);
			writeDeliveryTree(root, snapshot); expect(git(root, ["diff", "--cached", "--name-only"])).toBe(before);
			const delivery = materializeDeliveryWorkspace(root, tree(root));
			try { writeFileSync(join(root, "ok.ts"), "changed"); expect(readFileSync(join(delivery.root, "ok.ts"), "utf8")).toBe("export const ok = 1;\n"); }
			finally { delivery.cleanup(); }
		} finally { remove(root); }
	});
	test("ignores caller GIT_DIR and refuses tracked symlink escapes", () => {
		const root = gitRepo(), other = gitRepo(), previous = process.env.GIT_DIR;
		try {
			const original = tree(root); process.env.GIT_DIR = join(other, ".git");
			const delivery = materializeDeliveryWorkspace(root, original); delivery.cleanup();
			if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous;
			symlinkSync("/etc/passwd", join(root, "escape")); git(root, ["add", "escape"]); git(root, ["commit", "-qm", "escape"]);
			expect(() => materializeDeliveryWorkspace(root, tree(root))).toThrow(DeliveryWorkspaceError);
		} finally { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous; remove(root); remove(other); }
	});
	test("refuses intermediate symlink escapes", () => {
		const root = gitRepo(), outside = temp();
		try {
			writeFileSync(join(outside, "secret.txt"), "secret"); symlinkSync(".", join(root, "a"));
			symlinkSync(join("a", "..", "..", outside.split("/").pop()!, "secret.txt"), join(root, "b"));
			git(root, ["add", "a", "b"]); git(root, ["commit", "-qm", "escape"]);
			expect(() => materializeDeliveryWorkspace(root, tree(root))).toThrow(DeliveryWorkspaceError);
		} finally { remove(root); remove(outside); }
	});
	test("permits declared output but rejects ignored undeclared output and input changes", () => {
		const root = gitRepo();
		try {
			writeFileSync(join(root, ".gitignore"), "generated/\n"); git(root, ["add", ".gitignore"]); git(root, ["commit", "-qm", "ignore"]);
			const delivery = materializeDeliveryWorkspace(root, tree(root));
			try {
				mkdirSync(join(delivery.root, "generated")); writeFileSync(join(delivery.root, "generated/result"), "ok");
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal)).toThrow("contaminated");
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal, ["generated"])).not.toThrow();
				writeFileSync(join(delivery.root, "ok.ts"), "changed");
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal, ["generated"])).toThrow("contaminated");
			} finally { delivery.cleanup(); }
		} finally { remove(root); }
	});
	test("rejects prototype-named undeclared output", () => {
		const root = gitRepo();
		try {
			const delivery = materializeDeliveryWorkspace(root, tree(root));
			try {
				writeFileSync(join(delivery.root, "__proto__"), "undeclared");
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal)).toThrow("contaminated");
			} finally { delivery.cleanup(); }
		} finally { remove(root); }
	});
	test("rejects a dangling generated symlink that escapes through an intermediate symlink", () => {
		const root = gitRepo();
		try {
			const delivery = materializeDeliveryWorkspace(root, tree(root));
			try {
				mkdirSync(join(delivery.root, "out"));
				symlinkSync("..", join(delivery.root, "out/a"));
				symlinkSync("a/../imm-missing-target", join(delivery.root, "out/escape"));
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal, ["out"])).toThrow("escapes");
			} finally { delivery.cleanup(); }
		} finally { remove(root); }
	});
	test("rejects protected directory mode drift", () => {
		const root = gitRepo();
		try {
			mkdirSync(join(root, "src")); writeFileSync(join(root, "src/input"), "protected");
			git(root, ["add", "src/input"]); git(root, ["commit", "-qm", "directory"]);
			const delivery = materializeDeliveryWorkspace(root, tree(root));
			try {
				chmodSync(join(delivery.root, "src"), 0o700);
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal)).toThrow("contaminated");
			} finally { delivery.cleanup(); }
		} finally { remove(root); }
	});
	test("rejects protected directory special-mode drift", () => {
		const root = gitRepo();
		try {
			mkdirSync(join(root, "src")); writeFileSync(join(root, "src/input"), "protected");
			git(root, ["add", "src/input"]); git(root, ["commit", "-qm", "directory"]);
			const delivery = materializeDeliveryWorkspace(root, tree(root));
			try {
				chmodSync(join(delivery.root, "src"), 0o1755);
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal)).toThrow("contaminated");
			} finally { delivery.cleanup(); }
		} finally { remove(root); }
	});
	test("rejects delivery root mode drift", () => {
		const root = gitRepo();
		try {
			const delivery = materializeDeliveryWorkspace(root, tree(root));
			try {
				chmodSync(delivery.root, 0o777);
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal)).toThrow("contaminated");
			} finally { delivery.cleanup(); }
		} finally { remove(root); }
	});
	test.skipIf(process.platform !== "darwin")("rejects tracked symlink mode drift", () => {
		const root = gitRepo();
		try {
			symlinkSync("ok.ts", join(root, "ok-link")); git(root, ["add", "ok-link"]); git(root, ["commit", "-qm", "link"]);
			const delivery = materializeDeliveryWorkspace(root, tree(root));
			try {
				execFileSync("chmod", ["-h", "700", join(delivery.root, "ok-link")]);
				expect(() => assertDeliveryClean(delivery.root, delivery.tree, delivery.seal)).toThrow("contaminated");
			} finally { delivery.cleanup(); }
		} finally { remove(root); }
	});
	test("cleans read-only task output without following external symlinks", () => {
		const root = temp(), outside = temp();
		try {
			mkdirSync(join(root, "generated")); writeFileSync(join(root, "generated/result"), "ok");
			chmodSync(outside, 0o500); symlinkSync(outside, join(root, "generated/external"));
			chmodSync(join(root, "generated"), 0o555);
			removeTaskOwnedTree(root);
			expect(existsSync(root)).toBe(false);
			expect(lstatSync(outside).mode & 0o7777).toBe(0o500);
		} finally { chmodSync(outside, 0o700); remove(root); remove(outside); }
	});
});
