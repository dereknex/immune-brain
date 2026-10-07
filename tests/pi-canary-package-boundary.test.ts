// P2B1 U2: package boundary.
// Root package.json registers the Pi extension; the packed package includes
// the extension and EXCLUDES tests/fixtures; no production registry instance,
// test issuer, or callback bridge ships.

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const PI_EXTENSION_DIR = join(ROOT, "plugins/immune-brain/.pi-extension");

function extensionSourceFiles(): Array<[string, string]> {
	return readdirSync(PI_EXTENSION_DIR)
		.filter((name) => name.endsWith(".ts"))
		.map((name) => [name, readFileSync(join(PI_EXTENSION_DIR, name), "utf8")] as [string, string]);
}

/**
 * Dynamic import calls whose argument is a runtime-module specifier, or a
 * computed expression that cannot be proven non-runtime. Literal imports of
 * non-runtime modules (node builtins, extension-local siblings) pass.
 */
function dynamicRuntimeImports(source: string): string[] {
	const hits: string[] = [];
	for (const match of source.matchAll(/\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?([^)]*?)\s*\)/g)) {
		const arg = match[1].trim();
		const literal = /^["']([^"']+)["']$/.exec(arg)?.[1];
		if (literal) {
			if (literal.includes("runtime/")) hits.push(literal);
			continue;
		}
		hits.push(arg);
	}
	return hits;
}

function staticRuntimeImports(source: string): string[] {
	return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*["'](\.\.\/runtime\/[^"']+)["']/g)]
		.map((match) => match[1]);
}

