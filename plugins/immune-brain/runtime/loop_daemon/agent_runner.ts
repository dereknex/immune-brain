/**
 * Loop Daemon: Headless Agent Session Runner (S9)
 *
 * Implements D11 item 1 of docs/specs/loop-daemon.spec.md and D2 of
 * docs/specs/loop-agent-scheduling.spec.md. One bounded headless Host session per
 * agent dispatch, started from the profile bound to its own loop role with the
 * role's turn budget and timeout, inside a worktree the daemon created, and with
 * an environment that carries the daemon's GitHub credential and nothing else
 * (ADR 0039 Decision 13).
 *
 * Completion is read from checkable evidence only (ADR 0039 Decision 2): the
 * expected output and its schema, the Git head of the daemon branch, and the
 * caller's own Kernel validation. A read-only role cannot write, so it prints its
 * result and the daemon writes whatever artifact it is owed. Session prose is
 * never parsed for an outcome, so a session that talks like a success but leaves
 * no evidence is recorded `failed`.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { agentRole, type AgentRole } from "../config/agent_roles.ts";
import type { ExecutorHost } from "../unattended/agent_profiles.ts";
import { catalogRole, LOOP_ROLE_DEFAULT_HOST, type LoopRoleBase, type LoopSessionConfig } from "./role_catalog.ts";

export const AGENT_SESSION_CONTRACT = "assurance_kernel/loop_agent_session/v1" as const;

export type AgentSessionKind = "clarify" | "planning" | "repair" | "leader" | "analyze";

/** The loop roles a session runs as (Spec loop-agent-scheduling D1/D2, Spec loop-leader D2.3). */
export type AgentSessionRole = "clarify" | "plan" | "repair" | "leader" | "analyze";

/** Roles whose argv never grants write permission (Spec D2). */
export const READ_ONLY_SESSION_ROLES: readonly AgentSessionRole[] = ["clarify", "plan", "leader", "analyze"];

/**
 * The built-in per-role session limits (Spec D2). Making them configurable is
 * `BR-DEFER-3`, so every role starts at the daemon's existing 40 turns / 900 s.
 */
export const ROLE_SESSION_LIMITS: Record<AgentSessionRole, { turn_budget: number; timeout_ms: number }> = {
	clarify: { turn_budget: 40, timeout_ms: 900_000 },
	plan: { turn_budget: 40, timeout_ms: 900_000 },
	repair: { turn_budget: 40, timeout_ms: 900_000 },
	leader: { turn_budget: 40, timeout_ms: 900_000 },
	analyze: { turn_budget: 40, timeout_ms: 900_000 },
};

/** A session kind runs as the role that owns it (Spec D1/D2). */
const ROLE_OF_KIND: Record<AgentSessionKind, AgentSessionRole> = {
	clarify: "clarify",
	planning: "plan",
	repair: "repair",
	leader: "leader",
	analyze: "analyze",
};

export function sessionRole(kind: AgentSessionKind): AgentSessionRole {
	return ROLE_OF_KIND[kind];
}

export function isReadOnlyRole(role: AgentSessionRole): boolean {
	return READ_ONLY_SESSION_ROLES.includes(role);
}

export interface AgentSessionRequest {
	kind: AgentSessionKind;
	/** The daemon-created worktree the session runs in; never the user's checkout. */
	worktree_path: string;
	/** What the session must do. Its output text is never read back as a verdict. */
	prompt: string;
	/**
	 * Repository-relative path inside the worktree a writable session must write its
	 * result to. A read-only role cannot write, so it prints its result instead.
	 */
	output_path?: string;
	turn_budget: number;
	timeout_ms: number;
	/** The only environment the session receives. */
	env: Record<string, string>;
	/**
	 * The exact Host profile this session runs on. Absent means the provider
	 * resolves the session kind's role the usual way; a leader dispatch sets
	 * it so a catalog role runs on its own Host, model, effort and advisory
	 * instructions even when its base has several roles (D3.5).
	 */
	profile?: CliAgentSessionProfile;
}

