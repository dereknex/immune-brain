/**
 * Loop Daemon: Per-Role Sessions (S2)
 *
 * Verifies S2-AC1 and S2-AC2 under
 * docs/plans/loop-sched-s2-role-sessions.intent.json and D2 of
 * docs/specs/loop-agent-scheduling.spec.md (BR-DEC-4, BR-DEFER-3).
 *
 * - Positive control: every loop role runs on the profile bound to that role and
 *   reads its 40 turns / 900 s from one per-role table.
 * - Negative control: `judging`, `clarify` and `plan` argv never carries
 *   `acceptEdits` and carries the Host's read-tool allow-list; a read-only role on
 *   a Host with no verified read-only mode is refused with
 *   `role_readonly_unsupported` before any process starts; a read-only session
 *   delivers its result on stdout, not through a file it may not write.
 * - Boundary control: the daemon's own loop sessions no longer read
 *   `lanes.executor_*`; the executor role does not become read-only.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { resolveAgents, type AgentsSection } from "../plugins/immune-brain/runtime/config/agent_roles.ts";
import {
	createCliAgentSessionProvider,
	isReadOnlyRole,
	loopRoleProfile,
	READ_ONLY_SESSION_ROLES,
	ROLE_SESSION_LIMITS,
	runAgentSession,
	sessionArguments,
	sessionRole,
	type AgentSessionRequest,
	type AgentSessionRole,
	type CliAgentSessionProfile,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";

const ROLES: AgentSessionRole[] = ["judging", "clarify", "plan", "repair"];

const HOSTS: Array<CliAgentSessionProfile["host"]> = ["claude-code", "pi", "antigravity"];

/** The read-tool allow-list each Host CLI takes, verified against its own `--help`. */
const READ_TOOL_ALLOW_LIST: Record<CliAgentSessionProfile["host"], string[]> = {
	"claude-code": ["--permission-mode", "plan", "--allowedTools", "Read,Glob,Grep"],
	pi: ["--tools", "read", "--no-mcp"],
	antigravity: ["--mode", "plan"],
};

/** The one flag per Host that only a read-only session may carry. */
const READ_ONLY_ONLY_FLAG: Record<CliAgentSessionProfile["host"], string> = {
	"claude-code": "--allowedTools",
	pi: "--tools",
	antigravity: "--mode",
};

/** The user file's `agents` section resolved alone (no project file). */
function userAgents(agents: Record<string, unknown> | null): AgentsSection {
	const resolved = resolveAgents({ user: agents, project: null, files: { user: "user.json", project: "project.json" } });
	expect(resolved.errors).toEqual([]);
	return resolved.agents;
}

function request(kind: AgentSessionRequest["kind"], worktree: string): AgentSessionRequest {
	return {
		kind,
		worktree_path: worktree,
		prompt: "Decide something",
		turn_budget: ROLE_SESSION_LIMITS[sessionRole(kind)].turn_budget,
		timeout_ms: ROLE_SESSION_LIMITS[sessionRole(kind)].timeout_ms,
		env: { PATH: "/usr/bin:/bin" },
	};
}

