import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = resolve(REPO_ROOT, "plugins/immune-brain");
const TS_RUNTIME = resolve(PLUGIN_ROOT, "runtime/v4_runtime.ts");
const RETIREMENT_PLAN =
	"docs/plans/archive/2026-06-29-002-refactor-python-reference-retirement-plan.md";
const EXCEPTION_INVENTORY =
	"docs/solutions/python-reference-retirement-exception-inventory.md";

/** Production host runtime files that must not reference python3 startup. */
const HOST_RUNTIME_FILES = [
	"plugins/immune-brain/.mcp.json",
	"plugins/immune-brain/.opencode-plugin/index.ts",
	"plugins/immune-brain/.opencode-plugin/runtime.ts",
	"plugins/immune-brain/runtime/mcp-launcher.ts",
	"mise.toml",
];

describe("python reference boundary", () => {
	it("production host runtime files do not invoke python3 startup", () => {
		const violations: string[] = [];
		for (const rel of HOST_RUNTIME_FILES) {
			const path = resolve(REPO_ROOT, rel);
			if (!existsSync(path)) continue;
			const content = readFileSync(path, "utf-8");
			// python3 as a command to start the host runtime (not inside node_modules)
			if (
				/["']python3["']\s|python3\s+\S*immune_brain_runtime\.py|python3\s+\S*\.imm\//.test(
					content,
				)
			) {
				violations.push(rel);
			}
		}
		expect(violations).toEqual([]);
	});

	it("bin wrappers invoke bun and the TypeScript runtime", () => {
		const binDir = resolve(PLUGIN_ROOT, "bin");
		const wrappers = readdirSync(binDir).filter((f) => f.startsWith("imm-"));
		for (const w of wrappers) {
			const content = readFileSync(resolve(binDir, w), "utf-8");
			// imm-pr-diag is standalone (gh + jq), not a runtime bridge
			if (w === "imm-pr-diag") {
				expect(content).not.toContain("exec bun");
				expect(content).not.toMatch(/exec python3/);
				continue;
			}
			expect(content).toContain("exec bun");
			expect(content).toContain("runtime/v4_runtime.ts");
			expect(content).not.toMatch(/\bpython3\b/);
		}
	});

	it("the TypeScript runtime is the production source of truth", () => {
		expect(
			existsSync(resolve(PLUGIN_ROOT, "runtime/immune_brain_runtime.ts")),
		).toBe(false);
		expect(existsSync(resolve(PLUGIN_ROOT, "runtime/v4_runtime.ts"))).toBe(true);
	});

	it("docs declare Bun + TypeScript as the runtime requirement", () => {
		const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf-8");
		expect(readme).toContain("Bun + TypeScript");
		expect(readme).toContain("reference-only");
		// The old "no Bun required" claim must be gone
		expect(readme).not.toContain("不需要 Bun");
	});

	it("the superseded OpenCode spec is marked superseded", () => {
		const candidates = [
			resolve(REPO_ROOT, "docs/specs/opencode-native-plugin.spec.md"),
			resolve(REPO_ROOT, "docs/specs/archive/opencode-native-plugin.spec.md"),
		];
		const specPath = candidates.find((p) => existsSync(p));
		expect(specPath).toBeDefined();
		const spec = readFileSync(specPath!, "utf-8");
		expect(spec).toContain("SUPERSEDED");
		expect(spec).toContain("bun-typescript-runtime-migration");
	});

	it("python reference quarantine solution is recorded", () => {
		const solution = readFileSync(
			resolve(
				REPO_ROOT,
				"docs/solutions/python-reference-quarantine-boundary.md",
			),
			"utf-8",
		);
		expect(solution).toContain("Reference Retirement Criteria");
		expect(solution).toContain("python3");
	});

	it("the production runtime still validates plans end-to-end via bun", () => {
		const result = spawnSync(
			"bun",
			[TS_RUNTIME, "cli", "imm-plan", RETIREMENT_PLAN, "--json"],
			{ encoding: "utf-8", cwd: REPO_ROOT },
		);
		expect(result.status).toBe(0);
		const json = JSON.parse(result.stdout);
		expect(json.summary).toContain("Python reference runtime");
		expect(json.steps.map((s: any) => s.step_id)).toEqual([
			"U1",
			"U2",
			"U3",
			"U4",
		]);
	});

	it("canonical Bun checks cover retired v3 surfaces fail-closed", () => {
		// imm-work status is a retired v3 mutating command through the v4 router.
		const status = spawnSync(
			"bun",
			[TS_RUNTIME, "cli", "imm-work", "status", "--json"],
			{
				encoding: "utf-8",
				cwd: REPO_ROOT,
			},
		);
		expect(status.status).toBe(1);
		expect(status.stderr).toMatch(/v3_storage_retired|drain_required/);

		// imm-activation-plan is not a v4 command at all.
		const activation = spawnSync(
			"bun",
			[TS_RUNTIME, "cli", "imm-activation-plan", "--validate-refs"],
			{
				encoding: "utf-8",
				cwd: REPO_ROOT,
			},
		);
		expect(activation.status).toBe(2);
		expect(activation.stderr).toContain("Unknown Immune-Brain v4 command");

		// imm-heal is a retired v3 mutating command through the v4 router.
		const heal = spawnSync("bun", [TS_RUNTIME, "cli", "imm-heal"], {
			encoding: "utf-8",
			cwd: REPO_ROOT,
		});
		expect(heal.status).toBe(1);
		expect(heal.stderr).toMatch(/v3_storage_retired|drain_required/);
	});

	it("canonical command manifest covers the v4 router surface", () => {
		const result = spawnSync("bun", [TS_RUNTIME, "list-commands", "--json"], {
			encoding: "utf-8",
			cwd: REPO_ROOT,
		});
		expect(result.status).toBe(0);
		const manifest = JSON.parse(result.stdout);
		const commands = manifest.commands.map((command: any) => command.name).sort();
		expect(commands).toEqual(["imm-kernel", "imm-plan", "imm-route", "imm-tracker"]);
		for (const retired of [
			"imm-autowork",
			"imm-check-child-output",
			"imm-finish",
			"imm-heal",
			"imm-migrate",
			"imm-retire-stale-wrapper",
			"imm-review",
			"imm-work",
		]) {
			expect(manifest.retired).toContain(retired);
		}
	});

	it("python reference runtime files are retired with no repo-local Python exceptions", () => {
		expect(
			existsSync(
				resolve(REPO_ROOT, "plugins/immune-brain/dist/immune_brain_runtime.py"),
			),
		).toBe(false);
		expect(
			existsSync(resolve(REPO_ROOT, "plugins/immune-brain/dist/.imm")),
		).toBe(false);
		expect(existsSync(resolve(REPO_ROOT, ".imm/pyproject.toml"))).toBe(false);
		expect(existsSync(resolve(REPO_ROOT, ".imm/imm_core"))).toBe(false);

		const inventory = readFileSync(
			resolve(REPO_ROOT, EXCEPTION_INVENTORY),
			"utf-8",
		);
		expect(inventory).toContain("Temporary Retirement Targets");
		expect(inventory).toContain(
			"Current repo-local exceptions outside `upstreams/`: **none**",
		);
		expect(inventory).toContain(
			"scripts/plugin_versioning.py` → `scripts/plugin_versioning.ts",
		);
		expect(inventory).toContain(
			"tests/fixtures/immune-brain-benchmark-workspace/tests/test_fixture_contract.py` → `tests/fixtures/immune-brain-benchmark-workspace/tests/fixture-contract.test.ts",
		);
		expect(inventory).toContain("upstreams/");

		const remaining: string[] = [];
		const stack = [REPO_ROOT];
		while (stack.length) {
			const dir = stack.pop()!;
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (entry.name === ".git" || entry.name === "upstreams") continue;
				const path = resolve(dir, entry.name);
				if (entry.isDirectory()) stack.push(path);
				else if (
					entry.isFile() &&
					(entry.name.endsWith(".py") || entry.name === "pyproject.toml")
				) {
					remaining.push(path.replace(`${REPO_ROOT}/`, ""));
				}
			}
		}
		expect(remaining.sort()).toEqual([]);
	});
});
