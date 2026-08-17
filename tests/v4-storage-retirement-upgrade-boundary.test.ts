// v4 storage retirement — acc-v3-upgrade-boundary.
// A project containing a nonterminal v3 owner is rejected before any write
// with a stable drain_required diagnostic instructing the operator to drain
// or terminate it using the prior runtime. Terminal or owner-free legacy
// artifacts remain byte-identical.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const V4 = join(
	__dirname,
	"..",
	"plugins/immune-brain/runtime/v4_runtime.ts",
);

function root(): string {
	const r = mkdtempSync(join(tmpdir(), "v4-boundary-"));
	mkdirSync(join(r, ".imm", "memory"), { recursive: true });
	return r;
}

function cli(r: string, args: string[]) {
	return spawnSync("bun", [V4, "cli", ...args], {
		cwd: r,
		encoding: "utf8",
	});
}

describe("v4 upgrade boundary", () => {
	test("nonterminal v3 owner blocks any v3 mutation with drain_required", () => {
		const r = root();
		writeFileSync(
			join(r, ".imm/memory/current_iteration.json"),
			JSON.stringify({
				plan_path: "docs/plans/active.md",
				runtime_status: "probing",
				active_step: 1,
				steps: {},
				plan_terminal: null,
			}),
		);
		for (const cmd of ["imm-work", "imm-review", "imm-migrate", "imm-finish"]) {
			const res = cli(r, [cmd, "--json"]);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain("drain_required");
			expect(res.stderr).toContain("prior runtime");
		}
		// The ledger bytes are untouched.
		const content = readFileSyncSafe(r);
		expect(content).toContain("runtime_status");
		expect(content).toContain("probing");

		// imm-plan is not a v3 mutation: it must not be rejected as drain_required.
		const plan = cli(r, ["imm-plan", "docs/plans/active.md", "--json"]);
		expect(plan.status).toBe(1);
		expect(plan.stderr).toContain("plan_validation_rejected");
	});

	test("owner-free legacy artifacts are byte-identical and read-only", () => {
		const r = root();
		mkdirSync(join(r, "docs", "plans"), { recursive: true });
		const plan =
			"---\ntitle: \"v4 boundary fixture\"\ntype: feat\nstatus: proposed\ndate: 2026-08-15\n---\n\n# Iteration Plan\n\n## Task\n\n- Summary: v4 boundary fixture\n- Workflow profile: strict\n- Output Language: English\n\n## Steps\n\n### Step 1\n\n- Step ID: U1\n- Result: Fixture outcome\n- Verification: `true`\n- Depends on: none\n";
		writeFileSync(join(r, "docs/plans/done.md"), plan);
		const state = JSON.stringify({
			plan_path: "docs/plans/done.md",
			runtime_status: "idle",
			reset_reason: "intentional_reset",
			active_step: null,
			steps: {},
			plan_terminal: null,
		});
		writeFileSync(join(r, ".imm/memory/current_iteration.json"), state);
		const res = cli(r, ["imm-plan", "docs/plans/done.md", "--json"]);
		// Genuine read-only Plan validation succeeds and does not write.
		expect(res.status).toBe(0);
		expect(JSON.parse(res.stdout).summary).toBe("v4 boundary fixture");
		expect(readFileSyncSafe(r)).toBe(state);
	});
});

function readFileSyncSafe(r: string): string {
	const { readFileSync } = require("node:fs");
	return readFileSync(join(r, ".imm/memory/current_iteration.json"), "utf8");
}
