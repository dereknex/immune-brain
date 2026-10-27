import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { rehydrateConsumption, type BatchLaneRedoChildRun } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { prepareBatchLaneRunState, readBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { createLaneWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";
import type { StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const NOW = "2026-09-05T00:00:00.000Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fixture() {
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
		intent_path: read.intent_ref.path, intent_revision: 1, intent_content_hash: read.content_hash }];
	const binding = { batch_id: "batch-redo", initiative_slug: "redo", plan_digest: computeBatchPlanDigest(children),
		branch: "refs/heads/imm/redo", base_head: base, budget: { max_children: 1, qa_failure_limit: 2 },
		actor_id: "user", confirmation_ref: "confirm-redo", nonce: "nonce-redo" };
	const registry = createBatchAuthorityRegistry();
	const capability = registry.issue(binding, children, NOW);
	const lane = createLaneWorktree(root, "redo", "child", base);
	const seeded = seedKernelRunForTest(lane, { task_id: "child", terminal: { lifecycle: "done" }, record: {
		contract: "assurance_kernel/task_record/v4", task_id: "child", intent_snapshot: read.intent,
		intent_ref: { path: read.intent_ref.path, content_hash: read.content_hash }, lifecycle: "done", artifact_state: "frozen",
		baseline: read.content_hash, git_base_head: base, findings: [], history: [],
		attestations: ["qa", "review"].map(kind => ({ id: `old-${kind}`, kind, authority_role: kind === "qa" ? "qa" : "reviewer", task_revision: 1,
			intent_content_hash: read.content_hash, diff_hash: `sha256:${"f".repeat(64)}`, actor_id: `old-${kind}`, summary: "prior approval",
			acceptance_results: kind === "qa" ? [{ acceptance_id: "AC1", status: "passed", summary: "prior run" }] : [],
			...(kind === "review" ? { review_revision: { contract: "assurance_kernel/review_revision_identity/v1", base_head: base,
				review_commit: base, review_tree: git(lane, "rev-parse", "HEAD^{tree}"), manifest_digest: `sha256:${"f".repeat(64)}` } } : {}) })),
	} });
	return { root, lane, base, children, binding, run_id: seeded.run_id };
}

// The redo re-issue path is retired (batch-redo-reissue-retirement): a grant recorded
// before batch-resource-safety S2 only bounds the parked child and is never spent again.
describe("resume consumption and redo grants", () => {
	for (const grants of [0, 1, 2]) test(`restores ${grants} grants through the durable Lane record without resetting the limit`, () => {
		const fx = fixture();
		const record = prepareBatchLaneRunState({ ...fx.binding, children: fx.children, confirmation_time: NOW, now: NOW, max_parallel: 1 });
		record.children[0] = { ...record.children[0]!, state: "settled", redo_grants: grants,
			lane: { path: fx.lane, branch: "imm-lane/redo/child", base_head: fx.base, lane_commit: null, run_id: fx.run_id } } as BatchLaneRedoChildRun;
		writeBatchLaneRunState(fx.root, record);
		const persisted = readBatchLaneRunState(fx.root, record.batch_id)!;
		const registry = createBatchAuthorityRegistry();
		const capability = registry.issue(fx.binding, fx.children, NOW);
		const input = { registry, capability, kernel: { validateBatchAuthorization: () => registry.inspect(capability, fx.binding) } } as StartBatchInput;
		rehydrateConsumption(input, persisted);
		rehydrateConsumption(input, persisted);
		expect(registry.isChildConsumed(capability, "child")).toBe(true);
		expect(registry.redoGrants(capability, "child")).toBe(grants);
		expect(() => registry.consumeChild(capability, fx.binding, "child")).toThrow("batch_child_slot_consumed");
		expect(registry.redoGrants(capability, "child")).toBe(grants);
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
		expect(registry.redoGrants(capability, "child")).toBe(1);
	});
});
