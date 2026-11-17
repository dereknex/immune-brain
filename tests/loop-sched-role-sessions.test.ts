/**
 * Loop Daemon: Per-Role Sessions (S2)
 *
 * Verifies S2-AC1 and S2-AC2 under
 * docs/plans/loop-sched-s2-role-sessions.intent.json and D2 of
 * docs/specs/loop-agent-scheduling.spec.md (BR-DEC-4, BR-DEFER-3).
 *
 * - Positive control: every loop role runs on the profile bound to that role and
 *   reads its 40 turns / 900 s from one per-role table.
 * - Negative control: `analyze`, `clarify` and `plan` argv never carries
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
	loopSessionLimits,
	READ_ONLY_SESSION_ROLES,
	ROLE_SESSION_LIMITS,
	runAgentSession,
	sessionArguments,
	sessionRole,
	type AgentSessionRequest,
	type AgentSessionRole,
	type CliAgentSessionProfile,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";
import { resolveLoopRoles, type LoopSessionConfig } from "../plugins/immune-brain/runtime/loop_daemon/role_catalog.ts";

const ROLES: AgentSessionRole[] = ["clarify", "plan", "repair", "leader", "analyze"];

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

/** A resolved config's two session sources: the agents table and a project catalog. */
function loopConfig(agents: AgentsSection | null, roles: Record<string, unknown> = {}): LoopSessionConfig {
	return { agents: agents ?? userAgents(null), loop: { value: { roles: resolveLoopRoles({ roles, root: tmpdir() }).roles } } };
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
		expect(sessionRole("analyze")).toBe("analyze");
		expect(sessionRole("clarify")).toBe("clarify");
		expect(sessionRole("planning")).toBe("plan");
		expect(sessionRole("repair")).toBe("repair");
		expect(sessionRole("leader")).toBe("leader");
	});

	it("never grants a write permission to analyze, clarify or plan, and always passes the read-tool allow-list", () => {
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
		expect(isReadOnlyRole("analyze")).toBe(true);
	});

	it("starts each session on the profile bound to its own role", async () => {
		// Every loop session kind runs as the catalog role of its base (Spec loop-leader D1.6).
		const agents = userAgents({
			profiles: {
				opus: { host: "claude-code", model: "claude-opus-5-5", effort: "high" },
				flash: { host: "pi", model: "auto/deepseek-v4.1-flash" },
			},
			triage: "opus",
			planner: "opus",
			executor: "flash",
		});
		const config = loopConfig(agents, {
			// The user's `agents.planner` binding no longer reaches the loop's plan session.
			planner: { base: "plan", host: "claude-code", model: "claude-opus-5-5", effort: "high" },
			repair: { base: "repair", host: "pi", model: "auto/deepseek-v4.1-flash" },
		});

		expect(loopRoleProfile(config, "analyze")).toEqual({ host: "claude-code", model: null, effort: null, instructions: null });
		expect(loopRoleProfile(config, "repair")).toEqual({ host: "pi", model: "auto/deepseek-v4.1-flash", effort: null, instructions: null });
		expect(loopRoleProfile(config, "plan")).toEqual({ host: "claude-code", model: "claude-opus-5-5", effort: "high", instructions: null });
		// The Lane Host still comes from `agents.executor` (BR-DEC-8).
		expect(loopRoleProfile(config, "executor")).toEqual({ host: "pi", model: "auto/deepseek-v4.1-flash", effort: null, instructions: null });

		stubHostsOnPath("claude", "pi");
		const asked: AgentSessionRole[] = [];
		const spawned: Array<{ binary: string; argv: string[] }> = [];
		const provider = createCliAgentSessionProvider({
			profileFor: (role) => {
				asked.push(role);
				return loopRoleProfile(config, role);
			},
			spawn: ((binary: string, argv: string[]) => {
				spawned.push({ binary, argv });
				return { status: 0, stdout: '{"ok":true}', stderr: "", signal: null };
			}) as never,
		});

		const [analyzed, repaired] = await Promise.all([
			runAgentSession(request("analyze", worktree()), provider),
			runAgentSession(request("repair", worktree()), provider),
		]);
		// The analyze session ran on its catalog role's Host; repair on its own.
		expect(asked).toEqual(["analyze", "repair"]);
		expect(spawned[0]!.binary.endsWith("/claude")).toBe(true);
		expect(spawned[1]!.binary.endsWith("/pi")).toBe(true);
		expect(spawned[1]!.argv).toContain("auto/deepseek-v4.1-flash");
		expect(analyzed.status).toBe("completed");
		// A read-only session delivers what it printed; nothing is read from disk.
		expect(analyzed.output).toBe('{"ok":true}');
		expect(analyzed.output_path).toBeNull();
		// The writable repair role still has to leave its result in the worktree.
		expect(repaired.status).toBe("failed");
		expect(repaired.reason).toContain("expected_output_missing");
	});

	it("runs one request on its explicit profile instead of its base's first role", async () => {
		stubHostsOnPath("claude", "pi");
		const spawned: Array<{ binary: string; argv: string[] }> = [];
		const provider = createCliAgentSessionProvider({
			profileFor: () => ({ host: "pi" }),
			spawn: ((binary: string, argv: string[]) => {
				spawned.push({ binary, argv });
				return { status: 0, stdout: "{}", stderr: "", signal: null };
			}) as never,
		});
		const record = await runAgentSession(
			{
				kind: "analyze",
				worktree_path: worktree(),
				prompt: "prompt",
				turn_budget: 12,
				timeout_ms: 120_000,
				env: {},
				profile: { host: "claude-code", model: "m", effort: "high", instructions: null },
			},
			provider,
		);
		expect(record.status).toBe("completed");
		// The explicit profile's Host and model spawn, not profileFor's.
		expect(spawned).toHaveLength(1);
		expect(spawned[0]!.binary.endsWith("/claude")).toBe(true);
		expect(spawned[0]!.argv).toContain("m");
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

		const record = await runAgentSession(request("analyze", path), provider);
		expect(spawns).toBe(0);
		expect(record.status).toBe("failed");
		expect(record.reason).toContain("role_readonly_unsupported");

		expect(() => sessionArguments("plan", { host: "unverified-host" as never }, "prompt", 40)).toThrow("role_readonly_unsupported");
	});

	it("falls back to the documented Host only when the role is unset", () => {
		const unset = loopConfig(null);
		for (const role of ROLES) expect(loopRoleProfile(unset, role)).toEqual({ host: "claude-code", model: null, effort: null, instructions: null });
	});

	it("takes the catalog role's limits and appends its instructions as advisory text only (S1-AC2)", async () => {
		const root = worktree();
		writeFileSync(join(root, "role-notes.md"), "Read the auth module before planning.\n");
		const config: LoopSessionConfig = {
			agents: userAgents(null),
			loop: {
				value: {
					roles: resolveLoopRoles({
						roles: { planner: { base: "plan", host: "pi", model: "m", limits: { turn_budget: 12, timeout_s: 120 }, instructions: "role-notes.md" } },
						root,
					}).roles,
				},
			},
		};
		expect(loopSessionLimits(config, "plan")).toEqual({ turn_budget: 12, timeout_ms: 120_000 });
		// The catalog owns the analyze role's limits too.
		expect(loopSessionLimits(config, "analyze")).toEqual(ROLE_SESSION_LIMITS.analyze);

		stubHostsOnPath("pi");
		const spawned: Array<{ argv: string[] }> = [];
		const provider = createCliAgentSessionProvider({
			profileFor: (role) => loopRoleProfile(config, role),
			instructions_root: root,
			spawn: ((_binary: string, argv: string[]) => {
				spawned.push({ argv });
				return { status: 0, stdout: '{"ok":true}', stderr: "", signal: null };
			}) as never,
		});
		const record = await runAgentSession(
			{ ...request("planning", root), turn_budget: loopSessionLimits(config, "plan").turn_budget, timeout_ms: loopSessionLimits(config, "plan").timeout_ms },
			provider,
		);
		expect(record.status).toBe("completed");
		const prompt = spawned[0]!.argv.at(-1)!;
		// The instructions are advisory text in the entry prompt, and the role's own budget was passed.
		expect(prompt).toContain("Decide something");
		expect(prompt).toContain("## Advisory project instructions");
		expect(prompt).toContain("Read the auth module before planning.");
		expect(spawned[0]!.argv).not.toContain("--dangerously-skip-permissions");
	});

	it("fails the role with role_host_unavailable when its Host binary is absent, and starts no other Host", async () => {
		const config = loopConfig(null, { planner: { base: "plan", host: "pi" } });
		// A PATH with no Host CLI on it: nothing may be spawned, least of all `claude`.
		const empty = worktree();
		const previous = process.env.PATH;
		process.env.PATH = empty;
		cleanups.push(() => {
			process.env.PATH = previous;
		});
		let spawns = 0;
		const provider = createCliAgentSessionProvider({
			profileFor: (role) => loopRoleProfile(config, role),
			spawn: (() => {
				spawns += 1;
				return { status: 0, stdout: "{}", stderr: "", signal: null };
			}) as never,
		});
		const record = await runAgentSession(request("planning", empty), provider);
		expect(spawns).toBe(0);
		expect(record.status).toBe("failed");
		expect(record.reason).toContain("role_host_unavailable: pi");
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
