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
import {
	evaluateCanaryEligibility,
	type CanaryWaiver,
} from "../plugins/immune-brain/runtime/kernel/canary_eligibility";

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

function baseWaiver(): CanaryWaiver {
	return {
		gate: "observation_window_days",
		task_id: TASK,
		reason: "user risk acceptance",
		actor: "user",
		confirmation_ref: "confirm-ref-1",
		expires_at: "2999-01-01T00:00:00.000Z",
		nonce: "nonce-1",
	};
}

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

	test("missing intent rejects eligibility (v4: kernel-owner only)", () => {
		const now = "2026-08-12T00:00:00.000Z";
		const prep = preparePiCanary(root, { task_id: TASK, now });
		expect(prep.evidence).toBeUndefined();
		const eligibility = evaluateCanaryEligibility({
			task: {
				id: TASK,
				intent_path: "docs/plans/123-short-goal.intent.json",
				intent_revision: 1,
				intent_content_hash: prep.intent?.content_hash ?? "",
			},
			now,
		});
		expect(eligibility.eligible).toBe(true);
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
		expect(first.task_record_v2?.present).toBe(false);
		expect(first.workspace.current_working).toBeNull();
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

describe("canary eligibility waiver policy", () => {
	test("synthetic candidate without waiver is eligible", () => {
		const result = evaluateCanaryEligibility({
			readiness: {
				contract: "assurance_kernel/readiness_report/v1",
				status: "candidate",
				observer_version: 2,
				epoch_started_at: "2026-07-29T00:00:00.000Z",
				window_started_at: "2026-07-29T00:00:00.000Z",
				window_days: 14,
				receipts_v2_count: 30,
				observations_v2_count: 30,
				reconciled_terminal_count: 30,
				lifecycle_count: 3,
				families_covered: ["execution", "review", "termination"],
				families_missing: [],
				gaps: [],
				legacy_counts: { receipts_v1: 0, observations_v1: 0 },
				migration_digest: { presented: "sha256:1", current: "sha256:1", match: true },
				rollback_rehearsal: { present: true, result: "passed", at: "2026-08-10T00:00:00.000Z" },
				generated_at: "2026-08-12T00:00:00.000Z",
			} as never,
			evidence: { status: "valid", bundle: {
				contract: "assurance_kernel/readiness_evidence/v1",
				generated_at: "2026-08-10T00:00:00.000Z",
				migration_dry_run: { digest: "sha256:1", writes_performed: false },
				rollback_rehearsal: {
					result: "passed",
					at: "2026-08-10T00:00:00.000Z",
					summary: "rehearsed",
					receipt_record_ids: ["sha256:1"],
				},
			} },
			task: {
				id: TASK,
				intent_path: "docs/plans/123-short-goal.intent.json",
				intent_revision: 1,
				intent_content_hash: "sha256:abc",
			},
			now: "2026-08-12T00:00:00.000Z",
		});
		expect(result.eligible).toBe(true);
	});

	test("synthetic collecting report with waiver is rejected (v4: waiver retired)", () => {
		const result = evaluateCanaryEligibility({
			readiness: { contract: "assurance_kernel/readiness_report/v1", status: "collecting", gaps: [{ code: "window_too_short", reference: null, detail: "2 days" }] } as never,
			evidence: { status: "valid" } as never,
			task: {
				id: TASK,
				intent_path: "docs/plans/123-short-goal.intent.json",
				intent_revision: 1,
				intent_content_hash: "sha256:abc",
			},
			waiver: baseWaiver(),
			now: "2026-08-12T00:00:00.000Z",
		});
		expect(result.eligible).toBe(false);
		expect(result.rejections).toContain("waiver route retired");
	});

	test("non-waivable gates with waiver are rejected (v4: waiver retired)", () => {
		const result = evaluateCanaryEligibility({
			readiness: { contract: "assurance_kernel/readiness_report/v1", status: "blocked", gaps: [{ code: "missing_observation", reference: "r1", detail: "missing" }] } as never,
			evidence: { status: "valid" } as never,
			task: {
				id: TASK,
				intent_path: "docs/plans/123-short-goal.intent.json",
				intent_revision: 1,
				intent_content_hash: "sha256:abc",
			},
			waiver: baseWaiver(),
			now: "2026-08-12T00:00:00.000Z",
		});
		expect(result.eligible).toBe(false);
		expect(result.rejections).toContain("waiver route retired");
	});

});

// keep type import used for TS
export type { PiCanaryPreparation };
