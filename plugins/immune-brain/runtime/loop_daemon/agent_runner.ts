/**
 * Loop Daemon: Headless Agent Session Runner (S9)
 *
 * Implements D11 item 1 of docs/specs/loop-daemon.spec.md. One bounded headless
 * Host session per agent dispatch, started from the configured Executor Host
 * profile with a turn budget and a timeout, inside a worktree the daemon
 * created, and with an environment that carries the daemon's GitHub credential
 * and nothing else (ADR 0039 Decision 13).
 *
 * Completion is read from checkable evidence only (ADR 0039 Decision 2): the
 * expected output file and its schema, the Git head of the daemon branch, and
 * the caller's own Kernel validation. Session prose is never parsed for an
 * outcome, so a session that talks like a success but leaves no evidence is
 * recorded `failed`.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ExecutorHost } from "../unattended/lane_supervisor.ts";

export const AGENT_SESSION_CONTRACT = "assurance_kernel/loop_agent_session/v1" as const;

export type AgentSessionKind = "analysis" | "planning" | "repair" | "judging";

export interface AgentSessionRequest {
	kind: AgentSessionKind;
	/** The daemon-created worktree the session runs in; never the user's checkout. */
	worktree_path: string;
	/** What the session must do. Its output text is never read back as a verdict. */
	prompt: string;
	/** Repository-relative path inside the worktree the session must write its result to. */
	output_path: string;
	turn_budget: number;
	timeout_ms: number;
	/** The only environment the session receives. */
	env: Record<string, string>;
}

/** What a session process actually did; a provider never interprets it. */
export interface AgentSessionProcess {
	exit_code: number | null;
	exit_signal: string | null;
	timed_out: boolean;
}

/** One injected session backend. Production starts a Host CLI; tests pass a fake. */
export interface AgentSessionProvider {
	run(request: AgentSessionRequest): Promise<AgentSessionProcess>;
}

/** What must be true before a session counts as delivered. */
export interface AgentSessionEvidence {
	/** The expected output bytes are the expected result; returns null/false when they are not. */
	validate?: (bytes: string) => unknown;
	/** The daemon branch whose head this session must leave readable. */
	branch?: string | null;
	/** Require that head to differ from the one the worktree started at, i.e. a commit happened. */
	expect_head_change?: boolean;
}

export interface AgentSessionRecord {
	contract: typeof AGENT_SESSION_CONTRACT;
	kind: AgentSessionKind;
	worktree_path: string;
	output_path: string;
	status: "completed" | "failed";
	reason: string;
	exit_code: number | null;
	exit_signal: string | null;
	timed_out: boolean;
	/** The expected output bytes, or null when the session never wrote them. */
	output: string | null;
	output_digest: string | null;
	git_head: string | null;
}

/**
 * The session environment: the daemon's GitHub credential and a PATH, nothing
 * else. The owner's ambient credentials, HOME and every other inherited variable
 * stay out of the session.
 */
export function sessionEnvironment(credential: string | null): Record<string, string> {
	const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" };
	if (credential) {
		env.GH_TOKEN = credential;
		env.GITHUB_TOKEN = credential;
	}
	return env;
}

