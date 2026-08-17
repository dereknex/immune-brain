import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_RUNTIME = resolve(
	REPO_ROOT,
	"plugins/immune-brain/runtime/immune_brain_runtime.ts",
);
const PACKAGED_FALLBACK = resolve(
	REPO_ROOT,
	"plugins/immune-brain/dist/imm-planner.md",
);

function runMise(task: string): { stdout: string; stderr: string } {
	const result = Bun.spawnSync(["mise", "run", task], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	expect({ exitCode: result.exitCode, stderr }).toMatchObject({ exitCode: 0 });
	return { stdout, stderr };
}

function expectV4Manifest(output: string): void {
	const manifest = JSON.parse(output);
	expect(manifest.commands.map((command: { name: string }) => command.name)).toEqual([
		"imm-kernel",
		"imm-plan",
	]);
	expect(manifest.retired).toContain("imm-heal");
}

describe("repository v4 runtime launchers", () => {
	it("removes the legacy launcher and obsolete heal task from mise", () => {
		const mise = readFileSync(resolve(REPO_ROOT, "mise.toml"), "utf8");
		expect(mise).not.toContain("immune_brain_runtime.ts");
		expect(mise).not.toContain("[tasks.heal]");
		expect(mise.match(/runtime\/v4_runtime\.ts list-commands --json/g)).toHaveLength(2);
	});

	it("executes list-runtime-tools through v4", () => {
		expectV4Manifest(runMise("list-runtime-tools").stdout);
	});

	it("executes check-plugin through v4", () => {
		const { stdout } = runMise("check-plugin");
		const manifestStart = stdout.lastIndexOf('{\n  "commands"');
		expect(manifestStart).toBeGreaterThanOrEqual(0);
		expectV4Manifest(stdout.slice(manifestStart));
	});

	it("documents v4 as current while preserving the next deletion boundary", () => {
		for (const path of ["README.md", "CONTEXT.md"]) {
			const content = readFileSync(resolve(REPO_ROOT, path), "utf8");
			expect(content).toContain("runtime/v4_runtime.ts");
			expect(content).not.toContain("runtime/immune_brain_runtime.ts");
		}
		expect(existsSync(LEGACY_RUNTIME)).toBe(false);
		expect(readFileSync(PACKAGED_FALLBACK, "utf8")).not.toContain(
			"runtime/immune_brain_runtime.ts",
		);
	});
});
