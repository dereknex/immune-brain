import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

const CTX_TOOLS = [
	"ctx_batch_execute",
	"ctx_execute",
	"ctx_execute_file",
	"ctx_search",
	"ctx_fetch_and_index",
	"ctx_index",
	"ctx_stats",
	"ctx_doctor",
	"ctx_upgrade",
	"ctx_purge",
] as const;

describe("host tool policy contract", () => {
	test("AGENTS.md does not mandate a context-mode hierarchy or ctx_* tools", () => {
		const agents = read("AGENTS.md");
		expect(agents).not.toContain("context-mode is active");
		expect(agents).not.toMatch(/tool usage hierarchy/i);
		for (const tool of CTX_TOOLS) {
			expect(agents).not.toContain(tool);
		}
	});

	test("package manifest and lockfile drop the unused context-mode dependency", () => {
		const pkg = JSON.parse(read("package.json")) as {
			description?: string;
			dependencies?: Record<string, string>;
		};
		expect(pkg.dependencies?.["context-mode"]).toBeUndefined();
		expect(pkg.description ?? "").not.toMatch(/context-mode/i);

		const lock = read("bun.lock");
		expect(lock).not.toMatch(/"context-mode":\s*"\*"/);
		expect(lock).not.toMatch(/"context-mode":\s*\["context-mode@/);
	});
});
