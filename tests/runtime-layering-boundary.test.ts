// Runtime layering boundary (Issue #415, ADR 0004 Decisions 1 and 2).
// Spec: docs/specs/runtime-layering-boundary.spec.md.
//
// 1. Host-neutral runtime modules never import a host adapter.
// 2. Host adapters never import each other, except the exact-edge ratchet
//    baseline below, owned by #414. Deleting an edge there is forced when the
//    import is removed (stale entry), and adding one fails (unexpected).
// 3. The Kernel and the assurance layer never import the host-neutral core
//    (docs/adr/0038-host-neutral-adapter-core.md D1, D2), which the adapters may.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { collectImportSpecifiers } from "./helpers/import_specifiers";

const ROOT = resolve(__dirname, "..");
const RUNTIME_DIR = "plugins/immune-brain/runtime";

/** D5: host name -> repository-relative host directory. */
const HOSTS: Record<string, string> = {
	claude: "plugins/immune-brain/runtime/claude",
	antigravity: "plugins/immune-brain/runtime/antigravity",
	pi: "plugins/immune-brain/.pi-extension",
};

/** D1: the host-neutral core every adapter may depend on and no inner layer may. */
const HOST_CORE_DIR = "plugins/immune-brain/runtime/host-core";
const INNER_LAYERS = ["plugins/immune-brain/runtime/kernel", "plugins/immune-brain/runtime/assurance"];

/** D1: the host-to-host edges on main, each owned by #414; S3 retired the kernel_ports and interaction edges, and S4 retired the Pi -> claude/review_host edge. */
const BASELINE: Array<{ edge: string; owner: "#414" }> = [
	{ edge: "plugins/immune-brain/runtime/antigravity/mcp_server.ts -> plugins/immune-brain/runtime/claude/mcp_server", owner: "#414" },
];

interface SourceFile {
	path: string; // repository-relative, posix separators
	source: string;
}

/** D6: resolve a relative specifier to a repository-relative path without extension; bare specifiers are not modules we own. */
function resolveTarget(importer: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) return null;
	return posix.normalize(posix.join(posix.dirname(importer), specifier)).replace(/\.(?:ts|js|mjs)$/, "");
}

function hostOf(path: string, hostMap: Record<string, string>): string | null {
	for (const [host, dir] of Object.entries(hostMap)) if (path === dir || path.startsWith(`${dir}/`)) return host;
	return null;
}

function importedTargets(file: SourceFile): string[] {
	const targets: string[] = [];
	for (const { specifier } of collectImportSpecifiers(file.source)) {
		const target = specifier === null ? null : resolveTarget(file.path, specifier);
		if (target !== null) targets.push(target);
	}
	return targets;
}

/** D2: imports from files outside every host directory that land inside a host directory. */
function innerLayerViolations(files: SourceFile[], hostMap: Record<string, string>): string[] {
	const violations: string[] = [];
	for (const file of files) {
		if (hostOf(file.path, hostMap) !== null) continue;
		for (const target of importedTargets(file)) if (hostOf(target, hostMap) !== null) violations.push(`${file.path} -> ${target}`);
	}
	return violations;
}

/** D2: imports from the Kernel or the assurance layer that land inside host-core. */
function coreImporterViolations(files: SourceFile[]): string[] {
	const violations: string[] = [];
	for (const file of files) {
		if (!INNER_LAYERS.some((dir) => file.path.startsWith(`${dir}/`))) continue;
		for (const target of importedTargets(file)) {
			if (target === HOST_CORE_DIR || target.startsWith(`${HOST_CORE_DIR}/`)) violations.push(`${file.path} -> ${target}`);
		}
	}
	return violations;
}

/** D3: imports crossing from one host directory into a different one. */
function hostToHostEdges(files: SourceFile[], hostMap: Record<string, string>): string[] {
	const edges = new Set<string>();
	for (const file of files) {
		const from = hostOf(file.path, hostMap);
		if (from === null) continue;
		for (const target of importedTargets(file)) {
			const to = hostOf(target, hostMap);
			if (to !== null && to !== from) edges.add(`${file.path} -> ${target}`);
		}
	}
	return [...edges].sort();
}

/** D8: pure comparison; both lists render `<importing file> -> <target module>`. */
function compareEdges(observed: string[], baseline: string[]): { unexpected: string[]; stale: string[] } {
	const known = new Set(baseline);
	const seen = new Set(observed);
	return {
		unexpected: observed.filter((edge) => !known.has(edge)).sort(),
		stale: baseline.filter((edge) => !seen.has(edge)).sort(),
	};
}

