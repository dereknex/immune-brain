import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ISLAND_MODULES = [
	"state_ledger",
	"project_migration",
	"advisory_dispatch",
	"work_probes",
	"environment",
	"handoff",
	"activation",
] as const;
const CHECKER = "tests/v3-island-deletion.test.ts";

function listTypeScriptFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map((entry) => resolve(dir, typeof entry === "string" ? entry : entry.toString()))
		.filter((path) => statSync(path).isFile() && path.endsWith(".ts"));
}

function sourceFiles(): string[] {
	return [
		...listTypeScriptFiles(resolve(ROOT, "plugins/immune-brain/runtime")),
		...listTypeScriptFiles(resolve(ROOT, "plugins/immune-brain/tests")),
		...listTypeScriptFiles(resolve(ROOT, "tests")),
	].filter((path) => {
		const rel = relative(ROOT, path).split(sep).join("/");
		return !ISLAND_MODULES.some((module) => rel === `plugins/immune-brain/runtime/${module}.ts`)
			&& rel !== CHECKER;
	});
}

function islandPath(module: string): string {
	return `runtime/${module}.ts`;
}

describe("v3 island deletion", () => {
	it("keeps all seven island modules absent with no external imports or path assertions", () => {
		for (const module of ISLAND_MODULES) {
			expect(
				existsSync(resolve(ROOT, "plugins/immune-brain/runtime", `${module}.ts`)),
			).toBe(false);
		}

		const offenders: string[] = [];
		for (const path of sourceFiles()) {
			const rel = relative(ROOT, path).split(sep).join("/");
			const source = readFileSync(path, "utf8");
			for (const module of ISLAND_MODULES) {
				if (
					source.includes(islandPath(module))
					|| source.includes(`/${module}.ts`)
					|| new RegExp(`from\\s+["'][^"']*/${module}(?:\\.ts)?["']`).test(source)
				) {
					offenders.push(`${rel}: ${module}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("retains coverage for the surviving runtime modules", () => {
		const coverage: Array<[string, string]> = [
			["tests/authority-commit-receipts.test.ts", "runtime/authority_commit_receipts"],
			["tests/state-ledger-migration.test.ts", "runtime/kernel/automatic_observations"],
			["tests/plan-validation.test.ts", "runtime/plan_core"],
			["tests/role-prompt-bridge.test.ts", "runtime/role_prompt_bridge"],
			["tests/loop-execution-routing.test.ts", "runtime/loop_contract"],
			["tests/role-prompt-bridge.test.ts", "scripts/dist-sync-manifest"],
		];

		for (const [path, modulePath] of coverage) {
			expect(readFileSync(resolve(ROOT, path), "utf8")).toContain(modulePath);
		}
	});
});
