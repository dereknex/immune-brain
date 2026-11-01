import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const EXTRACT = join(REPO, "scripts/decision-eval/a14/extract.ts");
const RUN = join(REPO, "scripts/decision-eval/a14/run.ts");
const SAMPLE = join(REPO, "tests/fixtures/decision-eval/a14/pr-diag-sample.json");
const OPTIONS = ["blocking", "nit", "out_of_scope", "duplicate"];

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "decision-eval-a14-"));
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

describe("A14 corpus extraction (AC5)", () => {
	test("writes one sorted unlabeled row per thread, non-empty comment and non-empty review", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		const out = cli(EXTRACT, ["--diag", SAMPLE, "--corpus", corpus]);
		expect(out.code).toBe(0);
		const rows = readRows(corpus);
		expect(rows.map((r) => r.id)).toEqual(["acme/widgets#7/comment/501", "acme/widgets#7/review/9001", "acme/widgets#7/thread/PRRT_a", "acme/widgets#7/thread/PRRT_b"]);
		for (const row of rows) expect(row).toMatchObject({ repository: "acme/widgets", pr: 7, gold: "unlabeled", labeler: null, labelled_at: null });
		expect(rows.find((r) => r.id.endsWith("/comment/502"))).toBeUndefined();
		expect(rows.find((r) => r.id.endsWith("/review/9002"))).toBeUndefined();
		const thread = rows.find((r) => r.id.endsWith("/thread/PRRT_a"));
		expect(thread).toMatchObject({ kind: "thread", author: "rev-a", body: "This loop has no upper bound.", discussion: ["Fixed, capped at 5."], path: "src/retry.ts", line: 12, resolved: true, outdated: false });
		const review = rows.find((r) => r.id.endsWith("/review/9001"));
		expect(review).toMatchObject({ kind: "review", author: "rev-a", created_at: "2026-10-01T10:00:00Z", path: null, resolved: null });
	});

	test("re-extraction keeps existing labels and rows absent from the new diag", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		const labelled = { id: "acme/widgets#7/thread/PRRT_b", repository: "acme/widgets", pr: 7, kind: "thread", author: "rev-c", created_at: null, body: "old", discussion: [], path: null, line: null, resolved: null, outdated: null, gold: "nit", labeler: "maintainer", labelled_at: "2026-10-20T00:00:00Z" };
		const gone = { ...labelled, id: "acme/widgets#3/comment/1", pr: 3, gold: "blocking" };
		writeFileSync(corpus, `${JSON.stringify(gone)}\n${JSON.stringify(labelled)}\n`);
		expect(cli(EXTRACT, ["--diag", SAMPLE, "--corpus", corpus]).code).toBe(0);
		const rows = readRows(corpus);
		expect(rows).toHaveLength(5);
		expect(rows.find((r) => r.id === labelled.id)).toMatchObject({ gold: "nit", labeler: "maintainer", labelled_at: "2026-10-20T00:00:00Z", body: "nit: prefer const here" });
		expect(rows.find((r) => r.id === gone.id)).toMatchObject({ gold: "blocking" });
		expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort());
	});

	test("an invalid existing gold label stops before anything is written", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		const text = `${JSON.stringify({ id: "acme/widgets#7/comment/501", repository: "acme/widgets", pr: 7, kind: "comment", gold: "maybe", labeler: null, labelled_at: null })}\n`;
		writeFileSync(corpus, text);
		const out = cli(EXTRACT, ["--diag", SAMPLE, "--corpus", corpus]);
		expect(out.code).toBe(1);
		expect(out.stderr).toContain("invalid_gold_label: acme/widgets#7/comment/501");
		expect(readFileSync(corpus, "utf8")).toBe(text);
	});
});

