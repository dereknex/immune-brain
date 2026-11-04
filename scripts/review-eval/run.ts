import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildReviewSnapshotPrompt, parseChildVerdict, type SnapshotDescriptor } from "../../plugins/immune-brain/runtime/assurance/coordinator.ts";
import { STATIC_REVIEW_RULES, currentReviewContractHash } from "../../plugins/immune-brain/runtime/role_prompt_bridge.ts";
import { caseSchema } from "./extract.ts";
import { anchorForEvidence } from "../../plugins/immune-brain/runtime/kernel/refutation.ts";
import type { FindingEvidence } from "../../plugins/immune-brain/runtime/kernel/types.ts";

/** One independently reviewed corpus case and the blocking claims returned for it. */
export type ScoredCase = {
	id: string;
	split: "tuning" | "validation";
	clean: boolean;
	gold: "confirmed_true" | "confirmed_false" | "unlabeled";
	anchor: string | null;
	gold_location: { path: string; symbol: string } | null;
	findings: { kind: string; evidence: FindingEvidence }[];
};

/** Counts and denominators are retained so an empty gold set is never reported as zero recall. */
export function scoreCases(cases: readonly ScoredCase[]) {
	return Object.fromEntries((["tuning", "validation"] as const).map((split) => {
		let trueCases = 0, found = 0, cleanCases = 0, cleanFindings = 0, falseMatches = 0, newAnchors = 0, blockingFindings = 0;
		for (const c of cases) {
			if (c.split !== split || (!c.clean && c.gold === "unlabeled")) continue;
			const findings = c.findings.filter((f) => f.kind === "blocking");
			blockingFindings += findings.length;
			if (c.clean) {
				cleanCases++;
				cleanFindings += findings.length;
				newAnchors += findings.length;
				continue;
			}
			const matches = findings.map(({ evidence }) =>
				anchorForEvidence(evidence) === c.anchor || (c.gold === "confirmed_true" && c.gold_location !== null &&
					evidence.violated.ref === c.gold_location.symbol && evidence.caller_chain[0] === c.gold_location.path));
			if (c.gold === "confirmed_true") {
				trueCases++;
				if (matches.some(Boolean)) found++;
			} else falseMatches += matches.filter(Boolean).length;
			newAnchors += matches.filter((matched) => !matched).length;
		}
		return [split, {
			recall: trueCases ? found / trueCases : null, true_cases: trueCases, true_cases_found: found,
			clean_fp_rate: cleanCases ? cleanFindings / cleanCases : null, clean_cases: cleanCases, clean_findings: cleanFindings,
			confirmed_false_matches: falseMatches,
			new_anchor_rate: blockingFindings ? newAnchors / blockingFindings : null, new_anchors: newAnchors, blocking_findings: blockingFindings,
		}];
	}));
}

type EvalCase = ReturnType<typeof caseSchema.parse>;
type Dispatch = (input: { cwd: string; model: string; rolePrompt: string; prompt: string }) => string;
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

