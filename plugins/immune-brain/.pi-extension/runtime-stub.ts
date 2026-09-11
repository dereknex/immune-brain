// Extension-local runtime adapter: type-isolated, executable stub.
// Extensions import this file directly (relative path, resolvable by the Pi
// extension loader); it forwards to the real Kernel modules via dynamic
// import. Shared contracts are re-exported as types from the real Kernel
// modules: `export type` is erased at compile time, so the extension still
// carries no static runtime import, but a Kernel contract change now breaks
// the extension's build instead of silently drifting from it.

// --- Types (structural contracts, no runtime import) ---
export interface EnrollmentCapabilityBinding {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	preparation_digest: string;
	actor_id: string;
	confirmation_ref: string;
	expires_at: string;
	nonce: string;
}
export interface EnrollmentAuthorityRegistry {
	issue(binding: EnrollmentCapabilityBinding, issuedAt?: string): object;
	inspect(capability: object, expected: EnrollmentCapabilityBinding, now?: number): unknown;
	consume(capability: object, expected: EnrollmentCapabilityBinding, now?: number): unknown;
	isConsumed(capability: object): boolean;
}
export interface CanaryWaiver {
	gate: "observation_window_days";
	task_id: string;
	reason: string;
	actor: string;
	confirmation_ref: string;
	expires_at: string;
	nonce: string;
}
export interface PiCanaryPrepareInput {
	task_id: string;
	now: string;
}
export interface PiCanaryPreparation {
	contract: "assurance_kernel/pi_canary_preparation/v1";
	task_id: string;
	generated_at: string;
	root_state_path: string;
	intent: { path: string; revision: number; content_hash: string } | null;
	backend_claim: { present: boolean; task_id: string | null; lifecycle_status: string | null };
	task_tombstone: { present: boolean; terminal_lifecycle: string | null };
	task_record_v3: { present: boolean; lifecycle: string | null; artifact_state: string | null } | null;
	workspace: { current_working: string | null };
	digest: string;
}
export interface EnrollCanaryInput {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	preparation_digest: string;
	capability: object;
	capability_binding: Record<string, unknown>;
	now: string;
}

// --- P2B2 mutation authority / canary application types (structural) ---
export interface CapabilityBindingV2 {
	authority_kind: "review" | "qa" | "user";
	task_id: string;
	action_digest: string;
	expected_record_hash: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	actor_id: string;
	confirmation_ref: string;
	expires_at: string;
	findings_digest: string | null;
}
export interface MutationAuthorityRegistry {
	readonly brand: symbol;
	issue(binding: CapabilityBindingV2, issuedAt?: string): object;
	inspect(capability: object | undefined, expected: unknown, now?: number): unknown;
	consume(capability: object, expected: unknown, now?: number): unknown;
	isConsumed(capability: object): boolean;
}
export interface CanaryApplication {
	readonly registry: MutationAuthorityRegistry;
	execute(input: unknown): unknown;
	beginDrain(input: {
		root: string;
		task_id: string;
		capability: object;
		now?: string;
	}): unknown;
}
export interface StoredTaskMutation {
	revision: string;
	record: {
		contract: "assurance_kernel/task_record/v3" | "assurance_kernel/task_record/v4";
		task_id: string;
		/** Present only on TaskRecord v4: the immutable Enrollment commit. */
		git_base_head?: string;
		intent_snapshot: { revision: number; [key: string]: unknown };
		intent_ref: { path: string; content_hash: string };
		lifecycle: "active" | "done" | "stopped";
		artifact_state: "active" | "frozen";
		attestations: unknown[];
		findings: unknown[];
		history: unknown[];
	};
	workspace: { revision: string; state: { contract: string; current_working: string | null } };
}
export interface BackendClaim {
	contract: string;
	backend: "kernel";
	task_id: string;
	intent_revision: number;
	intent_content_hash: string;
	enrollment_event_id: string;
	lifecycle_status: "active" | "draining";
	created_at: string;
	updated_at: string;
}
export interface KernelAuthorityProjection {
	contract: "assurance_kernel/authority_projection/v1";
	requested_task_id: string;
	state: "unowned" | "active_owner" | "terminal_owner" | "repairable_stale_claim" | "authority_conflict";
	owner_task_id: string | null;
	owner_lifecycle: string | null;
	claim_lifecycle_status: "active" | "draining" | null;
	diagnostic: string | null;
	revision: string;
}
export interface TaskTombstone {
	contract: string;
	task_id: string;
	lifecycle_status: "terminal";
	terminal_lifecycle: string;
	terminal_event_id: string;
	final_record_hash: string;
	terminalized_at: string;
}
export type TaskRecordContract =
	| "assurance_kernel/task_record/v3"
	| "assurance_kernel/task_record/v4";

