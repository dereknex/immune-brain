import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readSession, run } from "../plugins/immune-brain/skills/revisit/scripts/review_retro.ts";

const ROOT = resolve(import.meta.dir, "fixtures/review-retro");
const CONTRACT_ROOT = resolve(import.meta.dir, "fixtures/review-retro-contract");
const QUALITY_ROOT = resolve(import.meta.dir, "fixtures/review-retro-quality");
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

function sessionFiles(files: Record<string, string[]>): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "review-retro-"));
	mkdirSync(join(root, "proj"));
	for (const [name, lines] of Object.entries(files)) writeFileSync(join(root, "proj", name), `${lines.join("\n")}\n`);
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function sessionRoot(lines: string[]): { root: string; cleanup: () => void } {
	return sessionFiles({ "s.jsonl": lines });
}

const stamp = (n: number) => `2099-01-01T00:00:${String(n).padStart(2, "0")}Z`;
const kernelCall = (n: number, id: string, action: object, task = "t") => turn(stamp(n), { name: "imm_kernel_canary", id, arguments: { task_id: task, action } });
const toolResult = (n: number, id: string, value: object, isError = false) => JSON.stringify({ timestamp: stamp(n), message: { role: "toolResult", toolCallId: id, isError, content: JSON.stringify(value) } });
const userInput = (n: number, text = "continue") => JSON.stringify({ timestamp: stamp(n), message: { role: "user", content: text } });
const turnEnd = (n: number, stopReason: string) => JSON.stringify({ timestamp: stamp(n), message: { role: "assistant", stopReason, content: [] } });
const candidateSection = (report: string) => report.slice(report.indexOf("=== candidate chains"), report.indexOf("user inputs:")).split("\n").slice(1).filter(Boolean);