/** Last balanced verdict object in prose-wrapped reviewer output; fences and commentary around it are tolerated. */
function verdictOf(raw: string): Record<string, unknown> {
	let found: Record<string, unknown> | null = null;
	for (const match of raw.matchAll(/\{\s*"contract"\s*:/g)) {
		const start = match.index!;
		let depth = 0, quoted = false;
		for (let i = start; i < raw.length; i++) {
			const ch = raw[i];
			if (quoted) { if (ch === "\\") i++; else if (ch === '"') quoted = false; }
			else if (ch === '"') quoted = true;
			else if (ch === "{") depth++;
			else if (ch === "}" && --depth === 0) {
				try { found = JSON.parse(raw.slice(start, i + 1)); } catch { /* keep the previous parse */ }
				break;
			}
		}
	}
	if (!found) throw new Error(`reviewer returned no verdict object: ${raw.slice(-300)}`);
	return found;
}

function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

/** Run one isolated, read-only reviewer; the configured model is never inferred from a session. */
export function dispatchPi(input: Parameters<Dispatch>[0]): string {
	const child = spawnSync("pi", ["--offline", "--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--tools", "read,bash", "--model", input.model, "--append-system-prompt", [input.rolePrompt, ...STATIC_REVIEW_RULES].join("\n"), "--mode", "json", "-p", input.prompt], { cwd: input.cwd, encoding: "utf8", timeout: 1_200_000, maxBuffer: 256 * 1024 * 1024 });
	if (child.error) throw child.error;
	if (child.status !== 0) throw new Error(`reviewer exited with status ${child.status}: ${(child.stderr ?? "").slice(-2000)}`);
	let response = "";
	for (const line of child.stdout.split("\n")) {
		if (!line.trim()) continue;
		const event = JSON.parse(line);
		if (event.type === "message_end" && event.message?.role === "assistant") {
			if (event.message.stopReason === "error" || event.message.stopReason === "aborted") throw new Error(`reviewer ended: ${event.message.errorMessage ?? event.message.stopReason}`);
			response = (event.message.content ?? []).filter((item: { type: string }) => item.type === "text").map((item: { text: string }) => item.text).join("\n");
		}
	}
	if (!response) throw new Error("reviewer returned no final text");
	return response;
}

/** Replay only labelled findings and clean controls; no live TaskRecord is read or written. */
export function evaluateCases(root: string, cases: readonly EvalCase[], config: { model: string; rolePrompt: string }, dispatch: Dispatch = dispatchPi, checkpoint?: string) {
	if (!config.model.trim() || !config.rolePrompt.trim()) throw new Error("reviewer model and prompt are required");
	const rootPath = resolve(root), temp = mkdtempSync(join(tmpdir(), "review-eval-"));
	const checkout = join(temp, "checkout");
	const scored: ScoredCase[] = [];
	const retries: string[] = [];
	const failed: { id: string; error: string }[] = [];
	// A full replay costs hours of model calls: every finished case is durable and never re-dispatched.
	// Only a case this selection still contains may be restored: a stale checkpoint from another
	// selection must never enter the scores, and must never be counted by two shards at once.
	const assigned = new Set(cases.map((item) => String((item as { id?: string }).id)));
	if (checkpoint && existsSync(checkpoint))
		for (const line of readFileSync(checkpoint, "utf8").split("\n")) if (line.trim()) {
			const row = JSON.parse(line) as ScoredCase;
			if (assigned.has(row.id)) scored.push(row);
		}
	const done = new Set(scored.map((caseRow) => caseRow.id));
	const resumed = scored.length;
	try {
		execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", "--", rootPath, checkout]);
		for (const item of cases) {
			const c = caseSchema.parse(item);
			if (!c.clean && c.gold === "unlabeled") continue;
			if (done.has(c.id)) continue;
			if (git(checkout, "rev-parse", `${c.review_commit}^{tree}`) !== c.review_tree || git(checkout, "rev-parse", `${c.review_commit}^`) !== c.base_head) throw new Error(`invalid revision for ${c.id}`);
			git(checkout, "checkout", "--quiet", "--detach", c.review_commit);
			const auditPath = c.id.split("/task-record.json/")[0] + "/task-record.json";
			if (!auditPath.startsWith(".imm/audit/") || auditPath.includes("..")) throw new Error(`invalid audit path for ${c.id}`);
			const recordBytes = git(rootPath, "show", `HEAD:${auditPath}`);
			const record = JSON.parse(recordBytes);
			if (record.task_id !== c.task_id) throw new Error(`audit task mismatch for ${c.id}`);
			const acceptance = record.intent_snapshot?.acceptance;
			if (!Array.isArray(acceptance) || !acceptance.length) throw new Error(`missing acceptance assertions for ${c.id}`);
			const paths = git(checkout, "diff", "--no-renames", "--name-only", "-z", c.base_head, c.review_commit).split("\0").filter(Boolean);
			const changedPaths: Record<string, unknown> = {};
			for (const path of paths) {
				const entry = (commit: string) => { const value = git(checkout, "ls-tree", commit, "--", path); const match = /^(\d+) \w+ ([0-9a-f]+)\t/.exec(value); return match ? { mode: match[1], oid: match[2] } : null; };
				const before = entry(c.base_head), after = entry(c.review_commit);
				changedPaths[path] = { status: before ? after ? "modified" : "deleted" : "added", mode: after?.mode ?? null, oid: after?.oid ?? null, base_mode: before?.mode ?? null, base_oid: before?.oid ?? null };
			}
			const recordRevision = digest(recordBytes), diffHash = digest(JSON.stringify(changedPaths)), intentHash = record.intent_ref?.content_hash ?? digest(JSON.stringify(record.intent_snapshot));
			const unsigned = { contract: "assurance_kernel/review_manifest/v5", task_id: c.task_id, intent_revision: record.intent_snapshot.revision, intent_content_hash: intentHash, scope: record.intent_snapshot.scope_hint ?? [], base_head: c.base_head, review_tree: c.review_tree, review_commit: c.review_commit, review_ref: "offline-eval", changed_paths: changedPaths, diff_hash: diffHash, outcomes: {}, record_revision: recordRevision, workspace_revision: recordRevision, lifecycle: "active", artifact_state: "frozen", risk: record.intent_snapshot.risk ?? "material" };
			const manifest = { ...unsigned, manifest_digest: digest(JSON.stringify(unsigned)) };
			const manifestPath = join(temp, "review-manifest.json"); writeFileSync(manifestPath, JSON.stringify(manifest));
			const snapshot: SnapshotDescriptor = { contract: "assurance_kernel/assurance_snapshot/v2", task_id: c.task_id, run_id: null, role: "review", record_revision: recordRevision, workspace_revision: recordRevision, intent_revision: unsigned.intent_revision, intent_content_hash: intentHash, diff_hash: diffHash, lifecycle: "active", artifact_state: "frozen", risk: unsigned.risk, fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_attestation_ids: [], acceptance, dirty_files: paths, review_bundle_digest: null, review_revision: { contract: "assurance_kernel/review_revision_identity/v1", base_head: c.base_head, review_commit: c.review_commit, review_tree: c.review_tree, manifest_digest: manifest.manifest_digest }, root: checkout };
			const prompt = `Offline evaluation replay. Manifest state and hashes are synthetic evaluation metadata, not live authority.\n${buildReviewSnapshotPrompt(snapshot, manifestPath)}`;
			// A transport fault is never a verdict: one retry, then the case is named as failed and the replay continues.
			// A slow reviewer is not retried: a retry costs another full timeout for the same case.
			const dispatchWithRetry = () => { try { return dispatch({ cwd: checkout, model: config.model, rolePrompt: config.rolePrompt, prompt }); }
				catch (error) { if (!/terminated/.test(String(error))) throw error; retries.push(c.id); return dispatch({ cwd: checkout, model: config.model, rolePrompt: config.rolePrompt, prompt }); } };
			let raw: string;
			try { raw = dispatchWithRetry(); }
			catch (error) {
				failed.push({ id: c.id, error: String(error).slice(0, 300) });
				console.error(JSON.stringify({ failed: c.id, error: String(error).slice(0, 120) }));
				continue;
			}
			if (!raw.trim()) { failed.push({ id: c.id, error: "reviewer returned no output" }); continue; }
			// A malformed or mismatched verdict is the reviewer's outcome, not a harness crash: it scores as no finding.
			let verdict: ReturnType<typeof parseChildVerdict>;
			try { verdict = parseChildVerdict(verdictOf(raw), snapshot); }
			catch (error) {
				failed.push({ id: c.id, error: String(error).slice(0, 300) });
				console.error(JSON.stringify({ failed: c.id, error: String(error).slice(0, 120) }));
				continue;
			}
			// `incomplete` carries no findings: it scores as a miss, never as a pass.
			scored.push({ id: c.id, split: c.split, clean: c.clean, gold: c.gold, anchor: c.anchor, gold_location: c.gold_location, findings: verdict.decision === "incomplete" ? [] : (verdict.findings ?? []).map(f => ({ kind: f.kind, evidence: f.evidence! })) });
			if (checkpoint) appendFileSync(checkpoint, `${JSON.stringify(scored.at(-1))}\n`);
		}
		return { cases: scored, scores: scoreCases(scored), retries, resumed, failed };
	} finally { rmSync(temp, { recursive: true, force: true }); }
}

export type EvalRunReport = {
	contract: "immune_brain/review_eval_run/v1";
	created_at: string;
	config: { model: string; role_prompt: string };
	[extra: string]: unknown;
};

/** One writer for every eval run: JSON plus the short Markdown summary the spec requires. */
export function writeRunArtifact(directory: string, stem: string, report: EvalRunReport & { scores: ReturnType<typeof scoreCases> }) {
	mkdirSync(directory, { recursive: true });
	const jsonPath = `${directory}/${stem}.json`, markdownPath = `${directory}/${stem}.md`;
	const rows = Object.entries(report.scores).map(([split, value]) =>
		`| ${split} | ${value.true_cases} | ${value.recall ?? "unmeasured"} | ${value.clean_cases} | ${value.clean_fp_rate ?? "unmeasured"} | ${value.new_anchor_rate ?? "unmeasured"} |`);
	const notes = [report.restriction, report.channel].filter((line): line is string => typeof line === "string");
	const markdown = [
		`# Review eval run — ${report.created_at.slice(0, 10)} — ${report.config.model.split("/").at(-1)}`,
		"",
		`- Prompt: \`${report.config.role_prompt}\``,
		`- Model: \`${report.config.model}\``,
		"",
		"| Split | Gold true cases | Recall | Clean cases | Clean-case FP rate | New-anchor rate |",
		"| --- | --- | --- | --- | --- | --- |",
		...rows,
		"",
		...notes.map((line) => `${line}\n`),
	].join("\n");
	writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
	try { writeFileSync(markdownPath, markdown, { flag: "wx" }); }
	catch (error) { rmSync(jsonPath); throw error; }
	return jsonPath;
}

const SPLITS = ["tuning", "validation"] as const;
const ADDITIVE = ["true_cases", "true_cases_found", "clean_cases", "clean_findings", "confirmed_false_matches", "new_anchors", "blocking_findings"] as const;

/** Shard scores stay additive, so a merged run reports the same ratios a single serial run would. */
export function mergeScores(parts: readonly Record<string, Record<string, number | null>>[]): ReturnType<typeof scoreCases> {
	const merged: Record<string, unknown> = {};
	for (const split of SPLITS) {
		const sum = Object.fromEntries(ADDITIVE.map((key) => [key, parts.reduce((total, part) => total + Number(part[split]?.[key] ?? 0), 0)])) as Record<string, number>;
		merged[split] = {
			recall: sum.true_cases ? sum.true_cases_found / sum.true_cases : null,
			...sum,
			clean_fp_rate: sum.clean_cases ? sum.clean_findings / sum.clean_cases : null,
			new_anchor_rate: sum.blocking_findings ? sum.new_anchors / sum.blocking_findings : null,
		};
	}
	return merged as ReturnType<typeof scoreCases>;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	try {
		const usage = "usage: bun scripts/review-eval/run.ts <provider/model> <output-stem> [--limit N] [--shard i/N] | bun scripts/review-eval/run.ts <output-stem> --merge";
		const positional: string[] = [];
		let limit: number | undefined, shard: { index: number; count: number } | undefined, merge = false;
		for (let i = 0; i < process.argv.slice(2).length; i++) {
			const flag = process.argv.slice(2)[i]!;
			if (flag === "--limit") { const value = process.argv.slice(2)[++i] ?? ""; if (!/^[1-9]\d*$/.test(value)) throw new Error(usage); limit = Number(value); }
			else if (flag === "--shard") {
				const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(process.argv.slice(2)[++i] ?? "");
				if (!match || Number(match[1]) > Number(match[2])) throw new Error(usage);
				shard = { index: Number(match[1]), count: Number(match[2]) };
			} else if (flag === "--merge") merge = true;
			else if (flag.startsWith("--")) throw new Error(usage);
			else positional.push(flag);
		}
		const [model, output] = positional;
		if (!output || (merge ? positional.length !== 1 : !model || positional.length !== 2)) throw new Error(usage);
		const dir = dirname(output), base = basename(output);
		if (merge) {
			const artifacts: Record<string, any>[] = [];
			for (let index = 1; index <= 32; index++) {
				const file = join(dir, `${base}.shard${index}.json`);
				if (!existsSync(file)) break;
				artifacts.push(JSON.parse(readFileSync(file, "utf8")));
			}
			if (!artifacts.length) throw new Error(`no ${base}.shard*.json artifacts to merge`);
			const path = writeRunArtifact(dir, base, {
				contract: "immune_brain/review_eval_run/v1", created_at: new Date().toISOString(),
				config: artifacts[0]!.config, channel: artifacts[0]!.channel, corpus: artifacts[0]!.corpus,
				corpus_sha256: artifacts[0]!.corpus_sha256, review_contract_sha256: artifacts[0]!.review_contract_sha256,
				sample: artifacts[0]!.sample ?? null, shards: artifacts.length,
				restriction: [
					`Merged from ${artifacts.length} shards; every shard restriction follows.`,
					...[...new Set(artifacts.map((artifact) => artifact.restriction))],
					...(() => {
						const expected = artifacts[0]!.sample?.selected as number | undefined;
						const replayed = artifacts.reduce((total, artifact) => total + (artifact.cases?.length ?? 0) + (artifact.failed_cases?.length ?? 0), 0);
						return expected !== undefined && replayed !== expected
							? [`ATTENTION: ${replayed} of ${expected} selected cases are accounted for; a shard's artifact is missing or incomplete.`] : [];
					})(),
				].join(" "),
				retried_after_termination: artifacts.flatMap((artifact) => artifact.retried_after_termination ?? []),
				failed_cases: artifacts.flatMap((artifact) => artifact.failed_cases ?? []),
				cases: artifacts.flatMap((artifact) => artifact.cases ?? []),
				scores: mergeScores(artifacts.map((artifact) => artifact.scores)),
			});
			process.stdout.write(`${path}\n`);
		} else {
			const corpusBytes = readFileSync("tests/fixtures/review-eval/corpus.jsonl", "utf8");
			const corpus = corpusBytes.split("\n").filter(Boolean).map(line => caseSchema.parse(JSON.parse(line)));
			// A limited run replays every labelled finding first, then clean controls in corpus order.
			const includable = corpus.filter(c => c.clean || c.gold !== "unlabeled");
			const findings = includable.filter(c => !c.clean), cleanControls = includable.filter(c => c.clean);
			const selected = limit === undefined ? includable : [...findings, ...cleanControls].slice(0, limit);
			const labelled = selected.filter(c => !c.clean).length, clean = selected.length - labelled;
			const assigned = shard ? selected.filter((_, index) => index % shard!.count === shard!.index - 1) : selected;
			const rolePrompt = "plugins/immune-brain/runtime/prompts/code-review.md";
			const reviewContractHash = currentReviewContractHash();
			const checkpoint = join(tmpdir(), `review-eval-${base}${shard ? `.shard${shard.index}` : ""}.partial.jsonl`);
			const result = evaluateCases(".", assigned, { model: model!, rolePrompt: readFileSync(rolePrompt, "utf8") }, undefined, checkpoint);
			const path = writeRunArtifact(dir, shard ? `${base}.shard${shard.index}` : base, {
				contract: "immune_brain/review_eval_run/v1", created_at: new Date().toISOString(),
				config: { model: model!, role_prompt: rolePrompt },
				channel: "offline reviewer replay in an isolated checkout; no live Kernel state, no Managed role, no TaskRecord",
				corpus: "tests/fixtures/review-eval/corpus.jsonl",
				corpus_sha256: digest(corpusBytes),
				review_contract_sha256: reviewContractHash,
				restriction: [
					"An `incomplete` verdict scores as no finding; a malformed verdict is recorded as a failed case.",
					limit === undefined
						? "Recall and confirmed-false matching cover only human-labelled cases; unlabelled findings are excluded from every denominator."
						: `Sample of ${selected.length} of ${corpus.length} cases (${labelled} labelled findings, ${clean} clean controls, corpus order): every labelled finding is included, clean-case rates come from this sample only.`,
					...(shard ? [`Shard ${shard.index}/${shard.count} replayed ${assigned.length} of those cases; shard scores are additive only.`] : []),
					...(result.failed.length ? [`${result.failed.length} case(s) failed to replay after one retry and are excluded from every denominator: ${result.failed.map((f) => f.id).join(", ")}.`] : []),
				].join(" "),
				sample: limit === undefined ? null : { limit, selected: selected.length, labelled, clean },
				shard: shard ? `${shard.index}/${shard.count}` : null,
				retried_after_termination: result.retries, failed_cases: result.failed, cases: result.cases, scores: result.scores,
			});
			if (existsSync(checkpoint)) unlinkSync(checkpoint);
			process.stdout.write(`${path}\n`);
		}
	} catch (error) { console.error(error); process.exitCode = 1; }
}
