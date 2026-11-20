import { afterAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { batchConfigErrors, resolveConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import { migrateConfig } from "../plugins/immune-brain/runtime/config/migrate.ts";
import { POINT_REGISTRY } from "../plugins/immune-brain/runtime/decision_model/thresholds.ts";

// ADR 0041: two layers (project `.imm/config.json` over the user file) resolve
// every key; permission keys take the stricter value; v1 files are void until
// `imm-kernel config migrate` rewrites them.

const USER = "immune_brain/user_config/v2", PROJECT = "immune_brain/project_config/v2";
const temp = mkdtempSync(join(tmpdir(), "layered-config-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let counter = 0;
function fixture() {
	const root = join(temp, `repo-${counter++}`), userPath = join(temp, `user-${counter}.json`);
	mkdirSync(join(root, ".imm"), { recursive: true });
	execFileSync("git", ["init", "-q", root]);
	const user = (data: object, contract = USER) => writeFileSync(userPath, JSON.stringify({ contract, ...data }));
	// The project file is local and unversioned: it is never staged.
	const project = (data: object, contract = PROJECT) => writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract, ...data }));
	const read = (checkEnv = false) => resolveConfig(root, { userConfigPath: userPath, checkEnv });
	return { root, userPath, projectPath: join(realpathSync(root), ".imm/config.json"), user, project, read };
}
const write = (root: string, path: string, data: unknown) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), typeof data === "string" ? data : JSON.stringify(data)); };
const fake = { kind: "fake", answers: {} };
type Config = ReturnType<typeof resolveConfig>;
const errorAt = (c: Config, key_path: string) => c.diagnostics.find((d) => d.severity === "error" && d.key_path === key_path);
const point = Object.keys(POINT_REGISTRY)[0]!, other = Object.keys(POINT_REGISTRY)[1]!;

const PLAIN: Array<[string, (v: unknown) => object, unknown, unknown, unknown, (c: Config) => unknown]> = [
	["initiative_carrier", (v) => ({ initiative_carrier: v }), "local", "github", null, (c) => c.initiative_carrier],
	["review_verifier", (v) => ({ review_verifier: v }), "on", "off", "off", (c) => c.review_verifier],
	["session_providers", (v) => ({ session_providers: v }), ["herdr-core"], ["herdr", "herdr-core"], ["herdr"], (c) => c.session_providers],
	["batch.max_parallel", (v) => ({ batch: { max_parallel: v } }), 3, 5, 1, (c) => c.batch.max_parallel],
	["batch.final_verification", (v) => ({ batch: { final_verification: v } }), ["bun test"], ["bun run typecheck"], null, (c) => c.batch.final_verification],
];

test.each(PLAIN)("%s resolves project over user over default", (_key, set, userValue, projectValue, fallback, get) => {
	const f = fixture();
	expect(get(f.read())).toEqual({ value: fallback, source: "default" });
	f.user(set(userValue));
	expect(get(f.read())).toEqual({ value: userValue, source: "user" });
	f.project(set(projectValue));
	expect(get(f.read())).toEqual({ value: projectValue, source: "project" });
	expect(f.read().diagnostics).toEqual([]);
});

test.each([
	["initiative_carrier", { initiative_carrier: "gitlab" }, { initiative_carrier: "local" }, (c: Config) => c.initiative_carrier, { value: "local", source: "user" }],
	["review_verifier", { review_verifier: true }, {}, (c: Config) => c.review_verifier, { value: "off", source: "default" }],
	["session_providers", { session_providers: [] }, { session_providers: ["herdr-core"] }, (c: Config) => c.session_providers, { value: ["herdr-core"], source: "user" }],
	["batch.max_parallel", { batch: { max_parallel: 9 } }, { batch: { max_parallel: 8 } }, (c: Config) => c.batch.max_parallel, { value: 8, source: "user" }],
	["batch.max_parallel", { batch: { max_parallel: 0 } }, {}, (c: Config) => c.batch.max_parallel, { value: 1, source: "default" }],
	["batch.final_verification", { batch: { final_verification: [""] } }, {}, (c: Config) => c.batch.final_verification, { value: null, source: "default" }],
] as const)("an invalid project %s counts as unset and falls to the next layer with an error", (key, project, user, get, expected) => {
	const f = fixture();
	f.user(user);
	f.project(project);
	const c = f.read();
	expect(get(c)).toEqual(expected);
	expect(errorAt(c, key)).toMatchObject({ code: "config_invalid", file: f.projectPath });
});