function corpusRow(n: number, gold: string) {
	return { id: `acme/widgets#7/comment/${n}`, repository: "acme/widgets", pr: 7, kind: "comment", author: "rev", created_at: `2026-10-01T10:0${n}:00Z`, body: `comment ${n}`, discussion: [], path: null, line: null, resolved: null, outdated: null, gold, labeler: gold === "unlabeled" ? null : "maintainer", labelled_at: null };
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

const p = (blocking: number, nit: number, out_of_scope: number, duplicate: number) => ({ blocking, nit, out_of_scope, duplicate });

describe("A14 eval report (AC6; BR-SCN-1)", () => {
	test("writes the dated JSON and Markdown report against the all_blocking baseline", () => {
		const answers = {
			"acme/widgets#7/comment/1": p(0.8, 0.1, 0.05, 0.05),
			"acme/widgets#7/comment/2": p(0.1, 0.7, 0.1, 0.1),
			"acme/widgets#7/comment/3": p(0.6, 0.2, 0.1, 0.1),
		};
		// comment/4 has no fake answer and no default: unavailable/provider_error.
		const rows = [corpusRow(1, "blocking"), corpusRow(2, "nit"), corpusRow(3, "out_of_scope"), corpusRow(4, "duplicate"), corpusRow(5, "unlabeled")];
		const { root, corpus, out } = evalSetup({ profiles: { default: { kind: "fake", answers } } }, rows);
		const res = cli(RUN, ["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-01"]);
		expect(res.code).toBe(0);

		const report = JSON.parse(readFileSync(join(out, "a14-2026-11-01.json"), "utf8"));
		expect(report).toMatchObject({
			contract: "immune_brain/decision_eval_report/v1",
			application_point: "a14_pr_comment_triage",
			date: "2026-11-01",
			profile: "default",
			provider_kind: "fake",
			model: "fake",
			threshold_set_version: "a14/v0",
			counts: { total: 5, labelled: 4, unlabeled: 1, decided: 3, unavailable: { provider_error: 1 } },
		});
		expect(report.corpus_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
		const m = report.metrics;
		expect(m.accuracy).toBeCloseTo(2 / 4);
		expect(m.decided_accuracy).toBeCloseTo(2 / 3);
		expect(m.accuracy).toBeLessThan(m.decided_accuracy);
		expect(Object.keys(m.per_class)).toEqual(OPTIONS);
		expect(m.per_class.blocking).toEqual({ precision: 0.5, recall: 1, support: 1 });
		expect(typeof m.macro_f1).toBe("number");
		expect(typeof m.brier).toBe("number");
		expect(typeof m.ece).toBe("number");
		expect(m.coverage_at.map((c: { confidence: number }) => c.confidence)).toEqual([0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]);
		expect(m.coverage_at[0]).toEqual({ confidence: 0.5, coverage: 3 / 4, accuracy: 2 / 3 });
		expect(report.baseline).toMatchObject({ name: "all_blocking", accuracy: 0.25 });
		expect(typeof report.baseline.macro_f1).toBe("number");
		expect(report.cases).toHaveLength(4);
		expect(report.cases[0]).toMatchObject({ id: "acme/widgets#7/comment/1", gold: "blocking", envelope: { choice: "blocking", model: "fake", truncation: "unknown" } });
		expect(report.cases[3]).toEqual({ id: "acme/widgets#7/comment/4", gold: "duplicate", unavailable: "provider_error" });

		const md = readFileSync(join(out, "a14-2026-11-01.md"), "utf8");
		expect(md).toContain("| Baseline (all_blocking) |");
		expect(md).toContain("- `acme/widgets#7/comment/2` gold nit, choice nit (blocking=0.100, nit=0.700, out_of_scope=0.100, duplicate=0.100); model fake, model version null, threshold set a14/v0, truncation unknown");
		expect(md).toContain("- `acme/widgets#7/comment/4` gold duplicate, unavailable: provider_error");
	});

	test("a corpus with no labelled rows exits 1 with no_labelled_cases", () => {
		const { root, corpus, out } = evalSetup({ profiles: { default: { kind: "fake", answers: {} } } }, [corpusRow(1, "unlabeled")]);
		const res = cli(RUN, ["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-01"]);
		expect(res.code).toBe(1);
		expect(res.stderr).toContain("no_labelled_cases");
		expect(existsSync(out)).toBe(false);
	});

	test("every case unavailable exits 2 with no_cases_decided and still writes the report", () => {
		const { root, corpus, out } = evalSetup(undefined, [corpusRow(1, "blocking"), corpusRow(2, "nit")]);
		const res = cli(RUN, ["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-01"]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("no_cases_decided");
		const report = JSON.parse(readFileSync(join(out, "a14-2026-11-01.json"), "utf8"));
		expect(report.counts).toMatchObject({ decided: 0, unavailable: { no_local_config: 2 } });
		expect(report.cases).toEqual([
			{ id: "acme/widgets#7/comment/1", gold: "blocking", unavailable: "no_local_config" },
			{ id: "acme/widgets#7/comment/2", gold: "nit", unavailable: "no_local_config" },
		]);
	});

	test("a malformed corpus line exits 1 with corpus_invalid and its line number", () => {
		const { root, corpus, out } = evalSetup(undefined, [corpusRow(1, "blocking")]);
		writeFileSync(corpus, `${readFileSync(corpus, "utf8")}{ broken\n`);
		const res = cli(RUN, ["--corpus", corpus, "--out", out, "--root", root]);
		expect(res.code).toBe(1);
		expect(res.stderr).toContain("corpus_invalid: 2");
	});
});
