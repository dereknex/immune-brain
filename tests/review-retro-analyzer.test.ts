import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readSession, run } from "../plugins/immune-brain/skills/revisit/scripts/review_retro.ts";

const ROOT = resolve(import.meta.dir, "fixtures/review-retro");
const CONTRACT_ROOT = resolve(import.meta.dir, "fixtures/review-retro-contract");
const WIDE_WINDOW = { cutMs: 0, project: "", exclude: [] };

function turn(timestamp: unknown, call: { name: string; id: string; arguments?: unknown }, model = "m1"): string {
	return JSON.stringify({
		...(timestamp === undefined ? {} : { timestamp }),
		message: {
			role: "assistant",
			provider: "p",
			model,
			content: [{ type: "toolCall", arguments: {}, ...call }],
		},
	});
}

function sessionRoot(lines: string[]): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "review-retro-"));
	mkdirSync(join(root, "proj"));
	writeFileSync(join(root, "proj", "s.jsonl"), `${lines.join("\n")}\n`);
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("review-retro analyzer", () => {
	test("reports usage, rounds/task and finding totals without any model ranking", async () => {
		const out = await run(["7", "--root", ROOT]);
		expect(out).toContain("=== usage (sessions / turns / edits / tools) ===");
		expect(out).toMatch(/sessions: 2 \| turns: \d+ \| edits: 2/);
		expect(out).toMatch(/^\s+3\s+Agent$/m);
		expect(out).toMatch(/^\s+1\s+edit$/m);
		expect(out).toMatch(/^\s+1\s+write$/m);
		expect(out).toMatch(/^\s+1\s+bash$/m);
		// one registration for t1, one registration without a task_id (not a task)
		expect(out).toContain("1.0 rounds/task");
		expect(out).toMatch(/1 registrations \/\s+1 tasks/);
		expect(out).toMatch(/1 registrations without task_id/);
		// blocking: "real defect in auth"; advisory: "naming nit"; bookkeeping: "receipt recorded"
		expect(out).toContain("blocking: 1 | advisory: 1 | bookkeeping: 1");
		expect(out).toContain("caveats:");

		for (const gone of ["anthropic/claude-opus", "openai/gpt-5", "rev/100ed", "avgSc", "pass%", "REJECT", "highRisk"]) {
			expect(out).not.toContain(gone);
		}
		expect(out).not.toContain("project x author");
		expect(out).not.toContain("review quality");
	});

	test("reads assurance_verdict contracts: verdict findings deduped without a model key", async () => {
		const out = await run(["7", "--root", CONTRACT_ROOT]);
		expect(out).toContain("3.0 rounds/task");
		expect(out).toContain("blocking: 1 | advisory: 1 | bookkeeping: 0");
		expect(out).toContain("findings: 3 raw calls deduped to 2 distinct");
		expect(out).not.toContain("acme/coder");
	});

	test("--project keeps sessions whose cwd contains the substring", async () => {
		const out = await run(["7", "--root", ROOT, "--project", "immune-brain"]);
		expect(out).toMatch(/sessions: 1 /);
		expect(out).toContain("filters: project~immune-brain");
		expect(out).toContain("blocking: 0 | advisory: 1 | bookkeeping: 1");
	});

	test("--exclude drops matching sessions, repeats, and combines with --project", async () => {
		const one = await run(["7", "--root", ROOT, "--exclude", "other-app"]);
		expect(one).toMatch(/sessions: 1 /);
		expect(one).toContain("filters: exclude~other-app");
		expect(one).toContain("blocking: 0 | advisory: 1 | bookkeeping: 1");

		const both = await run(["7", "--root", ROOT, "--exclude", "other-app", "--exclude", "immune-brain"]);
		expect(both).toMatch(/sessions: 0 /);
		expect(both).toContain("filters: exclude~other-app, exclude~immune-brain");

		const combined = await run(["7", "--root", ROOT, "--project", "/", "--exclude", "other-app"]);
		expect(combined).toMatch(/sessions: 1 /);
		expect(combined).toContain("filters: project~/, exclude~other-app");
		const none = await run(["7", "--root", ROOT, "--project", "other-app", "--exclude", "other-app"]);
		expect(none).toMatch(/sessions: 0 /);
	});

	test("parses offset and numeric timestamps to epoch and counts missing or unparsable ones as skipped", async () => {
		const { root, cleanup } = sessionRoot([
			JSON.stringify({ type: "session", cwd: "/tmp/ts-app" }),
			turn("2099-01-01T09:00:00+09:00", { name: "offsetTool", id: "a" }),
			turn(4070908800000, { name: "numericTool", id: "b" }),
			turn(undefined, { name: "missingTool", id: "c" }),
			turn("not-a-date", { name: "garbageTool", id: "d" }),
			turn(0, { name: "ancientTool", id: "e" }),
		]);
		try {
			const out = await run(["7", "--root", root]);
			expect(out).toContain("skipped lines (no usable timestamp): 2");
			expect(out).toMatch(/sessions: 1 \| turns: 2 /);
			expect(out).toMatch(/^\s+1\s+offsetTool$/m);
			expect(out).toMatch(/^\s+1\s+numericTool$/m);
			for (const gone of ["missingTool", "garbageTool", "ancientTool"]) expect(out).not.toContain(gone);
		} finally {
			cleanup();
		}
	});

	test("session reader tags review and finding events with the last editor as author", async () => {
		const finding = { id: "f", kind: "advisory", summary: "nit" };
		const { root, cleanup } = sessionRoot([
			JSON.stringify({ type: "session", cwd: "/tmp/author-app" }),
			turn("2099-01-01T00:00:00Z", { name: "Agent", id: "r0", arguments: { subagent_type: "Review", prompt: "first" } }, "m0"),
			turn("2099-01-01T00:00:01Z", { name: "edit", id: "e1" }, "m1"),
			turn("2099-01-01T00:00:02Z", { name: "apply_patch", id: "e2" }, "m2"),
			turn("2099-01-01T00:00:03Z", { name: "Agent", id: "r1", arguments: { subagent_type: "review", prompt: "second" } }, "m3"),
			turn("2099-01-01T00:00:04Z", {
				name: "imm_kernel_canary",
				id: "s1",
				arguments: { task_id: "t1", action: { op: "submit_review", verdict: { findings: [finding] } } },
			}, "m3"),
			turn("2099-01-01T00:00:05Z", {
				name: "imm_kernel_canary",
				id: "s2",
				arguments: { task_id: "t1", action: { op: "record_finding", finding } },
			}, "m3"),
		]);
		try {
			const session = await readSession(join(root, "proj", "s.jsonl"), WIDE_WINDOW);
			expect(session).not.toBeNull();
			const events = session!.events;
			expect(events.filter((e) => e.type === "review").map((e) => e.author)).toEqual(["no-edit (review-only)", "p/m2"]);
			const findings = events.filter((e) => e.type === "finding");
			expect(findings).toHaveLength(2);
			expect(findings.every((e) => e.author === "p/m2")).toBe(true);
			expect(await readSession(join(root, "proj", "s.jsonl"), { ...WIDE_WINDOW, exclude: ["author-app"] })).toBeNull();
		} finally {
			cleanup();
		}
	});

	test("rejects a non-positive window", async () => {
		await expect(run(["0", "--root", ROOT])).rejects.toThrow(/usage:/);
	});
});
