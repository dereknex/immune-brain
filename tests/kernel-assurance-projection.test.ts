// Assurance projection ownership: the internal Kernel module returns one
// host-neutral claim/Record/workspace correlation with fresh and stale
// evidence facts, fresh approval kinds, blockers, unresolved user decisions,
// and authorization readiness. Hosts never re-filter evidence or approvals.
//
// Covers the authorization-readiness truth table (moved from the Pi adapter's
// deriveAuthorizationOperation) and the public non-export boundary.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { revisionForContent } from "../plugins/immune-brain/runtime/kernel/storage";
import { projectAssurance, deriveAssuranceAuthorization } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { taskDiffHash } from "../plugins/immune-brain/runtime/workspace_scope";
import * as kernelIndex from "../plugins/immune-brain/runtime/kernel/index";

const TASK = "canary-projection-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "projection",
	acceptance: [
		{ id: "A1", assertion: "a1", verification: "true" },
		{ id: "A2", assertion: "a2", verification: "true" },
	],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "material",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);

function diffOf(root: string): string {
	return taskDiffHash(root, INTENT.scope_hint);
}

function makeEnrolledRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "p2b2-proj-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "owned.ts"), "baseline\n");
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(
		join(root, ".imm", "workspace.json"),
		JSON.stringify(
			{ contract: "assurance_kernel/workspace/v1", current_working: null },
			null,
			2,
		) + "\n",
	);
	const registry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: prep.digest,
		readiness_digest: "sha256:r",
		evidence_digest: "sha256:e",
		waiver_gate: "observation_window_days",
		actor_id: "user",
		confirmation_ref: "c",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "n",
	};
	enrollCanaryTask(
		root,
		{
			task_id: TASK,
			intent_path: `docs/plans/${TASK}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			readiness_digest: "sha256:r",
			evidence_digest: "sha256:e",
			capability: registry.issue(binding),
			capability_binding: binding,
			now: "2026-08-12T10:00:00.000Z",
		},
		registry,
	);
	return root;
}

function stageTaskSnapshot(root: string): void {
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "owned.ts"), "task snapshot\n");
	execFileSync("git", ["add", "--", "plugins/immune-brain/.pi-extension/owned.ts"], { cwd: root });
}

function seedRecord(root: string, mutate: (record: Record<string, unknown>) => void): void {
	const path = join(root, ".imm", "tasks", `${TASK}.json`);
	const record = JSON.parse(readFileSync(path, "utf8"));
	mutate(record);
	writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
}

function terminalizeFixture(root: string, phase: "done" | "stopped"): void {
	seedRecord(root, (record) => { record.phase = phase; });
	const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
	const recordBytes = readFileSync(recordPath, "utf8");
	writeFileSync(
		join(root, ".imm", "tasks", `${TASK}.backend-claim.json`),
		JSON.stringify({
			contract: "assurance_kernel/task_tombstone/v1",
			task_id: TASK,
			lifecycle_status: "terminal",
			terminal_phase: phase,
			terminal_event_id: `${phase}:${TASK}:fixture`,
			final_record_hash: revisionForContent(recordBytes),
			terminalized_at: "2026-08-12T10:00:01.000Z",
		}, null, 2) + "\n",
	);
	rmSync(join(root, ".imm", "tasks", ".backend-claim.json"));
	writeFileSync(
		join(root, ".imm", "workspace.json"),
		JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2) + "\n",
	);
}

function seedFreshEvidence(root: string, ...acceptanceIds: string[]): void {
	const diff = diffOf(root);
	seedRecord(root, (record) => {
		for (const acceptanceId of acceptanceIds) {
			record.evidence.push({
				id: `evidence-${acceptanceId}-fresh`,
				acceptance_id: acceptanceId,
				task_revision: 1,
				intent_content_hash: INTENT_HASH,
				diff_hash: diff,
				status: "passed",
				actor_id: "executor",
				summary: "fresh",
			});
		}
	});
}

function seedStaleEvidence(root: string): void {
	seedRecord(root, (record) => {
		record.evidence.push({
			id: "evidence-stale",
			acceptance_id: "A1",
			task_revision: 1,
			intent_content_hash: "sha256:" + "a".repeat(64),
			diff_hash: "sha256:" + "b".repeat(64),
			status: "passed",
			actor_id: "executor",
			summary: "stale",
		});
	});
}

function seedApproval(root: string, kind: "qa" | "review" | "user", actorId: string): void {
	const diff = diffOf(root);
	seedRecord(root, (record) => {
		record.approvals.push({
			id: `approval-${kind}-${actorId}`,
			kind,
			authority_role: kind === "qa" ? "qa" : kind === "review" ? "reviewer" : "user",
			task_revision: 1,
			intent_content_hash: INTENT_HASH,
			diff_hash: diff,
			actor_id: actorId,
			summary: kind,
		});
	});
}

function seedOpenFinding(root: string, kind: string, id: string): void {
	seedRecord(root, (record) => {
		record.findings.push({ id, kind, status: "open", acceptance_id: null, source: "kernel", review_round: 1, summary: kind });
	});
}

describe("kernel assurance projection", () => {
	test("no backend claim returns an empty correlated projection without error", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b2-proj-empty-"));
		try {
			mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
			execFileSync("git", ["init", "-q"], { cwd: root });
			const result = await projectAssurance(root, TASK, diffOf);
			expect(result.contract).toBe("assurance_kernel/assurance_projection/v1");
			expect(result.error).toBeNull();
			expect(result.claim).toBeNull();
			expect(result.projection.record_revision).toBe("");
			expect(result.projection.fresh_acceptance_ids).toEqual([]);
			expect(result.projection.missing_acceptance_ids).toEqual([]);
			expect(result.projection.fresh_approval_kinds).toEqual([]);
			expect(result.projection.open_user_decision_count).toBe(0);
			expect(result.projection.completion_ready).toBe(false);
			expect(result.projection.authorization).toEqual({ state: "none", blocked: null });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("missing records and mismatched claims fail closed", async () => {
		const root = makeEnrolledRoot();
		try {
			const missing = await projectAssurance(root, "no-such-task", diffOf);
			expect(missing.error).toBe(`backend claim belongs to ${TASK}, not no-such-task`);
			const claimPath = join(root, ".imm", "tasks", ".backend-claim.json");
			const claim = JSON.parse(readFileSync(claimPath, "utf8"));
			claim.task_id = "other-task";
			writeFileSync(claimPath, JSON.stringify(claim, null, 2) + "\n");
			const mismatch = await projectAssurance(root, TASK, diffOf);
			expect(mismatch.error).toMatch(/contradicts claim other-task|belongs to other-task/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("matching claimless done and stopped facts project as terminal Assurance", async () => {
		for (const phase of ["done", "stopped"] as const) {
			const root = makeEnrolledRoot();
			try {
				terminalizeFixture(root, phase);
				const terminal = await projectAssurance(root, TASK, diffOf);
				expect(terminal.error).toBeNull();
				expect(terminal.claim).toBeNull();
				expect(terminal.task_id).toBe(TASK);
				expect(terminal.projection.phase).toBe(phase);
				expect(terminal.projection.record_revision).toMatch(/^sha256:/);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	test("incomplete and contradictory terminal facts fail closed", async () => {
		const incomplete = makeEnrolledRoot();
		try {
			rmSync(join(incomplete, ".imm", "tasks", ".backend-claim.json"));
			writeFileSync(
				join(incomplete, ".imm", "workspace.json"),
				JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2) + "\n",
			);
			expect((await projectAssurance(incomplete, TASK, diffOf)).error).toMatch(/without a backend claim/);
		} finally {
			rmSync(incomplete, { recursive: true, force: true });
		}

		const contradictory = makeEnrolledRoot();
		try {
			terminalizeFixture(contradictory, "done");
			const tombstonePath = join(contradictory, ".imm", "tasks", `${TASK}.backend-claim.json`);
			const tombstone = JSON.parse(readFileSync(tombstonePath, "utf8"));
			tombstone.final_record_hash = "sha256:" + "f".repeat(64);
			writeFileSync(tombstonePath, JSON.stringify(tombstone, null, 2) + "\n");
			expect((await projectAssurance(contradictory, TASK, diffOf)).error).toMatch(/without a backend claim/);
		} finally {
			rmSync(contradictory, { recursive: true, force: true });
		}
	});

	test("fresh evidence, stale telemetry, and missing acceptance derive from one correlation", async () => {
		const root = makeEnrolledRoot();
		try {
			stageTaskSnapshot(root);
			const diff = diffOf(root);
			seedStaleEvidence(root);
			seedFreshEvidence(root, "A1");
			const result = await projectAssurance(root, TASK, diffOf);
			expect(result.error).toBeNull();
			expect(result.projection.record_revision).toMatch(/^sha256:/);
			expect(result.projection.diff_hash).toBe(diff);
			expect(result.projection.fresh_acceptance_ids).toEqual(["A1"]);
			expect(result.projection.missing_acceptance_ids).toEqual(["A2"]);
			expect(result.projection.stale_evidence_ids).toContain("evidence-stale");
			expect(result.projection.phase).toBe("working");
			expect(result.projection.completion_ready).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("fresh approval kinds are projection-owned and bound to the same correlation", async () => {
		const root = makeEnrolledRoot();
		try {
			stageTaskSnapshot(root);
			seedFreshEvidence(root, "A1", "A2");
			seedApproval(root, "qa", "qa-host");
			seedApproval(root, "review", "reviewer-host");
			const result = await projectAssurance(root, TASK, diffOf);
			expect(result.projection.fresh_approval_kinds).toEqual(["qa", "review"]);
			// material risk requires only review; with qa+review fresh the
			// Kernel-owned missing set is empty and no user approval is decidable.
			expect(result.projection.missing_approval_kinds).toEqual([]);
			expect(result.projection.authorization).toEqual({ state: "none", blocked: null });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("blocking and replan findings plus unresolved user decisions surface as facts", async () => {
		const root = makeEnrolledRoot();
		try {
			stageTaskSnapshot(root);
			seedFreshEvidence(root, "A1", "A2");
			seedOpenFinding(root, "blocking", "finding-blocking");
			seedOpenFinding(root, "unresolved_user_decision", "decision-1");
			seedOpenFinding(root, "replan_required", "replan-1");
			const result = await projectAssurance(root, TASK, diffOf);
			expect(result.projection.blocking_finding_ids).toContain("finding-blocking");
			expect(result.projection.unresolved_user_decision_ids).toContain("decision-1");
			expect(result.projection.replan_required_ids).toContain("replan-1");
			expect(result.projection.open_user_decision_count).toBe(1);
			expect(result.projection.completion_ready).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("authorization readiness truth table is Kernel-owned", () => {
		expect(deriveAssuranceAuthorization({
			risk: "critical", phase: "review",
			fresh_approval_kinds: ["qa", "review"], open_user_decision_count: 1,
		})).toEqual({ state: "resolve_user_decision", blocked: null });
		expect(deriveAssuranceAuthorization({
			risk: "critical", phase: "review",
			fresh_approval_kinds: ["qa", "review"], open_user_decision_count: 0,
		})).toEqual({ state: "record_user_approval", blocked: null });
		expect(deriveAssuranceAuthorization({
			risk: "critical", phase: "review",
			fresh_approval_kinds: ["qa", "review"], open_user_decision_count: 2,
		})).toEqual({
			state: "none",
			blocked: "resolve-user-decision requires exactly one open user decision; found 2",
		});
		expect(deriveAssuranceAuthorization({
			risk: "material", phase: "review",
			fresh_approval_kinds: ["qa", "review"], open_user_decision_count: 0,
		})).toEqual({ state: "none", blocked: null });
		expect(deriveAssuranceAuthorization({
			risk: "critical", phase: "review",
			fresh_approval_kinds: ["qa"], open_user_decision_count: 0,
		})).toEqual({ state: "none", blocked: null });
		expect(deriveAssuranceAuthorization({
			risk: "critical", phase: "working",
			fresh_approval_kinds: ["qa", "review"], open_user_decision_count: 0,
		})).toEqual({ state: "none", blocked: null });
	});

	test("assurance projection is never exported from the public Kernel index", async () => {
		const index = await import("../plugins/immune-brain/runtime/kernel/index");
		expect((index as Record<string, unknown>).projectAssurance).toBeUndefined();
		expect((index as Record<string, unknown>).deriveAssuranceAuthorization).toBeUndefined();
		expect("projectTaskV2" in kernelIndex).toBe(true);
	});

	test("completion-ready binds evidence, approvals, and findings to one correlation", async () => {
		const root = makeEnrolledRoot();
		try {
			stageTaskSnapshot(root);
			seedFreshEvidence(root, "A1", "A2");
			seedApproval(root, "review", "reviewer-host");
			const complete = await projectAssurance(root, TASK, diffOf);
			expect(complete.projection.completion_ready).toBe(true);
			expect(complete.projection.missing_acceptance_ids).toEqual([]);
			expect(complete.projection.missing_approval_kinds).toEqual([]);
			expect(complete.projection.blocking_finding_ids).toEqual([]);
			expect(complete.projection.open_user_decision_count).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
