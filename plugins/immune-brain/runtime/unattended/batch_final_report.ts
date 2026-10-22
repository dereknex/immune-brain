// D24: describe the delivered Parent tree, then optionally return the coordinator
// to that exact commit. The report is observation, never replacement QA authority.
import { spawnSync } from "node:child_process";
import { readGitIntegrationPreference, type GitIntegrationMode } from "../git_integration_preference";
import { readAuditTaskPair } from "../kernel/storage";
import { intentAuthorityHash, observeEnrollmentTaskIntent, readTaskIntent } from "../kernel/intent";
import { resolveProjectedRisk } from "../kernel/completion";
import { readRiskFloor } from "../kernel/risk_floor";
import type { EvidenceStatus, TaskIntentV1 } from "../kernel/types";
import { pathMatchesScope, taskCommitRevisionIdentity } from "../workspace_scope";
import { expectedBatchHead } from "./batch_preflight";
import { isParentBranch } from "./batch_ref";
import { withParentWorktree } from "./batch_worktrees";
import type { BatchLaneRunStateRecord } from "./batch_state";
import type { FinalVerificationReport } from "./batch_final_verification";

export interface BatchFinalReport {
	contract: "assurance_kernel/batch_final_report/v1";
	head: string;
	children: Array<{
		task_id: string;
		acceptance: Array<{ id: string; qa: EvidenceStatus | null }>;
		beyond_estimate: string[] | null;
		declared_risk: TaskIntentV1["risk"];
		projected_risk: TaskIntentV1["risk"] | null;
		redo_count: number;
		parked_reason: string | null;
	}>;
	final_verification: FinalVerificationReport | null;
	return_to_coordinator: { mode: GitIntegrationMode; status: "manual" | "fast_forwarded" | "blocked"; reason: string | null };
}

function git(root: string, ...argv: string[]) {
	return spawnSync("git", ["--no-optional-locks", "-C", root, ...argv], { encoding: "utf8" });
}

/** No checkout, reset, forced ref update, commit or push. Git retains its hooks. */
export function returnBatchToCoordinator(root: string, head: string, final: FinalVerificationReport | null): BatchFinalReport["return_to_coordinator"] {
	const { mode } = readGitIntegrationPreference(root);
	if (mode === "manual") return { mode, status: "manual", reason: null };
	const blocked = (reason: string): BatchFinalReport["return_to_coordinator"] => ({ mode, status: "blocked", reason });
	if (!final?.passed || final.head !== head) return blocked("final_verification_not_passed");
	const branch = git(root, "symbolic-ref", "--quiet", "HEAD");
	if (branch.status !== 0) return blocked("coordinator_branch_unavailable");
	const status = git(root, "status", "--porcelain", "--untracked-files=all");
	if (status.status !== 0) return blocked("coordinator_status_unreadable");
	if (status.stdout.length) return blocked("coordinator_working_tree_dirty");
	if (git(root, "merge-base", "--is-ancestor", "HEAD", head).status !== 0) return blocked("coordinator_head_diverged");
	const merge = git(root, "merge", "--ff-only", "--no-edit", head);
	if (merge.status !== 0) return blocked(`coordinator_fast_forward_failed: ${merge.stderr.trim()}`);
	return { mode, status: "fast_forwarded", reason: null };
}

/** Integrated evidence belongs to the Parent; pending planning inputs may be uncommitted. */
export async function buildBatchFinalReport(root: string, record: BatchLaneRunStateRecord): Promise<BatchFinalReport> {
	if (!isParentBranch(record.branch)) throw new Error("final report requires a Parent branch batch");
	const head = expectedBatchHead(record);
	const children = await withParentWorktree(root, head, async path => {
		const floor = readRiskFloor(path);
		return record.children.map(child => {
			const integrated = child.state === "integrated" || child.state === "released";
			const audit = integrated ? readAuditTaskPair(path, child.task_id, child.lane?.run_id ?? undefined) : null;
			if (integrated && (!audit || audit.proof.terminal_lifecycle !== "done" || audit.record.contract !== "assurance_kernel/task_record/v4"))
				throw new Error(`final report missing settled evidence: ${child.task_id}`);
			let intent: TaskIntentV1;
			if (audit) intent = audit.record.intent_snapshot;
			else {
				const approved = record.intent_identities?.[child.task_id];
				if (!approved) throw new Error(`final report missing approved planning identity: ${child.task_id}`);
				const planning = approved.intent_path === `docs/plans/${child.task_id}.intent.json`
					? observeEnrollmentTaskIntent(root, child.task_id)
					: readTaskIntent(root, child.task_id, approved.intent_path);
				const matches = approved.intent_authority_hash
					? intentAuthorityHash(planning.intent) === approved.intent_authority_hash
					: planning.intent.revision === approved.intent_revision && planning.content_hash === approved.intent_content_hash;
				if (!matches) throw new Error(`final report planning evidence changed: ${child.task_id}`);
				intent = planning.intent;
			}
			const qa = audit && "attestations" in audit.record ? [...audit.record.attestations].reverse().find(item =>
				item.kind === "qa" && item.task_revision === intent.revision && item.intent_content_hash === audit.record.intent_ref.content_hash) : undefined;
			// Each rebuilt integration commit contains just this child's delivered delta.
			const parent = child.commit ? git(path, "rev-parse", `${child.commit}^`) : null;
			if (parent && parent.status !== 0) throw new Error(`final report unreadable integration: ${child.task_id}`);
			const paths = child.commit ? taskCommitRevisionIdentity(path, ["**"], parent!.stdout.trim(), child.commit).changed_paths : null;
			return {
				task_id: child.task_id,
				acceptance: intent.acceptance.map(item => ({ id: item.id, qa: qa?.acceptance_results.find(result => result.acceptance_id === item.id)?.status ?? null })),
				beyond_estimate: paths?.filter(file => !intent.scope_hint.some(scope => pathMatchesScope(file, scope))) ?? null,
				declared_risk: intent.risk,
				projected_risk: paths ? resolveProjectedRisk(intent, paths, floor) : null,
				redo_count: child.redo_grants ?? 0,
				parked_reason: integrated ? null : child.reason,
			};
		});
	});
	return { contract: "assurance_kernel/batch_final_report/v1", head, children,
		final_verification: record.final_verification_result ?? null,
		return_to_coordinator: { mode: readGitIntegrationPreference(root).mode, status: "blocked", reason: "return_pending" } };
}