test.each([["user"], ["project"]] as const)("a retired %s herdr key warns once without blocking or resolving", (layer) => {
	for (const value of [true, "yes"]) {
		const f = fixture();
		if (layer === "user") f.user({ herdr: value }); else f.project({ herdr: value });
		const c = f.read();
		const warnings = c.diagnostics.filter((d) => d.key_path === "herdr");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ code: "retired_key", severity: "warning", key_path: "herdr" });
		expect(c.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(batchConfigErrors(c)).toEqual([]);
		expect("herdr" in c).toBe(false);
	}
});

test("an unknown top-level key is still a config_invalid error", () => {
	const f = fixture();
	f.user({ unknown_top_key: 1 });
	const c = f.read();
	expect(errorAt(c, "unknown_top_key")).toMatchObject({ code: "config_invalid", file: f.userPath });
});

test.each([[[]], [["process"]], [["fake"]], [["herdr", "herdr"]], ["herdr"]] as const)("an invalid session_providers %p is a blocking config_invalid error", (value) => {
	const f = fixture();
	f.user({ session_providers: value });
	const c = f.read();
	expect(c.session_providers).toEqual({ value: ["herdr"], source: "default" });
	expect(errorAt(c, "session_providers")).toMatchObject({ code: "config_invalid", file: f.userPath });
	expect(batchConfigErrors(c).length).toBeGreaterThan(0);
});

test.each([
	["user", "immune_brain/user_config/v1"],
	["project", "immune_brain/project_config/v1"],
] as const)("a v1 %s file is void as a whole and names the migrate command", (layer, contract) => {
	const f = fixture();
	if (layer === "user") f.user({ initiative_carrier: "local" }, contract); else f.project({ initiative_carrier: "local" }, contract);
	const c = f.read();
	expect(c.initiative_carrier).toEqual({ value: null, source: "default" });
	const error = errorAt(c, "contract")!;
	expect(error).toMatchObject({ code: "config_invalid", file: layer === "user" ? f.userPath : f.projectPath });
	expect(error.message).toContain("imm-kernel config migrate");
	expect(batchConfigErrors(c)).toContainEqual(error);
});

test.each([
	["malformed", "{", "$"], ["wrong contract", '{"contract":"bad"}', "contract"],
	["retired projects key", JSON.stringify({ contract: USER, projects: { "github.com/O/R": { initiative_carrier: "local" } } }), "projects"],
	["retired lanes key", JSON.stringify({ contract: USER, lanes: { active: "x" } }), "lanes"],
	["unknown nested key", JSON.stringify({ contract: USER, batch: { mystery: true } }), "batch.mystery"],
	["pasted token", JSON.stringify({ contract: USER, decision_models: { profiles: { x: { kind: "clef", model: "clef", account_id_env: "ACCOUNT", token_env: "sk-live-123" } } } }), "decision_models.profiles.x.token_env"],
])("refuses a user file with %s through a redacted named diagnostic", (_name, content, path) => {
	const f = fixture(); f.project({ initiative_carrier: "github" }); writeFileSync(f.userPath, content);
	const c = f.read(true);
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", file: f.userPath, key_path: path }));
	expect(JSON.stringify(c)).not.toContain("sk-live-123");
	expect(c.initiative_carrier).toEqual({ value: "github", source: "project" });
});

