import { afterAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { caseSchema, extract, pinCommits, carryHumanLabels } from "../scripts/review-eval/extract.ts";
import { prescreen, type Candidate } from "../scripts/review-eval/prescreen.ts";
import { POINT_REGISTRY } from "../plugins/immune-brain/runtime/decision_model/thresholds.ts";
import { resolveConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import { unavailable } from "../plugins/immune-brain/runtime/decision_model/contract.ts";

const tmp = mkdtempSync(join(tmpdir(), "review-eval-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("extracts unreachable historical objects, pins them, and refuses conflicting pins without overwriting output", async () => {
	const root = join(tmp, "repo"); mkdirSync(root);
	git(root, "init", "-q"); git(root, "config", "user.email", "test@example.com"); git(root, "config", "user.name", "Test");
	writeFileSync(join(root, "seed"), "seed\n"); git(root, "add", "seed"); git(root, "commit", "-qm", "seed");
	const tree = git(root, "rev-parse", "HEAD^{tree}");
	const makeCommit = (message: string) => execFileSync("git", ["commit-tree", tree, "-m", message], { cwd: root, encoding: "utf8" }).trim();
	const base = makeCommit("unreachable base"); const review = makeCommit("unreachable review");
	const rev = { base_head: base, review_commit: review, review_tree: tree };
	const finding = { id: "f1", kind: "blocking", status: "resolved", source: "review", review_round: 1, acceptance_id: "A1", anchor: "anchor", evidence: { trigger: "trigger", caller_chain: ["file"], violated: { kind: "acceptance", ref: "A1" } } };
	const record = { task_id: "task", lifecycle: "done", intent_snapshot: { acceptance: [{ id: "A1", assertion: "assertion" }] }, findings: [finding, { ...finding, id: "missing", review_round: 2 }], history: [
		{ type: "request_rework", reason: "review_round_1", review_revision: rev, at: "2026-01-01" },
		{ type: "request_rework", reason: "review_round_2", review_revision: { ...rev, review_commit: "f".repeat(40) }, at: "2026-01-02" },
		{ type: "resolve_finding", reason: "f1", at: "2026-01-03" },
	] };
	mkdirSync(join(root, ".imm/audit/task"), { recursive: true });
	writeFileSync(join(root, ".imm/audit/task/task-record.json"), JSON.stringify(record));
	git(root, "add", ".imm/audit"); git(root, "commit", "-qm", "audit");
	const source = git(root, "rev-parse", "HEAD");
	expect(spawnSync("git", ["branch", "--contains", review], { cwd: root, encoding: "utf8" }).stdout.trim()).toBe("");
	const first = await extract(root, source); expect(first.cases).toHaveLength(1);
	expect(first.cases[0]?.review_commit).toBe(review); expect(first.excluded.git_object_missing).toBe(1);
	expect(first.cases[0]?.gold).toBe("unlabeled"); expect(first.cases[0]?.acceptance_text).toBe("assertion");
	pinCommits(root, first.cases); pinCommits(root, first.cases);
	expect(git(root, "rev-parse", `refs/imm/review-eval/${review}`)).toBe(review);
	expect(JSON.stringify((await extract(root, source)).cases)).toBe(JSON.stringify(first.cases));
	git(root, "update-ref", `refs/imm/review-eval/${review}`, base, review);
	mkdirSync(join(root, "tests/fixtures/review-eval"), { recursive: true });
	const output = join(root, "tests/fixtures/review-eval/corpus.jsonl"); writeFileSync(output, "keep\n");
	const run = spawnSync("bun", [resolve("scripts/review-eval/extract.ts"), source], { cwd: root, encoding: "utf8" });
	expect(run.status).not.toBe(0); expect(run.stderr).toContain("conflicting pin"); expect(readFileSync(output, "utf8")).toBe("keep\n");
	const pin = `refs/imm/review-eval/${review}`;
	git(root, "update-ref", "-d", pin);
	for (const target of ["refs/heads/absent", "refs/heads/existing"]) {
		if (target.endsWith("existing")) git(root, "update-ref", target, review);
		git(root, "symbolic-ref", pin, target);
		const before = spawnSync("git", ["rev-parse", "--verify", "--quiet", target], { cwd: root, encoding: "utf8" });
		const result = spawnSync("bun", [resolve("scripts/review-eval/extract.ts"), source], { cwd: root, encoding: "utf8" });
		expect(result.status).not.toBe(0); expect(result.stderr).toContain("symbolic pin");
		expect(readFileSync(output, "utf8")).toBe("keep\n");
		expect(git(root, "symbolic-ref", pin)).toBe(target);
		const after = spawnSync("git", ["rev-parse", "--verify", "--quiet", target], { cwd: root, encoding: "utf8" });
		expect([after.status, after.stdout]).toEqual([before.status, before.stdout]);
		git(root, "update-ref", "--no-deref", "-d", pin);
	}
});

test("holdout uses the latest run of each task regardless of audit path order", async () => {
	const root = join(tmp, "recency"); mkdirSync(root);
	git(root, "init", "-q"); git(root, "config", "user.email", "test@example.com"); git(root, "config", "user.name", "Test");
	writeFileSync(join(root, "seed"), "seed\n"); git(root, "add", "seed"); git(root, "commit", "-qm", "seed");
	const commit = git(root, "rev-parse", "HEAD"); const tree = git(root, "rev-parse", "HEAD^{tree}");
	for (const [path, task_id, at] of [["a", "task-t", "2026-03-01"], ["b", "task-u", "2026-02-01"], ["z", "task-t", "2026-01-01"]]) {
		const dir = join(root, ".imm/audit", path); mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "task-record.json"), JSON.stringify({ task_id, lifecycle: "done", intent_snapshot: {}, findings: [], history: [{ type: "complete", at }], attestations: [{ kind: "review", review_revision: { base_head: commit, review_commit: commit, review_tree: tree } }] }));
	}
	git(root, "add", ".imm/audit"); git(root, "commit", "-qm", "audit");
	const result = await extract(root, "HEAD");
	expect(result.cases.filter((c) => c.task_id === "task-t").map((c) => c.split)).toEqual(["validation", "validation"]);
	expect(result.cases.find((c) => c.task_id === "task-u")?.split).toBe("tuning");
});

