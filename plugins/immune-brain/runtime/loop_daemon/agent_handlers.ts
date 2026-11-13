/**
 * Loop Daemon: Agent-Backed Handlers (S9)
 *
 * Implements D11 items 2-5 of docs/specs/loop-daemon.spec.md (SCN-6) on top of
 * the S8 dispatch core. Every handler that needs an agent session goes through
 * `agent_runner.ts`, so a session's completion is decided from evidence and
 * never from its prose:
 *
 *   - `analyze_codebase` binds `CodebaseAnalysisProbe` to a read-only session
 *   - `draft_plan` binds `PlanDraftDeps` to a planning session whose candidate
 *     TaskIntents are authored by `imm-kernel intent author`
 *   - `publish_plan_for_approval` posts that plan summary through the S8 write port
 *   - `triage_issue` analyzes an uncached key and drafts an already-cached one
 *   - `enroll_and_drive` turns a REST-read approval into a `tracker_approval_proof`,
 *     enrolls through the Kernel's single entry, drives the Lane inside the
 *     standing `imm-loop run` process and opens the PR after settlement
 *   - `repair_pr_ci`, `repair_pr_conflict` and `address_pr_review` bind the S7
 *     deps to repair sessions in the PR's worktree, keeping the S7 attempt cap
 *
 * This module decides and composes; the session backend, the Kernel, the file
 * system and GitHub are injected seams.
 */

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveConfig, type LoopConfig } from "../config/layered_config.ts";
import { createGhTransport, type GhTransport } from "../github_issue_tracker.ts";
import { LOOP_DAEMON_ACTOR_ID } from "../kernel/actor_identity.ts";
import { projectAssurance } from "../kernel/assurance_projection.ts";
import { createBatchAuthorityRegistry, type BatchAuthorizationBinding } from "../kernel/batch_authority.ts";
import { enrollTask } from "../kernel/enrollment.ts";
import { createEnrollmentAuthorityRegistry } from "../kernel/enrollment_authority.ts";
import {
	type EnrollmentConfirmationInput,
	verifyEnrollmentConfirmation,
} from "../kernel/enrollment_confirmation.ts";
import { observeEnrollmentTaskIntent } from "../kernel/intent.ts";
import { preparePiCanary } from "../kernel/pi_canary_prepare.ts";
import { readTaskRecordRaw } from "../kernel/storage.ts";
import type { TaskRisk } from "../kernel/types.ts";
import { parseVerificationDescriptor } from "../verification_descriptor.ts";
import { createBatchKernelPort } from "../unattended/batch_kernel_port.ts";
import { createDefaultBatchGitPort } from "../unattended/batch_git.ts";
import { observeSingleTask } from "../unattended/batch_plan.ts";
import { prepareBatchPreflight } from "../unattended/batch_preflight.ts";
import type { ExecutorHost } from "../unattended/lane_supervisor.ts";
import {
	analyzeCodebase,
	analysisCacheKey,
	readCachedAnalysis,
	type CodebaseAnalysisFindings,
} from "./analysis_agent.ts";
import {
	createCliAgentSessionProvider,
	runAgentSession,
	sessionEnvironment,
	type AgentSessionEvidence,
	type AgentSessionKind,
	type AgentSessionProvider,
	type AgentSessionRecord,
} from "./agent_runner.ts";
import { dispatchLoopDrive } from "./drive_dispatcher.ts";
import { escalationKey, planEscalation } from "./escalation.ts";
import type { LoopGitHubPort } from "./github_port.ts";
import type { GuardFacts } from "./guards.ts";
import type { LoopDecisionRecord } from "./decision_record.ts";
import type { LoopHandler } from "./handlers.ts";
import { parseOwnerCommand } from "./owner_commands.ts";
import {
	draftAndPublishPlan,
	planBranchName,
	type KernelIntentResult,
	type PlanDraft,
	type PlanIntentDraft,
	type PlanIntentSummary,
} from "./plan_drafter.ts";
import { openLoopPullRequest } from "./pr_opener.ts";
import {
	DEFAULT_REPAIR_RETRY_CAP,
	addressPrReview,
	computeFailureSignature,
	repairPrCi,
	repairPrConflict,
	type DaemonPrInput,
	type RepairResult,
} from "./repair_agent.ts";
import { ensureLoopStateDir } from "./state.ts";
import type { NormalizedLoopEvent, ObservationInput, RawComment, RawPR } from "./types.ts";

/** The plan one Issue's planning chain recorded; published by the handler that owns the write. */
export const LOOP_PLAN_PUBLICATION_CONTRACT = "assurance_kernel/loop_plan_publication/v1" as const;

export interface LoopPlanPublication {
	contract: typeof LOOP_PLAN_PUBLICATION_CONTRACT;
	issue_number: number;
	branch: string;
	worktree_path: string;
	digest: string;
	requires_owner_approval: boolean;
	intents: PlanIntentSummary[];
	/** The single task this plan drives first; a multi-intent plan drives them one Lane each. */
	task_id: string;
	comment_body: string;
	drafted_at: string;
	published_at: string | null;
	published_comment_id: number | null;
}

/** The TaskIntent facts the handlers own; the Kernel remains the reader of record. */
export interface AgentTaskIntent {
	task_id: string;
	path: string;
	revision: number;
	content_hash: string;
	risk: TaskRisk;
	scope_hint: string[];
}

export interface AgentApprovalComment {
	body: string;
	author: string;
	author_association: string;
	created_at: string;
	updated_at: string;
}

export interface AgentEnrollRequest {
	root: string;
	task_id: string;
	intent: AgentTaskIntent;
	plan_digest: string;
	/** The tracker comment or policy that authorized this Enrollment, as the Kernel records it. */
	confirmation_ref: string;
	confirmation: EnrollmentConfirmationInput;
	now: string;
}

export interface AgentDriveRequest {
	root: string;
	task_id: string;
	intent: AgentTaskIntent;
	plan_digest: string;
	confirmation_ref: string;
	base_head: string;
	now: string;
}

/** One enrollable child plan entry, in the Kernel authorization registry's own shape. */
function authorityChild(child: {
	task_id: string;
	intent_path: string | null;
	intent_revision: number | null;
	intent_content_hash: string | null;
	intent_authority_hash?: string;
	blocked_by: string[];
}): {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	intent_authority_hash?: string;
	blocked_by: string[];
} {
	return {
		task_id: child.task_id,
		intent_path: child.intent_path ?? "",
		intent_revision: child.intent_revision ?? 0,
		intent_content_hash: child.intent_content_hash ?? "",
		...(child.intent_authority_hash === undefined ? {} : { intent_authority_hash: child.intent_authority_hash }),
		blocked_by: [...child.blocked_by],
	};
}

