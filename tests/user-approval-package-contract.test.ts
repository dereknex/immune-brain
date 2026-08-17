// 2026-08-13-018 acc-user-approval-package-contract.
// dist/skill/README document the record-user-approval wiring and its TUI-only
// exact-action confirmation semantics; package.json and the extension entry
// manifest stay unchanged; the ordinary tool schema stays closed to
// record_user_approval; no new privileged CLI/RPC/JSON/print route exists.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

function read(p: string): string {
	return readFileSync(join(ROOT, p), "utf8");
}

describe("user approval package contract", () => {
	test("dist imm-canary-work documents record-user-approval wiring", () => {
		const dist = read("plugins/immune-brain/dist/imm-canary-work.md");
		expect(dist).toContain("record-user-approval");
		expect(dist).toMatch(/user-kind approval|user approval/i);
		expect(dist).toContain("TUI");
	});

	test("skills shim documents the authorize surface", () => {
		const skill = read("plugins/immune-brain/skills/imm-canary-work/SKILL.md");
		expect(skill).toContain("imm-canary-authorize");
	});

	test("package.json surface is unchanged (no new privileged route)", () => {
		const pkg = JSON.parse(read("package.json")) as {
			imports?: Record<string, string>;
			exports?: Record<string, string>;
			pi?: { extensions?: string[] };
		};
		expect(pkg.pi?.extensions).toEqual(["./plugins/immune-brain/.pi-extension"]);
		// The wiring lives inside the extension; the public export map exposes
		// no Kernel internal (the imports map is extension-internal plumbing).
		expect(JSON.stringify(pkg.exports)).not.toContain("authority_port");
		expect(JSON.stringify(pkg.exports)).not.toContain("canary_application");
		expect(JSON.stringify(pkg.exports)).not.toContain("runtime/");
	});

	test("extension entry manifest is unchanged", () => {
		const ext = JSON.parse(read("plugins/immune-brain/.pi-extension/package.json")) as {
			pi?: { extensions?: string[] };
		};
		expect(ext.pi?.extensions).toEqual([
			"./imm-canary-enroll.ts",
			"./imm-canary-new.ts",
			"./imm-canary-work.ts",
		]);
	});

	test("the ordinary tool schema remains closed to record_user_approval", () => {
		const source = read("plugins/immune-brain/.pi-extension/imm-canary-work.ts");
		// The tool action union is the closed ordinary set; record_user_approval
		// is only reachable through the TUI authorize path.
		const schemaSection = source.slice(
			source.indexOf("registerTool"),
			source.indexOf("registerCommand"),
		);
		expect(schemaSection).not.toContain("record_user_approval");
		expect(source).toContain("record-user-approval");
		expect(source).toContain("ctx.ui.confirm");
	});
});
