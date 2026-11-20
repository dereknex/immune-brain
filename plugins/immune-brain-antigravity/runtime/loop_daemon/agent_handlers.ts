/**
 * Loop Daemon: Agent-Backed Handlers (S9)
 *
 * Implements D11 items 2-5 of docs/specs/loop-daemon.spec.md (SCN-6) on top of
 * the S8 dispatch core. Every handler that needs an agent session goes through
 * `agent_runner.ts`, so a session's completion is decided from evidence and
 * never from its prose:
 *
 *   - `clarify_issue`, `draft_plan` and `apply_clarify_reply` share one chain:
 *     the read-only `clarify` session returns the framing planning receives
 *     (`scopes`, `seams`, `risks`, `acceptance`) or the questions the owner is
 *     asked through the S3 Interaction protocol, after which the work item
 *     waits in `awaiting_input` until an allowlisted answer re-runs `clarify`
 *     with that answer appended (Spec D8)
 *   - `publish_plan_for_approval` posts that plan summary through the S8 write port
 *   - `enroll_and_drive` turns a REST-read approval into a `tracker_approval_proof`,
 *     enrolls every intent of the approved plan and drives them as one batch
 *     inside the standing `imm-loop run` process, then opens the PR after
 *     settlement (Spec D8: `intents[0]` is no longer special)
 *   - `repair_pr_ci`, `repair_pr_conflict` and `address_pr_review` bind the S7
 *     deps to repair sessions in the PR's worktree, keeping the S7 attempt cap
 *
 * This module decides and composes; the session backend, the Kernel, the file
 * system and GitHub are injected seams.
 */

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveConfig, type LoopConfig } from "../config/layered_config.ts";
import { createGhTransport, type GhTransport } from "../github_issue_tracker.ts";
import { LOOP_DAEMON_ACTOR_ID } from "../kernel/actor_identity.ts";
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
import { parseVerificationDescriptor, type VerificationDescriptor } from "../verification_descriptor.ts";
import { createBatchKernelPort } from "../unattended/batch_kernel_port.ts";
import { createDefaultBatchGitPort } from "../unattended/batch_git.ts";
import { observeSingleTask } from "../unattended/batch_plan.ts";
import { findActiveLaneBatchForTask, prepareBatchPreflight } from "../unattended/batch_preflight.ts";
import type { ExecutorHost } from "../unattended/agent_profiles.ts";
import {
	analyzeCodebase,
	analysisCacheKey,
	readCachedAnalysis,
	type CodebaseAnalysisFindings,
} from "./analysis_agent.ts";
import {
	createCliAgentSessionProvider,
	loopRoleProfile,
	loopSessionLimits,
	ROLE_SESSION_LIMITS,
	runAgentSession,
	sessionEnvironment,
	sessionRole,
	type AgentSessionEvidence,
	type AgentSessionKind,
	type AgentSessionProvider,
	type AgentSessionRecord,
} from "./agent_runner.ts";
import type { LoopSessionConfig } from "./role_catalog.ts";
import { daemonAdvanceTask, dispatchLoopDrive } from "./drive_dispatcher.ts";
import { escalationKey, planEscalation } from "./escalation.ts";
import { createGithubInteractionChannel, withInteractionMarker } from "./interaction/github_channel.ts";
import { createLocalInteractionChannel, retireLocalRequest } from "./interaction/local_channel.ts";
import {
	clarifyQuestionRequest,
	planApprovalInteractionRequest,
	type InteractionChannel,
} from "./interaction/protocol.ts";
import { type LoopJobExit, readLoopJob, recordSettledLane, startLoopJob } from "./jobs.ts";
import type { LoopGitHubPort } from "./github_port.ts";
import { isVerifiedActor, type GuardFacts } from "./guards.ts";
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
import {
	DEFAULT_REPAIR_RETRY_CAP,
	addressPrReview,
	computeFailureSignature,
	isDaemonBranch,
	isReviewHeadBatched,
	markReviewHeadBatched,
	reviewHeadBatchedThrough,
	repairPrCi,
	repairPrConflict,
	type DaemonPrInput,
	type RepairResult,
} from "./repair_agent.ts";
import { ensureLoopStateDir, loadLoopDecisions } from "./state.ts";
import { drivingInitiativeSlug, markPlanPublished, parkOnClarifyQuestion, readWorkItem, releaseClarifyWait } from "./work_items.ts";
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
	/** The BatchAgreement confirmation source; inferred from the ref when absent. */
	confirmation_source?: "tracker_approval" | "policy_auto";
	base_head: string;
	now: string;
}

/** Drive one Initiative-shaped WorkItem as a single batch (Spec loop-leader D3.3). */
export interface AgentDriveInitiativeRequest {
	root: string;
	slug: string;
	/** Slice tasks in carrier order; every one must already be enrolled. */
	task_ids: string[];
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
	state: "exited";
	exit_code: 0;
	generation: number | null;
	final_commit_sha: string | null;
	verification_evidence_digest: string | null;
}

export interface AgentDriveResult {
	settled: boolean;
	exit: AgentDriveExit | null;
	reason: string;
	/** The active child waits on a dialog the unattended daemon cannot answer; the tick escalates it. */
	hold_for_dialog?: { task_id: string; batch_id: string; detail: string } | null;
	/** The child is parked `needs_human`; only a literal-user confirmation resumes it. */
	parked?: { task_id: string; reason: string } | null;
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
	/** The resolved config, so a session takes its limits from its catalog role (Spec loop-leader D1.6). */
	loop_config?: LoopSessionConfig;
	/** The daemon's own GitHub credential, the only one a session receives. */
	session_credential: string | null;
	/** Create a daemon-owned worktree (`branch: null` is detached) and return its path. */
	createWorktree(input: { root: string; branch: string | null; name: string }): string;
	/** The PR's own worktree, created on first use and reset to the PR head before any repair. */
	prWorktree(input: { root: string; pr_number: number; branch: string; head_sha: string }): string;
	head(input: { root: string; cwd?: string; branch?: string | null }): string | null;
	/** Every path the worktree changed since `base_head`, committed or not; null when unreadable. */
	changedPaths(input: { worktree_path: string; base_head: string }): string[] | null;
	baseBranch(root: string): string;
	runKernel(input: { argv: string[]; cwd: string; stdin?: string }): KernelIntentResult;
	readIntent(task_id: string): AgentTaskIntent | null;
	readComment(input: { root: string; issue_number: number; comment_id: number }): Promise<AgentApprovalComment | null>;
	enroll(input: AgentEnrollRequest): Promise<{ record_revision: string }>;
	drive(input: AgentDriveRequest): Promise<AgentDriveResult>;
	/** The Initiative entry; refuses `lane_initiative_entry_pending` until Slice S2 of loop-leader-uls-alignment. */
	driveInitiative(input: AgentDriveInitiativeRequest): Promise<AgentDriveResult>;
	runVerification(input: {
		root: string;
		worktree_path: string;
		task_id: string | null;
	}): Promise<{ exit_code: number; stdout: string; stderr: string }>;
	gitCommitAndPush(input: { worktree_path: string; branch: string; message: string }): Promise<{ commit_sha: string }>;
	/** Commit a resolved rebase and push it back with `--force-with-lease` (D9). */
	gitForcePushWithLease(input: { worktree_path: string; branch: string; message: string }): Promise<{ commit_sha: string }>;
	rebaseOrMerge(input: {
		worktree_path: string;
		base_branch: string;
	}): Promise<{ success: boolean; conflicting_paths?: string[]; error?: string }>;
	now?: () => string;
}

