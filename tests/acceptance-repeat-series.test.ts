import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { acceptanceRepeatSeries, type RepeatFinding } from "../plugins/immune-brain/runtime/kernel/acceptance_repeats.ts";

const REPO = resolve(import.meta.dir, "..");

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