/** What a session process actually did; a provider never interprets it. */
export interface AgentSessionProcess {
	exit_code: number | null;
	exit_signal: string | null;
	timed_out: boolean;
	/** The session's printed reply; a read-only session has no other way to deliver its result. */
	stdout?: string;
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
	output_path: string | null;
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
	const readOnly = isReadOnlyRole(sessionRole(request.kind));
	const outputPath = request.output_path === undefined ? null : join(request.worktree_path, request.output_path);
	// A read-only role may not write, so its result is what it printed; nothing else is read.
	const sessionResult = (process: AgentSessionProcess): string | null => {
		if (!readOnly) return outputPath === null ? null : readOutput(outputPath);
		const printed = process.stdout ?? "";
		return printed.trim().length === 0 ? null : printed;
	};

	const conclude = (
		process: AgentSessionProcess,
		status: AgentSessionRecord["status"],
		reason: string,
	): AgentSessionRecord => {
		const output = sessionResult(process);
		return {
			contract: AGENT_SESSION_CONTRACT,
			kind: request.kind,
			worktree_path: request.worktree_path,
			output_path: request.output_path ?? null,
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

	const output = sessionResult(process);
	if (output === null)
		return conclude(
			process,
			"failed",
			readOnly ? `session_output_missing: ${request.kind} printed no result` : `expected_output_missing: ${request.output_path}`,
		);
	if (evidence.validate && !evidence.validate(output))
		return conclude(process, "failed", `expected_output_invalid: ${outputPath ?? request.kind}`);

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

/**
 * The base a loop session kind takes from the project catalog (Spec loop-leader
 * D1.6). The Lane Host stays `agents.executor` (BR-DEC-8).
 */
const LOOP_SESSION_BASE: Partial<Record<AgentSessionRole, LoopRoleBase>> = {
	clarify: "clarify",
	plan: "plan",
	repair: "repair",
	leader: "leader",
	analyze: "analyze",
};

/** The roles a session still takes from the `agents` table rather than the catalog. */
const LOOP_AGENT_ROLE: Partial<Record<AgentSessionRole | "executor", AgentRole>> = { executor: "executor" };

export interface CliAgentSessionProfile {
	host: ExecutorHost;
	model?: string | null;
	effort?: string | null;
	/** Repository-relative advisory instructions file of the catalog role. */
	instructions?: string | null;
}

/**
 * The Host profile bound to one role: the project catalog role of its base, or
 * the `agents` role that still owns it. A session never borrows another role's
 * Host, and never falls back to an agents binding the catalog replaced.
 */
export function loopRoleProfile(config: LoopSessionConfig, role: AgentSessionRole | "executor"): CliAgentSessionProfile {
	const base = LOOP_SESSION_BASE[role as AgentSessionRole];
	if (base) {
		const resolved = catalogRole(config.loop.value.roles, base);
		return {
			host: resolved?.host ?? LOOP_ROLE_DEFAULT_HOST,
			model: resolved?.model ?? null,
			effort: resolved?.effort ?? null,
			instructions: resolved?.instructions ?? null,
		};
	}
	const bound = agentRole(config.agents, LOOP_AGENT_ROLE[role] ?? "executor");
	return {
		host: (bound?.host ?? LOOP_ROLE_DEFAULT_HOST) as ExecutorHost,
		model: bound?.model ?? null,
		effort: bound?.effort ?? null,
		instructions: null,
	};
}

/** One session role's budget: the catalog role's limits, else the built-in per-role table. */
export function loopSessionLimits(config: LoopSessionConfig, role: AgentSessionRole): { turn_budget: number; timeout_ms: number } {
	const base = LOOP_SESSION_BASE[role];
	const resolved = base ? catalogRole(config.loop.value.roles, base) : null;
	if (!resolved) return ROLE_SESSION_LIMITS[role];
	return { turn_budget: resolved.limits.turn_budget, timeout_ms: resolved.limits.timeout_s * 1000 };
}

/**
 * The advisory instructions block a catalog role appends to its entry prompt
 * (D1.6): text only, so it changes what the session reads, never its tools,
 * permission flags or output contract.
 */
export function advisoryInstructions(instructions: string | null | undefined, root: string | null | undefined): string | null {
	if (!instructions) return null;
	const content = root === null || root === undefined ? null : readFileOrNull(join(root, instructions));
	if (content === null || content.trim().length === 0) throw new Error(`role_instructions_missing: ${instructions}`);
	return `## Advisory project instructions\n\n${content.trim()}`;
}

const SESSION_BINARY: Record<ExecutorHost, string> = {
	"claude-code": "claude",
	pi: "pi",
	antigravity: "agy",
};

/**
 * The flags a read-only session runs with, verified against each Host CLI's own
 * `--help`: `claude --permission-mode plan --allowedTools Read,Glob,Grep`,
 * `pi --tools read --no-mcp` and `agy --mode plan` (Spec D2).
 */
const READ_ONLY_HOST_ARGV: Partial<Record<ExecutorHost, string[]>> = {
	"claude-code": ["--permission-mode", "plan", "--allowedTools", "Read,Glob,Grep"],
	pi: ["--tools", "read", "--no-mcp"],
	antigravity: ["--mode", "plan"],
};

/** The Host CLI argv for one session, mirroring the Assurance CLI dispatcher's shape. */
export function sessionArguments(
	role: AgentSessionRole,
	profile: CliAgentSessionProfile,
	prompt: string,
	turnBudget: number,
): string[] {
	const model = profile.model ? ["--model", profile.model] : [];
	const readOnly = isReadOnlyRole(role);
	const readOnlyFlags = READ_ONLY_HOST_ARGV[profile.host];
	// Fail closed: a Host with no verified read-only mode is refused, never run writable.
	if (readOnly && readOnlyFlags === undefined)
		throw new Error(`role_readonly_unsupported: ${role} has no verified read-only mode on ${profile.host}`);
	if (profile.host === "claude-code") {
		return [
			"--print",
			"--no-session-persistence",
			"--max-turns",
			String(turnBudget),
			...(readOnly ? readOnlyFlags! : ["--permission-mode", "acceptEdits"]),
			...model,
			...(profile.effort ? ["--effort", profile.effort] : []),
			prompt,
		];
	}
	if (profile.host === "pi") {
		return [
			"--print",
			"--no-session",
			...(readOnly ? readOnlyFlags! : []),
			...model,
			...(profile.effort ? ["--thinking", profile.effort] : []),
			prompt,
		];
	}
	return [
		"--print",
		...(readOnly ? readOnlyFlags! : []),
		...model,
		...(profile.effort ? ["--effort", profile.effort] : []),
		prompt,
	];
}

/** Resolve the Host executable from PATH; absent means the Host is unavailable. */
export function sessionBinary(host: ExecutorHost): string | null {
	const name = SESSION_BINARY[host];
	if (!name) return null;
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
	/** One profile per role: the session runs on the Host bound to its own role. */
	profileFor: (role: AgentSessionRole) => CliAgentSessionProfile;
	/** The repository root a role's advisory instructions path resolves against. */
	instructions_root?: string | null;
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
			const profile = request.profile ?? options.profileFor(sessionRole(request.kind));
			// Built before the spawn, so unreadable instructions start no process.
			const advisory = advisoryInstructions(profile.instructions, options.instructions_root);
			const entry = advisory === null ? request.prompt : `${request.prompt}\n\n${advisory}`;
			const prompt = isReadOnlyRole(sessionRole(request.kind))
				? `${entry}\n\nPrint your structured JSON result to stdout and nothing else.`
				: `${entry}\n\nWrite your structured result to \`${request.output_path}\` in this worktree. That file, not your reply, is what is read.`;
			// Built before the spawn, so an unsupported read-only Host starts no process.
			const argv = sessionArguments(sessionRole(request.kind), profile, prompt, request.turn_budget);
			const binary = options.binary ?? sessionBinary(profile.host);
			// BR-DEC-9: an absent Host fails the role; it never starts another Host.
			if (!binary) throw new Error(`role_host_unavailable: ${profile.host} executable is not on PATH`);
			const res = spawn(binary, argv, {
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
				stdout: res.stdout ?? "",
			};
		},
	};
}