export interface TaskRecordRead {
	revision: string;
	record: {
		contract: TaskRecordContract;
		task_id: string;
		/** Present only on TaskRecord v4: the immutable Enrollment commit. */
		git_base_head?: string;
		intent_snapshot: {
			task_id: string;
			revision: number;
			risk: "routine" | "material" | "critical";
			acceptance: Array<{ id: string; assertion: string; verification: string }>;
			scope_hint: string[];
		};
		intent_ref: { path: string; content_hash: string };
		lifecycle: "active" | "done" | "stopped";
		artifact_state: "active" | "frozen";
		attestations: Array<{
			id: string;
			kind: "qa" | "review" | "user";
			task_revision: number;
			intent_content_hash: string;
			diff_hash: string;
			actor_id: string;
			acceptance_results: Array<{ acceptance_id: string; status: "passed" | "failed" | "blocked"; summary: string }>;
			review_revision?: {
				contract: "assurance_kernel/review_revision_identity/v1";
				base_head: string;
				review_commit: string;
				review_tree: string;
				manifest_digest: string;
			};
		}>;
		findings: Array<{
			id: string;
			kind: string;
			status: string;
			summary?: string;
			anchor?: string | null;
			evidence?: unknown;
			counterevidence?: { attestation_id: string; acceptance_id: string } | null;
		}>;
	} | null;
}

// --- Assurance projection (host-neutral Kernel facts, not exported from the
// public Kernel index) ---
export type {
	AssuranceAuthorizationReadiness,
	AssuranceProjection,
	AssuranceProjectionResult,
} from "../runtime/kernel/assurance_projection";
import type {
	AssuranceAuthorizationReadiness,
	AssuranceProjectionResult,
} from "../runtime/kernel/assurance_projection";

// --- Runtime forwarding (dynamic import keeps the graph out of tsc) ---
function kernelPath(module: string): string {
	return `../runtime/kernel/${module}.ts`;
}
function runtimePath(module: string): string {
	return `../runtime/${module}.ts`;
}

export interface GithubTrackerResult {
	contract: "immune_brain/github_issue_tracker_result/v1";
	operation: "create-initiative" | "upsert-task" | "mark-terminal";
	status: "created" | "updated" | "already_current" | "retryable_failure" | "permanent_failure" | "ambiguous_remote_state";
	association_found: boolean;
	issue_number?: number;
	issue_url?: string;
	message: string;
}

