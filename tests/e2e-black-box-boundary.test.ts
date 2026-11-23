// The L1 Host journeys under tests/e2e are black box (Spec e2e-release-gate D2, D5): they
// reach the product only through process boundaries, never by importing plugin runtime
// code, and `bun test` never collects them.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const FORBIDDEN = ["plugins/immune-brain/runtime/", "plugins/immune-brain/.pi-extension/"];
const subpathImports: Record<string, string> = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).imports ?? {};

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|js|mjs|cts|mts)$/.test(entry.name) ? [path] : [];
	});

/** Where an import specifier points inside the repo, or undefined for a package or built-in. */
function resolveSpecifier(root: string, file: string, specifier: string): string | undefined {
	if (specifier.startsWith(".")) return relative(root, resolve(dirname(file), specifier));
	if (specifier.startsWith("/")) return relative(root, specifier);
	const mapped = subpathImports[specifier];
	return mapped?.replace(/^\.\//, "");
}

/** Every import under tests/e2e of `root` that resolves into plugin runtime code, as "file: imports <specifier>". */
function boundaryViolations(root: string): string[] {
	const e2eDir = join(root, "tests/e2e");
	const transpiler = new Bun.Transpiler({ loader: "ts", trimUnusedImports: false });
	const violations: string[] = [];
	for (const file of sourceFiles(e2eDir)) {
		for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
			const target = resolveSpecifier(root, file, path);
			if (target && FORBIDDEN.some((prefix) => `${target}/`.startsWith(prefix) || target.startsWith(prefix))) {
				violations.push(`${relative(root, file)}: imports "${path}" (${target})`);
			}
		}
	}
	return violations;
}

const scratch: string[] = [];
const fixtureRoot = (files: Record<string, string>): string => {
	const root = mkdtempSync(join(tmpdir(), "imm-e2e-boundary-"));
	scratch.push(root);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
};
afterAll(() => scratch.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("e2e black-box boundary", () => {
	test("the real tests/e2e tree imports no plugin runtime module", () => {
		expect(boundaryViolations(REPO)).toEqual([]);
	});

	test.each([
		["a relative static import", 'import { x } from "../../../plugins/immune-brain/runtime/v4_runtime";', "../../../plugins/immune-brain/runtime/v4_runtime"],
		["a dynamic import", 'export const load = () => import("../../../plugins/immune-brain/runtime/kernel/storage");', "../../../plugins/immune-brain/runtime/kernel/storage"],
		["a re-export", 'export * from "../../../plugins/immune-brain/.pi-extension/index";', "../../../plugins/immune-brain/.pi-extension/index"],
		["a package.json subpath import into the runtime", 'import { x } from "#kernel/storage";', "#kernel/storage"],
	])("fails naming the file and the specifier for %s", (_name, source, specifier) => {
		const root = fixtureRoot({ "tests/e2e/harness/offender.ts": source });
		const violations = boundaryViolations(root);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("tests/e2e/harness/offender.ts");
		expect(violations[0]).toContain(`"${specifier}"`);
	});

	test("allows process-boundary imports, sibling harness files and the bin directory path", () => {
		const root = fixtureRoot({
			"tests/e2e/ok.e2e.ts": 'import { spawn } from "node:child_process"; import { helper } from "./harness/helper"; import "bun:test";',
			"tests/e2e/harness/helper.ts": 'export const bin = "plugins/immune-brain/bin/imm-kernel"; export const helper = 1;',
		});
		expect(boundaryViolations(root)).toEqual([]);
	});
});

describe("bun test collection", () => {
	test("bunfig.toml excludes tests/e2e and a bun test run collects no file under it", async () => {
		const ignore = (Bun.TOML.parse(readFileSync(join(REPO, "bunfig.toml"), "utf8")) as { test?: { pathIgnorePatterns?: string[] } }).test?.pathIgnorePatterns;
		expect(ignore).toContain("tests/e2e/**");
		// Fixture projects: decoys named like tests sit under tests/e2e beside one real test.
		const files = {
			"tests/e2e/decoy.test.ts": 'import { test } from "bun:test"; test("decoy", () => {});',
			"tests/e2e/nested/decoy.spec.ts": 'import { test } from "bun:test"; test("nested decoy", () => {});',
			"tests/real.test.ts": 'import { test } from "bun:test"; test("real", () => {});',
		};
		const collected = async (root: string) => {
			const child = Bun.spawn(["bun", "test"], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "" } });
			const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
			return (stdout + stderr).match(/Ran (\d+) tests? across (\d+) files?/)?.slice(1).map(Number);
		};
		// Control: without an ignore the decoys are collected, so the next assertion can fail.
		expect(await collected(fixtureRoot(files))).toEqual([3, 3]);
		// With the repository's own ignore patterns only the real test runs.
		expect(await collected(fixtureRoot({ ...files, "bunfig.toml": `[test]\npathIgnorePatterns = ${JSON.stringify(ignore)}\n` }))).toEqual([1, 1]);
	}, 60_000);

	test("no file under tests/e2e carries a bun test file name", () => {
		const collected = sourceFiles(join(REPO, "tests/e2e")).filter((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$|_(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
		expect(collected.map((file) => relative(REPO, file))).toEqual([]);
	});
});
