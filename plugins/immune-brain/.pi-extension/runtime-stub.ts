// Extension-local runtime adapter: type-isolated, executable stub.
// Extensions import this file directly (relative path, resolvable by the Pi
// extension loader); it forwards to the real Kernel modules via dynamic
// import. The runtime source graph (with its pre-existing type debt) is never
// type-checked from the extension.

// --- Types (structural contracts, no runtime import) ---
export interface EnrollmentCapabilityBinding {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	preparation_digest: string;
	// Compatibility mirror fields: retained for claim schema continuity but
	// never read as authority after v4 storage retirement.
	readiness_digest: string;
	evidence_digest: string;
	waiver_gate: string;
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
	task_tombstone: { present: boolean; terminal_phase: string | null };
	task_record_v2: { present: boolean; phase: string | null } | null;
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
		contract: string;
		task_id: string;
		intent_revision: number;
		intent_ref: { path: string; revision: number; content_hash: string };
		phase: string;
		evidence: unknown[];
		findings: unknown[];
		approvals: unknown[];
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
	readiness_digest: string;
	evidence_digest: string;
	lifecycle_status: "active" | "draining";
	created_at: string;
	updated_at: string;
}
export interface KernelAuthorityProjection {
	contract: "assurance_kernel/authority_projection/v1";
	requested_task_id: string;
	state: "unowned" | "active_owner" | "terminal_owner" | "repairable_stale_claim" | "authority_conflict";
	owner_task_id: string | null;
	owner_phase: string | null;
	claim_lifecycle_status: "active" | "draining" | null;
	diagnostic: string | null;
	revision: string;
}
export interface TaskTombstone {
	contract: string;
	task_id: string;
	lifecycle_status: "terminal";
	terminal_phase: string;
	terminal_event_id: string;
	final_record_hash: string;
	terminalized_at: string;
}
export interface TaskRecordV2Read {
	revision: string;
	record: {
		contract: string;
		task_id: string;
		intent_revision: number;
		intent_snapshot: {
			task_id: string;
			revision: number;
			risk: "routine" | "material" | "critical";
			acceptance: Array<{ id: string; assertion: string; verification: string }>;
			scope_hint: string[];
		};
		intent_ref: { path: string; revision: number; content_hash: string };
		phase: string;
		evidence: Array<{
			id: string;
			acceptance_id: string;
			task_revision: number;
			intent_content_hash: string;
			diff_hash: string;
			status: "passed" | "failed" | "blocked";
			summary: string;
		}>;
		findings: Array<{ id: string; kind: string; status: string; summary?: string }>;
		approvals: Array<{
			kind: string;
			task_revision: number;
			intent_content_hash: string;
			diff_hash: string;
		}>;
	} | null;
}

// --- Assurance projection (host-neutral Kernel facts, not exported from the
// public Kernel index) ---
export interface AssuranceAuthorizationReadiness {
	state: "resolve_user_decision" | "record_user_approval" | "none";
	blocked: string | null;
}
export interface AssuranceProjection {
	record_revision: string;
	workspace_revision: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	phase: string;
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_evidence_ids: string[];
	fresh_approval_kinds: string[];
	missing_approval_kinds: string[];
	blocking_finding_ids: string[];
	unresolved_user_decision_ids: string[];
	replan_required_ids: string[];
	independence_violations: string[];
	open_user_decision_count: number;
	completion_ready: boolean;
	authorization: AssuranceAuthorizationReadiness;
}
export interface AssuranceProjectionResult {
	contract: "assurance_kernel/assurance_projection/v1";
	task_id: string;
	error: string | null;
	claim: { task_id: string; lifecycle_status: string } | null;
	projection: AssuranceProjection;
}

// --- Runtime forwarding (dynamic import keeps the graph out of tsc) ---
function kernelPath(module: string): string {
	return `../runtime/kernel/${module}.ts`;
}
function runtimePath(module: string): string {
	return `../runtime/${module}.ts`;
}

export interface ManagedRouteProjection {
	phase: "none" | "brainstorm" | "planner" | "loop";
	reason?: string;
	task_id?: string;
	assurance?: { task_id: string; phase: string; next_action?: string };
}
export async function routeManagedRequest(input: {
	root: string;
	request: string;
	task_id?: string;
	assurance?: { task_id: string; phase: string; next_action: string };
}): Promise<ManagedRouteProjection> {
	const mod = await import(/* @vite-ignore */ runtimePath("managed_path_router"));
	return mod.routeManagedRequest(input) as ManagedRouteProjection;
}
export async function buildLoopAction(input: unknown): Promise<unknown> {
	const mod = await import(/* @vite-ignore */ runtimePath("loop_contract"));
	return mod.buildLoopAction(input);
}
export async function buildLoopRoleDispatch(input: unknown): Promise<unknown> {
	const mod = await import(/* @vite-ignore */ runtimePath("loop_contract"));
	return mod.buildLoopRoleDispatch(input);
}
export async function createEnrollmentAuthorityRegistry(): Promise<EnrollmentAuthorityRegistry> {
	const mod = await import(/* @vite-ignore */ kernelPath("enrollment_authority"));
	return mod.createEnrollmentAuthorityRegistry();
}
export async function preparePiCanary(
	root: string,
	input: PiCanaryPrepareInput,
): Promise<PiCanaryPreparation> {
	const mod = await import(/* @vite-ignore */ kernelPath("pi_canary_prepare"));
	return mod.preparePiCanary(root, input) as unknown as PiCanaryPreparation;
}
export async function revalidatePiCanary(
	root: string,
	input: PiCanaryPrepareInput,
	previous: PiCanaryPreparation,
): Promise<{ unchanged: boolean; current: PiCanaryPreparation }> {
	const mod = await import(/* @vite-ignore */ kernelPath("pi_canary_prepare"));
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
): Promise<{ record: { task_id: string; phase: string }; backend_claim: { backend: string } }> {
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
export async function readTaskRecordV2(
	root: string,
	taskId: string,
): Promise<TaskRecordV2Read> {
	const mod = await import(/* @vite-ignore */ kernelPath("storage"));
	return mod.readTaskRecordV2(root, taskId);
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
export interface TaskIntentRead {
	token: object;
	content_hash: string;
	intent: TaskIntentV1;
	intent_ref: { path: string; revision: number; content_hash: string };
}
export interface WorkspaceRead {
	revision: string;
	state: { contract: string; current_working: string | null };
}
export async function readTaskIntent(root: string, taskId: string): Promise<TaskIntentRead> {
	const mod = await import(/* @vite-ignore */ kernelPath("intent"));
	return mod.readTaskIntent(root, taskId);
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
	const mod = await import(/* @vite-ignore */ kernelPath("reducer_v2"));
	return mod.findingsDigestV2(findings);
}

export async function projectAssurance(
	root: string,
	taskId: string,
	diffProvider: (root: string, intent: { scope_hint?: unknown }) => string,
): Promise<AssuranceProjectionResult> {
	const mod = await import(/* @vite-ignore */ kernelPath("assurance_projection"));
	return mod.projectAssurance(root, taskId, diffProvider) as unknown as AssuranceProjectionResult;
}

export async function deriveAssuranceAuthorization(input: {
	risk: string;
	phase: string;
	fresh_approval_kinds: readonly string[];
	open_user_decision_count: number;
}): Promise<AssuranceAuthorizationReadiness> {
	const mod = await import(/* @vite-ignore */ kernelPath("assurance_projection"));
	return mod.deriveAssuranceAuthorization(input) as unknown as AssuranceAuthorizationReadiness;
}
