import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentRole, AGENT_ROLES } from "../plugins/immune-brain/runtime/config/agent_roles.ts";
import { resolveConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import { laneExecutorChoice } from "../plugins/immune-brain/runtime/unattended/batch_runner.ts";

// Spec loop-agent-scheduling D1 and S1-AC1/AC2/AC3: one `agents` role table,
// the legacy `lanes` mapping into it, and the consumers that read a role.

const temp = mkdtempSync(join(tmpdir(), "agent-roles-config-"));
// `laneExecutorChoice` reads the resolved configuration without an injected path, so the
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
	const root = join(temp, `repo-${counter++}`), userPath = join(temp, `user-${counter}.json`);
	mkdirSync(join(root, ".imm"), { recursive: true });
	mkdirSync(join(home, "immune-brain"), { recursive: true });
	execFileSync("git", ["init", "-q", root]);
	rmSync(userPath, { force: true });
	rmSync(homeUser, { force: true });
	const user = (data: object) => {
		writeFileSync(userPath, JSON.stringify({ contract: "immune_brain/user_config/v1", ...data }));
		writeFileSync(homeUser, JSON.stringify({ contract: "immune_brain/user_config/v1", ...data }));
	};
	const project = (data: object) => {
		writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v1", ...data }));
		execFileSync("git", ["add", ".imm/config.json"], { cwd: root });
	};
	return { root, userPath, user, project, read: () => resolveConfig(root, { userConfigPath: userPath }) };
}

/** BR-DEC-3: the owner's `default` preset binds five roles to `opus-med`, `"*"` to `sonnet-high`. */
const OWNER = {
	profiles: {
		"sonnet-high": { host: "claude-code", model: "sonnet-5-5", effort: "high" },
		"opus-med": { host: "claude-code", model: "opus-5-5", effort: "medium" },
	},
	presets: {
		default: {
			max_parallel: 2,
			roles: { "code-review": "opus-med", "review-verifier": "opus-med", plan: "opus-med", judging: "opus-med", clarify: "opus-med", "*": "sonnet-high" },
		},
	},
};
const PROFILE = (host: string, model: string, effort: string, transport: string) => ({ host, model, effort, transport });

test("S1-AC1: the BR-DEC-3 fixture resolves every role with host, model, effort, transport, preset and layer", () => {
	const f = fixture();
	f.user({ agents: OWNER });
	const c = f.read();
	expect(c.agents.valid).toBe(true);
	expect(c.agents.source).toEqual({ value: "agents", source: "user" });
	expect(c.agents.active).toEqual({ value: "default", source: "default" });
	expect(c.agents.max_parallel).toEqual({ value: 2, source: "default" });
	expect(Object.keys(c.agents.roles).sort()).toEqual([...AGENT_ROLES].sort());
	// Review and its verifier run only in an explicit Herdr session; every other role defaults to a process.
	for (const role of ["code-review", "review-verifier", "plan", "judging", "clarify"] as const)
		expect(c.agents.roles[role]).toEqual({
			...PROFILE("claude-code", "opus-5-5", "medium", role === "code-review" || role === "review-verifier" ? "herdr" : "process"), preset: "default", layer: "user",
		});
	for (const role of ["executor", "advisory-reviewer", "repair"] as const)
		expect(c.agents.roles[role]).toEqual({
			...PROFILE("claude-code", "sonnet-5-5", "high", role === "advisory-reviewer" ? "subagent" : "process"), preset: "default", layer: "user",
		});
});

test("S1-AC1: role lookup follows active roles[r], default roles[r], active roles[*], default roles[*]", () => {
	const f = fixture();
	f.user({
		agents: {
			profiles: { a: { host: "pi", model: "a-m" }, b: { host: "claude-code", model: "b-m" }, c: { host: "antigravity", model: "c-m" } },
			presets: { default: { roles: { clarify: "b", "*": "a" } }, fast: { roles: { plan: "a", "*": "c" } } },
			active: "fast",
		},
	});
	const { roles } = f.read().agents;
	expect(roles.plan).toMatchObject({ host: "pi", model: "a-m", preset: "fast" });
	expect(roles.clarify).toMatchObject({ host: "claude-code", model: "b-m", preset: "default" });
	expect(roles.executor).toMatchObject({ host: "antigravity", model: "c-m", preset: "fast" });
	expect(roles.judging).toMatchObject({ host: "antigravity", model: "c-m", preset: "fast" });
});