describe("Loop Daemon: Per-Role Sessions (S2)", () => {
	const cleanups: Array<() => void> = [];
	afterEach(() => {
		for (const cleanup of cleanups) cleanup();
		cleanups.length = 0;
	});

	function worktree(): string {
		const path = mkdtempSync(join(tmpdir(), "imm-role-sessions-"));
		cleanups.push(() => rmSync(path, { recursive: true, force: true }));
		return path;
	}

	/** Puts stub Host executables first on PATH, so resolution never depends on the machine. */
	function stubHostsOnPath(...names: string[]): void {
		const dir = mkdtempSync(join(tmpdir(), "imm-role-bins-"));
		for (const name of names) writeFileSync(join(dir, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		const previous = process.env.PATH;
		process.env.PATH = [dir, previous ?? ""].join(delimiter);
		cleanups.push(() => {
			process.env.PATH = previous;
			rmSync(dir, { recursive: true, force: true });
		});
	}

	it("runs every loop role at 40 turns / 900 s from one per-role table (S2-AC1)", () => {
		expect(Object.keys(ROLE_SESSION_LIMITS).sort()).toEqual([...ROLES].sort());
		for (const role of ROLES) expect(ROLE_SESSION_LIMITS[role]).toEqual({ turn_budget: 40, timeout_ms: 900_000 });
		// Each session kind runs as the role that owns it (D1/D2, D8).
		expect(sessionRole("judging")).toBe("judging");
		expect(sessionRole("clarify")).toBe("clarify");
		expect(sessionRole("planning")).toBe("plan");
		expect(sessionRole("repair")).toBe("repair");
	});

	it("never grants a write permission to judging, clarify or plan, and always passes the read-tool allow-list", () => {
		for (const host of HOSTS) {
			for (const role of READ_ONLY_SESSION_ROLES) {
				const argv = sessionArguments(role, { host, model: "m", effort: "high" }, "prompt", 40);
				const readOnlyFlags = READ_TOOL_ALLOW_LIST[host];
				expect(argv.join(" ")).not.toContain("acceptEdits");
				for (const flag of readOnlyFlags) expect(argv).toContain(flag);
				expect(argv.at(-1)).toBe("prompt");
			}
			// The writable repair role is unchanged: the Host's edit mode, no read-only flag.
			const repair = sessionArguments("repair", { host }, "prompt", 40);
			if (host === "claude-code") expect(repair.join(" ")).toContain("acceptEdits");
			expect(repair).not.toContain(READ_ONLY_ONLY_FLAG[host]);
		}
		expect(isReadOnlyRole("repair")).toBe(false);
		expect(isReadOnlyRole("judging")).toBe(true);
	});

	it("starts each session on the profile bound to its own role", async () => {
		// judging runs as triage, clarify/plan as planner, repair as executor (ADR 0041).
		const agents = userAgents({
			profiles: {
				opus: { host: "claude-code", model: "claude-opus-5-5", effort: "high" },
				flash: { host: "pi", model: "auto/deepseek-v4.1-flash" },
			},
			triage: "opus",
			planner: "opus",
			executor: "flash",
		});

		expect(loopRoleProfile(agents, "judging")).toEqual({ host: "claude-code", model: "claude-opus-5-5", effort: "high" });
		expect(loopRoleProfile(agents, "repair")).toEqual({ host: "pi", model: "auto/deepseek-v4.1-flash", effort: null });
		expect(loopRoleProfile(agents, "executor")).toEqual({ host: "pi", model: "auto/deepseek-v4.1-flash", effort: null });

		stubHostsOnPath("claude", "pi");
		const asked: AgentSessionRole[] = [];
		const spawned: Array<{ binary: string; argv: string[] }> = [];
		const provider = createCliAgentSessionProvider({
			profileFor: (role) => {
				asked.push(role);
				return loopRoleProfile(agents, role);
			},
			spawn: ((binary: string, argv: string[]) => {
				spawned.push({ binary, argv });
				return { status: 0, stdout: '{"ok":true}', stderr: "", signal: null };
			}) as never,
		});

		const [judged, repaired] = await Promise.all([
			runAgentSession(request("judging", worktree()), provider),
			runAgentSession(request("repair", worktree()), provider),
		]);
		// Judging ran on the judging role's Host and model; repair on its own.
		expect(asked).toEqual(["judging", "repair"]);
		expect(spawned[0]!.binary.endsWith("/claude")).toBe(true);
		expect(spawned[0]!.argv).toContain("claude-opus-5-5");
		expect(spawned[1]!.binary.endsWith("/pi")).toBe(true);
		expect(spawned[1]!.argv).toContain("auto/deepseek-v4.1-flash");
		expect(judged.status).toBe("completed");
		// A read-only session delivers what it printed; nothing is read from disk.
		expect(judged.output).toBe('{"ok":true}');
		expect(judged.output_path).toBeNull();
		// The writable repair role still has to leave its result in the worktree.
		expect(repaired.status).toBe("failed");
		expect(repaired.reason).toContain("expected_output_missing");
	});

	it("refuses a read-only role on a Host with no verified read-only mode and starts no process", async () => {
		const path = worktree();
		let spawns = 0;
		const provider = createCliAgentSessionProvider({
			profileFor: () => ({ host: "unverified-host" as never }),
			spawn: (() => {
				spawns += 1;
				return { status: 0, stdout: "{}", stderr: "", signal: null };
			}) as never,
		});

		const record = await runAgentSession(request("judging", path), provider);
		expect(spawns).toBe(0);
		expect(record.status).toBe("failed");
		expect(record.reason).toContain("role_readonly_unsupported");

		expect(() => sessionArguments("plan", { host: "unverified-host" as never }, "prompt", 40)).toThrow("role_readonly_unsupported");
	});

	it("falls back to the documented Host only when the role is unset", () => {
		const unset = userAgents(null);
		for (const role of ROLES) expect(loopRoleProfile(unset, role)).toEqual({ host: "claude-code", model: null, effort: null });
	});

	it("keeps the daemon's loop sessions off the legacy executor leaves", () => {
		const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
		for (const path of [
			"plugins/immune-brain/runtime/loop_daemon/cli.ts",
			"plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts",
		]) {
			const source = read(path);
			for (const leaf of ["lanes.executor_", "config.lanes"]) expect(source).not.toContain(leaf);
		}
	});
});
