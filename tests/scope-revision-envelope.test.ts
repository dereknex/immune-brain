// CT-S2-A1 (docs/specs/ceremony-trim-r647.spec.md D6, invariant I5): a scope
// revision is judged against the NEXT intent's scope while it is prepared. A
// changed path that only the next scope covers must reach the gate (breaking)
// or apply (compatible); since Spec branch-boundary-r2 D20/D23 a path outside
// both scopes is disclosed rather than refused, and a scope-only change is
// compatible; a failed preparation restores the staged sidecar.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeRuntime, type ToolMeta } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";

setDefaultTimeout(60_000);

const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };

function git(root: string, args: string[]): string {
	return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
		cwd: root,
		encoding: "utf8",
	});
}

function intentFor(taskId: string, scope: string[], revision = 1, verification = "bun test") {
	return {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: "exercise scope revision",
		acceptance: [{ id: "acc-1", assertion: "initial assertion", verification }],
		scope_hint: [`docs/plans/${taskId}.intent.json`, ...scope].sort(),
		risk: "routine",
		revision,
	};
}

function fixtureRoot(taskId: string, scope = ["src/mod/a.ts"]): { root: string; sidecar: string } {
	const root = mkdtempSync(join(tmpdir(), "scope-revision-envelope-"));
	const sidecar = `docs/plans/${taskId}.intent.json`;
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "src", "mod"), { recursive: true });
	writeFileSync(join(root, sidecar), `${JSON.stringify(intentFor(taskId, scope), null, 2)}\n`);
	writeFileSync(join(root, "src", "mod", "a.ts"), "export const a = 1;\n");
	mkdirSync(join(root, "src", "mod", "pkg"), { recursive: true });
	writeFileSync(join(root, "src", "mod", "pkg", "index.ts"), "export const pkg = 1;\n");
	git(root, ["init", "-q"]);
	git(root, ["add", "-A"]);
	git(root, ["commit", "-q", "-m", "fixture"]);
	return { root, sidecar };
}

function stage(root: string, path: string, body = "export const staged = 1;\n"): void {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), body);
	git(root, ["add", "--", path]);
}

async function enrolled(taskId: string, decision: "accept" | "decline" = "accept", scope?: string[]) {
	const fixture = fixtureRoot(taskId, scope);
	const gateCalls: string[] = [];
	let answer: "accept" | "decline" = "accept";
	const runtime = new ClaudeRuntime({
		cwd: fixture.root,
		env: ENV,
		interactive: true,
		permissionMode: "manual",
		requestConfirmation: async ({ operation }) => {
			gateCalls.push(operation);
			return { decision: answer, requestId: `nested-${operation}` };
		},
	});
	const meta = (toolCallId: string): ToolMeta => ({
		taskId,
		sessionId: "s",
		toolCallId,
		requiresUserInteraction: true,
		interactive: true,
		permissionMode: "manual",
	});
	await runtime.enroll(taskId, meta("enroll"));
	gateCalls.length = 0;
	answer = decision;
	return { ...fixture, runtime, meta, gateCalls };
}

const storedScope = (root: string, taskId: string) => readTaskRecordRaw(root, taskId).record?.intent_snapshot.scope_hint;