test("permission keys take the stricter value across layers", () => {
	const f = fixture();
	f.user({ git_integration: "manual", loop: { auto_enroll_max_risk: "none", allowed_actors: ["a", "b"], allowed_associations: ["OWNER", "MEMBER"] } });
	f.project({ git_integration: "auto", loop: { auto_enroll_max_risk: "routine", allowed_actors: ["b", "c"], allowed_associations: ["MEMBER", "COLLABORATOR"] } });
	let c = f.read();
	expect(c.git_integration).toEqual({ value: "manual", source: "user" });
	expect(c.loop.value).toMatchObject({ auto_enroll_max_risk: "none", allowed_actors: ["b"], allowed_associations: ["MEMBER"] });
	f.user({ git_integration: "auto", loop: { auto_enroll_max_risk: "routine" } });
	f.project({ git_integration: "manual" });
	c = f.read();
	expect(c.git_integration).toEqual({ value: "manual", source: "project" });
	expect(c.loop.value.auto_enroll_max_risk).toBe("routine");
	f.project({ git_integration: "auto" });
	expect(f.read().git_integration).toEqual({ value: "auto", source: "project" });
	f.project({});
	f.user({});
	expect(f.read().git_integration).toEqual({ value: "manual", source: "default" });
});

test("decision_models: per-key project override, bindings off, egress replaced per kind, user-only profiles", () => {
	const f = fixture();
	f.user({ decision_models: { profiles: { a: fake, b: fake }, default_profile: "a", bindings: { [point]: "a", [other]: "a" }, egress: { clef: ["finding", "diff"], jev: ["diff"] } } });
	f.project({ decision_models: { default_profile: "b", bindings: { [point]: "off" }, egress: { clef: ["finding", "goal_scope"] } } });
	let c = f.read();
	expect(c.decision_models.valid).toBe(true);
	expect(c.decision_models.profiles).toEqual({ value: { a: fake, b: fake }, source: "user" });
	expect(c.decision_models.default_profile).toEqual({ value: "b", source: "project" });
	expect(c.decision_models.bindings[point]).toEqual({ value: "off", source: "project" });
	expect(c.decision_models.bindings[other]).toEqual({ value: "a", source: "user" });
	// No intersection: the project list replaces the user list for its kind.
	expect(c.decision_models.egress.clef).toEqual({ value: ["finding", "goal_scope"], source: "project" });
	expect(c.decision_models.egress.jev).toEqual({ value: ["diff"], source: "user" });
	expect("enabled_points" in c.decision_models).toBe(false);

	f.project({ decision_models: { profiles: { p: fake }, default_profile: "missing", enabled_points: [point] } });
	c = f.read();
	expect(c.decision_models.valid).toBe(false);
	expect(errorAt(c, "decision_models.profiles")).toMatchObject({ code: "config_invalid", file: f.projectPath });
	expect(errorAt(c, "decision_models.enabled_points")).toMatchObject({ code: "config_invalid", file: f.projectPath });
	expect(errorAt(c, "decision_models.default_profile")).toMatchObject({ code: "unknown_profile", file: f.projectPath });
	expect(c.decision_models.default_profile).toEqual({ value: "a", source: "user" });
	expect(c.decision_models.profiles.value).not.toHaveProperty("p");
});

test("the project file is read untracked, and a linked worktree reads the main checkout's file", () => {
	const f = fixture();
	f.project({ initiative_carrier: "local" });
	expect(execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ".imm/config.json"], { cwd: f.root, encoding: "utf8" })).toContain("??");
	expect(f.read().initiative_carrier).toEqual({ value: "local", source: "project" });
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "init"], { cwd: f.root });
	const lane = join(temp, `lane-${counter}`);
	execFileSync("git", ["worktree", "add", "-q", "--detach", lane], { cwd: f.root });
	write(lane, ".imm/config.json", { contract: PROJECT, initiative_carrier: "github" });
	const c = resolveConfig(lane, { userConfigPath: f.userPath });
	expect(c.files.project).toBe(f.projectPath);
	expect(c.initiative_carrier).toEqual({ value: "local", source: "project" });
});

