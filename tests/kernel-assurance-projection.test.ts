import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveAssuranceAuthorization, projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import * as kernelIndex from "../plugins/immune-brain/runtime/kernel/index";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { revisionForContent } from "../plugins/immune-brain/runtime/kernel/storage";
import { taskDiffHash } from "../plugins/immune-brain/runtime/workspace_scope";

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
	const root = mkdtempSync(join(tmpdir(), "assurance-projection-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "owned.ts"), "baseline\n");
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), `${JSON.stringify(INTENT, null, 2)}\n`);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(join(root, ".imm", "workspace.json"), `${JSON.stringify({
		contract: "assurance_kernel/workspace/v1",
		current_working: null,
	}, null, 2)}\n`);
	const registry = createEnrollmentAuthorityRegistry();
	const preparation = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: preparation.digest,
		actor_id: "user",
		confirmation_ref: "c",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "n",
	};
	enrollCanaryTask(root, {
		task_id: TASK,
		intent_path: binding.intent_path,
		intent_revision: 1,
		preparation_digest: binding.preparation_digest,
		capability: registry.issue(binding),
		capability_binding: binding,
		now: "2026-08-12T10:00:00.000Z",
	}, registry);
	return root;
}

function mutateRecord(root: string, mutate: (record: Record<string, any>) => void): void {
	const path = join(root, ".imm", "tasks", `${TASK}.json`);
	const record = JSON.parse(readFileSync(path, "utf8"));
	mutate(record);
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

function freezeRecord(root: string): void {
	mutateRecord(root, (record) => {
		record.artifact_state = "frozen";
		record.intent_ref.path = `docs/plans/archive/${TASK}.intent.json`;
	});
}

function seedAttestation(root: string, kind: "qa" | "review" | "user", overrides: Record<string, unknown> = {}): void {
	const diff = diffOf(root);
	mutateRecord(root, (record) => record.attestations.push({
		id: `attestation-${kind}`,
		kind,
		authority_role: kind === "review" ? "reviewer" : kind,
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: diff,
		actor_id: `${kind}-host`,
		summary: `${kind} approved`,
		acceptance_results: kind === "qa" ? [
			{ acceptance_id: "A1", status: "passed", summary: "A1 passed" },
			{ acceptance_id: "A2", status: "passed", summary: "A2 passed" },
		] : [],
		...overrides,
	}));
}

function seedFinding(root: string, kind: string, id: string): void {
	mutateRecord(root, (record) => record.findings.push({
		id,
		kind,
		status: "open",
		acceptance_id: null,
		source: "kernel",
		review_round: 1,
		summary: kind,
	}));
}

function terminalize(root: string, lifecycle: "done" | "stopped"): void {
	mutateRecord(root, (record) => {
		record.lifecycle = lifecycle;
		record.artifact_state = "frozen";
		record.intent_ref.path = `docs/plans/archive/${TASK}.intent.json`;
	});
	const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
	const bytes = readFileSync(recordPath, "utf8");
	writeFileSync(join(root, ".imm", "tasks", `${TASK}.backend-claim.json`), `${JSON.stringify({
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: TASK,
		lifecycle_status: "terminal",
		terminal_lifecycle: lifecycle,
		terminal_event_id: `${lifecycle}:${TASK}:fixture`,
		final_record_hash: revisionForContent(bytes),
		terminalized_at: "2026-08-12T10:00:01.000Z",
	}, null, 2)}\n`);
	rmSync(join(root, ".imm", "tasks", ".backend-claim.json"));
	writeFileSync(join(root, ".imm", "workspace.json"), `${JSON.stringify({
		contract: "assurance_kernel/workspace/v1",
		current_working: null,
	}, null, 2)}\n`);
}

describe("kernel assurance projection v3", () => {
	test("unowned task returns an empty correlated projection", async () => {
		const root = mkdtempSync(join(tmpdir(), "assurance-projection-empty-"));
		try {
			mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
			execFileSync("git", ["init", "-q"], { cwd: root });
			const result = await projectAssurance(root, TASK, diffOf);
			expect(result).toMatchObject({ error: null, claim: null });
			expect(result.projection).toMatchObject({ lifecycle: "", artifact_state: "", next_obligation: "none" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("missing records and mismatched claims fail closed", async () => {
		const root = makeEnrolledRoot();
		try {
			expect((await projectAssurance(root, "no-such-task", diffOf)).error).toBe(`backend claim belongs to ${TASK}, not no-such-task`);
			const claimPath = join(root, ".imm", "tasks", ".backend-claim.json");
			const claim = JSON.parse(readFileSync(claimPath, "utf8"));
			claim.task_id = "other-task";
			writeFileSync(claimPath, `${JSON.stringify(claim, null, 2)}\n`);
			expect((await projectAssurance(root, TASK, diffOf)).error).toMatch(/other-task/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("exact claimless done and stopped facts remain projectable", async () => {
		for (const lifecycle of ["done", "stopped"] as const) {
			const root = makeEnrolledRoot();
			try {
				terminalize(root, lifecycle);
				const result = await projectAssurance(root, TASK, diffOf);
				expect(result.error).toBeNull();
				expect(result.claim).toBeNull();
				expect(result.projection).toMatchObject({ lifecycle, artifact_state: "frozen", next_obligation: "none" });
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	test("incomplete or contradictory terminal proof fails closed", async () => {
		const root = makeEnrolledRoot();
		try {
			rmSync(join(root, ".imm", "tasks", ".backend-claim.json"));
			writeFileSync(join(root, ".imm", "workspace.json"), `${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2)}\n`);
			expect((await projectAssurance(root, TASK, diffOf)).error).toMatch(/without a backend claim/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}

		const contradictory = makeEnrolledRoot();
		try {
			terminalize(contradictory, "done");
			const path = join(contradictory, ".imm", "tasks", `${TASK}.backend-claim.json`);
			const tombstone = JSON.parse(readFileSync(path, "utf8"));
			tombstone.final_record_hash = `sha256:${"f".repeat(64)}`;
			writeFileSync(path, `${JSON.stringify(tombstone, null, 2)}\n`);
			expect((await projectAssurance(contradictory, TASK, diffOf)).error).not.toBeNull();
		} finally {
			rmSync(contradictory, { recursive: true, force: true });
		}
	});

	test("attestation freshness and obligations come from one correlation", async () => {
		const root = makeEnrolledRoot();
		try {
			freezeRecord(root);
			seedAttestation(root, "qa", { intent_content_hash: `sha256:${"f".repeat(64)}`, id: "stale-qa" });
			let result = await projectAssurance(root, TASK, diffOf);
			expect(result.projection).toMatchObject({
				fresh_acceptance_ids: [],
				missing_acceptance_ids: ["A1", "A2"],
				stale_attestation_ids: ["stale-qa"],
				next_obligation: "run_qa",
			});
			seedAttestation(root, "qa");
			result = await projectAssurance(root, TASK, diffOf);
			expect(result.projection.fresh_acceptance_ids).toEqual(["A1", "A2"]);
			expect(result.projection.fresh_approval_kinds).toEqual(["qa"]);
			expect(result.projection.next_obligation).toBe("run_review");
			seedAttestation(root, "review");
			result = await projectAssurance(root, TASK, diffOf);
			expect(result.projection).toMatchObject({ completion_ready: true, next_obligation: "complete" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("open findings are projected as blockers before assurance work", async () => {
		const root = makeEnrolledRoot();
		try {
			freezeRecord(root);
			seedFinding(root, "blocking", "blocking-1");
			seedFinding(root, "unresolved_user_decision", "decision-1");
			seedFinding(root, "replan_required", "replan-1");
			const projection = (await projectAssurance(root, TASK, diffOf)).projection;
			expect(projection.blocking_finding_ids).toEqual(["blocking-1"]);
			expect(projection.unresolved_user_decision_ids).toEqual(["decision-1"]);
			expect(projection.replan_required_ids).toEqual(["replan-1"]);
			expect(projection.next_obligation).toBe("resolve_user_decision");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("authorization readiness is derived only from the projected obligation", () => {
		expect(deriveAssuranceAuthorization({ next_obligation: "authorize_user", open_user_decision_count: 0 })).toEqual({ state: "record_user_approval", blocked: null });
		expect(deriveAssuranceAuthorization({ next_obligation: "resolve_user_decision", open_user_decision_count: 1 })).toEqual({ state: "resolve_user_decision", blocked: null });
		expect(deriveAssuranceAuthorization({ next_obligation: "resolve_user_decision", open_user_decision_count: 2 })).toEqual({
			state: "none",
			blocked: "resolve-user-decision requires exactly one open user decision; found 2",
		});
		expect(deriveAssuranceAuthorization({ next_obligation: "run_review", open_user_decision_count: 0 })).toEqual({ state: "none", blocked: null });
	});

	test("host-only assurance projection is absent from the public Kernel index", async () => {
		const index = await import("../plugins/immune-brain/runtime/kernel/index");
		expect((index as Record<string, unknown>).projectAssurance).toBeUndefined();
		expect((index as Record<string, unknown>).deriveAssuranceAuthorization).toBeUndefined();
		expect("projectTask" in kernelIndex).toBe(true);
	});
});