describe("review-retro analyzer", () => {
	test("reports usage, rounds/task and finding totals without any model ranking", async () => {
		const out = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", ROOT]);
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
		// blocking: "real defect in auth"; advisory: "naming nit"; bookkeeping marker (unverified): "receipt recorded"
		expect(out).toContain("blocking: 1 | advisory: 1 | bookkeeping marker (unverified): 1");
		expect(out).toContain("caveats:");

		for (const gone of ["anthropic/claude-opus", "openai/gpt-5", "rev/100ed", "avgSc", "pass%", "REJECT", "highRisk"]) {
			expect(out).not.toContain(gone);
		}
		expect(out).not.toContain("project x author");
		expect(out).not.toContain("review quality");
	});

	test("reads assurance_verdict contracts: verdict findings deduped without a model key", async () => {
		const out = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", CONTRACT_ROOT]);
		expect(out).toContain("3.0 rounds/task");
		expect(out).toContain("blocking: 1 | advisory: 1 | bookkeeping marker (unverified): 0");
		expect(out).toContain("findings: 3 raw calls deduped to 2 distinct");
		expect(out).not.toContain("acme/coder");
		// A fixture whose findings carry no violated.kind and no disposition events leaves the report unchanged.
		expect(out).not.toContain("review quality");
		const json = JSON.parse(await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", CONTRACT_ROOT, "--json"]));
		expect(json.events.filter((event: { type: string }) => event.type === "finding").every((event: object) => !("violatedKind" in event))).toBe(true);
	});

	test("splits blocking findings by violated.kind and counts dispositions only where the session proves visibility", async () => {
		const out = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", QUALITY_ROOT]);
		expect(out).toContain("p/m1 blocked acceptance=1 security_boundary=1");
		expect(out).toContain("p/m1 dispositions resolve=1 refute=1 accept_residual_risk=1");
		expect(out).toContain("p/m2 dispositions resolve=0 refute=1 accept_residual_risk=0");
		expect(out).not.toContain("blocking by violated.kind: (no finding carries violated.kind)");
	});

	test("--project keeps sessions whose cwd contains the substring", async () => {
		const out = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", ROOT, "--project", "immune-brain"]);
		expect(out).toMatch(/sessions: 1 /);
		expect(out).toContain("filters: project~immune-brain");
		expect(out).toContain("blocking: 0 | advisory: 1 | bookkeeping marker (unverified): 1");
	});

	test("--exclude drops matching sessions, repeats, and combines with --project", async () => {
		const one = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", ROOT, "--exclude", "other-app"]);
		expect(one).toMatch(/sessions: 1 /);
		expect(one).toContain("filters: exclude~other-app");
		expect(one).toContain("blocking: 0 | advisory: 1 | bookkeeping marker (unverified): 1");

		const both = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", ROOT, "--exclude", "other-app", "--exclude", "immune-brain"]);
		expect(both).toMatch(/sessions: 0 /);
		expect(both).toContain("filters: exclude~other-app, exclude~immune-brain");

		const combined = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", ROOT, "--project", "/", "--exclude", "other-app"]);
		expect(combined).toMatch(/sessions: 1 /);
		expect(combined).toContain("filters: project~/, exclude~other-app");
		const none = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", ROOT, "--project", "other-app", "--exclude", "other-app"]);
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
			const out = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", root]);
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

	test("submit_review without a verdict counts the observed Review receipt once", async () => {
		const reviewResult = (id: string, text: string, timestamp: string) =>
			JSON.stringify({ timestamp, message: { role: "toolResult", toolCallId: id, content: [{ type: "text", text }] } });
		const verdict = {
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "review",
			task_id: "t1",
			decision: "rework",
			findings: [{ id: "review-1", kind: "blocking", acceptance_id: "A1", summary: "relative KUBECONFIG breaks after cd" }],
		};
		const submit = (id: string, timestamp: string, withVerdict = false) =>
			turn(timestamp, {
				name: "imm_kernel_canary",
				id,
				arguments: { task_id: "t1", action: { op: "submit_review", ...(withVerdict ? { verdict } : {}) } },
			});
		const review = (id: string, timestamp: string) =>
			turn(timestamp, { name: "Agent", id, arguments: { subagent_type: "Review", prompt: id } });
		const { root, cleanup } = sessionRoot([
			JSON.stringify({ type: "session", cwd: "/tmp/receipt-app" }),
			review("r1", "2099-01-01T00:00:00Z"),
			reviewResult("r1", `Agent completed in 9.0s.\n\n${JSON.stringify(verdict, null, 2)}`, "2099-01-01T00:00:01Z"),
			submit("s1", "2099-01-01T00:00:02Z"),
			// the receipt is consumed: a second bare submit and an explicit resubmit add no new finding
			submit("s2", "2099-01-01T00:00:03Z"),
			submit("s3", "2099-01-01T00:00:04Z", true),
			// a prose result carries no verdict, so the next bare submit has no receipt
			review("r2", "2099-01-01T00:00:05Z"),
			reviewResult("r2", "Agent completed in 3.0s.\n\n**Findings**\n\n1. prose only", "2099-01-01T00:00:06Z"),
			submit("s4", "2099-01-01T00:00:07Z"),
		]);
		try {
			const session = await readSession(join(root, "proj", "s.jsonl"), WIDE_WINDOW);
			const findings = session!.events.filter((e) => e.type === "finding");
			expect(findings.map((e) => e.type === "finding" && e.summary)).toEqual([
				"relative KUBECONFIG breaks after cd",
				"relative KUBECONFIG breaks after cd",
			]);
			const out = await run(["--since", "2000-01-01T00:00:00Z", "--until", "2100-01-01T00:00:00Z", "--root", root]);
			expect(out).toContain("4.0 rounds/task");
			expect(out).toContain("blocking: 1 | advisory: 0 | bookkeeping marker (unverified): 0");
			expect(out).toContain("findings: 2 raw calls deduped to 1 distinct");
		} finally {
			cleanup();
		}
	});

	test("rejects a non-positive window", async () => {
		await expect(run(["0", "--root", ROOT])).rejects.toThrow(/usage:/);
	});
	test("emits fixed-window pointed evidence, links and human input", async () => {
		const stamp = (n: number) => `2099-01-01T00:00:${String(n).padStart(2, "0")}Z`;
		const msg = (n: number, message: object) => JSON.stringify({ id: `entry-${n}`, timestamp: stamp(n), message });
		const { root, cleanup } = sessionRoot([
			JSON.stringify({ type: "session", id: "session-1", cwd: "/project" }),
			msg(0, { role: "user", content: [{ type: "text", text: '<skill name="revisit" location="x">body</skill>\ninspect this' }] }),
			msg(1, { role: "user", content: [{ type: "text", text: '<skill name="revisit">body</skill>' }] }),
			turn(stamp(2), { name: "imm_kernel_canary", id: "call", arguments: { task_id: "task", action: { op: "status" } } }),
			msg(3, { role: "toolResult", toolCallId: "call", content: JSON.stringify({ task_state: { run_id: "run" } }) }),
			msg(4, { role: "toolResult", toolCallId: "missing", content: "not json" }),
			msg(5, { role: "user", content: "excluded" }),
		]);
		try {
			const args = ["--since", stamp(0), "--until", stamp(5), "--root", root];
			const output = await run([...args, "--json"]);
			expect(await run([...args, "--json"])).toBe(output);
			const doc = JSON.parse(output);
			expect(doc.contract).toBe("immune_brain/revisit_evidence/v2");
			expect(doc.window).toEqual({ since: "2099-01-01T00:00:00.000Z", until: "2099-01-01T00:00:05.000Z" });
			expect(doc.scope.root).toBe(root);
			expect(doc.sessions[0].session_id).toBe("session-1");
			for (const e of doc.events) for (const key of ["session", "line", "entry_id", "timestamp", "role", "cwd", "task_id", "run_id"]) expect(e[key]).toBeDefined();
			expect(doc.events.filter((e: any) => e.type === "user_input").map((e: any) => [e.skill, e.instruction])).toEqual([["revisit", "inspect this"], ["revisit", ""]]);
			const call = doc.events.find((e: any) => e.type === "tool_call");
			const results = doc.events.filter((e: any) => e.type === "tool_result");
			expect(call.author).toBe("no-edit (review-only)");
			expect(results[0]).toMatchObject({ call_line: call.line, task_id: "task", run_id: "run" });
			expect(results[1]).toMatchObject({ call_line: null, task_id: "unknown", run_id: "unknown" });
			const report = await run(args);
			expect(report).toContain("user inputs: 2");
			const sections = ["window:", "=== candidate chains", "user inputs:", "=== findings", "=== appendix:", "=== usage", "=== review rounds"];
			expect(sections.map(x => report.indexOf(x))).toEqual([...sections.map(x => report.indexOf(x))].sort((a, b) => a - b));
			for (const bad of [["7", "--since", stamp(0)], ["--until", stamp(1)], ["--since", "invalid"], ["--since", stamp(1), "--until", stamp(1)]]) await expect(run(bad)).rejects.toThrow(/usage:/);
			const days = JSON.parse(await run(["1", "--root", root, "--json"]));
			expect(Date.parse(days.window.until) - Date.parse(days.window.since)).toBe(86400000);
		} finally { cleanup(); }
	});

	test("groups candidate chains by kind and key without assigning causes", async () => {
		const finding = { kind: "blocking", acceptance_id: "A", summary: "defect" };
		const { root, cleanup } = sessionRoot([
			JSON.stringify({ type: "session", cwd: "/project" }),
			kernelCall(0, "a", { op: "submit_review", verdict: { findings: [finding] } }),
			kernelCall(1, "b", { op: "submit_review", verdict: { findings: [finding] } }),
			kernelCall(2, "c", { op: "submit_review" }),
			kernelCall(3, "c2", { op: "submit_review" }),
			kernelCall(4, "u", { op: "submit_review" }, "u"),
			kernelCall(5, "d", { op: "status" }),
			toolResult(6, "d", { batch_id: "batch", batch_state: "needs_human" }),
			toolResult(7, "d", { batch_id: "batch", batch_state: "running" }),
			toolResult(8, "d", { batch_id: "batch", batch_state: "needs_human" }),
			turnEnd(9, "error"), userInput(10), kernelCall(11, "e", { op: "status" }),
		]);
		try {
			const doc = JSON.parse(await run(["--since", stamp(0), "--until", stamp(12), "--root", root, "--json"]));
			expect(doc.contract).toBe("immune_brain/revisit_evidence/v2");
			expect(doc.candidates.map((g: any) => [g.kind, g.key, g.occurrences])).toEqual([
				["repeated_block", "/project / t / A", 1],
				["review_without_verdict", "/project / t", 2],
				["review_without_verdict", "/project / u", 1],
				["batch_oscillation", "batch", 1],
				["error_resume", "/project / t", 1],
			]);
			for (const g of doc.candidates) {
				expect(Object.keys(g).sort()).toEqual(["chains", "key", "kind", "occurrences"]);
				expect(g.occurrences).toBe(g.chains.length);
				for (const chain of g.chains) {
					expect(Object.keys(chain)).toEqual(["pointers"]);
					expect(chain.pointers.length).toBeLessThanOrEqual(5);
					for (const p of chain.pointers) expect(p).toMatch(/#\d+$/);
				}
			}
			expect(JSON.stringify(doc.candidates)).not.toMatch(/"(cause|class|severity)"/);
		} finally { cleanup(); }
	});

	test("splits error_resume from user_resume and locates normal-stop resumes", async () => {
		const { root, cleanup } = sessionFiles({
			"a.jsonl": [
				JSON.stringify({ type: "session", cwd: "/project" }),
				kernelCall(0, "a", { op: "status" }),
				toolResult(1, "a", { state: "blocked" }, true),
				turnEnd(2, "stop"), userInput(3, "please go on"), kernelCall(4, "b", { op: "status" }),
				turnEnd(5, "error"), userInput(6), kernelCall(7, "c", { op: "status" }),
				turnEnd(8, "aborted"), userInput(9), kernelCall(10, "d", { op: "status" }),
				turnEnd(11, "stop"), userInput(12), kernelCall(13, "e", { op: "status" }, "other"),
				kernelCall(14, "s", { op: "request_stop" }),
				toolResult(15, "s", { state: "applied", lifecycle: "stopped" }),
				turnEnd(16, "stop"), userInput(17), kernelCall(18, "f", { op: "status" }),
			],
			"b.jsonl": [
				JSON.stringify({ type: "session", cwd: "/fresh" }),
				kernelCall(0, "x", { op: "status" }),
				turnEnd(1, "stop"), userInput(2, "go"), kernelCall(3, "y", { op: "status" }),
			],
		});
		try {
			const doc = JSON.parse(await run(["--since", stamp(0), "--until", stamp(19), "--root", root, "--json"]));
			expect(doc.events.find((e: any) => e.type === "tool_result" && e.tool_call_id === "s").stop_applied).toBe(true);
			const resultA = doc.events.find((e: any) => e.type === "tool_result" && e.tool_call_id === "a");
			expect(doc.candidates.map((g: any) => [g.kind, g.key, g.occurrences])).toEqual([
				["user_resume", "/fresh / t", 1],
				["user_resume", "/project / t", 1],
				["error_resume", "/project / t", 2],
			]);
			const [fresh, located, errors] = doc.candidates;
			expect(located.chains[0]).toEqual({
				pointers: located.chains[0].pointers,
				last_result: `${resultA.session}#${resultA.line}`,
				last_result_is_error: true,
				last_result_state: "blocked",
				reply_chars: "please go on".length,
			});
			expect(fresh.chains[0]).toMatchObject({ last_result: null, last_result_is_error: null, last_result_state: null, reply_chars: 2 });
			for (const chain of errors.chains) expect(Object.keys(chain)).toEqual(["pointers"]);
		} finally { cleanup(); }
	});

	test("text report prints one line per group and at most five groups per kind", async () => {
		const bareSubmits = (tasks: number) => sessionRoot([
			JSON.stringify({ type: "session", cwd: "/project" }),
			...Array.from({ length: tasks }, (_, i) => kernelCall(i, `s${i}`, { op: "submit_review" }, `t${i}`)),
			kernelCall(tasks, "again", { op: "submit_review" }, "t3"),
		]);
		const six = bareSubmits(6), five = bareSubmits(5);
		try {
			const sixLines = candidateSection(await run(["--since", stamp(0), "--until", stamp(10), "--root", six.root]));
			expect(sixLines).toHaveLength(6);
			expect(sixLines[0]).toMatch(/^review_without_verdict: \/project \/ t3 x2 \S+#\d+$/);
			expect(sixLines.slice(1, 5).map(l => l.split(" ")[3])).toEqual(["t0", "t1", "t2", "t4"]);
			for (const l of sixLines.slice(1, 5)) expect(l).toMatch(/ x1 \S+#\d+$/);
			expect(sixLines[5]).toBe("review_without_verdict: +1 more groups (see --json)");
			const fiveLines = candidateSection(await run(["--since", stamp(0), "--until", stamp(10), "--root", five.root]));
			expect(fiveLines).toHaveLength(5);
			expect(fiveLines.join("\n")).not.toContain("more groups");
		} finally { six.cleanup(); five.cleanup(); }
	});

	test("sessions[] lists only sessions with activity in the window", async () => {
		const { root, cleanup } = sessionFiles({
			"active.jsonl": [JSON.stringify({ type: "session", id: "active", cwd: "/project" }), kernelCall(0, "a", { op: "status" })],
			"idle.jsonl": [JSON.stringify({ type: "session", id: "idle", cwd: "/project" }), turn("2000-01-01T00:00:00Z", { name: "bash", id: "b" })],
		});
		try {
			const args = ["--since", stamp(0), "--until", stamp(1), "--root", root];
			const doc = JSON.parse(await run([...args, "--json"]));
			expect(doc.sessions.map((s: any) => s.session_id)).toEqual(["active"]);
			expect(await run(args)).toContain(`sessions with activity: ${doc.sessions.length} `);
		} finally { cleanup(); }
	});

	test("does not infer human input or candidates from isolated calls and receipt-backed reviews", async () => {
		const ts = "2099-01-01T00:00:00Z";
		const verdict = { contract: "assurance_kernel/assurance_verdict/v2", findings: [{ kind: "blocking", acceptance_id: "A", summary: "receipt recorded" }] };
		const { root, cleanup } = sessionRoot([
			JSON.stringify({ type: "session", cwd: "/project" }),
			...Array.from({ length: 19 }, (_, i) => turn(ts, { name: "imm_kernel_canary", id: `k${i}`, arguments: { task_id: "t", action: { op: "status" } } })),
			turn(ts, { name: "Agent", id: "review", arguments: { subagent_type: "Review" } }),
			JSON.stringify({ timestamp: ts, message: { role: "toolResult", toolCallId: "review", content: JSON.stringify(verdict) } }),
			turn(ts, { name: "imm_kernel_canary", id: "submit", arguments: { task_id: "t", action: { op: "submit_review" } } }),
			JSON.stringify({ timestamp: ts, message: { role: "toolResult", toolCallId: "k0", content: JSON.stringify({ batch_id: "b", batch_state: "needs_human" }) } }),
		]);
		try {
			const args = ["--since", ts, "--until", "2100-01-01T00:00:00Z", "--root", root];
			const doc = JSON.parse(await run([...args, "--json"]));
			expect(doc.candidates).toEqual([]);
			expect(doc.events.filter((e: any) => e.type === "user_input")).toEqual([]);
			expect(doc.events.find((e: any) => e.type === "finding")).toMatchObject({ kind: "blocking", markers: ["bookkeeping"] });
			const report = await run(args);
			expect(report).toContain("user inputs: 0");
			expect(report).toContain("blocking: 0 | advisory: 0 | bookkeeping marker (unverified): 1");
		} finally { cleanup(); }
	});

});
