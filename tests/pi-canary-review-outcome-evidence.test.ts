import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	captureReviewFacts,
} from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";
import { buildReviewPrompt, reviewTurnBudget, type SnapshotDescriptor } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import { submitMediatedReview } from "../plugins/immune-brain/runtime/assurance/review_mediation";
import { reviewIncompleteFixture } from "./fixtures/review-incomplete-fixture";
import { buildReviewBrief, classifyReviewWorkload } from "../plugins/immune-brain/runtime/assurance/coordinator.ts";
import { taskRevisionDiffHash } from "../plugins/immune-brain/runtime/workspace_scope.ts";

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "canary-outcome-root-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	writeFileSync(join(root, "tracked.ts"), "export const value = 'base';\n");
	execFileSync("git", ["add", "tracked.ts"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	return root;
}

function snapshot(overrides: Partial<SnapshotDescriptor> = {}): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v1",
		task_id: "2026-08-16-013",
		role: "review",
		record_revision: "sha256:" + "a".repeat(64),
		workspace_revision: "sha256:" + "b".repeat(64),
		intent_revision: 1,
		intent_content_hash: "sha256:" + "c".repeat(64),
		diff_hash: "sha256:" + "d".repeat(64),
		phase: "review",
		risk: "material",
		fresh_acceptance_ids: ["acc-1"],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		acceptance: [{ id: "acc-1", assertion: "suite passes", verification: "{}" }],
		dirty_files: ["tracked.ts"],
		review_revision: { contract: "assurance_kernel/review_revision_identity/v2", base_head: "1".repeat(40), review_commit: "2".repeat(40) },
		root: "/tmp",
		...overrides,
	};
}

