// Full verification of the batch branch once every child is integrated. The
// commands are the project's own convention, resolved by the Parent from its
// instruction files and recorded on the batch record when the batch starts, so
// the completing tick runs exactly what the literal user saw at confirmation.
// A failure marks the completion report as not passed; integrated commits are
// never rolled back. Only exit status and timing are recorded, never output.
import { spawn, spawnSync } from "node:child_process";

export const MAX_FINAL_VERIFICATION_COMMANDS = 8;
const MAX_COMMAND_LENGTH = 512;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface FinalVerificationResult {
	command: string;
	exit_code: number | null;
	signal: string | null;
	passed: boolean;
	duration_ms: number;
}

export interface FinalVerificationReport {
	passed: boolean;
	head: string | null;
	results: FinalVerificationResult[];
}

/** Untrusted tool input: a short list of plain commands, split on whitespace and never run through a shell. */
export function parseFinalVerification(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FINAL_VERIFICATION_COMMANDS)
		throw new Error(`invalid final_verification: expected 1 to ${MAX_FINAL_VERIFICATION_COMMANDS} commands`);
	return value.map((command) => {
		if (typeof command !== "string" || !command.trim() || command.length > MAX_COMMAND_LENGTH || /[\0\n\r]/.test(command))
			throw new Error("invalid final_verification: each command must be one non-empty line");
		if (/[|&;<>`$(){}"'\\]/.test(command))
			throw new Error("invalid final_verification: commands run without a shell and are split on spaces, so shell syntax and quoting are not allowed");
		return command.trim().replace(/\s+/g, " ");
	});
}

/** One command, asynchronously, so a long suite never blocks the Host's event loop. */
function runOne(root: string, command: string, timeoutMs: number): Promise<FinalVerificationResult> {
	const [executable, ...argv] = command.split(" ");
	const started = Date.now();
	return new Promise((resolve) => {
		let settled = false;
		const finish = (exitCode: number | null, signal: string | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ command, exit_code: exitCode, signal, passed: exitCode === 0, duration_ms: Date.now() - started });
		};
		const child = spawn(executable!, argv, { cwd: root, stdio: "ignore", env: process.env });
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(null, "timeout");
		}, timeoutMs);
		child.once("error", (error) => finish(null, String((error as NodeJS.ErrnoException).code ?? "spawn_failed")));
		child.once("close", (code, signal) => finish(code, signal));
	});
}

export async function runFinalVerification(
	root: string,
	commands: readonly string[],
	options: { timeoutMs?: number } = {},
): Promise<FinalVerificationReport> {
	const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
	const results: FinalVerificationResult[] = [];
	for (const command of commands) results.push(await runOne(root, command, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
	return { passed: results.every((result) => result.passed), head: head.status === 0 ? head.stdout.trim() : null, results };
}