export async function buildLoopAction(input: unknown): Promise<unknown> {
	const mod = await import(/* @vite-ignore */ runtimePath("loop_contract"));
	return mod.buildLoopAction(input);
}
export async function buildLoopRoleDispatch(input: unknown): Promise<unknown> {
	const mod = await import(/* @vite-ignore */ runtimePath("loop_contract"));
	return mod.buildLoopRoleDispatch(input);
}
export async function markGithubTaskTerminal(
	root: string,
	input: { task_id: string; phase: "done" | "stopped"; terminal_event_id: string },
): Promise<GithubTrackerResult> {
	const mod = await import(/* @vite-ignore */ runtimePath("github_issue_tracker"));
	return mod.runGithubTrackerOperation(root, { op: "mark-terminal", ...input }) as Promise<GithubTrackerResult>;
}
export async function createEnrollmentAuthorityRegistry(): Promise<EnrollmentAuthorityRegistry> {
	const mod = await import(/* @vite-ignore */ kernelPath("enrollment_authority"));
	return mod.createEnrollmentAuthorityRegistry();
}
export async function preparePiCanary(
	root: string,
	input: PiCanaryPrepareInput,
): Promise<PiCanaryPreparation> {
	const mod = await import(/* @vite-ignore */ runtimePath("assurance/enrollment"));
	return mod.preparePiCanary(root, input) as unknown as PiCanaryPreparation;
}
export async function revalidatePiCanary(
	root: string,
	input: PiCanaryPrepareInput,
	previous: PiCanaryPreparation,
): Promise<{ unchanged: boolean; current: PiCanaryPreparation }> {
	const mod = await import(/* @vite-ignore */ runtimePath("assurance/enrollment"));
	return mod.revalidatePiCanary(root, input, previous as never) as unknown as { unchanged: boolean; current: PiCanaryPreparation };
}
export async function evaluateCanaryEligibility(input: {
	task: { id: string; intent_path: string; intent_revision: number; intent_content_hash: string };
	waiver?: CanaryWaiver;
	now: string;
}): Promise<{ eligible: boolean; waived_gates: string[]; unmet_non_waivable: string[]; rejections: string[] }> {
	const mod = await import(/* @vite-ignore */ kernelPath("canary_eligibility"));
	return mod.evaluateCanaryEligibility(input as never);
}
export async function runEnrollmentRehearsal(
	root: string,
	input: EnrollCanaryInput,
	capability: object,
	registry: EnrollmentAuthorityRegistry,
): Promise<{ rehearsed: boolean; writes_performed: boolean; evidence: { outcome: "ready" | "not_ready"; blockers: string[] } }> {
	const mod = await import(/* @vite-ignore */ kernelPath("enrollment"));
	return mod.runEnrollmentRehearsal(root, input as never, capability, registry as never);
}
export async function enrollCanaryTask(
	root: string,
	input: EnrollCanaryInput,
	registry: EnrollmentAuthorityRegistry,
): Promise<{ record: { task_id: string; lifecycle: string; artifact_state: string }; backend_claim: { backend: string } }> {
	const mod = await import(/* @vite-ignore */ kernelPath("enrollment"));
	return mod.enrollCanaryTask(root, input as never, registry as never);
}

export async function createMutationAuthorityRegistry(): Promise<MutationAuthorityRegistry> {
	const mod = await import(/* @vite-ignore */ kernelPath("authority_port"));
	return mod.createMutationAuthorityRegistry();
}
export async function createCanaryApplication(
	registry: MutationAuthorityRegistry,
): Promise<CanaryApplication> {
	const mod = await import(/* @vite-ignore */ kernelPath("canary_application"));
	return mod.createCanaryApplication(registry as never);
}
export async function readTaskRecord(
	root: string,
	taskId: string,
): Promise<TaskRecordRead> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage"));
	// Lock-free read only. `storage.readTaskRecord` wraps this in
	// withKernelStoreLock, which first runs pending-transaction recovery, so a
	// decline, a cancel, or a rejected preflight would otherwise mutate Kernel
	// state before the literal user ever approved anything. Mutating Kernel
	// entrypoints still take their own lock when the batch actually starts.
	return mod.readTaskRecordRaw(root, taskId);
}
export async function withKernelStoreLock<T>(root: string, operation: () => T): Promise<T> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage"));
	return mod.withKernelStoreLock(root, operation);
}
export async function readBackendClaim(root: string): Promise<BackendClaim | null> {
	const mod = await import(/* @vite-ignore */ kernelPath("backend_claim"));
	return mod.readBackendClaim(root);
}
export async function reconcileKernelAuthority(
	root: string,
	taskId: string,
): Promise<KernelAuthorityProjection> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage"));
	return mod.reconcileKernelAuthority(root, taskId);
}
export async function repairKernelAuthority(
	root: string,
	taskId: string,
	expectedProjectionRevision: string,
): Promise<KernelAuthorityProjection> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage"));
	return mod.repairKernelAuthority(root, taskId, expectedProjectionRevision);
}
export async function readTaskTombstone(
	root: string,
	taskId: string,
): Promise<TaskTombstone | null> {
	const mod = await import(/* @vite-ignore */ kernelPath("backend_claim"));
	return mod.readTaskTombstone(root, taskId);
}