test("S1-AC1: a named preset overrides active for one call, as a request names one for one batch", () => {
	const f = fixture();
	f.user({
		agents: {
			profiles: { slow: { host: "claude-code", model: "opus" }, fast: { host: "pi", model: "cheap" } },
			presets: { review: { roles: { "*": "slow", "code-review": "slow" } }, local: { roles: { "*": "fast" } } },
			active: "local",
		},
	});
	const c = f.read();
	expect(agentRole(c.agents, "executor")).toMatchObject({ host: "pi", model: "cheap", preset: "local" });
	expect(agentRole(c.agents, "executor", "review")).toMatchObject({ host: "claude-code", model: "opus", preset: "review" });
	expect(agentRole(c.agents, "code-review", "review")).toMatchObject({ host: "claude-code", model: "opus", preset: "review" });
	expect(agentRole(c.agents, "code-review")).toMatchObject({ host: "pi", model: "cheap", preset: "local" });
});

test.each([
	["unknown preset", { profiles: { a: { host: "pi" } }, presets: { other: { roles: { "*": "a" } } }, active: "missing" }, "unknown_preset"],
	["unknown profile", { profiles: { a: { host: "pi" } }, presets: { default: { roles: { "*": "missing" } } } }, "unknown_profile"],
	["incomplete default preset", { profiles: { a: { host: "pi" } }, presets: { default: { roles: { plan: "a" } } } }, "preset_incomplete"],
	["unknown transport", { profiles: { a: { host: "pi", transport: "socket" } }, presets: { default: { roles: { "*": "a" } } } }, "config_invalid"],
	["invalid max_parallel", { profiles: { a: { host: "pi" } }, presets: { default: { max_parallel: 9, roles: { "*": "a" } } } }, "config_invalid"],
])("S1-AC1: %s fails the agents section and falls back to built-in resolution", (_name, agents, code) => {
	const f = fixture();
	f.user({ agents });
	const c = f.read();
	expect(c.agents.valid).toBe(false);
	expect(c.diagnostics.some((d) => d.code === code && d.key_path.startsWith("agents"))).toBe(true);
	for (const role of AGENT_ROLES) expect(c.agents.roles[role]).toMatchObject({ host: null, preset: null, layer: "unset" });
});

test("S1-AC1: an unknown transport for a role and a verifier on another host are refused", () => {
	const f = fixture();
	f.user({ agents: { profiles: { a: { host: "pi" }, b: { host: "pi", transport: "subagent" } }, presets: { default: { roles: { "*": "a", "code-review": "b" } } } } });
	let c = f.read();
	expect(c.agents.valid).toBe(false);
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "transport_invalid_for_role", file: f.userPath, key_path: "agents.profiles.b.transport" }));

	f.user({ agents: { profiles: { a: { host: "pi" }, v: { host: "claude-code" } }, presets: { default: { roles: { "*": "a", "review-verifier": "v" } } } } });
	c = f.read();
	expect(c.agents.valid).toBe(false);
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "review_verifier_host_mismatch", file: f.userPath, key_path: "agents.presets.default.roles.review-verifier" }));
});

test("S1-AC1: profiles and presets in the project file are refused and `active` there is accepted", () => {
	const f = fixture();
	f.project({ agents: { profiles: { a: { host: "pi" } } } });
	let c = f.read();
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "config_invalid", file: ".imm/config.json", key_path: "agents.profiles" }));
	f.user({ agents: { profiles: { a: { host: "pi", model: "m" } }, presets: { mine: { roles: { "*": "a" } }, other: { roles: { "*": "a" } } } } });
	f.project({ agents: { active: "mine" } });
	c = f.read();
	expect(c.agents.valid).toBe(true);
	expect(c.agents.active).toEqual({ value: "mine", source: "project" });
	expect(c.agents.roles.executor).toMatchObject({ host: "pi", model: "m", preset: "mine" });
});

test("S1-AC1: max_parallel accepts 1 and 8 and rejects 0 and 9", () => {
	const f = fixture();
	for (const value of [1, 8]) {
		f.user({ agents: { profiles: { a: { host: "pi" } }, presets: { default: { max_parallel: value, roles: { "*": "a" } } } } });
		const c = f.read();
		expect(c.agents.valid).toBe(true);
		expect(c.agents.max_parallel).toEqual({ value, source: "default" });
	}
	for (const value of [0, 9]) {
		f.user({ agents: { profiles: { a: { host: "pi" } }, presets: { default: { max_parallel: value, roles: { "*": "a" } } } } });
		const c = f.read();
		expect(c.agents.valid).toBe(false);
		expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "config_invalid", file: f.userPath, key_path: "agents.presets.default.max_parallel" }));
	}
});