export interface AgentDriveExit {
	state: "exited" | "stopped_by_parent" | "interrupted";
	exit_code: number | null;
	generation: number;
	final_commit_sha: string | null;
	verification_evidence_digest: string | null;
}

export interface AgentDriveResult {
	settled: boolean;
	exit: AgentDriveExit | null;
	reason: string;
}

export type AgentHandlerOutcome = "executed" | "failed" | "requires_standing_daemon";

export interface AgentHandlerResult {
	outcome: AgentHandlerOutcome;
	detail: string;
}

export interface AgentHandlerContext {
	root: string;
	stateDir: string;
	loopConfig: LoopConfig;
	snapshot: ObservationInput;
	guardFacts: GuardFacts;
	gitHubPort: LoopGitHubPort;
	event: NormalizedLoopEvent | undefined;
	decision: LoopDecisionRecord;
	now: string;
	/** True only inside the standing `imm-loop run` process, which owns `loopDaemonSupervisor`. */
	standing_daemon: boolean;
}

export interface AgentHandlerPort {
	handle(handler: LoopHandler, context: AgentHandlerContext): Promise<AgentHandlerResult>;
}

export interface AgentHandlerDeps {
	sessionProvider: AgentSessionProvider;
	/** The daemon's own GitHub credential, the only one a session receives. */
	session_credential: string | null;
	turn_budget?: number;
	timeout_ms?: number;
	/** Create a daemon-owned worktree (`branch: null` is detached) and return its path. */
	createWorktree(input: { root: string; branch: string | null; name: string }): string;
	/** The PR's own worktree, created on first use. */
	prWorktree(input: { root: string; pr_number: number; branch: string }): string;
	head(input: { root: string; cwd?: string; branch?: string | null }): string | null;
	baseBranch(root: string): string;
	runKernel(input: { argv: string[]; cwd: string; stdin?: string }): KernelIntentResult;
	readIntent(task_id: string): AgentTaskIntent | null;
	readComment(input: { root: string; issue_number: number; comment_id: number }): Promise<AgentApprovalComment | null>;
	enroll(input: AgentEnrollRequest): Promise<{ record_revision: string }>;
	drive(input: AgentDriveRequest): Promise<AgentDriveResult>;
	runVerification(input: {
		root: string;
		worktree_path: string;
		task_id: string | null;
	}): Promise<{ exit_code: number; stdout: string; stderr: string }>;
	gitCommitAndPush(input: { worktree_path: string; branch: string; message: string }): Promise<{ commit_sha: string }>;
	rebaseOrMerge(input: {
		worktree_path: string;
		base_branch: string;
	}): Promise<{ success: boolean; conflicting_paths?: string[]; error?: string }>;
	now?: () => string;
}

const DEFAULT_TURN_BUDGET = 40;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const ANALYSIS_OUTPUT = ".imm-loop/analysis.json";
const PLAN_OUTPUT = ".imm-loop/plan.json";
const REPAIR_OUTPUT = ".imm-loop/repair.json";

/* ------------------------------------------------------------------ */
/* Session output schemas: the only thing read back from a session.     */
/* ------------------------------------------------------------------ */

function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseAnalysisFindings(bytes: string): CodebaseAnalysisFindings | null {
	try {
		const value = JSON.parse(bytes) as Record<string, unknown>;
		if (!value || typeof value !== "object") return null;
		if (!stringArray(value.scopes) || !stringArray(value.seams)) return null;
		if (value.questions !== undefined && !stringArray(value.questions)) return null;
		return {
			scopes: value.scopes,
			seams: value.seams,
			questions: (value.questions as string[] | undefined) ?? [],
		};
	} catch {
		return null;
	}
}

interface PlanCandidate {
	intents: PlanIntentDraft[];
	spec: { path: string; content: string } | null;
}

function parsePlanCandidate(bytes: string): PlanCandidate | null {
	try {
		const value = JSON.parse(bytes) as Record<string, unknown>;
		if (!value || typeof value !== "object" || !Array.isArray(value.intents)) return null;
		const intents: PlanIntentDraft[] = [];
		for (const entry of value.intents) {
			if (!entry || typeof entry !== "object") return null;
			const draft = entry as Record<string, unknown>;
			if (typeof draft.path !== "string" || !draft.path.endsWith(".intent.json")) return null;
			if (!draft.intent || typeof draft.intent !== "object") return null;
			intents.push({ path: draft.path, intent: draft.intent });
		}
		const specRaw = value.spec;
		let spec: PlanCandidate["spec"] = null;
		if (specRaw !== undefined && specRaw !== null) {
			if (typeof specRaw !== "object") return null;
			const parsed = specRaw as Record<string, unknown>;
			if (typeof parsed.path !== "string" || typeof parsed.content !== "string") return null;
			spec = { path: parsed.path, content: parsed.content };
		}
		return { intents, spec };
	} catch {
		return null;
	}
}

interface RepairSessionResult {
	success: boolean;
	modified_paths: string[];
	reason?: string;
}

