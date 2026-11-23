// The e2e escape rule (Spec e2e-release-gate D9, S8-AC2): a `fix` pull request that changes
// plugin runtime fails unless it changes tests/e2e/ or states `e2e-exempt: <reason>`.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateEscapeRule, run } from "../scripts/check-e2e-escape-rule";

const RUNTIME = "plugins/immune-brain/runtime/v4_runtime.ts";

describe("evaluateEscapeRule", () => {
	test("a fix PR changing plugin runtime without a tests/e2e/ change fails", () => {
		const decision = evaluateEscapeRule({ title: "fix: stop parking a Lane", body: "Fixes the park.", changedPaths: [RUNTIME, "tests/batch.test.ts"] });
		expect(decision).toEqual({ ok: false, reason: "e2e_required", runtimePaths: [RUNTIME] });
	});

	test("the same PR passes when it changes tests/e2e/", () => {
		const decision = evaluateEscapeRule({ title: "fix: stop parking a Lane", body: "", changedPaths: [RUNTIME, "tests/e2e/batch.e2e.ts"] });
		expect(decision).toEqual({ ok: true, reason: "e2e_changed" });
	});

	test("the same PR passes with an e2e-exempt body line that gives a reason", () => {
		const decision = evaluateEscapeRule({ title: "fix(runtime): typo", body: "Summary\n\ne2e-exempt: log wording only, no Host-observable behavior\n", changedPaths: [RUNTIME] });
		expect(decision).toEqual({ ok: true, reason: "exempt", exemptReason: "log wording only, no Host-observable behavior" });
	});

	test("e2e-exempt with an empty reason fails", () => {
		for (const body of ["e2e-exempt:", "e2e-exempt:   \n", "text\ne2e-exempt:\nmore text"]) {
			const decision = evaluateEscapeRule({ title: "fix!: drop a flag", body, changedPaths: [RUNTIME] });
			expect(decision).toEqual({ ok: false, reason: "exempt_reason_empty", runtimePaths: [RUNTIME] });
		}
	});

	test("a non-fix title passes even when plugin runtime changes", () => {
		for (const title of ["feat: add a journey", "chore: bump", "fixture: rename", "Refactor the fix queue"]) {
			expect(evaluateEscapeRule({ title, body: null, changedPaths: [RUNTIME] })).toEqual({ ok: true, reason: "not_fix_title" });
		}
	});

	test("a fix PR only fails for runtime, .pi-extension and hooks paths", () => {
		for (const path of ["plugins/immune-brain/.pi-extension/index.ts", "plugins/immune-brain/hooks/stop.sh"]) {
			expect(evaluateEscapeRule({ title: "fix: x", body: "", changedPaths: [path] }).ok).toBe(false);
		}
		expect(evaluateEscapeRule({ title: "fix: x", body: "", changedPaths: ["docs/guide.md", "plugins/immune-brain/skills/drive/SKILL.md"] })).toEqual({ ok: true, reason: "no_runtime_change" });
	});
});

describe("run", () => {
	const dir = mkdtempSync(join(tmpdir(), "imm-escape-rule-"));
	const event = (pullRequest: Record<string, unknown>): string => {
		const path = join(dir, `event-${Math.random().toString(36).slice(2)}.json`);
		writeFileSync(path, JSON.stringify({ pull_request: { base: { sha: "base1" }, head: { sha: "head1" }, ...pullRequest } }));
		return path;
	};

	test("a pull_request event diffs base...head and exits 1 for an unexempted fix", () => {
		const calls: string[][] = [];
		const lines: string[] = [];
		const code = run({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event({ title: "fix: x", body: null }) }, (args) => (calls.push(args), `${RUNTIME}\n`), (line) => lines.push(line));
		expect(code).toBe(1);
		expect(calls).toEqual([["diff", "--name-only", "base1...head1"]]);
		expect(lines.join("\n")).toContain(RUNTIME);
		expect(lines.join("\n")).toContain("e2e-exempt: <reason>");
	});

	test("a pull_request event passes when the diff includes tests/e2e/", () => {
		const code = run({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event({ title: "fix: x", body: "" }) }, () => `${RUNTIME}\ntests/e2e/skew.e2e.ts\n`, () => {});
		expect(code).toBe(0);
	});

	test("a non-pull_request event skips without reading the event or git", () => {
		const code = run({ GITHUB_EVENT_NAME: "push" }, () => { throw new Error("git must not run"); }, () => {});
		expect(code).toBe(0);
	});

	test("a pull_request event without shas fails closed", () => {
		const path = join(dir, "no-sha.json");
		writeFileSync(path, JSON.stringify({ pull_request: { title: "fix: x" } }));
		expect(run({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: path }, () => "", () => {})).toBe(2);
	});

	afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
