import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { projectTaskStatus } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { readGitIntegrationPreference } from "../plugins/immune-brain/runtime/git_integration_preference";

// ADR 0024 / content-delivery-authority T3: the one-line preference, where it
// is read from, and how the status Tool both Hosts return reports it.
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

describe("readGitIntegrationPreference", () => {
	test("no directive resolves to manual with no diagnostic", () => {
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": "# Agent Instructions\n" }))).toEqual({ mode: "manual", source: null, diagnostic: null });
		expect(readGitIntegrationPreference(repo({}))).toEqual({ mode: "manual", source: null, diagnostic: null });
	});

	for (const value of ["manual", "auto", "`auto`"]) test(`a tracked AGENTS.md declaring ${value} is honored`, () => {
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": declares(value) }))).toEqual({ mode: value.replaceAll("`", ""), source: "AGENTS.md", diagnostic: expect.stringContaining("git_integration in .imm/config.json") });
	});

	test("AGENTS.md wins over CLAUDE.md, and CLAUDE.md applies when AGENTS.md says nothing", () => {
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": declares("manual"), "CLAUDE.md": declares("auto") })).mode).toBe("manual");
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": "# Agents\n", "CLAUDE.md": declares("auto") }))).toEqual({ mode: "auto", source: "CLAUDE.md", diagnostic: expect.stringContaining("deprecated") });
	});

	test("an untracked instruction file declares nothing", () => {
		expect(readGitIntegrationPreference(repo({}, { "AGENTS.md": declares("auto") }))).toEqual({ mode: "manual", source: null, diagnostic: null });
	});

	test("tracked project configuration overrides the legacy directive", () => {
		const config = JSON.stringify({ contract: "immune_brain/project_config/v1", git_integration: "auto" });
		const root = repo({ ".imm/config.json": config, "AGENTS.md": declares("manual") });
		expect(readGitIntegrationPreference(root)).toEqual({ mode: "auto", source: ".imm/config.json", diagnostic: null });
	});

	test("invalid and untracked project values fail to manual", () => {
		const config = (value: string) => JSON.stringify({ contract: "immune_brain/project_config/v1", git_integration: value });
		const invalid = readGitIntegrationPreference(repo({ ".imm/config.json": config("sometimes"), "AGENTS.md": declares("auto") }));
		expect(invalid).toEqual({ mode: "manual", source: ".imm/config.json", diagnostic: expect.stringContaining("git_integration") });
		expect(invalid.diagnostic).toContain(".imm/config.json");
		expect(readGitIntegrationPreference(repo({}, { ".imm/config.json": config("auto") }))).toEqual({ mode: "manual", source: null, diagnostic: null });
	});

	test("an invalid user key does not misreport a valid project policy", () => {
		const root = repo({ ".imm/config.json": JSON.stringify({ contract: "immune_brain/project_config/v1", git_integration: "auto" }) });
		const previous = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(root, "user-config");
		try {
			const dir = join(root, "user-config", "immune-brain");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "config.json"), JSON.stringify({ contract: "immune_brain/user_config/v1", git_integration: "manual" }));
			expect(readGitIntegrationPreference(root)).toEqual({ mode: "auto", source: ".imm/config.json", diagnostic: null });
		} finally {
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
		}
	});

	test("a malformed project file fails closed even with a legacy auto directive", () => {
		const preference = readGitIntegrationPreference(repo({ ".imm/config.json": "{", "AGENTS.md": declares("auto") }));
		expect(preference).toEqual({ mode: "manual", source: ".imm/config.json", diagnostic: expect.stringContaining(".imm/config.json") });
	});

	test("an invalid value behaves as manual with a diagnostic naming the file and the key", () => {
		const preference = readGitIntegrationPreference(repo({ "AGENTS.md": declares("always") }));
		expect(preference.mode).toBe("manual");
		expect(preference.source).toBe("AGENTS.md");
		expect(preference.diagnostic).toContain("AGENTS.md");
		expect(preference.diagnostic).toContain("git_integration");
	});
});

describe("status reports the resolved preference", () => {
	test("the status projection carries the resolved mode and its source", async () => {
		expect((await projectTaskStatus(repo({ "AGENTS.md": declares("auto") }), "absent-task")).git_integration).toEqual({ mode: "auto", source: "AGENTS.md" });
		expect((await projectTaskStatus(repo({}), "absent-task")).git_integration).toEqual({ mode: "manual", source: null });
	});

	test("a valid legacy declaration is reported as deprecated", async () => {
		const status = await projectTaskStatus(repo({ "AGENTS.md": declares("auto") }), "absent-task");
		expect(status.warnings?.find((warning) => warning.code === "deprecated_git_integration")).toMatchObject({
			paths: ["AGENTS.md"], message: expect.stringContaining("git_integration in .imm/config.json"),
		});
	});

	test("an invalid value is a visible invalid_git_integration warning", async () => {
		const status = await projectTaskStatus(repo({ "CLAUDE.md": declares("yes") }), "absent-task");
		expect(status.git_integration).toEqual({ mode: "manual", source: "CLAUDE.md" });
		expect(status.warnings?.find((warning) => warning.code === "invalid_git_integration")).toMatchObject({
			paths: ["CLAUDE.md"], message: expect.stringContaining("using manual"),
		});
	});
	// Both Hosts' status Tools: tests/dual-host-assurance-conformance.test.ts.
});

describe("ADR 0024 and its contract text", () => {
	test("ADR 0024 supersedes ADR 0023 and the configuration reference documents the preference", () => {
		expect(readFileSync("docs/adr/0023-silent-precondition-commit.md", "utf8")).toContain("superseded_by: docs/adr/0024-git-integration-preference.md");
		expect(readFileSync("docs/adr/0024-git-integration-preference.md", "utf8")).toMatch(/^---\nstatus: accepted\n---/);
		const reference = readFileSync("docs/reference/immune-brain-config.md", "utf8");
		expect(reference).toContain("## Git Integration");
		expect(reference).toContain("- Git integration: manual");
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
