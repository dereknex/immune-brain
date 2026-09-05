// Role prompts must resolve from the layout the Claude Code Host actually ships.
//
// Observed on 2026-09-05: Review preparation for a frozen Managed task failed
// with `internal role prompt is not packaged: code-review` even though
// `dist/role-prompts/code-review.md` was present in the installed plugin. The
// resolver walked `<module dir>/../dist/role-prompts`, which is right from
// source (`runtime/` is a sibling of `dist/`) and wrong from the shipped bundle
// at `dist/claude/mcp-server.mjs`, where it lands on a `dist/dist/` that never
// exists. Every test ran from source, so no internal role prompt could load on
// the Host and nothing caught it.

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	INTERNAL_ROLE_PROMPTS,
	loadRolePrompt,
	rolePromptSearchDirs,
} from "../plugins/immune-brain/runtime/role_prompt_bridge";

const PLUGIN_ROOT = resolve(import.meta.dir, "../plugins/immune-brain");
// The two module locations that exist in practice: the source tree, and the
// directory the built MCP server bundle is written to.
const SOURCE_DIR = join(PLUGIN_ROOT, "runtime");
const BUNDLE_DIR = join(PLUGIN_ROOT, "dist", "claude");

function resolvePrompt(moduleDir: string, file: string): string | null {
	for (const dir of rolePromptSearchDirs(moduleDir)) {
		const path = join(dir, file);
		if (existsSync(path)) return path;
	}
	return null;
}

describe("packaged role prompt resolution", () => {
	it("the bundle directory is the real one the build writes to", () => {
		// Guards the premise: if the bundle moves, this test must move with it.
		expect(existsSync(join(BUNDLE_DIR, "mcp-server.mjs"))).toBe(true);
	});

	it("resolves code-review from the shipped bundle layout", () => {
		expect(resolvePrompt(BUNDLE_DIR, "code-review.md")).toBe(
			join(PLUGIN_ROOT, "dist", "role-prompts", "code-review.md"),
		);
	});

	it("still resolves from the source layout", () => {
		expect(resolvePrompt(SOURCE_DIR, "code-review.md")).toBe(
			join(PLUGIN_ROOT, "dist", "role-prompts", "code-review.md"),
		);
	});

	it("every internal role resolves from both layouts", () => {
		// Review was merely the first role to be exercised; all nine were broken.
		const unresolved: string[] = [];
		for (const [role, spec] of Object.entries(INTERNAL_ROLE_PROMPTS))
			for (const [name, dir] of [["source", SOURCE_DIR], ["bundle", BUNDLE_DIR]] as const)
				if (!resolvePrompt(dir, spec.file)) unresolved.push(`${role} (${name})`);
		expect(unresolved).toEqual([]);
	});

	it("loadRolePrompt returns the packaged bytes", () => {
		expect(loadRolePrompt("code-review").length).toBeGreaterThan(0);
	});
});
