import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	captureReviewBundle,
	verifyReviewBundle,
} from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";
import { buildReviewPrompt, reviewTurnBudget, type SnapshotDescriptor } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import { AssuranceProgression } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import { reviewIncompleteFixture } from "./fixtures/review-incomplete-fixture";
import { classifyReviewWorkload, reviewChangedPathCount } from "../plugins/immune-brain/runtime/assurance/coordinator.ts";
import { taskDiffHash } from "../plugins/immune-brain/runtime/workspace_scope.ts";

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
		review_bundle_digest: "sha256:" + "e".repeat(64),
		root: "/tmp",
		...overrides,
	};
}

describe("review contract outcome evidence", () => {
	test("Pi observed incomplete receipt reaches the non-verdict path and is bound to reason and paths", async () => {
		const f = reviewIncompleteFixture();
		try {
			const c = new AssuranceProgression(f.ports);
			const ready = await c.advance(f.taskId, f.ctx);
			expect(ready.state).toBe("review_ready");
			const params = (ready as { agent_params: { prompt: string; subagent_type: string } }).agent_params;
			c.piReviewHost.observeReviewDispatch(params, "pi-review-incomplete");
			const s = await f.snapshot(c), outcome = f.incomplete(s);
			c.piReviewHost.observeReviewResult("pi-review-incomplete", JSON.stringify(outcome));
			for (const override of [{ reason: "different reason" }, { inspected_paths: [f.paths[0]] }])
				expect(await c.submitMediated(f.taskId, f.ctx, { ...outcome, ...override })).toMatchObject({ state: "blocked", reason: "parent verdict does not match reviewer receipt" });
			expect(await c.submitMediated(f.taskId, f.ctx, undefined)).toEqual({ state: "blocked", reason: "review_incomplete_retry", recovery_action: "advance_assurance" });
			expect(f.record().record!.findings).toEqual([]);
			expect(f.record().record!.history.filter(e => e.type === "record_review_incomplete")).toHaveLength(1);
			expect(c.active(f.taskId)).toBeNull();
			expect((await c.advance(f.taskId, f.ctx)).state).toBe("review_ready");
		} finally { f.cleanup(); }
	}, 60_000);
	test("bundle v4 embeds per-acceptance outcomes and freezes them against later mutation", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "tracked.ts"), "export const value = 'captured';\n");
			execFileSync("git", ["add", "tracked.ts"], { cwd: root });
			const scope = ["tracked.ts"];
			const hash = taskDiffHash(root, scope);
			const outcomes = { "acc-1": { status: "passed" as const, summary: "941 pass" } };
			const bundle = captureReviewBundle(root, scope, hash, outcomes);
			expect(bundle.contract).toBe("assurance_kernel/review_bundle/v4");
			expect(bundle.outcomes).toEqual({ "acc-1": { status: "passed", summary: "941 pass" } });
			// Defensive copy: mutating the caller's map after capture must not alter the frozen bundle.
			outcomes["acc-1"] = { status: "failed", summary: "tampered" };
			expect(bundle.outcomes["acc-1"]).toEqual({ status: "passed", summary: "941 pass" });
			// Digest covers the outcome record; tampering it invalidates the bundle.
			const tampered = structuredClone(bundle);
			tampered.outcomes["acc-1"].status = "failed";
			expect(() => verifyReviewBundle(tampered)).toThrow(/digest mismatch/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("capture without outcomes fails closed", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "tracked.ts"), "export const value = 'captured';\n");
			execFileSync("git", ["add", "tracked.ts"], { cwd: root });
			const hash = taskDiffHash(root, ["tracked.ts"]);
			expect(() => captureReviewBundle(root, ["tracked.ts"], hash, undefined as never))
				.toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reserved Review prompt states QA/Review division of labor", () => {
		const prompt = buildReviewPrompt(snapshot());
		expect(prompt).toContain("verified deterministically by the Kernel QA layer");
		expect(prompt).toContain("embedded in this bundle under outcomes");
		expect(prompt).toContain("do not re-execute descriptors");
		expect(prompt).toContain("do not treat the absence of local test runs as a finding");
		expect(prompt).toContain("Analyze code exclusively from those bundle bytes");
		expect(prompt).toContain("Review authority is bound only to the bundle dirty_files current_content bytes");
		expect(prompt).toContain("Focus on correctness, regressions, security, and missing tests");
	});

	test("Review turn budget scales with workload", () => {
		expect(reviewTurnBudget("quick")).toBe(12);
		expect(reviewTurnBudget("standard")).toBe(16);
		expect(reviewTurnBudget("heavy")).toBe(24);
	});

	test("Review workload counts changed paths, so a wide change gets the heavy budget", () => {
		const entry = { status: "modified", mode: "100644", oid: "e".repeat(40), base_mode: "100644", base_oid: "f".repeat(40) };
		const paths = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`src/file-${i}.ts`, entry]));
		const manifest = (count: number) => ({ changed_paths: paths(count) }) as never;
		const bundle = (count: number) => ({ dirty_files: paths(count) }) as never;
		const acceptance = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `AC${i + 1}`, assertion: "holds", verification: "{}" }));
		const material = { risk: "material", acceptance: acceptance(3) };
		expect(classifyReviewWorkload(material, manifest(12))).toBe("heavy");
		expect(classifyReviewWorkload(material, bundle(12))).toBe("heavy");
		expect(classifyReviewWorkload(material, manifest(11))).toBe("standard");
		expect(classifyReviewWorkload(material, bundle(11))).toBe("standard");
		// The other heavy and quick rules are unchanged.
		expect(classifyReviewWorkload({ risk: "critical", acceptance: acceptance(1) }, manifest(1))).toBe("heavy");
		expect(classifyReviewWorkload({ risk: "material", acceptance: acceptance(9) }, manifest(1))).toBe("heavy");
		expect(classifyReviewWorkload({ risk: "routine", acceptance: acceptance(3) }, manifest(5))).toBe("quick");
		expect(classifyReviewWorkload({ risk: "routine", acceptance: acceptance(3) }, manifest(6))).toBe("standard");
		expect(classifyReviewWorkload({ risk: "routine", acceptance: acceptance(4) }, manifest(1))).toBe("standard");
	});

	test("Heavy Review turn budget grows with changed paths between 24 and 48", () => {
		const entry = { status: "modified", mode: "100644", oid: "e".repeat(40), base_mode: "100644", base_oid: "f".repeat(40) };
		const paths = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`src/file-${i}.ts`, entry]));
		const acceptance = Array.from({ length: 3 }, (_, i) => ({ id: `AC${i + 1}`, assertion: "holds", verification: "{}" }));
		const budget = (evidence: never, risk = "material") => {
			const workload = classifyReviewWorkload({ risk, acceptance } as never, evidence);
			return reviewTurnBudget(workload, reviewChangedPathCount(evidence));
		};
		for (const shape of [(n: number) => ({ changed_paths: paths(n) }) as never, (n: number) => ({ dirty_files: paths(n) }) as never]) {
			expect(budget(shape(12))).toBe(24);
			expect(budget(shape(29))).toBe(41);
			expect(budget(shape(36))).toBe(48);
			expect(budget(shape(80))).toBe(48);
			expect(budget(shape(1), "critical")).toBe(24);
		}
		// Quick and standard budgets stay flat whatever the path count.
		expect(reviewTurnBudget("quick", 40)).toBe(12);
		expect(reviewTurnBudget("standard", 40)).toBe(16);
	});

	test("Review prompt still binds the immutable bundle digest and verdict shapes", () => {
		const digest = "sha256:" + "e".repeat(64);
		const prompt = buildReviewPrompt(snapshot({ review_bundle_digest: digest }));
		expect(prompt).toContain(`review bundle ${digest}`);
		expect(prompt).toContain('"decision":"pass"');
		expect(prompt).toContain('"decision":"rework"');
		expect(prompt).toContain("Reserve the final turn for exactly one strict JSON verdict");
	});
});
