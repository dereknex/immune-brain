import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../plugins/immune-brain/skills/revisit/scripts/review_retro.ts";

const REPO = resolve(import.meta.dir, "..");
const AUDIT_FIXTURES = resolve(import.meta.dir, "fixtures/review-retro-audit/audit");
const SESSION_FIXTURES = resolve(import.meta.dir, "fixtures/review-retro");

const DONE_V4 = "workflow-decision-closure-s4/run-4f6b1b51-2f35-4a97-af5f-9b8ffdf25d1b";
const STOPPED_V4 = "review-host-handback-block-order/run-d09cd7cb-e2f2-495a-bad0-06dd8a7603a5";
const DONE_V2 = "2026-08-19-005-retire-imm-core-barrel";
const WIDE = "36500";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
	return execFileSync(
		"git",
		["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@local", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
}

/** A temporary repository whose HEAD commits copies of the fixture pairs under `.imm/audit/`. */
function auditRepo(pairs: string[], commit = true): string {
	const root = mkdtempSync(join(tmpdir(), "review-retro-audit-"));
	tmpDirs.push(root);
	git(root, ["init", "-q"]);
	writeFileSync(join(root, "README.md"), "fixture\n");
	for (const pair of pairs) cpSync(join(AUDIT_FIXTURES, pair), join(root, ".imm/audit", pair), { recursive: true });
	if (commit) {
		git(root, ["add", "-A"]);
		git(root, ["commit", "-q", "-m", "fixture"]);
	}
	return root;
}

type Row = { head: string; metrics: string };

/** Per-run rows of the report keyed by pair path, in report order. */
function rowsOf(out: string): Map<string, Row> {
	const rows = new Map<string, Row>();
	const lines = out.split("\n");
	lines.forEach((line, i) => {
		const m = /^\d{4}-\S+Z (done|stopped) (v\d) (\S+)$/.exec(line);
		if (m) rows.set(m[3]!, { head: line, metrics: lines[i + 1]!.trim() });
	});
	return rows;
}

describe("revisit --audit committed pairs", () => {
	test("reports exactly the pairs committed at HEAD, not working-tree edits or untracked pairs", async () => {
		const root = auditRepo([DONE_V4, STOPPED_V4, DONE_V2]);
		const before = await run([WIDE, "--audit", root]);

		// A working-tree edit to a committed record and an untracked extra pair are invisible.
		writeFileSync(join(root, ".imm/audit", DONE_V4, "task-record.json"), "{}\n");
		const extra = "untracked-task/run-aaaa";
		mkdirSync(join(root, ".imm/audit", extra), { recursive: true });
		cpSync(join(AUDIT_FIXTURES, DONE_V4), join(root, ".imm/audit", extra), { recursive: true });
		const after = await run([WIDE, "--audit", root]);

		// The window cutoff derives from the clock, so it may differ by a second between the two runs.
		const stable = (out: string) => out.replace(/window: terminalized_at .*? \| terminal runs:/, "window: <cut> | terminal runs:");
		expect(stable(after)).toBe(stable(before));
		expect([...rowsOf(after).keys()].sort()).toEqual([DONE_V2, DONE_V4, STOPPED_V4].sort());
		expect(after).toContain(`project root ${root}`);
		expect(after).toContain(`HEAD ${git(root, ["rev-parse", "HEAD"])}`);
		expect(after).toContain("terminal runs: 3 (done 2, stopped 1)");
		expect(after).toContain("schemas: v4=2 v3=0 v2=1");
		expect(after).toContain("skipped: incomplete=0 proof_mismatch=0 invalid=0 no_terminal_time=0");
		expect(after).toContain(
			"bias: only merged terminal runs are present; unmerged Lane branches, non-terminal runs and stopped runs whose pair was never committed are absent.",
		);
	});

	test("per-run rows pin lifecycle, schema and raw counts; fields a schema lacks print '-'", async () => {
		const root = auditRepo([DONE_V4, STOPPED_V4, DONE_V2]);
		const out = await run([WIDE, "--audit", root]);
		const rows = rowsOf(out);

		expect([...rows.keys()]).toEqual([STOPPED_V4, DONE_V4, DONE_V2]);
		expect(rows.get(DONE_V4)!.head).toBe(`2026-10-03T14:21:23.970Z done v4 ${DONE_V4}`);
		expect(rows.get(DONE_V4)!.metrics).toBe(
			"qa_pass=2 qa_exec_fail=0 review_rework=1 review_pass=1 compat_rev=0 breaking_rev=0 user_rework=0 stops=0 bindings=1i/2d findings=review/resolved:1",
		);
		expect(rows.get(STOPPED_V4)!.head).toBe(`2026-10-04T15:30:16.964Z stopped v4 ${STOPPED_V4}`);
		expect(rows.get(STOPPED_V4)!.metrics).toBe(
			"qa_pass=1 qa_exec_fail=0 review_rework=1 review_pass=0 compat_rev=0 breaking_rev=0 user_rework=0 stops=1 bindings=1i/1d findings=review/open:2",
		);
		expect(rows.get(DONE_V2)!.head).toBe(`2026-08-19T12:28:01.860Z done v2 ${DONE_V2}`);
		expect(rows.get(DONE_V2)!.metrics).toBe(
			"qa_pass=2 qa_exec_fail=0 review_rework=1 review_pass=1 compat_rev=- breaking_rev=0 user_rework=- stops=0 bindings=1i/2d findings=review/resolved:2",
		);
		expect(out).toContain(
			"qa_pass=5 qa_exec_fail=0 review_rework=3 review_pass=2 compat_rev=0 breaking_rev=0 user_rework=0 stops=1 findings=review/open:2 review/resolved:3",
		);
		expect(out).not.toMatch(/median|p95|share|rounds-to-pass|rounds\/task|model/i);
	});

	test("orders newest terminalized_at first with path as tie-breaker and --sample caps the rows", async () => {
		const root = auditRepo([DONE_V4, STOPPED_V4, DONE_V2]);
		// Same task, same proof: a second run directory ties on terminalized_at and differs by path only.
		const twin = "workflow-decision-closure-s4/run-0000aaaa";
		cpSync(join(AUDIT_FIXTURES, DONE_V4), join(root, ".imm/audit", twin), { recursive: true });
		git(root, ["add", "-A"]);
		git(root, ["commit", "-q", "-m", "twin"]);

		const all = await run([WIDE, "--audit", root]);
		expect([...rowsOf(all).keys()]).toEqual([STOPPED_V4, twin, DONE_V4, DONE_V2]);

		const capped = await run([WIDE, "--audit", root, "--sample", "2"]);
		expect([...rowsOf(capped).keys()]).toEqual([STOPPED_V4, twin]);
		expect(capped).toContain("2 of 4");
		// Totals still cover every in-window run.
		expect(capped).toContain("terminal runs: 4");
	});

	test("a pair outside the <days> window by terminalized_at is not counted", async () => {
		const root = auditRepo([DONE_V4, STOPPED_V4, DONE_V2]);
		const between = (Date.parse("2026-08-19T12:28:01.860Z") + Date.parse("2026-10-03T14:21:23.970Z")) / 2;
		const days = String((Date.now() - between) / 86400000);
		const out = await run([days, "--audit", root]);

		expect([...rowsOf(out).keys()]).toEqual([STOPPED_V4, DONE_V4]);
		expect(out).toContain("terminal runs: 2 (done 1, stopped 1)");
		expect(out).toContain("outside window: 1");
	});
});

describe("revisit --audit negative cases", () => {
	test("a directory that is not a Git work tree is a usage error", async () => {
		const dir = mkdtempSync(join(tmpdir(), "review-retro-nogit-"));
		tmpDirs.push(dir);
		await expect(run([WIDE, "--audit", dir])).rejects.toThrow(/usage error: --audit .* Git work tree/);
	});

	test("a repository without a HEAD commit is a usage error", async () => {
		const root = auditRepo([DONE_V4], false);
		await expect(run([WIDE, "--audit", root])).rejects.toThrow(/usage error/);
	});

	test("a HEAD without .imm/audit reports 0 terminal runs", async () => {
		const root = auditRepo([]);
		const out = await run([WIDE, "--audit", root]);
		expect(out).toContain("terminal runs: 0 (done 0, stopped 0)");
		expect(out).toContain("(no committed terminal runs in this window)");
	});

	test("a proof whose final_record_hash does not match is skipped as proof_mismatch", async () => {
		const root = auditRepo([DONE_V4, STOPPED_V4]);
		const record = join(root, ".imm/audit", STOPPED_V4, "task-record.json");
		writeFileSync(record, `${readFileSync(record, "utf8")}\n`);
		git(root, ["add", "-A"]);
		git(root, ["commit", "-q", "-m", "edit record"]);

		const out = await run([WIDE, "--audit", root]);
		expect(out).toContain("skipped: incomplete=0 proof_mismatch=1 invalid=0 no_terminal_time=0");
		expect([...rowsOf(out).keys()]).toEqual([DONE_V4]);
	});

	test("a record without its proof is skipped as incomplete", async () => {
		const root = auditRepo([DONE_V4, STOPPED_V4]);
		git(root, ["rm", "-q", join(".imm/audit", STOPPED_V4, "terminal-proof.json")]);
		git(root, ["commit", "-q", "-m", "drop proof"]);

		const out = await run([WIDE, "--audit", root]);
		expect(out).toContain("skipped: incomplete=1 proof_mismatch=0 invalid=0 no_terminal_time=0");
		expect([...rowsOf(out).keys()]).toEqual([DONE_V4]);
	});

	test("a pair that does not parse is skipped as invalid", async () => {
		const root = auditRepo([DONE_V4]);
		writeFileSync(join(root, ".imm/audit", DONE_V4, "terminal-proof.json"), "not json\n");
		git(root, ["add", "-A"]);
		git(root, ["commit", "-q", "-m", "corrupt proof"]);

		const out = await run([WIDE, "--audit", root]);
		expect(out).toContain("skipped: incomplete=0 proof_mismatch=0 invalid=1 no_terminal_time=0");
	});

	test("the temporary export is removed after a read", async () => {
		const root = auditRepo([DONE_V4]);
		// A private TMPDIR keeps concurrent runs of this file from adding exports to the listing.
		const scratch = mkdtempSync(join(tmpdir(), "review-retro-scratch-"));
		tmpDirs.push(scratch);
		const saved = process.env.TMPDIR;
		process.env.TMPDIR = scratch;
		try {
			await run([WIDE, "--audit", root]);
			expect(readdirSync(scratch)).toEqual([]);
		} finally {
			if (saved === undefined) delete process.env.TMPDIR;
			else process.env.TMPDIR = saved;
		}
	});
});

describe("revisit input selection", () => {
	test("without --audit the session report runs and prints no audit header", async () => {
		const out = await run(["7", "--root", SESSION_FIXTURES]);
		expect(out).toContain("=== usage (sessions / turns / edits / tools) ===");
		expect(out).not.toContain("audit: project root");
		expect(out).not.toContain("bias:");
	});

	test("--audit without --sessions prints no session usage section even when --root names sessions", async () => {
		const out = await run([WIDE, "--audit", auditRepo([DONE_V4]), "--root", SESSION_FIXTURES]);
		expect(out).toContain("audit: project root");
		expect(out).not.toContain("=== usage");
	});

	test("--audit with --sessions appends the session report", async () => {
		const out = await run(["7", "--audit", auditRepo([DONE_V4]), "--sessions", "--root", SESSION_FIXTURES]);
		expect(out).toContain("audit: project root");
		expect(out).toContain("=== usage (sessions / turns / edits / tools) ===");
	});
});

describe("revisit boundary contract", () => {
	const adr = readFileSync(join(REPO, "docs/adr/0032-revisit-reads-committed-audit.md"), "utf8");
	const dist = readFileSync(join(REPO, "plugins/immune-brain/dist/revisit.md"), "utf8");
	const boundary = /## Boundary\n([\s\S]*?)\n## /.exec(dist)![1]!;

	test("ADR 0032 is accepted and states the committed-audit boundary", () => {
		expect(existsSync(join(REPO, "docs/adr/0032-revisit-reads-committed-audit.md"))).toBe(true);
		expect(adr).toMatch(/^status: accepted$/m);
		expect(adr).toContain("committed `.imm/audit/**`");
		expect(adr).toContain("one named project");
		expect(adr).toContain("at HEAD");
		expect(adr).toContain("lifecycle and raw review counts");
	});

	test("the review-verifier-eval D2 note stays and ADR 0032 links back to it", () => {
		const rve = readFileSync(join(REPO, "docs/specs/review-verifier-eval.spec.md"), "utf8");
		expect(rve).toContain("Superseded in part (2026-10-30");
		expect(adr).toContain("review-verifier-eval.spec.md");
	});

	test("the dist Boundary allows committed .imm/audit through --audit and blocks live state", () => {
		const [allowed, blocked] = boundary.split("Blocked:");
		expect(allowed).toContain("--audit");
		expect(allowed).toContain("committed `.imm/audit/`");
		expect(allowed).toContain("HEAD");
		expect(blocked).toContain("live `.imm/` state");
		expect(blocked).toContain("SQLite");
		expect(blocked).toContain("authority store");
		expect(blocked).not.toContain("`.imm/audit/` lifecycle statistics");
	});
});

type RecordShape = {
	findings: Record<string, unknown>[];
	history: { type: string; reason: string; authority?: { authority_kind: string } }[];
};
type Spec = { acceptance: string; round: number; summary: string };

/**
 * Add a run under `.imm/audit/` derived from the real DONE_V4 pair: its review findings and review rework events are
 * replaced by `specs`, and the proof's `final_record_hash` is recomputed so the pair still verifies.
 */
function addRun(root: string, runId: string, specs: Spec[], reworkRounds: number[]): string {
	const rel = `workflow-decision-closure-s4/run-${runId}`;
	const dir = join(root, ".imm/audit", rel);
	cpSync(join(AUDIT_FIXTURES, DONE_V4), dir, { recursive: true });
	const record = JSON.parse(readFileSync(join(dir, "task-record.json"), "utf8")) as RecordShape;
	const template = record.findings[0]!;
	const rework = record.history.find((h) => h.type === "request_rework")!;
	record.findings = specs.map((s, i) => ({
		...template,
		id: `${runId}-f${i + 1}`,
		acceptance_id: s.acceptance,
		review_round: s.round,
		summary: s.summary,
	}));
	record.history = [
		...record.history.filter((h) => h.type !== "request_rework"),
		...reworkRounds.map((n) => ({ ...rework, id: `${rework.id}-${n}`, reason: `review_round_${n}\naction_v2_sha256:x` })),
	];
	const bytes = `${JSON.stringify(record, null, 2)}\n`;
	writeFileSync(join(dir, "task-record.json"), bytes);
	const proofPath = join(dir, "terminal-proof.json");
	const proof = JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown>;
	proof.final_record_hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
	return rel;
}

function commitAll(root: string): void {
	git(root, ["add", "-A"]);
	git(root, ["commit", "-q", "-m", "runs"]);
}

/** The text of one `-- <title> ... --` block of the Candidate improvements section. */
function block(out: string, title: string): string {
	const section = out.slice(out.indexOf("=== candidate improvements"));
	const start = section.indexOf(`-- ${title}`);
	const rest = section.slice(start + 3);
	const end = rest.search(/\n-- |\n===|$/);
	return rest.slice(0, end);
}

describe("revisit --audit candidate improvements", () => {
	const SUMMARY = "`src/a.ts`:10: handler ignores `src/path/x.ts` for sha256:0123456789abcdef0123 on round 3";

	test("groups findings by normalized summary and needs two distinct runs", async () => {
		const root = auditRepo([]);
		const r1 = addRun(root, "r1", [{ acceptance: "A1", round: 1, summary: SUMMARY }], [1]);
		const r2 = addRun(root, "r2", [{ acceptance: "A2", round: 1, summary: "`SRC/B.ts`:99:  Handler ignores `lib/other/y.ts` for sha256:fedcba9876543210fedc on  round 7" }], [1]);
		const r3 = addRun(root, "r3", [{ acceptance: "A1", round: 1, summary: "something only this run says" }, { acceptance: "A1", round: 2, summary: "something only this run says" }], [1, 2]);
		commitAll(root);

		const out = await run([WIDE, "--audit", root]);
		const repeat = block(out, "repeat groups");
		expect(repeat).toContain("runs=2 findings=2 key:");
		expect(repeat).toContain(`${r1}#r1-f1`);
		expect(repeat).toContain(`${r2}#r2-f1`);
		// Two findings with one summary inside a single run are not a repeat group.
		expect(repeat).not.toContain("something only this run says");
		expect(repeat).not.toContain(r3);
	});

	test("a group lists at most three run-path#finding-id pointers but counts every finding", async () => {
		const root = auditRepo([]);
		for (const id of ["r1", "r2", "r3", "r4"]) {
			addRun(root, id, [{ acceptance: "A1", round: 1, summary: "same defect everywhere" }], [1]);
		}
		commitAll(root);

		const repeat = block(await run([WIDE, "--audit", root]), "repeat groups");
		expect(repeat).toContain("runs=4 findings=4");
		expect(repeat.match(/#r\d-f1/g)).toHaveLength(3);
	});

	test("a summary seen in only one run forms no group", async () => {
		const root = auditRepo([]);
		addRun(root, "r1", [{ acceptance: "A1", round: 1, summary: "unique one" }], [1]);
		addRun(root, "r2", [{ acceptance: "A1", round: 1, summary: "unique two" }], [1]);
		commitAll(root);

		expect(block(await run([WIDE, "--audit", root]), "repeat groups")).toContain("(none)");
	});

	test("infrastructure jitter is listed apart and left out of the content rework count", async () => {
		const root = auditRepo([]);
		const rel = addRun(
			root,
			"r1",
			[
				{ acceptance: "A1", round: 1, summary: "The reviewer agent was cleaned up before it returned a verdict." },
				{ acceptance: "A1", round: 2, summary: "Review returned an empty verdict." },
				{ acceptance: "A1", round: 3, summary: "handler drops the bound check in src/x.ts" },
			],
			[1, 2, 3],
		);
		commitAll(root);

		const out = await run([WIDE, "--audit", root]);
		expect(out).toContain("review findings: 3 | content rework: 1 | jitter marker (unverified): 2");
		const jitter = block(out, "jitter marker (unverified");
		expect(jitter).toContain(`${rel}#r1-f1`);
		expect(jitter).toContain(`${rel}#r1-f2`);
		expect(jitter).not.toContain("r1-f3");
		// Jitter never forms a repeat group, even when it repeats across runs.
		addRun(root, "r2", [{ acceptance: "A1", round: 1, summary: "The reviewer agent was cleaned up before it returned a verdict." }], [1]);
		commitAll(root);
		expect(block(await run([WIDE, "--audit", root]), "repeat groups")).toContain("(none)");
	});

	test("a run with three review rework events lists each round's acceptance ids and marks repeats", async () => {
		const root = auditRepo([]);
		const rel = addRun(
			root,
			"r1",
			[
				{ acceptance: "A1", round: 1, summary: "s1" },
				{ acceptance: "A2", round: 1, summary: "s2" },
				{ acceptance: "A1", round: 2, summary: "s3" },
				{ acceptance: "A3", round: 3, summary: "s4" },
			],
			[1, 2, 3],
		);
		commitAll(root);

		const high = block(await run([WIDE, "--audit", root]), "high-round runs");
		expect(high).toContain(`${rel} review_rework=3`);
		expect(high).toContain("round 1: A1* A2");
		expect(high).toContain("round 2: A1*");
		expect(high).toContain("round 3: A3");
	});

	test("a run with two review rework events gets no per-round listing", async () => {
		const root = auditRepo([]);
		addRun(
			root,
			"r1",
			[
				{ acceptance: "A1", round: 1, summary: "s1" },
				{ acceptance: "A1", round: 2, summary: "s2" },
			],
			[1, 2],
		);
		commitAll(root);

		const high = block(await run([WIDE, "--audit", root]), "high-round runs");
		expect(high).toContain("(none)");
		expect(high).not.toContain("round 1:");
	});

	test("the session-only report has no candidate improvements section", async () => {
		expect(await run(["7", "--root", SESSION_FIXTURES])).not.toContain("candidate improvements");
	});
});
