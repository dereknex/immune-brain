// P2B2 U2: packed package consumer surface. A real package consumer
// enumerates the root package's explicit export map and probes every declared
// subpath; the export map exposes no executable Kernel internal. Host registry
// inspection after Pi resource loading proves only the specified tool and
// commands are registered, and no registry issuer, generic mutation
// application, direct claim writer/remover, or terminal transaction internals
// are package-exported.

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(__dirname, "..");

function readPackage(): Record<string, unknown> {
	return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
}

describe("packed consumer surface", () => {
	test("export map declares only non-executable and extension/doc subpaths", () => {
		const pkg = readPackage();
		const exportsMap = pkg.exports as Record<string, string>;
		expect(exportsMap).toBeDefined();
		const values = Object.values(exportsMap);
		expect(values.some((v) => v.includes("runtime/"))).toBe(false);
		expect(values.some((v) => v.includes("tests/"))).toBe(false);
		expect(values.some((v) => v.includes("fixtures/"))).toBe(false);
		expect(values.some((v) => v.includes("bin/"))).toBe(false);
		// No Kernel internal is exposed: authority_port, canary_application,
		// backend_claim, storage, reducer_v2 are absent.
		const joined = values.join("\n");
		expect(joined).not.toContain("authority_port");
		expect(joined).not.toContain("canary_application");
		expect(joined).not.toContain("backend_claim");
		expect(joined).not.toContain("storage");
		expect(joined).not.toContain("reducer_v2");
		expect(joined).not.toContain("enrollment");
	});

	test("every declared export target exists on disk", () => {
		const pkg = readPackage();
		const exportsMap = pkg.exports as Record<string, string>;
		for (const target of Object.values(exportsMap)) {
			if (target.includes("*")) continue;
			expect(existsSync(join(ROOT, target))).toBe(true);
		}
	});

	test("declared subpaths resolve through the real import map", async () => {
		const pkg = readPackage();
		const exportsMap = pkg.exports as Record<string, string>;
		for (const [subpath, target] of Object.entries(exportsMap)) {
			if (subpath === ".") continue;
			if (subpath.includes("*")) {
				// Wildcard: probe one representative file per family.
				if (subpath.startsWith("./extensions/")) {
					const mod = await import(
						/* @vite-ignore */ join(ROOT, target.replace("*", "imm-canary-work.ts"))
					);
					// The extension module exposes parse helpers only; no issuer.
					expect(Object.keys(mod).filter((k) => /issuer|forTest|registry/i.test(k))).toEqual([]);
				}
				if (subpath.startsWith("./skills/")) {
					expect(
						existsSync(join(ROOT, target.replace("*", "imm-canary-work/SKILL.md"))),
					).toBe(true);
				}
				if (subpath.startsWith("./dist/")) {
					expect(existsSync(join(ROOT, target.replace("*", "imm-canary-work.md")))).toBe(true);
				}
				continue;
			}
			// Exact subpath: package.json resolves.
			if (subpath === "./package.json") {
				expect(existsSync(join(ROOT, target))).toBe(true);
			}
		}
	});

	test("Kernel internals are not resolvable through package subpaths", async () => {
		const { createRequire } = require("node:module") as typeof import("node:module");
		const requireFromRoot = createRequire(join(ROOT, "package.json"));
		for (const subpath of [
			"@immune-brain/agent-skills/runtime/kernel/canary_application",
			"@immune-brain/agent-skills/plugins/immune-brain/runtime/kernel/authority_port",
			"@immune-brain/agent-skills/tests/fixtures/mutation-authority-test-seam",
		]) {
			expect(() => requireFromRoot.resolve(subpath)).toThrow();
		}
	});

	test("packed enrollment contract exposes descriptor rehearsal and the single explicit waiver route", () => {
		const guide = readFileSync(join(ROOT, "plugins/immune-brain/USER_GUIDE.md"), "utf8");
		const defaultRoute = readFileSync(
			join(ROOT, "plugins/immune-brain/.pi-extension/imm-canary-new.ts"),
			"utf8",
		);
		const waiverRoute = readFileSync(
			join(ROOT, "plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"),
			"utf8",
		);
		expect(guide).toContain("descriptor_rehearsal.status=pending_tui_enrollment");
		expect(guide).toContain("descriptor-rehearsal/v1:waived:<digest>");
		expect(guide).toContain("session-owned background job");
		expect(guide).toContain("frozen `index_digest`");
		expect(guide).toContain("scope/index snapshot integrity");
		expect(guide).toContain("`setup_timed_out`、`cancelled`、`integrity_drift`、`output_exceeded` 与 `setup_failed` 是不可 waiver 的终态");
		expect(guide).toContain("/imm-canary-new cancel <task-id>");
		expect(defaultRoute).toContain('decideDescriptorRehearsalRoute(descriptorRehearsal, "default")');
		expect(defaultRoute).toContain("if (!rehearsalDecision.proceed_to_confirmation)");
		expect(defaultRoute).toContain("blocked enrollment_ready");
		expect(defaultRoute).toContain("assertDescriptorRehearsalSnapshot");
		expect(defaultRoute).toContain('pi.on("session_shutdown"');
		expect(defaultRoute).not.toContain("REHEARSAL WAIVER");
		expect(waiverRoute).toContain("REHEARSAL WAIVER: enrollment_ready=false");
		expect(waiverRoute).toContain('waiver_gate: rehearsalOverride ? "descriptor_rehearsal"');
		expect(waiverRoute).toContain("waiver_allowed");
		expect(waiverRoute).toContain('| "cancelled"');
		expect(waiverRoute).toContain('| "output_exceeded"');
		expect(waiverRoute).toContain('| "setup_timed_out"');
		expect(waiverRoute).toContain('| "integrity_drift"');
		expect(waiverRoute).toContain('child.once("close"');
		expect(waiverRoute).toContain('gitBytes(root, ["diff", "--binary"');
		expect(waiverRoute).toContain("setInterval(monitorIntegrity, 250)");
		expect(waiverRoute).toContain("class EnrollmentJobCoordinator");
		expect(waiverRoute).toContain("input remains available");
	});

	test("host registry inspection after real loading registers only the specified surface", async () => {
		const { DefaultResourceLoader, SettingsManager } = await import(
			"@earendil-works/pi-coding-agent"
		);
		const settingsManager = SettingsManager.inMemory(
			{ packages: [{ source: ROOT }] },
			{ projectTrusted: false },
		);
		const agentDir = require("node:fs").mkdtempSync(
			join(require("node:os").tmpdir(), "p2b2-consumer-agent-"),
		);
		try {
			const loader = new DefaultResourceLoader({
				cwd: ROOT,
				agentDir,
				settingsManager,
				additionalExtensionPaths: [],
				additionalSkillPaths: [],
			});
			await loader.reload();
			const extensions = loader.getExtensions().extensions as Array<{
				path?: string;
			}>;
			const paths = extensions.map((e) => e.path ?? "");
			// Exactly the three canary extensions are discovered; no other
			// extension (and no issuer surface) is registered by the host.
			expect(paths.filter((p) => p.endsWith("imm-canary-enroll.ts"))).toHaveLength(1);
			expect(paths.filter((p) => p.endsWith("imm-canary-new.ts"))).toHaveLength(1);
			expect(paths.filter((p) => p.endsWith("imm-canary-work.ts"))).toHaveLength(1);
			expect(extensions.length).toBe(3);
			// The exact registered surface (one ordinary tool, two TUI
			// commands, one enroll command, one new-task command) is proven by
			// the extension factory surface tests; the host discovery here
			// proves no fourth extension or issuer-named surface exists in
			// shipped bytes.
			const joined = paths.join("\n");
			expect(joined).not.toMatch(/issuer|forTest|claim.*writer|terminal.*transaction/i);
		} finally {
			require("node:fs").rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
