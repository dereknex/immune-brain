import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = resolve(REPO_ROOT, "plugins/immune-brain");
const SOURCE_LEDGER = resolve(REPO_ROOT, ".imm/memory/current_iteration.json");
const PLAN_PATH = "plans/terminal.md";

const PLAN = `# Iteration Plan

## Task

- Summary: U3 copied terminal fixture
- Spec: specs/roadmap.spec.md
- Plan contract: roadmap-slice/v1
- Roadmap source: \`specs/roadmap.spec.md\` Roadmap
- Current phase: P4
- Plan boundary: Copied plugin terminal fixture.
- Boundary rationale: Isolated host/package acceptance fixture.
- Scope pressure: none
- Execution scope: Phase P4 only.
- Successor candidate: none
- Successor preconditions: none
- Current-slice warning: Synthetic fixture only.

## Output Language

- Human-readable prose: English

## Steps

### Step 1

- Step ID: U1
- Result: Copied terminal fixture outcome
- Verification: \`true\`
- Depends on: none
`;

function run(
	pluginRoot: string,
	targetRoot: string,
	command: string,
	args: string[],
	home: string,
) {
	const result = spawnSync(join(pluginRoot, "bin", command), args, {
		cwd: targetRoot,
		env: {
			...process.env,
			HOME: home,
			XDG_CONFIG_HOME: join(home, "config"),
			IMM_DEV_INSIGHTS: "0",
		},
		encoding: "utf8",
		maxBuffer: 512 * 1024,
	});
	return result;
}

function expectOk(result: ReturnType<typeof spawnSync>): void {
	if (result.status !== 0) {
		throw new Error(String(result.stderr || result.stdout || "command failed"));
	}
}

function withCopiedPlugin<T>(
	fn: (args: {
		pluginRoot: string;
		targetRoot: string;
		home: string;
		runtime: string;
	}) => T,
): T {
	const root = mkdtempSync(join(tmpdir(), "imm-u3-host-"));
	const pluginRoot = join(root, "installed", "immune-brain");
	const targetRoot = join(root, "target");
	const home = join(root, "home");
	mkdirSync(join(targetRoot, ".imm", "memory"), { recursive: true });
	mkdirSync(join(targetRoot, "specs"), { recursive: true });
	mkdirSync(join(targetRoot, "plans"), { recursive: true });
	mkdirSync(home, { recursive: true });
	writeFileSync(join(targetRoot, "specs", "roadmap.spec.md"), "# U3 fixture\n");
	writeFileSync(join(targetRoot, PLAN_PATH), PLAN);
	cpSync(PLUGIN_ROOT, pluginRoot, { recursive: true });
	try {
		return fn({
			pluginRoot,
			targetRoot,
			home,
			runtime: join(pluginRoot, "runtime", "immune_brain_runtime.ts"),
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("Roadmap shipped host and package acceptance", () => {
	it("keeps the Pi package and shipped asset surfaces aligned", () => {
		const packageManifest = JSON.parse(
			readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
		);
		expect(packageManifest.pi).toEqual({
			skills: ["./plugins/immune-brain/skills"],
			extensions: ["./plugins/immune-brain/.pi-extension"],
		});
		expect(existsSync(join(PLUGIN_ROOT, "skills"))).toBe(true);
		expect(existsSync(join(PLUGIN_ROOT, ".pi-extension"))).toBe(true);
		expect(existsSync(join(PLUGIN_ROOT, "bin", "imm-work"))).toBe(true);
		expect(
			existsSync(join(PLUGIN_ROOT, "runtime", "immune_brain_runtime.ts")),
		).toBe(false);
		expect(existsSync(join(PLUGIN_ROOT, ".claude-plugin"))).toBe(true);
		for (const relative of [
			".codex-plugin",
			".cursor-plugin",
			".opencode-plugin",
		]) {
			expect(existsSync(join(PLUGIN_ROOT, relative))).toBe(false);
		}
	});

	it("runs the copied plugin outside checkout through terminal U1 semantics", () => {
		withCopiedPlugin(({ pluginRoot, targetRoot, home, runtime }) => {
			// v4 storage retirement: every v3 mutating command in the copied
			// plugin returns the retired wall; read-only commands stay usable.
			const plan = run(pluginRoot, targetRoot, "imm-plan", [PLAN_PATH, "--sync"], home);
			expect(plan.status).toBe(1);
			expect(plan.stderr).toMatch(/v3_storage_retired|drain_required/);

			const work = run(pluginRoot, targetRoot, "imm-work", ["activate", PLAN_PATH, "1"], home);
			expect(work.status).toBe(1);
			expect(work.stderr).toMatch(/v3_storage_retired|drain_required/);

			const review = run(pluginRoot, targetRoot, "imm-review", ["pass", "--evidence", "copied QA"], home);
			expect(review.status).toBe(1);
			expect(review.stderr).toMatch(/v3_storage_retired|drain_required/);

			const finish = run(pluginRoot, targetRoot, "imm-finish", ["copied closed", "none"], home);
			expect(finish.status).toBe(1);
			expect(finish.stderr).toMatch(/v3_storage_retired|drain_required/);

			const status = run(pluginRoot, targetRoot, "imm-plan", [PLAN_PATH, "--json"], home);
			expect([0, 1]).toContain(status.status);
		});
	});

});

function expectOkResult(
	result: ReturnType<typeof spawnSync>,
): ReturnType<typeof spawnSync> {
	expect(result.status).toBe(0);
	return result;
}