test("retired legacy sources are no longer read", () => {
	const f = fixture();
	write(f.root, ".imm/lanes.local.json", { active: "local", profiles: { local: { max_parallel: 3, executor_host: "pi" } } });
	write(f.root, ".imm/decision-models.local.json", { profiles: { main: fake } });
	write(f.root, ".imm/decision-bindings.json", { contract: "immune_brain/decision_bindings/v1", default_profile: "main", bindings: {}, egress: { clef: ["finding"] } });
	writeFileSync(join(f.root, "AGENTS.md"), "- Git integration: auto\n- Initiative carrier default: local\n");
	execFileSync("git", ["add", "AGENTS.md", ".imm/decision-bindings.json"], { cwd: f.root });
	const c = f.read();
	expect(c.batch.max_parallel).toEqual({ value: 1, source: "default" });
	expect(c.decision_models.profiles).toEqual({ value: {}, source: "default" });
	expect(c.decision_models.default_profile).toEqual({ value: null, source: "default" });
	expect(c.git_integration).toEqual({ value: "manual", source: "default" });
	expect(c.initiative_carrier).toEqual({ value: null, source: "default" });
	expect(c.diagnostics).toEqual([]);
});

test("batchConfigErrors counts only agents, batch, herdr and whole-file errors", () => {
	const f = fixture();
	for (const [data, blocks] of [
		[{ agents: { executor: "codex" } }, true],
		[{ batch: { max_parallel: 9 } }, true],
		[{ session_providers: [] }, true],
		[{ session_providers: ["fake"] }, true],
		[{ herdr: "yes" }, false],
		[{ herdr: true }, false],
		[{ loop: { mode: "always" } }, false],
		[{ initiative_carrier: "gitlab" }, false],
		[{ decision_models: { bindings: { [point]: "missing" } } }, false],
	] as const) {
		f.user(data);
		expect({ data, blocks: batchConfigErrors(f.read()).length > 0 }).toEqual({ data, blocks });
	}
	writeFileSync(f.userPath, "{");
	expect(batchConfigErrors(f.read())).toContainEqual(expect.objectContaining({ key_path: "$" }));
});

test("CLI config --json prints the v2 effective configuration, exits on errors and checks env without values", () => {
	const f = fixture(), configHome = join(temp, "xdg"); mkdirSync(join(configHome, "immune-brain"), { recursive: true });
	f.project({ batch: { max_parallel: 2 }, agents: { executor: "pi:project-model" } });
	const userPath = join(configHome, "immune-brain/config.json");
	writeFileSync(userPath, JSON.stringify({ contract: USER, session_providers: ["herdr-core"], decision_models: { profiles: { x: { kind: "clef", model: "clef", account_id_env: "TEST_ACCOUNT", token_env: "TEST_TOKEN" } } } }));
	const cli = resolve("plugins/immune-brain/bin/imm-kernel");
	const env = { ...process.env, XDG_CONFIG_HOME: configHome, TEST_ACCOUNT: "secret-value" }; delete env.TEST_TOKEN;
	const run = () => spawnSync(cli, ["config", "--json", "--check-env"], { cwd: f.root, encoding: "utf8", env });
	let result = run(); expect(result.status).toBe(0); expect(result.stdout).not.toContain("secret-value");
	const parsed = JSON.parse(result.stdout);
	expect(parsed.contract).toBe("immune_brain/effective_config/v2");
	expect(parsed.decision_models.environment.x).toEqual({ account_id_env: "set", token_env: "unset" });
	expect(parsed.batch.max_parallel).toEqual({ value: 2, source: "project" });
	expect(parsed.session_providers).toEqual({ value: ["herdr-core"], source: "user" });
	expect(parsed).not.toHaveProperty("herdr");
	expect(parsed.agents.roles.executor).toEqual({ host: "pi", model: "project-model", effort: null, source: "project" });
	expect(parsed).not.toHaveProperty("project_key");
	expect(parsed).not.toHaveProperty("lanes");
	f.project({});
	writeFileSync(userPath, JSON.stringify({ contract: USER, agents: { executor: "constructor" } }));
	result = run(); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).diagnostics.some((d: { code: string }) => d.code === "unknown_profile")).toBe(true);
	writeFileSync(userPath, JSON.stringify({ contract: USER, decision_models: { profiles: { x: { kind: "clef", model: "clef", account_id_env: "A", token_env: "sk-live-123" } } } }));
	result = run(); expect(result.status).toBe(1); expect(result.stdout).not.toContain("sk-live-123");
	writeFileSync(userPath, "{"); result = run(); expect(result.status).toBe(1);
});

