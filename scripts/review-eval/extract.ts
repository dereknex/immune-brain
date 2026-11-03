import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { prescreen, type Candidate } from "./prescreen.ts";

type ObjectValue = Record<string, any>;
type Revision = { base_head: string; review_commit: string; review_tree: string };
type Case = ObjectValue & { id: string; task_id: string; split: string };

const oid = z.string().regex(/^[0-9a-f]{40,64}$/);
export const caseSchema = z.object({
	id: z.string().min(1), task_id: z.string().min(1), task_time: z.string(), round: z.number().int().positive(),
	base_head: oid, review_commit: oid, review_tree: oid, anchor: z.string().nullable(),
	evidence: z.object({ trigger: z.string(), caller_chain: z.array(z.string()), violated: z.object({ kind: z.string(), ref: z.string() }).passthrough() }).passthrough().nullable(),
	acceptance_id: z.string().nullable(), acceptance_text: z.string().nullable(),
	disposition: z.enum(["resolved", "refuted", "accepted_risk"]).nullable(), disposition_history: z.array(z.unknown()),
	gold: z.enum(["confirmed_true", "confirmed_false", "unlabeled"]), gold_location: z.object({ path: z.string(), symbol: z.string() }).nullable(),
	gold_counter_path: z.string().nullable(), labeler: z.string().nullable(), labelled_at: z.string().nullable(),
	split: z.enum(["tuning", "validation"]), clean: z.boolean(),
}).passthrough().superRefine((value, context) => {
	const invalid = value.clean ? value.anchor !== null || value.evidence !== null || value.disposition !== null :
		value.anchor === null || value.evidence === null || value.disposition === null;
	if (invalid || (value.gold === "confirmed_true" && (!value.gold_location || !value.labeler || !value.labelled_at)) ||
		(value.gold === "confirmed_false" && (!value.gold_counter_path || !value.labeler || !value.labelled_at))) {
		context.addIssue({ code: "custom", message: "case evidence or human label is incomplete" });
	}
});

