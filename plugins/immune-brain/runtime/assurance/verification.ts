// Shared, bounded execution of project commands. No language/tool registry.
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { VERIFICATION_DESCRIPTOR_BOUNDS, VerificationDescriptorError, parseVerificationDescriptor, type VerificationCommand, type VerificationDescriptor } from "../verification_descriptor";
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

// A hosting process that carries one of these would point a command's Git calls
// at its own repository instead of the delivery materialization. Every other
// variable, including Git identity and transport settings, is user environment.
const GIT_REPOSITORY_BINDINGS: ReadonlySet<string> = new Set([
	"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_PREFIX",
]);

function verificationEnvironment(path: string, processToken: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(process.env))
		if (value !== undefined && !GIT_REPOSITORY_BINDINGS.has(name)) env[name] = value;
	return { ...env, PATH: path, IMM_VERIFICATION_PROCESS_TOKEN: processToken };
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
	return { entry };
}

export function assertCommandIdentity(frozen: FrozenCommand): void {
	if (JSON.stringify(identity(frozen.entry.invocation_path)) !== JSON.stringify(frozen.entry))
		throw new VerificationDescriptorError("verification executable identity changed");
}

export async function runFixedVerification(
	root: string,
	command: VerificationCommand,
	frozen: FrozenCommand,
	options: { signal?: AbortSignal; path: string; _processScanner?: string; _procRoot?: string },
): Promise<VerificationResult> {
	if (options.signal?.aborted) throw new VerificationAbortedError();
	if (process.platform === "win32") throw new VerificationDescriptorError("fixed verification process-group isolation requires a POSIX host");
	const cwd = insideVerificationRoot(root, resolve(root, command.cwd));
	assertCommandIdentity(frozen);
	// Token discovery is platform native. Only the BSD path needs `ps`, whose
	// environment modifier procps-ng rejects on Linux, and resolving it is a
	// hard requirement there but pointless here.
	const processScanner = process.platform === "linux" ? null
		: identity(options._processScanner ?? toolPath("ps", verificationPath()));
	const procRoot = options._procRoot ?? "/proc";
	const maxOutput = Math.min(command.max_output_bytes, VERIFICATION_DESCRIPTOR_BOUNDS.max_output_bytes);
	return new Promise((resolvePromise, rejectPromise) => {
		let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), captured = 0;
		let aborted = false, timed_out = false, output_limited = false, settled = false;
		const processToken = randomBytes(24).toString("hex");
		const child = spawn(frozen.entry.invocation_path, command.argv, {
			cwd, shell: false, detached: true,
			env: verificationEnvironment(options.path, processToken),
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
		// An environment we cannot read is only missing evidence about a process that
		// already left this run's session; in-session processes are cleaned without it.
		const procEnviron = (pid: number): string | null => {
			try { return readFileSync(join(procRoot, String(pid), "environ"), "utf8"); }
			catch { return null; }
		};
		// Session membership is the attribution evidence: /proc/<pid>/stat needs no
		// ptrace privilege and stays truthful when a process changes its uid, so a
		// descendant that drops privileges is still recognised as ours while an
		// unrelated privileged process never blocks verification.
		const procSession = (entry: string): number | null | undefined => {
			let stat: string;
			try { stat = readFileSync(join(procRoot, entry, "stat"), "utf8"); }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				return undefined;
			}
			// The quoted comm field may contain spaces and parentheses, so parse after it.
			const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
			const session = Number(fields[3]);
			// Session zero is a legitimate value that kernel threads carry, so only a
			// missing or unobservable number means the session could not be read.
			return Number.isSafeInteger(session) && session >= 0 ? session : undefined;
		};
		const scanTokenPids = (): Set<number> | null => {
			if (child.pid === undefined) return null;
			try {
				// The direct child is known without discovery, so it is always a candidate.
				const pids = new Set<number>([child.pid]);
				if (process.platform === "linux") {
					const marker = `IMM_VERIFICATION_PROCESS_TOKEN=${processToken}`;
					for (const entry of readdirSync(procRoot)) {
						if (!/^\d+$/.test(entry)) continue;
						const session = procSession(entry);
						if (session === undefined) throw new Error("verification process session is unreadable");
						if (session === null) continue; // the process vanished mid-scan
						// The command runs as its own session leader, so everything still in that
						// session belongs to it whatever uid it has taken on since.
						if (session === child.pid) { pids.add(Number(entry)); continue; }
						// A process that left the session is only ours if it still carries the
						// inherited token, which is checkable whenever the host lets us read it.
						const environ = procEnviron(Number(entry));
						if (environ !== null && environ.split("\0").includes(marker)) pids.add(Number(entry));
					}
					return pids;
				}
				if (processScanner === null || JSON.stringify(identity(processScanner.invocation_path)) !== JSON.stringify(processScanner))
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

export const QA_BASELINE_PATH = "docs/agents/qa-baseline.json";
export const QA_BASELINE_CONTRACT = "assurance_kernel/qa_baseline/v1";
const QA_BASELINE_MAX_BYTES = 262_144;
const QA_BASELINE_MAX_CHECKS = 16;

export interface QaBaselineCheck {
	id: string;
	descriptor: VerificationDescriptor;
}
export interface QaBaseline {
	/** Tree of the Enrollment `base_head`, the one a pre-existing failure is rerun against. */
	tree: string;
	checks: QaBaselineCheck[];
}

function baselineGit(root: string, args: string[]): string {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(process.env))
		if (value !== undefined && !GIT_REPOSITORY_BINDINGS.has(name)) env[name] = value;
	return execFileSync("git", ["-C", root, ...args], {
		encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: QA_BASELINE_MAX_BYTES * 2,
		env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
	});
}

/**
 * Read the project QA baseline from the Enrollment `base_head` tree, never from
 * the delivery, so a task cannot weaken its own baseline. An absent file adds
 * no checks; an unreadable commit or an invalid file fails closed.
 */
export function readQaBaseline(root: string, baseHead: string): QaBaseline {
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseHead))
		throw new VerificationDescriptorError("qa baseline base_head has an invalid identity");
	const tree = baselineGit(root, ["rev-parse", `${baseHead}^{tree}`]).trim();
	if (!baselineGit(root, ["ls-tree", "--name-only", tree, "--", QA_BASELINE_PATH]).trim()) return { tree, checks: [] };
	const text = baselineGit(root, ["cat-file", "blob", `${tree}:${QA_BASELINE_PATH}`]);
	if (Buffer.byteLength(text) > QA_BASELINE_MAX_BYTES)
		throw new VerificationDescriptorError("qa baseline exceeds the byte bound");
	let value: unknown;
	try { value = JSON.parse(text); }
	catch { throw new VerificationDescriptorError("qa baseline is not valid JSON"); }
	if (!value || typeof value !== "object" || Array.isArray(value)
		|| Object.keys(value).some(key => key !== "contract" && key !== "checks")
		|| (value as { contract?: unknown }).contract !== QA_BASELINE_CONTRACT
		|| !Array.isArray((value as { checks?: unknown }).checks)
		|| (value as { checks: unknown[] }).checks.length > QA_BASELINE_MAX_CHECKS)
		throw new VerificationDescriptorError("qa baseline contract is invalid");
	const seen = new Set<string>();
	const checks = (value as { checks: unknown[] }).checks.map((item): QaBaselineCheck => {
		const check = item as Record<string, unknown> | null;
		if (!check || typeof check !== "object" || Array.isArray(check)
			|| Object.keys(check).some(key => key !== "id" && key !== "verification")
			|| typeof check.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(check.id) || seen.has(check.id)
			|| !check.verification || typeof check.verification !== "object" || Array.isArray(check.verification))
			throw new VerificationDescriptorError("qa baseline check is invalid");
		seen.add(check.id);
		return { id: check.id, descriptor: parseVerificationDescriptor(JSON.stringify(check.verification)) };
	});
	return { tree, checks };
}
