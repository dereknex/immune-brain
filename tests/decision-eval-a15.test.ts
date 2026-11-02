import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const EXTRACT = join(REPO, "scripts/decision-eval/a15/extract.ts");
const SAMPLE = join(REPO, "tests/fixtures/decision-eval/a15/issue-list-sample.json");
const REPOSITORY = "acme/widgets";
const OPTIONS = ["duplicate", "needs_spec", "ready_for_agent"];

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "decision-eval-a15-"));
	dirs.push(dir);
	return dir;
}

function extract(corpus: string) {
	const proc = Bun.spawnSync(["bun", EXTRACT, "--issues", SAMPLE, "--repository", REPOSITORY, "--corpus", corpus], { cwd: REPO, env: { ...process.env } });
	return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const readRows = (path: string) =>
	readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));

describe("A15 corpus extraction (AC1)", () => {
	test("pre-fills gold from the repository's labels and stateReason and leaves other issues unlabeled", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		expect(extract(corpus).code).toBe(0);
		const rows = readRows(corpus);
		expect(rows.map((r) => [r.id, r.gold, r.labeler])).toEqual([
			["acme/widgets#1", "ready_for_agent", "repo-labels"],
			["acme/widgets#2", "needs_spec", "repo-labels"],
			["acme/widgets#3", "duplicate", "repo-labels"],
			["acme/widgets#4", "unlabeled", null],
			["acme/widgets#5", "unlabeled", null],
			["acme/widgets#6", "unlabeled", null],
		]);
		expect(rows[1]).toMatchObject({ repository: REPOSITORY, number: 2, title: "Improve onboarding", labels: ["needs-spec", "enhancement"], state: "OPEN" });
		expect(rows[2]).toMatchObject({ state: "CLOSED", state_reason: "DUPLICATE" });
		expect(rows[4]?.body).toBe("");
		expect(rows[0]?.labelled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(rows[3]?.labelled_at).toBeNull();
	});

	test("re-extraction keeps a gold label a human changed, and rows absent from the listing", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		expect(extract(corpus).code).toBe(0);
		const rows = readRows(corpus);
		const at = "2026-10-20T00:00:00Z";
		// #1: gold changed by hand, labeler still repo-labels. #4: labelled by a maintainer. #2: untouched machine label.
		rows[0] = { ...rows[0], gold: "needs_spec" };
		rows[3] = { ...rows[3], gold: "ready_for_agent", labeler: "maintainer", labelled_at: at };
		const gone = { ...rows[0], id: "acme/widgets#99", number: 99, gold: "duplicate", labeler: "maintainer", labelled_at: at };
		writeFileSync(corpus, [...rows, gone].map((r) => `${JSON.stringify(r)}\n`).join(""));
		const machineStamp = rows[1].labelled_at;

		expect(extract(corpus).code).toBe(0);
		const after = readRows(corpus);
		expect(after.find((r) => r.id === "acme/widgets#1")).toMatchObject({ gold: "needs_spec" });
		expect(after.find((r) => r.id === "acme/widgets#4")).toMatchObject({ gold: "ready_for_agent", labeler: "maintainer", labelled_at: at });
		expect(after.find((r) => r.id === "acme/widgets#2")).toMatchObject({ gold: "needs_spec", labeler: "repo-labels", labelled_at: machineStamp });
		expect(after.find((r) => r.id === gone.id)).toMatchObject({ gold: "duplicate" });
		expect(after.map((r) => r.id)).toEqual([...after.map((r) => r.id)].sort());
	});

	test("an invalid existing gold label stops before anything is written", () => {
		const corpus = join(tempDir(), "corpus.jsonl");
		const text = `${JSON.stringify({ id: "acme/widgets#1", repository: REPOSITORY, number: 1, gold: "maybe", labeler: null, labelled_at: null })}\n`;
		writeFileSync(corpus, text);
		const out = extract(corpus);
		expect(out.code).toBe(1);
		expect(out.stderr).toContain("invalid_gold_label: acme/widgets#1");
		expect(readFileSync(corpus, "utf8")).toBe(text);
	});
});

function corpusRow(n: number, gold: string) {
	return { id: `acme/widgets#${n}`, repository: REPOSITORY, number: n, title: `issue ${n}`, body: `body ${n}`, labels: ["ready-for-agent"], state: "OPEN", state_reason: "DUPLICATE", gold, labeler: gold === "unlabeled" ? null : "maintainer", labelled_at: null };
}