test("unavailable and disabled prescreens use identical weight selection without recording details", async () => {
	const candidates: Candidate[] = Array.from({ length: 35 }, (_, i) => ({ id: String(i).padStart(2, "0"), disposition: "resolved", evidence: { trigger: "t", caller_chain: [], violated: {} }, weight: i }));
	const disabled = await prescreen(candidates, { root: tmp, enabled: false });
	for (const reason of ["egress_denied", "credential_missing", "provider_error"] as const) {
		const fallback = await prescreen(candidates, { root: tmp, enabled: true, decide: async () => unavailable(reason, "secret detail") });
		expect(fallback.map((r) => [r.id, r.selected])).toEqual(disabled.map((r) => [r.id, r.selected]));
		expect(fallback.every((r) => r.path === "weight_rule")).toBe(true);
		expect(JSON.stringify(fallback)).not.toContain("secret detail");
	}
	const mixed = await prescreen(candidates, { root: tmp, enabled: true, decide: async (state) => state === candidates[0]?.evidence ? unavailable("provider_error", "ignored") : {
		status: "decided", envelope: { application_point: "a1_review_finding_prescreen", question_type: "choice", option_set: ["likely_true", "likely_false", "uncertain"], probabilities: { likely_true: 0.1, likely_false: 0.8, uncertain: 0.1 }, choice: "likely_false", confidence: 0.8, provider_kind: "clef", profile: "test", model: "clef", model_version: null, threshold_set_version: "a1/v0", input_tokens: null, context_window: null, truncation: "unknown" },
	} });
	expect(mixed.map((r) => [r.id, r.selected])).toEqual(disabled.map((r) => [r.id, r.selected]));
	expect(mixed.every((r) => r.path === "weight_rule")).toBe(true);
});

