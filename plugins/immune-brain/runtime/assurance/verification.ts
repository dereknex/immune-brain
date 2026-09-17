// Shared, bounded execution of project commands. No language/tool registry.
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { VERIFICATION_DESCRIPTOR_BOUNDS, VerificationDescriptorError, type VerificationCommand } from "../verification_descriptor";
export * from "../verification_descriptor";

export interface ExecutableIdentity {
	path: string;
	invocation_path: string;
	dev: number;
	ino: number;
	content_hash: string;
}
export interface FrozenCommand {
	entry: ExecutableIdentity;
	interpreter: ExecutableIdentity | null;
	interpreter_args: string[];
}
export interface VerificationResult {
	exit_code: number;
	stdout: string;
	stderr: string;
	timed_out: boolean;
	output_limited: boolean;
}

export class VerificationAbortedError extends Error {
	constructor() { super("fixed verification aborted"); this.name = "VerificationAbortedError"; }
}
export class VerificationLaunchError extends Error {
	constructor() { super("verification process failed to start"); this.name = "VerificationLaunchError"; }
}
export class VerificationCleanupError extends Error {
	constructor() { super("verification process cleanup failed"); this.name = "VerificationCleanupError"; }
}

// Bounded window for proving that a signalled process is gone. SIGKILL delivery
// is not proof of exit, so the set is re-scanned and re-checked until it drains.
export const CLEANUP_CONFIRM_TIMEOUT_MS = 2_000;
export const CLEANUP_CONFIRM_POLL_MS = 25;

export function insideVerificationRoot(root: string, candidate: string): string {
	const realRoot = realpathSync(root);
	const real = realpathSync(candidate);
	const rel = relative(realRoot, real);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		throw new VerificationDescriptorError("verification path escapes the materialization");
	return real;
}

export function verificationPath(): string {
	return (process.env.PATH ?? "").split(delimiter).filter(path => isAbsolute(path)).join(delimiter);
}

function toolPath(name: string, path: string): string {
	for (const dir of path.split(delimiter).filter(isAbsolute)) {
		const candidate = join(dir, name);
		try { accessSync(candidate, constants.X_OK); if (statSync(candidate).isFile()) return candidate; }
		catch { /* Search the remaining host-owned PATH entries. */ }
	}
	throw new VerificationDescriptorError("verification tool is unavailable on this host");
}

function identity(path: string): ExecutableIdentity {
	try {
		const real = realpathSync(path);
		accessSync(real, constants.X_OK);
		const stat = statSync(real);
		if (!stat.isFile()) throw new Error("not a file");
		return { path: real, invocation_path: path, dev: stat.dev, ino: stat.ino, content_hash: `sha256:${createHash("sha256").update(readFileSync(real)).digest("hex")}` };
	} catch { throw new VerificationDescriptorError("verification executable is unavailable or not executable"); }
}

export function resolveVerificationCommand(root: string, command: VerificationCommand, path = verificationPath()): FrozenCommand {
	insideVerificationRoot(root, resolve(root, command.cwd));
	const entry = identity(command.executable.startsWith("./")
		? insideVerificationRoot(root, resolve(root, command.executable)) : toolPath(command.executable, path));
	const prefix = readFileSync(entry.path).subarray(0, 512).toString("utf8");
	let interpreter: ExecutableIdentity | null = null;
	let interpreter_args: string[] = [];
	if (prefix.startsWith("#!")) {
		const lineEnd = prefix.indexOf("\n");
		if (lineEnd < 0) throw new VerificationDescriptorError("verification interpreter declaration is unbounded");
		const parts = prefix.slice(2, lineEnd).trim().split(/\s+/);
		const name = parts.shift()!;
		if (!isAbsolute(name)) throw new VerificationDescriptorError("verification interpreter must be absolute");
		if (name === "/usr/bin/env" || name === "/bin/env") {
			if (parts.length !== 1 || !/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(parts[0]!))
				throw new VerificationDescriptorError("verification interpreter resolution is ambiguous; use a direct interpreter command");
			interpreter = identity(toolPath(parts[0]!, path));
		} else {
			if (parts.length > 1) throw new VerificationDescriptorError("verification interpreter arguments are ambiguous");
			interpreter = identity(name);
			interpreter_args = parts;
		}
		if (readFileSync(interpreter.path).subarray(0, 2).toString() === "#!")
			throw new VerificationDescriptorError("verification interpreter is itself a script; resolve the host tool explicitly");
	}
	return { entry, interpreter, interpreter_args };
}

export function assertCommandIdentity(frozen: FrozenCommand): void {
	for (const item of [frozen.entry, frozen.interpreter]) {
		if (item && JSON.stringify(identity(item.invocation_path)) !== JSON.stringify(item))
			throw new VerificationDescriptorError("verification executable identity changed");
	}
}

