// Snapshot and verdict authority shared by all Assurance hosts.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readTaskRecordRaw, recoverKernelStoreFollowUps } from "../kernel/storage";
import { readTaskIntent } from "../kernel/intent";
import { projectAssurance, type AssuranceProjectionResult } from "../kernel/assurance_projection";
import { capabilityActionFor, createCanaryApplication } from "../kernel/canary_application";
import { createMutationAuthorityRegistry, digestOfAction } from "../kernel/authority_port";
import { findingsDigestV2 } from "../kernel/reducer";
import { GIT_OBJECT_ID } from "../kernel/validation";
import type { TaskRecord, TaskApprovalV2, ReviewObservationFacts, ReviewVerificationHistoryV1, ReviewVerifierDisputeV1, TaskFinding } from "../kernel/types";
import { captureGitTaskSnapshot } from "../workspace_scope";
import { parseVerificationDescriptor } from "../verification_descriptor";
import type { VerificationDescriptor } from "./verification";
import { captureReviewFacts, type ReviewFacts, type ReviewRevisionCommit } from "./review_evidence";
import { reviewReworkFindings, reviewAdvisoryRecords, snapshotDigest, type SnapshotDescriptor, type AssuranceRole, type AssuranceVerdict, type HostContext } from "./coordinator";
import type { InvocationToken } from "./invocations";
import type { ConfirmationReferenceSource } from "./host_port";

export interface SnapshotDescriptorInput {
	root: string;
	task_id: string;
	role: AssuranceRole;
	run_id?: string | null;
	record_revision: string;
	workspace_revision: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	lifecycle: string;
	artifact_state: string;
	risk?: "routine" | "material" | "critical";
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_attestation_ids: string[];
	acceptance: Array<{ id: string; assertion: string; verification: string }>;
	dirty_files?: string[];
	review_delta?: SnapshotDescriptor["review_delta"];
	/** Present only when Review authority binds an immutable Git revision (v4). */
	review_revision?: {
		contract: "assurance_kernel/review_revision_identity/v2";
		base_head: string;
		review_commit: string;
	};
}

export function buildSnapshot(input: SnapshotDescriptorInput): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: input.task_id,
		run_id: input.run_id ?? null,
		role: input.role,
		record_revision: input.record_revision,
		workspace_revision: input.workspace_revision,
		intent_revision: input.intent_revision,
		intent_content_hash: input.intent_content_hash,
		diff_hash: input.diff_hash,
		lifecycle: input.lifecycle,
		artifact_state: input.artifact_state,
		risk: input.risk ?? "material",
		fresh_acceptance_ids: input.fresh_acceptance_ids,
		missing_acceptance_ids: input.missing_acceptance_ids,
		stale_attestation_ids: input.stale_attestation_ids,
		acceptance: input.acceptance,
		dirty_files: [...(input.dirty_files ?? [])].sort(),
		...(input.review_revision ? { review_revision: input.review_revision } : {}),
		...(input.review_delta ? { review_delta: input.review_delta } : {}),
		root: resolve(input.root),
	};
}


/** Review round 3 and later reviews only the latest rework delta. */
const REVIEW_DELTA_FROM_ROUND = 3;

/**
 * The Review round the next dispatch opens and the commit the previous round
 * analyzed, read from its Review rework. A record with no persisted prior
 * revision yields `prior_review_commit: null`, which skips the delta rule.
 */
export function reviewDelta(root: string, record: TaskRecord, reviewCommit: string): SnapshotDescriptor["review_delta"] {
	const round = Math.max(
		0,
		...record.findings.filter((item) => item.source === "review").map((item) => item.review_round ?? 0),
	) + 1;
	if (round < REVIEW_DELTA_FROM_ROUND) return undefined;
	const prior = [...record.history]
		.reverse()
		.find((entry) => entry.type === "request_rework" && entry.reason.split("\n")[0] === `review_round_${round - 1}`);
	const priorCommit = prior?.review_revision?.review_commit;
	if (!priorCommit || !GIT_OBJECT_ID.test(priorCommit)) return { round, prior_review_commit: null };
	try {
		const output = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", priorCommit, reviewCommit], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		return { round, prior_review_commit: priorCommit, delta_paths: output.split("\0").filter(Boolean).sort() };
	} catch {
		// A pruned prior commit leaves nothing to diff; the rule does not apply.
		return { round, prior_review_commit: null };
	}
}

function reviewFactsFor(root: string, taskId: string, record: TaskRecord, baseHead: string, diffHash: string): ReviewFacts {
	return captureReviewFacts(root, {
		taskId,
		baseHead,
		scopeHint: record.intent_snapshot.scope_hint,
		expectedDiffHash: diffHash,
		intent: record.intent_snapshot,
		outcomes: qaOutcomes(record),
	});
}

