import { afterAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import { POINT_REGISTRY } from "../plugins/immune-brain/runtime/decision_model/thresholds.ts";

const temp = mkdtempSync(join(tmpdir(), "layered-config-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let counter = 0;
function fixture() {
	const root = join(temp, `repo-${counter++}`), userPath = join(temp, `user-${counter}.json`);
	mkdirSync(join(root, ".imm"), { recursive: true });
	execFileSync("git", ["init", "-q", root]);
	const user = (data: object) => writeFileSync(userPath, JSON.stringify({ contract: "immune_brain/user_config/v1", ...data }));
	const project = (data: object, tracked = true) => {
		writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v1", ...data }));
		if (tracked) execFileSync("git", ["add", ".imm/config.json"], { cwd: root });
	};
	const read = (checkEnv = false) => resolveConfig(root, { userConfigPath: userPath, checkEnv });
	return { root, userPath, user, project, read };
}
const write = (root: string, path: string, data: unknown) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), JSON.stringify(data)); };
const fake = { kind: "fake", answers: {} };

test("resolves D4 precedence, egress ceiling, host pairing, and defaults", () => {
	const f = fixture();
	execFileSync("git", ["remote", "add", "origin", "git@github.com:O/R.git"], { cwd: f.root });
	f.project({ git_integration: "auto", initiative_carrier: "github", lanes: { max_parallel: 2, executor_host: "pi", executor_model: "project-model" }, batch: { final_verification: ["bun test"] }, decision_models: { egress: { clef: ["finding", "diff"] } } });
	f.user({ initiative_carrier: "local", decision_models: { profiles: { main: fake }, default_profile: "main", egress: { clef: ["finding", "goal_scope"] } }, lanes: { active: "laptop", profiles: { laptop: { executor_host: "claude-code", max_parallel: 4 } } }, projects: { "github.com/O/R": { decision_models: { default_profile: "main" }, initiative_carrier: "local" } } });
	const c = f.read();
	expect(c.project_key).toBe("github.com/O/R");
	expect(c.git_integration).toEqual({ value: "auto", source: "project" });
	expect(c.initiative_carrier).toEqual({ value: "github", source: "project" });
	expect(c.decision_models.default_profile).toEqual({ value: "main", source: "user:project" });
	expect(c.decision_models.egress.clef.value).toEqual(["finding"]);
	expect(c.diagnostics.map(d => d.code)).toContain("egress_beyond_project_ceiling");
	expect(c.decision_models.enabled_points.value).toEqual(Object.keys(POINT_REGISTRY));
	expect(c.lanes.max_parallel).toEqual({ value: 4, source: "user" });
	expect(c.lanes.executor_model.value).toBeNull();
	expect(c.diagnostics.map(d => d.code)).toContain("not_applied");
	expect(c.batch.final_verification.value).toEqual(["bun test"]);
});

test("applies each personal and repository precedence in D4", () => {
	const f = fixture(), point = Object.keys(POINT_REGISTRY)[0]!;
	const key = realpathSync(f.root);
	f.user({
		initiative_carrier: "github",
		decision_models: { profiles: { a: fake, b: fake }, default_profile: "a", bindings: { [point]: "a" }, egress: { clef: ["finding", "diff"] } },
		lanes: { active: "a", profiles: { a: { max_parallel: 2, executor_host: "pi", executor_model: "a" }, b: { max_parallel: 5, executor_host: "claude-code", executor_model: "b", executor_effort: "high" } } },
		projects: { [key]: { initiative_carrier: "local", decision_models: { default_profile: "b", bindings: { [point]: "b" }, egress: { clef: ["finding"] } }, lanes: { active: "b" } } },
	});
	let c = f.read();
	expect(c.initiative_carrier).toEqual({ value: "local", source: "user:project" });
	expect(c.decision_models.bindings[point]).toEqual({ value: "b", source: "user:project" });
	expect(c.lanes.active).toEqual({ value: "b", source: "user:project" });
	expect(c.lanes.executor_model).toEqual({ value: "b", source: "user:project" });
	expect(c.lanes.executor_effort).toEqual({ value: "high", source: "user:project" });
	f.project({ initiative_carrier: "github", git_integration: "auto", batch: { final_verification: ["bun test"] }, decision_models: { enabled_points: [point], egress: { clef: ["finding", "diff"] } }, lanes: { max_parallel: 1, executor_host: "pi", executor_model: "p" } });
	c = f.read();
	expect(c.initiative_carrier).toEqual({ value: "github", source: "project" });
	expect(c.decision_models.enabled_points).toEqual({ value: [point], source: "project" });
	expect(c.decision_models.egress.clef).toEqual({ value: ["finding"], source: "user:project" });
	expect(c.git_integration.source).toBe("project");
	expect(c.batch.final_verification.source).toBe("project");
});

