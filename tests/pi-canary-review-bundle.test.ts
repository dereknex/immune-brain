import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	captureReviewBundle,
	captureReviewManifest,
	listReviewRefs,
	reconcileReviewRefs,
	verifyReviewBundle,
	writeNativeReviewEvidence,
} from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";
import { captureGitTaskRevisionSnapshot, taskDiffHash, taskRevisionDiffHash } from "../plugins/immune-brain/runtime/workspace_scope.ts";

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "canary-review-root-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: root });
	writeFileSync(join(root, "tracked.ts"), "export const value = 'base';\n");
	execFileSync("git", ["add", "tracked.ts"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	return root;
}

function revisionRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "canary-review-revision-root-"));
	mkdirSync(join(root, "src"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: root });
	writeFileSync(join(root, "src", "unchanged.ts"), "export const unchanged = true;\n");
	writeFileSync(join(root, "src", "change.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
	return root;
}

function gitOutput(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
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

	test("writes canonical bounded session evidence outside the repository and removes it", () => {
		const evidence = writeNativeReviewEvidence({ contract: "test", secret: "locked" });
		try {
			expect(evidence.path).toBe(realpathSync(evidence.path));
			expect(statSync(evidence.path).mode & 0o777).toBe(0o644);
			expect(statSync(realpathSync(evidence.path.replace(/\/evidence\.json$/, ""))).mode & 0o777).toBe(0o755);
			expect(existsSync(evidence.path)).toBe(true);
			expect(JSON.parse(readFileSync(evidence.path, "utf8"))).toEqual({ contract: "test", secret: "locked" });
		} finally {
			evidence.remove();
		}
		expect(existsSync(evidence.path)).toBe(false);
	});

	test("v4 revision metadata is deterministic, scoped, and source-size independent", { timeout: 15000 }, () => {
		const root = revisionRepo();
		try {
			const baseHead = gitOutput(root, ["rev-parse", "HEAD"]);
			writeFileSync(join(root, "src", "change.ts"), "export const value = 2;\n");
			chmodSync(join(root, "src", "change.ts"), 0o755);
			rmSync(join(root, "src", "unchanged.ts"));
			symlinkSync("change.ts", join(root, "src", "link.ts"));
			writeFileSync(join(root, "src", "large.bin"), Buffer.alloc(3 * 1024 * 1024, 0xff));
			writeFileSync(join(root, "outside.txt"), "out of scope\n");
			execFileSync("git", ["add", "-A"], { cwd: root });

			const scope = ["src"];
			const diffHash = taskRevisionDiffHash(root, scope, baseHead);
			const snapshot = captureGitTaskRevisionSnapshot(root, scope, baseHead);
			expect(Object.hasOwn(snapshot.changed_paths, "src/change.ts")).toBe(true);
			expect(Object.hasOwn(snapshot.changed_paths, "src/large.bin")).toBe(true);
			expect(Object.hasOwn(snapshot.changed_paths, "outside.txt")).toBe(false);
			expect(Object.hasOwn(snapshot.changed_paths, "src/unchanged.ts")).toBe(true);
			expect(snapshot.changed_paths["src/change.ts"]?.mode).toBe("100755");
			expect(snapshot.changed_paths["src/unchanged.ts"]?.status).toBe("deleted");
			expect(snapshot.changed_paths["src/link.ts"]?.mode).toBe("120000");
			expect(diffHash).toBe(taskRevisionDiffHash(root, scope, baseHead));

			const input = {
				taskId: "revision-task",
				baseHead,
				scopeHint: scope,
				expectedDiffHash: diffHash,
				intentRevision: 1,
				intentContentHash: `sha256:${"1".repeat(64)}`,
				recordRevision: `r:${"2".repeat(64)}`,
				workspaceRevision: `w:${"3".repeat(64)}`,
				lifecycle: "active",
				artifactState: "frozen",
				risk: "material",
				outcomes: { A1: { status: "passed" as const, summary: "verified" } },
			};
			const manifest = captureReviewManifest(root, input);
			expect(manifest).toEqual(captureReviewManifest(root, input));
			expect(JSON.stringify(manifest)).not.toContain("current_content");
			expect(Object.hasOwn(manifest, "dirty_files")).toBe(false);
			expect(Object.hasOwn(manifest, "neighborhood_files")).toBe(false);
			expect(Object.hasOwn(manifest.changed_paths, "outside.txt")).toBe(false);
			expect(gitOutput(root, ["rev-parse", `${manifest.review_commit}^`])).toBe(baseHead);
			expect(gitOutput(root, ["rev-parse", `${manifest.review_commit}^{tree}`])).toBe(manifest.review_tree);
			expect(gitOutput(root, ["diff", "--name-only", "--no-renames", baseHead, manifest.review_commit]).split("\n").sort()).toEqual(["src/change.ts", "src/large.bin", "src/link.ts", "src/unchanged.ts"]);
			const invalidRefManifest = captureReviewManifest(root, { ...input, taskId: "revision..task." });
			expect(invalidRefManifest.review_ref).not.toContain("..");
			expect(listReviewRefs(root)).toEqual(expect.arrayContaining([{
				ref: invalidRefManifest.review_ref,
				commit: invalidRefManifest.review_commit,
				taskId: "revision..task.",
			}]));
			expect(manifest.manifest_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(listReviewRefs(root)).toHaveLength(2);
			expect(reconcileReviewRefs(root, new Set(["revision-task", "revision..task."])).removed).toEqual([]);
			expect(reconcileReviewRefs(root, new Set()).removed).toHaveLength(2);
			const limit = 2 * 1024 * 1024;
			const emptyManifest = captureReviewManifest(root, { ...input, outcomes: { A1: { status: "passed", summary: "" } } });
			const boundaryLength = limit - Buffer.byteLength(JSON.stringify(emptyManifest));
			expect(boundaryLength).toBeGreaterThan(0);
			const bounded = captureReviewManifest(root, { ...input, outcomes: { A1: { status: "passed", summary: "x".repeat(boundaryLength) } } });
			expect(Buffer.byteLength(JSON.stringify(bounded))).toBe(limit);
			expect(() => captureReviewManifest(root, { ...input, outcomes: { A1: { status: "passed", summary: "x".repeat(boundaryLength + 1) } } })).toThrow(/bounded output limit/);
			expect(listReviewRefs(root)).toHaveLength(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("v4 synthetic delta preserves NUL-delimited newline paths", () => {
		const root = revisionRepo();
		try {
			const baseHead = gitOutput(root, ["rev-parse", "HEAD"]);
			const path = "src/line\nbreak.ts";
			writeFileSync(join(root, path), "export const newlinePath = true;\n");
			execFileSync("git", ["add", "-A"], { cwd: root });
			const scope = ["src"];
			const diffHash = taskRevisionDiffHash(root, scope, baseHead);
			const input = {
				taskId: "newline-path-task",
				baseHead,
				scopeHint: scope,
				expectedDiffHash: diffHash,
				intentRevision: 1,
				intentContentHash: `sha256:${"1".repeat(64)}`,
				recordRevision: `r:${"2".repeat(64)}`,
				workspaceRevision: `w:${"3".repeat(64)}`,
				lifecycle: "active",
				artifactState: "frozen",
				risk: "material",
				outcomes: { A1: { status: "passed" as const, summary: "verified" } },
			};
			const manifest = captureReviewManifest(root, input);
			expect(manifest.changed_paths[path]).toBeDefined();
			expect(captureReviewManifest(root, input).review_commit).toBe(manifest.review_commit);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("v4 revision rejects worktree drift hidden by index flags", () => {
		const root = revisionRepo();
		try {
			const baseHead = gitOutput(root, ["rev-parse", "HEAD"]);
			for (const [flag, name] of [["--assume-unchanged", "assume-unchanged"], ["--skip-worktree", "skip-worktree"]] as const) {
				execFileSync("git", ["update-index", flag, "--", "src/change.ts"], { cwd: root });
				writeFileSync(join(root, "src", "change.ts"), `export const hiddenDrift = "${name}";\n`);
				expect(() => captureGitTaskRevisionSnapshot(root, ["src"], baseHead)).toThrow(new RegExp(name));
				execFileSync("git", ["update-index", "--no-assume-unchanged", "--no-skip-worktree", "--", "src/change.ts"], { cwd: root });
				writeFileSync(join(root, "src", "change.ts"), "export const value = 1;\n");
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("v4 revision ignores case-fold collisions outside the task scope", () => {
		const root = revisionRepo();
		try {
			const baseHead = gitOutput(root, ["rev-parse", "HEAD"]);
			const first = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "first\n", encoding: "utf8" }).trim();
			const second = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "second\n", encoding: "utf8" }).trim();
			execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${first},outside/Case.ts`], { cwd: root });
			execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${second},outside/case.ts`], { cwd: root });
			const snapshot = captureGitTaskRevisionSnapshot(root, ["src"], baseHead);
			expect(snapshot.changed_paths).toEqual({});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("v4 revision rejects rewritten Enrollment history", () => {
		const root = revisionRepo();
		try {
			const baseHead = gitOutput(root, ["rev-parse", "HEAD"]);
			execFileSync("git", ["checkout", "-q", "--orphan", "rewritten"], { cwd: root });
			execFileSync("git", ["rm", "-rf", "."], { cwd: root });
			writeFileSync(join(root, "replacement.txt"), "replacement\n");
			execFileSync("git", ["add", "-A"], { cwd: root });
			execFileSync("git", ["commit", "-qm", "rewritten"], { cwd: root });
			expect(() => captureGitTaskRevisionSnapshot(root, ["src"], "f".repeat(40))).toThrow(/unreadable|not a commit/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