describe("review contract outcome evidence", () => {
	test("an observed incomplete receipt reaches the non-verdict path and is bound to reason and paths", async () => {
		const f = reviewIncompleteFixture();
		try {
			const c = f.create();
			const ready = await c.advance(f.taskId, f.ctx);
			expect(ready.state).toBe("review_ready");
			const s = await f.snapshot(c), outcome = f.incomplete(s);
			const receiptBytes = JSON.stringify(outcome);
			const observed = () => ({ ok: true as const, receipt: { actorId: "reviewer-observed", result: receiptBytes } });
			for (const override of [{ reason: "different reason" }, { inspected_paths: [f.paths[0]] }])
				expect(await submitMediatedReview(c, f.ctx, f.taskId, { ...outcome, ...override }, observed)).toMatchObject({ state: "blocked", reason: "parent verdict does not match reviewer receipt" });
			expect(await submitMediatedReview(c, f.ctx, f.taskId, undefined, observed)).toEqual({ state: "blocked", reason: "review_incomplete_retry", recovery_action: "advance_assurance" });
			expect(f.record().record!.findings).toEqual([]);
			expect(f.record().record!.history.filter(e => e.type === "record_review_incomplete")).toHaveLength(1);
			expect(c.active(f.taskId)).toBeNull();
			expect((await c.advance(f.taskId, f.ctx)).state).toBe("review_ready");
		} finally { f.cleanup(); }
	}, 60_000);
	test("Review facts carry per-acceptance outcomes and freeze them against later mutation", () => {
		const root = repo();
		try {
			const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
			writeFileSync(join(root, "tracked.ts"), "export const value = 'captured';\n");
			execFileSync("git", ["add", "tracked.ts"], { cwd: root });
			const scope = ["tracked.ts"];
			const hash = taskRevisionDiffHash(root, scope, baseHead);
			const outcomes = { "acc-1": { status: "passed" as const, summary: "941 pass" } };
			const facts = captureReviewFacts(root, { taskId: "outcome-task", baseHead, scopeHint: scope, expectedDiffHash: hash, outcomes });
			expect(facts.outcomes).toEqual({ "acc-1": { status: "passed", summary: "941 pass" } });
			// Defensive copy: mutating the caller's map after capture must not alter the captured facts.
			outcomes["acc-1"] = { status: "failed", summary: "tampered" };
			expect(facts.outcomes["acc-1"]).toEqual({ status: "passed", summary: "941 pass" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("capture without outcomes fails closed", () => {
		const root = repo();
		try {
			const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
			writeFileSync(join(root, "tracked.ts"), "export const value = 'captured';\n");
			execFileSync("git", ["add", "tracked.ts"], { cwd: root });
			const hash = taskRevisionDiffHash(root, ["tracked.ts"], baseHead);
			expect(() => captureReviewFacts(root, { taskId: "outcome-task", baseHead, scopeHint: ["tracked.ts"], expectedDiffHash: hash, outcomes: undefined as never }))
				.toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reserved Review prompt states QA/Review division of labor", () => {
		const outcomes = { "acc-1": { status: "passed" as const, summary: "941 pass" } };
		const prompt = buildReviewPrompt(snapshot(), { beyond_estimate: [], outside_routine_allowlist: [], outcomes });
		expect(prompt).toContain("verified deterministically by the Kernel QA layer");
		expect(prompt).toContain("stated in the brief as settled QA outcomes");
		expect(prompt).toContain(`Settled QA outcomes (deterministic, already run; do not rerun them): ${JSON.stringify(outcomes)}`);
		expect(prompt).toContain("do not re-execute descriptors");
		expect(prompt).toContain("do not treat the absence of local test runs as a finding");
		expect(prompt).toContain("Read only the immutable Review revision identified in the brief, through read-only Git commands");
		expect(prompt).toContain("Focus on correctness, regressions, security, and missing tests");
		expect(prompt).not.toContain("bundle dirty_files");
		expect(prompt).not.toContain("manifest");
	});

	test("Review turn budget scales with workload", () => {
		expect(reviewTurnBudget("quick")).toBe(12);
		expect(reviewTurnBudget("standard")).toBe(16);
		expect(reviewTurnBudget("heavy")).toBe(24);
	});

	test("Review workload counts changed paths, so a wide change gets the heavy budget", () => {
		const manifest = (count: number) => ({ changed_paths: Array.from({ length: count }, (_, i) => `src/file-${i}.ts`), outcomes: {} });
		const acceptance = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `AC${i + 1}`, assertion: "holds", verification: "{}" }));
		const material = { risk: "material", acceptance: acceptance(3) };
		expect(classifyReviewWorkload(material, manifest(12))).toBe("heavy");
		expect(classifyReviewWorkload(material, manifest(11))).toBe("standard");
		// The other heavy and quick rules are unchanged.
		expect(classifyReviewWorkload({ risk: "critical", acceptance: acceptance(1) }, manifest(1))).toBe("heavy");
		expect(classifyReviewWorkload({ risk: "material", acceptance: acceptance(9) }, manifest(1))).toBe("heavy");
		expect(classifyReviewWorkload({ risk: "routine", acceptance: acceptance(3) }, manifest(5))).toBe("quick");
		expect(classifyReviewWorkload({ risk: "routine", acceptance: acceptance(3) }, manifest(6))).toBe("standard");
		expect(classifyReviewWorkload({ risk: "routine", acceptance: acceptance(4) }, manifest(1))).toBe("standard");
	});

	test("Heavy Review turn budget grows with changed paths between 24 and 48", () => {
		const acceptance = Array.from({ length: 3 }, (_, i) => ({ id: `AC${i + 1}`, assertion: "holds", verification: "{}" }));
		const budget = (count: number, risk = "material") => {
			const facts = { changed_paths: Array.from({ length: count }, (_, i) => `src/file-${i}.ts`), outcomes: {} };
			const workload = classifyReviewWorkload({ risk, acceptance } as never, facts);
			return reviewTurnBudget(workload, facts.changed_paths.length);
		};
		expect(budget(12)).toBe(24);
		expect(budget(29)).toBe(41);
		expect(budget(36)).toBe(48);
		expect(budget(80)).toBe(48);
		expect(budget(1, "critical")).toBe(24);
		// Quick and standard budgets stay flat whatever the path count.
		expect(reviewTurnBudget("quick", 40)).toBe(12);
		expect(reviewTurnBudget("standard", 40)).toBe(16);
	});

	test("Review brief binds the immutable revision and verdict shapes", () => {
		const facts = { beyond_estimate: ["docs/extra.md"], outside_routine_allowlist: [], outcomes: {} };
		const prompt = buildReviewBrief(snapshot(), facts);
		expect(prompt).toContain(`git diff ${"1".repeat(40)} ${"2".repeat(40)}`);
		expect(prompt).toContain("Delivered paths outside the TaskIntent estimate: docs/extra.md.");
		expect(prompt).not.toContain("Delivered paths that keep the routine declaration from standing");
		expect(() => buildReviewBrief(snapshot({ review_revision: undefined }), facts)).toThrow("Review requires an immutable review revision");
		expect(prompt).toContain('"decision":"pass"');
		expect(prompt).toContain('"decision":"rework"');
		expect(prompt).toContain('"decision":"incomplete"');
		expect(prompt).toContain("REWORK verdicts must omit the approval field entirely");
	});
});
