// P2B1 U1: read-only canary preparation identity.
// No confirm, issuer, capability, rehearsal, enrollment, or writer is reachable
// from this module or its import surface.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	preparePiCanary,
	revalidatePiCanary,
	type PiCanaryPreparation,
} from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { reconcileKernelAuthority } from "../plugins/immune-brain/runtime/kernel/storage";

function git(root: string, args: string[]): void {
	execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

const realTmp = realpathSync(tmpdir());
function makeRepo(): string {
	const root = join(realTmp, `pi-canary-prepare-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(root, { recursive: true });
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "t@t"]);
	git(root, ["config", "user.name", "t"]);
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(
		join(root, "docs/plans/123-short-goal.intent.json"),
		JSON.stringify(
			{
				contract: "assurance_kernel/task_intent/v1",
				task_id: "123-short-goal",
				goal: "publish the canary",
				owner: "user",
				risk: "routine",
				revision: 1,
				scope_hint: ["publish"],
				acceptance: [
					{
						id: "A1",
						assertion: "artifact exists",
						verification: "test -f artifact",
					},
				],
			},
			null,
			2,
		),
	);
	git(root, ["add", "-A"]);
	git(root, ["commit", "-qm", "intent"]);
	// minimal v3 Ledger so shadow migration/readiness reads succeed
	mkdirSync(join(root, ".imm/memory"), { recursive: true });
	writeFileSync(
		join(root, ".imm/memory/current_iteration.json"),
		JSON.stringify(
			{
				plan_path: "docs/plans/example-plan.md",
				plan_signature: "sig",
				steps: {},
				runtime_status: "idle",
				requires_replan: false,
				active_step: null,
				plan_terminal: null,
			},
			null,
			2,
		),
	);
	return root;
}

const TASK = "123-short-goal";
let root: string;

beforeEach(() => {
	root = makeRepo();
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("pi canary prepare read-only identity", () => {
	test("shared authority projection reports the empty workspace as unowned", () => {
		expect(reconcileKernelAuthority(root, TASK)).toMatchObject({
			state: "unowned",
			owner_task_id: null,
		});
	});

	test("malformed task id rejects", () => {
		expect(() => preparePiCanary(root, { task_id: "../evil", now: "2026-08-12T00:00:00.000Z" })).toThrow(/task id/);
		expect(() => preparePiCanary(root, { task_id: "a/b", now: "2026-08-12T00:00:00.000Z" })).toThrow(/task id/);
	});

	test("preparation aggregates canonical owners and is deterministic", () => {
		const now = "2026-08-12T00:00:00.000Z";
		const first = preparePiCanary(root, { task_id: TASK, now });
		const second = preparePiCanary(root, { task_id: TASK, now });
		expect(first.contract).toBe("assurance_kernel/pi_canary_preparation/v1");
		expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(first.digest).toBe(second.digest);
		expect(first.intent?.path).toBe("docs/plans/123-short-goal.intent.json");
		expect(first.intent?.revision).toBe(1);
		expect(first.backend_claim.present).toBe(false);
		expect(first.task_record_v3?.present).toBe(false);
		expect(first.workspace.current_working).toBeNull();
		// A recompute at another instant (another process) binds the same owners.
		const later = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T00:05:00.000Z" });
		expect(later.generated_at).not.toBe(first.generated_at);
		expect(later.digest).toBe(first.digest);
	});

	test("revalidation detects owner drift", () => {
		const now = "2026-08-12T00:00:00.000Z";
		const prep = preparePiCanary(root, { task_id: TASK, now });
		// intent content change (still valid task intent, new revision)
		writeFileSync(
			join(root, "docs/plans/123-short-goal.intent.json"),
			JSON.stringify(
				{
					contract: "assurance_kernel/task_intent/v1",
					task_id: TASK,
					goal: "publish the canary v2",
					owner: "user",
					risk: "routine",
					revision: 2,
					scope_hint: ["publish"],
					acceptance: [
						{
							id: "A1",
							assertion: "artifact exists",
							verification: "test -f artifact",
						},
					],
				},
				null,
				2,
			),
		);
		git(root, ["add", "-A"]);
		git(root, ["commit", "-qm", "intent v2"]);
		const { unchanged, current } = revalidatePiCanary(root, { task_id: TASK, now }, prep);
		expect(unchanged).toBe(false);
		expect(current.intent?.revision).toBe(2);
	});

	test("direct import exposes no confirm/mint/rehearse/enroll function", () => {
		const module = Object.keys(require("../plugins/immune-brain/runtime/kernel/pi_canary_prepare"));
		expect(module).not.toContain("confirmPiCanary");
		expect(module).not.toContain("mintEnrollmentCapability");
		expect(module).not.toContain("runEnrollmentRehearsal");
		expect(module).not.toContain("enrollCanaryTask");
	});
});

// keep type import used for TS
export type { PiCanaryPreparation };
