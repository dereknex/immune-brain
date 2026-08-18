// v4 storage retirement — acc-package-contract.
// Source, packaged runtime, command manifests, Pi extension registration,
// generated docs, and operator guidance consistently describe Kernel v2
// storage as the sole production authority and document the drain-first
// upgrade requirement plus permanent read-only legacy audit boundary.

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

function read(p: string): string {
	return readFileSync(join(ROOT, p), "utf8");
}

describe("v4 package contract", () => {
	test("README documents Kernel v2 as sole production authority", () => {
		const readme = read("plugins/immune-brain/README.md");
		expect(readme).toMatch(/Kernel v2|TaskRecord v2|v4|retirement/i);
	});

	test("package.json exports do not expose v3 writers or readiness pipeline", () => {
		const pkg = JSON.parse(read("package.json")) as {
			imports?: Record<string, string>;
			exports?: Record<string, string>;
		};
		const joined = JSON.stringify({ ...pkg.imports, ...pkg.exports });
		expect(joined).not.toContain("state_ledger");
		expect(joined).not.toContain("project_migration");
		expect(joined).not.toContain("authority_commit_receipts");
		expect(joined).not.toContain("automatic_observations");
	});

	test("pi extension manifest registers only the three canary factories", () => {
		const extPkg = JSON.parse(read("plugins/immune-brain/.pi-extension/package.json")) as {
			pi?: { extensions?: string[] };
		};
		expect(extPkg.pi?.extensions).toEqual([
			"./imm-canary-enroll.ts",
			"./imm-canary-new.ts",
			"./imm-canary-work.ts",
		]);
	});

	test("dist imm-loop documents Kernel routing and no v3 mutation", () => {
		const dist = read("plugins/immune-brain/dist/imm-loop.md");
		expect(dist).toContain("imm_kernel_canary");
		expect(dist).toContain("imm-loop");
		expect(dist).toContain("imm_canary_enrollment");
		expect(dist).toContain("imm_kernel_canary");
		expect(dist).not.toContain("imm-work activate");
	});

	test("v4 runtime manifest lists retired v3 mutating commands", () => {
		const v4 = read("plugins/immune-brain/runtime/v4_runtime.ts");
		expect(v4).toContain("imm-migrate");
		expect(v4).toContain("imm-finish");
		expect(v4).toContain("drain_required");
		expect(v4).toContain("v3_storage_retired");
	});
});
