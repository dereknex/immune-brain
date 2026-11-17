import { SESSION_RESULT_SLOTS_RELATIVE } from "../plugins/immune-brain/runtime/kernel/storage_paths";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { packetDigest } from "../plugins/immune-brain/runtime/assurance/review_packet";
import {
	captureReviewFacts,
	createReviewPacketWriter,
	listReviewRefs,
	reconcileReviewRefs,
} from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";
import { captureGitTaskRevisionSnapshot, taskRevisionDiffHash } from "../plugins/immune-brain/runtime/workspace_scope.ts";

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
	test("rejects a Review revision request whose workspace hash is not the assurance snapshot", () => {
		const root = revisionRepo();
		try {
			const baseHead = gitOutput(root, ["rev-parse", "HEAD"]);
			writeFileSync(join(root, "src", "change.ts"), "changed\n");
			execFileSync("git", ["add", "src/change.ts"], { cwd: root });
			expect(() => captureReviewFacts(root, {
				taskId: "hash-task",
				baseHead,
				scopeHint: ["src"],
				expectedDiffHash: "sha256:" + "0".repeat(64),
				outcomes: {},
			})).toThrow(/does not match/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("writes in-process verifier packets lazily into an ignored slot under the task root and removes them", () => {
		const root = revisionRepo();
		const writer = createReviewPacketWriter(root);
		const packet = writer.writePacket("operation-1", "完整 review instructions\n");
		try {
			expect(packet.path.startsWith(join(root, SESSION_RESULT_SLOTS_RELATIVE) + "/")).toBe(true);
			expect(gitOutput(root, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
			expect(readFileSync(packet.path, "utf8")).toBe("完整 review instructions\n");
			expect(packet.path.endsWith("/review-packet-operation-1.md")).toBe(true);
			expect(packet.sha256).toBe(packetDigest(readFileSync(packet.path, "utf8")));
			expect(statSync(packet.path).mode & 0o777).toBe(0o644);
			expect(() => writer.writePacket("../escape", "no")).toThrow("invalid review packet name");
			expect(() => writer.writePacket("operation-1", "overwrite")).toThrow();
		} finally {
			writer.remove();
		}
		expect(existsSync(packet.path)).toBe(false);
		expect(existsSync(dirname(packet.path))).toBe(false);
		rmSync(root, { recursive: true, force: true });
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
			// Stage only the task's own scope: an out-of-scope path left as
			// worktree dirt stays available to the user but never enters the
			// delivery revision.
			execFileSync("git", ["add", "--", "src"], { cwd: root });

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
				outcomes: { A1: { status: "passed" as const, summary: "verified" } },
			};
			const facts = captureReviewFacts(root, input);
			const manifest = facts.revision;
			expect(manifest).toEqual(captureReviewFacts(root, input).revision);
			expect(manifest.contract).toBe("assurance_kernel/review_revision/v1");
			expect(Object.hasOwn(manifest, "manifest_digest")).toBe(false);
			expect(JSON.stringify(facts)).not.toContain("current_content");
			expect(facts.changed_paths).toEqual(["src/change.ts", "src/large.bin", "src/link.ts", "src/unchanged.ts"]);
			expect(facts.beyond_estimate).toEqual([]);
			expect(facts.outcomes).toEqual(input.outcomes);
			expect(facts.outcomes).not.toBe(input.outcomes);
			expect(gitOutput(root, ["rev-parse", `${manifest.review_commit}^`])).toBe(baseHead);
			expect(gitOutput(root, ["rev-parse", `${manifest.review_commit}^{tree}`])).toBe(manifest.review_tree);
			expect(gitOutput(root, ["diff", "--name-only", "--no-renames", baseHead, manifest.review_commit]).split("\n").sort()).toEqual(["src/change.ts", "src/large.bin", "src/link.ts", "src/unchanged.ts"]);
			const invalidRefManifest = captureReviewFacts(root, { ...input, taskId: "revision..task." }).revision;
			expect(invalidRefManifest.review_ref).not.toContain("..");
			expect(listReviewRefs(root)).toEqual(expect.arrayContaining([{
				ref: invalidRefManifest.review_ref,
				commit: invalidRefManifest.review_commit,
				taskId: "revision..task.",
			}]));
			expect(listReviewRefs(root)).toHaveLength(2);
			expect(reconcileReviewRefs(root, new Set(["revision-task", "revision..task."])).removed).toEqual([]);
			expect(reconcileReviewRefs(root, new Set()).removed).toHaveLength(2);
			captureReviewFacts(root, input);
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
				outcomes: { A1: { status: "passed" as const, summary: "verified" } },
			};
			const facts = captureReviewFacts(root, input);
			expect(facts.changed_paths).toContain(path);
			expect(captureReviewFacts(root, input).revision.review_commit).toBe(facts.revision.review_commit);
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

	test("v4 revision rejects staged escape including case-fold collisions outside the task scope", () => {
		const root = revisionRepo();
		try {
			const baseHead = gitOutput(root, ["rev-parse", "HEAD"]);
			const first = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "first\n", encoding: "utf8" }).trim();
			const second = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "second\n", encoding: "utf8" }).trim();
			execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${first},outside/Case.ts`], { cwd: root });
			execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${second},outside/case.ts`], { cwd: root });
			expect(() => captureGitTaskRevisionSnapshot(root, ["src"], baseHead)).toThrow(
				/outside the authorization envelope: outside\/Case\.ts, outside\/case\.ts/,
			);
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
