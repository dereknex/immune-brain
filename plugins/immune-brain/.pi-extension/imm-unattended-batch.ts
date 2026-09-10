import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	createBatchAuthorityRegistry,
	computeBatchPlanDigest,
	deriveChildEnrollment,
	projectBatchPlan,
	startBatch,
	readGitHead,
	readWorkspaceState,
	readBackendClaim,
	readTaskIntent,
	readTaskRecord,
	advancePiTask,
	projectAssuranceForTask,
	pathMatchesScope,
	findExistingActiveBatch,
	runEnrollmentRehearsal,
	enrollCanaryTask,
	createEnrollmentAuthorityRegistry,
	type BatchPlan,
	type BatchPlanChild,
	type BatchAuthorityRegistry,
	type BatchAuthorizationBinding,
	type BatchRunnerKernelPort,
	type BatchRunnerGitPort,
	type BatchRunReport,
	type InitiativeObservationReader,
} from "./runtime-stub";
import {
	presentTaskRail,
	presentTaskRailResult,
	renderStructuredCall,
	renderStructuredResult,
	requestAuthorityDialog,
	type UserAttentionReason,
} from "./pi-canary-interaction";
import { isToolFailureState, throwToolFailure } from "./pi-canary-tool-failure";

const INITIATIVE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Map the native dialog selection to the gate decision. The registered tool's
 * dialog exposes confirm, decline, and cancel; Escape (undefined) is cancel so
 * the repository and authority stay untouched. Exported for the registered-tool
 * contract test: the dialog sits behind plan projection, so the mapping itself
 * is the testable unit, and the direct-execution suites cover the decision
 * outcomes (decline -> rejected, cancel/Escape -> cancelled) with zero writes.
 */
export function mapDialogSelection(selected: string | undefined): "accept" | "decline" | "cancel" {
	if (selected === "confirm") return "accept";
	if (selected === "decline") return "decline";
	return "cancel";
}

/**
 * Synchronous re-verification that the currently held claim for `taskId` is this
 * batch's own Kernel enrollment. Positive evidence only: the driver's durable
 * child slot (enrolled/needs_human), the batch Git lineage, the Kernel's own
 * event-id derivation, the intent identity on the TaskRecord, and the claim
 * created before the batch's last durable write. The mutable confirmation_time
 * is deliberately not used, so a needs_human re-authorization (which updates
 * confirmation_time) can never turn this batch's own claim into a foreign one.
 *
 * Called fresh at pre-confirmation, post-confirmation, and from ownsTaskClaim so
 * a claim swapped during confirmation is never adopted.
 */
function syncIsOwnBatchClaim(
	root: string,
	existingBatch: any,
	taskId: string,
	batchBranch: string,
): boolean {
	let claim: any = null;
	let workspace: any = null;
	try {
		claim = JSON.parse(readFileSync(join(root, ".imm", "state", "active-claim.json"), "utf8"));
		workspace = JSON.parse(readFileSync(join(root, ".imm", "state", "workspace.json"), "utf8"));
	} catch {
		return false;
	}
	const currentTaskId =
		workspace?.state?.current_working ||
		(claim?.lifecycle_status === "active" ? claim?.task_id : null);
	if (currentTaskId !== taskId || !claim) return false;
	const branch = spawnSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).stdout.trim();
	if (branch !== batchBranch) return false;
	const childInBatch = existingBatch.children.find((c: { task_id: string }) => c.task_id === taskId);
	if (!childInBatch || !(childInBatch.state === "enrolled" || childInBatch.state === "needs_human")) {
		return false;
	}
	let rec: any = null;
	try {
		rec = JSON.parse(readFileSync(join(root, ".imm", "state", "tasks", `${taskId}.json`), "utf8"));
	} catch {
		return false;
	}
	const lineageHeads = [existingBatch.base_head].concat(
		Array.isArray(existingBatch.commits) ? existingBatch.commits : [],
	);
	if (!lineageHeads.includes(rec.git_base_head)) return false;
	if (claim.enrollment_event_id !== `enroll-${taskId}-${claim.created_at}`) return false;
	const createdAt = Date.parse(claim.created_at);
	if (!Number.isFinite(createdAt) || createdAt > Date.parse(existingBatch.updated_at)) return false;
	if (claim.task_id !== taskId || claim.lifecycle_status !== "active") return false;
	if (claim.intent_revision !== rec.intent_snapshot?.revision) return false;
	if (claim.intent_content_hash !== rec.intent_ref?.content_hash) return false;
	return true;
}

