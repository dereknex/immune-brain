import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const EXTRACT = join(REPO, "scripts/decision-eval/a16/extract.ts");
const RUN = join(REPO, "scripts/decision-eval/a16/run.ts");
const SAMPLE = join(REPO, "tests/fixtures/decision-eval/a16/revisit-evidence-sample.json");
const OPTIONS = ["avoidable_friction", "necessary_decision", "error_recovery", "unknown"];

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "decision-eval-a16-"));
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

describe("A16 corpus extraction (AC1)", () => {
	test("writes one sorted unlabeled row per user_resume chain and skips other kinds", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		const out = cli(EXTRACT, ["--evidence", SAMPLE, "--corpus", corpus]);
		expect(out.code).toBe(0);
		const rows = readRows(corpus);
		expect(rows.map((r) => r.id)).toEqual(["/work/demo / task-a s1.jsonl#10", "/work/demo / task-a s1.jsonl#30", "/work/demo / task-b s2.jsonl#3"]);
		for (const row of rows) expect(row).toMatchObject({ gold: "unlabeled", labeler: null, labelled_at: null });
		expect(rows[0]).toMatchObject({
			key: "/work/demo / task-a",
			occurrences: 2,
			pointers: ["s1.jsonl#10", "s1.jsonl#14", "s1.jsonl#15", "s1.jsonl#16"],
			last_result: "s1.jsonl#13",
			last_result_is_error: false,
			last_result_state: "awaiting_user",
			reply_chars: 12,
		});
		expect(rows[1]).toMatchObject({ last_result: null, last_result_is_error: null, last_result_state: null, reply_chars: 240 });
		expect(rows[2]).toMatchObject({ occurrences: 1, last_result_is_error: true, last_result_state: "failed" });
	});

	test("an input whose contract is revisit_evidence/v1 exits 1 naming the contract and writes nothing", () => {
		const dir = tempDir();
		const v1 = join(dir, "v1.json");
		writeFileSync(v1, JSON.stringify({ contract: "immune_brain/revisit_evidence/v1", candidates: [] }));
		const corpus = join(dir, "corpus.jsonl");
		const out = cli(EXTRACT, ["--evidence", v1, "--corpus", corpus]);
		expect(out.code).toBe(1);
		expect(out.stderr).toContain("immune_brain/revisit_evidence/v1");
		expect(existsSync(corpus)).toBe(false);
	});

	test("re-extraction keeps an existing gold label and rows absent from the new evidence", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		const base = { occurrences: 1, pointers: ["x#1"], last_result: null, last_result_is_error: null, last_result_state: null, reply_chars: null, labeler: "maintainer", labelled_at: "2026-11-02T00:00:00Z" };
		const labelled = { ...base, id: "/work/demo / task-b s2.jsonl#3", key: "/work/demo / task-b", gold: "error_recovery" };
		const gone = { ...base, id: "/work/old / task-z z.jsonl#1", key: "/work/old / task-z", gold: "unknown" };
		writeFileSync(corpus, `${JSON.stringify(gone)}\n${JSON.stringify(labelled)}\n`);
		expect(cli(EXTRACT, ["--evidence", SAMPLE, "--corpus", corpus]).code).toBe(0);
		const rows = readRows(corpus);
		expect(rows).toHaveLength(4);
		expect(rows.find((r) => r.id === labelled.id)).toMatchObject({ gold: "error_recovery", labeler: "maintainer", labelled_at: "2026-11-02T00:00:00Z", reply_chars: 31 });
		expect(rows.find((r) => r.id === gone.id)).toMatchObject({ gold: "unknown" });
		expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort());
	});

	test("an invalid existing gold label stops before anything is written", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		const text = `${JSON.stringify({ id: "k p#1", key: "k", pointers: ["p#1"], gold: "maybe" })}\n`;
		writeFileSync(corpus, text);
		const out = cli(EXTRACT, ["--evidence", SAMPLE, "--corpus", corpus]);
		expect(out.code).toBe(1);
		expect(out.stderr).toContain("invalid_gold_label: k p#1");
		expect(readFileSync(corpus, "utf8")).toBe(text);
	});
});

function corpusRow(n: number, gold: string) {
	return { id: `/work/demo / task-${n} s.jsonl#${n}`, key: `/work/demo / task-${n}`, occurrences: 1, pointers: [`s.jsonl#${n}`], last_result: null, last_result_is_error: null, last_result_state: null, reply_chars: n, gold, labeler: gold === "unlabeled" ? null : "maintainer", labelled_at: null };
}

