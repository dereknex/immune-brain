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
		expect(prompt).toContain("review authority is bound only to the bundle dirty_files current_content bytes");
		expect(prompt).toContain("Focus on correctness, regressions, security, and missing tests");
	});

	test("Review turn budget scales with workload", () => {
		expect(reviewTurnBudget("quick")).toBe(12);
		expect(reviewTurnBudget("standard")).toBe(16);
		expect(reviewTurnBudget("heavy")).toBe(24);
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