test("config migrate rewrites v1 user and project files as v2: dry run writes nothing, --write writes", () => {
	const f = fixture();
	execFileSync("git", ["remote", "add", "origin", "git@github.com:O/R.git"], { cwd: f.root });
	const configHome = join(temp, `xdg-migrate-${counter}`), userPath = join(configHome, "immune-brain/config.json");
	const v1User = {
		contract: "immune_brain/user_config/v1",
		agents: {
			profiles: { opus: { host: "claude-code", model: "opus-5-5", effort: "medium", transport: "herdr" }, sonnet: { host: "claude-code", model: "sonnet-5-5" } },
			presets: {
				default: { max_parallel: 2, roles: { "*": "sonnet", "code-review": "opus", plan: "opus" } },
				fast: { max_parallel: 4, roles: { "*": "sonnet", executor: "opus" } },
			},
			active: "default",
		},
		decision_models: { profiles: { main: fake } },
		git_integration: "manual",
		projects: {
			"github.com/O/R": { agents: { active: "fast" }, initiative_carrier: "local", decision_models: { default_profile: "main" } },
			"github.com/X/Y": { initiative_carrier: "github" },
		},
	};
	const v1Project = { contract: "immune_brain/project_config/v1", decision_models: { enabled_points: [point] }, batch: { final_verification: ["bun test"] }, review_verifier: "on" };
	write(configHome, "immune-brain/config.json", v1User);
	f.project(v1Project, v1Project.contract);
	const userAfter = {
		contract: USER,
		agents: {
			profiles: { opus: { host: "claude-code", model: "opus-5-5", effort: "medium" }, sonnet: { host: "claude-code", model: "sonnet-5-5" } },
			executor: "sonnet", reviewer: "opus", planner: "opus", triage: "sonnet",
		},
		batch: { max_parallel: 2 },
		decision_models: { profiles: { main: fake } },
		git_integration: "manual",
	};
	const projectAfter = {
		contract: PROJECT,
		agents: { executor: "opus" },
		batch: { max_parallel: 4, final_verification: ["bun test"] },
		decision_models: { default_profile: "main", bindings: Object.fromEntries(Object.keys(POINT_REGISTRY).filter((p) => p !== point).map((p) => [p, "off"])) },
		review_verifier: "on",
		initiative_carrier: "local",
	};
	const userBytes = readFileSync(userPath, "utf8"), projectBytes = readFileSync(f.projectPath, "utf8");

	const report = migrateConfig(f.root, { userConfigPath: userPath });
	expect(report.user).toMatchObject({ path: userPath, before: v1User, after: userAfter, changed: true });
	expect(report.user.after).not.toHaveProperty("herdr");
	expect(report.project).toMatchObject({ before: v1Project, after: projectAfter, changed: true });
	expect(report.written).toBe(false);
	expect(report.notes.some((n) => n.includes("projects.github.com/X/Y"))).toBe(true);

	const cli = resolve("plugins/immune-brain/bin/imm-kernel");
	const env = { ...process.env, XDG_CONFIG_HOME: configHome };
	const dry = spawnSync(cli, ["config", "migrate"], { cwd: f.root, encoding: "utf8", env });
	expect(dry.status).toBe(0);
	expect(dry.stderr).toContain("dry run");
	expect(JSON.parse(dry.stdout)).toMatchObject({ user: { after: userAfter }, project: { after: projectAfter }, written: false });
	expect(readFileSync(userPath, "utf8")).toBe(userBytes);
	expect(readFileSync(f.projectPath, "utf8")).toBe(projectBytes);

	const wrote = spawnSync(cli, ["config", "migrate", "--write"], { cwd: f.root, encoding: "utf8", env });
	expect(wrote.status).toBe(0);
	expect(JSON.parse(wrote.stdout).written).toBe(true);
	expect(JSON.parse(readFileSync(userPath, "utf8"))).toEqual(userAfter);
	expect(JSON.parse(readFileSync(f.projectPath, "utf8"))).toEqual(projectAfter);
	const c = resolveConfig(f.root, { userConfigPath: userPath });
	expect(c.diagnostics).toEqual([]);
	expect(c.agents.roles.executor).toEqual({ host: "claude-code", model: "opus-5-5", effort: "medium", source: "project" });
	expect(c.decision_models.bindings[other]).toEqual({ value: "off", source: "project" });
	expect(migrateConfig(f.root, { userConfigPath: userPath }).notes).toContain("both files already use the v2 contract");
	// The v1 user file is kept, so another repository's `projects` entry still migrates there, and the
	// migrated user file is not rewritten.
	expect(readFileSync(`${userPath}.v1`, "utf8")).toBe(userBytes);
	const g = fixture();
	execFileSync("git", ["remote", "add", "origin", "git@github.com:X/Y.git"], { cwd: g.root });
	const second = migrateConfig(g.root, { userConfigPath: userPath });
	expect(second.project.after).toEqual({ contract: PROJECT, initiative_carrier: "github" });
	expect(second.user).toMatchObject({ after: userAfter, changed: false });
	const usage = spawnSync(cli, ["config", "migrate", "--force"], { cwd: f.root, encoding: "utf8", env });
	expect({ status: usage.status, stderr: usage.stderr }).toEqual({ status: 2, stderr: "usage: imm-kernel config migrate [--write]\n" });
});