/** BR-REQ-6: every host directory exists and yields at least one scanned file. */
function completenessProblems(hostMap: Record<string, string>, scanned: string[], dirExists: (dir: string) => boolean): string[] {
	const problems: string[] = [];
	for (const [host, dir] of Object.entries(hostMap)) {
		if (!dirExists(dir)) problems.push(`${host}: directory missing: ${dir}`);
		else if (!scanned.some((path) => path.startsWith(`${dir}/`) && path.endsWith(".ts"))) problems.push(`${host}: no .ts files under ${dir}`);
	}
	return problems;
}

/** D7: .ts sources under runtime/ and the Pi extension directory only. */
function scanRealSources(): SourceFile[] {
	const files: SourceFile[] = [];
	for (const base of [RUNTIME_DIR, HOSTS.pi]) {
		for (const entry of readdirSync(join(ROOT, base), { recursive: true })) {
			const rel = String(entry).split("\\").join("/");
			if (!rel.endsWith(".ts")) continue;
			const path = `${base}/${rel}`;
			files.push({ path, source: readFileSync(join(ROOT, path), "utf8") });
		}
	}
	return files;
}

describe("runtime layering boundary", () => {
	const real = scanRealSources();

	test("AC1: no host-neutral runtime module imports a host adapter", () => {
		const nonHost = real.filter((file) => file.path.startsWith(`${RUNTIME_DIR}/`));
		expect(nonHost.length).toBeGreaterThan(0);
		expect(innerLayerViolations(nonHost, HOSTS)).toEqual([]);
	});

	test("AC1: the inner-layer check reports a forbidden import and ignores allowed ones", () => {
		const fixture: SourceFile[] = [
			{ path: "plugins/immune-brain/runtime/assurance/x.ts", source: 'import { a } from "../claude/x";' },
			{ path: "plugins/immune-brain/runtime/kernel/y.ts", source: 'import { b } from "../unattended/x";\nimport { fs } from "node:fs";' },
			{ path: "plugins/immune-brain/runtime/config/z.ts", source: 'export * from "../../.pi-extension/imm-canary-work";' },
		];
		expect(innerLayerViolations(fixture, HOSTS)).toEqual([
			"plugins/immune-brain/runtime/assurance/x.ts -> plugins/immune-brain/runtime/claude/x",
			"plugins/immune-brain/runtime/config/z.ts -> plugins/immune-brain/.pi-extension/imm-canary-work",
		]);
		expect(innerLayerViolations(fixture.slice(1, 2), HOSTS)).toEqual([]);
	});

	test("AC2: observed host-to-host edges equal the baseline", () => {
		expect(BASELINE).toHaveLength(1);
		expect(BASELINE.every(({ owner }) => owner === "#414")).toBe(true);
		const { unexpected, stale } = compareEdges(
			hostToHostEdges(real, HOSTS),
			BASELINE.map(({ edge }) => edge),
		);
		expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
	});

	test("AC2: a fixture edge outside the baseline is unexpected; adapter imports of core modules and npm packages are not edges", () => {
		const fixture: SourceFile[] = [
			{ path: "plugins/immune-brain/runtime/antigravity/new_thing.ts", source: 'import { q } from "../claude/queue";' },
			{
				path: "plugins/immune-brain/.pi-extension/ok.ts",
				source: 'import { a } from "../../runtime/assurance/x";\nimport { b } from "typebox";\nimport { c } from "./sibling";',
			},
		];
		const edges = hostToHostEdges(fixture, HOSTS);
		expect(edges).toEqual(["plugins/immune-brain/runtime/antigravity/new_thing.ts -> plugins/immune-brain/runtime/claude/queue"]);
		expect(compareEdges(edges, BASELINE.map(({ edge }) => edge)).unexpected).toEqual([
			"plugins/immune-brain/runtime/antigravity/new_thing.ts -> plugins/immune-brain/runtime/claude/queue",
		]);
	});

	test("AC3: a baseline entry absent from the observed edges is stale; identical lists are clean", () => {
		const a = "plugins/immune-brain/runtime/claude/kernel_ports.ts -> plugins/immune-brain/runtime/antigravity/capability";
		const b = "plugins/immune-brain/runtime/antigravity/mcp_server.ts -> plugins/immune-brain/runtime/claude/mcp_server";
		expect(compareEdges([b], [a, b])).toEqual({ unexpected: [], stale: [a] });
		expect(compareEdges([a, b], [a, b])).toEqual({ unexpected: [], stale: [] });
	});

	test("AC4: the completeness guard accepts the real host map and reports missing or empty hosts", () => {
		const scanned = real.map((file) => file.path);
		expect(completenessProblems(HOSTS, scanned, (dir) => existsSync(join(ROOT, dir)))).toEqual([]);
		const fixtureMap = { ghost: "plugins/nowhere/ghost", hollow: "plugins/immune-brain/hollow", claude: HOSTS.claude };
		const exists = (dir: string): boolean => dir !== "plugins/nowhere/ghost";
		expect(completenessProblems(fixtureMap, scanned, exists)).toEqual([
			"ghost: directory missing: plugins/nowhere/ghost",
			"hollow: no .ts files under plugins/immune-brain/hollow",
		]);
	});

	test("AC5: the collector reports each import form and ignores non-import strings and comments", () => {
		const source = [
			'import { a } from "./a";',
			"import {",
			"\tb,",
			"\tc,",
			'} from "./multi";',
			'import type { T } from "./type-only";',
			'export * from "./star";',
			'export { d } from "../../runtime/claude/x";',
			'import "./side-effect";',
			'const m = await import("./dyn");',
			'type Z = import("./type-pos").T;',
			'const r = require("./req");',
			'const s = "../claude/x";',
			"// import { no } from './commented';",
			'const t = `import x from "./templated"`;',
		].join("\n");
		expect(collectImportSpecifiers(source).map(({ form, specifier }) => [form, specifier])).toEqual([
			["import-from", "./a"],
			["import-from", "./multi"],
			["import-type", "./type-only"],
			["export-from", "./star"],
			["export-from", "../../runtime/claude/x"],
			["side-effect", "./side-effect"],
			["import-call", "./dyn"],
			["import-call", "./type-pos"],
			["require", "./req"],
		]);
	});

	test("AC5: a computed import() argument is reported with a null specifier and its raw text", () => {
		expect(collectImportSpecifiers('await import(runtimePath("storage"));')).toEqual([
			{ form: "import-call", specifier: null, argument: 'runtimePath("storage")', line: 1 },
		]);
	});

	describe("host-core boundary", () => {
		test("AC2: the Kernel and the assurance layer import nothing from host-core", () => {
			expect(coreImporterViolations(real)).toEqual([]);
		});

		test("AC2: at least one file of each adapter imports host-core", () => {
			const importers = real
				.filter((file) => importedTargets(file).some((target) => target.startsWith(`${HOST_CORE_DIR}/`)))
				.map((file) => file.path);
			expect(importers.some((path) => path.startsWith(`${HOSTS.claude}/`))).toBe(true);
			expect(importers.some((path) => path.startsWith(`${HOSTS.antigravity}/`))).toBe(true);
		});

		test("AC2: a Kernel or assurance import of host-core is reported, and host-core may not import an adapter", () => {
			const fixture: SourceFile[] = [
				{ path: "plugins/immune-brain/runtime/assurance/x.ts", source: 'import { a } from "../host-core/y";' },
				{ path: "plugins/immune-brain/runtime/kernel/z.ts", source: 'import { b } from "../host-core/w";' },
				{ path: "plugins/immune-brain/runtime/host-core/a.ts", source: 'import { c } from "../claude/b";' },
			];
			expect(coreImporterViolations(fixture)).toEqual([
				"plugins/immune-brain/runtime/assurance/x.ts -> plugins/immune-brain/runtime/host-core/y",
				"plugins/immune-brain/runtime/kernel/z.ts -> plugins/immune-brain/runtime/host-core/w",
			]);
			expect(innerLayerViolations(fixture, HOSTS)).toEqual([
				"plugins/immune-brain/runtime/host-core/a.ts -> plugins/immune-brain/runtime/claude/b",
			]);
		});

		test("AC2: an adapter import of host-core is no violation and no host-to-host edge", () => {
			const fixture: SourceFile[] = [
				{ path: "plugins/immune-brain/runtime/claude/c.ts", source: 'import { e } from "../host-core/e";' },
				{ path: "plugins/immune-brain/runtime/antigravity/d.ts", source: 'import { e } from "../host-core/e";' },
			];
			expect(coreImporterViolations(fixture)).toEqual([]);
			expect(innerLayerViolations(fixture, HOSTS)).toEqual([]);
			expect(hostToHostEdges(fixture, HOSTS)).toEqual([]);
			expect(BASELINE).toHaveLength(1);
		});
	});

	test("AC1: no adapter runtime inherits another adapter's class", () => {
		const inheriting = real
			.filter((file) => file.path.startsWith(`${RUNTIME_DIR}/`) && file.source.includes("extends ClaudeRuntime"))
			.map((file) => file.path);
		expect(inheriting).toEqual([]);
	});

	test("the path resolver covers upward relative forms and leaves bare specifiers alone", () => {
		expect(resolveTarget("plugins/immune-brain/.pi-extension/a.ts", "../runtime/claude/review_host")).toBe("plugins/immune-brain/runtime/claude/review_host");
		expect(resolveTarget("plugins/immune-brain/runtime/x/a.ts", "../claude/y.ts")).toBe("plugins/immune-brain/runtime/claude/y");
		expect(resolveTarget("a/b.ts", "node:fs")).toBeNull();
	});
});