function parseRepairResult(bytes: string): RepairSessionResult | null {
	try {
		const value = JSON.parse(bytes) as Record<string, unknown>;
		if (!value || typeof value !== "object" || typeof value.success !== "boolean") return null;
		if (!stringArray(value.modified_paths)) return null;
		if (value.reason !== undefined && typeof value.reason !== "string") return null;
		return {
			success: value.success,
			modified_paths: value.modified_paths,
			...(value.reason === undefined ? {} : { reason: value.reason }),
		};
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------ */
/* Plan publication records (rebuildable orchestration state, not authority). */
/* ------------------------------------------------------------------ */

function planDirectory(stateDir: string): string {
	return join(stateDir, "plans");
}

function planPath(stateDir: string, issueNumber: number): string {
	return join(planDirectory(stateDir), `${issueNumber}.json`);
}

export function readPlanPublication(stateDir: string, issueNumber: number): LoopPlanPublication | null {
	try {
		const parsed = JSON.parse(readFileSync(planPath(stateDir, issueNumber), "utf8")) as LoopPlanPublication;
		if (parsed && parsed.contract === LOOP_PLAN_PUBLICATION_CONTRACT && parsed.issue_number === issueNumber) return parsed;
	} catch {}
	return null;
}

export function writePlanPublication(stateDir: string, plan: LoopPlanPublication): void {
	ensureLoopStateDir(stateDir);
	mkdirSync(planDirectory(stateDir), { recursive: true, mode: 0o700 });
	const path = planPath(stateDir, plan.issue_number);
	writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {}
}

/** The approval digest a `/approve <digest>` or `@imm-loop approve <digest>` comment names. */
export function parseApprovalDigest(body: string): string | null {
	const match = (body ?? "").match(/(?:\/approve|@imm-loop\s+approve)\s+([0-9a-f]{64})\b/i);
	return match ? match[1].toLowerCase() : null;
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

interface IssueFacts {
	number: number;
	title: string;
	body: string;
}

function issueOf(context: AgentHandlerContext): IssueFacts | null {
	const event = context.event;
	if (!event) {
		const number = Number(context.decision.target.id);
		const raw = context.snapshot.issues.find((issue) => issue.number === number);
		return raw ? { number: raw.number, title: raw.title, body: raw.body ?? "" } : null;
	}
	if (event.kind === "E1_NEW_ISSUE" || event.kind === "E2_ISSUE_EDITED") {
		return { number: event.issue_number, title: event.title, body: event.body };
	}
	const number = "issue_number" in event ? event.issue_number : Number(context.decision.target.id);
	const resolved = number ?? Number(context.decision.target.id);
	const raw = context.snapshot.issues.find((issue) => issue.number === resolved);
	if (raw) return { number: raw.number, title: raw.title, body: raw.body ?? "" };
	return Number.isFinite(resolved) ? { number: resolved, title: "", body: "" } : null;
}

function taskIdOfEvent(context: AgentHandlerContext): string | null {
	const event = context.event;
	if (event && "task_id" in event && typeof event.task_id === "string" && event.task_id) return event.task_id;
	if (event && "initiative_slug" in event && typeof event.initiative_slug === "string" && event.initiative_slug)
		return event.initiative_slug;
	return null;
}

/** `imm/<slug>` or `imm-loop/<issue>` names the task a daemon PR belongs to. */
function taskIdOfBranch(branch: string | undefined | null): string | null {
	if (!branch) return null;
	const match = branch.match(/^imm(?:-loop)?\/(.+)$/);
	return match ? match[1] : null;
}

function daemonPrInput(pr: RawPR): DaemonPrInput {
	return {
		number: pr.number,
		title: pr.title,
		body: pr.body ?? null,
		head_ref_name: pr.head_ref_name,
		head_sha: pr.head_sha,
		base_ref_name: pr.base_ref_name,
		state: pr.state,
		merged: pr.merged,
		checks: pr.checks,
		reviews: pr.reviews,
		review_comments: pr.review_comments,
		comments: pr.comments,
	};
}

function existingCommentsOf(context: AgentHandlerContext, issueNumber: number): RawComment[] {
	return context.snapshot.issues.find((issue) => issue.number === issueNumber)?.comments ?? [];
}

/** One owner-visible escalation per key: the first posts, later ones update in place. */
async function escalateOnce(
	context: AgentHandlerContext,
	kind: string,
	target: string,
	detail: string,
	message: string,
): Promise<string> {
	const key = escalationKey({ kind, target, detail });
	const targetNumber = Number.parseInt(target.replace(/^[a-z]+-/, ""), 10);
	const existing = Number.isFinite(targetNumber) ? existingCommentsOf(context, targetNumber) : [];
	const plan = planEscalation(existing, { key, message });
	if (plan.action === "post" && Number.isFinite(targetNumber)) {
		const posted = await context.gitHubPort.postComment(targetNumber, plan.body);
		existing.push({
			id: posted.id,
			body: plan.body,
			user: { login: context.guardFacts.daemon_identity ?? "daemon" },
			author_association: "COLLABORATOR",
			created_at: context.now,
			updated_at: context.now,
		});
	} else if (plan.action === "update" && plan.comment_id) {
		await context.gitHubPort.editComment(plan.comment_id, plan.body);
	}
	return `escalated key=${key} action=${plan.action}`;
}

function mapRepairResult(result: RepairResult): AgentHandlerResult {
	const detail = `PR #${result.pr_number}: ${result.action} — ${result.reason}`;
	if (result.action === "repaired" || result.action === "marked_ready" || result.action === "closed_out" || result.action === "ignored")
		return { outcome: "executed", detail };
	return { outcome: "failed", detail };
}

function requireSession(
	record: AgentSessionRecord,
): AgentHandlerResult | null {
	if (record.status === "completed") return null;
	return { outcome: "failed", detail: `${record.kind} session failed: ${record.reason}` };
}

export function createAgentHandlerPort(deps: AgentHandlerDeps): AgentHandlerPort {
	const now = deps.now ?? (() => new Date().toISOString());
	const turnBudget = deps.turn_budget ?? DEFAULT_TURN_BUDGET;
	const timeoutMs = deps.timeout_ms ?? DEFAULT_TIMEOUT_MS;

	async function runSession(
		context: AgentHandlerContext,
		input: {
			kind: AgentSessionKind;
			worktree_path: string;
			output_path: string;
			prompt: string;
			evidence?: AgentSessionEvidence;
		},
	): Promise<AgentSessionRecord> {
		return runAgentSession(
			{
				kind: input.kind,
				worktree_path: input.worktree_path,
				prompt: input.prompt,
				output_path: input.output_path,
				turn_budget: turnBudget,
				timeout_ms: timeoutMs,
				env: sessionEnvironment(deps.session_credential),
			},
			deps.sessionProvider,
			input.evidence ?? {},
		);
	}

	async function analyze(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: "analyze_codebase needs an Issue target" };
		const baseTreeSha = deps.head({ root: context.root, cwd: context.root });
		if (!baseTreeSha) return { outcome: "failed", detail: "analyze_codebase could not read the repository HEAD" };

		const probeInput = {
			issue_number: issue.number,
			issue_body: issue.body,
			base_tree_sha: baseTreeSha,
		};
		const cacheKey = analysisCacheKey(probeInput);
		const cached = readCachedAnalysis(context.stateDir, cacheKey);
		if (cached) {
			return {
				outcome: "executed",
				detail: `analysis ${cacheKey.slice(0, 12)} cached scopes=${cached.findings.scopes.join(",") || "none"}`,
			};
		}

		const worktree = deps.createWorktree({ root: context.root, branch: null, name: `analysis-${issue.number}` });
		const session = await runSession(context, {
			kind: "analysis",
			worktree_path: worktree,
			output_path: ANALYSIS_OUTPUT,
			prompt: [
				`Read-only codebase analysis for Issue #${issue.number}: ${issue.title}`,
				"",
				issue.body.slice(0, 4000),
				"",
				'Write JSON {"scopes": ["repository-relative paths the plan will touch"], "seams": ["existing modules the plan should extend"], "questions": ["facts the plan must settle"]}.',
				"Do not modify any file in this worktree.",
			].join("\n"),
			evidence: { validate: (bytes) => parseAnalysisFindings(bytes) !== null },
		});
		const refused = requireSession(session);
		if (refused) return refused;
		const findings = parseAnalysisFindings(session.output ?? "");
		if (!findings) return { outcome: "failed", detail: `analysis session produced no valid findings: ${session.output_path}` };

		const result = analyzeCodebase({
			...probeInput,
			stateDir: context.stateDir,
			probe: () => findings,
			now: context.now,
		});
		return {
			outcome: "executed",
			detail: `analysis ${result.entry.cache_key.slice(0, 12)} cached=false scopes=${result.entry.findings.scopes.join(",") || "none"}`,
		};
	}

	async function draftPlan(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: "draft_plan needs an Issue target" };
		const branch = planBranchName(issue.number);
		const worktree = deps.createWorktree({ root: context.root, branch, name: `plan-${issue.number}` });
		const session = await runSession(context, {
			kind: "planning",
			worktree_path: worktree,
			output_path: PLAN_OUTPUT,
			prompt: [
				`Draft the plan for Issue #${issue.number}: ${issue.title}`,
				"",
				issue.body.slice(0, 4000),
				"",
				'Write JSON {"intents": [{"path": "docs/plans/<task-id>.intent.json", "intent": {<TaskIntent body>}}], "spec": null}.',
				"The daemon authors every intent through `imm-kernel intent author`; you supply the candidate bodies only.",
				`Commit the Spec you draft, if any, on the current branch (${branch}).`,
			].join("\n"),
			evidence: {
				validate: (bytes) => parsePlanCandidate(bytes) !== null,
				branch,
				expect_head_change: true,
			},
		});
		const refused = requireSession(session);
		if (refused) return refused;
		const candidate = parsePlanCandidate(session.output ?? "");
		if (!candidate) return { outcome: "failed", detail: `planning session produced no valid candidate: ${session.output_path}` };

		let draft: PlanDraft;
		try {
			draft = draftAndPublishPlan(
				{
					root: context.root,
					issue_number: issue.number,
					worktree_path: worktree,
					intents: candidate.intents,
					spec: candidate.spec,
					auto_enroll_max_risk: context.loopConfig.auto_enroll_max_risk,
					identity_posture: context.guardFacts.identity_posture ?? "degraded",
				},
				{
					runKernel: deps.runKernel,
					// The session worktree is this handler's own; nothing is created here.
					createWorktree: () => {},
					// Publication belongs to `publish_plan_for_approval`, which owns the write port.
					postComment: () => {},
				},
			);
		} catch (error) {
			return { outcome: "failed", detail: `plan refused: ${error instanceof Error ? error.message : String(error)}` };
		}

		const taskId = draft.intents[0]?.task_id;
		if (!taskId) return { outcome: "failed", detail: "drafted plan names no task" };
		writePlanPublication(context.stateDir, {
			contract: LOOP_PLAN_PUBLICATION_CONTRACT,
			issue_number: issue.number,
			branch: draft.branch,
			worktree_path: draft.worktree_path,
			digest: draft.digest,
			requires_owner_approval: draft.requires_owner_approval,
			intents: draft.intents,
			task_id: taskId,
			comment_body: draft.comment_body,
			drafted_at: now(),
			published_at: null,
			published_comment_id: null,
		});

		// The planning chain publishes what it drafted: nothing else dispatches the
		// summary, and an owner cannot approve a plan they cannot see.
		const published = await publishPlan(context);
		if (published.outcome !== "executed") return published;

		return {
			outcome: "executed",
			detail: `drafted plan ${draft.digest.slice(0, 12)} for #${issue.number} intents=${draft.intents.map((intent) => intent.task_id).join(",")} owner_approval=${draft.requires_owner_approval}; ${published.detail}`,
		};
	}

	async function publishPlan(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: "publish_plan_for_approval needs an Issue target" };
		const plan = readPlanPublication(context.stateDir, issue.number);
		if (!plan) return { outcome: "failed", detail: `no drafted plan for #${issue.number}` };

		if (plan.published_comment_id !== null) {
			await context.gitHubPort.editComment(plan.published_comment_id, plan.comment_body);
			return {
				outcome: "executed",
				detail: `updated plan ${plan.digest.slice(0, 12)} for #${issue.number} in comment #${plan.published_comment_id}`,
			};
		}

		const posted = await context.gitHubPort.postComment(issue.number, plan.comment_body);
		writePlanPublication(context.stateDir, {
			...plan,
			published_at: plan.published_at ?? now(),
			published_comment_id: posted.id,
		});
		return {
			outcome: "executed",
			detail: `published plan ${plan.digest.slice(0, 12)} for #${issue.number} as comment #${posted.id}`,
		};
	}

	async function triage(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: "triage_issue needs an Issue target" };
		const baseTreeSha = deps.head({ root: context.root, cwd: context.root });
		if (!baseTreeSha) return { outcome: "failed", detail: "triage_issue could not read the repository HEAD" };
		const cached = readCachedAnalysis(
			context.stateDir,
			analysisCacheKey({ issue_number: issue.number, issue_body: issue.body, base_tree_sha: baseTreeSha }),
		);
		if (!cached) {
			const analyzed = await analyze(context);
			if (analyzed.outcome !== "executed") return analyzed;
		}
		const drafted = await draftPlan(context);
		if (drafted.outcome !== "executed") return drafted;
		return { outcome: "executed", detail: `${cached ? "analysis cached" : "analysis probed"}; ${drafted.detail}` };
	}

	function approvalCommentOf(context: AgentHandlerContext): { issue_number: number; comment_id: number } | null {
		const event = context.event;
		if (!event) return null;
		if (event.kind === "E4_PLAN_APPROVED") return { issue_number: event.issue_number, comment_id: event.comment_id };
		if (event.kind === "E3_OWNER_COMMENT" && (parseApprovalDigest(event.body) !== null || parseOwnerCommand(event.body)?.command === "approve"))
			return { issue_number: event.issue_number, comment_id: event.comment_id };
		return null;
	}

	type ResolvedConfirmation =
		| {
				ok: true;
				input: EnrollmentConfirmationInput;
				source: "tracker_approval" | "policy_auto";
				confirmation_ref: string;
		  }
		| { ok: false; reason: string };

	/**
	 * The only two unattended sources. `tracker_approval` is built from the REST
	 * read of the approving comment, never from an event body, so an edited or
	 * daemon-authored comment cannot become authority.
	 */
	async function resolveConfirmation(
		context: AgentHandlerContext,
		issue: IssueFacts,
		plan: LoopPlanPublication,
		intent: AgentTaskIntent,
	): Promise<ResolvedConfirmation> {
		const policy = {
			allowed_actors: context.loopConfig.allowed_actors,
			allowed_associations: context.loopConfig.allowed_associations,
			daemon_identity: context.guardFacts.daemon_identity ?? "",
			plan_digest: plan.digest,
			plan_published_at: plan.published_at ?? "",
		};

		const approval = approvalCommentOf(context);
		if (approval) {
			const comment = await deps.readComment({
				root: context.root,
				issue_number: approval.issue_number,
				comment_id: approval.comment_id,
			});
			if (!comment) return { ok: false, reason: `tracker_approval_unreadable: comment ${approval.comment_id} of #${approval.issue_number}` };
			const named = parseApprovalDigest(comment.body);
			if (named === null) return { ok: false, reason: `tracker_approval_names_no_digest: comment ${approval.comment_id}` };
			const input: EnrollmentConfirmationInput = {
				source: "tracker_approval",
				tracker_approval: {
					proof: {
						issue_number: approval.issue_number,
						comment_id: approval.comment_id,
						actor_login: comment.author,
						author_association: comment.author_association,
						created_at: comment.created_at,
						updated_at: comment.updated_at,
						plan_digest: named,
					},
					policy,
				},
			};
			const verdict = verifyEnrollmentConfirmation(context.root, input, intent);
			if (!verdict.ok) return { ok: false, reason: verdict.reason };
			return {
				ok: true,
				input,
				source: "tracker_approval",
				confirmation_ref: `github:issue-${approval.issue_number}:comment-${approval.comment_id}`,
			};
		}

		const input: EnrollmentConfirmationInput = {
			source: "policy_auto",
			policy_auto: {
				mode: context.loopConfig.mode,
				auto_enroll_max_risk: context.loopConfig.auto_enroll_max_risk,
				identity_posture: context.guardFacts.identity_posture ?? "degraded",
			},
		};
		const verdict = verifyEnrollmentConfirmation(context.root, input, intent);
		if (!verdict.ok) return { ok: false, reason: verdict.reason };
		return { ok: true, input, source: "policy_auto", confirmation_ref: `policy_auto:${plan.digest}` };
	}

	async function enrollAndDrive(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: "enroll_and_drive needs an Issue target" };
		const plan = readPlanPublication(context.stateDir, issue.number);
		if (!plan) return { outcome: "failed", detail: `no published plan for #${issue.number}` };
		if (plan.published_at === null)
			return { outcome: "failed", detail: `plan ${plan.digest.slice(0, 12)} for #${issue.number} is not published yet` };

		const taskId = taskIdOfEvent(context) ?? plan.task_id;
		if (!plan.intents.some((intent) => intent.task_id === taskId))
			return { outcome: "failed", detail: `task ${taskId} is not in the published plan for #${issue.number}` };
		const intent = deps.readIntent(taskId);
		if (!intent) return { outcome: "failed", detail: `task intent is not readable: ${taskId}` };

		const confirmation = await resolveConfirmation(context, issue, plan, intent);
		if (!confirmation.ok) {
			const escalated = await escalateOnce(
				context,
				"enroll_rejected",
				`issue-${issue.number}`,
				confirmation.reason,
				`Enrollment refused for #${issue.number}: ${confirmation.reason}`,
			);
			return { outcome: "failed", detail: `${confirmation.reason} (${escalated})` };
		}

		// Driving belongs to the process that owns `loopDaemonSupervisor`.
		if (!context.standing_daemon)
			return {
				outcome: "requires_standing_daemon",
				detail: `enroll_and_drive drives ${taskId} only inside imm-loop run (${confirmation.source} verified)`,
			};

		const baseHead = deps.head({ root: context.root, cwd: context.root });
		if (!baseHead) return { outcome: "failed", detail: "enroll_and_drive could not read the repository HEAD" };

		let recordRevision: string;
		try {
			const enrolled = await deps.enroll({
				root: context.root,
				task_id: taskId,
				intent,
				plan_digest: plan.digest,
				confirmation_ref: confirmation.confirmation_ref,
				confirmation: confirmation.input,
				now: now(),
			});
			recordRevision = enrolled.record_revision;
		} catch (error) {
			return {
				outcome: "failed",
				detail: `enrollment failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
			};
		}

		const driven = await deps.drive({
			root: context.root,
			task_id: taskId,
			intent,
			plan_digest: plan.digest,
			confirmation_ref: confirmation.confirmation_ref,
			base_head: baseHead,
			now: now(),
		});
		if (!driven.settled) return { outcome: "failed", detail: `lane did not settle: ${driven.reason}` };
		const exit = driven.exit;
		if (!exit || exit.state !== "exited" || exit.exit_code !== 0)
			return {
				outcome: "failed",
				detail: `executor exit is not a delivery: ${exit ? `state=${exit.state} exit_code=${exit.exit_code}` : "no exit recorded"}`,
			};
		if (!exit.verification_evidence_digest)
			return { outcome: "failed", detail: `executor exit carries no verification evidence for ${taskId}` };

		const opened = await openLoopPullRequest(
			{
				slug: taskId,
				task_id: taskId,
				issue_number: issue.number,
				risk: intent.risk,
				base: deps.baseBranch(context.root),
				title: `imm(${taskId}): deliver #${issue.number}`,
				verification_summary: [
					`Verification evidence digest: \`${exit.verification_evidence_digest}\``,
					`Commit SHA: \`${exit.final_commit_sha ?? "unknown"}\``,
				].join("\n"),
			},
			context.gitHubPort,
		);

		return {
			outcome: "executed",
			detail: `enrolled ${taskId} via ${confirmation.source} (record ${recordRevision}); drove the Lane to settlement (generation ${exit.generation}, exit ${exit.exit_code}); opened PR #${opened.number} on ${opened.branch}`,
		};
	}

	async function repairCi(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const event = context.event;
		if (!event || event.kind !== "E8_PR_CHECK_FAILED")
			return { outcome: "failed", detail: "repair_pr_ci needs an E8_PR_CHECK_FAILED event" };
		const pr = context.snapshot.pull_requests.find((entry) => entry.number === event.pr_number);
		if (!pr) return { outcome: "failed", detail: `PR #${event.pr_number} not found` };
		const taskId = taskIdOfBranch(pr.head_ref_name) ?? `pr-${pr.number}`;
		const intent = deps.readIntent(taskId);
		const worktree = deps.prWorktree({ root: context.root, pr_number: pr.number, branch: pr.head_ref_name });

		const result = await repairPrCi({
			pr: daemonPrInput(pr),
			check: {
				name: event.check_name,
				failure_signature: event.failure_signature || computeFailureSignature(event.check_name, null),
				log_excerpt: null,
				details_url: event.details_url,
			},
			context: {
				worktree_path: worktree,
				task_id: taskId,
				scope_hint: intent?.scope_hint,
				state_dir: context.stateDir,
				retry_cap: DEFAULT_REPAIR_RETRY_CAP,
			},
			deps: {
				runVerification: (path) => deps.runVerification({ root: context.root, worktree_path: path, task_id: intent?.task_id ?? null }),
				applyFix: async (input) => {
					const session = await runSession(context, {
						kind: "repair",
						worktree_path: input.worktree_path,
						output_path: REPAIR_OUTPUT,
						prompt: [
							`Reproduce and fix the failing check ${input.check_name} (signature ${input.failure_signature.toLowerCase()}).`,
							`Stay inside the task scope: ${(input.scope_hint ?? []).join(", ") || "unknown"}.`,
							'Write JSON {"success": bool, "modified_paths": ["repository-relative paths"], "reason": "..."}.',
						].join("\n"),
						evidence: { validate: (bytes) => parseRepairResult(bytes) !== null, branch: pr.head_ref_name },
					});
					const parsed = session.status === "completed" ? parseRepairResult(session.output ?? "") : null;
					if (!parsed) return { success: false, modified_paths: [], reason: `${session.kind} session failed: ${session.reason}` };
					return parsed;
				},
				gitCommitAndPush: deps.gitCommitAndPush,
			},
		});
		return mapRepairResult(result);
	}

	async function repairConflict(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const event = context.event;
		if (!event || event.kind !== "E9_PR_CONFLICT")
			return { outcome: "failed", detail: "repair_pr_conflict needs an E9_PR_CONFLICT event" };
		const pr = context.snapshot.pull_requests.find((entry) => entry.number === event.pr_number);
		if (!pr) return { outcome: "failed", detail: `PR #${event.pr_number} not found` };
		const taskId = taskIdOfBranch(pr.head_ref_name) ?? `pr-${pr.number}`;
		const intent = deps.readIntent(taskId);
		const worktree = deps.prWorktree({ root: context.root, pr_number: pr.number, branch: pr.head_ref_name });

		const result = await repairPrConflict({
			pr: daemonPrInput(pr),
			context: {
				worktree_path: worktree,
				task_id: taskId,
				scope_hint: intent?.scope_hint,
				state_dir: context.stateDir,
			},
			deps: {
				rebaseOrMerge: deps.rebaseOrMerge,
				runVerification: (path) => deps.runVerification({ root: context.root, worktree_path: path, task_id: intent?.task_id ?? null }),
				gitCommitAndPush: deps.gitCommitAndPush,
			},
		});
		return mapRepairResult(result);
	}

	async function addressReview(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const event = context.event;
		if (!event || event.kind !== "E10_PR_REVIEW_COMMENT")
			return { outcome: "failed", detail: "address_pr_review needs an E10_PR_REVIEW_COMMENT event" };
		const pr = context.snapshot.pull_requests.find((entry) => entry.number === event.pr_number);
		if (!pr) return { outcome: "failed", detail: `PR #${event.pr_number} not found` };
		const taskId = taskIdOfBranch(pr.head_ref_name) ?? `pr-${pr.number}`;
		const intent = deps.readIntent(taskId);
		const worktree = deps.prWorktree({ root: context.root, pr_number: pr.number, branch: pr.head_ref_name });
		const scopeHint = intent?.scope_hint ?? [];

		const result = await addressPrReview({
			pr: daemonPrInput(pr),
			comment: {
				id: event.comment_id,
				body: event.body,
				path: event.path,
				line: event.line,
				author: event.author,
				author_association: event.author_association,
			},
			context: {
				worktree_path: worktree,
				task_id: taskId,
				scope_hint: intent?.scope_hint,
				state_dir: context.stateDir,
			},
			deps: {
				// Until S10 binds `a14_pr_comment_triage`, a comment is scope-changing
				// unless the path it names already lies inside the TaskIntent scope.
				classifyComment: async ({ comment }) => ({
					is_scope_changing: comment.path === undefined || !pathInScope(comment.path, scopeHint),
					...(comment.path === undefined
						? { reason: "review comment names no path, so its effect is unknown" }
						: {}),
				}),
				applyReviewFix: async (input) => {
					const session = await runSession(context, {
						kind: "repair",
						worktree_path: input.worktree_path,
						output_path: REPAIR_OUTPUT,
						prompt: [
							`Apply this review comment (${input.comment.path ?? "no path"}): ${input.comment.body}`,
							`Stay inside the task scope: ${scopeHint.join(", ") || "unknown"}.`,
							'Write JSON {"success": bool, "modified_paths": ["repository-relative paths"], "reason": "..."}.',
						].join("\n"),
						evidence: { validate: (bytes) => parseRepairResult(bytes) !== null, branch: pr.head_ref_name },
					});
					const parsed = session.status === "completed" ? parseRepairResult(session.output ?? "") : null;
					if (!parsed) return { success: false, modified_paths: [], reason: `${session.kind} session failed: ${session.reason}` };
					return parsed;
				},
				runVerification: (path) => deps.runVerification({ root: context.root, worktree_path: path, task_id: intent?.task_id ?? null }),
				gitCommitAndPush: deps.gitCommitAndPush,
			},
		});
		return mapRepairResult(result);
	}

	return {
		async handle(handler: LoopHandler, context: AgentHandlerContext): Promise<AgentHandlerResult> {
			switch (handler) {
				case "analyze_codebase":
					return analyze(context);
				case "draft_plan":
					return draftPlan(context);
				case "publish_plan_for_approval":
					return publishPlan(context);
				case "triage_issue":
					return triage(context);
				case "enroll_and_drive":
					return enrollAndDrive(context);
				case "repair_pr_ci":
					return repairCi(context);
				case "repair_pr_conflict":
					return repairConflict(context);
				case "address_pr_review":
					return addressReview(context);
				default:
					return { outcome: "failed", detail: `handler is not agent-backed: ${handler}` };
			}
		},
	};
}