function evalSetup(local: unknown, rows: object[]) {
	const root = tempDir();
	mkdirSync(join(root, ".imm"));
	writeFileSync(join(root, ".imm/decision-bindings.json"), JSON.stringify({ contract: "immune_brain/decision_bindings/v1", default_profile: "default", bindings: {}, egress: {} }));
	if (local !== undefined) writeFileSync(join(root, ".imm/decision-models.local.json"), JSON.stringify(local));
	const corpus = join(root, "corpus.jsonl");
	writeFileSync(corpus, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
	return { root, corpus, out: join(root, "reports") };
}

const p = (a: number, n: number, e: number, u: number) => ({ avoidable_friction: a, necessary_decision: n, error_recovery: e, unknown: u });

describe("A16 eval report (AC2)", () => {
	test("writes the dated report against the majority_class baseline with per-option metrics and calibration", () => {
		const answers = {
			"/work/demo / task-1 s.jsonl#1": p(0.7, 0.1, 0.1, 0.1),
			"/work/demo / task-2 s.jsonl#2": p(0.1, 0.7, 0.1, 0.1),
			"/work/demo / task-3 s.jsonl#3": p(0.1, 0.6, 0.2, 0.1),
		};
		// task-4 has no fake answer and no default: unavailable/provider_error. task-5 is unlabeled.
		const rows = [corpusRow(1, "avoidable_friction"), corpusRow(2, "necessary_decision"), corpusRow(3, "error_recovery"), corpusRow(4, "unknown"), corpusRow(5, "unlabeled")];
		const { root, corpus, out } = evalSetup({ profiles: { default: { kind: "fake", answers } } }, rows);
		const res = cli(RUN, ["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-02"]);
		expect(res.code).toBe(0);

		const report = JSON.parse(readFileSync(join(out, "a16-2026-11-02.json"), "utf8"));
		expect(report).toMatchObject({
			contract: "immune_brain/decision_eval_report/v1",
			application_point: "a16_revisit_chain_class",
			provider_kind: "fake",
			threshold_set_version: "a16/v0",
			counts: { total: 5, labelled: 4, unlabeled: 1, decided: 3, unavailable: { provider_error: 1 } },
		});
		const m = report.metrics;
		expect(Object.keys(m.per_class)).toEqual(OPTIONS);
		expect(m.per_class.avoidable_friction).toEqual({ precision: 1, recall: 1, support: 1 });
		expect(m.per_class.necessary_decision).toEqual({ precision: 0.5, recall: 1, support: 1 });
		// Denominator is the 4 labelled cases; the unlabeled row is in no count.
		expect(m.accuracy).toBeCloseTo(2 / 4);
		expect(report.cases).toHaveLength(4);
		expect(report.cases.map((c: { id: string }) => c.id)).not.toContain(corpusRow(5, "unlabeled").id);
		expect(report.calibration).toEqual({ brier: m.brier, excluded: 1 });
		expect(typeof m.brier).toBe("number");
		expect(report.baseline).toMatchObject({ name: "majority_class", accuracy: 0.25 });
		expect(readFileSync(join(out, "a16-2026-11-02.md"), "utf8")).toContain("| Baseline (majority_class) |");
	});

	test("a corpus with only unlabeled rows exits 1 with no_labelled_cases and writes no report", () => {
		const { root, corpus, out } = evalSetup({ profiles: { default: { kind: "fake", answers: {} } } }, [corpusRow(1, "unlabeled")]);
		const res = cli(RUN, ["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-02"]);
		expect(res.code).toBe(1);
		expect(res.stderr).toContain("no_labelled_cases");
		expect(existsSync(out)).toBe(false);
	});

	test("a gold label outside the A16 classes reports its physical line and writes no report", () => {
		const { root, corpus, out } = evalSetup(undefined, []);
		writeFileSync(corpus, `${JSON.stringify(corpusRow(1, "necessary_decision"))}\n${JSON.stringify(corpusRow(2, "blocking"))}\n`);
		const res = cli(RUN, ["--corpus", corpus, "--out", out, "--root", root]);
		expect(res.code).toBe(1);
		expect(res.stderr.trim()).toBe("corpus_invalid: 2");
		expect(existsSync(out)).toBe(false);
	});
});
