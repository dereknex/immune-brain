import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentRole, AGENT_ROLES, parseAgentShorthand } from "../plugins/immune-brain/runtime/config/agent_roles.ts";
import { loopRoleProfile } from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";
import { resolveConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import { frozenExecutorPreferences, frozenReviewProfile, laneExecutorChoice } from "../plugins/immune-brain/runtime/unattended/agent_profiles.ts";

// ADR 0041: four agent roles (executor, reviewer, planner, triage), each one
// whole profile from one layer: project role over user role over unset.

const temp = mkdtempSync(join(tmpdir(), "agent-roles-config-"));
// The batch consumers read the resolved configuration without an injected path, so the
// user file also lands where the resolver looks for it.
const home = join(temp, "xdg"), homeUser = join(home, "immune-brain/config.json");
const savedHome = process.env.XDG_CONFIG_HOME;
beforeAll(() => { process.env.XDG_CONFIG_HOME = home; });
afterAll(() => {
	rmSync(temp, { recursive: true, force: true });
	if (savedHome === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = savedHome;
});
let counter = 0;
function fixture() {
	const root = join(temp, `repo-${counter++}`);
	mkdirSync(join(root, ".imm"), { recursive: true });
	mkdirSync(join(home, "immune-brain"), { recursive: true });
	execFileSync("git", ["init", "-q", root]);
	rmSync(homeUser, { force: true });
	const user = (data: object) => writeFileSync(homeUser, JSON.stringify({ contract: "immune_brain/user_config/v2", ...data }));
	const project = (data: object) => writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v2", ...data }));
	return { root, userPath: homeUser, projectPath: join(realpathSync(root), ".imm/config.json"), user, project, read: () => resolveConfig(root, { userConfigPath: homeUser }) };
}
const PROFILES = {
	deepseek: { host: "pi", model: "auto/deepseek-v4.1-flash", effort: "high" },
	opus: { host: "claude-code", model: "claude-opus-5-5", effort: "medium" },
	// A profile whose name reads as shorthand: the name wins.
	pi: { host: "antigravity", model: "named" },
};

test.each([
	["pi", { host: "pi" }],
	["pi@high", { host: "pi", effort: "high" }],
	["claude-code:claude-opus-5-5", { host: "claude-code", model: "claude-opus-5-5" }],
	["claude-code:claude-opus-5-5@medium", { host: "claude-code", model: "claude-opus-5-5", effort: "medium" }],
	["pi:m@high", { host: "pi", model: "m", effort: "high" }],
	["pi:grok/grok-4.7@500k", { host: "pi", model: "grok/grok-4.7@500k" }],
	["pi:grok/grok-4.7@500k@max", { host: "pi", model: "grok/grok-4.7@500k", effort: "max" }],
	["pi:openrouter:x/y", { host: "pi", model: "openrouter:x/y" }],
	["codex", null], ["codex:m", null], ["pi:", null], ["pi:@high", null], ["", null],
])("shorthand %p parses to %p", (value, expected) => {
	expect(parseAgentShorthand(value)).toEqual(expected as never);
});

test("each role takes a profile name, shorthand or inline object, and a profile name wins over shorthand", () => {
	const f = fixture();
	f.user({ agents: { profiles: PROFILES, executor: "deepseek", reviewer: "claude-code:claude-opus-5-5@medium", planner: { host: "claude-code", model: "m" }, triage: "pi" } });
	const c = f.read();
	expect(c.agents.valid).toBe(true);
	expect(c.agents.profiles).toEqual({ value: PROFILES, source: "user" });
	expect(c.agents.roles).toEqual({
		executor: { host: "pi", model: "auto/deepseek-v4.1-flash", effort: "high", source: "user" },
		reviewer: { host: "claude-code", model: "claude-opus-5-5", effort: "medium", source: "user" },
		planner: { host: "claude-code", model: "m", effort: null, source: "user" },
		triage: { host: "antigravity", model: "named", effort: null, source: "user" },
	});
	// Spec loop-leader D1.7: the two bindings loop sessions no longer read are reported, never silently kept.
	expect(c.diagnostics.map((d) => [d.code, d.severity, d.key_path])).toEqual([
		["deprecated_config_source", "warning", "loop.roles"],
		["deprecated_config_source", "warning", "loop.roles"],
		["deprecated_config_source", "warning", "loop.roles"],
	]);
});

test("roles merge per role: the project value wins whole, never mixing a host and a model from two layers", () => {
	const f = fixture();
	f.user({ agents: { profiles: PROFILES, executor: "deepseek", reviewer: "claude-code:u-model@high", planner: "opus" } });
	f.project({ agents: { reviewer: "pi", triage: "opus" } });
	const { roles } = f.read().agents;
	expect(roles.executor).toEqual({ host: "pi", model: "auto/deepseek-v4.1-flash", effort: "high", source: "user" });
	// The project names the user profile `pi`, so the name wins there too.
	expect(roles.reviewer).toEqual({ host: "antigravity", model: "named", effort: null, source: "project" });
	expect(roles.planner).toEqual({ host: "claude-code", model: "claude-opus-5-5", effort: "medium", source: "user" });
	expect(roles.triage).toEqual({ host: "claude-code", model: "claude-opus-5-5", effort: "medium", source: "project" });
	f.user({ agents: { reviewer: "claude-code:u-model@high" } });
	expect(f.read().agents.roles.reviewer).toEqual({ host: "pi", model: null, effort: null, source: "project" });
});

test.each([
	["unknown shorthand host", { executor: "codex:x" }, "unknown_profile", "agents.executor"],
	["unknown profile name", { executor: "missing" }, "unknown_profile", "agents.executor"],
	["object with an unknown host", { executor: { host: "codex" } }, "config_invalid", "agents.executor"],
	["object with an unknown key", { executor: { host: "pi", transport: "herdr" } }, "config_invalid", "agents.executor"],
	["profiles in the project file", { profiles: { p: { host: "pi" } } }, "config_invalid", "agents.profiles"],
	["a retired role name", { "code-review": "pi" }, "config_invalid", "agents.code-review"],
	["a retired preset key", { presets: {} }, "config_invalid", "agents.presets"],
])("an invalid project value (%s) falls to the user role with a diagnostic", (_name, agents, code, key_path) => {
	const f = fixture();
	f.user({ agents: { executor: "claude-code:user-model" } });
	f.project({ agents });
	const c = f.read();
	expect(c.agents.valid).toBe(false);
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "error", file: f.projectPath, key_path }));
	expect(c.agents.roles.executor).toEqual({ host: "claude-code", model: "user-model", effort: null, source: "user" });
});

