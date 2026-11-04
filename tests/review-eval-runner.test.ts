import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { anchorForEvidence } from "../plugins/immune-brain/runtime/kernel/refutation.ts";
import type { FindingEvidence } from "../plugins/immune-brain/runtime/kernel/types.ts";
import { evaluateCases, scoreCases, writeRunArtifact, type ScoredCase } from "../scripts/review-eval/run.ts";
import { byModel, classifyFindingKinds, committedEvalRuns, committedReport, summarizeRecords } from "../scripts/review-eval/report.ts";

const evidence = (path: string, ref: string): FindingEvidence => ({ trigger: "reachable", caller_chain: [path], violated: { kind: "acceptance", ref } });
const finding = (path: string, ref: string, kind = "blocking") => ({ kind, evidence: evidence(path, ref) });
const base: ScoredCase = { id: "case", split: "tuning", clean: false, gold: "confirmed_true", anchor: anchorForEvidence(evidence("old.ts", "A")), gold_location: { path: "new.ts", symbol: "run" }, findings: [] };

test("scores anchor and location matches, clean findings and confirmed false matches without unlabeled cases", () => {
	const scores = scoreCases([
		{ ...base, findings: [finding("old.ts", "A")] },
		{ ...base, id: "location", findings: [finding("new.ts", "run"), finding("other.ts", "B"), finding("ignored.ts", "C", "advisory")] },
		{ ...base, id: "miss", findings: [] },
		{ ...base, id: "false", gold: "confirmed_false", findings: [finding("old.ts", "A")] },
		{ ...base, id: "clean", clean: true, gold: "unlabeled", anchor: null, findings: [finding("new.ts", "run")] },
		{ ...base, id: "unlabeled", gold: "unlabeled", findings: [finding("other.ts", "B")] },
	]);
	expect(scores.tuning).toEqual({ recall: 2 / 3, true_cases: 3, true_cases_found: 2, clean_fp_rate: 1, clean_cases: 1, clean_findings: 1, confirmed_false_matches: 1, new_anchor_rate: 2 / 5, new_anchors: 2, blocking_findings: 5 });
	expect(scores.validation.recall).toBeNull();
	expect(scores.validation.clean_fp_rate).toBeNull();
	expect(scores.validation.new_anchor_rate).toBeNull();
});