describe("pi canary package boundary", () => {
	test("package.json registers exactly the Pi extension path", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		expect(pkg.pi.extensions).toEqual(["./plugins/immune-brain/.pi-extension"]);
		expect(pkg.pi.skills).toContain("./plugins/immune-brain/skills");
	});

	test("extension registers exactly one bounded enrollment Tool and no command", () => {
		const ext = readFileSync(join(ROOT, "plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"), "utf8");
		expect(ext.match(/registerTool\(/g)).toHaveLength(1);
		expect(ext).toContain('name: "imm_canary_enrollment"');
		expect(ext.match(/registerCommand\(/g) ?? []).toHaveLength(0);
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

	test("package ships the host-neutral Assurance modules", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		expect(pkg.files).toContain("plugins/immune-brain/runtime/assurance");
		expect(existsSync(join(ROOT, "docs/adr/0004-dual-host-assurance-adapters.md"))).toBe(true);
		const adr = readFileSync(join(ROOT, "docs/adr/0004-dual-host-assurance-adapters.md"), "utf8");
		expect(adr).toContain("host-neutral Assurance coordinator");
		expect(adr).toContain("Do not introduce a generic host registry");
		const enrollment = readFileSync(join(ROOT, "plugins/immune-brain/runtime/assurance/enrollment.ts"), "utf8");
		expect(enrollment).toContain("preparePiCanary");
		expect(enrollment).toContain("revalidatePiCanary");
	});

	test("Pi compatibility shims re-export the shared modules and do not keep a second implementation", () => {
		for (const [shim, marker] of [
			["plugins/immune-brain/.pi-extension/pi-canary-verification.ts", "runtime/assurance/verification"],
			["plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts", "runtime/assurance/review_evidence"],
			["plugins/immune-brain/.pi-extension/pi-canary-qa-findings.ts", "runtime/assurance/qa_findings"],
			["plugins/immune-brain/.pi-extension/pi-canary-invocations.ts", "runtime/assurance/invocations"],
		] as const) {
			const source = readFileSync(join(ROOT, shim), "utf8");
			expect(source).toContain(marker);
			expect(source).not.toContain("export function");
		}
	});

	test("the retired runtime-stub adapter is gone and nothing references it", () => {
		expect(existsSync(join(PI_EXTENSION_DIR, "runtime-stub.ts"))).toBe(false);
		for (const [file, source] of extensionSourceFiles()) {
			expect({ file, references: source.includes("runtime-stub") }).toEqual({ file, references: false });
		}
	});

	test("no Pi source loads a runtime module through a dynamic import", () => {
		for (const [file, source] of extensionSourceFiles()) {
			expect({ file, hits: dynamicRuntimeImports(source) }).toEqual({ file, hits: [] });
		}
		// Negative control: the retired adapter's literal and computed dynamic
		// runtime imports both fail this check; a non-runtime literal passes.
		expect(dynamicRuntimeImports('const mod = await import("../runtime/kernel/storage.ts");')).toHaveLength(1);
		expect(dynamicRuntimeImports('const mod = await import(runtimePath("storage"));')).toHaveLength(1);
		expect(dynamicRuntimeImports('const mod = await import("./pi-canary-interaction");')).toHaveLength(0);
	});

	test("every static runtime import from the Pi extension resolves to a shipped module", () => {
		for (const [file, source] of extensionSourceFiles()) {
			for (const specifier of staticRuntimeImports(source)) {
				const base = resolve(PI_EXTENSION_DIR, specifier);
				expect({ file, specifier, resolves: existsSync(`${base}.ts`) }).toEqual({ file, specifier, resolves: true });
			}
		}
	});

	test("Pi Enrollment adapter reaches Kernel prepare only through the shared Enrollment boundary", () => {
		const enroll = readFileSync(join(PI_EXTENSION_DIR, "imm-canary-enroll.ts"), "utf8");
		expect(enroll).toContain("preparePiCanary");
		expect(enroll).toContain("revalidatePiCanary");
		expect(enroll).toContain('from "../runtime/assurance/enrollment"');
		expect(enroll).not.toContain("pi_canary_prepare");
	});

	test("the four production callers use the single Enrollment entry and none sequences rehearsal and commit", () => {
		// D3: runtime/kernel/enrollment.ts's enrollTask is the only production
		// sequencer of capability issue -> zero-write rehearsal -> commit. No
		// caller outside it references the two primitives, so no host adapter,
		// CLI command, or batch port can reorder or skip a step.
		const productionSources = (): Array<[string, string]> => {
			const collected: Array<[string, string]> = [...extensionSourceFiles()];
			for (const dir of ["runtime"] as const) {
				for (const name of readdirSync(join(ROOT, "plugins/immune-brain", dir), { recursive: true })) {
					if (!String(name).endsWith(".ts")) continue;
					const rel = `${dir}/${name}`;
					if (collected.some(([known]) => known === rel)) continue;
					collected.push([rel, readFileSync(join(ROOT, "plugins/immune-brain", rel), "utf8")]);
				}
			}
			return collected;
		};
		const entryCalls = new Set<string>();
		const sequencers: string[] = [];
		for (const [name, source] of productionSources()) {
			// The entry module itself is the sequencer, not a caller; the batch
			// runner's `enrollTask` is a Kernel-port member, not this entry.
			const isSequencerOrPort = name === "runtime/kernel/enrollment.ts" || name === "runtime/unattended/batch_runner.ts";
			const callsEntry = source.includes("enrollTask(") && !isSequencerOrPort;
			const usesRehearsal = /\brunEnrollmentRehearsal\s*\(/.test(source);
			const usesCommit = /\benrollCanaryTask\s*\(/.test(source);
			if (callsEntry) entryCalls.add(name);
			// The entry module itself may reference both primitives; nothing else
			// may.
			if (!isSequencerOrPort && (usesRehearsal || usesCommit))
				sequencers.push(`${name}:${usesRehearsal ? "rehearsal" : ""}${usesCommit ? "commit" : ""}`);
		}
		// Claude enroll path, Claude batch child, Pi enroll Tool, Pi batch child.
		expect([...entryCalls].sort()).toEqual([
			"imm-canary-enroll.ts",
			"imm-unattended-batch.ts",
			"runtime/claude/kernel_ports.ts",
		]);
		expect(sequencers).toEqual([]);
		// Boundary: the Pi enroll Tool supplies its abort/begin-commit gate as
		// the entry's checkpoint and reports the rehearsing and committing stages
		// through the entry; no caller imports the primitives at all.
		const enroll = readFileSync(join(PI_EXTENSION_DIR, "imm-canary-enroll.ts"), "utf8");
		expect(enroll).not.toMatch(/\brunEnrollmentRehearsal\b/);
		expect(enroll).not.toMatch(/\benrollCanaryTask\b/);
		expect(enroll).toContain("checkpoint:");
		// Negative controls: a source that calls both primitives outside the entry
		// is flagged, and a caller that calls the entry is counted.
		const positive = 'enrollTask(root, registry, { binding, now });';
		const negative = 'runEnrollmentRehearsal(root, input, cap, registry);\nenrollCanaryTask(root, input, registry);';
		expect(positive.includes("enrollTask(")).toBe(true);
		expect(/\brunEnrollmentRehearsal\s*\(/.test(negative)).toBe(true);
		expect(/\benrollCanaryTask\s*\(/.test(negative)).toBe(true);
		// A Kernel-port member call is not the entry and does not sequence.
		const portCall = 'await input.kernel.enrollTask({ root: input.root, task_id: child.task_id });';
		expect(portCall.includes("enrollTask(")).toBe(true);
		expect(/\brunEnrollmentRehearsal\s*\(/.test(portCall)).toBe(false);
	});
});
