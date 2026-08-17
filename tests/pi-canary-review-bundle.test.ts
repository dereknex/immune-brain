import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	captureReviewBundle,
	verifyReviewBundle,
	writeNativeReviewEvidence,
} from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";
import { taskDiffHash } from "../plugins/immune-brain/runtime/workspace_scope.ts";

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "canary-review-root-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	writeFileSync(join(root, "tracked.ts"), "export const value = 'base';\n");
	execFileSync("git", ["add", "tracked.ts"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	return root;
}

describe("native canary review evidence", () => {
	test("locks staged task bytes and immutable HEAD object identities", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "tracked.ts"), "export const value = 'captured';\n");
			writeFileSync(join(root, "new.ts"), "export const added = 'captured';\n");
			execFileSync("git", ["add", "tracked.ts", "new.ts"], { cwd: root });
			const scope = ["new.ts", "tracked.ts"];
			const hash = taskDiffHash(root, scope);
			const bundle = captureReviewBundle(root, scope, hash, { "acc-1": { status: "passed", summary: "suite ok" } });
			expect(bundle.contract).toBe("assurance_kernel/review_bundle/v4");
			expect(bundle.scope).toEqual(scope);
			expect(bundle.diff_hash).toBe(hash);
			expect(bundle.bundle_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
			expect(bundle.outcomes).toEqual({ "acc-1": { status: "passed", summary: "suite ok" } });
			expect(bundle.dirty_files["tracked.ts"].current_content).toContain("captured");
			expect(bundle.dirty_files["tracked.ts"].oid).toMatch(/^[a-f0-9]{40,64}$/);
			expect(bundle.dirty_files["tracked.ts"].base_oid).toMatch(/^[a-f0-9]{40,64}$/);
			expect(bundle.dirty_files["tracked.ts"]).not.toHaveProperty("base_content");
			expect(bundle.dirty_files["new.ts"].current_content).toContain("captured");
			expect(bundle.dirty_files["new.ts"].base_oid).toBeNull();

			writeFileSync(join(root, "tracked.ts"), "export const value = 'mutated later';\n");
			rmSync(join(root, ".git"), { recursive: true, force: true });
			expect(bundle.dirty_files["tracked.ts"].current_content).toContain("captured");
			expect(bundle.dirty_files["tracked.ts"].base_oid).toMatch(/^[a-f0-9]{40,64}$/);
			const tampered = structuredClone(bundle);
			tampered.dirty_files["tracked.ts"].current_content = "tampered";
			expect(() => verifyReviewBundle(tampered)).toThrow(/digest mismatch/i);

			const outcomeTampered = structuredClone(bundle);
			outcomeTampered.outcomes["acc-1"].status = "failed";
			expect(() => verifyReviewBundle(outcomeTampered)).toThrow(/digest mismatch/i);
			expect(bundle.outcomes["acc-1"].status).toBe("passed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("rejects a bundle request whose workspace hash is not the assurance snapshot", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "tracked.ts"), "changed\n");
			execFileSync("git", ["add", "tracked.ts"], { cwd: root });
			expect(() => captureReviewBundle(root, ["tracked.ts"], "sha256:" + "0".repeat(64), {})).toThrow(/does not match/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("writes bounded session evidence outside the repository and removes it", () => {
		const evidence = writeNativeReviewEvidence({ contract: "test", secret: "locked" });
		try {
			expect(existsSync(evidence.path)).toBe(true);
			expect(JSON.parse(readFileSync(evidence.path, "utf8"))).toEqual({ contract: "test", secret: "locked" });
		} finally {
			evidence.remove();
		}
		expect(existsSync(evidence.path)).toBe(false);
	});
});
