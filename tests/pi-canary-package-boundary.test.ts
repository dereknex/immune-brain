// P2B1 U2: package boundary.
// Root package.json registers the Pi extension; the packed package includes
// the extension and EXCLUDES tests/fixtures; no production registry instance,
// test issuer, or callback bridge ships.

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

describe("pi canary package boundary", () => {
	test("package.json registers exactly the Pi extension path", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		expect(pkg.pi.extensions).toEqual(["./plugins/immune-brain/.pi-extension"]);
		expect(pkg.pi.skills).toContain("./plugins/immune-brain/skills");
	});

	test("extension file exists and registers no tool/shortcut surface", () => {
		const ext = readFileSync(join(ROOT, "plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"), "utf8");
		expect(ext).toContain("registerCommand");
		expect(ext).not.toContain("registerTool");
		expect(ext).not.toContain("registerFlag");
		expect(ext).not.toContain("registerShortcut");
	});

	test("extension is TUI-only and rejects non-TUI modes", () => {
		const ext = readFileSync(join(ROOT, "plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"), "utf8");
		expect(ext).toContain('ctx.mode !== "tui"');
	});

	test("test issuer seam is excluded from the shipped extension", () => {
		// The extension must never import the tests fixture.
		const ext = readFileSync(join(ROOT, "plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"), "utf8");
		expect(ext).not.toContain("tests/fixtures");
		expect(ext).not.toContain("enrollment-capability-test-seam");
		expect(ext).not.toContain("createEnrollmentCapabilityForTest");
	});

	test("kernel index still exposes no enrollment issuer or callback bridge", () => {
		const index = readFileSync(join(ROOT, "plugins/immune-brain/runtime/kernel/index.ts"), "utf8");
		expect(index).not.toContain("createEnrollmentAuthorityRegistry");
		expect(index).not.toContain("enrollCanaryTask");
		expect(index).not.toContain("pi_canary_prepare");
		expect(index).not.toContain("canary_eligibility");
		expect(index).not.toContain("pi_canary_prepare");
	});
});
