import { isAbsolute, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { acceptanceRepeatSeries } from "../../plugins/immune-brain/runtime/kernel/acceptance_repeats.ts";
import { decide } from "../../plugins/immune-brain/runtime/decision_model/decide.ts";
import type { DecideResult } from "../../plugins/immune-brain/runtime/decision_model/contract.ts";

type Finding = { source?: string; kind?: string; status?: string; acceptance_id?: string | null; review_round?: number | null; evidence?: { trigger?: string; caller_chain?: string[]; violated?: { kind?: string } } | null };
type History = { type?: string; reason?: string; authority?: { authority_kind?: string }; review_started_at?: string; review_submitted_at?: string; reviewer_model?: string };
type Attestation = { kind?: string; advisory_findings?: unknown[] };
export type AuditRecord = { task_id: string; lifecycle?: string; phase?: string; findings: Finding[]; history: History[]; attestations?: Attestation[]; approvals?: Attestation[] };

function distribution(values: number[]) {
	if (!values.length) return { count: 0, median: null, p95: null };
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return { count: sorted.length, median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2, p95: sorted[Math.ceil(sorted.length * .95) - 1]! };
}

/** Compute observational metrics; absent historical fields remain unmeasured. */
export function summarizeRecords(records: readonly AuditRecord[]) {
	const rounds: number[] = [], durations: number[] = [];
	const disposition = { resolved: 0, refuted: 0, accepted_risk: 0 };
	let blocking = 0, classified = 0, security = 0, passes = 0, advisories = 0;
	const repeats: { task_id: string; acceptance_id: string | null; finding_count: number; rounds_since_last_finding: number | null }[] = [];
	const modelRounds = new Map<string, number[]>();
	for (const record of records) {
		const reviewFindings = record.findings.filter(f => f.source === "review" && f.kind === "blocking");
		const reworks = record.history.filter(h => h.type === "request_rework" && h.authority?.authority_kind === "review");
		const reviews = (record.attestations ?? record.approvals ?? []).filter(a => a.kind === "review");
		if ((record.lifecycle === "done" || record.phase === "done") && reviews.length) {
			const n = reworks.length + 1;
			rounds.push(n);
			const modelEvents = record.history.filter(h => (h.type === "request_rework" || h.type === "record_approval") && h.authority?.authority_kind === "review");
			const models = new Set(modelEvents.flatMap(h => h.reviewer_model ? [h.reviewer_model] : []));
			if (modelEvents.length === n && modelEvents.every(h => h.reviewer_model) && models.size === 1) {
				const model = [...models][0]!;
				modelRounds.set(model, [...(modelRounds.get(model) ?? []), n]);
			}
		}
		for (const review of reviews) { passes++; advisories += review.advisory_findings?.length ?? 0; }
		for (const f of reviewFindings) {
			blocking++;
			if (f.status === "resolved" || f.status === "refuted" || f.status === "accepted_risk") disposition[f.status]++;
			const kind = f.evidence?.violated?.kind;
			if (kind === "acceptance" || kind === "security_boundary") { classified++; if (kind === "security_boundary") security++; }
		}
		for (const h of record.history) {
			if (!h.review_started_at || !h.review_submitted_at) continue;
			const start = Date.parse(h.review_started_at), end = Date.parse(h.review_submitted_at);
			if (Number.isFinite(start) && Number.isFinite(end) && end >= start) durations.push(end - start);
		}
		const latest = Math.max(0, ...reworks.map((h, i) => Number(/^review_round_(\d+)/.exec(h.reason ?? "")?.[1] ?? i + 1)), ...reviewFindings.map(f => f.review_round ?? 0)) + (reviews.length ? 1 : 0);
		for (const row of acceptanceRepeatSeries(reviewFindings.map(f => ({ acceptance_id: f.acceptance_id ?? null, review_round: f.review_round ?? null })), latest)) repeats.push({ task_id: record.task_id, ...row });
	}
	const disposed = disposition.resolved + disposition.refuted + disposition.accepted_risk;
	return { rounds_to_pass: distribution(rounds), disposition: { counts: disposition, total: disposed, shares: Object.fromEntries(Object.entries(disposition).map(([key, count]) => [key, disposed ? count / disposed : null])) }, security_boundary: { count: security, classified, blocking, share: blocking ? security / blocking : null }, advisory_per_pass: { advisories, passes, rate: passes ? advisories / passes : null }, review_duration_ms: distribution(durations), repeats, rounds_by_model: Object.fromEntries([...modelRounds].map(([model, values]) => [model, distribution(values)])) };
}

export async function classifyFindingKinds(records: readonly AuditRecord[], classify: (input: { trigger: string; caller_chain: string[] }) => Promise<DecideResult>) {
	let eligible = 0, classified = 0, mismatches = 0;
	for (const record of records) for (const finding of record.findings) {
		const evidence = finding.evidence, declared = evidence?.violated?.kind;
		if (finding.source !== "review" || finding.kind !== "blocking" || (declared !== "acceptance" && declared !== "security_boundary") || !evidence?.trigger || !Array.isArray(evidence.caller_chain)) continue;
		eligible++;
		const result = await classify({ trigger: evidence.trigger, caller_chain: evidence.caller_chain });
		// An unavailable model leaves the metric unmeasured, never a zero or a guess.
		if (result.status === "unavailable") return { experimental: true, eligible, classified, mismatches, rate: null, unavailable: { reason: result.reason, detail: result.detail } };
		if (result.envelope.choice !== "acceptance" && result.envelope.choice !== "security_boundary") throw new Error("classifier returned an invalid finding kind");
		classified++;
		if (result.envelope.choice !== declared) mismatches++;
	}
	return { experimental: true, eligible, classified, mismatches, rate: classified ? mismatches / classified : null, unavailable: null };
}

export type EvalRunArtifact = { config?: { model?: string }; scores?: Record<string, { recall: number | null; clean_fp_rate: number | null }> };

/**
 * Recall and clean-case FP rate come from committed eval runs (one model per run);
 * rounds-to-pass comes from committed records. Model-less entries are excluded from
 * every series, never counted as a model.
 */
export function byModel(summary: ReturnType<typeof summarizeRecords>, runs: readonly EvalRunArtifact[]) {
	const rows = new Map<string, { recall: Record<string, number | null>; clean_fp_rate: Record<string, number | null>; rounds_to_pass: unknown }>();
	for (const run of runs) {
		const model = run.config?.model;
		if (!model || !run.scores) continue;
		const row = rows.get(model) ?? { recall: {}, clean_fp_rate: {}, rounds_to_pass: summary.rounds_by_model[model] ?? null };
		for (const [split, value] of Object.entries(run.scores)) {
			row.recall[split] = value.recall;
			row.clean_fp_rate[split] = value.clean_fp_rate;
		}
		rows.set(model, row);
	}
	for (const [model, value] of Object.entries(summary.rounds_by_model)) {
		const row = rows.get(model) ?? { recall: {}, clean_fp_rate: {}, rounds_to_pass: value };
		row.rounds_to_pass = value;
		rows.set(model, row);
	}
	return Object.fromEntries([...rows].sort(([a], [b]) => a.localeCompare(b)));
}

/** Read the committed tree, never the live audit directory. */
export function committedRecords(root: string) {
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
	const head = git("rev-parse", "--verify", "HEAD^{commit}");
	const paths = git("ls-tree", "-r", "--name-only", head, "--", ".imm/audit").split("\n").filter(path => path.endsWith("/task-record.json"));
	const records = paths.map(path => JSON.parse(git("show", `${head}:${path}`)) as AuditRecord);
	return { head, records };
}

export function committedEvalRuns(root: string, directory: string): EvalRunArtifact[] {
	const rootPath = resolve(root), path = relative(rootPath, resolve(rootPath, directory));
	if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error("--runs must name a directory inside the repository");
	const git = (...args: string[]) => execFileSync("git", ["-C", rootPath, ...args], { encoding: "utf8" });
	const head = git("rev-parse", "--verify", "HEAD^{commit}").trim();
	const paths = git("ls-tree", "-r", "--name-only", "-z", head, "--", path).split("\0").filter(name => name.endsWith(".json")).sort();
	return paths.map(name => JSON.parse(git("show", `${head}:${name}`)) as EvalRunArtifact);
}

export function committedReport(root: string, runs: readonly EvalRunArtifact[] = []) {
	const { head, records } = committedRecords(root);
	const summary = summarizeRecords(records);
	return { head, records: records.length, ...summary, by_model: byModel(summary, runs) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	(async () => {
		const args = process.argv.slice(2), classify = args.includes("--classify"), flags = new Set(["--classify", "--runs"]);
		const roots: string[] = [], runs: string[] = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i] === "--runs") { const value = args[++i]; if (!value) throw new Error("--runs needs a directory"); runs.push(value); }
			else if (!flags.has(args[i]!)) roots.push(args[i]!);
		}
		if (roots.length > 1) throw new Error("usage: report.ts [root] [--classify] [--runs <dir>]");
		const root = roots[0] ?? ".", { head, records } = committedRecords(root);
		const artifacts = (runs.length ? runs : ["benchmark-results/review-eval"]).flatMap(dir => committedEvalRuns(root, dir));
		const summary = summarizeRecords(records);
		const mislabel = classify ? await classifyFindingKinds(records, state => decide({ point: "a17_review_finding_kind", state }, { root, env: process.env, fetch: globalThis.fetch })) : null;
		process.stdout.write(`${JSON.stringify({ head, records: records.length, ...summary, by_model: byModel(summary, artifacts), mislabel }, null, 2)}\n`);
	})().catch(error => { console.error(error); process.exitCode = 1; });
}