/**
 * Publish the immutable synthetic commit the next Review analyzes. A v3 record
 * has no Enrollment base and cannot be reviewed (#565 retired the bundle path).
 */
export async function ensureReviewRevision(
	root: string,
	taskId: string,
	projection: AssuranceProjectionResult,
): Promise<ReviewRevisionCommit> {
	const current = await readTaskRecordRaw(root, taskId);
	const record = current.record;
	if (!record) throw new Error(`task ${taskId} has no TaskRecord before Review preparation`);
	if (current.revision !== projection.projection.record_revision)
		throw new Error("TaskRecord changed before Review preparation");
	if (record.contract !== "assurance_kernel/task_record/v4" || !record.git_base_head)
		throw new Error("Review requires a TaskRecord v4 git_base_head; re-enroll the task");
	return reviewFactsFor(root, taskId, record, record.git_base_head, projection.projection.diff_hash).revision;
}

export async function buildAssuranceSnapshot(
	root: string,
	taskId: string,
	role: AssuranceRole,
	projection: AssuranceProjectionResult,
	readRecord: typeof readTaskRecordRaw = readTaskRecordRaw,
): Promise<{
	snapshot: SnapshotDescriptor;
	descriptors: Map<string, VerificationDescriptor>;
	reviewFacts: ReviewFacts | null;
}> {
	const record = await readRecord(root, taskId);
	if (
		!record.record ||
		record.revision !== projection.projection.record_revision ||
		record.record.intent_snapshot.revision !== projection.projection.intent_revision ||
		record.record.intent_ref.content_hash !== projection.projection.intent_content_hash
	) {
		throw new Error("TaskRecord changed before assurance snapshot capture");
	}
	const intent = record.record.intent_snapshot;
	const acceptance = intent.acceptance;
	const descriptors = new Map<string, VerificationDescriptor>();
	// Review resumes from settled outcomes without resolving verification tools.
	for (const item of role === "qa" ? acceptance : []) {
		const descriptor = parseVerificationDescriptor(item.verification);
		descriptors.set(item.id, descriptor);
	}
	// `git_base_head` is optional on the read shape because v3 records carry
	// none, so the contract test alone does not prove it is present.
	const baseHead = record.record.contract === "assurance_kernel/task_record/v4"
		? record.record.git_base_head
		: undefined;
	if (record.record.contract === "assurance_kernel/task_record/v4" && !baseHead)
		throw new Error("TaskRecord v4 is missing its Enrollment git_base_head");
	if (role === "review" && !baseHead)
		throw new Error("Review requires a TaskRecord v4 git_base_head; re-enroll the task");
	const reviewFacts = role === "review"
		? reviewFactsFor(root, taskId, record.record, baseHead!, projection.projection.diff_hash)
		: null;
	const dirtyFiles = reviewFacts
		? reviewFacts.changed_paths
		: Object.keys(captureGitTaskSnapshot(root, intent.scope_hint, taskId).staged_files);
	return {
		snapshot: buildSnapshot({
				root,
				task_id: taskId,
				role,
				run_id: projection.projection.run_id,
				record_revision: projection.projection.record_revision,
				workspace_revision: projection.projection.workspace_revision,
				intent_revision: projection.projection.intent_revision,
				intent_content_hash: projection.projection.intent_content_hash,
				diff_hash: projection.projection.diff_hash,
				lifecycle: projection.projection.lifecycle,
				artifact_state: projection.projection.artifact_state,
				risk: intent.risk,
				fresh_acceptance_ids: projection.projection.fresh_acceptance_ids,
				missing_acceptance_ids: projection.projection.missing_acceptance_ids,
				stale_attestation_ids: projection.projection.stale_attestation_ids,
				acceptance,
				dirty_files: dirtyFiles,
				review_revision: reviewFacts
					? {
							contract: "assurance_kernel/review_revision_identity/v2",
							base_head: reviewFacts.revision.base_head,
							review_commit: reviewFacts.revision.review_commit,
						}
					: undefined,
				review_delta: reviewFacts ? reviewDelta(root, record.record, reviewFacts.revision.review_commit) : undefined,
		}),
		descriptors,
		reviewFacts,
	};
}

function qaOutcomes(
	record: TaskRecord,
): Record<string, { status: "passed" | "failed" | "blocked"; summary: string }> {
	return Object.fromEntries(
		record.attestations
			.filter((item) => item.kind === "qa")
			.flatMap((item) => item.acceptance_results)
			.map((result) => [result.acceptance_id, { status: result.status, summary: result.summary }]),
	);
}

