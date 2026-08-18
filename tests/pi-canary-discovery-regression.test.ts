// canary-001 regression: Pi extension discovery must load exactly the two
// foreground Tool factories from .pi-extension/ and never auto-discover helper modules.
//
// acc-1: the real Pi resource loader discovers exactly imm-canary-enroll.ts
//        and imm-canary-work.ts from the repo package with zero load errors;
//        no discovered path contains a helper module name.
// acc-2: the explicit entry manifest (plugins/immune-brain/.pi-extension/
//        package.json) is load-bearing: a scratch copy WITHOUT it makes the
//        loader attempt every helper module as an extension and record a
//        "does not export a valid factory function" error for each.

import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

const FACTORY_FILES = [
	"plugins/immune-brain/.pi-extension/imm-canary-enroll.ts",
	"plugins/immune-brain/.pi-extension/imm-canary-work.ts",
];
const RETIRED_PROGRESS_FILES = [
	"plugins/immune-brain/.pi-extension/index.ts",
	"plugins/immune-brain/.pi-extension/progress_client.ts",
	"plugins/immune-brain/.pi-extension/progress_views.ts",
	"tests/pi-progress-extension.test.ts",
];

const HELPER_FILES = [
	"plugins/immune-brain/.pi-extension/pi-canary-invocations.ts",
	"plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts",
	"plugins/immune-brain/.pi-extension/pi-canary-native-review.ts",
	"plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts",
	"plugins/immune-brain/.pi-extension/pi-canary-verification.ts",
	"plugins/immune-brain/.pi-extension/runtime-stub.ts",
];

async function loadExtensions(source: string) {
	const { DefaultResourceLoader, SettingsManager } = await import(
		"@earendil-works/pi-coding-agent"
	);
	const agentDir = mkdtempSync(join(tmpdir(), "canary001-agent-"));
	try {
		const settings = SettingsManager.inMemory(
			{ packages: [{ source }] },
			{ projectTrusted: false },
		);
		const loader = new DefaultResourceLoader({
			cwd: source,
			agentDir,
			settingsManager: settings,
		});
		await loader.reload();
		const result = loader.getExtensions() as {
			extensions: Array<{ path?: string; resolvedPath?: string }>;
			errors: Array<{ path: string; error: unknown }>;
		};
		return {
			paths: result.extensions.map((e) =>
				(e.path ?? e.resolvedPath ?? "").replace(/\/+$/, ""),
			),
			errors: result.errors.map((e) => ({
				path: e.path,
				message: String(e.error),
			})),
		};
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
}

function basenameOf(p: string): string {
	return p.split("/").pop() ?? p;
}

describe("pi extension discovery regression (canary-001)", () => {
	test("acc-1: exactly the two foreground Tool factories are discovered from the repo package", async () => {
		const { paths, errors } = await loadExtensions(ROOT);
		expect(paths.length).toBe(2);
		const names = paths.map(basenameOf).sort();
		expect(names).toEqual([
			"imm-canary-enroll.ts",
			"imm-canary-work.ts",
		]);
		for (const helper of HELPER_FILES) {
			expect(paths.join("\n")).not.toContain(basenameOf(helper));
		}
		// With the entry manifest present there are no load errors at all.
		expect(errors).toEqual([]);
		// The discovered paths resolve to the real factory files.
		for (const factory of FACTORY_FILES) {
			expect(paths.some((p: string) => p.endsWith(factory))).toBe(true);
		}
		for (const retired of RETIRED_PROGRESS_FILES) {
			expect(existsSync(resolve(ROOT, retired))).toBe(false);
		}
	});

	test("acc-2: the explicit entry manifest is load-bearing; without it helpers fail to load", async () => {
		const scratch = mkdtempSync(join(tmpdir(), "canary001-scratch-"));
		try {
			// Copy the root package.json (pi.extensions points at the
			// .pi-extension directory) and the extension directory WITHOUT its
			// package.json entry manifest. The copied manifest gets a unique
			// name so the Pi loader does not coalesce it with the repo package.
			const { readFileSync, writeFileSync } = await import("node:fs");
			const rootPkg = JSON.parse(
				readFileSync(join(ROOT, "package.json"), "utf8"),
			);
			rootPkg.name = "canary001-scratch-package";
			writeFileSync(
				join(scratch, "package.json"),
				JSON.stringify(rootPkg, null, 2) + "\n",
			);
			const extDir = join(scratch, "plugins/immune-brain/.pi-extension");
			// Copy the whole plugin tree: the extension re-exports the shared
			// verification descriptor parser from the runtime graph, so the
			// scratch package must mirror the packaged plugin layout.
			cpSync(
				join(ROOT, "plugins/immune-brain"),
				join(scratch, "plugins/immune-brain"),
				{ recursive: true },
			);
			rmSync(join(extDir, "package.json"), { force: true });

			const { paths, errors } = await loadExtensions(scratch);
			const names = paths.map(basenameOf);
			// The two factory files still load (they export valid factories).
			expect(names).toContain("imm-canary-enroll.ts");
			expect(names).toContain("imm-canary-work.ts");
			// Without the manifest the loader tries to load every top-level
			// .ts file as an extension, so each helper module produces a
			// factory error — the exact failure the entry manifest prevents.
			const helperErrors = errors.filter((e) =>
				HELPER_FILES.some((h) => basenameOf(h) === basenameOf(e.path)),
			);
			expect(helperErrors.length).toBe(HELPER_FILES.length);
			for (const err of helperErrors) {
				expect(err.message).toMatch(/does not export a valid factory function/i);
			}
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});
});
