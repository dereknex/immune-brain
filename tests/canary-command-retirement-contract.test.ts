import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ROOT = resolve(__dirname, "..");
const EXT = join(ROOT, "plugins/immune-brain/.pi-extension");

function loadFactory(file: string): { tools: string[]; commands: string[] } {
	const tools: string[] = [];
	const commands: string[] = [];
	const mod = require(join(EXT, file)) as { default: (pi: ExtensionAPI) => void };
	mod.default({
		registerTool: (tool: { name: string }) => tools.push(tool.name),
		registerCommand: (name: string) => commands.push(name),
		on: () => undefined,
	} as unknown as ExtensionAPI);
	return { tools, commands };
}

describe("Canary Slash Command retirement", () => {
	test("ships only the two foreground Tool factories", () => {
		const manifest = JSON.parse(readFileSync(join(EXT, "package.json"), "utf8")) as {
			pi: { extensions: string[] };
		};
		expect(manifest.pi.extensions).toEqual(["./imm-canary-enroll.ts", "./imm-canary-work.ts"]);
		expect(existsSync(join(EXT, "imm-canary-new.ts"))).toBe(false);
		expect(existsSync(join(EXT, "imm-canary-succeed.ts"))).toBe(false);
	});

	test("registers foreground Tools and the single read-only /imm-tasks overlay command", () => {
		expect(loadFactory("imm-canary-enroll.ts")).toEqual({ tools: ["imm_canary_enrollment"], commands: [] });
		expect(loadFactory("imm-canary-work.ts")).toEqual({
			tools: ["imm_kernel_canary", "imm_loop_action"],
			commands: ["imm-tasks"],
		});
	});

	test("production extension sources register only the read-only /imm-tasks command", () => {
		for (const file of ["imm-canary-enroll.ts", "imm-canary-work.ts"]) {
			const source = readFileSync(join(EXT, file), "utf8");
			expect(source).not.toMatch(/\/imm-canary-(new|enroll|assure|authorize|succeed)/);
			for (const match of source.matchAll(/registerCommand\(\"([^\"]+)\"/g))
				expect(["imm-tasks"]).toContain(match[1]);
		}
	});

	test("public docs route lifecycle actions through natural language and imm-loop", () => {
		for (const file of [
			"README.md",
			"plugins/immune-brain/README.md",
			"plugins/immune-brain/USER_GUIDE.md",
			"docs/user_manual.md",
			"plugins/immune-brain/skills/imm-loop/SKILL.md",
			"plugins/immune-brain/dist/imm-loop.md",
		]) {
			const source = readFileSync(join(ROOT, file), "utf8");
			expect(source, file).not.toMatch(/\/imm-canary-(new|enroll|assure|authorize|succeed)/);
		}
		const releaseNotes = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
		expect(releaseNotes).toContain("2.2.0");
		expect(releaseNotes).toMatch(/Slash Commands.*removed/i);
		expect(releaseNotes).toContain("imm-loop");
	});
});