export function stagePlanningArtifactTransition(root: string, record: {
	intent_ref: { path: string };
	intent_snapshot: { scope_hint: string[] };
}): void {
	const intentActive = record.intent_ref.path.replace("docs/plans/archive/", "docs/plans/");
	const intentArchive = intentActive.replace("docs/plans/", "docs/plans/archive/");
	const specActive = record.intent_snapshot.scope_hint.find((path) =>
		/^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/.test(path)
		&& record.intent_snapshot.scope_hint.includes(path.replace("docs/specs/", "docs/specs/archive/")),
	);
	const candidates = [
		intentActive,
		intentArchive,
		...(specActive ? [specActive, specActive.replace("docs/specs/", "docs/specs/archive/")] : []),
	];
	const paths = candidates.filter((path) => existsSync(join(root, path)) || execFileSync(
		"git",
		["ls-files", "--cached", "--", path],
		{ cwd: root, encoding: "utf8" },
	).trim().length > 0);
	if (paths.length === 0) return;
	execFileSync("git", ["add", "--", ...paths], {
		cwd: root,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

export interface VerdictApplicationInput {
 taskId: string;
 snapshot: SnapshotDescriptor;
 verdict: AssuranceVerdict;
 invocation: InvocationToken;
 actorId: string;
 /** ADR 0017: sha256 over the reviewer's own result bytes, bound only on review attestations. */
 reviewer_verdict_sha256?: string;
 /** Kept IDs are a projection; the submitted reviewer verdict remains unchanged. */
 verification?: { facts: ReviewVerificationHistoryV1; kept_finding_ids: string[] };
 review_observation?: ReviewObservationFacts;
 hooks?: { beforeCommit?: () => Promise<void>; onCommit?: () => void; afterCommit?: () => Promise<void> };
}
export interface VerdictAuthority {
 buildAssurance: typeof buildAssuranceSnapshot;
 ensureReviewRevision: typeof ensureReviewRevision;
 applyVerdict(ctx: HostContext, input: VerdictApplicationInput): Promise<void>;
 recordVerification(ctx: HostContext, input: VerdictApplicationInput & { verification: NonNullable<VerdictApplicationInput["verification"]> }): Promise<void>;
 recordReviewDispute(ctx: HostContext, input: VerdictApplicationInput & { dispute: ReviewVerifierDisputeV1 }): Promise<void>;
}

function verifiedReviewFindings(input: VerdictApplicationInput): TaskFinding[] {
 const findings = reviewReworkFindings(input.verdict);
 const verification = input.verification;
 if (!verification) return findings;
 const { facts, kept_finding_ids: keptIds } = verification;
 if (input.snapshot.role !== "review" || facts.snapshot_digest !== snapshotDigest(input.snapshot)
  || facts.intent_content_hash !== input.snapshot.intent_content_hash || facts.diff_hash !== input.snapshot.diff_hash
  || facts.verdict_sha256 !== input.reviewer_verdict_sha256 || facts.checked !== findings.length)
  throw new Error("verification does not bind the submitted Review snapshot and verdict");
 const kept = new Set(keptIds);
 if (kept.size !== keptIds.length) throw new Error("verification has duplicate kept findings");
 const refuted = new Map(facts.verifier_refutations.map(item => [item.finding_id, item]));
 if (refuted.size !== facts.verifier_refutations.length || kept.size + refuted.size !== findings.length)
  throw new Error("verification must account for every Review finding exactly once");
 for (const finding of findings) {
  const counter = refuted.get(finding.id);
  if (kept.has(finding.id) === Boolean(counter) || (counter && counter.anchor !== finding.anchor))
   throw new Error("verification finding identity does not match the submitted Review verdict");
 }
 return findings.filter(finding => kept.has(finding.id));
}

async function requireFreshVerdictSnapshot(ctx: HostContext, snapshot: SnapshotDescriptor): Promise<void> {
 const fresh = await projectAssurance(ctx.cwd, snapshot.task_id);
 const fields = ["record_revision", "workspace_revision", "intent_revision", "intent_content_hash", "diff_hash", "lifecycle", "artifact_state"] as const;
 const mismatches = fields.filter(field => fresh.projection[field] !== snapshot[field]);
 if (fresh.error || fresh.claim?.task_id !== snapshot.task_id || mismatches.length)
  throw new Error(`assurance snapshot changed before authority application: ${[fresh.error, fresh.claim?.task_id !== snapshot.task_id ? "claim" : null, ...mismatches].filter(Boolean).join(", ")}`);
}

export function createVerdictAuthority(options: {
 confirmationReference: ConfirmationReferenceSource;
 commitInvocation: (token: InvocationToken) => void;
 onReworkApplied?: (ctx: HostContext, taskId: string, findingsCount: number) => void;
}, registry = createMutationAuthorityRegistry()): VerdictAuthority {
 const app = createCanaryApplication(registry);
 return {
  buildAssurance: buildAssuranceSnapshot,
  ensureReviewRevision,
  async applyVerdict(ctx, input) {
   const { snapshot, verdict, actorId, hooks = {} } = input;
   await requireFreshVerdictSnapshot(ctx, snapshot);
   recoverKernelStoreFollowUps(ctx.cwd, snapshot.task_id);
   const record = readTaskRecordRaw(ctx.cwd, snapshot.task_id).record;
   if (!record) throw new Error("TaskRecord disappeared before authority application");
   const priorIntentToken = readTaskIntent(ctx.cwd, snapshot.task_id, record.intent_ref.path, record.intent_snapshot).token;
   const now = new Date().toISOString();
   const findings = verdict.decision === "rework" ? verifiedReviewFindings(input) : [];
   if (verdict.decision === "rework" && findings.length === 0) throw new Error("all-refuted Review requires recordVerification");
   const advisories = verdict.decision === "pass" ? reviewAdvisoryRecords(verdict) : [];
   const approval: TaskApprovalV2 | undefined = verdict.decision === "pass" ? {
    id: `approval-${snapshot.role}-${randomUUID().slice(0, 8)}`,
    kind: snapshot.role, authority_role: snapshot.role === "qa" ? "qa" : "reviewer",
    task_revision: snapshot.intent_revision, intent_content_hash: snapshot.intent_content_hash,
    diff_hash: snapshot.diff_hash, actor_id: actorId, summary: verdict.approval!.summary,
    ...(snapshot.role === "review" && snapshot.review_revision ? { review_revision: snapshot.review_revision } : {}),
    ...(snapshot.role === "review" && advisories.length ? { advisory_findings: advisories } : {}),
    ...(snapshot.role === "review" && input.reviewer_verdict_sha256 ? { reviewer_verdict_sha256: input.reviewer_verdict_sha256 } : {}),
   } : undefined;
   const op = verdict.decision === "rework" ? "request_rework" : "record_approval";
   const payload = approval ? { approval } : { findings };
   // Only a Review-authored rework persists the revision it analyzed; the next
   // round derives its delta from it. QA rework never carries one.
   const reworkRevision = verdict.decision === "rework" && snapshot.role === "review" && snapshot.review_revision
    ? { review_revision: snapshot.review_revision } : {};
   const verification = input.verification ? { verification: input.verification.facts } : {};
   const reviewObservation = snapshot.role === "review" && input.review_observation ? { review_observation: input.review_observation } : {};
   const action = capabilityActionFor({ op, task_id: snapshot.task_id, at: now, actor_id: actorId, ...payload, ...reworkRevision, ...verification, ...reviewObservation });
   const capability = registry.issue({
    authority_kind: snapshot.role, task_id: snapshot.task_id,
    ...(snapshot.run_id ? { run_id: snapshot.run_id } : {}),
    action_digest: digestOfAction(action), expected_record_hash: snapshot.record_revision,
    intent_revision: snapshot.intent_revision, intent_content_hash: snapshot.intent_content_hash,
    diff_hash: snapshot.diff_hash, actor_id: actorId,
    confirmation_ref: options.confirmationReference({ snapshot, actorId, now }),
    findings_digest: verdict.decision === "rework" ? findingsDigestV2(findings) : null,
   });
   await hooks.beforeCommit?.();
   options.commitInvocation(input.invocation);
   // Preserve the Pi ordering: start settlement, run onCommit, await settlement,
   // then afterCommit. A thrown hook never undoes the committed transition.
   const settlement = (async () => app.execute({ root: ctx.cwd, task_id: snapshot.task_id,
    operation: approval ? { op: "record_approval", capability, approval, actor_id: actorId, ...reviewObservation }
     : { op: "request_rework", capability, findings, actor_id: actorId, ...reworkRevision, ...verification, ...reviewObservation }, prior_intent_token: priorIntentToken, now }))();
   let hookFailed = false;
   let hookError: unknown;
   try { hooks.onCommit?.(); } catch (error) { hookFailed = true; hookError = error; }
   const result = await settlement;
   try { await hooks.afterCommit?.(); } catch (error) { if (!hookFailed) { hookFailed = true; hookError = error; } }
   if (hookFailed) throw hookError;
   // Staging the planning-artifact transition is a post-commit side effect, so it
   // runs after the hook lifecycle: a hook error is reported untouched, and a
   // staging failure can neither skip afterCommit nor mask the first error.
   if (verdict.decision === "rework") stagePlanningArtifactTransition(ctx.cwd, result.record);
   if (verdict.decision === "rework" && result.record.findings.some(f => f.kind === "replan_required" && f.status === "open"))
    options.onReworkApplied?.(ctx, snapshot.task_id, findings.length);
  },
  async recordReviewDispute(ctx, input) {
   const { snapshot, actorId, dispute } = input;
   if (snapshot.role !== "review" || input.verdict.decision !== "rework" || dispute.verdict_sha256 !== input.reviewer_verdict_sha256
    || dispute.diff_hash !== snapshot.diff_hash || dispute.intent_content_hash !== snapshot.intent_content_hash)
    throw new Error("dispute does not bind the submitted Review verdict and snapshot");
   const finding = input.verdict.findings?.find(item => item.id === dispute.finding.id);
   if (!finding || finding.anchor !== dispute.finding.anchor || JSON.stringify(finding.evidence) !== JSON.stringify(dispute.finding.evidence)
    || finding.summary !== dispute.finding.summary || finding.acceptance_id !== dispute.finding.acceptance_id)
    throw new Error("disputed claim does not match the submitted Review verdict");
   if (input.verification && verifiedReviewFindings(input).length !== 0)
    throw new Error("exhausted redispatch dispute requires all findings refuted");
   await requireFreshVerdictSnapshot(ctx, snapshot);
   recoverKernelStoreFollowUps(ctx.cwd, snapshot.task_id);
   const record = readTaskRecordRaw(ctx.cwd, snapshot.task_id).record;
   if (!record) throw new Error("TaskRecord disappeared before dispute application");
   const priorIntentToken = readTaskIntent(ctx.cwd, snapshot.task_id, record.intent_ref.path, record.intent_snapshot).token;
   const now = new Date().toISOString();
   const verification = input.verification ? { verification: input.verification.facts } : {};
   const action = capabilityActionFor({ op: "record_review_verifier_dispute", task_id: snapshot.task_id, at: now, actor_id: actorId, dispute, ...verification });
   const capability = registry.issue({ authority_kind: "review", task_id: snapshot.task_id,
    ...(snapshot.run_id ? { run_id: snapshot.run_id } : {}), action_digest: digestOfAction(action),
    expected_record_hash: snapshot.record_revision, intent_revision: snapshot.intent_revision,
    intent_content_hash: snapshot.intent_content_hash, diff_hash: snapshot.diff_hash, actor_id: actorId,
    confirmation_ref: options.confirmationReference({ snapshot, actorId, now }), findings_digest: null });
   options.commitInvocation(input.invocation);
   app.execute({ root: ctx.cwd, task_id: snapshot.task_id, operation: { op: "record_review_verifier_dispute", capability, dispute, actor_id: actorId, ...verification }, prior_intent_token: priorIntentToken, now });
  },
  async recordVerification(ctx, input) {
   const { snapshot, actorId, verification } = input;
   if (verifiedReviewFindings(input).length !== 0) throw new Error("standalone verification requires all findings refuted");
   await requireFreshVerdictSnapshot(ctx, snapshot);
   recoverKernelStoreFollowUps(ctx.cwd, snapshot.task_id);
   const record = readTaskRecordRaw(ctx.cwd, snapshot.task_id).record;
   if (!record) throw new Error("TaskRecord disappeared before verification application");
   const priorIntentToken = readTaskIntent(ctx.cwd, snapshot.task_id, record.intent_ref.path, record.intent_snapshot).token;
   const now = new Date().toISOString();
   const action = capabilityActionFor({ op: "record_verification", task_id: snapshot.task_id, at: now, actor_id: actorId, verification: verification.facts });
   const capability = registry.issue({ authority_kind: "review", task_id: snapshot.task_id,
    ...(snapshot.run_id ? { run_id: snapshot.run_id } : {}), action_digest: digestOfAction(action),
    expected_record_hash: snapshot.record_revision, intent_revision: snapshot.intent_revision,
    intent_content_hash: snapshot.intent_content_hash, diff_hash: snapshot.diff_hash, actor_id: actorId,
    confirmation_ref: options.confirmationReference({ snapshot, actorId, now }), findings_digest: null });
   options.commitInvocation(input.invocation);
   app.execute({ root: ctx.cwd, task_id: snapshot.task_id, operation: { op: "record_verification", capability,
    verification: verification.facts, actor_id: actorId }, prior_intent_token: priorIntentToken, now });
  },
 };
}
