// Full verification of the batch branch once every child is integrated. The
// commands are the project's own convention, resolved by the Parent from its
// instruction files and recorded on the batch record when the batch starts, so
// the completing tick runs exactly what the literal user saw at confirmation.
// A failure marks the completion report as not passed; integrated commits are
// never rolled back. Only exit status and timing are recorded, never output.
import { spawnSync } from "node:child_process";

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
		if (/[|&;<>`$(){}]/.test(command))
			throw new Error("invalid final_verification: commands run without a shell, so shell syntax is not allowed");
		return command.trim().replace(/\s+/g, " ");
	});
}

export function runFinalVerification(
	root: string,
	commands: readonly string[],
	options: { timeoutMs?: number } = {},
): FinalVerificationReport {
	const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
	const results: FinalVerificationResult[] = [];
	for (const command of commands) {
		const [executable, ...argv] = command.split(" ");
		const started = Date.now();
		const run = spawnSync(executable!, argv, {
			cwd: root,
			stdio: "ignore",
			timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			env: process.env,
		});
		results.push({
			command,
			exit_code: run.status,
			signal: run.signal ?? (run.error ? String((run.error as NodeJS.ErrnoException).code ?? "spawn_failed") : null),
			passed: run.status === 0,
			duration_ms: Date.now() - started,
		});
	}
	return { passed: results.every((result) => result.passed), head: head.status === 0 ? head.stdout.trim() : null, results };
}