test("S1-AC1: imm-kernel config --json lists each resolved role with its preset and layer", () => {
	const f = fixture();
	const configHome = join(temp, "xdg");
	mkdirSync(join(configHome, "immune-brain"), { recursive: true });
	writeFileSync(join(configHome, "immune-brain/config.json"), JSON.stringify({ contract: "immune_brain/user_config/v1", agents: OWNER }));
	const result = spawnSync(resolve("plugins/immune-brain/bin/imm-kernel"), ["config", "--json"], { cwd: f.root, encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: configHome } });
	expect(result.status).toBe(0);
	const parsed = JSON.parse(result.stdout);
	expect(parsed.agents.valid).toBe(true);
	expect(parsed.agents.roles["code-review"]).toMatchObject({ host: "claude-code", model: "opus-5-5", effort: "medium", transport: "herdr", preset: "default", layer: "user" });
	expect(parsed.agents.roles.executor).toMatchObject({ host: "claude-code", model: "sonnet-5-5", effort: "high", transport: "process", preset: "default", layer: "user" });
	expect(parsed.agents.roles["advisory-reviewer"]).toMatchObject({ transport: "subagent" });
});

test("S1-AC2: legacy lanes only resolves executor, code-review and max_parallel as before with a deprecation", () => {
	const f = fixture();
	f.user({
		lanes: {
			active: "fast",
			profiles: { fast: { max_parallel: 4, executor_host: "pi", executor_model: "m", review_host: "claude-code", review_model: "r", review_verifier_model: "v", review_transport: "herdr" } },
		},
	});
	const c = f.read();
	expect(c.agents.valid).toBe(true);
	expect(c.agents.source).toEqual({ value: "legacy", source: "user" });
	expect(c.agents.active).toEqual({ value: "fast", source: "user" });
	expect(c.agents.max_parallel).toEqual({ value: 4, source: "user" });
	expect(c.agents.roles.executor).toMatchObject({ host: c.lanes.executor_host.value, model: c.lanes.executor_model.value, effort: c.lanes.executor_effort.value, transport: "process", layer: "user" });
	expect(c.agents.roles["code-review"]).toMatchObject({ host: c.lanes.review_host.value, model: c.lanes.review_model.value, transport: c.lanes.review_transport.value });
	expect(c.agents.roles["review-verifier"]).toMatchObject({ host: "claude-code", model: "v", transport: "herdr" });
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "deprecated_config_source", severity: "warning", file: f.userPath, key_path: "lanes" }));
});

test("S1-AC2: a legacy Lane without review keys never reviews on its executor profile", () => {
	const f = fixture();
	f.user({ lanes: { active: "fast", profiles: { fast: { executor_host: "pi", executor_model: "pi-m" } } } });
	const c = f.read();
	expect(c.agents.roles.executor).toMatchObject({ host: "pi", model: "pi-m" });
	expect(c.agents.roles.repair).toMatchObject({ host: "pi", model: "pi-m" });
	expect(c.agents.roles["code-review"]).toEqual({ host: null, model: null, effort: null, transport: null, preset: null, layer: "unset" });
	expect(c.agents.roles["review-verifier"]).toEqual({ host: null, model: null, effort: null, transport: null, preset: null, layer: "unset" });
	expect(c.agents.roles["advisory-reviewer"]).toMatchObject({ host: null, layer: "unset" });
	expect(c.agents.roles.judging).toMatchObject({ host: null, layer: "unset" });
});

test("S1-AC2: project flat lanes stay the fallback when a user profile is named `default`", () => {
	const f = fixture();
	f.project({ lanes: { executor_host: "pi" } });
	f.user({ lanes: { active: "fast", profiles: { fast: { review_host: "claude-code" }, default: { executor_host: "antigravity" } } } });
	const c = f.read();
	expect(c.agents.active).toEqual({ value: "fast", source: "user" });
	expect(c.agents.roles.executor).toMatchObject({ host: "pi" });
	expect(c.agents.roles["code-review"]).toMatchObject({ host: "claude-code" });
	expect(laneExecutorChoice(f.root, undefined, "claude-code")).toMatchObject({ host: "pi" });
});