test("replays clean cases in an isolated checkout and leaves unlabeled findings out", () => {
	const root = mkdtempSync(join(tmpdir(), "review-replay-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
	try {
		git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
		writeFileSync(join(root, "code.txt"), "before\n"); git("add", "code.txt"); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
		writeFileSync(join(root, "code.txt"), "after\n"); git("add", "code.txt"); git("commit", "-qm", "change"); const review = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}");
		const dir = join(root, ".imm/audit/task"); mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "task-record.json"), JSON.stringify({ task_id: "task", intent_snapshot: { revision: 1, risk: "routine", scope_hint: ["code.txt"], acceptance: [{ id: "A", assertion: "works", verification: "check" }] } }));
		git("add", ".imm/audit/task/task-record.json"); git("commit", "-qm", "audit");
		const common = { id: ".imm/audit/task/task-record.json/clean/1", task_id: "task", task_time: "2026-01-01", round: 1, base_head: base, review_commit: review, review_tree: tree, anchor: null, evidence: null, acceptance_id: null, acceptance_text: null, disposition: null, disposition_history: [], gold: "unlabeled" as const, gold_location: null, gold_counter_path: null, labeler: null, labelled_at: null, split: "tuning" as const, clean: true };
		let calls = 0;
		const result = evaluateCases(root, [common, { ...common, id: ".imm/audit/task/task-record.json/1/f", clean: false, anchor: "sha256:a", evidence: evidence("code.txt", "A"), disposition: "resolved" }], { model: "test/model", rolePrompt: "review" }, ({ cwd, prompt }) => {
			calls++; expect(cwd).not.toBe(root); expect(git("rev-parse", "HEAD")).not.toBe(review);
			const snapshot = /Snapshot digest: (sha256:[a-f0-9]+)/.exec(prompt)?.[1];
			return `Reviewed.\n\n\`\`\`json\n${JSON.stringify({ contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: "task", snapshot_digest: snapshot, decision: "pass", approval: { kind: "review", authority_role: "reviewer", summary: "ok", inspected_paths: ["code.txt"] } }, null, 2)}\n\`\`\`\nThat is all.`;
		});
		expect(calls).toBe(1); expect(result.scores.tuning.clean_cases).toBe(1); expect(result.scores.tuning.recall).toBeNull();
		const artifact = writeRunArtifact(join(root, "benchmark-results/review-eval"), "test", { contract: "immune_brain/review_eval_run/v1", created_at: "2026-01-01T00:00:00Z", config: { model: "test/model", role_prompt: "role.md" }, scores: result.scores });
		git("add", "benchmark-results/review-eval"); git("commit", "-qm", "eval report");
		const modelRows = byModel(summarizeRecords([]), committedEvalRuns(root, "benchmark-results/review-eval"));
		expect(modelRows["test/model"]!.clean_fp_rate.tuning).toBe(0);
		expect(modelRows["test/model"]!.recall.tuning).toBeNull();
		expect(readFileSync(artifact.replace(/\.json$/, ".md"), "utf8")).toContain("unmeasured");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("reports committed-record metrics with missing timing and classification left unmeasured", () => {
	const report = summarizeRecords([{ task_id: "t", lifecycle: "done", findings: [
		{ source: "review", kind: "blocking", status: "resolved", acceptance_id: "A", review_round: 1, evidence: { violated: { kind: "security_boundary" } } },
		{ source: "review", kind: "blocking", status: "refuted", acceptance_id: "A", review_round: 2 },
	], history: [
		{ type: "request_rework", reason: "review_round_1", authority: { authority_kind: "review" }, review_started_at: "2026-01-01T00:00:00Z", review_submitted_at: "2026-01-01T00:00:02Z", reviewer_model: "model-a" },
		{ type: "request_rework", reason: "review_round_2", authority: { authority_kind: "review" }, reviewer_model: "model-a" },
		{ type: "record_approval", authority: { authority_kind: "review" }, reviewer_model: "model-a" },
	], attestations: [{ kind: "review", advisory_findings: [{}] }] }]);
	expect(report.rounds_to_pass).toEqual({ count: 1, median: 3, p95: 3 });
	expect(report.review_duration_ms).toEqual({ count: 1, median: 2000, p95: 2000 });
	expect(report.security_boundary).toEqual({ count: 1, classified: 1, blocking: 2, share: .5 });
	expect(report.disposition.shares).toEqual({ resolved: .5, refuted: .5, accepted_risk: 0 });
	expect(report.advisory_per_pass.rate).toBe(1);
	expect(report.repeats[0]).toMatchObject({ acceptance_id: "A", finding_count: 2, rounds_since_last_finding: 1 });
	expect(report.rounds_by_model["model-a"].p95).toBe(3);
	const mixed = summarizeRecords([{ task_id: "mixed", lifecycle: "done", findings: [], history: [
		{ type: "request_rework", authority: { authority_kind: "review" }, reviewer_model: "model-a" },
		{ type: "record_approval", authority: { authority_kind: "review" }, reviewer_model: "model-b" },
	], attestations: [{ kind: "review" }] }]);
	expect(mixed.rounds_by_model).toEqual({});
	expect(summarizeRecords([]).review_duration_ms.median).toBeNull();
});

test("classifies independently of declared kind and reports unavailable models", async () => {
	const records = [{ task_id: "t", history: [], findings: [{ source: "review", kind: "blocking", evidence: { trigger: "request", caller_chain: ["api.ts"], violated: { kind: "security_boundary" } } }] }];
	const original = JSON.stringify(records);
	const result = await classifyFindingKinds(records, async input => {
		expect(input).toEqual({ trigger: "request", caller_chain: ["api.ts"] });
		return { status: "decided", envelope: { choice: "acceptance" } } as never;
	});
	expect(result).toEqual({ experimental: true, eligible: 1, classified: 1, mismatches: 1, rate: 1, unavailable: null });
	expect(JSON.stringify(records)).toBe(original);
	const unavailable = await classifyFindingKinds(records, async () => ({ status: "unavailable", reason: "egress_denied", detail: "disabled" }));
	expect(unavailable.rate).toBeNull();
	expect(unavailable.unavailable).toEqual({ reason: "egress_denied", detail: "disabled" });
});

test("breaks recall, clean-case FP rate and rounds-to-pass down by reviewer model and skips model-less input", () => {
	const summary = summarizeRecords([{ task_id: "t", lifecycle: "done", findings: [], history: [
		{ type: "record_approval", authority: { authority_kind: "review" }, reviewer_model: "model-a" },
	], attestations: [{ kind: "review" }] }]);
	const rows = byModel(summary, [
		{ config: { model: "model-a" }, scores: { tuning: { recall: 1, clean_fp_rate: 0.5 }, validation: { recall: 0, clean_fp_rate: 0 } } },
		{ scores: { tuning: { recall: 0, clean_fp_rate: 9 } } },
	]);
	expect(Object.keys(rows)).toEqual(["model-a"]);
	expect(rows["model-a"]!.recall).toEqual({ tuning: 1, validation: 0 });
	expect(rows["model-a"]!.clean_fp_rate).toEqual({ tuning: 0.5, validation: 0 });
	expect(rows["model-a"]!.rounds_to_pass).toEqual({ count: 1, median: 1, p95: 1 });
	expect(byModel(summarizeRecords([]), [{ config: { model: "model-b" }, scores: { tuning: { recall: null, clean_fp_rate: null } } }])["model-b"]!.rounds_to_pass).toBeNull();
});

test("writes the run JSON together with its Markdown summary", () => {
	const dir = mkdtempSync(join(tmpdir(), "review-run-"));
	try {
		const path = writeRunArtifact(dir, "2026-01-01-model", { contract: "immune_brain/review_eval_run/v1", created_at: "2026-01-01T00:00:00.000Z", config: { model: "provider/model", role_prompt: "p.md" }, restriction: "restricted", channel: "offline", scores: scoreCases([]) });
		expect(path).toBe(`${dir}/2026-01-01-model.json`);
		expect(JSON.parse(readFileSync(path, "utf8")).config.model).toBe("provider/model");
		expect(readFileSync(`${dir}/2026-01-01-model.md`, "utf8")).toContain("unmeasured");
		expect(() => writeRunArtifact(dir, "2026-01-01-model", { contract: "immune_brain/review_eval_run/v1", created_at: "2026-01-01T00:00:00.000Z", config: { model: "other", role_prompt: "p.md" }, scores: scoreCases([]) })).toThrow();
		expect(JSON.parse(readFileSync(path, "utf8")).config.model).toBe("provider/model");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("record report reads HEAD and ignores a modified worktree record", () => {
	const root = mkdtempSync(join(tmpdir(), "review-report-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
	try {
		git("init", "-q");
		git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
		const dir = join(root, ".imm/audit/task"); mkdirSync(dir, { recursive: true });
		const path = join(dir, "task-record.json");
		const record = { task_id: "task", lifecycle: "done", findings: [], history: [], attestations: [{ kind: "review" }] };
		writeFileSync(path, JSON.stringify(record));
		const evalDir = join(root, "benchmark-results/review-eval"); mkdirSync(evalDir, { recursive: true });
		const evalPath = join(evalDir, "run.json");
		writeFileSync(evalPath, JSON.stringify({ config: { model: "committed" }, scores: {} }));
		git("add", "--", ".imm/audit/task/task-record.json", "benchmark-results/review-eval/run.json"); git("commit", "-qm", "fixture");
		writeFileSync(evalPath, JSON.stringify({ config: { model: "dirty" }, scores: {} }));
		writeFileSync(path, JSON.stringify({ ...record, history: [{ type: "request_rework", authority: { authority_kind: "review" } }] }));
		expect(committedReport(root).rounds_to_pass.median).toBe(1);
		expect(committedEvalRuns(root, "benchmark-results/review-eval")[0]!.config!.model).toBe("committed");
		expect(() => committedEvalRuns(root, "../outside")).toThrow();
	} finally { rmSync(root, { recursive: true, force: true }); }
});
