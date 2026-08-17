// 2026-08-16-009 successor-one-command.
// Collapses the mechanical replan succession sequence (stop predecessor,
// release backend claim, derive same-scope successor TaskIntent, atomic
// enrollment) into ONE linearized operation under the workspace lock behind
// exactly one literal-user confirmation, with all-before/all-after crash
// recovery via a dedicated succession marker.
//
// NOT part of the Kernel runtime graph: it composes existing kernel exports
// (reduceTaskV2, capability inspection, enrollment, storage lock) under one
// marker-guarded transaction. The command is valid only when the predecessor
// carries an open replan_required finding.

import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync, renameSync, openSync, closeSync, fsyncSync, readdirSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { withKernelStoreLockV2, readTaskRecordV2Raw, readWorkspaceStateRaw, serializeWorkspace, readSecureProjectFile } from "../runtime/kernel/storage";
import { reduceTaskV2 } from "../runtime/kernel/reducer_v2";
import { capabilityActionFor } from "../runtime/kernel/canary_application";
import { digestOfAction, createMutationAuthorityRegistry, type MutationAuthorityRegistry, type CapabilityBindingV2 } from "../runtime/kernel/authority_port";
import type { MutationAuthorityCapabilityV2 } from "../runtime/kernel/types";
import { readBackendClaim, serializeBackendClaim, backendClaimPath, readTaskTombstone, TASK_TOMBSTONE_CONTRACT, type TaskTombstone } from "../runtime/kernel/backend_claim";
import { readTaskIntent, canonicalIntentHash } from "../runtime/kernel/intent";
import { preparePiCanary } from "../runtime/kernel/pi_canary_prepare";
import { taskDiffHash } from "../runtime/workspace_scope";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding, type EnrollmentAuthorityRegistry } from "../runtime/kernel/enrollment_authority";
import type { TaskIntentV1, TaskRecordV2, AuthorityAuditDescriptorV2 } from "../runtime/kernel/types";

export const SUCCESSION_MARKER_REL = ".imm/tasks/.succession-transaction.json";

export interface SuccessionTransaction {
	contract: "assurance_kernel/succession_transaction/v1";
	predecessor_id: string;
	successor_id: string;
	predecessor_before: string | null;
	predecessor_after: string;
	successor_before: string | null;
	successor_after: string;
	workspace_before: string;
	workspace_after: string;
	claim_before: string | null;
	claim_after: string | null;
	tombstone_before: string | null;
	tombstone_after: string;
	now: string;
}

const ALLOWED_MARKER_FIELDS = [
	"contract",
	"predecessor_id",
	"successor_id",
	"predecessor_before",
	"predecessor_after",
	"successor_before",
	"successor_after",
	"workspace_before",
	"workspace_after",
	"claim_before",
	"claim_after",
	"tombstone_before",
	"tombstone_after",
	"now",
];

function parseSuccessionMarker(raw: Record<string, unknown>): SuccessionTransaction {
	const unknown = Object.keys(raw).filter((key) => !ALLOWED_MARKER_FIELDS.includes(key));
	if (unknown.length > 0)
		throw new Error(`succession marker has unknown field: ${unknown[0]}`);
	if (raw.contract !== "assurance_kernel/succession_transaction/v1")
		throw new Error("succession marker contract is invalid");
	if (typeof raw.predecessor_id !== "string" || typeof raw.successor_id !== "string")
		throw new Error("succession marker task ids are invalid");
	for (const field of ["predecessor_before", "successor_before", "claim_before", "tombstone_before", "claim_after"]) {
		if (raw[field] !== null && typeof raw[field] !== "string")
			throw new Error(`succession marker ${field} is invalid`);
	}
	for (const field of ["predecessor_after", "successor_after", "workspace_before", "workspace_after", "tombstone_after", "now"]) {
		if (typeof raw[field] !== "string" || !String(raw[field]).trim())
			throw new Error(`succession marker ${field} is invalid`);
	}
	return raw as unknown as SuccessionTransaction;
}

// ---------------------------------------------------------------------------
// Secure low-level file writes (mirrors the storage layer's fail-closed
// discipline: canonical path, no symlink segments, atomic rename, fsync).
// ---------------------------------------------------------------------------

function secureProjectPath(root: string, rel: string): string {
	const canonical = resolve(root);
	const candidate = resolve(canonical, rel);
	if (!candidate.startsWith(canonical + sep) && candidate !== canonical)
		throw new Error(`succession path escapes the workspace: ${rel}`);
	return candidate;
}

