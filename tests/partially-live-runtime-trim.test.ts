import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	buildLoopAction,
	resolveLoopRoute,
} from "../plugins/immune-brain/runtime/loop_contract";
import {
	buildPlanSignature,
	normalizePlan,
	parsePlan,
} from "../plugins/immune-brain/runtime/plan_core";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = resolve(REPO_ROOT, "plugins/immune-brain/bin");
const LOOPS = "plugins/immune-brain/runtime/loop_contract.ts";
const PLAN_CORE = "plugins/immune-brain/runtime/plan_core.ts";
const VALID_ARCHIVE_PLAN =
	"docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md";

const RETIRED_WRAPPERS = [
	"imm-autowork",
	"imm-check-child-output",
	"imm-finish",
	"imm-heal",
	"imm-migrate",
	"imm-review",
	"imm-work",
];

function read(rel: string): string {
	return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function spawnWrapper(name: string, args: string[]) {
	return spawnSync(resolve(BIN_DIR, name), args, {
		cwd: REPO_ROOT,
		encoding: "utf-8",
	});
}

describe("partially live runtime trim", () => {
	it("removes the dead halves: child-output validators, fast-track and migration-signature helpers, activation-plan wrapper", () => {
		const loop = read(LOOPS);
		expect(loop).not.toContain("validateQaChildOutput");
		expect(loop).not.toContain("validateReviewChildOutput");
		expect(loop).not.toContain("ChildOutputRejection");
		expect(loop).not.toContain("QaChildDecision");
		expect(loop).not.toContain("ReviewChildDecision");
		expect(loop).not.toContain("QA_FIELDS");
		expect(loop).not.toContain("REVIEW_FIELDS");

		const planCore = read(PLAN_CORE);
		expect(planCore).not.toContain("planSupportsFastTrack");
		expect(planCore).not.toContain("buildExecutionContractSignature");
		expect(planCore).not.toContain("buildLegacyPlanSignature");

		expect(existsSync(join(BIN_DIR, "imm-activation-plan"))).toBe(false);
		expect(existsSync(join(BIN_DIR, "imm-retired"))).toBe(true);
	});

	it("keeps the live halves intact: imm-plan projection and Loop action routing", () => {
		const plan = spawnWrapper("imm-plan", [VALID_ARCHIVE_PLAN, "--json"]);
		expect(plan.status).toBe(0);
		const payload = JSON.parse(plan.stdout);
		expect(typeof payload.summary).toBe("string");
		expect(Array.isArray(payload.steps)).toBe(true);
		expect(payload.steps.length).toBeGreaterThan(0);
		expect(payload.origin_coverage.complete).toBe(true);

		const parsed = parsePlan(resolve(REPO_ROOT, VALID_ARCHIVE_PLAN));
		const normalized = normalizePlan(parsed, REPO_ROOT);
		expect(buildPlanSignature(normalized)).toMatch(/^[0-9a-f]{64}$/);

		expect(
			resolveLoopRoute({ ownership: "plan", target: "step" }),
		).toEqual({ entry: "imm-loop", next: "executor" });
		expect(
			resolveLoopRoute({ ownership: "kernel", target: "step" }),
		).toEqual({ entry: "imm-loop", next: "imm_kernel_canary" });
		const action = buildLoopAction({
			ownership: "plan",
			target: "step",
			context: { task_id: "task-6", target_id: "step-1" },
		});
		expect(action.next).toBe("executor");
		if (action.next === "executor") {
			expect(action.context.authority).toBe("executor");
		}
	});

	it("keeps every retired command name printing retirement guidance, with retained commands unaffected", () => {
		for (const name of RETIRED_WRAPPERS) {
			const result = spawnWrapper(name, ["status", "--json"]);
			expect({ name, status: result.status }).toMatchObject({
				name,
				status: 1,
			});
			expect(result.stderr).toMatch(/v3_storage_retired|drain_required/);
		}

		const kernel = spawnWrapper(
			"imm-kernel",
			["status", "--json"],
		);
		expect(kernel.status).toBe(0);
		expect(JSON.parse(kernel.stdout).contract).toBe(
			"assurance_kernel/shadow_status/v1",
		);

		const retireStale = spawnWrapper("imm-retire-stale-wrapper", [
			"--path",
			"/tmp/imm-nonexistent-wrapper",
			"--json",
		]);
		expect(retireStale.status).toBe(1);
		expect(retireStale.stderr).toMatch(/v3_storage_retired|drain_required/);

		for (const name of ["imm-pr-diag", "imm-kernel", "imm-plan"]) {
			expect(existsSync(join(BIN_DIR, name))).toBe(true);
		}
	});
});