test("an invalid user role value stays an error while the project role overrides it", () => {
	const f = fixture();
	f.user({ agents: { executor: "constructor" } });
	f.project({ agents: { executor: "pi:x" } });
	const c = f.read();
	expect(c.agents.roles.executor).toEqual({ host: "pi", model: "x", effort: null, source: "project" });
	expect(c.agents.valid).toBe(false);
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "unknown_profile", severity: "error", file: f.userPath, key_path: "agents.executor" }));
});

test("an invalid user profile is dropped and the role naming it is unset", () => {
	const f = fixture();
	f.user({ agents: { profiles: { bad: { host: "pi", transport: "herdr" } }, executor: "bad" } });
	const c = f.read();
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "config_invalid", key_path: "agents.profiles.bad" }));
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "unknown_profile", key_path: "agents.executor" }));
	expect(c.agents.roles.executor).toBeNull();
});

test("without agents every role is null and the Lane executor falls back to the Parent Host", () => {
	const f = fixture();
	const c = f.read();
	expect(Object.keys(c.agents.roles).sort()).toEqual([...AGENT_ROLES].sort());
	for (const role of AGENT_ROLES) expect(agentRole(c.agents, role)).toBeNull();
	expect(laneExecutorChoice(f.root, undefined, "antigravity")).toMatchObject({ host: "antigravity" });
	expect(frozenExecutorPreferences(f.root, undefined, "antigravity")).toEqual({ host: "antigravity" });
	expect(frozenReviewProfile(f.root, undefined)).toBeUndefined();
});

test("the Lane executor and the frozen batch profiles read the resolved roles", () => {
	const f = fixture();
	f.user({ agents: { profiles: PROFILES, executor: "deepseek", reviewer: "opus" } });
	expect(laneExecutorChoice(f.root, undefined, "claude-code")).toMatchObject({ host: "pi", model: "auto/deepseek-v4.1-flash", effort: "high" });
	expect(frozenExecutorPreferences(f.root, undefined, "claude-code")).toEqual({ host: "pi", model: "auto/deepseek-v4.1-flash", effort: "high" });
	expect(frozenReviewProfile(f.root, undefined)).toEqual({ host: "claude-code", model: "claude-opus-5-5", effort: "medium" });
	f.project({ agents: { executor: "antigravity:p-model" } });
	expect(laneExecutorChoice(f.root, undefined, "claude-code")).toMatchObject({ host: "antigravity", model: "p-model" });
	// A frozen or requested profile replaces the configured role whole.
	expect(laneExecutorChoice(f.root, { host: "claude-code" }, "pi")).toMatchObject({ host: "claude-code" });
	expect(frozenReviewProfile(f.root, { host: "pi" })).toEqual({ host: "pi" });
});

test("an agents, batch or session_providers error stops the configured Lane executor", () => {
	const f = fixture();
	for (const data of [{ agents: { executor: "codex" } }, { batch: { max_parallel: 0 } }, { session_providers: [] }]) {
		f.user({ ...data });
		expect(laneExecutorChoice(f.root, undefined, "claude-code")).toBeNull();
		expect(frozenExecutorPreferences(f.root, undefined, "claude-code")).toBeUndefined();
	}
	f.user({ loop: { mode: "always" } });
	expect(laneExecutorChoice(f.root, undefined, "claude-code")).toMatchObject({ host: "claude-code" });
	// A retired herdr key warns but never blocks the Lane executor.
	f.user({ herdr: true });
	expect(laneExecutorChoice(f.root, undefined, "claude-code")).toMatchObject({ host: "claude-code" });
});

