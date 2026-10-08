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
import type { TaskRecord, TaskApprovalV2 } from "../kernel/types";
import { captureGitTaskSnapshot } from "../workspace_scope";
import { parseVerificationDescriptor } from "../verification_descriptor";
import type { VerificationDescriptor } from "./verification";
import { captureReviewBundle, captureReviewManifest, type ReviewBundle, type ReviewManifestV5, type ReviewRevision } from "./review_evidence";
import { reviewReworkFindings, reviewAdvisoryRecords, type SnapshotDescriptor, type AssuranceRole, type AssuranceVerdict, type HostContext } from "./coordinator";
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
	review_bundle_digest?: string | null;
	/** Present only when Review authority binds an immutable Git revision (v4). */
	review_revision?: {
		contract: "assurance_kernel/review_revision_identity/v1";
		base_head: string;
		review_commit: string;
		review_tree: string;
		manifest_digest: string;
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
		review_bundle_digest: input.review_bundle_digest ?? null,
		...(input.review_revision ? { review_revision: input.review_revision } : {}),
		root: resolve(input.root),
	};
}


export async function ensureReviewRevision(
	root: string,
	taskId: string,
	projection: AssuranceProjectionResult,
): Promise<ReviewRevision | null> {
	const current = await readTaskRecordRaw(root, taskId);
	const record = current.record;
	if (!record) throw new Error(`task ${taskId} has no TaskRecord before Review preparation`);
	if (current.revision !== projection.projection.record_revision)
		throw new Error("TaskRecord changed before Review preparation");
	if (record.contract !== "assurance_kernel/task_record/v4") return null;
	if (!record.git_base_head)
		throw new Error("Review revision requires a TaskRecord v4 git_base_head");
	const manifest = captureReviewManifest(root, {
		taskId,
		baseHead: record.git_base_head,
		scopeHint: record.intent_snapshot.scope_hint,
		expectedDiffHash: projection.projection.diff_hash,
		intentRevision: projection.projection.intent_revision,
		intentContentHash: projection.projection.intent_content_hash,
		recordRevision: projection.projection.record_revision,
		workspaceRevision: projection.projection.workspace_revision,
		lifecycle: projection.projection.lifecycle,
		artifactState: projection.projection.artifact_state,
		risk: record.intent_snapshot.risk,
		// The same outcomes the Review snapshot is built from. A preflight stand-in
		// only matched the settled QA attestation because deterministic QA happens to
		// write that exact summary, so the submit-time digest comparison held by
		// coincidence rather than by construction.
		outcomes: qaOutcomes(record),
	});
	return {
		contract: "assurance_kernel/review_revision/v1",
		base_head: manifest.base_head,
		review_tree: manifest.review_tree,
		review_commit: manifest.review_commit,
		review_ref: manifest.review_ref,
		diff_hash: manifest.diff_hash,
		manifest_digest: manifest.manifest_digest,
	};
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
	reviewBundle: ReviewBundle | null;
	reviewManifest: ReviewManifestV5 | null;
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
	const reviewRevision = baseHead
		? {
			contract: "assurance_kernel/review_revision_identity/v1" as const,
			base_head: baseHead,
			review_commit: "",
			review_tree: "",
			manifest_digest: "",
		}
		: null;
	const reviewBundle = role === "review" && !reviewRevision
		? captureReviewBundle(
				root,
				intent.scope_hint,
				projection.projection.diff_hash,
				qaOutcomes(record.record),
			)
		: null;
	const reviewManifest = role === "review" && reviewRevision
		? captureReviewManifest(root, {
				taskId,
				baseHead: reviewRevision.base_head,
				scopeHint: intent.scope_hint,
				expectedDiffHash: projection.projection.diff_hash,
				intentRevision: projection.projection.intent_revision,
				intentContentHash: projection.projection.intent_content_hash,
				recordRevision: projection.projection.record_revision,
				workspaceRevision: projection.projection.workspace_revision,
				lifecycle: projection.projection.lifecycle,
				artifactState: projection.projection.artifact_state,
				risk: intent.risk,
				outcomes: qaOutcomes(record.record),
			})
		: null;
	const taskSnapshot = !reviewBundle && !reviewManifest
		? captureGitTaskSnapshot(root, intent.scope_hint, taskId)
		: null;
	const dirtyFiles = reviewManifest
		? Object.keys(reviewManifest.changed_paths)
		: reviewBundle
			? Object.keys(reviewBundle.dirty_files)
			: Object.keys(taskSnapshot!.staged_files);
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
				review_bundle_digest: reviewManifest?.manifest_digest ?? reviewBundle?.bundle_digest ?? null,
				review_revision: reviewManifest
					? {
							contract: "assurance_kernel/review_revision_identity/v1",
							base_head: reviewManifest.base_head,
							review_commit: reviewManifest.review_commit,
							review_tree: reviewManifest.review_tree,
							manifest_digest: reviewManifest.manifest_digest,
						}
						: undefined,
		}),
		descriptors,
		reviewBundle,
		reviewManifest,
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
 hooks?: { beforeCommit?: () => Promise<void>; onCommit?: () => void; afterCommit?: () => Promise<void> };
}
export interface VerdictAuthority {
 buildAssurance: typeof buildAssuranceSnapshot;
 ensureReviewRevision: typeof ensureReviewRevision;
 applyVerdict(ctx: HostContext, input: VerdictApplicationInput): Promise<void>;
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
   const fresh = await projectAssurance(ctx.cwd, snapshot.task_id);
   const fields = ["record_revision", "workspace_revision", "intent_revision", "intent_content_hash", "diff_hash", "lifecycle", "artifact_state"] as const;
   const mismatches = fields.filter(field => fresh.projection[field] !== snapshot[field]);
   if (fresh.error || fresh.claim?.task_id !== snapshot.task_id || mismatches.length)
    throw new Error(`assurance snapshot changed before authority application: ${[fresh.error, fresh.claim?.task_id !== snapshot.task_id ? "claim" : null, ...mismatches].filter(Boolean).join(", ")}`);
   recoverKernelStoreFollowUps(ctx.cwd, snapshot.task_id);
   const record = readTaskRecordRaw(ctx.cwd, snapshot.task_id).record;
   if (!record) throw new Error("TaskRecord disappeared before authority application");
   const priorIntentToken = readTaskIntent(ctx.cwd, snapshot.task_id, record.intent_ref.path).token;
   const now = new Date().toISOString();
   const findings = verdict.decision === "rework" ? reviewReworkFindings(verdict) : [];
   const advisories = verdict.decision === "pass" ? reviewAdvisoryRecords(verdict) : [];
   const approval: TaskApprovalV2 | undefined = verdict.decision === "pass" ? {
    id: `approval-${snapshot.role}-${randomUUID().slice(0, 8)}`,
    kind: snapshot.role, authority_role: snapshot.role === "qa" ? "qa" : "reviewer",
    task_revision: snapshot.intent_revision, intent_content_hash: snapshot.intent_content_hash,
    diff_hash: snapshot.diff_hash, actor_id: actorId, summary: verdict.approval!.summary,
    ...(snapshot.role === "review" && snapshot.review_revision ? { review_revision: snapshot.review_revision } : {}),
    ...(snapshot.role === "review" && advisories.length ? { advisory_findings: advisories } : {}),
   } : undefined;
   const op = verdict.decision === "rework" ? "request_rework" : "record_approval";
   const payload = approval ? { approval } : { findings };
   const action = capabilityActionFor({ op, task_id: snapshot.task_id, at: now, actor_id: actorId, ...payload });
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
    operation: approval ? { op: "record_approval", capability, approval, actor_id: actorId }
     : { op: "request_rework", capability, findings, actor_id: actorId }, prior_intent_token: priorIntentToken, now }))();
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
 };
}