test("normalizes origin and resolves worktrees and no-origin main checkout", () => {
	const f = fixture();
	for (const url of ["https://github.com/O/R.git", "ssh://git@github.com/O/R", "git@github.com:O/R.git"]) {
		spawnSync("git", ["remote", "remove", "origin"], { cwd: f.root });
		execFileSync("git", ["remote", "add", "origin", url], { cwd: f.root });
		expect(f.read().project_key).toBe("github.com/O/R");
	}
	f.user({ projects: { "github.com/O/R": { initiative_carrier: "local" } } });
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "init"], { cwd: f.root });
	const other = join(temp, "worktree");
	execFileSync("git", ["worktree", "add", "-q", "--detach", other], { cwd: f.root });
	expect(resolveConfig(other, { userConfigPath: f.userPath }).initiative_carrier).toEqual({ value: "local", source: "user:project" });
	execFileSync("git", ["remote", "remove", "origin"], { cwd: f.root });
	expect(resolveConfig(other, { userConfigPath: f.userPath }).project_key).toBe(realpathSync(f.root));
});

test.each([
	["malformed", '{', "$"], ["contract", '{"contract":"bad"}', "contract"],
	["unknown", JSON.stringify({ contract: "immune_brain/user_config/v1", lanes: { mystery: true } }), "lanes.mystery"],
	["unknown profile", JSON.stringify({ contract: "immune_brain/user_config/v1", lanes: { active: "missing" } }), "lanes.active"],
	["invalid host", JSON.stringify({ contract: "immune_brain/user_config/v1", lanes: { active: "x", profiles: { x: { executor_host: "codex" } } } }), "lanes.profiles.x.executor_host"],
	["pasted token", JSON.stringify({ contract: "immune_brain/user_config/v1", decision_models: { profiles: { x: { kind: "clef", model: "clef", account_id_env: "ACCOUNT", token_env: "sk-live-123" } } } }), "decision_models.profiles.x.token_env"],
])("refuses %s with a redacted named diagnostic", (_name, content, path) => {
	const f = fixture(); f.project({ git_integration: "auto" }); writeFileSync(f.userPath, content);
	const c = f.read(true), output = JSON.stringify(c);
	expect(c.diagnostics.some(d => d.severity === "error" && d.file === f.userPath && d.key_path === path)).toBe(true);
	expect(output).not.toContain("sk-live-123");
	expect(c.git_integration.value).toBe("auto");
});

test.each(["constructor", "toString", "__proto__"])("lane profile %s must be an own property in new and legacy files", name => {
	const f = fixture();
	f.user({ lanes: { active: name, profiles: {} } });
	let c = f.read();
	expect(c.lanes.valid).toBe(false);
	expect(c.diagnostics.some(d => d.code === "unknown_profile" && d.key_path === "lanes.active")).toBe(true);
	f.user({ lanes: { active: name, profiles: { [name]: { max_parallel: 2 } } } });
	c = f.read(); expect(c.lanes.valid).toBe(true); expect(c.lanes.max_parallel.value).toBe(2);
	rmSync(f.userPath);
	write(f.root, ".imm/lanes.local.json", { active: name, profiles: {} });
	c = f.read(); expect(c.lanes.valid).toBe(false); expect(c.diagnostics.some(d => d.code === "unknown_profile")).toBe(true);
	write(f.root, ".imm/lanes.local.json", { active: name, profiles: { [name]: { max_parallel: 3 } } });
	c = f.read(); expect(c.lanes.valid).toBe(true); expect(c.lanes.max_parallel.value).toBe(3);
});

test("ignores untracked project file", () => {
	const f = fixture(); f.project({ git_integration: "auto" }, false);
	const c = f.read();
	expect(c.lanes.profiles).toEqual({ value: {}, source: "default" });
	expect(c.decision_models.profiles).toEqual({ value: {}, source: "default" });
	expect(c.git_integration).toEqual({ value: "manual", source: "default" });
});