test("config migrate --write deletes a stored herdr key from v2 files and preserves every other key", () => {
	const f = fixture();
	const configHome = join(temp, `xdg-retired-${counter}`), userPath = join(configHome, "immune-brain/config.json");
	mkdirSync(join(configHome, "immune-brain"), { recursive: true });
	const userBefore = { contract: USER, herdr: true, initiative_carrier: "local" };
	const projectBefore = { contract: PROJECT, herdr: false, batch: { max_parallel: 3 } };
	writeFileSync(userPath, JSON.stringify(userBefore));
	writeFileSync(f.projectPath, JSON.stringify(projectBefore));
	const dry = migrateConfig(f.root, { userConfigPath: userPath });
	expect(dry.user.after).toEqual({ contract: USER, initiative_carrier: "local" });
	expect(dry.project.after).toEqual({ contract: PROJECT, batch: { max_parallel: 3 } });
	expect(dry.user.changed).toBe(true);
	expect(dry.project.changed).toBe(true);
	expect(readFileSync(userPath, "utf8")).toBe(JSON.stringify(userBefore));
	const wrote = migrateConfig(f.root, { userConfigPath: userPath, write: true });
	expect(wrote.written).toBe(true);
	expect(JSON.parse(readFileSync(userPath, "utf8"))).toEqual({ contract: USER, initiative_carrier: "local" });
	expect(JSON.parse(readFileSync(f.projectPath, "utf8"))).toEqual({ contract: PROJECT, batch: { max_parallel: 3 } });
	expect(resolveConfig(f.root, { userConfigPath: userPath }).diagnostics).toEqual([]);
});

test("config migrate turns flat v1 user lanes into the executor and reviewer roles", () => {
	const f = fixture();
	f.user({ lanes: { executor_host: "pi", executor_model: "m", executor_effort: "high", review_host: "claude-code" } }, "immune_brain/user_config/v1");
	expect(migrateConfig(f.root, { userConfigPath: f.userPath }).user.after).toEqual({
		contract: USER,
		agents: { executor: { host: "pi", model: "m", effort: "high" }, reviewer: { host: "claude-code" } },
	});
});

test("preload isolates the user configuration", () => {
	expect(realpathSync(process.env.XDG_CONFIG_HOME!).startsWith(realpathSync(tmpdir()))).toBe(true);
	expect(existsSync(join(process.env.XDG_CONFIG_HOME!, "immune-brain/config.json"))).toBe(false);
	for (const file of ["docs/adr/0024-git-integration-preference.md", "docs/adr/0033-lane-preferences-local-preset.md"]) expect(readFileSync(file, "utf8")).toContain("0034");
	expect(existsSync("docs/adr/0034-layered-configuration.md")).toBe(true);
});
