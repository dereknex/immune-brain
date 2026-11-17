import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { projectTaskStatus } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { readGitIntegrationPreference } from "../plugins/immune-brain/runtime/git_integration_preference";

// ADR 0024 / ADR 0041: the git_integration preference, which layer it is read
// from, and how the status Tool both Hosts return reports it.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function repo(files: Record<string, string>, untracked: Record<string, string> = {}) {
	const root = mkdtempSync(join(tmpdir(), "imm-git-integration-"));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
	if (Object.keys(files).length > 0) git(root, "add", "--", ...Object.keys(files));
	for (const [path, text] of Object.entries(untracked)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
	return root;
}
const declares = (value: string) => `# Agent Instructions\n\n## Immune-Brain Preferences\n\n- Initiative carrier default: github\n- Git integration: ${value}\n`;
const projectFile = (body: object | string) => ({ ".imm/config.json": typeof body === "string" ? body : JSON.stringify({ contract: "immune_brain/project_config/v2", ...body }) });
const userFile = (body: object = {}) => ({ contract: "immune_brain/user_config/v2", ...body });
/** User-file contents that are invalid for git_integration: a bad value, malformed JSON, a retired v1 contract. */
const INVALID_USER: Array<[string, unknown]> = [
	["invalid value", userFile({ git_integration: "sometimes" })],
	["malformed JSON", "{"],
	["v1 contract", { contract: "immune_brain/user_config/v1", git_integration: "auto" }],
];
const INVALID_PROJECT: Array<[string, string]> = [
	["invalid value", JSON.stringify({ contract: "immune_brain/project_config/v2", git_integration: "sometimes" })],
	["malformed JSON", "{"],
	["v1 contract", JSON.stringify({ contract: "immune_brain/project_config/v1", git_integration: "auto" })],
];

const withUserConfig = <T>(root: string, content: unknown, fn: (userPath: string) => T): T => {
	const previous = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = join(root, "user-config");
	try {
		const dir = join(root, "user-config", "immune-brain");
		mkdirSync(dir, { recursive: true });
		const userPath = join(dir, "config.json");
		writeFileSync(userPath, typeof content === "string" ? content : JSON.stringify(content));
		return fn(userPath);
	} finally {
		if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previous;
	}
};

const withUserConfigAsync = async <T>(root: string, content: unknown, fn: (userPath: string) => Promise<T>): Promise<T> => {
	const previous = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = join(root, "user-config");
	try {
		const dir = join(root, "user-config", "immune-brain");
		mkdirSync(dir, { recursive: true });
		const userPath = join(dir, "config.json");
		writeFileSync(userPath, typeof content === "string" ? content : JSON.stringify(content));
		return await fn(userPath);
	} finally {
		if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previous;
	}
};

describe("readGitIntegrationPreference", () => {
	test("no configuration resolves to manual with no diagnostic", () => {
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": "# Agent Instructions\n" }))).toEqual({ mode: "manual", source: null, diagnostic: null });
		expect(readGitIntegrationPreference(repo({}))).toEqual({ mode: "manual", source: null, diagnostic: null });
	});

	test("a Git integration line in AGENTS.md or CLAUDE.md is no longer read", () => {
		for (const files of [{ "AGENTS.md": declares("auto") }, { "CLAUDE.md": declares("auto") }])
			expect(readGitIntegrationPreference(repo(files))).toEqual({ mode: "manual", source: null, diagnostic: null });
		expect(readGitIntegrationPreference(repo({}, { "AGENTS.md": declares("auto") }))).toEqual({ mode: "manual", source: null, diagnostic: null });
	});

	test.each([
		["manual", true], ["auto", true], ["manual", false], ["auto", false],
	] as const)("a project file declaring %s is honored (tracked: %p)", (value, tracked) => {
		const files = projectFile({ git_integration: value });
		const root = tracked ? repo({ ...files, "AGENTS.md": declares(value === "auto" ? "manual" : "auto") }) : repo({}, files);
		expect(readGitIntegrationPreference(root)).toEqual({ mode: value, source: ".imm/config.json", diagnostic: null });
	});

	test.each([
		["user auto, no project value", userFile({ git_integration: "auto" }), {}, "auto", "user"],
		["user auto, project manual: manual wins", userFile({ git_integration: "auto" }), { git_integration: "manual" }, "manual", "project"],
		["user manual, project auto: manual wins", userFile({ git_integration: "manual" }), { git_integration: "auto" }, "manual", "user"],
		["user unset, project auto", userFile(), { git_integration: "auto" }, "auto", "project"],
		["user unset, project unset", userFile(), {}, "manual", null],
	] as const)("%s", (_name, user, project, mode, layer) => {
		const root = repo(projectFile(project));
		withUserConfig(root, user, (userPath) => {
			expect(readGitIntegrationPreference(root)).toEqual({ mode, source: layer === "user" ? userPath : layer === "project" ? ".imm/config.json" : null, diagnostic: null });
		});
	});

	test("an unrelated user section error does not misreport a valid project policy", () => {
		const root = repo(projectFile({ git_integration: "auto" }));
		withUserConfig(root, userFile({ agents: { executor: "not-a-host" } }), () => {
			expect(readGitIntegrationPreference(root)).toEqual({ mode: "auto", source: ".imm/config.json", diagnostic: null });
		});
	});

	// An invalid user value or a void user file behaves as manual even when the project sets auto.
	test.each(INVALID_USER)("an invalid user file (%s) fails closed to manual even when the project sets auto", (_name, payload) => {
		const root = repo(projectFile({ git_integration: "auto" }));
		withUserConfig(root, payload, (userPath) => {
			expect(readGitIntegrationPreference(root)).toEqual({ mode: "manual", source: userPath, diagnostic: expect.stringContaining(userPath) });
		});
	});

	test.each(INVALID_PROJECT)("an invalid project file (%s) is manual with a diagnostic naming the file", (_name, content) => {
		const preference = readGitIntegrationPreference(repo({ ".imm/config.json": content }));
		expect(preference).toEqual({ mode: "manual", source: ".imm/config.json", diagnostic: expect.stringContaining(".imm/config.json") });
	});
});