test("legacy sources warn and new layers replace them", () => {
	const f = fixture();
	write(f.root, ".imm/lanes.local.json", { active: "local", profiles: { local: { max_parallel: 3, executor_host: "pi" } } });
	write(f.root, ".imm/decision-models.local.json", { profiles: { main: fake } });
	write(f.root, ".imm/decision-bindings.json", { contract: "immune_brain/decision_bindings/v1", default_profile: "main", bindings: {}, egress: {} });
	writeFileSync(join(f.root, "AGENTS.md"), "- Git integration: auto\n- Initiative carrier default: local\n");
	execFileSync("git", ["add", "AGENTS.md", ".imm/decision-bindings.json"], { cwd: f.root });
	let c = f.read();
	expect(c.lanes.max_parallel.source).toBe("legacy:.imm/lanes.local.json");
	expect(c.lanes.profiles).toEqual({ value: { local: { max_parallel: 3, executor_host: "pi" } }, source: "legacy:.imm/lanes.local.json" });
	expect(c.decision_models.profiles).toEqual({ value: { main: fake }, source: "legacy:.imm/decision-models.local.json" });
	expect(c.decision_models.default_profile.source).toBe("legacy:.imm/decision-bindings.json");
	expect(c.git_integration.source).toBe("legacy:AGENTS.md");
	expect(c.initiative_carrier.source).toBe("legacy:AGENTS.md");
	expect(c.diagnostics.filter(d => d.code === "deprecated_config_source")).toHaveLength(5);
	f.project({ git_integration: "manual", initiative_carrier: "github", lanes: { max_parallel: 1 }, decision_models: { egress: {} } });
	f.user({ lanes: { profiles: {} }, decision_models: { profiles: {}, default_profile: "x", bindings: {} } });
	c = f.read();
	expect(c.diagnostics.some(d => d.code === "legacy_source_ignored" && d.file === ".imm/lanes.local.json")).toBe(true);
	expect(c.diagnostics.some(d => d.code === "legacy_source_ignored" && d.file === "AGENTS.md")).toBe(true);
	expect(c.lanes.profiles).toEqual({ value: {}, source: "user" });
	expect(c.decision_models.profiles).toEqual({ value: {}, source: "user" });
});

test.each(["lane", "profiles", "bindings", "git", "carrier"])("resolves and replaces the %s legacy source on its own", kind => {
	const f = fixture();
	let path: string, replacement: string;
	if (kind === "lane") { path = ".imm/lanes.local.json"; replacement = "lanes"; write(f.root, path, { active: "x", profiles: { x: { max_parallel: 3 } } }); }
	else if (kind === "profiles") { path = ".imm/decision-models.local.json"; replacement = "decision_models.profiles"; write(f.root, path, { profiles: { x: fake } }); }
	else if (kind === "bindings") { path = ".imm/decision-bindings.json"; replacement = "decision_models"; write(f.root, path, { contract: "immune_brain/decision_bindings/v1", default_profile: null, bindings: {}, egress: { clef: ["finding"] } }); execFileSync("git", ["add", path], { cwd: f.root }); }
	else { path = "AGENTS.md"; replacement = kind === "git" ? "git_integration" : "initiative_carrier"; writeFileSync(join(f.root, path), kind === "git" ? "- Git integration: auto\n" : "- Initiative carrier default: local\n"); execFileSync("git", ["add", path], { cwd: f.root }); }
	const source = (c: ReturnType<typeof resolveConfig>) => kind === "lane" ? c.lanes.max_parallel.source : kind === "profiles" ? c.decision_models.profiles.source : kind === "bindings" ? c.decision_models.egress.clef.source : kind === "git" ? c.git_integration.source : c.initiative_carrier.source;
	let c = f.read();
	expect(source(c)).toBe(`legacy:${path}`);
	expect(c.diagnostics.some(d => d.code === "deprecated_config_source" && d.file === path && d.key_path === replacement)).toBe(true);
	if (kind === "lane") f.project({ lanes: { max_parallel: 1 } });
	else if (kind === "profiles") f.user({ decision_models: { profiles: {} } });
	else if (kind === "bindings") f.project({ decision_models: { egress: { clef: [] } } });
	else f.project(kind === "git" ? { git_integration: "manual" } : { initiative_carrier: "github" });
	c = f.read();
	expect(source(c)).not.toBe(`legacy:${path}`);
	expect(c.diagnostics.some(d => d.code === "legacy_source_ignored" && d.file === path)).toBe(true);
});

