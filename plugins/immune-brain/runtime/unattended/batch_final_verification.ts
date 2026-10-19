// Full verification of the batch branch once every child is integrated. The
// commands are the project's own convention, resolved by the Parent from its
// instruction files and recorded on the batch record when the batch starts, so
// the completing tick runs exactly what the literal user saw at confirmation.
// A failure marks the completion report as not passed; integrated commits are
// never rolled back. Only exit status and timing are recorded, never output.
// A native Parent binds the report to the scoped content identity of the
// required Tasks' scopes instead of HEAD: Git is the user's carrier, so a
// commit, amend or stash round trip with equal content keeps it passed.
import { createHash } from "node:crypto";
import { parseTaskIntentV1 } from "../kernel/intent";
import { spawn, spawnSync } from "node:child_process";
import { scopedContentIdentity } from "../workspace_scope";
import { withParentWorktree } from "./batch_worktrees";

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
	/** Present when the report is bound to scoped content rather than HEAD. */
	content_identity?: string;
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

export function parseFinalVerificationReport(value: unknown, commands?: readonly string[]): FinalVerificationReport {
	if (!value || typeof value !== "object") throw new Error("invalid final verification result");
	const report = value as FinalVerificationReport;
	if (typeof report.passed !== "boolean" || !(report.head === null || typeof report.head === "string") ||
		!(report.content_identity === undefined || typeof report.content_identity === "string") ||
		!Array.isArray(report.results) || !report.results.length || report.results.some(result =>
			!result || typeof result.command !== "string" || typeof result.passed !== "boolean" ||
			!(result.exit_code === null || Number.isInteger(result.exit_code)) ||
			!(result.signal === null || typeof result.signal === "string") ||
			!Number.isFinite(result.duration_ms) || result.duration_ms < 0 ||
			result.passed !== (result.exit_code === 0 && result.signal === null)))
		throw new Error("invalid final verification result");
	parseFinalVerification(report.results.map(result => result.command));
	if (report.passed && report.results.some(result => !result.passed)) throw new Error("contradictory final verification result");
	if (commands && JSON.stringify(report.results.map(result => result.command)) !== JSON.stringify(commands))
		throw new Error("final verification commands changed");
	return report;
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
			resolve({ command, exit_code: exitCode, signal, passed: exitCode === 0 && signal === null, duration_ms: Date.now() - started });
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

export function prepareFinalRepairCandidate(input: {
	initiative_slug: string; original_goal: string; scope_hint: string[];
	failure: FinalVerificationReport; prior_repairs: number;
}) {
	const failure = parseFinalVerificationReport(input.failure);
	if (failure.passed || (!failure.head && !failure.content_identity)) throw new Error("repair candidate requires a failed final verification bound to delivered content");
	if (!failure.results.some(result => !result.passed)) throw new Error("reconcile the verification environment or delivery HEAD before preparing a code repair");
	if (!Number.isInteger(input.prior_repairs) || input.prior_repairs < 0 || input.prior_repairs >= 2)
		throw new Error("Parent coordinator correction budget exhausted");
	const identity = createHash("sha256").update(JSON.stringify({ head: failure.content_identity ?? failure.head,
		results: failure.results.map(({ command, exit_code, signal }) => ({ command, exit_code, signal })) })).digest("hex");
	const taskId = `${input.initiative_slug.slice(0, 96)}-repair-${identity.slice(0, 12)}`;
	const candidate = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId,
		goal: input.original_goal, owner: "user", revision: 1, risk: "material", scope_hint: [...new Set([...input.scope_hint, `docs/plans/${taskId}.intent.json`])],
		acceptance: failure.results.map((result, index) => {
			const [executable, ...argv] = result.command.split(" ");
			return { id: `final-${index + 1}`, assertion: `Restore the original goal and pass final command ${index + 1}`,
				verification: JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2",
					command: { executable, argv, cwd: ".", timeout_ms: 120000, max_output_bytes: 131072 },
					environment: { prepare: null, writable_paths: [] } }, null, 2) + "\n" };
		}) });
	return { failure_id: `sha256:${identity}`, delivery_head: failure.content_identity ?? failure.head, candidate };
}

export async function runFinalVerification(
	root: string,
	commands: readonly string[],
	options: { timeoutMs?: number; scopes?: readonly string[]; parent_head?: string } = {},
): Promise<FinalVerificationReport> {
	if (options.parent_head) {
		return withParentWorktree(root, options.parent_head, path =>
			runFinalVerification(path, commands, { timeoutMs: options.timeoutMs }));
	}
	const verifiedCommands = parseFinalVerification([...commands])!;
	const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
	if (options.scopes) {
		// Content-bound: no clean-tree, HEAD or commit requirement; only the scoped bytes must hold still.
		const before = scopedContentIdentity(root, options.scopes);
		const results: FinalVerificationResult[] = [];
		for (const command of verifiedCommands) results.push(await runOne(root, command, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
		const unchanged = scopedContentIdentity(root, options.scopes) === before;
		return { passed: results.every(result => result.passed) && unchanged,
			head: head.status === 0 ? head.stdout.trim() : null, content_identity: before, results };
	}
	const clean = () => {
		const tracked = spawnSync("git", ["-C", root, "diff", "--quiet", "HEAD"]);
		const untracked = spawnSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" });
		return tracked.status === 0 && untracked.status === 0 && untracked.stdout.length === 0;
	};
	const cleanBefore = clean();
	const results: FinalVerificationResult[] = [];
	for (const command of verifiedCommands) results.push(await runOne(root, command, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
	const after = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
	const unchangedHead = head.status === 0 && after.status === 0 && head.stdout.trim() === after.stdout.trim();
	const cleanAfter = clean();
	return { passed: results.every(result => result.passed) && unchangedHead && cleanBefore && cleanAfter, head: head.status === 0 ? head.stdout.trim() : null, results };
}