test("imm-kernel config --json lists each resolved role with its source", () => {
	const f = fixture();
	f.user({ agents: { profiles: PROFILES, executor: "deepseek", reviewer: "claude-code:claude-opus-5-5@medium" } });
	f.project({ agents: { planner: "pi:grok/grok-4.7@500k" } });
	const result = spawnSync(resolve("plugins/immune-brain/bin/imm-kernel"), ["config", "--json"], { cwd: f.root, encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: home } });
	expect(result.status).toBe(0);
	const parsed = JSON.parse(result.stdout);
	expect(parsed.agents.valid).toBe(true);
	expect(parsed.agents.roles).toEqual({
		executor: { host: "pi", model: "auto/deepseek-v4.1-flash", effort: "high", source: "user" },
		reviewer: { host: "claude-code", model: "claude-opus-5-5", effort: "medium", source: "user" },
		planner: { host: "pi", model: "grok/grok-4.7@500k", effort: null, source: "project" },
		triage: null,
	});
});

test("an agents binding that used to choose a loop role is ignored and reported once per affected role", () => {
	const f = fixture();
	f.user({ agents: { profiles: PROFILES, planner: "opus", executor: "deepseek" } });
	const c = f.read();
	// BR-DEC-7: clarify, plan and repair resolve from the catalog now, so the agent
	// bindings are named as ignored sources rather than silently kept or dropped.
	expect(c.diagnostics.map((d) => [d.code, d.file, d.key_path])).toEqual([
		["deprecated_config_source", f.userPath, "loop.roles"],
		["deprecated_config_source", f.userPath, "loop.roles"],
		["deprecated_config_source", f.userPath, "loop.roles"],
	]);
	// The message names the ignored binding path and the key that replaces it, once per affected role.
	expect(c.diagnostics.map((d) => d.message)).toEqual([
		expect.stringContaining("agents.planner no longer chooses the loop clarify role"),
		expect.stringContaining("agents.planner no longer chooses the loop plan role"),
		expect.stringContaining("agents.executor no longer chooses the loop repair role"),
	]);
	for (const d of c.diagnostics) expect(d.message).toContain("loop.roles in .imm/config.json");
	expect(c.diagnostics.every((d) => d.severity === "warning")).toBe(true);
	// The sessions run on the catalog role: the default when no role overrides it.
	expect(loopRoleProfile(c, "plan")).toEqual({ host: "claude-code", model: null, effort: null, instructions: null });
	expect(loopRoleProfile(c, "repair")).toEqual({ host: "claude-code", model: null, effort: null, instructions: null });
	// The Lane Host and the read-only catalog roles are unchanged (BR-DEC-8).
	expect(loopRoleProfile(c, "analyze")).toEqual({ host: "claude-code", model: null, effort: null, instructions: null });
	expect(loopRoleProfile(c, "executor")).toEqual({ host: "pi", model: "auto/deepseek-v4.1-flash", effort: "high", instructions: null });
	// The project can still bind the loop's own role, and the notice stays: the agents key is not a loop source.
	f.project({ loop: { roles: { planner: { base: "plan", host: "pi", model: "p-model" } } } });
	const bound = f.read();
	expect(loopRoleProfile(bound, "plan")).toEqual({ host: "pi", model: "p-model", effort: null, instructions: null });
	expect(bound.diagnostics.filter((d) => d.code === "deprecated_config_source")).toHaveLength(3);
});

test("a resurrected agents.presets table is config_invalid and never reaches a loop session", () => {
	const f = fixture();
	// ADR 0041 removed presets; the Loop catalog replaced the role bindings they held.
	f.user({ agents: { presets: { fast: { roles: { plan: "pi", clarify: "pi", repair: "pi", "*": "pi" } } } } });
	const c = f.read();
	expect(c.agents.valid).toBe(false);
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "config_invalid", severity: "error", file: f.userPath, key_path: "agents.presets" }));
	// Nothing from the preset reaches a loop role: every catalog role keeps its documented default.
	for (const role of ["clarify", "plan", "repair"] as const) expect(loopRoleProfile(c, role)).toEqual({ host: "claude-code", model: null, effort: null, instructions: null });
	expect(c.loop.value.roles.every((role) => role.source === "default")).toBe(true);
});

test("a retired preset roles.judging binding is tolerated, reported once, and leaves the executor Host alone", () => {
	const f = fixture();
	// Spec loop-leader D3.4: judging is retired, so the binding selects nothing and
	// is reported rather than making the whole agents table config_invalid.
	f.user({ agents: { executor: "pi:exec-model", presets: { fast: { roles: { judging: "pi" } } } } });
	const c = f.read();
	expect(c.agents.valid).toBe(true);
	expect(c.diagnostics).toContainEqual(
		expect.objectContaining({
			code: "deprecated_config_source",
			severity: "warning",
			file: f.userPath,
			key_path: "agents.presets.fast.roles.judging",
		}),
	);
	expect(c.agents.roles.executor).toEqual({ host: "pi", model: "exec-model", effort: null, source: "user" });
	expect(loopRoleProfile(c, "executor")).toEqual({ host: "pi", model: "exec-model", effort: null, instructions: null });
});
