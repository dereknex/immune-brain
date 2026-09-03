// The extension documents the internal record-user-approval wiring while the
// canonical Loop contract keeps the public authority surface at the native TUI
// gate. No new privileged CLI/RPC/JSON/print route exists.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

function read(p: string): string {
	return readFileSync(join(ROOT, p), "utf8");
}

describe("user approval package contract", () => {
	test("canonical Loop contract documents the native user authority gate", () => {
		const dist = read("plugins/immune-brain/dist/imm-loop.md");
		expect(dist).toContain("native TUI gate");
		expect(dist).toContain("request_authorization");
		expect(dist).not.toContain("record-user-approval");
	});

	test("public Loop shim loads the canonical contract", () => {
		const skill = read("plugins/immune-brain/skills/imm-loop/SKILL.md");
		expect(skill).toContain("dist/imm-loop.md");
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
			"./imm-canary-work.ts",
		]);
	});

	test("the ordinary tool schema remains closed to record_user_approval", () => {
		const source = read("plugins/immune-brain/.pi-extension/imm-canary-work.ts");
		// The tool action union is the closed ordinary set; record_user_approval
		// is only reachable through the TUI authorize path.
		const schemaStart = source.indexOf("parameters: Type.Object");
		const schemaEnd = source.indexOf("execute: async", schemaStart);
		const schemaSection = source.slice(schemaStart, schemaEnd);
		expect(schemaSection).not.toContain("record_user_approval");
		expect(source).toContain("record-user-approval");
		expect(source).toContain("requestAuthorityDialog");
		expect(source).not.toContain("ctx.ui.confirm");
		expect(source).not.toContain("ctx.ui.select");
	});
});