export interface TaskIntentV1 {
	contract: "assurance_kernel/task_intent/v1";
	goal: string;
	task_id: string;
	revision: number;
	risk: "routine" | "material" | "critical";
	owner: "user";
	acceptance: Array<{ id: string; assertion: string; verification: string }>;
	scope_hint: string[];
}
export type { ReadTaskIntentResult as TaskIntentRead } from "../runtime/kernel/intent";
import type { ReadTaskIntentResult as TaskIntentRead } from "../runtime/kernel/intent";
export interface WorkspaceRead {
	revision: string;
	state: { contract: string; current_working: string | null };
}
export async function readTaskIntent(root: string, taskId: string, path?: string): Promise<TaskIntentRead> {
	const [intent, storage] = await Promise.all([
		import(/* @vite-ignore */ kernelPath("intent")),
		import(/* @vite-ignore */ kernelPath("storage")),
	]);
	const currentPath = path ?? storage.readTaskRecordRaw(root, taskId).record?.intent_ref.path;
	return intent.readTaskIntent(root, taskId, currentPath);
}
export async function parseTaskIntentV1(raw: unknown): Promise<TaskIntentV1> {
	const mod = await import(/* @vite-ignore */ kernelPath("intent"));
	return mod.parseTaskIntentV1(raw);
}
export async function canonicalIntentHash(intent: unknown): Promise<string> {
	const mod = await import(/* @vite-ignore */ kernelPath("intent"));
	return mod.canonicalIntentHash(intent);
}

export async function readWorkspaceState(root: string): Promise<WorkspaceRead> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage"));
	return mod.readWorkspaceStateRaw(root);
}
export async function inspectStorageLayout(root: string): Promise<import("../runtime/kernel/storage_paths").StorageLayoutInspection> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage_paths"));
	return mod.inspectStorageLayout(root);
}
export async function migrateLegacyLayout(root: string): Promise<import("../runtime/kernel/storage_layout_migration").MigrationOutcome> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage_layout_migration"));
	return mod.migrateLegacyLayout(root);
}
export async function beginDrainCapabilityAction(
	taskId: string,
	at: string,
): Promise<{ type: string; event_id: string; at: string; actor_id: string; reason: string }> {
	const mod = await import(/* @vite-ignore */ kernelPath("canary_application"));
	return mod.beginDrainCapabilityAction(taskId, at);
}

export async function capabilityActionFor(input: unknown): Promise<unknown> {
	const mod = await import(/* @vite-ignore */ kernelPath("canary_application"));
	return mod.capabilityActionFor(input);
}

export async function digestOfAction(action: unknown): Promise<string> {
	const mod = await import(/* @vite-ignore */ kernelPath("authority_port"));
	return mod.digestOfAction(action);
}

export async function findingsDigestV2(findings: unknown[]): Promise<string> {
	const mod = await import(/* @vite-ignore */ kernelPath("reducer"));
	return mod.findingsDigestV2(findings);
}