describe("status reports the resolved preference", () => {
	test("the status projection carries the resolved mode and its source", async () => {
		expect((await projectTaskStatus(repo(projectFile({ git_integration: "auto" })), "absent-task")).git_integration).toEqual({ mode: "auto", source: ".imm/config.json" });
		expect((await projectTaskStatus(repo({ "AGENTS.md": declares("auto") }), "absent-task")).git_integration).toEqual({ mode: "manual", source: null });
	});

	test("status reports a user-resolved git_integration and the stricter project manual", async () => {
		const root = repo({});
		await withUserConfigAsync(root, userFile({ git_integration: "auto" }), async (userPath) => {
			const status = await projectTaskStatus(root, "absent-task");
			expect(status.git_integration).toEqual({ mode: "auto", source: userPath });
			expect(status.config?.files.user).toBe(userPath);
			expect(status.config?.git_integration).toEqual({ value: "auto", source: "user" });
			expect((status.warnings ?? []).some((w) => w.code === "invalid_git_integration" || w.code === "config_invalid")).toBe(false);
		});
		const manualProject = repo(projectFile({ git_integration: "manual" }));
		await withUserConfigAsync(manualProject, userFile({ git_integration: "auto" }), async () => {
			const status = await projectTaskStatus(manualProject, "absent-task");
			expect(status.git_integration).toEqual({ mode: "manual", source: ".imm/config.json" });
			expect(status.config?.git_integration).toEqual({ value: "manual", source: "project" });
		});
	});

	test("an invalid project file is a visible config_invalid warning naming the file", async () => {
		for (const [, content] of INVALID_PROJECT) {
			const root = repo({ ".imm/config.json": content });
			const status = await projectTaskStatus(root, "absent-task");
			expect(status.git_integration.mode).toBe("manual");
			expect(status.warnings?.find((w) => w.code === "config_invalid")).toMatchObject({
				paths: [status.config!.files.project], message: expect.stringContaining(".imm/config.json"),
			});
		}
	});

	test("an invalid user file fails closed with warnings naming config.files.user", async () => {
		const root = repo(projectFile({ git_integration: "auto" }));
		for (const [, payload] of INVALID_USER) {
			await withUserConfigAsync(root, payload, async (userPath) => {
				const status = await projectTaskStatus(root, "absent-task");
				expect(status.git_integration).toEqual({ mode: "manual", source: userPath });
				expect(status.config?.git_integration).toEqual({ value: "manual", source: "user" });
				expect(status.warnings?.find((w) => w.code === "invalid_git_integration")).toMatchObject({ paths: [userPath], message: expect.stringContaining(userPath) });
				expect(status.warnings?.find((w) => w.code === "config_invalid")).toMatchObject({ paths: [userPath], message: expect.stringContaining(userPath) });
			});
		}
	});
	// Both Hosts' status Tools: tests/dual-host-assurance-conformance.test.ts.
});

describe("ADR 0024 and its contract text", () => {
	test("ADR 0024 supersedes ADR 0023 and the configuration reference documents the preference", () => {
		expect(readFileSync("docs/adr/0023-silent-precondition-commit.md", "utf8")).toContain("superseded_by: docs/adr/0024-git-integration-preference.md");
		expect(readFileSync("docs/adr/0024-git-integration-preference.md", "utf8")).toMatch(/^---\nstatus: accepted\n---/);
		const reference = readFileSync("docs/reference/immune-brain-config.md", "utf8");
		expect(reference).toContain("## Git Integration");
		expect(reference).toContain('{ "contract": "immune_brain/user_config/v2", "git_integration": "manual" }');
		expect(reference).toContain("| `git_integration` | stricter wins: `manual` if either file sets it |");
		expect(readFileSync("plugins/immune-brain/dist/docs/reference/immune-brain-config.md", "utf8")).toBe(reference);
	});

	test("an unborn HEAD refuses drive and Enrollment commits nothing (ADR 0036)", () => {
		const reference = readFileSync("docs/reference/immune-brain-config.md", "utf8");
		expect(reference).toContain("An unborn HEAD refuses `drive` until the first commit exists");
		expect(reference).toContain("Enrollment writes no commit in either");
		expect(reference).toContain("the repository HEAD stays the task's Git base");
		expect(reference).not.toContain("keeps the precondition commits of ADR 0023");
		expect(reference).not.toContain("The confirmed empty root commit for an unborn HEAD is made in both modes");
		const adr = readFileSync("docs/adr/0024-git-integration-preference.md", "utf8");
		expect(adr).toContain("[ADR 0036](0036-unborn-head-refuses-drive.md)");
	});

	test("every BASELINE copy describes the preference instead of a silent commit", () => {
		const copies = ["plugins/immune-brain/BASELINE.md", "plugins/immune-brain/skills/BASELINE.md", "plugins/immune-brain/dist/BASELINE.md"]
			.map((path) => readFileSync(path, "utf8"));
		for (const copy of copies) {
			expect(copy).toBe(copies[0]);
			expect(copy).toContain("`Git integration` preference");
			expect(copy).toContain("`.imm/config.json`");
			expect(copy).not.toContain("The commit is silent");
		}
	});
});