function git(root: string, args: string[], input?: string): string {
	return execFileSync("git", args, { cwd: root, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function revision(value: any): Revision | null {
	if (!value || ![value.base_head, value.review_commit, value.review_tree].every((v) => typeof v === "string" && /^[0-9a-f]{40,64}$/.test(v))) return null;
	return { base_head: value.base_head, review_commit: value.review_commit, review_tree: value.review_tree };
}

/** Read only the audit tree of the named commit, never live workflow state. */
export async function extract(root: string, commit: string, enabled = false) {
	const pinned = git(root, ["rev-parse", "--verify", `${commit}^{commit}`]);
	const paths = git(root, ["ls-tree", "-r", "--name-only", pinned, "--", ".imm/audit"]).split("\n").filter((p) => p.endsWith("/task-record.json"));
	const records: ObjectValue[] = paths.map((path) => ({ ...JSON.parse(git(root, ["show", `${pinned}:${path}`])), audit_path: path }));
	const objects = new Map<string, boolean>();
	const exists = (sha: string) => {
		if (!objects.has(sha)) objects.set(sha, spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "ignore" }).status === 0);
		return objects.get(sha)!;
	};
	const cases: Case[] = [];
	const candidates: Candidate[] = [];
	const excluded: Record<string, number> = {};
	const skip = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
	for (const record of records) {
		const history: ObjectValue[] = record.history ?? [];
		const task = String(record.task_id);
		const acceptance = record.intent_snapshot?.acceptance ?? [];
		const at = history.at(-1)?.at ?? "";
		const reworks = history.filter((h) => h.type === "request_rework");
		const base = { task_id: task, task_time: at, gold: "unlabeled", gold_location: null, gold_counter_path: null, labeler: null, labelled_at: null, split: "tuning" };
		const add = (id: string, rev: Revision, fields: ObjectValue) => cases.push({ ...base, ...rev, ...fields, id });
		for (const finding of record.findings ?? []) {
			if (finding.kind !== "blocking" || finding.source !== "review") continue;
			if (!finding.anchor || !finding.evidence) { skip("missing_anchor_or_evidence"); continue; }
			if (!["resolved", "refuted", "accepted_risk"].includes(finding.status)) { skip("disposition_missing"); continue; }
			if (!Number.isInteger(finding.review_round)) { skip("missing_review_round"); continue; }
			const event = reworks.find((h) => (h.reason ?? "").split("\n")[0] === `review_round_${finding.review_round}` && revision(h.review_revision));
			const approval = (record.attestations ?? record.approvals ?? []).find((a: ObjectValue) => a.kind === "review" && a.review_round === finding.review_round && revision(a.review_revision));
			const rev = revision(event?.review_revision ?? approval?.review_revision);
			if (!rev) { skip("review_revision_missing"); continue; }
			if (!exists(rev.base_head) || !exists(rev.review_commit)) { skip("git_object_missing"); continue; }
			const id = `${record.audit_path}/${finding.review_round}/${finding.id}`;
			const disposition = finding.status;
			add(id, rev, { round: finding.review_round, anchor: finding.anchor, evidence: finding.evidence,
				acceptance_id: finding.acceptance_id ?? null,
				acceptance_text: acceptance.find((a: ObjectValue) => a.id === finding.acceptance_id)?.assertion ?? null,
				disposition, disposition_history: history.filter((h) => typeof h.reason === "string" && h.reason.split("\n")[0] === finding.id), clean: false });
			candidates.push({ id, evidence: { trigger: finding.evidence.trigger, caller_chain: finding.evidence.caller_chain, violated: finding.evidence.violated }, disposition,
				weight: (disposition === "accepted_risk" ? 4 : 0) + (reworks.length > 1 ? 2 : 0) + (history.some((h) => /budget.exhaust/i.test(h.reason ?? "")) ? 1 : 0) });
		}
		const laterFix = records.some((other) => other.task_id !== task && JSON.stringify(other.intent_snapshot ?? {}).includes(task) && (other.history?.at(-1)?.at ?? "") > at);
		if (record.lifecycle === "done" && reworks.length === 0 && !laterFix) {
			const reviews = (record.attestations ?? record.approvals ?? []).filter((a: ObjectValue) => a.kind === "review");
			for (let i = 0; i < reviews.length; i++) {
				const rev = revision(reviews[i].review_revision);
				if (!rev) { skip("review_revision_missing"); continue; }
				if (!exists(rev.base_head) || !exists(rev.review_commit)) { skip("git_object_missing"); continue; }
				add(`${record.audit_path}/clean/${i + 1}`, rev, { round: i + 1, anchor: null, evidence: null, acceptance_id: null, acceptance_text: null, disposition: null, disposition_history: [], clean: true });
			}
		}
	}
	const taskTimes = new Map<string, string>();
	for (const c of cases) {
		const time = c.task_time as string;
		if (!taskTimes.has(c.task_id) || time > taskTimes.get(c.task_id)!) taskTimes.set(c.task_id, time);
	}
	const tasks = [...taskTimes].sort((a, b) => a[1].localeCompare(b[1], "en") || a[0].localeCompare(b[0], "en"));
	const validation = new Set(tasks.slice(-Math.ceil(tasks.length * 0.2)).map(([task]) => task));
	for (const c of cases) if (validation.has(c.task_id)) c.split = "validation";
	cases.sort((a, b) => a.id.localeCompare(b.id, "en"));
	for (const c of cases) caseSchema.parse(c);
	const selection = await prescreen(candidates, { root, enabled });
	return { pinned, cases, selection, excluded };
}

/** Atomically create missing pins, refusing existing names that point elsewhere. */
export function pinCommits(root: string, cases: Case[]) {
	const commits = [...new Set(cases.flatMap((c) => [c.base_head as string, c.review_commit as string]))].sort();
	const operations: string[] = [];
	for (const sha of commits) {
		const ref = `refs/imm/review-eval/${sha}`;
		const symbolic = spawnSync("git", ["symbolic-ref", "--quiet", ref], { cwd: root, encoding: "utf8" });
		if (symbolic.status === 0) throw new Error(`symbolic pin ${ref}`);
		if (symbolic.status !== 1) throw new Error(`cannot inspect pin ${ref}`);
		const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: root, encoding: "utf8" });
		if (result.status === 0 && result.stdout.trim() !== sha) throw new Error(`conflicting pin ${ref}`);
		if (result.status === 1) operations.push(`option no-deref\ncreate ${ref} ${sha}`);
		else if (result.status === 0) operations.push(`option no-deref\nverify ${ref} ${sha}`);
		else throw new Error(`cannot inspect pin ${ref}`);
	}
	if (operations.length) git(root, ["update-ref", "--stdin"], `start\n${operations.join("\n")}\nprepare\ncommit\n`);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 1 || args.length > 2 || (args[1] && args[1] !== "--prescreen")) throw new Error("usage: bun scripts/review-eval/extract.ts <commit> [--prescreen]");
	const root = resolve(".");
	const output = await extract(root, args[0]!, args[1] === "--prescreen");
	pinCommits(root, output.cases);
	const jsonl = (values: unknown[]) => values.map((v) => JSON.stringify(v)).join("\n") + "\n";
	writeFileSync("tests/fixtures/review-eval/corpus.jsonl", jsonl(output.cases));
	writeFileSync("tests/fixtures/review-eval/selection-log.jsonl", jsonl(output.selection));
	console.error(JSON.stringify({ commit: output.pinned, cases: output.cases.length, excluded: output.excluded }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((error) => { console.error(error); process.exitCode = 1; });
