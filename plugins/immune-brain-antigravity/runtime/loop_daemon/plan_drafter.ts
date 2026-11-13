/**
 * Loop Daemon: Headless `draw-up` Plan Publication (S4)
 *
 * Implements D4.3 of docs/specs/loop-daemon.spec.md. The daemon drafts on an
 * isolated `imm-loop/<issue>` worktree, authors every canonical TaskIntent
 * through `imm-kernel intent author` (so the kernel, not the daemon, decides
 * validity), refuses a plan the kernel does not report `enrollment_ready`, and
 * runs `imm-kernel intent overlap` across the drafted intents. Only a plan that
 * passes all three publishes a structured summary comment carrying
 * `<!-- immune-brain:plan-digest=<sha256> -->` — the digest a later
 * `@imm-loop approve <digest>` is matched against. A routine plan under an
 * isolated posture may skip owner approval and enroll via `policy_auto`.
 *
 * The kernel, the worktree and the comment are injected seams: this module
 * decides and renders, the caller owns the process and GitHub effects.
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { stableStringify } from "../canonical_json.ts";
import type { LoopIdentityPosture } from "./identity.ts";

export const PLAN_DIGEST_MARKER = "<!-- immune-brain:plan-digest=";

/** The kernel report `imm-kernel intent overlap --json` must carry before its evidence counts. */
const INTENT_OVERLAP_CONTRACT = "assurance_kernel/intent_scope_overlap/v1";

const PLAN_DIGEST_PATTERN = /<!--\s*immune-brain:plan-digest=([0-9a-f]{64})\s*-->/i;

/** The branch one Issue's plan is drafted on. */
export function planBranchName(issueNumber: number): string {
	return `imm-loop/${issueNumber}`;
}

export interface PlanIntentDraft {
	/** Repository-relative destination the kernel authors the TaskIntent to. */
	path: string;
	/** The candidate TaskIntent the kernel validates. */
	intent: unknown;
}

export interface PlanDraftRequest {
	root: string;
	issue_number: number;
	/** Root of the isolated plan worktree the daemon created from this repository. */
	worktree_path: string;
	intents: readonly PlanIntentDraft[];
	/** The Spec to draft alongside the intents, when the plan needs one. */
	spec?: { path: string; content: string } | null;
	auto_enroll_max_risk: "none" | "routine";
	identity_posture: LoopIdentityPosture;
}

export interface KernelIntentResult {
	exit_code: number;
	/** Parsed `--json` stdout. */
	json: any;
}

export interface PlanDraftDeps {
	/** `imm-kernel intent author <path> --stdin --json` with the candidate on stdin. */
	runKernel: (input: { argv: string[]; cwd: string; stdin?: string }) => KernelIntentResult;
	/** `git worktree add -b <branch> <path>` for the isolated plan worktree. */
	createWorktree: (input: { root: string; branch: string; path: string }) => void;
	/** `gh issue comment <issue_number> --body-file -`. */
	postComment: (input: { issue_number: number; body: string }) => void;
}

export interface PlanIntentSummary {
	path: string;
	task_id: string;
	content_hash: string;
	risk: string;
}

