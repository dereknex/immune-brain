// P2B2 U2: real packed-artifact loader evidence. Executes `npm pack` to a
// temporary directory, extracts the tarball, and loads the shipped extensions
// and Skills through the real Pi resource loader to prove discovery from
// shipped bytes (not source-tree membership).

import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const RETIRED_PROGRESS_FILES = [
	"plugins/immune-brain/.pi-extension/index.ts",
	"plugins/immune-brain/.pi-extension/progress_client.ts",
	"plugins/immune-brain/.pi-extension/progress_views.ts",
];

function listFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...listFiles(path));
		else files.push(path);
	}
	return files;
}

function extractTarball(): { dir: string; tarball: string } {
	const dir = mkdtempSync(join(tmpdir(), "p2b2-packed-"));
	const tarball = join(dir, "pkg.tgz");
	const result = spawnSync("npm", ["pack", "--silent", "--pack-destination", dir], {
		cwd: ROOT,
		encoding: "utf8",
		timeout: 300_000,
	});
	if (result.status !== 0) {
		throw new Error(`npm pack failed: ${result.stderr || result.stdout}`);
	}
	const name = result.stdout.trim().split("\n").pop() ?? "";
	const packed = join(dir, name);
	execFileSync("tar", ["-xzf", packed, "-C", dir], { stdio: "ignore" });
	return { dir, tarball: packed };
}

describe("packed artifact loader", () => {
	test("npm pack produces a tarball with only the public Skills and internal runtime", () => {
		const { dir } = extractTarball();
		try {
			const pkgDir = join(dir, "package");
			for (const f of [
				"plugins/immune-brain/.pi-extension/imm-canary-enroll.ts",
				"plugins/immune-brain/.pi-extension/imm-canary-work.ts",
				"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
				"plugins/immune-brain/skills/imm-loop/SKILL.md",
				"plugins/immune-brain/skills/imm-planner/SKILL.md",
				"plugins/immune-brain/skills/registry.yaml",
				"plugins/immune-brain/dist/imm-brainstorm.md",
				"plugins/immune-brain/dist/imm-loop.md",
				"plugins/immune-brain/dist/imm-planner.md",
				"plugins/immune-brain/runtime/kernel/canary_application.ts",
				"plugins/immune-brain/dist/role-prompts/code-review.md",
			]) {
				expect(existsSync(join(pkgDir, f))).toBe(true);
			}
			const shippedFiles = listFiles(pkgDir);
			const shippedText = shippedFiles
				.map((file) => readFileSync(file, "utf8"))
				.join("\n");
			for (const command of [
				"imm-canary-new",
				"imm-canary-enroll",
				"imm-canary-assure",
				"imm-canary-authorize",
				"imm-canary-succeed",
			]) {
				if (command !== "imm-canary-enroll")
					expect(shippedFiles.some((file) => file.endsWith(`${command}.ts`))).toBe(false);
				expect(shippedText).not.toMatch(
					new RegExp("(^|[\\s`])/(" + command + ")(?=[\\s<]|$)", "m"),
				);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("packed package excludes test fixtures and the test issuer", () => {
		const { dir } = extractTarball();
		try {
			const pkgDir = join(dir, "package");
			const files: string[] = [];
			const walk = (d: string) => {
				for (const entry of readdirSync(d, { withFileTypes: true })) {
					const p = join(d, entry.name);
					if (entry.isDirectory()) walk(p);
					else files.push(p);
				}
			};
			walk(pkgDir);
			const joined = files.join("\n");
			expect(joined).not.toContain("tests/fixtures/mutation-authority-test-seam.ts");
			expect(joined).not.toContain("tests/fixtures/pi-canary-child-session.ts");
			expect(joined).not.toContain("createMutationAuthorityCapabilityForTest");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("real Pi resource loader discovers extensions and all public Skills from shipped bytes", async () => {
		const { dir } = extractTarball();
		try {
			const pkgDir = join(dir, "package");
			const agentDir = mkdtempSync(join(tmpdir(), "p2b2-packed-agent-"));
			try {
				const { DefaultResourceLoader, SettingsManager } = await import(
					"@earendil-works/pi-coding-agent"
				);
				// The packed package is a configured Pi package source; the real
				// loader resolves its `pi.extensions` and `pi.skills` from bytes.
				const settingsManager = SettingsManager.inMemory(
					{ packages: [{ source: pkgDir }] },
					{ projectTrusted: false },
				);
				const loader = new DefaultResourceLoader({
					cwd: dir,
					agentDir,
					settingsManager,
				});
				await loader.reload();
				const extensions = loader.getExtensions().extensions;
				const paths = extensions.map(
					(e: { path?: string; resolvedPath?: string }) => e.path ?? e.resolvedPath ?? "",
				);
				const names = paths
					.map((p: string) => p.split("/").pop() ?? p)
					.sort();
				expect(names).toEqual([
					"imm-canary-enroll.ts",
					"imm-canary-work.ts",
				]);
				const skillsResult = loader.getSkills();
				const baselineDiagnostics = skillsResult.diagnostics.filter(
					(diagnostic: { path?: string }) =>
						diagnostic.path?.endsWith("plugins/immune-brain/skills/BASELINE.md"),
				);
				expect(baselineDiagnostics).toEqual([]);
				const skills = skillsResult.skills
					.filter((s: { filePath: string }) =>
						s.filePath.startsWith(join(pkgDir, "plugins/immune-brain/skills")),
					)
					.map((s: { name: string }) => s.name)
					.sort();
				expect(skills).toEqual(["imm-brainstorm", "imm-loop", "imm-planner"]);

				const work = extensions.find((extension: { path?: string }) =>
					extension.path?.endsWith("imm-canary-work.ts"),
				) as { handlers: Map<string, Array<(event: unknown, ctx: unknown) => Promise<unknown>>> };
				const routeInput = work.handlers.get("input")?.[0];
				expect(routeInput).toBeDefined();
				expect(await routeInput!(
					{ source: "interactive", text: "梳理目前进展和待办任务" },
					{ cwd: dir },
				)).toEqual({ action: "continue" });
			} finally {
				rmSync(agentDir, { recursive: true, force: true });
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("shipped extension bytes contain no test issuer or serialized authority carrier", () => {
		const { dir } = extractTarball();
		try {
			const pkgDir = join(dir, "package");
			const work = require("node:fs").readFileSync(
				join(pkgDir, "plugins/immune-brain/.pi-extension/imm-canary-work.ts"),
				"utf8",
			);
			expect(work).not.toContain("ForTest");
			expect(work).not.toContain("user_confirmed");
			expect(work).not.toContain("authorized: true");
			expect(work).not.toContain("raw_action");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
