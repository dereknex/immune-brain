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

/**
 * Every TypeScript file the retirement scans: both Host adapters, the runtime,
 * the package's own tests, and this repository's suites.
 */
function sourceFiles(): string[] {
	return [
		...listTypeScriptFiles(resolve(ROOT, "plugins/immune-brain/runtime")),
		...listTypeScriptFiles(resolve(ROOT, "plugins/immune-brain/.pi-extension")),
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

/** Production TypeScript: the runtime, both Host adapters, and the CLI scripts. */
function productionSourceFiles(): string[] {
	return [
		...listTypeScriptFiles(resolve(ROOT, "plugins/immune-brain/runtime")),
		...listTypeScriptFiles(resolve(ROOT, "plugins/immune-brain/.pi-extension")),
		...listTypeScriptFiles(resolve(ROOT, "scripts")),
	];
}

/** The names an `import`/`export ... from` clause binds. */
function importedNames(clause: string): string[] {
	return clause
		.replace(/[{}]/g, " ")
		.replace(/^\s*type\s+/, "")
		.split(",")
		.map((entry) => entry.trim().split(/\s+as\s+/)[0]?.trim() ?? "")
		.filter((name) => name.length > 0);
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

	it("keeps the retired plan_core exports out of every production file", () => {
		// The protected property is the closure of what production reaches, not a
		// test file's spelling of a module path: no production file may import a
		// symbol retired with the island, whether the module is renamed, a dead
		// test is retired, or a path spelling moves. The two live names are the
		// symbols runtime/v4_runtime.ts imports.
		const liveSurface = new Set(["PlanValidationError", "projectPlanValidation"]);
		const offenders: string[] = [];
		for (const path of productionSourceFiles()) {
			const rel = relative(ROOT, path).split(sep).join("/");
			if (rel === "plugins/immune-brain/runtime/plan_core.ts") continue;
			const source = readFileSync(path, "utf8");
			for (const statement of source.matchAll(
				/(?:import|export)\s+([^;]*?)\s+from\s+["'][^"']*\/plan_core(?:\.ts)?["']/g,
			)) {
				for (const name of importedNames(statement[1] ?? "")) {
					if (!liveSurface.has(name)) offenders.push(`${rel}: ${name}`);
				}
			}
			// A dynamic import carries no name to check, so it fails closed.
			if (/import\(\s*["'][^"']*\/plan_core(?:\.ts)?["']\s*\)/.test(source)) {
				offenders.push(`${rel}: dynamic import`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("scans both Host adapters for every retired surface", () => {
		// Neither adapter may be exempt from a retirement just because it lives
		// outside the runtime directory: the scan's scope is asserted, not assumed.
		const scanned = new Set(sourceFiles().map((path) => relative(ROOT, path).split(sep).join("/")));
		const production = new Set(productionSourceFiles().map((path) => relative(ROOT, path).split(sep).join("/")));
		for (const [scope, dir, files] of [
			["retirement scan", "plugins/immune-brain/.pi-extension/", scanned],
			["retirement scan", "plugins/immune-brain/runtime/claude/", scanned],
			["production closure", "plugins/immune-brain/.pi-extension/", production],
			["production closure", "plugins/immune-brain/runtime/claude/", production],
		] as const) {
			expect({ scope, dir, covered: [...files].some((rel) => rel.startsWith(dir)) }).toEqual({
				scope,
				dir,
				covered: true,
			});
		}
	});
});