export async function projectAssurance(
	root: string,
	taskId: string,
	diffProvider: (root: string, record: NonNullable<TaskRecordRead["record"]>) => {
		diff_hash: string;
		changed_paths: readonly string[];
	},
): Promise<AssuranceProjectionResult> {
	const mod = await import(/* @vite-ignore */ kernelPath("assurance_projection"));
	return mod.projectAssurance(root, taskId, diffProvider) as AssuranceProjectionResult;
}

export async function deriveAssuranceAuthorization(input: {
	next_obligation: AssuranceProjectionResult["projection"]["next_obligation"];
	open_user_decision_count: number;
}): Promise<AssuranceAuthorizationReadiness> {
	const mod = await import(/* @vite-ignore */ kernelPath("assurance_projection"));
	return mod.deriveAssuranceAuthorization(input) as AssuranceAuthorizationReadiness;
}

// --- Batch Authority & Unattended Runner Forwarding ---
function unattendedPath(module: string): string {
	return `../runtime/unattended/${module}.ts`;
}

export type {
	BatchPlan,
	BatchPlanChild,
	BatchPlanBudget,
	BatchPlanDigestChild,
	InitiativeObservationReader,
} from "../runtime/unattended/types";
export type {
	BatchAuthorityRegistry,
	BatchAuthorizationBinding,
	ValidatedBatchAuthorization,
} from "../runtime/kernel/batch_authority";
export type {
	BatchRunnerKernelPort,
	StartBatchInput,
	BatchRunReport,
} from "../runtime/unattended/batch_runner";
export type {
	BatchRunnerGitPort,
	BatchGitPreflightResult,
} from "../runtime/unattended/batch_git";

export async function projectBatchPlan(
	root: string,
	initiativeSlug: string,
	input: any,
	readInitiative?: any,
): Promise<any> {
	const mod = await import(/* @vite-ignore */ unattendedPath("batch_plan"));
	return mod.projectBatchPlan(root, initiativeSlug, input, readInitiative);
}

export async function computeBatchPlanDigest(children: any): Promise<string> {
	const mod = await import(/* @vite-ignore */ kernelPath("batch_authority"));
	return mod.computeBatchPlanDigest(children);
}

export async function createBatchAuthorityRegistry(): Promise<any> {
	const mod = await import(/* @vite-ignore */ kernelPath("batch_authority"));
	return mod.createBatchAuthorityRegistry();
}

export async function deriveChildEnrollment(root: string, registry: any, input: any): Promise<any> {
	const mod = await import(/* @vite-ignore */ kernelPath("batch_authority"));
	return mod.deriveChildEnrollment(root, registry, input);
}

export async function startBatch(input: any): Promise<any> {
	const mod = await import(/* @vite-ignore */ unattendedPath("batch_runner"));
	return mod.startBatch(input);
}

export async function runBatchGitPreflight(input: any): Promise<any> {
	const mod = await import(/* @vite-ignore */ unattendedPath("batch_git"));
	return mod.runBatchGitPreflight(input);
}

export async function readGitHead(root: string): Promise<string> {
	// The Pi extension must reach Kernel prepare only through the shared Enrollment
	// boundary, so this reads HEAD itself rather than importing the Kernel prepare
	// module. The unattended Git module reads HEAD the same way.
	const { spawnSync } = await import("node:child_process");
	const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`git rev-parse HEAD is unavailable for ${root}`);
	return result.stdout.trim();
}

/**
 * Read the immutable terminal audit record for a settled child.
 *
 * A child reaches Kernel settlement before the batch commits it, and settlement
 * clears the live state record, so the batch resume preflight must resolve the
 * child's authorized scope from the audit pair instead. Read-only: neither the
 * audit pair nor this reader mutates Kernel state.
 */
export async function readSettledTaskRecord(
	root: string,
	taskId: string,
): Promise<{ scope_hint: string[]; intent_path: string | undefined } | null> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage"));
	const pair = mod.readAuditTaskPair(root, taskId);
	if (!pair?.record) return null;
	const record = pair.record as {
		intent_snapshot?: { scope_hint?: string[] };
		intent_ref?: { path?: string };
	};
	return {
		scope_hint: record.intent_snapshot?.scope_hint ?? [],
		intent_path: record.intent_ref?.path,
	};
}

