import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acceptanceRepeatSeries, type RepeatFinding } from "../plugins/immune-brain/runtime/kernel/acceptance_repeats.ts";

const REPO = resolve(import.meta.dir, "..");
const CLI = join(REPO, "scripts/review-eval/acceptance-repeats.ts");
const FIXTURE_PAIR = "review-host-handback-block-order";
const UNCOMMITTED_PAIR = "workflow-decision-closure-s4";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const f = (acceptance_id: string | null, review_round: number | null): RepeatFinding => ({ acceptance_id, review_round });

describe("acceptanceRepeatSeries", () => {
	test("reports streaks, recency and per-round dedup per acceptance key", () => {
		const series = acceptanceRepeatSeries([f("A", 1), f("A", 2), f("A", 3), f("B", 1), f("C", 2), f("C", 2)], 3);
		const key = (id: string) => series.find((row) => row.acceptance_id === id)!;
		expect(key("A")).toMatchObject({
			finding_count: 3,
			rounds_with_findings: 3,
			last_finding_round: 3,
			rounds_since_last_finding: 0,
			current_streak: 3,
		});
		expect(key("B")).toMatchObject({ finding_count: 1, rounds_since_last_finding: 2, current_streak: 0 });
		expect(key("C")).toMatchObject({ finding_count: 2, rounds_with_findings: 1, last_finding_round: 2 });
	});

	test("keeps null as its own key and counts unrounded findings without round metrics", () => {
		const series = acceptanceRepeatSeries([f(null, 1), f("A", null), f("A", null)], 2);
		expect(series.find((row) => row.acceptance_id === null)).toMatchObject({ finding_count: 1, rounds_with_findings: 1 });
		expect(series.find((row) => row.acceptance_id === "A")).toEqual({
			acceptance_id: "A",
			finding_count: 2,
			unrounded: 2,
			rounds_with_findings: 0,
			last_finding_round: null,
			rounds_since_last_finding: null,
			current_streak: 0,
		});
	});

	test("an empty findings list gives an empty series", () => {
		expect(acceptanceRepeatSeries([], 5)).toEqual([]);
	});
});

function git(cwd: string, args: string[]): string {
	return execFileSync(
		"git",
		["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@local", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
}

/** Copy the fixture pair into `<root>/.imm/audit`, giving its second review finding a second acceptance in round 2. */
function writeTwoAcceptancePair(root: string): void {
	const src = join(REPO, "tests/fixtures/review-retro-audit/audit", FIXTURE_PAIR);
	const runDir = readdirSync(src).find((entry) => entry.startsWith("run-"))!;
	const dest = join(root, ".imm/audit", FIXTURE_PAIR);
	cpSync(src, dest, { recursive: true });
	const recordPath = join(dest, runDir, "task-record.json");
	const record = JSON.parse(readFileSync(recordPath, "utf8")) as { findings: Array<Record<string, unknown>> };
	const review = record.findings.filter((finding) => finding.source === "review");
	review[review.length - 1]!.acceptance_id = "RHBO-A2";
	review[review.length - 1]!.review_round = 2;
	const content = `${JSON.stringify(record, null, 2)}\n`;
	writeFileSync(recordPath, content);
	const proofPath = join(dest, runDir, "terminal-proof.json");
	const proof = JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown>;
	proof.final_record_hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
	writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
}

function cli(args: string[]) {
	return spawnSync("bun", [CLI, ...args], { encoding: "utf8" });
}

describe("acceptance-repeats CLI", () => {
	test("prints one row per (run, acceptance) from HEAD only and leaves the repository untouched", () => {
		const root = mkdtempSync(join(tmpdir(), "acceptance-repeats-"));
		tmpDirs.push(root);
		git(root, ["init", "-q"]);
		writeFileSync(join(root, "README.md"), "fixture\n");
		writeTwoAcceptancePair(root);
		git(root, ["add", "-A"]);
		git(root, ["commit", "-q", "-m", "fixture"]);
		cpSync(join(REPO, "tests/fixtures/review-retro-audit/audit", UNCOMMITTED_PAIR), join(root, ".imm/audit", UNCOMMITTED_PAIR), {
			recursive: true,
		});
		const before = git(root, ["status", "--porcelain"]);

		const result = cli(["--root", root, "--json"]);
		expect(result.status).toBe(0);
		const rows = JSON.parse(result.stdout) as Array<{ run: string; acceptance_id: string | null; latest_round: number }>;
		expect(rows.every((row) => row.run.startsWith(`${FIXTURE_PAIR}/`))).toBe(true);
		expect(rows.map((row) => row.acceptance_id).sort()).toEqual(["RHBO-A1", "RHBO-A2"]);

		const findings = [f("RHBO-A1", 1), f("RHBO-A2", 2)];
		for (const row of rows) {
			const { run: _run, latest_round, ...counts } = row;
			const series = acceptanceRepeatSeries(findings, latest_round).find((r) => r.acceptance_id === row.acceptance_id)!;
			expect(counts).toEqual(series);
		}
		expect(git(root, ["status", "--porcelain"])).toBe(before);
	});

	test("a root that is not a Git work tree exits 1 with the error on stderr and no rows", () => {
		const root = mkdtempSync(join(tmpdir(), "acceptance-repeats-nogit-"));
		tmpDirs.push(root);
		const result = cli(["--root", root, "--json"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("usage error");
		expect(result.stdout).toBe("");
	});
});

describe("long-tail replay", () => {
	type RecordedFinding = { source: string; kind: string; acceptance_id: string | null; review_round: number | null };

	/** The first round at which a non-null acceptance has `current_streak >= 2`, replaying the blocking Review findings round by round. */
	function firstConvergenceRound(runDir: string): number | null {
		const record = JSON.parse(readFileSync(join(REPO, ".imm/audit", runDir, "task-record.json"), "utf8")) as { findings: RecordedFinding[] };
		const blocking = record.findings.filter((finding) => finding.source === "review" && finding.kind === "blocking" && finding.review_round !== null);
		const lastRound = Math.max(...blocking.map((finding) => finding.review_round!));
		for (let round = 1; round <= lastRound; round++) {
			const seen = blocking.filter((finding) => finding.review_round! <= round);
			if (acceptanceRepeatSeries(seen, round).some((row) => row.acceptance_id !== null && row.current_streak >= 2)) return round;
		}
		return null;
	}

	test.each([
		"2026-09-01-002-claude-code-host",
		"2026-09-08-002-initiative-amendment",
		"2026-09-05-003-batch-run-state-machine",
	])("the convergence condition first holds at round 2 for %s", (runDir) => {
		expect(firstConvergenceRound(runDir)).toBe(2);
	});
});