function digest(bytes: string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** The commit a worktree's checked-out branch (or HEAD) points at, or null. */
export function readBranchHead(worktreePath: string, branch?: string | null): string | null {
	const ref = branch ? `refs/heads/${branch}` : "HEAD";
	const res = spawnSync("git", ["-C", worktreePath, "rev-parse", "--verify", "--quiet", ref], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (res.status !== 0) return null;
	const sha = (res.stdout ?? "").trim();
	return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

export interface AgentSessionDeps {
	readHead?: (worktreePath: string, branch?: string | null) => string | null;
	readOutput?: (path: string) => string | null;
}

function readFileOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/**
 * Run one session and decide its outcome from evidence. Every refusal names the
 * evidence that was missing, so the dispatch record says why it failed.
 */
export async function runAgentSession(
	request: AgentSessionRequest,
	provider: AgentSessionProvider,
	evidence: AgentSessionEvidence = {},
	deps: AgentSessionDeps = {},
): Promise<AgentSessionRecord> {
	const readHead = deps.readHead ?? readBranchHead;
	const readOutput = deps.readOutput ?? readFileOrNull;
	const headBefore = evidence.expect_head_change ? readHead(request.worktree_path, evidence.branch ?? null) : null;
	const outputPath = join(request.worktree_path, request.output_path);

	const conclude = (
		process: AgentSessionProcess,
		status: AgentSessionRecord["status"],
		reason: string,
	): AgentSessionRecord => {
		const output = readOutput(outputPath);
		return {
			contract: AGENT_SESSION_CONTRACT,
			kind: request.kind,
			worktree_path: request.worktree_path,
			output_path: request.output_path,
			status,
			reason,
			exit_code: process.exit_code,
			exit_signal: process.exit_signal,
			timed_out: process.timed_out,
			output,
			output_digest: output === null ? null : digest(output),
			git_head: readHead(request.worktree_path, evidence.branch ?? null),
		};
	};

	let process: AgentSessionProcess;
	try {
		process = await provider.run(request);
	} catch (error) {
		return conclude(
			{ exit_code: null, exit_signal: null, timed_out: false },
			"failed",
			`session_provider_error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	if (process.timed_out) return conclude(process, "failed", `session_timed_out after ${request.timeout_ms}ms`);
	if (process.exit_code !== 0)
		return conclude(
			process,
			"failed",
			`session_exit_nonzero: exit ${process.exit_code ?? "null"}${process.exit_signal ? ` signal ${process.exit_signal}` : ""}`,
		);

	const output = readOutput(outputPath);
	if (output === null) return conclude(process, "failed", `expected_output_missing: ${request.output_path}`);
	if (evidence.validate && !evidence.validate(output))
		return conclude(process, "failed", `expected_output_invalid: ${request.output_path}`);

	if (evidence.branch) {
		const head = readHead(request.worktree_path, evidence.branch);
		if (head === null) return conclude(process, "failed", `expected_git_head_missing: ${evidence.branch}`);
		if (evidence.expect_head_change && head === headBefore)
			return conclude(process, "failed", `expected_git_head_unchanged: ${evidence.branch} is still ${head}`);
	}

	return conclude(
		process,
		"completed",
		`evidence: output ${output === null ? "none" : digest(output)}, head ${readHead(request.worktree_path, evidence.branch ?? null) ?? "none"}`,
	);
}

export interface CliAgentSessionProfile {
	host: ExecutorHost;
	model?: string | null;
	effort?: string | null;
}

const SESSION_BINARY: Record<ExecutorHost, string> = {
	"claude-code": "claude",
	pi: "pi",
	antigravity: "agy",
};

/** The Host CLI argv for one session, mirroring the Assurance CLI dispatcher's shape. */
export function sessionArguments(
	profile: CliAgentSessionProfile,
	prompt: string,
	turnBudget: number,
): string[] {
	const model = profile.model ? ["--model", profile.model] : [];
	if (profile.host === "claude-code") {
		return [
			"--print",
			"--no-session-persistence",
			"--max-turns",
			String(turnBudget),
			"--permission-mode",
			"acceptEdits",
			...model,
			...(profile.effort ? ["--effort", profile.effort] : []),
			prompt,
		];
	}
	if (profile.host === "pi") {
		return [
			"--print",
			"--no-session",
			...model,
			...(profile.effort ? ["--thinking", profile.effort] : []),
			prompt,
		];
	}
	return ["--print", ...model, ...(profile.effort ? ["--effort", profile.effort] : []), prompt];
}

/** Resolve the Host executable from PATH; absent means the Host is unavailable. */
export function sessionBinary(host: ExecutorHost): string | null {
	const name = SESSION_BINARY[host];
	return (
		(process.env.PATH ?? "")
			.split(delimiter)
			.map((dir) => join(dir || ".", name))
			.find((path) => {
				try {
					accessSync(path, constants.X_OK);
					return true;
				} catch {
					return false;
				}
			}) ?? null
	);
}

export interface CliAgentSessionOptions {
	profile: CliAgentSessionProfile;
	/** Test seam; production resolves the Host CLI from PATH. */
	binary?: string | null;
	/** Where the transcript of each session is kept; absent keeps none. */
	log_dir?: string | null;
	spawn?: typeof spawnSync;
}

const SESSION_OUTPUT_BOUND = 8 * 1024 * 1024;

/**
 * The production provider: one bounded Host CLI process per session, with the
 * session's own transcript kept out of the worktree. The expected output file is
 * the session's responsibility; this provider reports only process facts.
 */
export function createCliAgentSessionProvider(options: CliAgentSessionOptions): AgentSessionProvider {
	const spawn = options.spawn ?? spawnSync;
	return {
		async run(request: AgentSessionRequest): Promise<AgentSessionProcess> {
			const binary = options.binary ?? sessionBinary(options.profile.host);
			if (!binary) throw new Error(`agent_session_host_unavailable: ${options.profile.host} executable is not on PATH`);
			const prompt = `${request.prompt}\n\nWrite your structured result to \`${request.output_path}\` in this worktree. That file, not your reply, is what is read.`;
			const res = spawn(binary, sessionArguments(options.profile, prompt, request.turn_budget), {
				cwd: request.worktree_path,
				env: request.env,
				encoding: "utf8",
				timeout: request.timeout_ms,
				maxBuffer: SESSION_OUTPUT_BOUND,
				stdio: ["ignore", "pipe", "pipe"],
			});
			if (options.log_dir) {
				try {
					mkdirSync(options.log_dir, { recursive: true, mode: 0o700 });
					const transcript = join(options.log_dir, `${request.kind}-${process.hrtime.bigint()}.log`);
					writeFileSync(transcript, `${res.stdout ?? ""}\n${res.stderr ?? ""}`, { mode: 0o600 });
					chmodSync(transcript, 0o600);
				} catch {}
			}
			const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
			return {
				exit_code: res.status ?? null,
				exit_signal: res.signal ?? null,
				timed_out: timedOut,
			};
		},
	};
}