export async function pathMatchesScope(path: string, scopePath: string): Promise<boolean> {
	const mod = await import(/* @vite-ignore */ runtimePath("workspace_scope"));
	return mod.pathMatchesScope(path, scopePath);
}

const GLOBAL_PI_PROGRESSION_KEY = Symbol.for("immune_brain.pi_assurance_progression");

export async function getSharedPiProgression(): Promise<any> {
	let progression = (globalThis as any)[GLOBAL_PI_PROGRESSION_KEY];
	if (!progression) {
		const workMod = await import(/* @vite-ignore */ "./imm-canary-work");
		const ports = workMod.createPiAssuranceProgressionPorts();
		const progMod = await import(/* @vite-ignore */ "./pi-canary-assurance-progression");
		progression = new progMod.AssuranceProgression(ports);
		(globalThis as any)[GLOBAL_PI_PROGRESSION_KEY] = progression;
	}
	return progression;
}

export async function advancePiTask(root: string, taskId: string): Promise<any> {
	const progression = await getSharedPiProgression();
	const result = await progression.advance(taskId, { cwd: root });
	if (result.state === "completed") return { state: "completed" };
	if (result.state === "stopped") return { state: "stopped" };
	if (result.state === "rework") return { state: "rework", operation: result.operation, summary: result.summary };
	if (result.state === "review_ready") return { state: "review_ready", operation_id: result.operation_id, agent_params: result.agent_params };
	if (result.state === "blocked") return { state: "blocked", reason: result.reason };
	return { state: "failed", reason: (result as { reason?: string }).reason ?? "advance failed" };
}

export async function projectAssuranceForTask(root: string, taskId: string): Promise<any> {
	const [assuranceMod, scopeMod] = await Promise.all([
		import(/* @vite-ignore */ kernelPath("assurance_projection")),
		import(/* @vite-ignore */ runtimePath("workspace_scope")),
	]);
	const diffSnapshotOf = (r: string, record: any) => {
		if (record.contract === "assurance_kernel/task_record/v4") {
			if (!record.git_base_head)
				throw new Error("TaskRecord v4 is missing git_base_head");
			return scopeMod.taskRevisionIdentity(r, record.intent_snapshot.scope_hint, record.git_base_head);
		}
		return scopeMod.taskDiffIdentity(r, record.intent_snapshot.scope_hint);
	};
	return assuranceMod.projectAssurance(root, taskId, diffSnapshotOf);
}

export async function findExistingActiveBatch(root: string, initiativeSlug: string): Promise<any> {
	const { join } = await import("node:path");
	const { existsSync, readdirSync, readFileSync } = await import("node:fs");
	const batchesDir = join(root, ".imm", "state", "batches");
	if (!existsSync(batchesDir)) return null;
	const files = readdirSync(batchesDir);
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		let record: any;
		try {
			record = JSON.parse(readFileSync(join(batchesDir, file), "utf8"));
		} catch {
			// Unreadable Kernel batch state must fail closed: silently treating the
			// initiative as batchless could authorize a parallel run.
			return { corrupt: true, path: file };
		}
		if (record.contract === "assurance_kernel/batch_run_state/v1" && record.initiative_slug === initiativeSlug) {
			const validStates = new Set([
				"prepared",
				"running",
				"needs_human",
				"completed",
				"budget_stopped",
				"failed",
				"rejected",
			]);
			if (
				typeof record.batch_id !== "string" ||
				typeof record.base_head !== "string" ||
				!Array.isArray(record.children) ||
				!validStates.has(record.batch_state)
			) {
				return { corrupt: true, path: file };
			}
			return record;
		}
	}
	return null;
}