describe("claude host: a scope revision is judged against its next scope (D6, I5)", () => {
	test("breaking: a staged path covered only by the next scope reaches the gate and commits", async () => {
		const taskId = "envelope-breaking-next-scope";
		const { root, runtime, meta, gateCalls } = await enrolled(taskId);
		stage(root, "src/newdir/c.ts");
		const next = { ...intentFor(taskId, ["src/mod/a.ts", "src/newdir/c.ts"], 2), acceptance: [{ id: "acc-1", assertion: "revised assertion", verification: "bun test" }] };

		const result = await runtime.authorize(taskId, "approve_breaking_intent_revision", meta("approve"), { next_intent: next });

		expect(gateCalls).toEqual(["approve_breaking_intent_revision"]);
		expect(result.record.intent_snapshot.scope_hint).toEqual(next.scope_hint);
		expect(storedScope(root, taskId)).toEqual(next.scope_hint);
	});

	// Spec branch-boundary-r2 D20: a scope-only change keeping the bound Spec path
	// is compatible, so the breaking route refuses it before the gate port.
	test("breaking: a scope-only revision refuses before the gate port is called", async () => {
		const taskId = "envelope-breaking-outside-both";
		const { root, sidecar, runtime, meta, gateCalls } = await enrolled(taskId);
		stage(root, "src/newdir/c.ts");
		stage(root, "src/stray.ts");
		const before = readFileSync(join(root, sidecar), "utf8");
		const next = intentFor(taskId, ["src/mod/a.ts", "src/newdir/c.ts"], 2);

		await expect(
			runtime.authorize(taskId, "approve_breaking_intent_revision", meta("approve"), { next_intent: next }),
		).rejects.toThrow("approve_breaking_intent_revision requires a breaking revision");

		expect(gateCalls).toEqual([]);
		expect(readFileSync(join(root, sidecar), "utf8")).toBe(before);
		expect(git(root, ["show", `:${sidecar}`])).toBe(before);
		expect(storedScope(root, taskId)).toEqual(intentFor(taskId, ["src/mod/a.ts"]).scope_hint);
	});

	test("breaking: a declined gate restores the staged sidecar", async () => {
		const taskId = "envelope-breaking-declined";
		const { root, sidecar, runtime, meta, gateCalls } = await enrolled(taskId, "decline");
		stage(root, "src/newdir/c.ts");
		const before = readFileSync(join(root, sidecar), "utf8");
		const next = { ...intentFor(taskId, ["src/mod/a.ts", "src/newdir/c.ts"], 2), acceptance: [{ id: "acc-1", assertion: "revised assertion", verification: "bun test" }] };

		await expect(
			runtime.authorize(taskId, "approve_breaking_intent_revision", meta("approve"), { next_intent: next }),
		).rejects.toThrow();

		expect(gateCalls).toEqual(["approve_breaking_intent_revision"]);
		expect(readFileSync(join(root, sidecar), "utf8")).toBe(before);
		expect(git(root, ["show", `:${sidecar}`])).toBe(before);
		expect(storedScope(root, taskId)).toEqual(intentFor(taskId, ["src/mod/a.ts"]).scope_hint);
	});

	test("Enrollment and enrolled revisions do not apply the candidate scope cap", async () => {
		const taskId = "envelope-wide-scope";
		const scope = Array.from({ length: 16 }, (_, i) => `src/file-${i}.ts`);
		const { root, runtime, gateCalls } = await enrolled(taskId, "accept", scope);
		const next = intentFor(taskId, [...scope, "src/one-more.ts"], 2);
		await runtime.reviseIntent(taskId, next);
		expect(gateCalls).toEqual([]);
		expect(storedScope(root, taskId)).toEqual(next.scope_hint);
	});

	test("compatible: a staged sibling file covered only by the next scope applies without a gate", async () => {
		const taskId = "envelope-compatible-next-scope";
		const { root, runtime, gateCalls } = await enrolled(taskId);
		stage(root, "src/mod/b.ts");
		const next = intentFor(taskId, ["src/mod/a.ts", "src/mod/b.ts"], 2);

		const result = await runtime.reviseIntent(taskId, next);

		expect(gateCalls).toEqual([]);
		expect(result.record.intent_snapshot.scope_hint).toEqual(next.scope_hint);
		expect(storedScope(root, taskId)).toEqual(next.scope_hint);
	});

	// Spec branch-boundary-r2 D23: single-task delivery is the whole workspace
	// since Enrollment, so a path outside both scopes is disclosed, not refused.
	test("compatible: a staged path outside both scopes applies without a gate", async () => {
		const taskId = "envelope-compatible-outside-both";
		const { root, runtime, gateCalls } = await enrolled(taskId);
		stage(root, "src/mod/b.ts");
		stage(root, "src/stray.ts");
		const next = intentFor(taskId, ["src/mod/a.ts", "src/mod/b.ts"], 2);

		await runtime.reviseIntent(taskId, next);

		expect(gateCalls).toEqual([]);
		expect(storedScope(root, taskId)).toEqual(next.scope_hint);
	});
	test("compatible route accepts an added directory in the worktree (D20)", async () => {
		const taskId = "envelope-added-directory";
		const { root, runtime, gateCalls } = await enrolled(taskId);
		const next = intentFor(taskId, ["src/mod/a.ts", "src/mod/pkg"], 2);
		await runtime.reviseIntent(taskId, next);
		expect(gateCalls).toEqual([]);
		expect(storedScope(root, taskId)).toEqual(next.scope_hint);
	});

	test("compatible route accepts a sibling beside a directory entry (D20)", async () => {
		const taskId = "envelope-anchor-directory";
		const { root, runtime, gateCalls } = await enrolled(taskId, "accept", ["src/mod/pkg"]);
		stage(root, "src/mod/b.ts");
		const next = intentFor(taskId, ["src/mod/pkg", "src/mod/b.ts"], 2);
		await runtime.reviseIntent(taskId, next);
		expect(gateCalls).toEqual([]);
		expect(storedScope(root, taskId)).toEqual(next.scope_hint);
	});
});
