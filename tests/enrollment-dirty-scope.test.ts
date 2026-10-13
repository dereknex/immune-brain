import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureReviewManifest } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { enrollCanaryTask, enrollmentScopeDisclosure, runEnrollmentRehearsal } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import {
	captureGitTaskRevisionSnapshot,
	captureGitTaskSnapshot,
	dirtyScopePaths,
	taskRevisionDiffHash,
	writeEnrollmentBaseline,
} from "../plugins/immune-brain/runtime/workspace_scope";

const NOW = "2026-08-12T00:00:00.000Z";
const TASK = "dirty-scope-task";
const SCOPE = ["src"];

function git(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A committed repository holding the task's TaskIntent, one in-scope file and one out-of-scope file. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "enrollment-dirty-scope-"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test"]);
	git(root, ["config", "core.hooksPath", "/dev/null"]);
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		`${JSON.stringify({
			contract: "assurance_kernel/task_intent/v1",
			task_id: TASK,
			owner: "user",
			goal: "goal",
			acceptance: [{ id: "acc-1", assertion: "a", verification: "bun test" }],
			scope_hint: SCOPE,
			risk: "routine",
			revision: 1,
		}, null, 2)}\n`,
	);
	writeFileSync(join(root, "src", "task.ts"), "export const task = 'base';\n");
	writeFileSync(join(root, "outside.ts"), "export const outside = 'base';\n");
	git(root, ["add", "-A"]);
	git(root, ["commit", "-qm", "fixture"]);
	return root;
}

function bindingFor(root: string): EnrollmentCapabilityBinding {
	const prep = preparePiCanary(root, { task_id: TASK, now: NOW });
	return {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: prep.intent?.content_hash ?? "sha256:any",
		preparation_digest: prep.digest,
		actor_id: "user",
		confirmation_ref: "pi-confirm-001",
		nonce: "nonce-001",
	};
}

function enroll(root: string) {
	const registry = createEnrollmentAuthorityRegistry();
	const binding = bindingFor(root);
	const capability = registry.issue(binding);
	const input = {
		task_id: TASK,
		intent_path: binding.intent_path,
		intent_revision: 1,
		preparation_digest: binding.preparation_digest,
		capability,
		capability_binding: binding,
		now: NOW,
	};
	return { registry, capability, input };
}

function dirtyScope(root: string, kind: "staged" | "modified" | "untracked" | "deleted" | "renamed-out"): string {
	if (kind === "deleted") {
		git(root, ["rm", "-q", "src/task.ts"]);
		return "src/task.ts";
	}
	if (kind === "renamed-out") {
		// A staged rename to an out-of-scope destination: with rename detection
		// only moved/task.ts would be listed and the in-scope deletion hidden.
		mkdirSync(join(root, "moved"), { recursive: true });
		git(root, ["mv", "src/task.ts", "moved/task.ts"]);
		return "src/task.ts";
	}
	if (kind === "untracked") {
		writeFileSync(join(root, "src", "new.ts"), "export const added = true;\n");
		return "src/new.ts";
	}
	writeFileSync(join(root, "src", "task.ts"), "export const task = 'early';\n");
	if (kind === "staged") git(root, ["add", "src/task.ts"]);
	return "src/task.ts";
}