test("model disagreement and uncertainty precede the weight rule", async () => {
	const candidates: Candidate[] = [
		{ id: "weight", disposition: "resolved", evidence: { trigger: "weight", caller_chain: [], violated: {} }, weight: 10 },
		{ id: "uncertain", disposition: "resolved", evidence: { trigger: "uncertain", caller_chain: [], violated: {} }, weight: 0 },
		{ id: "disagree", disposition: "resolved", evidence: { trigger: "disagree", caller_chain: [], violated: {} }, weight: 0 },
	];
	const rows = await prescreen(candidates, { root: tmp, enabled: true, decide: async (state) => {
		const probabilities = state.trigger === "disagree" ? { likely_true: 0.05, likely_false: 0.9, uncertain: 0.05 } :
			state.trigger === "uncertain" ? { likely_true: 0.34, likely_false: 0.33, uncertain: 0.33 } : { likely_true: 0.9, likely_false: 0.05, uncertain: 0.05 };
		return { status: "decided", envelope: { application_point: "a1_review_finding_prescreen", question_type: "choice", option_set: Object.keys(probabilities), probabilities, choice: state.trigger === "disagree" ? "likely_false" : "likely_true", confidence: Math.max(...Object.values(probabilities)), provider_kind: "clef", profile: "test", model: "clef", model_version: null, threshold_set_version: "a1/v0", input_tokens: null, context_window: null, truncation: "unknown" } };
	} });
	expect(rows.map((row) => row.id)).toEqual(["disagree", "uncertain", "weight"]);
	expect(rows.every((row) => row.path === "model" && row.model === "clef")).toBe(true);
});

test("A1 registry and effective egress respect the project ceiling", () => {
	const point = POINT_REGISTRY.a1_review_finding_prescreen!;
	expect(point.input_category).toBe("finding"); expect(point.options).toEqual(["likely_true", "likely_false", "uncertain"]); expect(point.threshold_set).toEqual({ version: "a1/v0", values: null });
	const user = join(tmp, "user.json");
	for (const [requested, expected] of [["finding", ["finding"]], ["diff", []]] as const) {
		writeFileSync(user, JSON.stringify({ contract: "immune_brain/user_config/v1", decision_models: { egress: { clef: [requested] } } }));
		const config = resolveConfig(process.cwd(), { userConfigPath: user });
		expect(config.decision_models.egress.clef.value).toEqual(expected);
		expect(config.decision_models.egress.jev.value).toEqual([]); expect(config.decision_models.egress.fake.value).toEqual([]);
		if (requested === "diff") expect(config.diagnostics.some((d) => d.code === "egress_beyond_project_ceiling")).toBe(true);
	}
});

test("committed corpus has clean revisions, stable task splits and label-bound gold", () => {
	const cases = readFileSync("tests/fixtures/review-eval/corpus.jsonl", "utf8").trim().split("\n").map((line) => JSON.parse(line));
	expect(cases.every((c) => caseSchema.safeParse(c).success)).toBe(true);
	expect(cases.filter((c) => c.clean).length).toBeGreaterThanOrEqual(10);
	expect(cases.every((c) => ["tuning", "validation"].includes(c.split))).toBe(true);
	// A gold label is only ever human: it carries its labeler, its time and its evidence.
	expect(cases.every((c) => c.gold === "unlabeled" ? c.labeler === null : Boolean(c.labeler && c.labelled_at))).toBe(true);
	const splits = new Map<string, string>();
	for (const c of cases) { if (splits.has(c.task_id)) expect(c.split).toBe(splits.get(c.task_id)); splits.set(c.task_id, c.split); }
	expect(readFileSync("tests/fixtures/review-eval/README.md", "utf8").split("\n\n")[1]).toContain("silver label only");
});

test("re-extraction carries a human label and refuses to drop a labelled case", () => {
	const blank = { gold: "unlabeled", gold_location: null, gold_counter_path: null, labeler: null, labelled_at: null };
	const prior = [{ id: "a", ...blank, gold: "confirmed_true", gold_location: { path: "p", symbol: "AC1" }, labeler: "dereknex", labelled_at: "t" }, { id: "b", ...blank }];
	const fresh = [{ id: "a", ...blank }, { id: "b", ...blank }, { id: "c", ...blank }];
	const carried = carryHumanLabels(prior, fresh) as Record<string, unknown>[];
	expect(carried.find((row) => row.id === "a")?.gold).toBe("confirmed_true");
	expect(carried.find((row) => row.id === "a")?.labeler).toBe("dereknex");
	expect(carried.find((row) => row.id === "b")?.gold).toBe("unlabeled");
	expect(Object.keys(carried[0]!)).toEqual(Object.keys(fresh[0]!));
	expect(() => carryHumanLabels(prior, fresh.slice(1))).toThrow(/would leave the corpus/);
});