function evalSetup(rows: object[]) {
	const root = tempDir();
	mkdirSync(join(root, ".imm"));
	writeFileSync(join(root, ".imm/decision-bindings.json"), JSON.stringify({ contract: "immune_brain/decision_bindings/v1", default_profile: "default", bindings: {}, egress: {} }));
	writeFileSync(join(root, ".imm/decision-models.local.json"), JSON.stringify({ profiles: { default: { kind: "clef", model: "clef", account_id_env: "A15_ACCOUNT_TEST", token_env: "A15_TOKEN_TEST" } } }));
	const corpus = join(root, "corpus.jsonl");
	writeFileSync(corpus, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
	return { root, corpus, out: join(root, "reports") };
}

const probs = (duplicate: number, needs_spec: number, ready_for_agent: number) => ({ duplicate, needs_spec, ready_for_agent });

describe("A15 eval report (AC2)", () => {
	test("sends issue_text with no egress entry, one fetch per labelled case, and reports the majority_class baseline and calibration", async () => {
		const { root, corpus, out } = evalSetup([corpusRow(1, "ready_for_agent"), corpusRow(2, "ready_for_agent"), corpusRow(3, "needs_spec"), corpusRow(4, "duplicate"), corpusRow(5, "unlabeled")]);
		const bodies: string[] = [];
		const realFetch = globalThis.fetch;
		const saved = { account: process.env.A15_ACCOUNT_TEST, token: process.env.A15_TOKEN_TEST };
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			bodies.push(String(init.body));
			return Response.json({ result: { model: "clef", answers: { a15_issue_triage: { type: "choice", choice: "ready_for_agent", probabilities: probs(0.1, 0.2, 0.7), confidence: 0.7 } } }, success: true, errors: [], messages: [] });
		}) as unknown as typeof fetch;
		process.env.A15_ACCOUNT_TEST = "acct";
		process.env.A15_TOKEN_TEST = "tok";
		try {
			const { main } = await import("../scripts/decision-eval/a15/run.ts");
			expect(await main(["--corpus", corpus, "--out", out, "--root", root, "--date", "2026-11-02"])).toBe(0);
		} finally {
			globalThis.fetch = realFetch;
			for (const [key, value] of [["A15_ACCOUNT_TEST", saved.account], ["A15_TOKEN_TEST", saved.token]] as const) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}

		expect(bodies).toHaveLength(4);
		expect(bodies[0]).toContain("issue 1");
		expect(bodies[0]).toContain("body 1");
		// The labels and stateReason that produced gold must not reach the provider.
		for (const body of bodies) {
			expect(body).not.toContain("ready-for-agent");
			expect(body).not.toContain("DUPLICATE");
		}

		const report = JSON.parse(readFileSync(join(out, "a15-2026-11-02.json"), "utf8"));
		expect(report).toMatchObject({
			contract: "immune_brain/decision_eval_report/v1",
			application_point: "a15_issue_triage",
			provider_kind: "clef",
			threshold_set_version: "a15/v0",
			counts: { total: 5, labelled: 4, unlabeled: 1, decided: 4 },
		});
		expect(Object.keys(report.metrics.per_class)).toEqual(OPTIONS);
		expect(report.metrics.accuracy).toBeCloseTo(2 / 4);
		expect(report.baseline).toMatchObject({ name: "majority_class", accuracy: 2 / 4 });
		expect(typeof report.baseline.macro_f1).toBe("number");
		expect(report.calibration).toEqual({ brier: report.metrics.brier, excluded: 0 });
		expect(typeof report.calibration.brier).toBe("number");
		expect(readFileSync(join(out, "a15-2026-11-02.md"), "utf8")).toContain("| Baseline (majority_class) |");
	});

	test("a corpus with no labelled rows exits 1 with no_labelled_cases and writes nothing", () => {
		const { root, corpus, out } = evalSetup([corpusRow(1, "unlabeled")]);
		const proc = Bun.spawnSync(["bun", join(REPO, "scripts/decision-eval/a15/run.ts"), "--corpus", corpus, "--out", out, "--root", root], { cwd: REPO, env: { ...process.env } });
		expect(proc.exitCode).toBe(1);
		expect(proc.stderr.toString()).toContain("no_labelled_cases");
		expect(existsSync(out)).toBe(false);
	});
});