test.each(["user", "project", "legacy"])("invalid %s Lane values never reach output and other sections remain valid", source => {
	const f = fixture(), secret = "sk-live-123";
	const invalidProfile = { max_parallel: 3, token_env: secret };
	if (source === "user") f.user({ lanes: { active: "local", profiles: { local: invalidProfile } } });
	else if (source === "project") f.project({ lanes: invalidProfile });
	else write(f.root, ".imm/lanes.local.json", { active: "local", profiles: { local: invalidProfile } });
	const c = f.read(true);
	expect(c.lanes.valid).toBe(false);
	expect(c.decision_models.valid).toBe(true);
	expect(c.diagnostics.some(d => d.severity === "error" && d.file === (source === "user" ? f.userPath : source === "project" ? ".imm/config.json" : ".imm/lanes.local.json") && d.key_path.endsWith(".token_env"))).toBe(true);
	expect(c.lanes.profiles).toEqual({ value: {}, source: "default" });
	expect(JSON.stringify(c)).not.toContain(secret);
});

test("invalid legacy credential names are redacted and fail the section closed", () => {
	const f = fixture();
	write(f.root, ".imm/decision-models.local.json", { profiles: { x: { kind: "clef", model: "clef", account_id_env: "ACCOUNT", token_env: "sk-live-123" } } });
	const c = f.read(true);
	expect(c.decision_models.valid).toBe(false);
	expect(c.diagnostics.some(d => d.key_path === "profiles.x.token_env")).toBe(true);
	expect(JSON.stringify(c)).not.toContain("sk-live-123");
});

test("CLI exits based on diagnostics and checks env without disclosing values", () => {
	const f = fixture(), configHome = join(temp, "xdg"); mkdirSync(join(configHome, "immune-brain"), { recursive: true });
	const userPath = join(configHome, "immune-brain/config.json");
	writeFileSync(userPath, JSON.stringify({ contract: "immune_brain/user_config/v1", decision_models: { profiles: { x: { kind: "clef", model: "clef", account_id_env: "TEST_ACCOUNT", token_env: "TEST_TOKEN" } } } }));
	const cli = resolve("plugins/immune-brain/bin/imm-kernel");
	const env = { ...process.env, XDG_CONFIG_HOME: configHome, TEST_ACCOUNT: "secret-value" }; delete env.TEST_TOKEN;
	const run = () => spawnSync(cli, ["config", "--json", "--check-env"], { cwd: f.root, encoding: "utf8", env });
	let result = run(); expect(result.status).toBe(0); expect(result.stdout).not.toContain("secret-value");
	expect(JSON.parse(result.stdout).decision_models.environment.x).toEqual({ account_id_env: "set", token_env: "unset" });
	writeFileSync(userPath, JSON.stringify({ contract: "immune_brain/user_config/v1", lanes: { active: "constructor", profiles: {} } }));
	result = run(); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).diagnostics.some((d: { code: string }) => d.code === "unknown_profile")).toBe(true);
	rmSync(userPath);
	write(f.root, ".imm/lanes.local.json", { active: "local", profiles: { local: { max_parallel: 3, token_env: "sk-live-123" } } });
	result = run(); expect(result.status).toBe(1); expect(result.stdout).not.toContain("sk-live-123");
	writeFileSync(userPath, "{"); result = run(); expect(result.status).toBe(1);
});

test("preload isolates configuration and required ADRs and tracked project config exist", () => {
	expect(realpathSync(process.env.XDG_CONFIG_HOME!).startsWith(realpathSync(tmpdir()))).toBe(true);
	expect(existsSync(join(process.env.XDG_CONFIG_HOME!, "immune-brain/config.json"))).toBe(false);
	for (const file of ["docs/adr/0024-git-integration-preference.md", "docs/adr/0033-lane-preferences-local-preset.md"]) expect(readFileSync(file, "utf8")).toContain("0034");
	expect(existsSync("docs/adr/0034-layered-configuration.md")).toBe(true);
	expect(resolveConfig(process.cwd()).initiative_carrier).toEqual({ value: "github", source: "project" });
});
