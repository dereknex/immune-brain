import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PROVISIONED_DIRS = new Set([".agents", "plugins"]);
const PACKAGED_RUNTIME = "plugins/immune-brain/runtime/v4_runtime.ts";
const BIN_DIR = join(ROOT, "plugins/immune-brain/bin");
const STANDALONE_SHIMS = new Set(["imm-pr-diag"]);

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) out.push(...walk(path));
		else if (stat.isFile()) out.push(path);
	}
	return out;
}
function fixtureFiles(): string[] {
	return walk(ROOT).filter((path) => {
		const parts = relative(ROOT, path).split(/[\\/]/);
		return !parts.some((part) => PROVISIONED_DIRS.has(part));
	});
}

describe("fixture contract", () => {
	it("is small and scoped", () => {
		const files = fixtureFiles();
		expect(files.length).toBeLessThan(80);
		expect(existsSync(join(ROOT, "upstreams"))).toBe(false);
	});

	it("runtime adapter contract is current", () => {
		const readme = readFileSync(join(ROOT, "README.md"), "utf8");
		expect(readme).toContain("## Runtime Adapter Contract");
		expect(readme).toContain(PACKAGED_RUNTIME);
		expect(readme).not.toContain("immune_brain_runtime.py");
	});

	it("runtime adapter shims use Bun TypeScript runtime when provisioned", () => {
		if (!existsSync(BIN_DIR)) return;
		for (const name of readdirSync(BIN_DIR).filter((n) =>
			n.startsWith("imm-"),
		)) {
			const contents = readFileSync(join(BIN_DIR, name), "utf8");
			if (STANDALONE_SHIMS.has(name)) {
				expect(contents).toContain("STANDALONE script");
				expect(contents).toContain("does NOT depend on Python");
				continue;
			}
			expect(contents).toContain("runtime/v4_runtime.ts");
			expect(contents).not.toContain("immune_brain_runtime.py");
		}
	});

	it("boundary language exists", () => {
		const readme = readFileSync(join(ROOT, "README.md"), "utf8");
		expect(readme).toContain("Workflow Boundary");
		expect(readme).toContain("Small one-off copy edits");
	});
});