test("S1-AC2: a legacy profile named `default` is not a fallback preset for the active profile", () => {
	const f = fixture();
	f.user({ lanes: { active: "fast", profiles: { fast: { max_parallel: 2 }, default: { executor_host: "antigravity", review_host: "pi", max_parallel: 4 } } } });
	const c = f.read();
	expect(c.agents.active).toEqual({ value: "fast", source: "user" });
	expect(c.agents.max_parallel).toEqual({ value: 2, source: "user" });
	expect(c.agents.roles.executor).toMatchObject({ host: null, layer: "unset" });
	expect(c.agents.roles["code-review"]).toMatchObject({ host: null, layer: "unset" });
	expect(laneExecutorChoice(f.root, undefined, "claude-code")).toMatchObject({ host: "claude-code" });
});

test("S1-AC2: a layer holding both uses agents and reports legacy_source_ignored", () => {
	const f = fixture();
	f.user({ lanes: { active: "fast", profiles: { fast: { max_parallel: 4, executor_host: "pi" } } }, agents: OWNER });
	const c = f.read();
	expect(c.agents.source).toEqual({ value: "agents", source: "user" });
	expect(c.agents.roles.executor).toMatchObject({ host: "claude-code", model: "sonnet-5-5" });
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "legacy_source_ignored", severity: "warning", file: f.userPath, key_path: "lanes" }));
	expect(c.diagnostics.some((d) => d.code === "deprecated_config_source")).toBe(false);
});

test("S1-AC2: without agents and lanes every role is unset and the Lane executor falls back to the Parent Host", () => {
	const f = fixture();
	const c = f.read();
	expect(c.agents.source).toEqual({ value: "default", source: "default" });
	for (const role of AGENT_ROLES) expect(c.agents.roles[role]).toEqual({ host: null, model: null, effort: null, transport: null, preset: null, layer: "unset" });
	expect(c.agents.max_parallel).toEqual({ value: 1, source: "default" });
	expect(laneExecutorChoice(f.root, undefined, "antigravity")).toMatchObject({ host: "antigravity" });
});

test("S1-AC2: a legacy transport applies without a review host", () => {
	const f = fixture();
	f.project({ lanes: { review_transport: "herdr", advisory_transport: "herdr" } });
	const c = f.read();
	expect(agentRole(c.agents, "code-review")).toMatchObject({ host: null, transport: "herdr", preset: "project" });
	expect(agentRole(c.agents, "advisory-reviewer")).toMatchObject({ host: null, transport: "herdr", preset: "project" });
	expect(agentRole(c.agents, "executor")).toBeNull();
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "deprecated_config_source", file: ".imm/config.json", key_path: "lanes" }));
});

test("S1-AC3: the Lane executor reads the resolved executor role, never mixing layers", () => {
	const f = fixture();
	// Project flat lanes are the legacy fallback preset; a user model without a host never meets the project host.
	f.project({ lanes: { executor_host: "pi", executor_model: "project-model" } });
	f.user({ lanes: { active: "x", profiles: { x: { executor_model: "user-model" } } } });
	let choice = laneExecutorChoice(f.root, undefined, "claude-code");
	expect(choice).toMatchObject({ host: "pi", model: "project-model" });

	f.user({ agents: { profiles: { exec: { host: "claude-code", model: "agent-model", effort: "high" } }, presets: { default: { roles: { "*": "exec" } } } } });
	choice = laneExecutorChoice(f.root, undefined, "pi");
	expect(choice).toMatchObject({ host: "claude-code", model: "agent-model", effort: "high" });
});

test("S1-AC3: the Review profile, its transport and the review-verifier model read the resolved roles", () => {
	const f = fixture();
	f.user({
		agents: {
			profiles: {
				review: { host: "claude-code", model: "reviewer-m", effort: "high", transport: "herdr" },
				verify: { host: "claude-code", model: "verifier-m" },
				other: { host: "pi" },
			},
			presets: { default: { roles: { "*": "other", "code-review": "review", "review-verifier": "verify" } } },
		},
	});
	const c = f.read();
	expect(agentRole(c.agents, "code-review")).toMatchObject({ host: "claude-code", model: "reviewer-m", effort: "high", transport: "herdr" });
	expect(agentRole(c.agents, "review-verifier")).toMatchObject({ host: "claude-code", model: "verifier-m", transport: "herdr" });
});
