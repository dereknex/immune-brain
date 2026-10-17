import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
	if (Object.keys(files).length > 0) git(root, "add", "--", ...Object.keys(files));
	for (const [path, text] of Object.entries(untracked)) writeFileSync(join(root, path), text);
	return root;
}
const declares = (value: string) => `# Agent Instructions\n\n## Immune-Brain Preferences\n\n- Initiative carrier default: github\n- Git integration: ${value}\n`;

describe("readGitIntegrationPreference", () => {
	test("no directive resolves to manual with no diagnostic", () => {
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": "# Agent Instructions\n" }))).toEqual({ mode: "manual", source: null, diagnostic: null });
		expect(readGitIntegrationPreference(repo({}))).toEqual({ mode: "manual", source: null, diagnostic: null });
	});

	for (const value of ["manual", "auto", "`auto`"]) test(`a tracked AGENTS.md declaring ${value} is honored`, () => {
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": declares(value) }))).toEqual({ mode: value.replaceAll("`", ""), source: "AGENTS.md", diagnostic: null });
	});

	test("AGENTS.md wins over CLAUDE.md, and CLAUDE.md applies when AGENTS.md says nothing", () => {
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": declares("manual"), "CLAUDE.md": declares("auto") })).mode).toBe("manual");
		expect(readGitIntegrationPreference(repo({ "AGENTS.md": "# Agents\n", "CLAUDE.md": declares("auto") }))).toEqual({ mode: "auto", source: "CLAUDE.md", diagnostic: null });
	});

	test("an untracked instruction file declares nothing", () => {
		expect(readGitIntegrationPreference(repo({}, { "AGENTS.md": declares("auto") }))).toEqual({ mode: "manual", source: null, diagnostic: null });
	});

	test("an invalid value behaves as manual with a diagnostic naming the file and the value", () => {
		const preference = readGitIntegrationPreference(repo({ "AGENTS.md": declares("always") }));
		expect(preference.mode).toBe("manual");
		expect(preference.source).toBe("AGENTS.md");
		expect(preference.diagnostic).toContain("AGENTS.md");
		expect(preference.diagnostic).toContain("\"always\"");
	});
});

describe("status reports the resolved preference", () => {
	test("the status projection carries the resolved mode and its source", async () => {
		expect((await projectTaskStatus(repo({ "AGENTS.md": declares("auto") }), "absent-task")).git_integration).toEqual({ mode: "auto", source: "AGENTS.md" });
		expect((await projectTaskStatus(repo({}), "absent-task")).git_integration).toEqual({ mode: "manual", source: null });
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

	test("every BASELINE copy describes the preference instead of a silent commit", () => {
		const copies = ["plugins/immune-brain/BASELINE.md", "plugins/immune-brain/skills/BASELINE.md", "plugins/immune-brain/dist/BASELINE.md"]
			.map((path) => readFileSync(path, "utf8"));
		for (const copy of copies) {
			expect(copy).toBe(copies[0]);
			expect(copy).toContain("`Git integration` preference");
			expect(copy).not.toContain("The commit is silent");
		}
	});
});