export interface PlanDraft {
	issue_number: number;
	branch: string;
	worktree_path: string;
	digest: string;
	/** False only when every intent is routine, the posture is isolated and policy_auto admits routine. */
	requires_owner_approval: boolean;
	intents: PlanIntentSummary[];
	spec: { path: string; content_hash: string } | null;
	comment_body: string;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function short(hash: string): string {
	return hash.slice(0, 12);
}

/**
 * The plan digest: the identity an owner approval names. It covers the issue,
 * the branch, the drafted spec content and every kernel-reported intent identity,
 * so re-drafting any of them changes the digest.
 */
export function planDigest(input: {
	issue_number: number;
	branch: string;
	intents: readonly PlanIntentSummary[];
	spec: { path: string; content_hash: string } | null;
}): string {
	const intents = [...input.intents]
		.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
		.map(({ path, task_id, content_hash, risk }) => ({ path, task_id, content_hash, risk }));
	return digest(stableStringify({ issue_number: input.issue_number, branch: input.branch, spec: input.spec, intents }));
}

export function parsePlanDigest(body: string): string | null {
	const match = body.match(PLAN_DIGEST_PATTERN);
	return match ? match[1].toLowerCase() : null;
}

export interface PlanSummaryInput extends Omit<PlanDraft, "comment_body" | "digest"> {
	digest: string;
}

export function renderPlanSummary(draft: PlanSummaryInput): string {
	const intents = draft.intents.length
		? draft.intents
				.map((intent) => `- \`${intent.task_id}\` (${intent.risk}) — \`${intent.path}\` — content \`${short(intent.content_hash)}\``)
				.join("\n")
		: "- none";
	const spec = draft.spec === null ? "- Spec: none required" : `- Spec: \`${draft.spec.path}\` — content \`${short(draft.spec.content_hash)}\``;
	const approval = draft.requires_owner_approval
		? `Approve this plan with \`@imm-loop approve ${draft.digest}\`; any other change re-drafts it.`
		: "Eligible for `policy_auto` enrollment; no owner approval is required.";
	return [
		`${PLAN_DIGEST_MARKER}${draft.digest} -->`,
		`## Loop daemon plan for #${draft.issue_number}`,
		"",
		`- Branch: \`${draft.branch}\``,
		`- Worktree: \`${draft.worktree_path}\``,
		spec,
		"",
		"### TaskIntents",
		intents,
		"",
		approval,
		"",
	].join("\n");
}

function refuse(reason: string): never {
	throw new Error(reason);
}

/**
 * Draft, validate and publish one plan. Every refusal happens before the
 * comment is posted, so a rejected plan never reaches the owner as approval
 * evidence.
 */
export function draftAndPublishPlan(request: PlanDraftRequest, deps: PlanDraftDeps): PlanDraft {
	if (request.intents.length === 0) refuse("plan_intents_required: a plan needs at least one TaskIntent draft");

	const branch = planBranchName(request.issue_number);
	deps.createWorktree({ root: request.root, branch, path: request.worktree_path });

	let spec: PlanDraft["spec"] = null;
	if (request.spec) {
		const specPath = join(request.worktree_path, request.spec.path);
		mkdirSync(dirname(specPath), { recursive: true });
		writeFileSync(specPath, request.spec.content);
		spec = { path: request.spec.path, content_hash: digest(request.spec.content) };
	}

	const intents: PlanIntentSummary[] = [];
	for (const draft of request.intents) {
		const result = deps.runKernel({
			argv: ["intent", "author", draft.path, "--stdin", "--json"],
			cwd: request.worktree_path,
			stdin: `${JSON.stringify(draft.intent, null, 2)}\n`,
		});
		const verdict = result.json ?? {};
		if (result.exit_code !== 0 || verdict.valid !== true) {
			refuse(`intent_validation_failed: ${draft.path}: ${verdict.reason ?? verdict.code ?? `exit ${result.exit_code}`}`);
		}
		if (verdict.enrollment_ready !== true) {
			refuse(`intent_not_enrollment_ready: ${draft.path}: ${verdict.reason ?? verdict.code ?? "kernel did not report enrollment_ready"}`);
		}
		if (typeof verdict.content_hash !== "string" || typeof verdict.task_id !== "string" || typeof verdict.risk !== "string") {
			refuse(`intent_validation_failed: ${draft.path}: kernel result carries no task_id, risk and content_hash`);
		}
		intents.push({ path: draft.path, task_id: verdict.task_id, content_hash: verdict.content_hash, risk: verdict.risk });
	}

	if (intents.length > 1) {
		const paths = intents.map((intent) => intent.path);
		const overlap = deps.runKernel({ argv: ["intent", "overlap", ...paths, "--json"], cwd: request.worktree_path });
		const report = overlap.json ?? {};
		if (overlap.exit_code !== 0) refuse(`intent_overlap_failed: ${report.reason ?? `exit ${overlap.exit_code}`}`);
		// Fail closed: a missing or foreign report is not evidence that the intents are disjoint.
		if (report.contract !== INTENT_OVERLAP_CONTRACT || !Array.isArray(report.overlaps)) {
			refuse(`intent_overlap_unverifiable: kernel returned no ${INTENT_OVERLAP_CONTRACT} report`);
		}
		if (report.overlaps.length > 0) {
			const pairs = report.overlaps.map((entry: any) => `${entry?.task_ids?.join(" x ") ?? "unknown"}`).join(", ");
			refuse(`intent_scope_overlap: drafted intents share paths (${pairs})`);
		}
	}

	const requiresOwnerApproval =
		request.auto_enroll_max_risk !== "routine" ||
		request.identity_posture === "degraded" ||
		intents.some((intent) => intent.risk !== "routine");

	const planDigestValue = planDigest({ issue_number: request.issue_number, branch, intents, spec });
	const summary = {
		issue_number: request.issue_number,
		branch,
		worktree_path: request.worktree_path,
		digest: planDigestValue,
		requires_owner_approval: requiresOwnerApproval,
		intents,
		spec,
	};
	const commentBody = renderPlanSummary(summary);
	deps.postComment({ issue_number: request.issue_number, body: commentBody });

	return { ...summary, comment_body: commentBody };
}
