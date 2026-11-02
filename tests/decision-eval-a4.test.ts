import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { acceptanceRepeatSeries } from "../plugins/immune-brain/runtime/kernel/acceptance_repeats.ts";
import { repeatTriggerRound } from "../scripts/decision-eval/a4/run.ts";
const REPO = resolve(import.meta.dir, "..");
const EXTRACT = join(REPO, "scripts/decision-eval/a4/extract.ts");
const RUN = join(REPO, "scripts/decision-eval/a4/run.ts");
const FIXTURE_PAIR = "review-host-handback-block-order";
const FIXTURE_AUDIT = join(REPO, "tests/fixtures/review-retro-audit/audit", FIXTURE_PAIR);
const OPTIONS = ["same_invariant", "new_defect", "out_of_contract"];

const dirs: string[] = [];
const originalXdg = process.env.XDG_CONFIG_HOME;
afterEach(() => {
	if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = originalXdg;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix = "decision-eval-a4-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function cli(script: string, args: string[]) {
	const proc = Bun.spawnSync(["bun", script, ...args], { cwd: REPO, env: { ...process.env } });
	return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const readRows = (path: string) =>
	readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@local", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

/** One committed run of the fixture task: `rounds` review rework events and one review finding per `[acceptance, round]`. */
function writeRun(root: string, name: string, rounds: number, findings: [string, number][]): void {
	const fixtureRun = readdirSync(FIXTURE_AUDIT).find((entry) => entry.startsWith("run-"))!;
	const dest = join(root, ".imm/audit", FIXTURE_PAIR, `run-${name}`);
	cpSync(join(FIXTURE_AUDIT, fixtureRun), dest, { recursive: true });
	const recordPath = join(dest, "task-record.json");
	const record = JSON.parse(readFileSync(recordPath, "utf8")) as { history: Record<string, unknown>[]; findings: Record<string, unknown>[] };
	const rework = record.history.find((h) => h.type === "request_rework")!;
	const others = record.history.filter((h) => h !== rework);
	const reworks = Array.from({ length: rounds }, (_, i) => ({ ...rework, id: `request_rework:${name}:${i + 1}`, reason: `review_round_${i + 1}\naction_v2_sha256:${"0".repeat(64)}` }));
	record.history = [...others.slice(0, -1), ...reworks, others[others.length - 1]!];
	const template = record.findings.find((f) => f.source === "review")!;
	record.findings = findings.map(([acceptance, round], i) => ({ ...template, id: `f${i + 1}`, acceptance_id: acceptance, review_round: round, summary: `finding ${i + 1} on ${acceptance}` }));
	const content = `${JSON.stringify(record, null, 2)}\n`;
	writeFileSync(recordPath, content);
	const proofPath = join(dest, "terminal-proof.json");
	const proof = JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown>;
	proof.final_record_hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
	writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
}

function auditRepo(): string {
	const root = tempDir("decision-eval-a4-repo-");
	git(root, ["init", "-q"]);
	writeFileSync(join(root, "README.md"), "fixture\n");
	writeRun(root, "long", 6, [["A1", 1], ["A1", 2], ["A2", 3], ["A1", 4], ["A2", 5], ["A3", 6]]);
	writeRun(root, "short", 2, [["A1", 1], ["A1", 2]]);
	git(root, ["add", "-A"]);
	git(root, ["commit", "-q", "-m", "audit"]);
	return root;
}

describe("A4 corpus extraction (AC1)", () => {
	test("emits rows only for the 6-round run, only for findings at round >= 2, each with its earlier findings", () => {
		const root = auditRepo();
		const corpus = join(tempDir(), "corpus.jsonl");
		const out = cli(EXTRACT, ["--root", root, "--corpus", corpus]);
		expect(out.code).toBe(0);
		const rows = readRows(corpus);
		expect(rows).toHaveLength(5);
		for (const row of rows) {
			expect(row).toMatchObject({ task_id: FIXTURE_PAIR, gold: "unlabeled", labeler: null, labelled_at: null });
			expect(row.run).toBe(`${FIXTURE_PAIR}/run-long`);
			expect(row.round).toBeGreaterThanOrEqual(2);
			expect(row.earlier.length).toBeGreaterThan(0);
			for (const e of row.earlier) expect(e.round).toBeLessThan(row.round);
		}
		expect(rows.some((r) => r.run.endsWith("run-short"))).toBe(false);
		const byRound = (round: number) => rows.find((r) => r.round === round);
		expect(byRound(2)).toMatchObject({ finding_id: "f2", acceptance_id: "A1", summary: "finding 2 on A1" });
		expect(byRound(2).earlier.map((e: { id: string }) => e.id)).toEqual(["f1"]);
		expect(byRound(6).earlier.map((e: { id: string }) => e.id)).toEqual(["f1", "f2", "f3", "f4", "f5"]);
		expect(byRound(6).earlier[2]).toEqual({ id: "f3", acceptance_id: "A2", round: 3, summary: "finding 3 on A2" });
	});

	test("re-extraction keeps a gold label set on an existing row and refreshes its other fields", () => {
		const root = auditRepo();
		const corpus = join(tempDir(), "corpus.jsonl");
		expect(cli(EXTRACT, ["--root", root, "--corpus", corpus]).code).toBe(0);
		const rows = readRows(corpus);
		const target = rows.find((r) => r.round === 4);
		writeFileSync(corpus, rows.map((r) => `${JSON.stringify(r.id === target.id ? { ...r, summary: "stale", gold: "same_invariant", labeler: "maintainer", labelled_at: "2026-11-01T00:00:00Z" } : r)}\n`).join(""));
		expect(cli(EXTRACT, ["--root", root, "--corpus", corpus]).code).toBe(0);
		const after = readRows(corpus);
		expect(after).toHaveLength(5);
		expect(after.find((r) => r.id === target.id)).toMatchObject({ gold: "same_invariant", labeler: "maintainer", labelled_at: "2026-11-01T00:00:00Z", summary: target.summary });
		expect(after.filter((r) => r.gold === "unlabeled")).toHaveLength(4);
		expect(after.map((r) => r.id)).toEqual([...after.map((r) => r.id)].sort());
	});

	test("an invalid existing gold label exits 1 naming the row and writes nothing", () => {
		const root = auditRepo();
		const corpus = join(tempDir(), "corpus.jsonl");
		const bad = { id: "t/run-x/f9", run: "t/run-x", task_id: "t", finding_id: "f9", acceptance_id: "A1", round: 2, summary: "s", earlier: [], gold: "maybe", labeler: null, labelled_at: null };
		const text = `${JSON.stringify(bad)}\n`;
		writeFileSync(corpus, text);
		const out = cli(EXTRACT, ["--root", root, "--corpus", corpus]);
		expect(out.code).toBe(1);
		expect(out.stderr).toContain("invalid_gold_label: t/run-x/f9");
		expect(readFileSync(corpus, "utf8")).toBe(text);
	});
});

// Synthetic corpus of one run: [acceptance, round, gold, fake answer].
const PLAN: [string, number, string, [number, number, number]][] = [
	["A1", 1, "unlabeled", [0, 0, 0]],
	["A2", 2, "same_invariant", [0.8, 0.1, 0.1]],
	["A3", 3, "new_defect", [0.1, 0.8, 0.1]],
	["A3", 4, "same_invariant", [0.1, 0.8, 0.1]],
	["A4", 5, "new_defect", [0.1, 0.8, 0.1]],
	["A5", 6, "out_of_contract", [0.1, 0.1, 0.8]],
];
const RUN_PATH = "long-run/run-1";
const rowId = (n: number) => `${RUN_PATH}/f${n}`;

function corpusRows(): { rows: object[]; answers: Record<string, Record<string, number>> } {
	const findings = PLAN.map(([acceptance, round], i) => ({ id: `f${i + 1}`, acceptance_id: acceptance, round, summary: `finding f${i + 1}` }));
	const rows: object[] = [];
	const answers: Record<string, Record<string, number>> = {};
	PLAN.forEach(([acceptance, round, gold, probs], i) => {
		if (round < 2) return;
		rows.push({ id: rowId(i + 1), run: RUN_PATH, task_id: "long-run", finding_id: `f${i + 1}`, acceptance_id: acceptance, round, summary: `finding f${i + 1}`, earlier: findings.filter((f) => f.round < round), gold, labeler: "maintainer", labelled_at: null });
		answers[rowId(i + 1)] = { same_invariant: probs[0], new_defect: probs[1], out_of_contract: probs[2] };
	});
	return { rows, answers };
}

function evalSetup(local: unknown, egress: object, rows: object[]) {
	const root = tempDir();
	process.env.XDG_CONFIG_HOME = join(root, "config");
	mkdirSync(join(root, "config/immune-brain"), { recursive: true });
	writeFileSync(join(root, "config/immune-brain/config.json"), JSON.stringify({ contract: "immune_brain/user_config/v1", decision_models: { default_profile: "default", ...(local as object) } }));
	git(root, ["init", "-q"]);
	mkdirSync(join(root, ".imm"));
	writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v1", decision_models: { egress } }));
	git(root, ["add", ".imm/config.json"]);
	const corpus = join(root, "corpus.jsonl");
	writeFileSync(corpus, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
	return { root, corpus, out: join(root, "reports") };
}

async function runMain(args: string[], env: Record<string, string> = {}) {
	const realFetch = globalThis.fetch;
	const realEnv = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return Response.json({});
	}) as unknown as typeof fetch;
	Object.assign(process.env, env);
	try {
		const { main } = await import("../scripts/decision-eval/a4/run.ts");
		const code = await main(args);
		return { code, calls };
	} finally {
		globalThis.fetch = realFetch;
		for (const [k, v] of Object.entries(realEnv)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	}
}

describe("A4 eval report (AC2)", () => {
	test("a provider whose egress does not list finding records every case egress_denied and makes zero fetch calls", async () => {
		const { rows } = corpusRows();
		const { root, corpus, out } = evalSetup({ profiles: { default: { kind: "jev", api_key_env: "A4_JEV_KEY_TEST" } } }, { jev: [] }, rows);
		const res = await runMain(["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-02"], { A4_JEV_KEY_TEST: "jev-test-key" });
		expect(res).toEqual({ code: 2, calls: 0 });
		const report = JSON.parse(readFileSync(join(out, "a4-2026-11-02.json"), "utf8"));
		expect(report.counts).toMatchObject({ labelled: 5, decided: 0, unavailable: { egress_denied: 5 } });
		expect(report.cases).toHaveLength(5);
		for (const c of report.cases) expect(c.unavailable).toBe("egress_denied");
		expect(report.per_task).toMatchObject([{ run: RUN_PATH, repeat_trigger_round: 4, first_correct_grouping_round: null, rounds_saved: null }]);
	});

	test("with egress listing finding and the fake provider the report carries baseline, per-option metrics, calibration and per-task rounds", async () => {
		const { rows, answers } = corpusRows();
		const { root, corpus, out } = evalSetup({ profiles: { default: { kind: "fake", answers } } }, { fake: ["finding"] }, rows);
		const res = await runMain(["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-02"]);
		expect(res).toEqual({ code: 0, calls: 0 });

		const report = JSON.parse(readFileSync(join(out, "a4-2026-11-02.json"), "utf8"));
		expect(report).toMatchObject({ application_point: "a4_finding_equivalence", provider_kind: "fake", threshold_set_version: "a4/v0", counts: { total: 5, labelled: 5, unlabeled: 0, decided: 5 } });
		const m = report.metrics;
		expect(Object.keys(m.per_class)).toEqual(OPTIONS);
		expect(m.accuracy).toBeCloseTo(4 / 5);
		expect(m.per_class.same_invariant).toEqual({ precision: 1, recall: 0.5, support: 2 });
		expect(typeof report.calibration.brier).toBe("number");
		expect(report.calibration).toMatchObject({ excluded: 0 });
		// same_acceptance: only the round-4 row repeats an earlier acceptance; A2 (round 2) and A5 (round 6) are misses.
		expect(report.baseline.name).toBe("same_acceptance");
		expect(report.baseline.accuracy).toBeCloseTo(3 / 5);
		expect(report.per_task).toEqual([{ run: RUN_PATH, task_id: "long-run", latest_round: 6, repeat_trigger_round: 4, first_correct_grouping_round: 2, rounds_saved: 2 }]);

		const md = readFileSync(join(out, "a4-2026-11-02.md"), "utf8");
		expect(md).toContain("| Baseline (same_acceptance) |");
		expect(md).toContain(`| \`${RUN_PATH}\` | 6 | 4 | 2 | 2 |`);
	});

	test("a corpus with no labelled rows exits 1 with no_labelled_cases", () => {
		const { rows } = corpusRows();
		const { root, corpus, out } = evalSetup({ profiles: { default: { kind: "fake", answers: {} } } }, { fake: ["finding"] }, rows.map((r) => ({ ...r, gold: "unlabeled" })));
		const res = cli(RUN, ["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-02"]);
		expect(res.code).toBe(1);
		expect(res.stderr).toContain("no_labelled_cases");
	});
});

describe("repeat_trigger_round", () => {
	// scripts/decision-eval may not import the runtime, so run.ts restates the streak rule; this pins it to acceptanceRepeatSeries.
	const reference = (findings: { acceptance_id: string | null; round: number }[]): number | null => {
		const latest = Math.max(0, ...findings.map((f) => f.round));
		for (let round = 1; round <= latest; round++) {
			const seen = findings.filter((f) => f.round <= round).map((f) => ({ acceptance_id: f.acceptance_id, review_round: f.round }));
			if (acceptanceRepeatSeries(seen, round).some((row) => row.acceptance_id !== null && row.current_streak >= 2)) return round;
		}
		return null;
	};
	const f = (acceptance_id: string | null, round: number) => ({ acceptance_id, round });

	test.each([
		{ name: "consecutive rounds on one acceptance", findings: [f("A", 1), f("A", 2)] },
		{ name: "a gap breaks the streak", findings: [f("A", 1), f("A", 3), f("B", 4), f("A", 5), f("A", 6)] },
		{ name: "the null key never triggers", findings: [f(null, 1), f(null, 2), f(null, 3)] },
		{ name: "same-round duplicates are one round", findings: [f("A", 2), f("A", 2), f("B", 3)] },
		{ name: "different acceptances every round", findings: [f("A", 1), f("B", 2), f("C", 3), f("D", 4)] },
		{ name: "no findings", findings: [] },
	])("matches acceptanceRepeatSeries: $name", ({ findings }) => {
		expect(repeatTriggerRound(findings)).toBe(reference(findings));
	});
});
