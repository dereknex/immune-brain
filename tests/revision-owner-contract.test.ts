// Revision ownership contract text (Spec ceremony-trim-r647 D9, CT-S3-A3): the
// Planner and Loop contracts say who prepares which revision and that the guard
// covers file-edit tools only, and the packaged Claude bundle carries the guard.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "..", "plugins", "immune-brain");
const read = (path: string) => readFileSync(join(PLUGIN, path), "utf8").replace(/\s+/g, " ");

describe("revision ownership contract", () => {
	test.each(["dist/imm-planner.md", "dist/imm-run.md"])("%s names the owner, the reason code and the guard's limit", (path) => {
		const text = read(path);
		expect(text).toContain("Loop owner prepares a scope or acceptance revision in the executing session");
		expect(text).toContain("bound Spec design, or decomposition");
		expect(text).toContain("`revision_owner_required`");
		expect(text).toContain("file-edit tools only");
		expect(text).toContain("not shell commands");
		expect(text).toContain("`docs/plans` and `docs/specs`");
	});

	test("the Loop contract still routes a non-compatible scope expansion to the Planner route", () => {
		expect(read("dist/imm-run.md")).toContain("Scope expansion returns to Planner's Enrolled Intent Revision route");
	});

	test("the packaged Claude bundle carries the guard from source", () => {
		const bundle = readFileSync(join(PLUGIN, "dist", "claude", "mcp-server.mjs"), "utf8");
		expect(bundle).toContain("revision_owner_required");
		expect(bundle).toContain("plan_latest");
	});
});