/** Every Issue's published plan digest: what a G8 approval must name. */
export function loadPublishedPlanDigests(stateDir: string): Record<number, string> {
	const digests: Record<number, string> = {};
	const directory = planDirectory(stateDir);
	if (!existsSync(directory)) return digests;
	for (const file of readdirSync(directory)) {
		if (!file.endsWith(".json")) continue;
		const issueNumber = Number.parseInt(file.slice(0, -5), 10);
		if (!Number.isFinite(issueNumber)) continue;
		const plan = readPlanPublication(stateDir, issueNumber);
		if (plan && plan.published_at !== null) digests[issueNumber] = plan.digest;
	}
	return digests;
}

/** True when `path` is inside one of the TaskIntent scope entries. */
export function pathInScope(path: string, scopeHint: readonly string[]): boolean {
	const normalized = path.replace(/^\.\//, "");
	return scopeHint.some((entry) => {
		const literal = entry.replace(/\/\*\*$/, "").replace(/\/\*$/, "").replace(/\/$/, "");
		if (literal === "" || literal === "**") return true;
		return normalized === literal || normalized.startsWith(`${literal}/`);
	});
}

/* ------------------------------------------------------------------ */
/* Production composition                                              */
/* ------------------------------------------------------------------ */

function git(root: string, argv: string[]): { status: number; stdout: string; stderr: string } {
	const res = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** The daemon's own worktree root, mirroring the batch Lanes' placement. */
export function loopWorktreeDirectory(root: string): string {
	const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	if (common.status !== 0) throw new Error(`loop_worktree_failed: ${common.stderr.trim() || "git common dir unreadable"}`);
	return join(common.stdout.trim(), "imm", "worktrees", "loop");
}

export interface DefaultAgentHandlerDepsOptions {
	gh?: GhTransport;
	stateDir?: string;
	/** Decision-model seam is not used here; the Executor Host profile is. */
	executorProfile?: { host: ExecutorHost; model?: string | null; effort?: string | null };
	/** The daemon's GitHub token; read from the environment when absent. */
	githubToken?: string | null;
}

/**
 * The production composition the `imm-loop` executable hands the dispatch core.
 * Every member is the real seam: git worktrees, the Kernel CLI, the Kernel's
 * single Enrollment entry, `dispatchLoopDrive`, and `gh` for the REST reads and
 * writes.
 */
export function createDefaultAgentHandlerDeps(
	root: string,
	options: DefaultAgentHandlerDepsOptions = {},
): AgentHandlerDeps {
	const stateDir = options.stateDir ?? join(root, ".imm", "state", "loop");
	const gh = options.gh ?? createGhTransport();
	const credential =
		options.githubToken ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
	const config = resolveConfig(root);
	const activeName = config.lanes.active.value;
	const active = activeName ? config.lanes.profiles.value[activeName] : undefined;
	const profile = options.executorProfile ?? {
		host: (active?.executor_host ?? config.lanes.executor_host.value ?? "claude-code") as ExecutorHost,
		model: active?.executor_model ?? config.lanes.executor_model.value ?? null,
		effort: active?.executor_effort ?? config.lanes.executor_effort.value ?? null,
	};
	const pluginRoot = join(root, "plugins", "immune-brain");

	const createWorktree: AgentHandlerDeps["createWorktree"] = ({ root: repository, branch, name }) => {
		const directory = loopWorktreeDirectory(repository);
		mkdirSync(directory, { recursive: true });
		const path = join(directory, name);
		const argv = branch === null
			? ["worktree", "add", "--detach", path, "HEAD"]
			: ["worktree", "add", path, branch];
		const res = git(repository, argv);
		if (res.status !== 0) throw new Error(`loop_worktree_failed: ${res.stderr.trim() || argv.join(" ")}`);
		return path;
	};

	const prWorktree: AgentHandlerDeps["prWorktree"] = ({ root: repository, pr_number, branch }) => {
		const directory = loopWorktreeDirectory(repository);
		mkdirSync(directory, { recursive: true });
		const path = join(directory, `pr-${pr_number}`);
		if (existsSync(path)) return path;
		const res = git(repository, ["worktree", "add", path, branch]);
		if (res.status !== 0) throw new Error(`loop_worktree_failed: ${res.stderr.trim() || `pr-${pr_number} ${branch}`}`);
		return path;
	};

	const readIntent: AgentHandlerDeps["readIntent"] = (taskId) => {
		try {
			const observed = observeEnrollmentTaskIntent(root, taskId);
			return {
				task_id: taskId,
				path: observed.intent_ref.path,
				revision: observed.intent_ref.revision,
				content_hash: observed.content_hash,
				risk: observed.intent.risk,
				scope_hint: [...observed.intent.scope_hint],
			};
		} catch {
			return null;
		}
	};

	return {
		sessionProvider: createCliAgentSessionProvider({
			profile,
			log_dir: join(stateDir, "sessions"),
		}),
		session_credential: credential,
		createWorktree,
		prWorktree,
		head: ({ root: repository, cwd, branch }) => {
			const res = git(cwd ?? repository, ["rev-parse", "--verify", "--quiet", branch ? `refs/heads/${branch}` : "HEAD"]);
			const sha = res.stdout.trim();
			return res.status === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
		},
		baseBranch: () => {
			const origin = git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
			if (origin.status === 0 && origin.stdout.trim()) return origin.stdout.trim().replace(/^origin\//, "");
			const main = git(root, ["show-ref", "--verify", "--quiet", "refs/heads/main"]);
			return main.status === 0 ? "main" : "master";
		},
		runKernel: ({ argv, cwd, stdin }) => {
			const res = spawnSync("bun", [join(pluginRoot, "runtime", "v4_runtime.ts"), "cli", "imm-kernel", ...argv], {
				cwd,
				encoding: "utf8",
				...(stdin === undefined ? {} : { input: stdin }),
				stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
				maxBuffer: 8 * 1024 * 1024,
			});
			let json: unknown = null;
			try {
				json = JSON.parse(res.stdout ?? "");
			} catch {}
			return { exit_code: res.status ?? 1, json };
		},
		readIntent,
		readComment: async ({ issue_number, comment_id }) => {
			const res = await gh.run(["api", `repos/{owner}/{repo}/issues/comments/${comment_id}`], { cwd: root });
			if (res.exit_code !== 0) return null;
			try {
				const data = JSON.parse(res.stdout) as Record<string, any>;
				if (typeof data.body !== "string") return null;
				return {
					body: data.body,
					author: data.user?.login ?? "unknown",
					author_association: data.author_association ?? "NONE",
					created_at: data.created_at ?? "",
					updated_at: data.updated_at ?? data.created_at ?? "",
				};
			} catch {
				return null;
			}
		},
		enroll: async (input) => {
			const preparation = preparePiCanary(input.root, { task_id: input.task_id, now: input.now });
			if (!preparation.intent) throw new Error(`enrollment preparation carries no TaskIntent for ${input.task_id}`);
			const binding = {
				task_id: input.task_id,
				intent_path: preparation.intent.path,
				intent_revision: preparation.intent.revision,
				intent_content_hash: preparation.intent.content_hash,
				preparation_digest: preparation.digest,
				actor_id: LOOP_DAEMON_ACTOR_ID,
				confirmation_ref: input.confirmation_ref,
				nonce: randomUUID(),
			};
			const result = await enrollTask(input.root, createEnrollmentAuthorityRegistry(), {
				binding,
				confirmation: input.confirmation,
				now: input.now,
			});
			if (!result.record) throw new Error("enrollment returned no record");
			return { record_revision: readTaskRecordRaw(input.root, input.task_id).revision };
		},
		drive: async (input) => driveSingleTaskLane(input, { stateDir, profile, pluginRoot }),
		runVerification: async ({ root: repository, worktree_path, task_id }) => {
			if (!task_id) return { exit_code: 1, stdout: "", stderr: "verification_needs_task: no TaskIntent is bound to this PR" };
			let intent: ReturnType<typeof observeEnrollmentTaskIntent>;
			try {
				intent = observeEnrollmentTaskIntent(repository, task_id);
			} catch (error) {
				return { exit_code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
			}
			for (const acceptance of intent.intent.acceptance) {
				let command: ReturnType<typeof parseVerificationDescriptor>;
				try {
					command = parseVerificationDescriptor(acceptance.verification);
				} catch (error) {
					return {
						exit_code: 1,
						stdout: "",
						stderr: `${acceptance.id}: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
				const res = spawnSync(command.command.executable, command.command.argv, {
					cwd: join(worktree_path, command.command.cwd),
					encoding: "utf8",
					timeout: command.command.timeout_ms,
					maxBuffer: command.command.max_output_bytes,
					stdio: ["ignore", "pipe", "pipe"],
				});
				if ((res.status ?? 1) !== 0)
					return { exit_code: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
			}
			return { exit_code: 0, stdout: "acceptance verification passed", stderr: "" };
		},
		gitCommitAndPush: async ({ worktree_path, branch, message }) => {
			const staged = git(worktree_path, ["add", "--all"]);
			if (staged.status !== 0) throw new Error(`git_add_failed: ${staged.stderr.trim()}`);
			const commit = git(worktree_path, ["commit", "--no-verify", "-m", message]);
			if (commit.status !== 0) throw new Error(`git_commit_failed: ${commit.stderr.trim()}`);
			const push = git(worktree_path, ["push", "origin", `HEAD:refs/heads/${branch}`]);
			if (push.status !== 0) throw new Error(`git_push_failed: ${push.stderr.trim()}`);
			const head = git(worktree_path, ["rev-parse", "HEAD"]);
			if (head.status !== 0) throw new Error(`git_head_unreadable: ${head.stderr.trim()}`);
			return { commit_sha: head.stdout.trim() };
		},
		rebaseOrMerge: async ({ worktree_path, base_branch }) => {
			const fetch = git(worktree_path, ["fetch", "origin", base_branch]);
			if (fetch.status !== 0) return { success: false, error: fetch.stderr.trim() };
			const rebase = git(worktree_path, ["rebase", `origin/${base_branch}`]);
			if (rebase.status === 0) return { success: true };
			const conflicting = git(worktree_path, ["diff", "--name-only", "--diff-filter=U"]);
			git(worktree_path, ["rebase", "--abort"]);
			return {
				success: false,
				conflicting_paths: conflicting.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
				error: rebase.stderr.trim(),
			};
		},
		now: () => new Date().toISOString(),
	};
}

/**
 * Compose one single-task Lane through `dispatchLoopDrive` (S5's composition
 * root). The daemon already owns the authority: the batch binding it issues
 * names the tracker approval or policy that started this task, and its
 * `advanceTask` reads the Kernel projection instead of claiming a Host verdict
 * the daemon has none of.
 */
async function driveSingleTaskLane(
	input: AgentDriveRequest,
	context: { stateDir: string; profile: { host: ExecutorHost; model?: string | null; effort?: string | null }; pluginRoot: string },
): Promise<AgentDriveResult> {
	const preflight = await prepareBatchPreflight({
		root: input.root,
		initiative_slug: input.task_id,
		plan_source: "single_task",
		now: input.now,
	});
	if (!preflight.ok) return { settled: false, exit: null, reason: `drive_preflight_failed: ${preflight.reason}` };
	const projection = preflight.projection;

	const registry = createBatchAuthorityRegistry();
	const binding: BatchAuthorizationBinding = {
		batch_id: `batch-${input.task_id}-${randomUUID()}`,
		initiative_slug: input.task_id,
		plan_digest: projection.plan_digest,
		branch: projection.batch_branch,
		base_head: projection.base_head,
		budget: projection.budget,
		actor_id: LOOP_DAEMON_ACTOR_ID,
		confirmation_ref: input.confirmation_ref,
		nonce: randomUUID(),
	};
	const authorityChildren = projection.recovery_children.map(authorityChild);
	const capability = registry.issue(binding, authorityChildren, input.now);
	const parent = await observeSingleTask(input.root, input.task_id);

	const kernel = createBatchKernelPort({
		root: input.root,
		parent,
		enrollmentRegistry: createEnrollmentAuthorityRegistry(),
		registry,
		capability,
		binding,
		// The daemon has no Host to run an Assurance attempt, so it reports the
		// projection's obligation instead of fabricating a verdict.
		advanceTask: async (laneRoot, taskId) => {
			const fresh = await projectAssurance(laneRoot, taskId, undefined);
			if (fresh.projection.lifecycle === "done" && fresh.projection.completion_ready) return { state: "completed" };
			return {
				state: "blocked",
				reason: `kernel obligation ${fresh.projection.next_obligation ?? "unknown"} has no daemon Host`,
			};
		},
		resume: {
			isResuming: projection.is_resuming,
			existingBatch: projection.existing_batch,
			batchBranch: projection.batch_branch,
		},
	});

	const { report, exit_record } = await dispatchLoopDrive({
			root: input.root,
			batch_id: binding.batch_id,
			initiative_slug: input.task_id,
			registry,
			capability,
			children: projection.recovery_children,
			plan_digest: projection.plan_digest,
			base_head: binding.base_head,
			confirmation_time: input.now,
			budget: projection.budget,
			now: input.now,
			kernel,
			git: createDefaultBatchGitPort(),
			max_parallel: 1,
			supervision: {
				parent_host: context.profile.host,
				plugin_dir: context.pluginRoot,
				wait_ms: 60_000,
				...(context.profile.model || context.profile.effort
					? {
							request: {
								...(context.profile.model ? { executor_model: context.profile.model } : {}),
								...(context.profile.effort ? { executor_effort: context.profile.effort } : {}),
							},
						}
					: {}),
			},
			run_id: input.task_id,
			final_commit_sha: null,
			verification_evidence: null,
			state_dir: context.stateDir,
		});
		return {
			settled: report.batch_state === "completed",
			exit: exit_record === null
				? null
				: {
						state: exit_record.state,
						exit_code: exit_record.exit_code,
						generation: exit_record.generation,
						final_commit_sha: exit_record.final_commit_sha,
						verification_evidence_digest: exit_record.verification_evidence_digest,
					},
			reason: report.reason ?? `batch_state ${report.batch_state}`,
		};
}