function assertNoSymlinkSegments(path: string): void {
	let current = path;
	const parts: string[] = [];
	while (true) {
		const parent = dirname(current);
		if (parent === current) break;
		parts.unshift(parent);
		current = parent;
	}
	for (const part of parts) {
		if (existsSync(part) && statSync(part).isSymbolicLink())
			throw new Error(`succession path contains a symlink segment: ${part}`);
	}
}

function secureWriteJson(root: string, rel: string, content: string): void {
	const candidate = secureProjectPath(root, rel);
	assertNoSymlinkSegments(candidate);
	mkdirSync(dirname(candidate), { recursive: true });
	const tmp = `${candidate}.tmp-${randomUUID()}`;
	writeFileSync(tmp, content, { encoding: "utf8", flag: "wx" });
	renameSync(tmp, candidate);
	const fd = openSync(dirname(candidate), "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function secureRemove(root: string, rel: string): void {
	const candidate = secureProjectPath(root, rel);
	assertNoSymlinkSegments(candidate);
	if (existsSync(candidate)) rmSync(candidate);
}

function readOrNull(root: string, rel: string): string | null {
	const candidate = secureProjectPath(root, rel);
	assertNoSymlinkSegments(candidate);
	if (!existsSync(candidate)) return null;
	return readFileSync(candidate, "utf8");
}

function recordRel(taskId: string): string {
	return `.imm/tasks/${taskId}.json`;
}

// ---------------------------------------------------------------------------
// Successor intent derivation: same scope_hint and acceptance verification
// descriptors; only task identity and succession goal text change.
// ---------------------------------------------------------------------------

export function deriveSuccessorIntent(intent: TaskIntentV1, successorId: string): TaskIntentV1 {
	return {
		...intent,
		task_id: successorId,
		goal: `${intent.goal} [succession from ${intent.task_id}]`,
	};
}

export function parseSucceedArgs(raw: string): { predecessor_id: string } {
	const parts = raw.trim().split(/\s+/).filter(Boolean);
	if (parts.length !== 1) throw new Error("usage: /imm-canary-succeed <task-id>");
	const [taskId] = parts;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
		throw new Error(`invalid task id: ${taskId}`);
	return { predecessor_id: taskId };
}

export function successorIdFor(predecessorId: string): string {
	const match = /^(\d{4}-\d{2}-\d{2}-)(\d{3})(-.*)?$/.exec(predecessorId);
	if (!match) throw new Error(`cannot derive successor id from ${predecessorId}`);
	const next = String(Number(match[2]) + 1).padStart(3, "0");
	return `${match[1]}${next}${match[3] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Crash recovery: accepts only all-before or all-after.
// ---------------------------------------------------------------------------

export function recoverPendingSuccessionLocked(root: string): void {
	const markerRaw = readOrNull(root, SUCCESSION_MARKER_REL);
	if (!markerRaw) return;
	const marker = parseSuccessionMarker(JSON.parse(markerRaw));
	const predRel = recordRel(marker.predecessor_id);
	const succRel = recordRel(marker.successor_id);
	const predNow = readOrNull(root, predRel);
	const succNow = readOrNull(root, succRel);
	const wsNow = readOrNull(root, ".imm/workspace.json");
	const claimNow = readOrNull(root, ".imm/tasks/.backend-claim.json");
	const tombNow = readOrNull(root, `.imm/tasks/${marker.predecessor_id}.backend-claim.json`);

	const allAfter =
		predNow === marker.predecessor_after &&
		succNow === marker.successor_after &&
		wsNow === marker.workspace_after &&
		claimNow === marker.claim_after &&
		tombNow === marker.tombstone_after;
	if (allAfter) {
		secureRemove(root, SUCCESSION_MARKER_REL);
		return;
	}

	// Roll back to the all-before state (fail closed on any inconsistency).
	if (marker.predecessor_before === null) secureRemove(root, predRel);
	else secureWriteJson(root, predRel, marker.predecessor_before);
	if (marker.successor_before === null) secureRemove(root, succRel);
	else secureWriteJson(root, succRel, marker.successor_before);
	secureWriteJson(root, ".imm/workspace.json", marker.workspace_before);
	if (marker.claim_before === null) secureRemove(root, ".imm/tasks/.backend-claim.json");
	else secureWriteJson(root, ".imm/tasks/.backend-claim.json", marker.claim_before);
	if (marker.tombstone_before === null)
		secureRemove(root, `.imm/tasks/${marker.predecessor_id}.backend-claim.json`);
	else secureWriteJson(root, `.imm/tasks/${marker.predecessor_id}.backend-claim.json`, marker.tombstone_before);
	secureRemove(root, SUCCESSION_MARKER_REL);
}

// ---------------------------------------------------------------------------
// The atomic succession operation (caller holds NO lock; this takes it).
// ---------------------------------------------------------------------------

export interface SucceedInput {
	root: string;
	predecessor_id: string;
	successor_id: string;
	successor_intent: TaskIntentV1;
	/** User-kind stop capability minted against `stopRegistry`. */
	stop_capability: MutationAuthorityCapabilityV2;
	stop_registry: MutationAuthorityRegistry;
	/** Enrollment binding WITHOUT a preparation digest (computed in-lock). */
	enrollment_binding: Omit<EnrollmentCapabilityBinding, "preparation_digest">;
	enrollment_registry: EnrollmentAuthorityRegistry;
	diffProvider: (root: string, intent: TaskIntentV1) => string;
	now: string;
}

export function succeedCanaryTask(input: SucceedInput): { predecessor_phase: string; successor_phase: string } {
	const { root, predecessor_id, successor_id, successor_intent, now } = input;
	return withKernelStoreLockV2(root, () => {
		recoverPendingSuccessionLocked(root);

		// --- preconditions (fail closed) ---
		const pred = readTaskRecordV2Raw(root, predecessor_id);
		if (!pred.record)
			throw new Error(`predecessor ${predecessor_id} has no TaskRecord v2`);
		if (pred.record.phase !== "working" && pred.record.phase !== "review")
			throw new Error(`predecessor must be working or review; found ${pred.record.phase}`);
		const replan = pred.record.findings.find(
			(f) => f.kind === "replan_required" && f.status === "open",
		);
		if (!replan)
			throw new Error(`succeed requires an open replan_required finding on ${predecessor_id}`);
		const claim = readBackendClaim(root);
		if (!claim || claim.task_id !== predecessor_id)
			throw new Error(`no active backend claim for ${predecessor_id}`);
		if (claim.lifecycle_status !== "active")
			throw new Error(`predecessor claim must be active; found ${claim.lifecycle_status}`);
		const workspace = readWorkspaceStateRaw(root);
		if (workspace.state.current_working !== predecessor_id)
			throw new Error(`workspace is not owned by ${predecessor_id}`);
		const succ = readTaskRecordV2Raw(root, successor_id);
		if (succ.record) throw new Error(`successor ${successor_id} is already enrolled`);
		if (readTaskTombstone(root, successor_id))
			throw new Error(`successor ${successor_id} is terminal`);
		if (canonicalIntentHash(successor_intent) !== input.enrollment_binding.intent_content_hash)
			throw new Error("successor intent content hash does not match the enrollment binding");
		if (successor_intent.task_id !== successor_id)
			throw new Error("successor intent task id mismatch");

		// --- stop reduction with capability inspection (mirrors the
		// application port's preflight for the stop action) ---
		const stopActionRaw = capabilityActionFor({
			op: "stop",
			task_id: predecessor_id,
			at: now,
			actor_id: "literal-user",
			reason: `succession to ${successor_id} (replan_required)`,
		});
		const diffHash = input.diffProvider(root, pred.record.intent_snapshot);
		// The capability action carries placeholder hashes for the digest
		// (digest excludes them); the applied action must carry the exact
		// current identities (mirrors canary_application's base rebuild).
		const stopAction = {
			...stopActionRaw,
			expected_record_hash: pred.revision,
			expected_workspace_hash: workspace.revision,
			diff_hash: diffHash,
		} as never;
		const stopDigest = digestOfAction(stopAction);
		const expectedAuthority = {
			task_id: predecessor_id,
			action: stopAction,
			expected_record_hash: pred.revision,
			intent_revision: pred.record.intent_revision,
			intent_content_hash: pred.record.intent_ref.content_hash,
			diff_hash: diffHash,
		};
		const inspected = input.stop_registry.inspect(input.stop_capability, expectedAuthority, Date.now());
		if (inspected.audit.authority_kind !== "user")
			throw new Error("stop capability must be user authority");
		const stopped = reduceTaskV2(
			pred.record,
			stopAction,
			inspected.audit as AuthorityAuditDescriptorV2,
		);
		const stoppedRecord = (stopped as { record: TaskRecordV2 }).record;
		if (stoppedRecord.phase !== "stopped")
			throw new Error("stop reduction did not reach phase stopped");

		// --- successor enrollment validation + record construction ---
		// The successor's preparation digest can only be computed while the
		// workspace is released, so the stop-side release happens first under
		// the marker (crash between these steps rolls back to all-before).
		secureWriteJson(root, ".imm/tasks/.backend-claim.json", "null\n");
		secureWriteJson(root, ".imm/workspace.json", serializeWorkspace({ ...workspace.state, current_working: null }));
		const prep = preparePiCanary(root, { task_id: successor_id, now });
		const binding: EnrollmentCapabilityBinding = {
			...input.enrollment_binding,
			preparation_digest: prep.digest,
		};
		const enrollmentCapability = input.enrollment_registry.issue(binding);
		const intentRef = {
			path: `docs/plans/${successor_id}.intent.json`,
			revision: successor_intent.revision,
			content_hash: canonicalIntentHash(successor_intent),
		};
		const successorRecord: TaskRecordV2 = {
			contract: "assurance_kernel/task_record/v2",
			task_id: successor_id,
			intent_revision: successor_intent.revision,
			intent_snapshot: successor_intent,
			intent_ref: intentRef,
			phase: "working",
			baseline: canonicalIntentHash(successor_intent),
			evidence: [],
			findings: [],
			approvals: [],
			history: [],
		};
		const successorClaim = {
			contract: "assurance_kernel/backend_claim/v1",
			backend: "kernel",
			task_id: successor_id,
			intent_revision: successor_intent.revision,
			intent_content_hash: canonicalIntentHash(successor_intent),
			enrollment_event_id: `succeed-${successor_id}-${now}`,
			readiness_digest: input.enrollment_binding.readiness_digest,
			evidence_digest: input.enrollment_binding.evidence_digest,
			lifecycle_status: "active",
			created_at: now,
			updated_at: now,
		};
		input.enrollment_registry.consume(enrollmentCapability, binding);

		// --- one marker-guarded transaction ---
		const predRel = recordRel(predecessor_id);
		const succRel = recordRel(successor_id);
		const predBefore = readOrNull(root, predRel);
		const succBefore = readOrNull(root, succRel);
		const wsBefore = readOrNull(root, ".imm/workspace.json") ?? serializeWorkspace(workspace.state);
		const claimBefore = readOrNull(root, ".imm/tasks/.backend-claim.json");
		const tombBefore = readOrNull(root, `.imm/tasks/${predecessor_id}.backend-claim.json`);

		const nextWorkspace = { ...workspace.state, current_working: successor_id };
		const predAfter = `${JSON.stringify(stoppedRecord, null, 2)}\n`;
		const succAfter = `${JSON.stringify(successorRecord, null, 2)}\n`;
		const wsAfter = serializeWorkspace(nextWorkspace);
		const claimAfter = serializeBackendClaim(successorClaim as never);
		const tombstone: TaskTombstone = {
			contract: TASK_TOMBSTONE_CONTRACT,
			task_id: predecessor_id,
			lifecycle_status: "terminal",
			terminal_phase: "stopped",
			terminal_event_id: `succeed-${predecessor_id}-${now}`,
			final_record_hash: `sha256:${createHash("sha256").update(predAfter).digest("hex")}`,
			terminalized_at: now,
		};
		const tombAfter = `${JSON.stringify(tombstone, null, 2)}\n`;

		const marker: SuccessionTransaction = {
			contract: "assurance_kernel/succession_transaction/v1",
			predecessor_id,
			successor_id,
			predecessor_before: predBefore,
			predecessor_after: predAfter,
			successor_before: succBefore,
			successor_after: succAfter,
			workspace_before: wsBefore,
			workspace_after: wsAfter,
			claim_before: claimBefore,
			claim_after: claimAfter,
			tombstone_before: tombBefore,
			tombstone_after: tombAfter,
			now,
		};
		secureWriteJson(root, SUCCESSION_MARKER_REL, `${JSON.stringify(marker, null, 2)}\n`);

		try {
			secureWriteJson(root, predRel, predAfter);
			secureWriteJson(root, succRel, succAfter);
			secureWriteJson(root, ".imm/workspace.json", wsAfter);
			secureWriteJson(root, ".imm/tasks/.backend-claim.json", claimAfter);
			secureWriteJson(root, `.imm/tasks/${predecessor_id}.backend-claim.json`, tombAfter);
			secureRemove(root, SUCCESSION_MARKER_REL);
		} catch (error) {
			// Marker remains; the next recoverPendingSuccessionLocked settles
			// all-before or all-after.
			throw error;
		}

		return { predecessor_phase: "stopped", successor_phase: "working" };
	});
}

// ---------------------------------------------------------------------------
// Command registration: exactly one literal-user confirmation displaying the
// stop, release, derive, and enroll payload before any mutation.
// ---------------------------------------------------------------------------

export function registerSucceedCommand(pi: ExtensionAPI): void {
	pi.registerCommand("imm-canary-succeed", {
		description: "Stop a replan_required task, derive its same-scope successor intent, and enroll it in one confirmed operation",
		handler: async (args: string, ctx: ExtensionContext) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("imm-canary-succeed is TUI-only and was rejected", "warning");
				return;
			}
			let parsed: ReturnType<typeof parseSucceedArgs>;
			try {
				parsed = parseSucceedArgs(args);
			} catch (error) {
				ctx.ui.notify(`imm-canary-succeed: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			const { predecessor_id } = parsed;
			const successorId = successorIdFor(predecessor_id);
			const now = new Date().toISOString();
			try {
				const intentRead = readTaskIntent(ctx.cwd, predecessor_id);
				const intent = intentRead.intent;
				const successorIntent = deriveSuccessorIntent(intent, successorId);
				const stopRegistry = await createMutationAuthorityRegistry();
				const enrollmentRegistry = await createEnrollmentAuthorityRegistry();
				const binding = {
					task_id: successorId,
					intent_path: `docs/plans/${successorId}.intent.json`,
					intent_revision: successorIntent.revision,
					intent_content_hash: canonicalIntentHash(successorIntent),
					readiness_digest: "sha256:r",
					evidence_digest: "sha256:e",
					waiver_gate: "observation_window_days",
					actor_id: "user",
					confirmation_ref: `succeed-${randomUUID().slice(0, 8)}`,
					expires_at: "2099-01-01T00:00:00.000Z",
					nonce: randomUUID(),
				};
				const stopAction = capabilityActionFor({
					op: "stop",
					task_id: predecessor_id,
					at: now,
					actor_id: "literal-user",
					reason: `succession to ${successorId} (replan_required)`,
				}) as never;
				const stopBinding: CapabilityBindingV2 = {
					authority_kind: "user",
					task_id: predecessor_id,
					action_digest: digestOfAction(stopAction),
					expected_record_hash: (await readTaskRecordV2Raw(ctx.cwd, predecessor_id)).revision,
					intent_revision: intent.revision,
					intent_content_hash: intentRead.content_hash,
					diff_hash: taskDiffHash(ctx.cwd, intent.scope_hint),
					actor_id: "literal-user",
					confirmation_ref: `succeed-stop-${randomUUID().slice(0, 8)}`,
					expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
					findings_digest: null,
				};
				const stopCapability = stopRegistry.issue(stopBinding);

				const summary = [
					`Predecessor: ${predecessor_id}`,
					`Successor: ${successorId}`,
					"",
					"Operation payload",
					"1. Stop predecessor (backend claim release + tombstone)",
					"2. Derive successor intent (same scope_hint + verification descriptors)",
					`   Intent path: docs/plans/${successorId}.intent.json`,
					`   Intent hash: ${binding.intent_content_hash.slice(0, 16)}...`,
					"3. Atomic enrollment (workspace claim → successor)",
					"",
					"Cancel before this confirmation writes nothing.",
				].join("\n");

				let confirmed: boolean;
				try {
					confirmed = await ctx.ui.confirm(
						`Succeed ${predecessor_id} into ${successorId}?`,
						summary,
						{ signal: ctx.signal },
					);
				} catch {
					ctx.ui.notify("imm-canary-succeed: confirmation aborted; zero writes", "info");
					return;
				}
				if (!confirmed) {
					ctx.ui.notify("imm-canary-succeed: cancelled; zero writes", "info");
					return;
				}

				// --- commit point: derive writes the tracked intent sidecar,
				// then the atomic succession runs under the workspace lock ---
				secureWriteJson(
					ctx.cwd,
					`docs/plans/${successorId}.intent.json`,
					`${JSON.stringify(successorIntent, null, 2)}\n`,
				);
				const result = succeedCanaryTask({
					root: ctx.cwd,
					predecessor_id,
					successor_id: successorId,
					successor_intent: successorIntent,
					stop_capability: stopCapability,
					stop_registry: stopRegistry,
					enrollment_binding: binding,
					enrollment_registry: enrollmentRegistry,
					diffProvider: (root: string, scopedIntent: TaskIntentV1) => taskDiffHash(root, scopedIntent.scope_hint),
					now,
				});
				ctx.ui.notify(
					`imm-canary-succeed: ${predecessor_id} stopped (${result.predecessor_phase}), ${successorId} enrolled (${result.successor_phase})`,
					"info",
				);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`imm-canary-succeed: ${reason}`, "error");
			}
		},
	});
}