// Spec host-owned-environment D8: the gate lists in-scope dirt and the listed
// paths become task work. Dirt the confirmed gate did not list still refuses.
describe("Enrollment refuses in-scope dirt the gate did not list", () => {
	for (const kind of ["staged", "modified", "untracked", "deleted", "renamed-out"] as const) {
		test(`a ${kind} in-scope path blocks Enrollment before any authority is spent`, () => {
			const root = repo();
			try {
				const path = dirtyScope(root, kind);
				expect(dirtyScopePaths(root, SCOPE, TASK)).toEqual([path]);

				const { registry, capability, input } = enroll(root);
				const rehearsal = runEnrollmentRehearsal(root, input, capability, registry);
				expect(rehearsal.evidence.outcome).toBe("not_ready");
				expect(rehearsal.evidence.blockers.join("\n")).toContain(`task scope is already dirty before Enrollment: ${path}`);

				expect(() => enrollCanaryTask(root, input, registry)).toThrow(
					new RegExp(`task scope is already dirty before Enrollment: ${path.replace(".", "\\.")}`),
				);
				expect(registry.isConsumed(capability)).toBe(false);
				expect(readTaskRecordRaw(root, TASK).record).toBeNull();
				expect(readBackendClaim(root)).toBeNull();
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}

	test("out-of-scope dirt, the task's own sidecar and audit attachments do not block", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "outside.ts"), "export const outside = 'dirty';\n");
			writeFileSync(join(root, "scratch.txt"), "notes\n");
			mkdirSync(join(root, ".imm/audit/other-task"), { recursive: true });
			writeFileSync(join(root, ".imm/audit/other-task/terminal-proof.json"), "{}\n");
			// The own sidecar and an audit attachment stay exempt even when the
			// scope would otherwise match them.
			expect(dirtyScopePaths(root, SCOPE, TASK)).toEqual([]);
			expect(dirtyScopePaths(root, [".imm/audit", "docs/plans"], "unlisted-task")).toEqual([]);
			writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), "{}\n");
			expect(dirtyScopePaths(root, ["docs/plans"], TASK)).toEqual([]);
			expect(dirtyScopePaths(root, ["docs/plans"], "other-task")).toEqual([`docs/plans/${TASK}.intent.json`]);
			git(root, ["checkout", "--", `docs/plans/${TASK}.intent.json`]);

			const { registry, capability, input } = enroll(root);
			expect(runEnrollmentRehearsal(root, input, capability, registry).evidence.outcome).toBe("ready");
			const result = enrollCanaryTask(root, input, registry);
			expect(result.record).toMatchObject({ task_id: TASK, lifecycle: "active" });
			expect(registry.isConsumed(capability)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("Enrollment claims the in-scope changes its gate listed", () => {
	for (const kind of ["staged", "modified", "untracked", "deleted"] as const) {
		test(`a listed ${kind} in-scope path enrolls and is in the first snapshot`, () => {
			const root = repo();
			try {
				const baseHead = git(root, ["rev-parse", "HEAD"]);
				const path = dirtyScope(root, kind);
				writeFileSync(join(root, "outside.ts"), "export const outside = 'dirty';\n");
				const disclosure = enrollmentScopeDisclosure(root, TASK);
				expect(disclosure.paths).toEqual([path]);
				expect(disclosure.notice).toBe(
					`In-scope changes that already exist (1) and become task work on confirmation: ${path}`,
				);

				const { registry, capability, input } = enroll(root);
				const listed = { ...input, disclosed_scope_paths: disclosure.paths };
				const rehearsal = runEnrollmentRehearsal(root, listed, capability, registry);
				expect(rehearsal.evidence).toMatchObject({ outcome: "ready", claimed_scope_paths: [path] });
				expect(enrollCanaryTask(root, listed, registry).record).toMatchObject({ task_id: TASK, lifecycle: "active" });
				expect(registry.isConsumed(capability)).toBe(true);

				// The claimed path is left out of the baseline; out-of-scope dirt stays in it.
				const baseline = JSON.parse(readFileSync(join(root, ".imm/state/enrollment-baseline.json"), "utf8"));
				expect(Object.keys(baseline.dirty_files)).toContain("outside.ts");
				expect(Object.keys(baseline.dirty_files)).not.toContain(path);

				// `git rm` already staged the deletion and left no `src` to add.
				if (kind !== "deleted") git(root, ["add", "-A", "--", "src"]);
				expect(Object.keys(captureGitTaskRevisionSnapshot(root, SCOPE, baseHead, TASK).changed_paths)).toEqual([path]);
				expect(Object.keys(captureGitTaskSnapshot(root, SCOPE, TASK).staged_files)).toEqual([path]);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}

	test("a clean scope discloses nothing", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "outside.ts"), "export const outside = 'dirty';\n");
			expect(enrollmentScopeDisclosure(root, TASK)).toEqual({ paths: [], notice: null });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a path dirtied after the gate text was built is not claimed", () => {
		const root = repo();
		try {
			dirtyScope(root, "staged");
			const disclosure = enrollmentScopeDisclosure(root, TASK);
			expect(disclosure.paths).toEqual(["src/task.ts"]);
			// Dirtied between building the gate text and the confirmed Enrollment.
			dirtyScope(root, "untracked");

			const { registry, capability, input } = enroll(root);
			const listed = { ...input, disclosed_scope_paths: disclosure.paths };
			expect(runEnrollmentRehearsal(root, listed, capability, registry).evidence).toMatchObject({
				outcome: "not_ready",
				claimed_scope_paths: [],
			});
			expect(() => enrollCanaryTask(root, listed, registry)).toThrow(
				/task scope is already dirty before Enrollment: src\/new\.ts; the confirmed Enrollment gate did not list these paths/,
			);
			expect(registry.isConsumed(capability)).toBe(false);
			expect(readTaskRecordRaw(root, TASK).record).toBeNull();
			expect(readBackendClaim(root)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("task-path derivation fails closed on pre-Enrollment scope changes", () => {
	test("a staged in-scope path equal to the baseline stops both derivations", () => {
		const root = repo();
		try {
			const baseHead = git(root, ["rev-parse", "HEAD"]);
			writeFileSync(join(root, "src", "task.ts"), "export const task = 'early';\n");
			git(root, ["add", "src/task.ts"]);
			// A baseline written over a dirty scope: what an Enrollment that
			// predates the dirty-scope refusal left behind.
			writeEnrollmentBaseline(root);

			const refusal = /staged changes that predate Enrollment and cannot become task work: src\/task\.ts/;
			expect(() => captureGitTaskSnapshot(root, SCOPE, TASK)).toThrow(refusal);
			expect(() => captureGitTaskRevisionSnapshot(root, SCOPE, baseHead, TASK)).toThrow(refusal);
			expect(() => taskRevisionDiffHash(root, SCOPE, baseHead)).toThrow(refusal);

			// Reverting and reapplying yields the same bytes and stays refused.
			git(root, ["checkout", "HEAD", "--", "src/task.ts"]);
			writeFileSync(join(root, "src", "task.ts"), "export const task = 'early';\n");
			git(root, ["add", "src/task.ts"]);
			expect(() => captureGitTaskRevisionSnapshot(root, SCOPE, baseHead, TASK)).toThrow(refusal);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("the task's own staged sidecar inside the scope enrolls and passes both derivations; another task's does not", () => {
		const root = repo();
		try {
			const baseHead = git(root, ["rev-parse", "HEAD"]);
			const scope = ["docs/plans"];
			const own = `docs/plans/${TASK}.intent.json`;
			const other = "docs/plans/other-task.intent.json";
			const intent = JSON.parse(readFileSync(join(root, own), "utf8"));
			writeFileSync(join(root, own), `${JSON.stringify({ ...intent, scope_hint: scope }, null, 2)}\n`);
			git(root, ["add", own]);

			// Staged but uncommitted at Enrollment: exempt from the refusal.
			expect(dirtyScopePaths(root, scope, TASK)).toEqual([]);
			const { registry, input } = enroll(root);
			expect(enrollCanaryTask(root, input, registry).record).toMatchObject({ task_id: TASK, lifecycle: "active" });

			// The baseline holds the sidecar, yet neither derivation hard-stops on it.
			expect(Object.keys(captureGitTaskSnapshot(root, scope, TASK).staged_files)).toEqual([own]);
			expect(Object.keys(captureGitTaskRevisionSnapshot(root, scope, baseHead, TASK).changed_paths)).toEqual([own]);
			expect(() => taskRevisionDiffHash(root, scope, baseHead, TASK)).not.toThrow();

			// The exemption is bound to the task id: a different task, or no
			// task id, still stops on the same baseline-equal path.
			const refusal = new RegExp(`staged changes that predate Enrollment and cannot become task work: ${own.replace(/\./g, "\\.")}`);
			expect(() => captureGitTaskSnapshot(root, scope, "other-task")).toThrow(refusal);
			expect(() => captureGitTaskRevisionSnapshot(root, scope, baseHead, "other-task")).toThrow(refusal);
			expect(() => taskRevisionDiffHash(root, scope, baseHead)).toThrow(refusal);

			// Another task's baseline-equal sidecar still stops this task.
			writeFileSync(join(root, other), "{}\n");
			git(root, ["add", other]);
			writeEnrollmentBaseline(root);
			const otherRefusal = /staged changes that predate Enrollment and cannot become task work: docs\/plans\/other-task\.intent\.json/;
			expect(() => captureGitTaskSnapshot(root, scope, TASK)).toThrow(otherRefusal);
			expect(() => captureGitTaskRevisionSnapshot(root, scope, baseHead, TASK)).toThrow(otherRefusal);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("work staged after a clean-scope baseline is task work; out-of-scope baseline dirt stays ignored", () => {
		const root = repo();
		try {
			const baseHead = git(root, ["rev-parse", "HEAD"]);
			writeFileSync(join(root, "outside.ts"), "export const outside = 'dirty';\n");
			writeEnrollmentBaseline(root);
			writeFileSync(join(root, "src", "task.ts"), "export const task = 'work';\n");
			git(root, ["add", "src/task.ts"]);

			expect(Object.keys(captureGitTaskSnapshot(root, SCOPE, TASK).staged_files)).toEqual(["src/task.ts"]);
			expect(Object.keys(captureGitTaskRevisionSnapshot(root, SCOPE, baseHead, TASK).changed_paths)).toEqual(["src/task.ts"]);
			// The user's out-of-scope dirt is untouched.
			expect(git(root, ["status", "--short", "--", "outside.ts"])).toBe("M outside.ts");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("Review revision publication", () => {
	function manifestInput(root: string, baseHead: string) {
		return {
			taskId: TASK,
			baseHead,
			scopeHint: SCOPE,
			expectedDiffHash: taskRevisionDiffHash(root, SCOPE, baseHead),
			intentRevision: 1,
			intentContentHash: `sha256:${"1".repeat(64)}`,
			recordRevision: `r:${"2".repeat(64)}`,
			workspaceRevision: `w:${"3".repeat(64)}`,
			lifecycle: "active",
			artifactState: "frozen",
			risk: "material",
			outcomes: { "acc-1": { status: "passed" as const, summary: "verified" } },
		};
	}

	test("refuses a revision that carries no task change and publishes no ref", () => {
		const root = repo();
		try {
			const baseHead = git(root, ["rev-parse", "HEAD"]);
			expect(() => captureReviewManifest(root, manifestInput(root, baseHead))).toThrow(
				/review revision carries no task change/,
			);
			expect(git(root, ["for-each-ref", "refs/immune-brain"])).toBe("");

			writeFileSync(join(root, "src", "task.ts"), "export const task = 'work';\n");
			git(root, ["add", "src/task.ts"]);
			const manifest = captureReviewManifest(root, manifestInput(root, baseHead));
			expect(Object.keys(manifest.changed_paths)).toEqual(["src/task.ts"]);
			expect(manifest.review_tree).not.toBe(git(root, ["rev-parse", `${baseHead}^{tree}`]));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
