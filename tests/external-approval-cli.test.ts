// ADR 0043 Slice 2 (docs/specs/external-approval-seam.spec.md AC2): the opt-in
// single-machine external approval seam, driven through the shipped
// `imm-kernel` CLI dispatch (BR-SCN-1, BR-SCN-2).

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runKernelCli } from "../plugins/immune-brain/runtime/v4_runtime";
import { capabilityActionFor, createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { anchorForEvidence } from "../plugins/immune-brain/runtime/kernel/refutation";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { readRunRowByTask, updateRunRecord, withKernelTransaction } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { taskDeliveryIdentity } from "../plugins/immune-brain/runtime/workspace_scope";

const TASK = "approval-seam-task";
const PROJECT = "immune_brain/project_config/v2";
const BIN = resolve(import.meta.dir, "../plugins/immune-brain/bin/imm-kernel");
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A committed TaskIntent in a fresh repository; `external_approval` is written only when given. */
function repo(externalApproval?: unknown, options: { commitIntent?: boolean } = {}): string {
	const root = mkdtempSync(join(tmpdir(), "imm-external-approval-"));
	roots.push(root);
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	mkdirSync(join(root, ".imm"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	appendFileSync(join(root, ".git/info/exclude"), ".imm/\n");
	writeFileSync(join(root, "README.md"), "fixture\n");
	writeFileSync(join(root, `docs/plans/${TASK}.intent.json`), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: TASK,
		owner: "user",
		goal: "External approval fixture",
		acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
		scope_hint: ["src"],
		risk: "routine",
		revision: 1,
	}, null, 2)}\n`);
	execFileSync("git", ["add", options.commitIntent === false ? "README.md" : "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	if (externalApproval !== undefined)
		writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: PROJECT, external_approval: externalApproval }));
	return root;
}

async function cli(root: string, ...args: string[]) {
	const result = await runKernelCli(args, root);
	let json: any = null;
	try {
		json = JSON.parse(result.stdout);
	} catch {
		json = null;
	}
	return { ...result, json };
}

function mutateStoredRecord(root: string, mutate: (record: Record<string, any>) => void): void {
	withKernelTransaction(root, (db) => {
		const run = readRunRowByTask(db, TASK);
		if (!run) throw new Error("fixture run is missing");
		const record = JSON.parse(run.record_json) as Record<string, any>;
		mutate(record);
		updateRunRecord(db, run.run_id, run.revision, `${JSON.stringify(record, null, 2)}\n`, new Date().toISOString());
	});
}

function seedOpenUserDecision(root: string, id = "decision-review-limit"): string {
	mutateStoredRecord(root, (record) => {
		record.findings.push({ id, kind: "unresolved_user_decision", status: "open", acceptance_id: null, source: "kernel", review_round: 2, summary: "Review returned this boundary twice" });
	});
	return id;
}

function seedVerifierDispute(root: string): string {
	const record = readTaskRecordRaw(root, TASK).record!;
	const diffHash = taskDeliveryIdentity(root, record).diff_hash;
	const evidence = { trigger: "input reaches the guarded operation", caller_chain: ["src/owned.ts"], violated: { kind: "acceptance" as const, ref: "A1" } };
	const dispute = { decision_id: "user-decision-verifier-fixture", finding: { id: "review-disputed", acceptance_id: "A1", summary: "claim", anchor: anchorForEvidence(evidence), evidence },
		counter_path: "src/owned.ts rejects the input", verdict_sha256: `sha256:${"a".repeat(64)}`,
		intent_content_hash: record.intent_ref.content_hash, diff_hash: diffHash };
	mutateStoredRecord(root, (next) => {
		next.artifact_state = "frozen";
		next.findings.push({ id: dispute.decision_id, kind: "unresolved_user_decision", status: "open", acceptance_id: "A1", source: "kernel", review_round: null, summary: "claim and counter-path" });
		next.history.push({ id: "dispute-fixture", at: "2026-11-04T00:00:00Z", type: "record_review_verifier_dispute", from_state: "active:frozen", to_state: "active:frozen", reason: "dispute",
			authority: { authority_kind: "review", actor_id: "reviewer", confirmation_ref: "review-receipt", issued_at: "2026-11-04T00:00:00Z" }, review_verifier_dispute: dispute });
	});
	return dispute.decision_id;
}

/** Settle the enrolled task as `done` through freeze, a host-attested QA approval, and complete. */
function completeTask(root: string): void {
	const registry = createMutationAuthorityRegistry();
	const app = createCanaryApplication(registry);
	const DIFF = `sha256:${"f".repeat(64)}`;
	const execute = (operation: Parameters<typeof app.execute>[0]["operation"]) => {
		const record = readTaskRecordRaw(root, TASK).record!;
		return app.execute({
			root, task_id: TASK, operation,
			prior_intent_token: readTaskIntent(root, TASK, record.intent_ref.path).token,
			diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
			now: new Date().toISOString(),
		});
	};
	execute({ op: "freeze_artifacts", actor_id: "executor-1" });
	execFileSync("git", ["add", "-A"], { cwd: root });
	const record = readTaskRecordRaw(root, TASK);
	const approval = { id: "qa-terminal", kind: "qa", authority_role: "qa", task_revision: 1, intent_content_hash: record.record!.intent_ref.content_hash, diff_hash: DIFF, actor_id: "qa-1", summary: "descriptor passed" };
	const at = new Date().toISOString();
	const capability = registry.issue({
		authority_kind: "qa", task_id: TASK,
		action_digest: digestOfAction(capabilityActionFor({ op: "record_approval", task_id: TASK, at, actor_id: "qa-1", approval })),
		expected_record_hash: record.revision, intent_revision: 1, intent_content_hash: approval.intent_content_hash,
		diff_hash: DIFF, actor_id: "qa-1", confirmation_ref: "qa-terminal", findings_digest: null,
	});
	app.execute({
		root, task_id: TASK, operation: { op: "record_approval", approval, capability, actor_id: "qa-1" } as never,
		prior_intent_token: readTaskIntent(root, TASK, record.record!.intent_ref.path).token,
		diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }), now: at,
	});
	expect(execute({ op: "complete", actor_id: "executor-1" }).record.lifecycle).toBe("done");
}

describe("imm-kernel approve: default-off gate (BR-SCN-1)", () => {
	test.each([["unset", undefined], ["false", false]] as const)("external_approval %s fails closed before any Kernel write", async (_label, value) => {
		const root = repo(value);
		const result = await cli(root, "approve", TASK, "--json");
		expect(result.returncode).toBe(1);
		expect(result.json.error.code).toBe("external_approval_disabled");
		const status = await cli(root, "status", "--json");
		expect(status.json.kernel.claim).toBeNull();
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
	});

	test("the shipped bin/imm-kernel entrypoint reports external_approval_disabled on stdout", () => {
		const root = repo();
		const result = spawnSync(BIN, ["approve", TASK, "--json"], { cwd: root, encoding: "utf8" });
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout).error.code).toBe("external_approval_disabled");
	});

	test("a non-boolean external_approval is invalid config and still fails closed", async () => {
		const root = repo("yes");
		expect((await cli(root, "config", "--json")).returncode).toBe(1);
		expect((await cli(root, "approve", TASK, "--json")).json.error.code).toBe("external_approval_disabled");
	});
});

describe("imm-kernel approve/inspect argument contract", () => {
	test.each([
		[["approve", TASK]],
		[["approve", "--json"]],
		[["approve", "bad id!", "--json"]],
		[["approve", TASK, "--json", "--bogus"]],
		[["approve", TASK, "--finding", "f1", "--json"]],
		[["approve", TASK, "--resolution", "ok", "--json"]],
		[["approve", TASK, "--finding", "f1", "--resolution", "ok", "--stop", "halt", "--json"]],
		[["approve", TASK, "--stop", "", "--json"]],
		[["approve", TASK, "--actor", "", "--json"]],
		[["approve", TASK, "--json", "--accept-residual-risk"]],
		[["inspect", "--run", "run-abc", "--json"]],
		[["inspect", "--task", "bad id!", "--json"]],
		[["inspect", "--task", TASK, "--run", "not-a-run", "--json"]],
	])("%j exits 2 invalid_command", async (args) => {
		const root = repo(true);
		const result = await cli(root, ...args);
		expect(result.returncode).toBe(2);
		expect(result.json.error.code).toBe("invalid_command");
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
	});
});

describe("imm-kernel approve with external_approval: true (BR-SCN-2)", () => {
	test("inspect without --json is not routed to the Kernel", async () => {
		const result = await cli(repo(true), "inspect", "--task", TASK);
		expect(result.returncode).toBe(2);
		expect(result.stderr).toContain("invalid_kernel_command");
	});

	test("an untracked TaskIntent is refused", async () => {
		const root = repo(true, { commitIntent: false });
		const result = await cli(root, "approve", TASK, "--json");
		expect(result.returncode).toBe(1);
		expect(result.json.error.code).toBe("intent_untracked");
		expect((await cli(root, "status", "--json")).json.kernel.claim).toBeNull();
	});

	test("enroll, inspect an open decision, resolve it, settle, and verify the audit", async () => {
		const root = repo(true);
		const enrolled = await cli(root, "approve", TASK, "--json");
		expect(enrolled.returncode).toBe(0);
		expect(enrolled.json).toMatchObject({
			contract: "assurance_kernel/approval_result/v1",
			action: "enroll",
			task_id: TASK,
			lifecycle: "active",
			confirmation_source: "external_approval",
		});
		expect(enrolled.json.run_id).toMatch(/^run-/);
		expect(readTaskRecordRaw(root, TASK).record!.confirmation_source).toBe("external_approval");
		expect((await cli(root, "status", "--json")).json.kernel.claim.task_id).toBe(TASK);
		// Re-running the enrollment fails closed.
		const again = await cli(root, "approve", TASK, "--json");
		expect(again.returncode).toBe(1);
		expect(again.json.error.code).toBe("enrollment_rejected");

		const decisionId = seedOpenUserDecision(root);
		const open = await cli(root, "inspect", "--json");
		expect(open.returncode).toBe(0);
		expect(open.json.assurance.projection.unresolved_user_decisions).toEqual([
			{ id: decisionId, summary: "Review returned this boundary twice", acceptance_id: null },
		]);
		const named = await cli(root, "inspect", "--task", TASK, "--json");
		expect(named.returncode).toBe(0);
		expect(named.json.audit).toBeNull();
		expect(named.json.assurance.projection.unresolved_user_decisions).toHaveLength(1);

		const resolved = await cli(root, "approve", TASK, "--finding", decisionId, "--resolution", "keep the boundary", "--json");
		expect(resolved.returncode).toBe(0);
		expect(resolved.json).toMatchObject({ action: "resolve_user_decision", task_id: TASK, finding_id: decisionId, resolution: "keep the boundary" });
		expect((await cli(root, "inspect", "--json")).json.assurance.projection.unresolved_user_decisions).toEqual([]);
		const replay = await cli(root, "approve", TASK, "--finding", decisionId, "--resolution", "keep the boundary", "--json");
		expect(replay.returncode).toBe(1);
		expect(replay.json.error.code).toBe("decision_resolution_rejected");

		completeTask(root);
		const audit = await cli(root, "inspect", "--task", TASK, "--json");
		expect(audit.returncode).toBe(0);
		expect(audit.json.contract).toBe("assurance_kernel/inspect/v1");
		expect(audit.json.audit).toMatchObject({
			valid: true,
			task_id: TASK,
			run_id: enrolled.json.run_id,
			lifecycle: "done",
			audit_dir: `.imm/audit/${TASK}/${enrolled.json.run_id}`,
			intent_content_hash: enrolled.json.intent_content_hash,
			confirmation_source: "external_approval",
		});
		const proof = JSON.parse(readFileSync(join(root, audit.json.audit.audit_dir, "terminal-proof.json"), "utf8"));
		expect(audit.json.audit.final_record_hash).toBe(proof.final_record_hash);
		// A settled task has no active claim to approve against.
		expect((await cli(root, "approve", TASK, "--stop", "late", "--json")).json.error.code).toBe("no_active_claim");
	});

	test.each(["accept_verifier_dispute", "dismiss_verifier_dispute"])("a verifier dispute resolves as %s under the default literal-user actor", async (resolution) => {
		const root = repo(true);
		expect((await cli(root, "approve", TASK, "--json")).returncode).toBe(0);
		const decisionId = seedVerifierDispute(root);
		const result = await cli(root, "approve", TASK, "--finding", decisionId, "--resolution", resolution, "--json");
		expect(result.returncode).toBe(0);
		expect(result.json).toMatchObject({ action: "resolve_user_decision", finding_id: decisionId, resolution });
		const finding = readTaskRecordRaw(root, TASK).record!.findings.find((item) => item.id === decisionId);
		expect(finding?.status).toBe("resolved");
	});

	test("a verifier dispute refuses a non-user --actor", async () => {
		const root = repo(true);
		expect((await cli(root, "approve", TASK, "--json")).returncode).toBe(0);
		const decisionId = seedVerifierDispute(root);
		const result = await cli(root, "approve", TASK, "--finding", decisionId, "--resolution", "accept_verifier_dispute", "--actor", "ops-bot", "--json");
		expect(result.returncode).toBe(1);
		expect(result.json.error.code).toBe("decision_resolution_rejected");
	});

	test("stop settles the task, exports its audit, and inspect --task verifies it", async () => {
		const root = repo(true);
		const enrolled = await cli(root, "approve", TASK, "--json");
		const runId = enrolled.json.run_id as string;
		const stopped = await cli(root, "approve", TASK, "--stop", "operator halt", "--json");
		expect(stopped.returncode).toBe(0);
		expect(stopped.json).toMatchObject({
			contract: "assurance_kernel/approval_result/v1",
			action: "stop",
			task_id: TASK,
			run_id: runId,
			lifecycle: "stopped",
			audit_dir: `.imm/audit/${TASK}/${runId}`,
		});
		expect(existsSync(join(root, stopped.json.audit_dir, "terminal-proof.json"))).toBe(true);
		expect((await cli(root, "status", "--json")).json.kernel.claim).toBeNull();
		const again = await cli(root, "approve", TASK, "--stop", "operator halt", "--json");
		expect(again.returncode).toBe(1);
		expect(again.json.error.code).toBe("no_active_claim");

		for (const args of [["--task", TASK], ["--task", TASK, "--run", runId]]) {
			const audit = await cli(root, "inspect", ...args, "--json");
			expect(audit.returncode).toBe(0);
			expect(audit.json.audit).toMatchObject({ valid: true, run_id: runId, lifecycle: "stopped", confirmation_source: "external_approval" });
		}
		const otherRun = await cli(root, "inspect", "--task", TASK, "--run", "run-absent", "--json");
		expect(otherRun.returncode).toBe(1);
		expect(otherRun.json.error.code).toBe("task_audit_missing");

		const proofPath = join(root, stopped.json.audit_dir, "terminal-proof.json");
		const proof = JSON.parse(readFileSync(proofPath, "utf8"));
		writeFileSync(proofPath, `${JSON.stringify({ ...proof, final_record_hash: `sha256:${"0".repeat(64)}` }, null, 2)}\n`);
		const tampered = await cli(root, "inspect", "--task", TASK, "--json");
		expect(tampered.returncode).toBe(1);
		expect(tampered.json.error.code).toBe("task_audit_invalid");
	});

	test("inspect --task on an idle workspace reports a missing audit and creates no state", async () => {
		const root = repo(true);
		const result = await cli(root, "inspect", "--task", TASK, "--json");
		expect(result.returncode).toBe(1);
		expect(result.json.error.code).toBe("task_audit_missing");
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/state"))).toBe(false);
	});
});
