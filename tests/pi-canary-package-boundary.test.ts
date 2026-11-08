// P2B1 U2: package boundary.
// Root package.json registers the Pi extension; the packed package includes
// the extension and EXCLUDES tests/fixtures; no production registry instance,
// test issuer, or callback bridge ships.

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { collectImportSpecifiers } from "./helpers/import_specifiers";

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
	for (const entry of collectImportSpecifiers(source)) {
		if (entry.form !== "import-call") continue;
		if (entry.specifier === null) hits.push(entry.argument);
		else if (entry.specifier.includes("runtime/")) hits.push(entry.specifier);
	}
	return hits;
}

function staticRuntimeImports(source: string): string[] {
	return collectImportSpecifiers(source)
		.filter((entry) => ["import-from", "import-type", "export-from"].includes(entry.form))
		.map((entry) => entry.specifier as string)
		.filter((specifier) => specifier.startsWith("../runtime/"));
}

describe("pi canary package boundary", () => {
	test("package.json registers exactly the Pi extension path", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		expect(pkg.pi.extensions).toEqual(["./plugins/immune-brain/.pi-extension"]);
		expect(pkg.pi.skills).toContain("./plugins/immune-brain/skills");
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

	test("the production callers use the single Enrollment entry and none sequences rehearsal and commit", () => {
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
		// A caller is a module that imports the entry. Matching the import rather
		// than a literal `enrollTask(` call keeps the shared batch port counted:
		// it invokes the entry through an injectable alias.
		const importsEntry = (source: string): boolean =>
			/import\s*\{[^}]*\benrollTask\b[^}]*\}\s*from\s*"[^"]*kernel\/enrollment"/.test(source);
		const entryCalls = new Set<string>();
		const sequencers: string[] = [];
		for (const [name, source] of productionSources()) {
			// The entry module itself is the sequencer, not a caller; the batch
			// runner's `enrollTask` is a Kernel-port member, not this entry.
			const isSequencerOrPort = name === "runtime/kernel/enrollment.ts" || name === "runtime/unattended/batch_runner.ts";
			const callsEntry = importsEntry(source) && !isSequencerOrPort;
			const usesRehearsal = /\brunEnrollmentRehearsal\s*\(/.test(source);
			const usesCommit = /\benrollCanaryTask\s*\(/.test(source);
			if (callsEntry) entryCalls.add(name);
			// The entry module itself may reference both primitives; nothing else
			// may.
			if (!isSequencerOrPort && (usesRehearsal || usesCommit))
				sequencers.push(`${name}:${usesRehearsal ? "rehearsal" : ""}${usesCommit ? "commit" : ""}`);
		}
		// The Host in-place Enrollment tools are retired (drive-always-lanes D1,
		// D2): the shared Batch child Kernel port is the only production caller.
		expect([...entryCalls].sort()).toEqual(["runtime/unattended/batch_kernel_port.ts"]);
		// Both Hosts' batch children reach the entry only through that port.
		const sources = new Map(productionSources());
		for (const host of ["imm-unattended-batch.ts", "runtime/claude/kernel_ports.ts"])
			expect(sources.get(host)).toMatch(/\bcreateBatchKernelPort\s*\(/);
		expect(importsEntry(sources.get("imm-unattended-batch.ts") ?? "")).toBe(false);
		expect(sequencers).toEqual([]);
		// Negative controls: a source that calls both primitives outside the entry
		// is flagged, and a caller that calls the entry is counted.
		const positive = 'import { enrollTask, EnrollmentRehearsalError } from "../runtime/kernel/enrollment";';
		const negative = 'runEnrollmentRehearsal(root, input, cap, registry);\nenrollCanaryTask(root, input, registry);';
		expect(importsEntry(positive)).toBe(true);
		expect(/\brunEnrollmentRehearsal\s*\(/.test(negative)).toBe(true);
		expect(/\benrollCanaryTask\s*\(/.test(negative)).toBe(true);
		// A Kernel-port member call is not the entry and does not sequence.
		const portCall = 'await input.kernel.enrollTask({ root: input.root, task_id: child.task_id });';
		expect(importsEntry(portCall)).toBe(false);
		expect(/\brunEnrollmentRehearsal\s*\(/.test(portCall)).toBe(false);
	});
});
