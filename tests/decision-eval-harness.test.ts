import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplicationPoint, Envelope } from "../scripts/decision-model/contract.ts";
import { type Case, CliError, type CorpusRowBase, type DecideOutcome, buildReport, calibration, goldLabelsFor, loadCorpus, runEval } from "../scripts/decision-eval/harness.ts";

const POINT: ApplicationPoint = {
	id: "test_point",
	question_type: "choice",
	input_category: "pr_comment",
	options: ["yes", "no"],
	criteria: { yes: "y", no: "n" },
	instructions: "test",
	threshold_set: { version: "t/v0", values: null },
};
const BASELINE = { name: "all_yes", option: "yes" };

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "decision-eval-harness-"));
	dirs.push(dir);
	return dir;
};

function envelope(probabilities: Record<string, number>, choice: string): Envelope {
	return {
		application_point: POINT.id,
		question_type: "choice",
		option_set: ["yes", "no"],
		probabilities,
		choice,
		confidence: probabilities[choice] ?? 0,
		provider_kind: "fake",
		profile: "default",
		model: "fake",
		model_version: null,
		threshold_set_version: "t/v0",
		input_tokens: null,
		context_window: null,
		truncation: "unknown",
	} as Envelope;
}

const decided = (id: string, gold: string, probabilities: Record<string, number>, choice: string): Case => ({ id, gold, envelope: envelope(probabilities, choice) });
const unavailable = (id: string, gold: string): Case => ({ id, gold, unavailable: "provider_error" });
const meta = { date: "2026-11-01", corpus_sha256: "sha256:x", total: 3, labelled: 3, profile: "default", provider_kind: "fake" };

describe("calibration", () => {
	test("cases that give probability 1 to the gold option score Brier 0", () => {
		const cases = [decided("a", "yes", { yes: 1, no: 0 }, "yes"), decided("b", "no", { yes: 0, no: 1 }, "no")];
		expect(calibration(cases, POINT.options)).toEqual({ brier: 0, excluded: 0 });
	});

	test("a 0.5/0.5 two-option case scores Brier 0.5", () => {
		expect(calibration([decided("a", "yes", { yes: 0.5, no: 0.5 }, "yes")], POINT.options).brier).toBeCloseTo(0.5);
	});

	test("an unavailable case is excluded from Brier, counted in calibration.excluded and counted incorrect in accuracy", () => {
		const cases = [decided("a", "yes", { yes: 1, no: 0 }, "yes"), unavailable("b", "no")];
		const report = buildReport(POINT, BASELINE, cases, { ...meta, total: 2, labelled: 2 });
		expect(report.calibration).toEqual({ brier: 0, excluded: 1 });
		expect(report.metrics.brier).toBe(0);
		expect(report.metrics.accuracy).toBeCloseTo(1 / 2);
		expect(report.metrics.decided_accuracy).toBe(1);
	});

	test("no decided case leaves Brier null", () => {
		expect(calibration([unavailable("a", "yes")], POINT.options)).toEqual({ brier: null, excluded: 1 });
	});
});

describe("per-option metrics", () => {
	test("precision is null for an option never predicted, and macro F1 averages options with support", () => {
		const cases = [decided("a", "yes", { yes: 0.9, no: 0.1 }, "yes"), decided("b", "no", { yes: 0.8, no: 0.2 }, "yes")];
		const report = buildReport(POINT, BASELINE, cases, { ...meta, total: 2, labelled: 2 });
		expect(report.metrics.per_class.no).toEqual({ precision: null, recall: 0, support: 1 });
		expect(report.metrics.per_class.yes).toEqual({ precision: 0.5, recall: 1, support: 1 });
		expect(report.metrics.macro_f1).toBeCloseTo((2 / 3 + 0) / 2);
		expect(report.baseline).toEqual({ name: "all_yes", accuracy: 0.5, macro_f1: report.metrics.macro_f1 });
	});
});

describe("corpus loading", () => {
	const isRow = (value: unknown): value is CorpusRowBase => typeof value === "object" && value !== null && typeof (value as CorpusRowBase).id === "string";
	const labels = goldLabelsFor(POINT);

	test("a blank line 1 and an invalid gold label on line 2 is rejected with line 2, and runEval writes no report", async () => {
		const text = `\n${JSON.stringify({ id: "r1", gold: "maybe" })}\n`;
		expect(() => loadCorpus(text, labels, isRow)).toThrow(new CliError("corpus_invalid: 2"));

		const out = join(tempDir(), "reports");
		let called = false;
		const attempt = runEval<CorpusRowBase>({
			point: POINT,
			prefix: "t",
			title: "T",
			baseline: BASELINE,
			corpusBytes: Buffer.from(text),
			out,
			date: "2026-11-01",
			profile: null,
			provider_kind: null,
			isRow,
			decideRow: async (): Promise<DecideOutcome> => {
				called = true;
				return { status: "unavailable", reason: "provider_error", detail: "x" };
			},
		});
		await expect(attempt).rejects.toThrow("corpus_invalid: 2");
		expect(called).toBe(false);
		expect(existsSync(out)).toBe(false);
	});

	test("unlabeled and every option are valid gold labels; malformed JSON reports its physical line", () => {
		const ok = ["unlabeled", "yes", "no"].map((gold, i) => JSON.stringify({ id: `r${i}`, gold })).join("\n\n");
		expect(loadCorpus(ok, labels, isRow)).toHaveLength(3);
		expect(() => loadCorpus(`${JSON.stringify({ id: "r", gold: "yes" })}\n{ broken\n`, labels, isRow)).toThrow("corpus_invalid: 2");
	});
});

describe("runEval", () => {
	test("writes dated JSON and Markdown reports carrying the calibration section", async () => {
		const out = join(tempDir(), "reports");
		const rows = [
			{ id: "r1", gold: "yes" },
			{ id: "r2", gold: "no" },
			{ id: "r3", gold: "unlabeled" },
		];
		const result = await runEval<CorpusRowBase>({
			point: POINT,
			prefix: "t",
			title: "T eval",
			baseline: BASELINE,
			corpusBytes: Buffer.from(rows.map((r) => `${JSON.stringify(r)}\n`).join("")),
			out,
			date: "2026-11-01",
			profile: "default",
			provider_kind: "fake",
			isRow: (v): v is CorpusRowBase => typeof v === "object" && v !== null && typeof (v as CorpusRowBase).id === "string",
			decideRow: async (row): Promise<DecideOutcome> => (row.id === "r1" ? { status: "decided", envelope: envelope({ yes: 1, no: 0 }, "yes") } : { status: "unavailable", reason: "provider_error", detail: "boom" }),
		});
		expect(result.firstDetail).toBe("provider_error: boom");
		const json = JSON.parse(readFileSync(join(out, "t-2026-11-01.json"), "utf8"));
		expect(json).toMatchObject({ application_point: "test_point", counts: { total: 3, labelled: 2, unlabeled: 1, decided: 1, unavailable: { provider_error: 1 } }, calibration: { brier: 0, excluded: 1 } });
		const md = readFileSync(join(out, "t-2026-11-01.md"), "utf8");
		expect(md).toContain("# T eval — 2026-11-01");
		expect(md).toContain("| Baseline (all_yes) |");
		expect(md).toContain("Calibration: Brier 0.000 over 1 decided cases; 1 unavailable excluded.");
	});
});