export interface PiBatchExecutionOptions {
	root: string;
	initiativeSlug: string;
	interactive?: boolean;
	signal?: AbortSignal;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
	readInitiative?: InitiativeObservationReader;
	confirmBatch?: (details: {
		title: string;
		summary: string;
		details: string;
		planDigest: string;
		signal?: AbortSignal;
	}) => Promise<"accept" | "decline" | "cancel">;
}

export type PiBatchExecutionResult =
	| { state: "started"; batch_id: string; report: BatchRunReport }
	| { state: "rejected"; reason: string; recovery_action: string }
	| { state: "cancelled"; reason: string; recovery_action: string }
	| { state: "blocked"; reason: string; recovery_action: string };

function piConfirmationRef(input: {
	toolCallId: string;
	requestId: string;
	operation: string;
	initiativeSlug: string;
	planDigest: string;
}): string {
	return `pi-confirm-${createHash("sha256")
		.update(`${input.toolCallId}\0${input.requestId}\0${input.operation}\0${input.initiativeSlug}\0${input.planDigest}`)
		.digest("hex")
		.slice(0, 16)}`;
}

export async function executePiUnattendedBatch(
	options: PiBatchExecutionOptions,
): Promise<PiBatchExecutionResult> {
	const { root, initiativeSlug, signal } = options;
	const interactive = options.interactive ?? true;

	if (!interactive) {
		return {
			state: "rejected",
			reason: "interactive TUI elicitation is unavailable in non-interactive mode",
			recovery_action: "invoke through an interactive Pi TUI session in the current Host",
		};
	}

	if (!INITIATIVE_SLUG_PATTERN.test(initiativeSlug)) {
		return {
			state: "rejected",
			reason: `invalid initiative slug: ${initiativeSlug}`,
			recovery_action: "specify a valid initiative slug and retry in the current Host",
		};
	}

	// Check for an existing active/paused batch for this initiative
	const existingBatch = await findExistingActiveBatch(root, initiativeSlug);
	if (existingBatch?.corrupt) {
		return {
			state: "blocked",
			reason: `batch run state is unreadable or invalid: ${existingBatch.path}`,
			recovery_action: "resolve or remove the invalid batch state file, then retry in the current Host",
		};
	}
	const isResuming = existingBatch !== null;
	const batchBranch = `imm/${initiativeSlug}`;

	// 1. Active workspace claim check (pre-confirmation)
	const workspace = await readWorkspaceState(root);
	const claim = await readBackendClaim(root);
	const activeTaskId = workspace.state.current_working || (claim?.lifecycle_status === "active" ? claim.task_id : null);
	const isOwnClaim =
		isResuming &&
		activeTaskId !== null &&
		syncIsOwnBatchClaim(root, existingBatch, activeTaskId, batchBranch);
	if (activeTaskId && !isOwnClaim) {
		return {
			state: "blocked",
			reason: `an active workspace claim already exists for task: ${activeTaskId}`,
			recovery_action: "resolve or stop the active task before starting a batch in the current Host",
		};
	}

	// 2. Git HEAD & read-only preflight check (pre-confirmation)
	let baseHead: string;
	try {
		baseHead = await readGitHead(root);
	} catch (err) {
		return {
			state: "rejected",
			reason: err instanceof Error ? err.message : String(err),
			recovery_action: "commit working changes and ensure a committed Git HEAD exists in the current Host",
		};
	}

	const branchExists = spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${batchBranch}`]);
	if (branchExists.status === 0 && !isResuming) {
		return {
			state: "rejected",
			reason: `branch preflight failed: branch refs/heads/${batchBranch} already exists`,
			recovery_action: "delete or rename the conflicting branch, or commit working changes in the current Host",
		};
	}

	// review-batch-resume-porcelain-leading-space: parse the NUL-delimited v1
	// format. Trimming the whole output first shifted the fixed status columns of
	// an unstaged modification (" M path") and silently mis-scoped the path.
	const statusProc = spawnSync("git", ["-C", root, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { encoding: "utf8" });
	if (statusProc.status !== 0) {
		return {
			state: "rejected",
			reason: "branch preflight failed: git status is unreadable",
			recovery_action: "check the repository integrity and retry in the current Host",
		};
	}
	const statusEntries: Array<{ code: string; path: string }> = [];
	// -z with --no-renames lists each side of a rename as its own D/A entry, so a
	// cross-scope rename cannot hide the out-of-scope source deletion.
	for (const entry of statusProc.stdout.split("\0")) {
		if (entry.length === 0) continue;
		statusEntries.push({ code: entry.slice(0, 2), path: entry.slice(3) });
	}
	if (statusEntries.length > 0) {
		if (!isResuming) {
			return {
				state: "rejected",
				reason: "branch preflight failed: working tree is dirty",
				recovery_action: "delete or rename the conflicting branch, or commit working changes in the current Host",
			};
		}
		// Kernel projections accept staged in-flight work inside the active child's
		// authorized scope, and reject unstaged/untracked bytes or out-of-scope paths.
		// Mirror that rule here so a doomed resume fails closed with a stable reason
		// instead of surfacing an unstructured projection error.
		const inFlightChild = existingBatch.children.find((c: { state: string }) => c.state === "enrolled" || c.state === "needs_human");
		let authorizedScope: string[] = [];
		if (inFlightChild) {
			// Derive the scope from the Kernel TaskRecord intent snapshot first: a
			// frozen/archived sidecar must not shrink the authorized scope to empty.
			try {
				const recordRead = await readTaskRecord(root, inFlightChild.task_id);
				authorizedScope = recordRead.record?.intent_snapshot?.scope_hint ?? [];
			} catch {
				// fallback below
			}
			if (authorizedScope.length === 0) {
				try {
					const read = await readTaskIntent(root, inFlightChild.task_id);
					authorizedScope = read.intent.scope_hint ?? [];
				} catch {
					// fallback below
				}
			}
			if (authorizedScope.length === 0) {
				return {
					state: "rejected",
					reason: "branch preflight failed: cannot derive the in-flight child's authorized scope",
					recovery_action: "resolve the child's intent record, then retry in the current Host",
				};
			}
		}
		const dirtyBytes = statusEntries.some(({ code }) => code === "??" || code[1] !== " ");
		if (dirtyBytes) {
			return {
				state: "rejected",
				reason: "branch preflight failed: working tree has unstaged or untracked changes",
				recovery_action: "stage the in-flight changes with git add, then retry in the current Host",
			};
		}
		let outsideScope = false;
		for (const { path } of statusEntries) {
			if (path.startsWith(".imm/") || path.startsWith("docs/plans/") || path.startsWith("docs/specs/")) continue;
			// Scope entries may be exact files, directories, or globs; delegate the
			// boundary matching to the Kernel's own helper instead of exact includes.
			let matched = false;
			for (const scopePath of authorizedScope) {
				if (await pathMatchesScope(path, scopePath)) {
					matched = true;
					break;
				}
			}
			if (!matched) {
				outsideScope = true;
				break;
			}
		}
		if (outsideScope) {
			return {
				state: "rejected",
				reason: "branch preflight failed: working tree has changes outside the authorized child scope",
				recovery_action: "commit or unstage changes outside the active task scope, then retry in the current Host",
			};
		}
	}

	// 3. Project or reconstruct batch plan (pre-confirmation)
	const now = new Date().toISOString();
	let recoveryChildren: BatchPlanChild[] = [];
	let planDigest: string;
	let confirmChildrenDetails: string[] = [];
	let confirmExcludedDetails: string[] = [];
	const recoveryRiskByTask = new Map<string, string>();
	let budget = existingBatch ? existingBatch.budget : { max_children: 10, deadline_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString(), qa_failure_limit: 2 };

	if (isResuming) {
		// Reconstruct unified recovery plan from existingBatch.children
		try {
			recoveryChildren = await Promise.all(
				existingBatch.children.map(async (c: any) => {
					const intentPath = `docs/plans/${c.task_id}.intent.json`;
					let read = { intent: { revision: 1, risk: "material" }, content_hash: "" };
					try {
						const taskRecordRead = await readTaskRecord(root, c.task_id);
						if (taskRecordRead.record) {
							read = {
								intent: taskRecordRead.record.intent_snapshot,
								content_hash: taskRecordRead.record.intent_ref.content_hash,
							};
						} else {
							read = (await readTaskIntent(root, c.task_id, intentPath)) as any;
						}
					} catch {
						const archivePath = `docs/plans/archive/${c.task_id}.intent.json`;
						try {
							read = (await readTaskIntent(root, c.task_id, archivePath)) as any;
						} catch {
							read = (await readTaskIntent(root, c.task_id, intentPath)) as any;
						}
					}
					// Keep the risk captured by the authoritative read above; a stale
					// reconstructed path must never fabricate a risk later.
					recoveryRiskByTask.set(c.task_id, read.intent?.risk ?? "material");
					const isDone = c.state === "committed" || c.state === "settled";
					return {
						task_id: c.task_id,
						slice_id: c.slice_id,
						status: isDone ? ("already_settled" as const) : ("enrollable" as const),
						blocked_by: [...c.blocked_by],
						reason: c.reason ?? null,
						intent_path: intentPath,
						intent_revision: read.intent.revision,
						intent_content_hash: read.content_hash,
					};
				}),
			);
		} catch (err) {
			return {
				state: "rejected",
				reason: `failed to project batch plan: ${err instanceof Error ? err.message : String(err)}`,
				recovery_action: "review initiative issues and planning sidecars in the current Host",
			};
		}
		planDigest = await computeBatchPlanDigest(recoveryChildren);
		for (const c of recoveryChildren) {
			// Use the risk captured from the authoritative recovery read; never fall
			// back to a fabricated "material" when the reconstructed sidecar path is
			// stale (freeze_artifacts archives the active sidecar).
			const childRisk = recoveryRiskByTask.get(c.task_id) ?? "material";
			if (c.status === "already_settled") {
				confirmChildrenDetails.push(`  - ${c.task_id} (${c.slice_id}) [risk: ${childRisk}] [status: completed]`);
			} else {
				confirmChildrenDetails.push(`  - ${c.task_id} (${c.slice_id}) [risk: ${childRisk}] [status: pending execution]`);
			}
		}
	} else {
		let plan: BatchPlan;
		try {
			plan = await projectBatchPlan(
				root,
				initiativeSlug,
				{ confirmation_time: now },
				options.readInitiative,
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("has no enrollable children")) {
				return {
					state: "rejected",
					reason: "empty enrollable child set: no enrollable child tasks found in the initiative plan",
					recovery_action: "ensure the initiative has uncompleted, non-critical child tasks in the current Host",
				};
			}
			return {
				state: "rejected",
				reason: `failed to project batch plan: ${msg}`,
				recovery_action: "review initiative issues and planning sidecars in the current Host",
			};
		}

		if (!plan.enrollable.length) {
			return {
				state: "rejected",
				reason: "empty enrollable child set: no enrollable child tasks found in the initiative plan",
				recovery_action: "ensure the initiative has uncompleted, non-critical child tasks in the current Host",
			};
		}

		budget = plan.budget;
		const enrollableChildById = new Map(plan.enrollable.map((c) => [c.task_id, c]));
		recoveryChildren = plan.children
			.filter((c) => c.status === "enrollable")
			.map((c) => {
				const digestChild = enrollableChildById.get(c.task_id);
				return {
					...c,
					blocked_by: digestChild ? [...digestChild.blocked_by] : c.blocked_by,
				};
			});
		planDigest = await computeBatchPlanDigest(plan.enrollable);

		for (const c of plan.children.filter((item) => item.status === "enrollable")) {
			let childRisk = "material";
			try {
				const intentRead = await readTaskIntent(root, c.task_id, c.intent_path ?? undefined);
				childRisk = intentRead.intent.risk;
			} catch {
				// fallback
			}
			confirmChildrenDetails.push(`  - ${c.task_id} (${c.slice_id}) [risk: ${childRisk}]`);
		}
		confirmExcludedDetails = plan.children.filter((c) => c.status !== "enrollable").map((c) => `  - ${c.task_id} (${c.slice_id}): ${c.reason ?? c.status}`);
	}

	const isExistingExpired = isResuming && Date.parse(existingBatch.authorization_expires_at) <= Date.now();
	const expiresAt = isResuming && !isExistingExpired && existingBatch.batch_state === "running"
		? existingBatch.authorization_expires_at
		: new Date(Date.now() + 10 * 60 * 1000).toISOString();

	// 4. Native confirmation
	const confirmDetails = {
		title: `Authorize Unattended Batch: ${initiativeSlug}`,
		summary: `Initiative: ${initiativeSlug}\nBatch branch: ${batchBranch}\nPlan digest: ${planDigest}\nBudget: max_children=${budget.max_children}, deadline_at=${budget.deadline_at}, qa_failure_limit=${budget.qa_failure_limit}\nExpires at: ${expiresAt}`,
		details: `Ordered children (${recoveryChildren.length}):\n${confirmChildrenDetails.join("\n")}${confirmExcludedDetails.length > 0 ? `\n\nExcluded children:\n${confirmExcludedDetails.join("\n")}` : ""}`,
		planDigest,
		signal,
	};

	// review-2: fail closed with zero writes when confirmation port is missing
	if (!options.confirmBatch) {
		return {
			state: "rejected",
			reason: "native confirmation port is unavailable",
			recovery_action: "retry through a fresh native gate in the current Host",
		};
	}

	let decision: "accept" | "decline" | "cancel";
	try {
		decision = await options.confirmBatch(confirmDetails);
	} catch (err) {
		if (signal?.aborted) {
			return {
				state: "cancelled",
				reason: "native interaction cancelled",
				recovery_action: "wait for a fresh literal-user request",
			};
		}
		return {
			state: "rejected",
			reason: err instanceof Error ? err.message : String(err),
			recovery_action: "retry through a fresh native gate in the current Host",
		};
	}

	if (decision === "cancel" || signal?.aborted) {
		return {
			state: "cancelled",
			reason: "native interaction cancelled",
			recovery_action: "wait for a fresh literal-user request",
		};
	}
	if (decision === "decline") {
		return {
			state: "rejected",
			reason: "native interaction declined",
			recovery_action: "wait for a fresh literal-user request",
		};
	}
	if (decision !== "accept") {
		return {
			state: "rejected",
			reason: "native interaction returned no decision",
			recovery_action: "retry through a fresh native gate in the current Host",
		};
	}

	// 5. Post-confirmation Revalidation (Workspace claim, Plan drift, Git HEAD)
	const postWorkspace = await readWorkspaceState(root);
	const postClaim = await readBackendClaim(root);
	const postActiveTaskId = postWorkspace.state.current_working || (postClaim?.lifecycle_status === "active" ? postClaim.task_id : null);
	// Re-verify the full claim identity now, not the pre-confirmation snapshot: a
	// claim swapped for the same child during confirmation must stay blocked.
	const postIsOwnClaim =
		isResuming &&
		postActiveTaskId !== null &&
		syncIsOwnBatchClaim(root, existingBatch, postActiveTaskId, batchBranch);
	if (postActiveTaskId && !postIsOwnClaim) {
		return {
			state: "blocked",
			reason: `an active workspace claim appeared during confirmation for task: ${postActiveTaskId}`,
			recovery_action: "resolve or stop the active task before starting a batch in the current Host",
		};
	}

	if (isResuming) {
		let recheckedDigest: string;
		try {
			const recheckedChildren = await Promise.all(
				existingBatch.children.map(async (c: any) => {
					const intentPath = `docs/plans/${c.task_id}.intent.json`;
					let read = { intent: { revision: 1, risk: "material" }, content_hash: "" };
					try {
						const taskRecordRead = await readTaskRecord(root, c.task_id);
						if (taskRecordRead.record) {
							read = {
								intent: taskRecordRead.record.intent_snapshot,
								content_hash: taskRecordRead.record.intent_ref.content_hash,
							};
						} else {
							read = (await readTaskIntent(root, c.task_id, intentPath)) as any;
						}
					} catch {
						const archivePath = `docs/plans/archive/${c.task_id}.intent.json`;
						try {
							read = (await readTaskIntent(root, c.task_id, archivePath)) as any;
						} catch {
							read = (await readTaskIntent(root, c.task_id, intentPath)) as any;
						}
					}
					const isDone = c.state === "committed" || c.state === "settled";
					return {
						task_id: c.task_id,
						slice_id: c.slice_id,
						status: isDone ? ("already_settled" as const) : ("enrollable" as const),
						blocked_by: [...c.blocked_by],
						reason: c.reason ?? null,
						intent_path: intentPath,
						intent_revision: read.intent.revision,
						intent_content_hash: read.content_hash,
					};
				}),
			);
			recheckedDigest = await computeBatchPlanDigest(recheckedChildren);
		} catch (err) {
			return {
				state: "rejected",
				reason: "batch plan became unreadable after native confirmation",
				recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
			};
		}
		if (recheckedDigest !== planDigest) {
			return {
				state: "rejected",
				reason: "batch plan changed after native confirmation",
				recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
			};
		}
	} else {
		let revalidatedPlan: BatchPlan;
		try {
			revalidatedPlan = await projectBatchPlan(
				root,
				initiativeSlug,
				{ confirmation_time: now },
				options.readInitiative,
			);
		} catch (err) {
			return {
				state: "rejected",
				reason: "batch plan became unreadable after native confirmation",
				recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
			};
		}

		const revalidatedDigest = await computeBatchPlanDigest(revalidatedPlan.enrollable);
		if (revalidatedDigest !== planDigest) {
			return {
				state: "rejected",
				reason: "batch plan changed after native confirmation",
				recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
			};
		}
	}

	let postHead: string;
	try {
		postHead = await readGitHead(root);
	} catch (err) {
		return {
			state: "rejected",
			reason: "Git repository became unreadable after native confirmation",
			recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
		};
	}
	if (postHead !== baseHead) {
		return {
			state: "rejected",
			reason: "Git HEAD moved after native confirmation",
			recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
		};
	}

	// review-f72ae870f4f0-1: re-check the workspace claim AFTER the async plan
	// revalidation finishes. The earlier check ran before that await, so a foreign
	// enrollment completing during the Initiative read would otherwise reach
	// authority issuance and let startBatch create the branch and batch state,
	// while Claude returns blocked. Same check, same order, same reason as Claude.
	const finalWorkspace = await readWorkspaceState(root);
	const finalClaim = await readBackendClaim(root);
	const finalActiveTaskId = finalWorkspace.state.current_working || (finalClaim?.lifecycle_status === "active" ? finalClaim.task_id : null);
	const finalIsOwnClaim =
		isResuming &&
		finalActiveTaskId !== null &&
		syncIsOwnBatchClaim(root, existingBatch, finalActiveTaskId, batchBranch);
	if (finalActiveTaskId && !finalIsOwnClaim) {
		return {
			state: "blocked",
			reason: `an active workspace claim appeared during confirmation for task: ${finalActiveTaskId}`,
			recovery_action: "resolve or stop the active task before starting a batch in the current Host",
		};
	}

	// 6. Issue Batch Authorization through Kernel registry and startBatch
	const batchRegistry: BatchAuthorityRegistry = await createBatchAuthorityRegistry();
	const enrollmentRegistry = await createEnrollmentAuthorityRegistry();

	// review-2: verify cancellation signal right before authority issuance and startBatch
	if (signal?.aborted) {
		return {
			state: "cancelled",
			reason: "user cancelled before batch execution",
			recovery_action: "wait for a fresh literal-user request",
		};
	}

	const batchId = existingBatch ? existingBatch.batch_id : `batch-${initiativeSlug}-${Date.now()}`;
	const confirmation = piConfirmationRef({
		toolCallId: `call-${batchId}`,
		requestId: randomUUID(),
		operation: "start_unattended_batch",
		initiativeSlug,
		planDigest,
	});

	const binding: BatchAuthorizationBinding = {
		batch_id: batchId,
		initiative_slug: initiativeSlug,
		plan_digest: planDigest,
		branch: batchBranch,
		base_head: isResuming ? existingBatch.base_head : baseHead,
		budget,
		actor_id: "user",
		confirmation_ref: confirmation,
		expires_at: expiresAt,
		nonce: randomUUID(),
	};

	const capability = batchRegistry.issue(binding, recoveryChildren as any, now);

	let activeReviewDispatch: { operation_id: string; agent_params: Record<string, unknown> } | null = null;

	const realPort: BatchRunnerKernelPort = {
		enrollTask: async ({ root: taskRoot, task_id, batch: b }) => {
			const derived = await deriveChildEnrollment(taskRoot, b.registry, {
				capability: b.capability,
				binding,
				task_id,
				expected_head: b.binding.expected_head,
				now,
			});
			const enrollmentCapability = enrollmentRegistry.issue(derived.binding);
			const input = {
				task_id,
				intent_path: derived.binding.intent_path,
				intent_revision: derived.binding.intent_revision,
				preparation_digest: derived.binding.preparation_digest,
				capability: enrollmentCapability,
				capability_binding: derived.binding,
				batch: {
					registry: b.registry,
					capability: b.capability,
					binding,
					expected_head: b.binding.expected_head,
				},
				now,
			};
			const rehearsal = await runEnrollmentRehearsal(taskRoot, input, enrollmentCapability, enrollmentRegistry);
			if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready") {
				throw new Error(`Kernel enrollment rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`);
			}
			await enrollCanaryTask(taskRoot, input, enrollmentRegistry);
			const recordRaw = await readTaskRecord(taskRoot, task_id);
			return { record_revision: recordRaw.revision };
		},
		advanceTask: async (taskRoot, taskId) => {
			const res = await advancePiTask(taskRoot, taskId);
			if (res.state === "review_ready" && res.agent_params) {
				activeReviewDispatch = {
					operation_id: res.operation_id,
					agent_params: res.agent_params,
				};
			}
			return res;
		},
		projectTask: async (taskRoot, taskId) => {
			return projectAssuranceForTask(taskRoot, taskId);
		},
		ownsTaskClaim: (taskId) => {
			if (isResuming && taskId === activeTaskId) {
				// Re-verify the CURRENT claim identity synchronously: a claim swapped
				// during confirmation is never adopted.
				return syncIsOwnBatchClaim(root, existingBatch, taskId, batchBranch);
			}
			return batchRegistry.isChildConsumed(capability, taskId);
		},
		validateBatchAuthorization: (input) => input.registry.inspect(input.capability, input.binding as never),
	};

	const rawAdvance = options.batchKernel?.advanceTask ?? realPort.advanceTask;
	const wrappedAdvance: typeof realPort.advanceTask = async (taskRoot, taskId) => {
		const res = (await rawAdvance(taskRoot, taskId)) as any;
		if (res.state === "review_ready" && res.agent_params) {
			activeReviewDispatch = {
				operation_id: res.operation_id,
				agent_params: res.agent_params,
			};
		}
		return res;
	};

	const kernelPort: BatchRunnerKernelPort = {
		...realPort,
		...(options.batchKernel ?? {}),
		advanceTask: wrappedAdvance,
	};

	const report = await startBatch({
		root,
		batch_id: batchId,
		initiative_slug: initiativeSlug,
		registry: batchRegistry,
		capability,
		children: recoveryChildren,
		plan_digest: planDigest,
		base_head: isResuming ? existingBatch.base_head : baseHead,
		confirmation_time: now,
		authorization_expires_at: expiresAt,
		budget,
		now,
		kernel: kernelPort,
		git: options.batchGit,
	});

	if (report.batch_state === "rejected") {
		return {
			state: "rejected",
			reason: report.reason ?? "batch run rejected",
			recovery_action: "delete or rename the conflicting branch, or commit working changes and retry in the current Host",
		};
	}

	return {
		state: "started",
		batch_id: batchId,
		report,
		...(activeReviewDispatch ? { review_dispatch: activeReviewDispatch } : {}),
	};
}

/**
 * Injectable seams for the batch Tool. Production passes nothing and gets the
 * real Initiative reader, Kernel port and Git port; tests drive the registered
 * Tool `execute` end to end without live GitHub or Kernel access, which is how
 * the model-visible content contract is verified.
 */
export interface PiBatchExtensionDependencies {
	readInitiative?: InitiativeObservationReader;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
}

export default function (
	pi: ExtensionAPI,
	dependencies: PiBatchExtensionDependencies = {},
) {
	pi.registerTool({
		name: "start_unattended_batch",
		label: "Start unattended batch",
		description: "Start an unattended serial batch run for an Initiative after native confirmation.",
		promptSnippet: "Start unattended batch run: invoke once in foreground after plan confirmation.",
		promptGuidelines: [
			"Call only after plan confirmation; execute once in the foreground and consume the direct terminal result.",
			"Do not run this Tool in background, poll for completion, or issue a cancel subcommand.",
		],
		parameters: Type.Object({
			initiative_slug: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
		}, { additionalProperties: false }),
		execute: async (
			_toolCallId: string,
			params: { initiative_slug: string },
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) => {
			const { initiative_slug: initiativeSlug } = params;
			if (ctx.mode !== "tui") {
				throwToolFailure({
					tool: "imm_canary_enrollment",
					task_id: initiativeSlug,
					operation: "start_unattended_batch",
					state: "blocked",
					code: "unsupported_host",
					message: "interactive TUI elicitation is unavailable in non-interactive mode",
					next_action: "invoke through an interactive Pi TUI session in the current Host",
				});
			}

			const result = await executePiUnattendedBatch({
				root: ctx.cwd,
				initiativeSlug,
				interactive: ctx.mode === "tui",
				signal,
				readInitiative: dependencies.readInitiative,
				batchKernel: dependencies.batchKernel,
				batchGit: dependencies.batchGit,
				confirmBatch: async (details) => {
					presentTaskRail(ctx, {
						task_id: initiativeSlug,
						state: "Approval required",
						result: details.title,
						next: "Review batch plan evidence",
					});
					const selected = await requestAuthorityDialog(
						pi,
						ctx,
						{
							attention_id: randomUUID(),
							task_id: initiativeSlug,
							reason: "enrollment",
							label: details.title,
						},
						{
							title: details.title,
							summary: details.summary,
							details: details.details,
							signal: details.signal,
							actions: [
								{ value: "confirm", label: "Authorize batch run", description: "Start the unattended serial batch run" },
								{ value: "decline", label: "Decline batch", description: "Reject this batch authorization; repository and authority stay unchanged" },
								{ value: "cancel", label: "Cancel", description: "Leave repository and authority unchanged" },
							],
						},
					);
					return mapDialogSelection(selected);
				},
			});

			if (result.state !== "started") {
				const failureState = result.state === "blocked" ? "blocked" : "failed";
				throwToolFailure({
					tool: "imm_canary_enrollment",
					task_id: initiativeSlug,
					operation: "start_unattended_batch",
					state: failureState,
					code: `batch_${result.state}`,
					message: result.reason,
					next_action: result.recovery_action,
				});
			}

			// review-f72ae870f4f0-2: the Parent consumes the model-visible content, not
			// Tool details, so the full structured result must be serialized there
			// (the same shape imm-canary-work.ts returns). A batch that pauses for
			// Review exposes report.next_action plus review_dispatch, and a
			// needs_human/failed run exposes the parked child reason; without them the
			// Parent cannot launch the reserved foreground Review or recover.
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
		renderCall(args, theme) {
			const params = args as { initiative_slug?: string };
			return renderStructuredCall("start_unattended_batch", "start", params.initiative_slug, theme);
		},
		renderResult(result, _options, theme) {
			return renderStructuredResult(
				result as Parameters<typeof renderStructuredResult>[0],
				theme,
			);
		},
	});
}