export async function runFixedVerification(
	root: string,
	command: VerificationCommand,
	frozen: FrozenCommand,
	options: { signal?: AbortSignal; home: string; path: string; _processScanner?: string } ,
): Promise<VerificationResult> {
	if (options.signal?.aborted) throw new VerificationAbortedError();
	if (process.platform === "win32") throw new VerificationDescriptorError("fixed verification process-group isolation requires a POSIX host");
	const cwd = insideVerificationRoot(root, resolve(root, command.cwd));
	assertCommandIdentity(frozen);
	const processScanner = identity(options._processScanner ?? toolPath("ps", verificationPath()));
	const maxOutput = Math.min(command.max_output_bytes, VERIFICATION_DESCRIPTOR_BOUNDS.max_output_bytes);
	return new Promise((resolvePromise, rejectPromise) => {
		let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), captured = 0;
		let aborted = false, timed_out = false, output_limited = false, settled = false;
		const processToken = randomBytes(24).toString("hex");
		const args = frozen.interpreter
			? [...frozen.interpreter_args, frozen.entry.path, ...command.argv] : command.argv;
		const child = spawn(frozen.interpreter?.invocation_path ?? frozen.entry.invocation_path, args, {
			cwd, shell: false, detached: true,
			env: { PATH: options.path, HOME: options.home, TMPDIR: options.home, XDG_CACHE_HOME: options.home,
				IMM_VERIFICATION_PROCESS_TOKEN: processToken },
			stdio: ["ignore", "pipe", "pipe"],
		});
		const killGroup = () => {
			if (child.pid !== undefined) try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
		};
		// Signal every candidate and its process group. A refusal is not evidence in
		// either direction, so the result is ignored and liveness below decides.
		const signalPids = (pids: Iterable<number>): void => {
			for (const pid of pids) for (const target of [-pid, pid]) {
				try { process.kill(target, "SIGKILL"); } catch { /* Re-checked by liveness. */ }
			}
		};
		// ESRCH is the only evidence a process is gone: an EPERM refusal leaves it
		// unknown, so it counts as still present and fails the cleanup closed.
		const alive = (pid: number): boolean => {
			try { process.kill(pid, 0); return true; }
			catch (error) { return (error as NodeJS.ErrnoException | undefined)?.code !== "ESRCH"; }
		};
		const scanTokenPids = (): Set<number> | null => {
			const pids = new Set<number>();
			if (child.pid !== undefined) pids.add(child.pid);
			try {
				if (JSON.stringify(identity(processScanner.invocation_path)) !== JSON.stringify(processScanner))
					throw new Error("process scanner identity changed");
				for (const line of execFileSync(processScanner.invocation_path, ["eww", "-axo", "pid=,command="], {
					encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 5000,
				}).split("\n")) {
					if (!line.includes(processToken)) continue;
					const pid = Number(/^\s*(\d+)/.exec(line)?.[1]);
					if (Number.isSafeInteger(pid) && pid > 1) pids.add(pid);
				}
				return pids;
			} catch { return null; }
		};
		// Cleanup must be proved before any outcome settles: a scan that fails and
		// descendants still alive are both re-checked within the bounded window,
		// and anything left unproven when it closes fails the run closed.
		const killTree = async (): Promise<boolean> => {
			const deadline = Date.now() + CLEANUP_CONFIRM_TIMEOUT_MS;
			for (;;) {
				// The direct child needs no discovery to be known, so it is signalled on
				// every pass: a scanner failure must never return a running process.
				if (child.pid !== undefined) signalPids([child.pid]);
				const pids = scanTokenPids();
				if (pids !== null) {
					signalPids(pids);
					if ([...pids].every((pid) => !alive(pid))) return true;
				}
				if (Date.now() >= deadline) return false;
				await new Promise((wake) => setTimeout(wake, CLEANUP_CONFIRM_POLL_MS));
			}
		};
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const closePipes = () => { child.stdout?.destroy(); child.stderr?.destroy(); };
		const finish = async (code: number | null) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
			const cleaned = await killTree();
			// An unproven cleanup outranks every outcome, cancellation included: any
			// other error would hand the caller back a delivery whose process may
			// still be running against it.
			if (!cleaned) { rejectPromise(new VerificationCleanupError()); return; }
			if (aborted) { rejectPromise(new VerificationAbortedError()); return; }
			try { assertCommandIdentity(frozen); } catch (error) { rejectPromise(error); return; }
			resolvePromise({ exit_code: timed_out || output_limited ? 1 : code ?? 1,
				stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timed_out, output_limited });
		};
		const failLaunch = () => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
			closePipes();
			// A launch failure still owes a confirmed cleanup before it settles.
			void killTree().then((cleaned) => rejectPromise(
				cleaned ? new VerificationLaunchError() : new VerificationCleanupError()));
		};
		const onAbort = () => { aborted = true; closePipes(); void finish(null); };
		options.signal?.addEventListener("abort", onAbort, { once: true });
		if (options.signal?.aborted) onAbort();
		if (!settled) timeout = setTimeout(() => { timed_out = true; closePipes(); void finish(null); }, command.timeout_ms);
		const append = (chunk: Buffer, channel: "stdout" | "stderr") => {
			if (output_limited) return;
			const accepted = chunk.subarray(0, Math.max(0, maxOutput - captured));
			captured += accepted.length;
			if (channel === "stdout") stdout = Buffer.concat([stdout, accepted]);
			else stderr = Buffer.concat([stderr, accepted]);
			if (accepted.length < chunk.length) { output_limited = true; closePipes(); void finish(null); }
		};
		child.stdout?.on("data", (chunk: Buffer) => append(chunk, "stdout"));
		child.stderr?.on("data", (chunk: Buffer) => append(chunk, "stderr"));
		child.once("error", failLaunch);
		// A successful parent must not leave descendants holding pipes open.
		child.once("exit", killGroup);
		child.once("close", (code) => { void finish(code); });
	});
}

/** Must remain byte-identical to the Kernel findings digest. */
export function findingsDigest(findings: Array<{ id: string; kind: string; acceptance_id: string | null; summary: string }>): string {
	const normalized = findings.map(f => JSON.stringify({ acceptance_id: f.acceptance_id, id: f.id, kind: f.kind, summary: f.summary }));
	return `sha256:${createHash("sha256").update(`[${normalized.join(",")}]`).digest("hex")}`;
}