/** The `git` invocation a worktree sync runs through; the seam tests replace. */
export type WorktreeGitRunner = (
	cwd: string,
	argv: string[],
) => { status: number; stdout: string; stderr: string };

/**
 * D9: before any repair the PR worktree fetches and resets to the PR head, so a
 * session never repairs a stale tree the daemon left behind. A rebase an escalated
 * conflict repair left in progress is aborted first: `reset --hard` alone moves the
 * head but keeps the rebase state, which a later commit would then continue.
 */
export function syncWorktreeToHead(
	input: { worktree_path: string; branch: string; head_sha: string },
	run: WorktreeGitRunner,
): void {
	const rebasing = run(input.worktree_path, ["rev-parse", "--verify", "--quiet", "REBASE_HEAD"]);
	if (rebasing.status === 0) {
		const aborted = run(input.worktree_path, ["rebase", "--abort"]);
		if (aborted.status !== 0)
			throw new Error(`loop_worktree_failed: rebase --abort: ${aborted.stderr.trim()}`);
	}
	const fetched = run(input.worktree_path, ["fetch", "origin", input.branch]);
	if (fetched.status !== 0)
		throw new Error(`loop_worktree_failed: fetch ${input.branch}: ${fetched.stderr.trim()}`);
	const reset = run(input.worktree_path, ["reset", "--hard", input.head_sha]);
	if (reset.status !== 0)
		throw new Error(`loop_worktree_failed: reset ${input.head_sha}: ${reset.stderr.trim()}`);
}

const REPAIR_OUTPUT = ".imm-loop/repair.json";

/** Default wait between dialog-hold re-drives; `IMM_LOOP_DIALOG_RETRY_MS` overrides it per call (test seam). */
export const LANE_DIALOG_RETRY_MS = 30_000;
/** Default dialog-hold window before the job fails with the escalation already posted; `IMM_LOOP_DIALOG_HOLD_MAX_MS` overrides it. */
export const LANE_DIALOG_HOLD_MAX_MS = 60 * 60_000;
/** Default runtime limit for a running Lane the job keeps advancing; `IMM_LOOP_DRIVE_MAX_MS` overrides it. */
export const LANE_DRIVE_MAX_MS = 6 * 60 * 60_000;

const envMs = (value: string | undefined, fallback: number): number =>
	Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

/* ------------------------------------------------------------------ */
/* Session output schemas: the only thing read back from a session.     */
/* ------------------------------------------------------------------ */

function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** The one schema a `clarify` session returns: questions, or the D8 framing. */
interface ClarifyResult {
	questions: string[];
	framing: CodebaseAnalysisFindings;
}

