// P2B2 U2: real packed-artifact loader evidence. Executes `npm pack` to a
// temporary directory, extracts the tarball, and loads the shipped extensions
// and Skills through the real Pi resource loader to prove discovery from
// shipped bytes (not source-tree membership).

import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const RETIRED_PROGRESS_FILES = [
	"plugins/immune-brain/.pi-extension/index.ts",
	"plugins/immune-brain/.pi-extension/progress_client.ts",
	"plugins/immune-brain/.pi-extension/progress_views.ts",
];

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
	test("npm pack produces a tarball that extracts both extensions and the Skill", () => {
		const { dir } = extractTarball();
		try {
			const pkgDir = join(dir, "package");
			for (const f of [
				"plugins/immune-brain/.pi-extension/imm-canary-enroll.ts",
				"plugins/immune-brain/.pi-extension/imm-canary-new.ts",
				"plugins/immune-brain/.pi-extension/imm-canary-work.ts",
				"plugins/immune-brain/skills/imm-canary-work/SKILL.md",
				"plugins/immune-brain/dist/imm-canary-work.md",
				"plugins/immune-brain/runtime/kernel/canary_application.ts",
			]) {
				expect(existsSync(join(pkgDir, f))).toBe(true);
			}
			for (const retired of RETIRED_PROGRESS_FILES) {
				expect(existsSync(join(pkgDir, retired))).toBe(false);
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

	test("real Pi resource loader discovers extensions and the Skill from shipped bytes", async () => {
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
					"imm-canary-new.ts",
					"imm-canary-work.ts",
				]);
				const skills = loader.getSkills().skills.map((s: { name: string }) => s.name);
				expect(skills).toContain("imm-canary-work");
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
