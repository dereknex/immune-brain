import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { intentAuthorityHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { localRunId, readSettledRunEvidence, readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { createBatchKernelPort, deriveChildRedoEnrollment } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { rehydrateConsumption, type BatchLaneRedoChildRun } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { prepareBatchLaneRunState, readBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { createLaneWorktree, recreateLaneWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";
import type { StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const NOW = "2026-09-05T00:00:00.000Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fixture(lifecycle: "active" | "done" | "stopped" = "done", subjectBinding = false) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "batch-redo-")));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	const intent = {
		contract: "assurance_kernel/task_intent/v1", task_id: "child", owner: "user", goal: "deliver child",
		acceptance: [{ id: "AC1", assertion: "child works", verification: "bun -e 'process.exit(0)'" }],
		scope_hint: ["value.txt"], risk: "material", revision: 1,
	};
	writeFileSync(join(root, "docs/plans/child.intent.json"), JSON.stringify(intent));
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(root, "value.txt"), "base\n");
	git(root, "add", "-A"); git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	const read = readTaskIntent(root, "child");
	const children = [{ task_id: "child", slice_id: "S1", status: "enrollable" as const, reason: null, blocked_by: [],
		intent_path: read.intent_ref.path, intent_revision: 1, intent_content_hash: read.content_hash,
		...(subjectBinding ? { intent_authority_hash: intentAuthorityHash(read.intent) } : {}) }];
	const binding = { batch_id: "batch-redo", initiative_slug: "redo", plan_digest: computeBatchPlanDigest(children),
		branch: "refs/heads/imm/redo", base_head: base, budget: { max_children: 1, qa_failure_limit: 2 },
		actor_id: "user", confirmation_ref: "confirm-redo", nonce: "nonce-redo" };
	const registry = createBatchAuthorityRegistry();
	const capability = registry.issue(binding, children, NOW);
	const lane = createLaneWorktree(root, "redo", "child", base);
	const seeded = seedKernelRunForTest(lane, { task_id: "child", ...(lifecycle !== "active" ? { terminal: { lifecycle } } : {}), record: {
		contract: "assurance_kernel/task_record/v4", task_id: "child", intent_snapshot: read.intent,
		intent_ref: { path: read.intent_ref.path, content_hash: read.content_hash }, lifecycle, artifact_state: "frozen",
		baseline: read.content_hash, git_base_head: base, findings: [], history: [],
		attestations: ["qa", "review"].map(kind => ({ id: `old-${kind}`, kind, authority_role: kind === "qa" ? "qa" : "reviewer", task_revision: 1,
			intent_content_hash: read.content_hash, diff_hash: `sha256:${"f".repeat(64)}`, actor_id: `old-${kind}`, summary: "prior approval",
			acceptance_results: kind === "qa" ? [{ acceptance_id: "AC1", status: "passed", summary: "prior run" }] : [],
			...(kind === "review" ? { review_revision: { contract: "assurance_kernel/review_revision_identity/v1", base_head: base,
				review_commit: base, review_tree: git(lane, "rev-parse", "HEAD^{tree}"), manifest_digest: `sha256:${"f".repeat(64)}` } } : {}) })),
	} });
	registry.consumeChild(capability, binding, "child");
	writeFileSync(join(root, "parent.txt"), "new parent tip\n");
	git(root, "add", "--", "parent.txt"); git(root, "commit", "-qm", "advance parent");
	const head = git(root, "rev-parse", "HEAD");
	const request = { capability, binding, task_id: "child", expected_head: head, now: NOW, prior_lane_root: lane, prior_run_id: seeded.run_id };
	return { root, lane, head, base, children, binding, registry, capability, request };
}

describe("redo enrollment under the original Batch Authorization", () => {
	for (const lifecycle of ["done", "stopped"] as const) test(`${lifecycle} run permits a fresh Lane enrollment with no inherited approvals`, async () => {
		const fx = fixture(lifecycle);
		expect(readSettledRunEvidence(fx.lane, "child")?.record.attestations).toHaveLength(2);
		const derived = deriveChildRedoEnrollment(fx.root, fx.registry, fx.request);
		expect(derived.binding.intent_content_hash).toBe(fx.children[0]!.intent_content_hash);
		expect(fx.registry.redoGrants(fx.capability, "child")).toBe(1);
		const lane = recreateLaneWorktree(fx.root, "redo", "child", fx.head);
		expect(lane).toBe(fx.lane);
		expect(git(lane, "symbolic-ref", "--short", "HEAD")).toBe("imm-lane/redo/child");
		expect(git(lane, "rev-parse", "HEAD")).toBe(fx.head);
		expect(localRunId(lane, "child")).toBeNull();
		expect(readTaskRecordRaw(lane, "child").record).toBeNull();
		const port = createBatchKernelPort({ root: fx.root, enrollmentRegistry: createEnrollmentAuthorityRegistry(),
			registry: fx.registry, capability: fx.capability, binding: fx.binding,
			advanceTask: async () => ({ state: "completed" }), resume: { isResuming: false, existingBatch: null, batchBranch: fx.binding.branch } });
		await port.enrollTask({ root: lane, task_id: "child", batch: { registry: fx.registry, capability: fx.capability, binding: { batch_id: fx.binding.batch_id, expected_head: fx.head } } });
		expect(localRunId(lane, "child")).not.toBe(fx.request.prior_run_id);
		expect(readTaskRecordRaw(lane, "child").record).toMatchObject({ lifecycle: "active", git_base_head: fx.head, attestations: [] });
		expect(fx.registry.isChildConsumed(fx.capability, "child")).toBe(true);
	});

	test("a live prior run cannot spend a redo", () => {
		const fx = fixture("active");
		expect(() => deriveChildRedoEnrollment(fx.root, fx.registry, fx.request)).toThrow("batch_child_redo_run_active");
		expect(fx.registry.redoGrants(fx.capability, "child")).toBe(0);
		expect(fx.registry.isChildConsumed(fx.capability, "child")).toBe(true);
	});

	test.each(["different-run", ""])("a recorded run id %j cannot substitute for the local run", prior_run_id => {
		const fx = fixture();
		expect(() => deriveChildRedoEnrollment(fx.root, fx.registry, { ...fx.request, prior_run_id })).toThrow("batch_child_redo_run_mismatch");
		expect(fx.registry.redoGrants(fx.capability, "child")).toBe(0);
	});

	for (const subjectBinding of [false, true]) test(`changed intent content cannot spend a redo (subject binding: ${subjectBinding})`, () => {
		const fx = fixture("done", subjectBinding);
		const path = join(fx.root, "docs/plans/child.intent.json");
		const intent = JSON.parse(readFileSync(path, "utf8"));
		intent.revision++;
		writeFileSync(path, JSON.stringify(intent));
		git(fx.root, "add", "--", "docs/plans/child.intent.json"); git(fx.root, "commit", "-qm", "changed intent");
		expect(() => deriveChildRedoEnrollment(fx.root, fx.registry, { ...fx.request, expected_head: git(fx.root, "rev-parse", "HEAD") })).toThrow("batch_child_intent_changed");
		expect(fx.registry.redoGrants(fx.capability, "child")).toBe(0);
	});

	test("a failed preparation leaves the grant available", () => {
		const fx = fixture();
		expect(() => deriveChildRedoEnrollment(fx.root, fx.registry, { ...fx.request, expected_head: fx.base })).toThrow("batch_head_lineage_broken");
		expect(fx.registry.redoGrants(fx.capability, "child")).toBe(0);
	});
});

describe("Lane recreation", () => {
	for (const dirty of ["tracked", "staged", "untracked"] as const) test(`refuses ${dirty} edits without touching the old Lane or store`, () => {
		const fx = fixture();
		const path = join(fx.lane, dirty === "untracked" ? "scratch.txt" : "value.txt");
		writeFileSync(path, "keep me\n");
		if (dirty === "staged") git(fx.lane, "add", "--", "value.txt");
		const status = git(fx.lane, "status", "--porcelain");
		expect(() => recreateLaneWorktree(fx.root, "redo", "child", fx.head)).toThrow("existing clean owned Lane");
		expect(readFileSync(path, "utf8")).toBe("keep me\n");
		expect(git(fx.lane, "status", "--porcelain")).toBe(status);
		expect(git(fx.lane, "rev-parse", "HEAD")).toBe(fx.base);
		expect(localRunId(fx.lane, "child")).toBe(fx.request.prior_run_id);
	});

	test("an invalid new Parent tip leaves the old Lane intact", () => {
		const fx = fixture();
		expect(() => recreateLaneWorktree(fx.root, "redo", "child", "missing-tip")).toThrow("batch_worktree_failed");
		expect(existsSync(fx.lane)).toBe(true);
		expect(localRunId(fx.lane, "child")).toBe(fx.request.prior_run_id);
	});
});

describe("resume consumption and redo spend", () => {
	for (const grants of [0, 1, 2]) test(`restores ${grants} grants through the durable Lane record without resetting the limit`, () => {
		const fx = fixture();
		const record = prepareBatchLaneRunState({ ...fx.binding, children: fx.children, confirmation_time: NOW, now: NOW, max_parallel: 1 });
		record.children[0] = { ...record.children[0]!, state: "settled", redo_grants: grants,
			lane: { path: fx.lane, branch: "imm-lane/redo/child", base_head: fx.base, lane_commit: null, run_id: fx.request.prior_run_id } } as BatchLaneRedoChildRun;
		writeBatchLaneRunState(fx.root, record);
		const persisted = readBatchLaneRunState(fx.root, record.batch_id)!;
		const registry = createBatchAuthorityRegistry();
		const capability = registry.issue(fx.binding, fx.children, NOW);
		const input = { registry, capability, kernel: { validateBatchAuthorization: () => registry.inspect(capability, fx.binding) } } as StartBatchInput;
		rehydrateConsumption(input, persisted);
		rehydrateConsumption(input, persisted);
		expect(registry.isChildConsumed(capability, "child")).toBe(true);
		expect(registry.redoGrants(capability, "child")).toBe(grants);
		for (let count = grants + 1; count <= 2; count++) {
			expect(registry.reissueChild(capability, fx.binding, "child")).toBe(count);
			registry.consumeChild(capability, fx.binding, "child");
		}
		expect(() => registry.reissueChild(capability, fx.binding, "child")).toThrow("batch_child_redo_exhausted");
	});

	test("restores an already granted redo awaiting enrollment without consuming it", () => {
		const fx = fixture();
		const record = prepareBatchLaneRunState({ ...fx.binding, children: fx.children, confirmation_time: NOW, now: NOW, max_parallel: 1 });
		record.children[0] = { ...record.children[0]!, state: "lane_admitted", redo_grants: 1 } as BatchLaneRedoChildRun;
		const registry = createBatchAuthorityRegistry();
		const capability = registry.issue(fx.binding, fx.children, NOW);
		rehydrateConsumption({ registry, capability, kernel: { validateBatchAuthorization: () => registry.inspect(capability, fx.binding) } } as StartBatchInput, record);
		expect(registry.redoGrants(capability, "child")).toBe(1);
		expect(registry.isChildConsumed(capability, "child")).toBe(false);
		registry.consumeChild(capability, fx.binding, "child");
		expect(registry.reissueChild(capability, fx.binding, "child")).toBe(2);
	});
});