function parseClarifyResult(bytes: string): ClarifyResult | null {
	try {
		const value = JSON.parse(bytes) as Record<string, unknown>;
		if (!value || typeof value !== "object") return null;
		const questions = value.questions === undefined ? [] : value.questions;
		if (!stringArray(questions)) return null;
		const fields = ["scopes", "seams", "risks", "acceptance"] as const;
		for (const field of fields) {
			if (value[field] !== undefined && !stringArray(value[field])) return null;
		}
		const framing: CodebaseAnalysisFindings = {
			scopes: (value.scopes as string[] | undefined) ?? [],
			seams: (value.seams as string[] | undefined) ?? [],
			risks: (value.risks as string[] | undefined) ?? [],
			acceptance: (value.acceptance as string[] | undefined) ?? [],
		};
		// Neither a question nor a framing is not a clarification result.
		if (questions.length === 0 && framing.scopes.length === 0) return null;
		return { questions: [...questions], framing };
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

/** The work item this decision moves, in the store's own target vocabulary. */
function workItemTargetOf(context: AgentHandlerContext): string {
	return `${context.decision.target.kind}-${context.decision.target.id}`;
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

	async function runSession(
		context: AgentHandlerContext,
		input: {
			kind: AgentSessionKind;
			worktree_path: string;
			output_path?: string;
			prompt: string;
			evidence?: AgentSessionEvidence;
		},
	): Promise<AgentSessionRecord> {
		// The role owns the budget: its catalog role's limits, else the built-in per-role table (D1.6).
		const role = sessionRole(input.kind);
		const limits = deps.loop_config ? loopSessionLimits(deps.loop_config, role) : ROLE_SESSION_LIMITS[role];
		return runAgentSession(
			{
				kind: input.kind,
				worktree_path: input.worktree_path,
				prompt: input.prompt,
				...(input.output_path === undefined ? {} : { output_path: input.output_path }),
				turn_budget: limits.turn_budget,
				timeout_ms: limits.timeout_ms,
				// A repair session writes a PR branch; only the daemon pushes it, so it holds no GitHub credential.
				env: sessionEnvironment(input.kind === "repair" ? null : deps.session_credential),
			},
			deps.sessionProvider,
			input.evidence ?? {},
		);
	}

	/**
	 * A repair session's result, with its scope taken from what the session
	 * actually changed: the paths it reports are joined with every path that
	 * differs from the head it started at, including commits it made and
	 * untracked files, so an unreported write still meets the scope check.
	 */
	async function runRepairSession(
		context: AgentHandlerContext,
		worktreePath: string,
		branch: string,
		prompt: string,
	): Promise<RepairSessionResult> {
		const startHead = deps.head({ root: context.root, cwd: worktreePath });
		const session = await runSession(context, {
			kind: "repair",
			worktree_path: worktreePath,
			output_path: REPAIR_OUTPUT,
			prompt,
			evidence: { validate: (bytes) => parseRepairResult(bytes) !== null, branch },
		});
		const parsed = session.status === "completed" ? parseRepairResult(session.output ?? "") : null;
		if (!parsed) return { success: false, modified_paths: [], reason: `${session.kind} session failed: ${session.reason}` };
		const observed = startHead === null ? null : deps.changedPaths({ worktree_path: worktreePath, base_head: startHead });
		if (observed === null)
			return { success: false, modified_paths: [], reason: "repair_paths_unobservable: the worktree changes could not be read" };
		return { ...parsed, modified_paths: [...new Set([...parsed.modified_paths, ...observed])] };
	}

	/** What the next commit would stage: every path that differs from the worktree's HEAD. */
	function pendingCommitPaths(context: AgentHandlerContext): (worktreePath: string) => Promise<string[] | null> {
		return async (worktreePath) => {
			const head = deps.head({ root: context.root, cwd: worktreePath });
			return head === null ? null : deps.changedPaths({ worktree_path: worktreePath, base_head: head });
		};
	}

	/**
	 * D8: the read-only `clarify` session answers either with questions for the
	 * owner or with the framing planning receives. A framing is cached under its
	 * cache key, so the same Issue with the same answers never probes twice.
	 */
	async function runClarify(
		context: AgentHandlerContext,
		answers: readonly string[],
	): Promise<
		| { kind: "framing"; findings: CodebaseAnalysisFindings; cached: boolean }
		| { kind: "questions"; questions: string[] }
		| { kind: "failed"; detail: string }
	> {
		const issue = issueOf(context);
		if (!issue) return { kind: "failed", detail: "clarify needs an Issue target" };
		const baseTreeSha = deps.head({ root: context.root, cwd: context.root });
		if (!baseTreeSha) return { kind: "failed", detail: "clarify could not read the repository HEAD" };

		const probeInput = {
			issue_number: issue.number,
			issue_body: issue.body,
			base_tree_sha: baseTreeSha,
			answers,
		};
		const cached = readCachedAnalysis(context.stateDir, analysisCacheKey(probeInput));
		if (cached) return { kind: "framing", findings: cached.findings, cached: true };

		const worktree = deps.createWorktree({ root: context.root, branch: null, name: `clarify-${issue.number}` });
		const session = await runSession(context, {
			kind: "clarify",
			worktree_path: worktree,
			prompt: [
				`Read-only clarification for Issue #${issue.number}: ${issue.title}`,
				"",
				issue.body.slice(0, 4000),
				...(answers.length > 0
					? ["", "The owner answered the clarification question:", ...answers.map((answer) => `- ${answer}`)]
					: []),
				"",
				'If a fact the plan must settle is missing, print JSON {"questions": ["one question per missing fact"]}.',
				'Otherwise print the framing planning receives: {"scopes": ["repository-relative paths the plan will touch"], "seams": ["existing modules the plan should extend"], "risks": ["what the plan risks getting wrong"], "acceptance": ["what the plan will have to prove"]}.',
				"Do not modify any file: this session has no write tools.",
			].join("\n"),
			evidence: { validate: (bytes) => parseClarifyResult(bytes) !== null },
		});
		const refused = requireSession(session);
		if (refused) return { kind: "failed", detail: refused.detail };
		const parsed = parseClarifyResult(session.output ?? "");
		if (!parsed) return { kind: "failed", detail: `clarify session produced no valid result: ${session.reason}` };
		if (parsed.questions.length > 0) return { kind: "questions", questions: parsed.questions };

		analyzeCodebase({ ...probeInput, stateDir: context.stateDir, probe: () => parsed.framing, now: context.now });
		return { kind: "framing", findings: parsed.framing, cached: false };
	}

	/**
	 * The configured Interaction channel bound to one Issue's current revision:
	 * `local` writes the question under the daemon state directory and reads the
	 * answer the user confirmed in their own Host; `github` posts one comment.
	 */
	function clarifyChannel(
		context: AgentHandlerContext,
		issue: IssueFacts,
		comments: RawComment[],
	): { channel: InteractionChannel; issue_revision: string } {
		const issueRevision = createHash("sha256").update(`${issue.title}\n${issue.body}`).digest("hex").slice(0, 12);
		const binding = () => ({ issue_revision: issueRevision });
		if (context.loopConfig.interaction?.channel === "local")
			return { issue_revision: issueRevision, channel: createLocalInteractionChannel({ stateDir: context.stateDir, binding }) };
		return {
			issue_revision: issueRevision,
			channel: createGithubInteractionChannel({
				port: {
					postComment: (issueNumber, body) => context.gitHubPort.postComment(issueNumber, body),
					editComment: (commentId, body) => context.gitHubPort.editComment(commentId, body),
				},
				comments: () => comments,
				binding,
				guardFacts: context.guardFacts,
			}),
		};
	}

	/**
	 * Post this Issue's questions once through the configured Interaction channel and
	 * park the work item in `awaiting_input`. The channel's idempotency key is the
	 * question set, so a tick that observes no answer posts nothing new.
	 */
	async function askClarify(
		context: AgentHandlerContext,
		issue: IssueFacts,
		questions: string[],
	): Promise<AgentHandlerResult> {
		const comments = [...existingCommentsOf(context, issue.number)];
		const { channel, issue_revision } = clarifyChannel(context, issue, comments);
		const request = clarifyQuestionRequest({ issue_number: issue.number, questions, issue_revision });
		// One marker comment per interaction id: a tick that observed the answer
		// posts nothing, and a re-asked question set posts nothing either.
		const posted = await channel.post(request);
		const parked = parkOnClarifyQuestion(
			context.stateDir,
			workItemTargetOf(context),
			request.interaction_id,
			context.now,
		);
		if (parked.state !== "awaiting_input" || parked.pending_interactions[0] !== request.interaction_id)
			return {
				outcome: "failed",
				detail: `clarify question ${request.interaction_id} could not park the work item (state ${parked.state}); the answer would not resume`,
			};
		return {
			outcome: "executed",
			detail: `clarify question ${request.interaction_id} ${posted === "posted" ? "posted" : "already posted"}; asked ${questions.length} question(s), work item awaits the answer`,
		};
	}

	/**
	 * D8: an allowlisted reply re-runs `clarify` with the answer appended and then
	 * plans. A reply the channel does not accept for this request resumes nothing.
	 */
	async function applyClarifyReply(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: "apply_clarify_reply needs an Issue target" };
		const interactionId = readWorkItem(context.stateDir, workItemTargetOf(context))?.pending_interactions[0];
		if (!interactionId) return { outcome: "failed", detail: `issue #${issue.number} waits on no clarify question` };

		const { channel } = clarifyChannel(context, issue, [...existingCommentsOf(context, issue.number)]);
		const polled = await channel.poll(interactionId);
		if (polled.state !== "answered")
			return {
				outcome: "failed",
				detail: `clarify ${interactionId} is ${polled.state}: the reply is not an allowlisted answer`,
			};

		const answered = await clarifyThenPlan(context, [polled.value]);
		if (answered.outcome !== "executed") return answered;
		// A local answer is consumed once; a GitHub answer stays in the comment stream.
		if (channel.id === "local") retireLocalRequest(context.stateDir, interactionId);
		return { outcome: "executed", detail: `clarify ${interactionId} answered by ${polled.actor}; ${answered.detail}` };
	}

	async function planFromFraming(
		context: AgentHandlerContext,
		findings: CodebaseAnalysisFindings,
	): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: "draft_plan needs an Issue target" };
		const branch = planBranchName(issue.number);
		const worktree = deps.createWorktree({ root: context.root, branch, name: `plan-${issue.number}` });
		// D8: the plan receives the clarify framing, not only the Issue body's first 4000 chars.
		const framing = [
			"Clarify framing:",
			`- scopes: ${findings.scopes.join(", ") || "none"}`,
			`- seams: ${findings.seams.join(", ") || "none"}`,
			`- risks: ${findings.risks.join(", ") || "none"}`,
			`- acceptance: ${findings.acceptance.join(", ") || "none"}`,
		];
		// D8: a15 `needs_initiative_decomposition` asks for a decomposition instruction.
		const decomposition =
			context.decision.classification?.choice === "needs_initiative_decomposition"
				? ["", "Decompose the Issue into an Initiative: one TaskIntent per Slice, in dependency order, each small enough to land alone."]
				: [];
		const session = await runSession(context, {
			kind: "planning",
			worktree_path: worktree,
			prompt: [
				`Draft the plan for Issue #${issue.number}: ${issue.title}`,
				"",
				issue.body.slice(0, 4000),
				"",
				...framing,
				...decomposition,
				"",
				'Print JSON {"intents": [{"path": "docs/plans/<task-id>.intent.json", "intent": {<TaskIntent body>}}], "spec": {"path": "docs/specs/<name>.spec.md", "content": "<Spec markdown>"} | null}.',
				"Do not modify any file: this session has no write tools. The daemon writes every artifact.",
				"The daemon authors each intent through `imm-kernel intent author`; you supply the candidate bodies only.",
			].join("\n"),
			evidence: { validate: (bytes) => parsePlanCandidate(bytes) !== null },
		});
		const refused = requireSession(session);
		if (refused) return refused;
		const candidate = parsePlanCandidate(session.output ?? "");
		if (!candidate) return { outcome: "failed", detail: `planning session produced no valid candidate: ${session.reason}` };

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
		markPlanPublished(context.stateDir, workItemTargetOf(context), draft.digest, context.now);

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

		// D3: the plan summary is the `plan_approval` request's comment, bound to its digest.
		const body = withInteractionMarker(
			planApprovalInteractionRequest({ issue_number: issue.number, plan_digest: plan.digest, prompt: plan.comment_body }),
			plan.comment_body,
		);
		if (plan.published_comment_id !== null) {
			await context.gitHubPort.editComment(plan.published_comment_id, body);
			return {
				outcome: "executed",
				detail: `updated plan ${plan.digest.slice(0, 12)} for #${issue.number} in comment #${plan.published_comment_id}`,
			};
		}

		const posted = await context.gitHubPort.postComment(issue.number, body);
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

	/**
	 * D8: the one chain the planning handlers share. The framing is a precondition
	 * of every plan, so `clarify_issue`, `draft_plan` and `apply_clarify_reply` all
	 * run `clarify` first; only the questions path stops before planning, and it
	 * stops in `awaiting_input` with exactly one posted question.
	 */
	async function clarifyThenPlan(
		context: AgentHandlerContext,
		answers: readonly string[],
	): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: `clarify needs an Issue target` };
		const clarified = await runClarify(context, answers);
		if (clarified.kind === "failed") return { outcome: "failed", detail: clarified.detail };
		if (clarified.kind === "questions") return askClarify(context, issue, clarified.questions);

		releaseClarifyWait(context.stateDir, workItemTargetOf(context), context.now);
		const drafted = await planFromFraming(context, clarified.findings);
		if (drafted.outcome !== "executed") return drafted;
		const source = clarified.cached ? "framing cached" : answers.length > 0 ? `framing from ${answers.length} answer(s)` : "framing probed";
		return { outcome: "executed", detail: `${source}; ${drafted.detail}` };
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

	/**
	 * D6: a lost job's E12 is judged once, before dispatch, so a retry that cannot
	 * start its job would otherwise end silently; it escalates instead.
	 */
	async function enrollAndDrive(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const result = await enrollAndDriveOnce(context);
		const event = context.event;
		if (
			event?.kind !== "E12_JOB_FINISHED" ||
			event.outcome !== "lost" ||
			(result.outcome !== "failed" && result.outcome !== "requires_standing_daemon")
		)
			return result;
		const escalated = await escalateOnce(
			context,
			"job_retry_failed",
			`issue-${event.issue_number}`,
			event.job_id,
			`The loop could not restart lost job ${event.job_id} for #${event.issue_number}: ${result.detail}`,
		);
		return { outcome: "failed", detail: `${result.detail} (${escalated})` };
	}

	async function enrollAndDriveOnce(context: AgentHandlerContext): Promise<AgentHandlerResult> {
		const issue = issueOf(context);
		if (!issue) return { outcome: "failed", detail: "enroll_and_drive needs an Issue target" };
		const plan = readPlanPublication(context.stateDir, issue.number);
		if (!plan) return { outcome: "failed", detail: `no published plan for #${issue.number}` };
		if (plan.published_at === null)
			return { outcome: "failed", detail: `plan ${plan.digest.slice(0, 12)} for #${issue.number} is not published yet` };

		// D8: every intent of the approved plan is driven; an event naming one task
		// narrows this to that task, and `intents[0]` is no longer special.
		// A lost job's retry drives the set that job held, not only the first task
		// E12 names.
		const lostJob =
			context.event?.kind === "E12_JOB_FINISHED" ? readLoopJob(context.stateDir, context.event.job_id) : null;
		const named = lostJob ? null : taskIdOfEvent(context);
		if (named !== null && !plan.intents.some((intent) => intent.task_id === named))
			return { outcome: "failed", detail: `task ${named} is not in the published plan for #${issue.number}` };
		const planned = plan.intents.map((intent) => intent.task_id);
		const taskIds =
			lostJob?.task_ids && lostJob.task_ids.length > 0
				? lostJob.task_ids.filter((taskId) => planned.includes(taskId))
				: named === null
					? planned
					: [named];
		if (taskIds.length === 0)
			return { outcome: "failed", detail: `lost job ${lostJob?.job_id} drives no task of the published plan` };
		const taskId = taskIds[0]!;

		// Driving belongs to the process that owns `loopDaemonSupervisor`.
		if (!context.standing_daemon)
			return {
				outcome: "requires_standing_daemon",
				detail: `enroll_and_drive drives ${taskIds.join(", ")} only inside imm-loop run`,
			};

		// D6 re-entry: an enrolled, nonterminal TaskRecord resumes; re-entry never
		// mints a second nonce for a task the Kernel already holds.
		const confirmationRefs = new Map<string, string>();
		const confirmationSources = new Map<string, "tracker_approval" | "policy_auto">();
		let confirmationSource: string | null = null;
		let recordRevision = "";
		for (const candidateTaskId of taskIds) {
			const intent = deps.readIntent(candidateTaskId);
			if (!intent) return { outcome: "failed", detail: `task intent is not readable: ${candidateTaskId}` };

			const enrolled = readTaskRecordRaw(context.root, candidateTaskId);
			recordRevision = enrolled.revision;
			confirmationRefs.set(candidateTaskId, `resume:${candidateTaskId}`);
			if (enrolled.record) continue;

			const resolved = await resolveConfirmation(context, issue, plan, intent);
			if (!resolved.ok) {
				const escalated = await escalateOnce(
					context,
					"enroll_rejected",
					`issue-${issue.number}`,
					resolved.reason,
					`Enrollment refused for #${issue.number}: ${resolved.reason}`,
				);
				return { outcome: "failed", detail: `${resolved.reason} (${escalated})` };
			}
			confirmationSource = resolved.source;
			confirmationRefs.set(candidateTaskId, resolved.confirmation_ref);
			confirmationSources.set(candidateTaskId, resolved.source);
			try {
				const record = await deps.enroll({
					root: context.root,
					task_id: candidateTaskId,
					intent,
					plan_digest: plan.digest,
					confirmation_ref: resolved.confirmation_ref,
					confirmation: resolved.input,
					now: now(),
				});
				recordRevision = record.record_revision;
			} catch (error) {
				return {
					outcome: "failed",
					detail: `enrollment failed for ${candidateTaskId}: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}

		const baseHead = deps.head({ root: context.root, cwd: context.root });
		if (!baseHead) return { outcome: "failed", detail: "enroll_and_drive could not read the repository HEAD" };

		// D3.3: an Initiative-shaped WorkItem drives its carrier as one batch
		// through `observeInitiative`, never as one single-task Lane per slice.
		const initiativeSlug = drivingInitiativeSlug(readWorkItem(context.stateDir, workItemTargetOf(context)));
		if (initiativeSlug !== null)
			return driveInitiativeJob(context, {
				issue,
				plan,
				taskIds,
				baseHead,
				initiativeSlug,
				confirmationSource,
				recordRevision,
				confirmationRef: confirmationRefs.get(taskIds[0]!) ?? `resume:${taskIds[0]}`,
			});

		// D6: the drive runs as a background job that holds its lease until the
		// record is terminal; the tick returns here and `open_pr` runs on E13.
		const job = startLoopJob(
			context.stateDir,
			{
				kind: "drive",
				target_id: `issue-${issue.number}`,
				task_id: taskId,
				issue_number: issue.number,
				plan_digest: plan.digest,
				task_ids: taskIds,
				expected_output: "executor_exit_record",
				now: now(),
			},
			async () => {
				// D8: the approved plan's intents are one batch, driven in plan order and
				// serialized in this one job, so the first failure stops the batch. Each
				// settled Lane is recorded on the job, so the reconciler emits one E13 per
				// Lane (one PR per intent) and a retry of a lost attempt skips them.
				const jobTarget = `issue-${issue.number}`;
				const alreadySettled = new Map(
					(readLoopJob(context.stateDir, jobTarget)?.settled_lanes ?? []).map((lane) => [lane.task_id, lane]),
				);
				let firstExit: LoopJobExit | null = null;
				for (const candidateTaskId of taskIds) {
					const prior = alreadySettled.get(candidateTaskId);
					if (prior) {
						firstExit ??= prior.exit;
						continue;
					}
					const intent = deps.readIntent(candidateTaskId);
				if (!intent)
					return { outcome: "failed" as const, detail: `task intent disappeared: ${candidateTaskId}`, exit: firstExit };
				const driveInput = () => ({
					root: context.root,
					task_id: candidateTaskId,
					intent,
					plan_digest: plan.digest,
					confirmation_ref: confirmationRefs.get(candidateTaskId) ?? `resume:${candidateTaskId}`,
					...(confirmationSources.get(candidateTaskId)
						? { confirmation_source: confirmationSources.get(candidateTaskId)! }
						: {}),
					base_head: baseHead,
					now: now(),
				});
				let driven = await deps.drive(driveInput());
				// A startup or mid-run dialog holds the Lane open without failing the
				// job: post the Issue escalation once per distinct detail, then re-drive
				// every retry interval until the user answers the dialog in Herdr; the
				// job keeps its lease while it waits, and a dialog never answered inside
				// the hold window fails the job with the escalation already posted.
				// A Lane that is merely running is advanced again at the same interval
				// (D15) until it settles or the job's runtime limit is reached.
				let escalatedDetail: string | null = null;
				const holdDeadline = Date.now() + envMs(process.env.IMM_LOOP_DIALOG_HOLD_MAX_MS, LANE_DIALOG_HOLD_MAX_MS);
				const driveDeadline = Date.now() + envMs(process.env.IMM_LOOP_DRIVE_MAX_MS, LANE_DRIVE_MAX_MS);
				const retry = () => new Promise((resolve) => setTimeout(resolve, envMs(process.env.IMM_LOOP_DIALOG_RETRY_MS, LANE_DIALOG_RETRY_MS)));
				while (!driven.settled) {
					// A parked child is a human decision: escalate once and stop retrying.
					if (driven.parked) {
						const detail = `Lane ${candidateTaskId} is parked needs_human (${driven.parked.reason}); a literal-user confirmation must resume it`;
						await escalateOnce(context, "lane_entry_blocked", jobTarget, candidateTaskId, detail);
						return { outcome: "failed" as const, detail, exit: driven.exit };
					}
					if (driven.hold_for_dialog) {
						if (escalatedDetail !== driven.hold_for_dialog.detail) {
							escalatedDetail = driven.hold_for_dialog.detail;
							await escalateOnce(
								context,
								"lane_entry_blocked",
								jobTarget,
								candidateTaskId,
								`Lane ${candidateTaskId} waits on a dialog the daemon cannot answer (${escalatedDetail}); answer it in Herdr, and the drive resumes batch ${driven.hold_for_dialog.batch_id}`,
							);
						}
						if (Date.now() >= holdDeadline)
							return {
								outcome: "failed" as const,
								detail: `${candidateTaskId} still waits on a dialog: ${driven.hold_for_dialog.detail}`,
								exit: driven.exit,
							};
					} else if (driven.reason !== "lane running" && driven.reason !== "lane started")
						// A refusal is permanent. Only a Lane that is actually running is retried.
						return {
							outcome: "failed" as const,
							detail: `${candidateTaskId} did not settle: ${driven.reason}`,
							exit: driven.exit,
						};
					else if (Date.now() >= driveDeadline)
						return {
							outcome: "failed" as const,
							detail: `${candidateTaskId} did not settle inside the drive limit: ${driven.reason}`,
							exit: driven.exit,
						};
					await retry();
					driven = await deps.drive(driveInput());
				}
				const exit = driven.exit;
				firstExit ??= exit ?? null;
				const settled =
						driven.settled &&
						exit?.state === "exited" &&
						exit.exit_code === 0 &&
						Boolean(exit.verification_evidence_digest);
					if (!settled)
						return {
							outcome: "failed" as const,
							detail: `${candidateTaskId} did not settle: ${driven.reason}${exit ? ` (state=${exit.state} exit_code=${exit.exit_code})` : " (no exit recorded)"}`,
							exit,
						};					recordSettledLane(context.stateDir, jobTarget, { task_id: candidateTaskId, exit: exit ?? null });
				}
				return {
					outcome: "settled" as const,
					detail:
						taskIds.length === 1
							? `lane settled (generation ${firstExit?.generation}, commit ${firstExit?.final_commit_sha ?? "unknown"}, digest ${firstExit?.verification_evidence_digest})`
							: `batch settled ${taskIds.length} lanes: ${taskIds.join(", ")} (first commit ${firstExit?.final_commit_sha ?? "unknown"})`,
					exit: firstExit,
				};
			},
		);

		return {
			outcome: "executed",
			detail: `started drive job ${job.job_id} for ${taskIds.join(", ")} (${confirmationSource ?? "resume"}, record ${recordRevision}); the PR opens when the lane settles`,
		};
	}

	/**
	 * The Initiative drive job (Spec loop-leader D3.3): one batch for the whole
	 * carrier, so slice order and `blocked_by` are the batch's own. Each settled
	 * slice is recorded on the job like a settled single-task Lane, so the
	 * reconciler emits one E13 per slice and a lost-job retry skips the settled.
	 */
	async function driveInitiativeJob(
		context: AgentHandlerContext,
		input: {
			issue: { number: number };
			plan: LoopPlanPublication;
			taskIds: string[];
			baseHead: string;
			initiativeSlug: string;
			confirmationSource: string | null;
			recordRevision: string;
			confirmationRef: string;
		},
	): Promise<AgentHandlerResult> {
		const job = startLoopJob(
			context.stateDir,
			{
				kind: "drive",
				target_id: `issue-${input.issue.number}`,
				task_id: input.taskIds[0]!,
				issue_number: input.issue.number,
				plan_digest: input.plan.digest,
				task_ids: input.taskIds,
				expected_output: "executor_exit_record",
				now: now(),
			},
			async () => {
				const jobTarget = `issue-${input.issue.number}`;
				const alreadySettled = new Map(
					(readLoopJob(context.stateDir, jobTarget)?.settled_lanes ?? []).map((lane) => [lane.task_id, lane]),
				);
				const pending = input.taskIds.filter((taskId) => !alreadySettled.has(taskId));
				let firstExit: LoopJobExit | null = null;
				for (const lane of alreadySettled.values()) firstExit ??= lane.exit;
				if (pending.length === 0)
					return { outcome: "settled" as const, detail: `initiative ${input.initiativeSlug} slices already settled`, exit: firstExit };
				const driven = await deps.driveInitiative({
					root: context.root,
					slug: input.initiativeSlug,
					task_ids: pending,
					plan_digest: input.plan.digest,
					confirmation_ref: input.confirmationRef,
					base_head: input.baseHead,
					now: now(),
				});
				const exit = driven.exit;
				firstExit ??= exit ?? null;
				const settled =
					driven.settled &&
					exit?.state === "exited" &&
					exit.exit_code === 0 &&
					Boolean(exit.verification_evidence_digest);
				if (!settled)
					return {
						outcome: "failed" as const,
						detail: `initiative ${input.initiativeSlug} did not settle: ${driven.reason}${exit ? ` (state=${exit.state} exit_code=${exit.exit_code})` : " (no exit recorded)"}`,
						exit,
					};
				for (const taskId of pending)
					recordSettledLane(context.stateDir, jobTarget, { task_id: taskId, exit: exit ?? null });
				return {
					outcome: "settled" as const,
					detail: `initiative ${input.initiativeSlug} settled ${pending.length} slice(s) (commit ${exit?.final_commit_sha ?? "unknown"}, digest ${exit?.verification_evidence_digest})`,
					exit: firstExit,
				};
			},
		);

		return {
			outcome: "executed",
			detail: `started initiative drive job ${job.job_id} for ${input.initiativeSlug} (${input.taskIds.join(", ")}) (${input.confirmationSource ?? "resume"}, record ${input.recordRevision}); the PRs open when the slices settle`,
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
		const worktree = deps.prWorktree({
			root: context.root,
			pr_number: pr.number,
			branch: pr.head_ref_name,
			head_sha: pr.head_sha,
		});

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
				fetchCheckLog: (input) => context.gitHubPort.checkLog(input),
				runVerification: (path) => deps.runVerification({ root: context.root, worktree_path: path, task_id: intent?.task_id ?? null }),
				applyFix: async (input) => {
					return runRepairSession(context, input.worktree_path, pr.head_ref_name, [
							`Reproduce and fix the failing check ${input.check_name} (signature ${input.failure_signature.toLowerCase()}).`,
							...(input.details_url ? [`Details: ${input.details_url}`] : []),
							"Failing check log:",
							input.log_excerpt || "(the check carried no log)",
							`Stay inside the task scope: ${(input.scope_hint ?? []).join(", ") || "unknown"}.`,
							'Write JSON {"success": bool, "modified_paths": ["repository-relative paths"], "reason": "..."}.',
						].join("\n"));
				},
				pendingCommitPaths: pendingCommitPaths(context),
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
		const worktree = deps.prWorktree({
			root: context.root,
			pr_number: pr.number,
			branch: pr.head_ref_name,
			head_sha: pr.head_sha,
		});
		const scopeHint = intent?.scope_hint;

		const result = await repairPrConflict({
			pr: daemonPrInput(pr),
			context: {
				worktree_path: worktree,
				task_id: taskId,
				scope_hint: scopeHint,
				state_dir: context.stateDir,
			},
			deps: {
				rebaseOrMerge: deps.rebaseOrMerge,
				applyConflictFix: async (input) => {
					return runRepairSession(context, input.worktree_path, pr.head_ref_name, [
							`Resolve the rebase of this branch onto ${input.base_branch} in the conflicted tree, keeping both sides' intent.`,
							`Conflicted paths: ${input.conflicting_paths.join(", ") || "unknown"}.`,
							`Stay inside the task scope: ${(input.scope_hint ?? []).join(", ") || "unknown"}.`,
							'Write JSON {"success": bool, "modified_paths": ["repository-relative paths"], "reason": "..."}.',
						].join("\n"));
				},
				runVerification: (path) => deps.runVerification({ root: context.root, worktree_path: path, task_id: intent?.task_id ?? null }),
				pendingCommitPaths: pendingCommitPaths(context),
				gitCommitAndPush: deps.gitCommitAndPush,
				gitForcePushWithLease: deps.gitForcePushWithLease,
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
		const scopeHint = intent?.scope_hint ?? [];
		const headSha = pr.head_sha;

		// D9: one session and one push per batch of a PR head's comments. A comment
		// a batch already covered is done; a later one on the same head is the next batch.
		const batchedThrough = context.stateDir ? reviewHeadBatchedThrough(context.stateDir, headSha) : 0;
		if (context.stateDir && isReviewHeadBatched(context.stateDir, headSha, event.comment_id)) {
			return {
				outcome: "executed",
				detail: `review comment #${event.comment_id} of PR #${pr.number} head ${headSha.slice(0, 12)} already batched into one session`,
			};
		}

		const worktree = deps.prWorktree({
			root: context.root,
			pr_number: pr.number,
			branch: pr.head_ref_name,
			head_sha: headSha,
		});

		const recordedChoice = (() => {
			if (context.decision.corrected_option) {
				return context.decision.corrected_option;
			}
			if (context.decision.classification?.point === "a14_pr_comment_triage") {
				return context.decision.classification.choice;
			}
			const prior = loadLoopDecisions(context.stateDir)
				.filter(
					(row) =>
						row &&
						row.event_id === event.event_id &&
						row.classification?.point === "a14_pr_comment_triage",
				)
				.pop();
			return prior?.corrected_option ?? prior?.classification?.choice ?? null;
		})();

		// Sibling triage answers the same tick already recorded, keyed by their event id.
		const triageByEvent = new Map<string, string>();
		for (const row of loadLoopDecisions(context.stateDir)) {
			if (row?.classification?.point !== "a14_pr_comment_triage") continue;
			const choice = row.corrected_option ?? row.classification.choice;
			if (choice) triageByEvent.set(row.event_id, choice);
		}

		// A review body carries no diff hunk and no sibling inline comments, so only an
		// inline comment reads the PR's comment list to batch its head's comments.
		let facts: Awaited<ReturnType<LoopGitHubPort["prReviewComments"]>> = [];
		if (event.review_id === undefined) {
			try {
				facts = await context.gitHubPort.prReviewComments(pr.number);
			} catch (error: any) {
				await escalateOnce(
					context,
					"review_comments_unavailable",
					`pr-${pr.number}`,
					headSha,
					`Could not read the review comments of PR #${pr.number}: ${error?.message || String(error)}`,
				);
				return { outcome: "failed", detail: `review comments unreadable: ${error?.message || String(error)}` };
			}
		}

		// This comment and the ones created after it share the head being repaired. A
		// sibling joins the batch only when it clears the same actor boundary its own
		// event would have to clear (G7); the triggering comment already did.
		const comments = facts
			.filter((comment) => comment.id >= event.comment_id && comment.id > batchedThrough)
			.filter(
				(comment) =>
					comment.id === event.comment_id ||
					isVerifiedActor(
						comment.author ?? "",
						comment.author_association ?? "",
						context.guardFacts,
					),
			);

		const result = await addressPrReview({
			pr: daemonPrInput(pr),
			comments: comments.length > 0
				? comments
				: [
						{
							id: event.comment_id,
							body: event.body,
							path: event.path,
							line: event.line,
							author: event.author,
							author_association: event.author_association,
						},
					],
			context: {
				worktree_path: worktree,
				task_id: taskId,
				scope_hint: intent?.scope_hint,
				state_dir: context.stateDir,
			},
			deps: {
				// Reuse the recorded `a14_pr_comment_triage` answer (`blocking`/`nit` -> in scope,
				// `out_of_scope` -> escalate); only fall back to path heuristics when unavailable.
				classifyComment: async ({ comment }) => {
					const choice = comment.id === event.comment_id
						? recordedChoice
						: (triageByEvent.get(`evt-e10-${pr.number}-${comment.id}`) ?? null);
					if (choice === "blocking" || choice === "nit") {
						return { is_scope_changing: false };
					}
					if (choice === "out_of_scope") {
						return {
							is_scope_changing: true,
							reason: "a14_pr_comment_triage classified review comment as out_of_scope",
						};
					}
					return {
						is_scope_changing: comment.path === undefined || !pathInScope(comment.path, scopeHint),
						...(comment.path === undefined
							? { reason: "review comment names no path, so its effect is unknown" }
							: {}),
					};
				},
				applyReviewFix: async (input) => {
					return runRepairSession(context, input.worktree_path, pr.head_ref_name, [
							`Address these ${input.comments.length} review comments on PR #${pr.number} in one pass:`,
							...input.comments.flatMap((comment) => [
								"",
								`Review comment #${comment.id} (${comment.path || "no path"}${comment.line === undefined ? "" : `:${comment.line}`}):`,
								...(comment.diff_hunk ? ["```diff", comment.diff_hunk, "```"] : []),
								comment.body,
							]),
							"",
							`Stay inside the task scope: ${scopeHint.join(", ") || "unknown"}.`,
							'Write JSON {"success": bool, "modified_paths": ["repository-relative paths"], "reason": "..."}.',
						].join("\n"));
				},
				runVerification: (path) => deps.runVerification({ root: context.root, worktree_path: path, task_id: intent?.task_id ?? null }),
				pendingCommitPaths: pendingCommitPaths(context),
				gitCommitAndPush: deps.gitCommitAndPush,
			},
		});
		if (result.action === "repaired" && context.stateDir)
			markReviewHeadBatched(
				context.stateDir,
				headSha,
				Math.max(event.comment_id, ...comments.map((comment) => comment.id)),
			);
		return mapRepairResult(result);
	}

	return {
		async handle(handler: LoopHandler, context: AgentHandlerContext): Promise<AgentHandlerResult> {
			switch (handler) {
				case "clarify_issue":
				case "draft_plan":
					return clarifyThenPlan(context, []);
				case "apply_clarify_reply":
					return applyClarifyReply(context);
				case "publish_plan_for_approval":
					return publishPlan(context);
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

/** Session result files live here and never reach a commit or a scope check. */
const SESSION_SCRATCH_DIR = ".imm-loop";

/**
 * Every repository path that differs from `baseHead`: tracked changes (committed,
 * staged or not) plus untracked files, without session scratch. Null when git
 * cannot answer, so a caller fails closed.
 */
export function observedWorktreePaths(worktreePath: string, baseHead: string): string[] | null {
	const tracked = git(worktreePath, ["diff", "--name-only", "-z", baseHead, "--"]);
	const untracked = git(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]);
	if (tracked.status !== 0 || untracked.status !== 0) return null;
	const paths = `${tracked.stdout}\0${untracked.stdout}`.split("\0").filter((path) => path.length > 0);
	return [...new Set(paths)].filter((path) => path !== SESSION_SCRATCH_DIR && !path.startsWith(`${SESSION_SCRATCH_DIR}/`));
}

/**
 * Stages and records the worktree's changes. A rebase the repair session resolved
 * is continued instead of committed, because git refuses a plain commit mid-rebase.
 */
function commitWorktree(worktreePath: string, message: string): void {
	const staged = git(worktreePath, ["add", "--all", "--", ".", `:(exclude)${SESSION_SCRATCH_DIR}`]);
	if (staged.status !== 0) throw new Error(`git_add_failed: ${staged.stderr.trim()}`);
	const rebasing = git(worktreePath, ["rev-parse", "--verify", "--quiet", "REBASE_HEAD"]).status === 0;
	const commit = rebasing
		? git(worktreePath, ["-c", "core.editor=true", "rebase", "--continue"])
		: git(worktreePath, ["commit", "--no-verify", "-m", message]);
	if (commit.status !== 0) throw new Error(`git_commit_failed: ${commit.stderr.trim()}`);
}

/**
 * Runs one acceptance command in a repair worktree. The command and the files it
 * executes may come from the repair session, so it gets the session's
 * environment, never the daemon's: no GitHub credential and nothing else
 * inherited beyond PATH.
 */
export function runAcceptanceCommand(
	worktreePath: string,
	command: VerificationDescriptor["command"],
): { exit_code: number; stdout: string; stderr: string } {
	const res = spawnSync(command.executable, [...command.argv], {
		cwd: join(worktreePath, command.cwd),
		env: sessionEnvironment(null),
		encoding: "utf8",
		timeout: command.timeout_ms,
		maxBuffer: command.max_output_bytes,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return { exit_code: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
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
	// Each session runs on the profile bound to its own loop role; the Lane it may
	// drive runs on the executor role. Neither reads a `lanes` leaf any more (D2).
	const executor: { host: ExecutorHost; model?: string | null; effort?: string | null } = loopRoleProfile(config, "executor");
	const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

	const createWorktree: AgentHandlerDeps["createWorktree"] = ({ root: repository, branch, name }) => {
		const directory = loopWorktreeDirectory(repository);
		mkdirSync(directory, { recursive: true });
		const path = join(directory, name);
		// A read-only probe re-runs for the same Issue (D8: every answer re-runs
		// clarify), so its detached tree is reused at the current HEAD instead of
		// failing `worktree add`. A branch worktree keeps the tree it already has.
		if (existsSync(path)) {
			if (branch !== null) return path;
			const head = git(repository, ["rev-parse", "HEAD"]);
			const reset = head.status === 0 ? git(path, ["checkout", "--detach", head.stdout.trim()]) : head;
			if (reset.status !== 0)
				throw new Error(`loop_worktree_failed: ${reset.stderr.trim() || `${name} at HEAD`}`);
			return path;
		}
		const argv = branch === null
			? ["worktree", "add", "--detach", path, "HEAD"]
			: ["worktree", "add", path, branch];
		const res = git(repository, argv);
		if (res.status !== 0) throw new Error(`loop_worktree_failed: ${res.stderr.trim() || argv.join(" ")}`);
		return path;
	};

	const prWorktree: AgentHandlerDeps["prWorktree"] = ({ root: repository, pr_number, branch, head_sha }) => {
		const directory = loopWorktreeDirectory(repository);
		mkdirSync(directory, { recursive: true });
		const path = join(directory, `pr-${pr_number}`);
		if (!existsSync(path)) {
			const res = git(repository, ["worktree", "add", path, branch]);
			if (res.status !== 0) throw new Error(`loop_worktree_failed: ${res.stderr.trim() || `pr-${pr_number} ${branch}`}`);
		}
		// D9: a reused worktree is never repaired from where the last session left it.
		syncWorktreeToHead({ worktree_path: path, branch, head_sha }, (cwd, argv) => git(cwd, argv));
		return path;
	};

	const changedPaths: AgentHandlerDeps["changedPaths"] = ({ worktree_path, base_head }) =>
		observedWorktreePaths(worktree_path, base_head);

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
			profileFor: (role) => loopRoleProfile(config, role),
			instructions_root: root,
			log_dir: join(stateDir, "sessions"),
		}),
		loop_config: config,
		session_credential: credential,
		createWorktree,
		prWorktree,
		changedPaths,
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
		drive: async (input) => driveSingleTaskLane(input, { stateDir, profile: executor, pluginRoot }),
		driveInitiative: async (input) => driveInitiativeLane(input),
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
				const res = runAcceptanceCommand(worktree_path, command.command);
				if (res.exit_code !== 0) return res;
			}
			return { exit_code: 0, stdout: "acceptance verification passed", stderr: "" };
		},
		gitCommitAndPush: async ({ worktree_path, branch, message }) => {
			commitWorktree(worktree_path, message);
			const push = git(worktree_path, ["push", "origin", `HEAD:refs/heads/${branch}`]);
			if (push.status !== 0) throw new Error(`git_push_failed: ${push.stderr.trim()}`);
			const head = git(worktree_path, ["rev-parse", "HEAD"]);
			if (head.status !== 0) throw new Error(`git_head_unreadable: ${head.stderr.trim()}`);
			return { commit_sha: head.stdout.trim() };
		},
		gitForcePushWithLease: async ({ worktree_path, branch, message }) => {
			// ADR 0039 Decision 10: a rewritten history only goes back to a daemon branch.
			if (!isDaemonBranch(branch)) throw new Error(`force_push_refused: ${branch} is not a daemon-created branch`);
			commitWorktree(worktree_path, message);
			const push = git(worktree_path, ["push", "--force-with-lease", "origin", `HEAD:refs/heads/${branch}`]);
			if (push.status !== 0) throw new Error(`git_force_push_failed: ${push.stderr.trim()}`);
			const head = git(worktree_path, ["rev-parse", "HEAD"]);
			if (head.status !== 0) throw new Error(`git_head_unreadable: ${head.stderr.trim()}`);
			return { commit_sha: head.stdout.trim() };
		},
		rebaseOrMerge: async ({ worktree_path, base_branch }) => {
			// `syncWorktreeToHead` cleared any leftover rebase before this handler ran.
			const fetch = git(worktree_path, ["fetch", "origin", base_branch]);
			if (fetch.status !== 0) return { success: false, error: fetch.stderr.trim() };
			const rebase = git(worktree_path, ["rebase", `origin/${base_branch}`]);
			if (rebase.status === 0) return { success: true };
			// D9: keep the conflicted tree so a repair session can resolve it.
			const conflicting = git(worktree_path, ["diff", "--name-only", "--diff-filter=U"]);
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
	// A resumed tick re-enters the active batch id; only first entry mints one.
	const resumed = findActiveLaneBatchForTask(input.root, input.task_id);
	const binding: BatchAuthorizationBinding = {
		batch_id: resumed?.record.batch_id ?? `batch-${input.task_id}-${randomUUID()}`,
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
		advanceTask: daemonAdvanceTask,
		resume: {
			isResuming: projection.is_resuming,
			existingBatch: projection.existing_batch,
			batchBranch: projection.batch_branch,
		},
	});

	const result = await dispatchLoopDrive({
			root: input.root,
			task_id: input.task_id,
			batch_id: binding.batch_id,
			registry,
			capability,
			children: authorityChildren,
			plan_digest: projection.plan_digest,
			base_head: binding.base_head,
			confirmation: {
				source: input.confirmation_source ?? (input.confirmation_ref.startsWith("policy_auto") ? "policy_auto" : "tracker_approval"),
				ref: input.confirmation_ref,
			},
			confirmation_time: input.now,
			budget: projection.budget,
			now: input.now,
			kernel,
			git: createDefaultBatchGitPort(),
			max_parallel: 1,
			supervision: {
				parent_host: context.profile.host,
				...(context.profile.model || context.profile.effort
					? {
							request: {
								...(context.profile.model ? { model: context.profile.model } : {}),
								...(context.profile.effort ? { effort: context.profile.effort } : {}),
							},
						}
					: {}),
			},
		});
		return {
			settled: result.settled,
			exit: result.exit,
			reason: result.reason,
			...(result.hold_for_dialog ? { hold_for_dialog: result.hold_for_dialog } : {}),
			...(result.parked ? { parked: result.parked } : {}),
		};
}

/**
 * The Initiative entry is pending (Spec loop-uls-alignment D1.1). The retired
 * observeInitiative drive built its own batch binding and driver; the Initiative
 * entry now belongs to the unified Lane session path that S2 introduces
 * (`startLanes` / `advanceLanes`, D2). Until then the daemon refuses with a named
 * reason: the job fails and the WorkItem stays retryable, so no slice runs on a
 * stale shape. Exit condition: S2 deletes this refusal.
 */
export const LANE_INITIATIVE_ENTRY_PENDING = "lane_initiative_entry_pending";

export async function driveInitiativeLane(input: AgentDriveInitiativeRequest): Promise<AgentDriveResult> {
	return {
		settled: false,
		exit: null,
		reason: `${LANE_INITIATIVE_ENTRY_PENDING}: the daemon has no Initiative entry for ${input.slug} yet; Slice S2 of loop-leader-uls-alignment adds it. Retry after S2 lands.`,
	};
}
