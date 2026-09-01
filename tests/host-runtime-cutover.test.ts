import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = resolve(REPO_ROOT, "plugins/immune-brain");
const TS_RUNTIME = resolve(PLUGIN_ROOT, "runtime/v4_runtime.ts");
const PI_FACING_CONTRACTS = [
	"README.md",
	"docs/user_manual.md",
	"plugins/immune-brain/dist/imm-loop.md",
];

/** Production host runtime paths that must not contain python3 startup. */
const PRODUCTION_PATHS = [
	"plugins/immune-brain/runtime/v4_runtime.ts",
	"mise.toml",
];

const BIN_DIR = resolve(PLUGIN_ROOT, "bin");

describe("host runtime cutover", () => {
	it("production paths do not contain python3 runtime startup references", () => {
		const violations: string[] = [];
		for (const rel of PRODUCTION_PATHS) {
			const content = readFileSync(resolve(REPO_ROOT, rel), "utf-8");
			// Match python3 as a command invocation, not inside strings/comments about Python reference
			if (/["']python3["']|\bpython3\s+\S*immune_brain_runtime/.test(content)) {
				violations.push(rel);
			}
		}
		expect(violations).toEqual([]);
	});

	it("bin wrappers use bun and the TypeScript runtime, not python3", () => {
		const wrappers = readdirSync(BIN_DIR).filter(
			(f) => f.startsWith("imm-") && f !== "imm-pr-diag",
		);
		expect(wrappers.length).toBeGreaterThan(0);
		for (const w of wrappers) {
			const content = readFileSync(resolve(BIN_DIR, w), "utf-8");
			expect(content).toContain("exec bun");
			expect(content).toContain("runtime/v4_runtime.ts");
			expect(content).not.toMatch(/\bpython3\b/);
		}
	});

	it("MCP launcher files are absent from the CLI-only runtime surface", () => {
		expect(existsSync(resolve(PLUGIN_ROOT, ".mcp.json"))).toBe(false);
		expect(existsSync(resolve(PLUGIN_ROOT, "runtime/mcp-launcher.ts"))).toBe(
			false,
		);
	});

	it("list-commands returns the CLI command manifest", () => {
		const result = spawnSync("bun", [TS_RUNTIME, "list-commands", "--json"], {
			encoding: "utf-8",
			cwd: REPO_ROOT,
		});
		expect(result.status).toBe(0);
		const commands = JSON.parse(result.stdout).commands;
		expect(commands.map((command: any) => command.name)).toContain("imm-kernel");
		expect(commands.map((command: any) => command.name)).toContain("imm-plan");
		const kernel = commands.find(
			(command: any) => command.name === "imm-kernel",
		);
		expect(kernel).toMatchObject({ json_output: true });
		expect(kernel.description).toContain("Kernel");
		expect(JSON.stringify(commands)).not.toContain("tools/list");
		expect(JSON.stringify(commands)).not.toContain("mcpServers");
	});

	it("bin imm-plan validates a plan via the v4 runtime", () => {
		const wrapper = resolve(BIN_DIR, "imm-plan");
		const planPath =
			"docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md";
		const result = spawnSync(wrapper, [planPath, "--json"], {
			encoding: "utf-8",
			cwd: REPO_ROOT,
		});
		// v4 runtime: genuine read-only validation of the explicit Plan.
		expect(result.status).toBe(0);
		const json = JSON.parse(result.stdout);
		expect(json.summary).toContain("Bun");
		expect(json.steps.length).toBeGreaterThan(0);
		expect(json.origin_coverage).toBeDefined();
		expect(json.contract).toBeUndefined();
	});

	it("bin imm-work status is retired after v4 storage retirement", () => {
		const wrapper = resolve(BIN_DIR, "imm-work");
		const result = spawnSync(wrapper, ["status", "--json"], {
			encoding: "utf-8",
			cwd: REPO_ROOT,
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/v3_storage_retired|drain_required/);
	});

	it("documents Pi CLI-only runtime fallback without leaking unavailable task tools", () => {
		const offenders: string[] = [];
		for (const rel of PI_FACING_CONTRACTS) {
			const content = readFileSync(resolve(REPO_ROOT, rel), "utf-8");
			if (/TaskUpdate|TaskCreate/.test(content)) offenders.push(rel);
		}
		expect(offenders).toEqual([]);

		const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf-8");
		expect(readme).toContain(
			"Pi discovers Skills and extensions from `package.json`",
		);
		expect(readme).toContain("No extra server config is needed");
		expect(readme).toContain("plugins/immune-brain/bin/imm-kernel");
	});

	it("documents Pi advisory dispatch through foreground Agent calls", () => {
		const protocolPaths = [
			"docs/reference/subagent-dispatch-protocol.md",
			"plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md",
		];
		for (const rel of protocolPaths) {
			const content = readFileSync(resolve(REPO_ROOT, rel), "utf-8");
			expect(content).toContain("## Pi Agent Invocation");
			expect(content).toContain('subagent_type: "general-purpose"');
			expect(content).toContain("run_in_background: false");
			expect(content).toContain("direct terminal result");
			expect(content).toContain("one child at a time");
			expect(content).toContain("has no `readonly` parameter");
			expect(content).toContain("structured verdict");
		}

		const config = readFileSync(
			resolve(REPO_ROOT, "docs/reference/immune-brain-config.md"),
			"utf-8",
		);
		expect(config).toContain("Pi `Agent`");
	});
});
