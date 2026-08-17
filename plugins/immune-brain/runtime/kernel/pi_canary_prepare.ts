// P2B1 U1: read-only canary preparation. NOT exported from kernel/index.ts.
// Aggregates every authoritative owner into one immutable preview + digest.
// Contains NO confirm callback, authority issuer, capability, rehearsal,
// enrollment call, or writer. Direct import cannot authorize or mutate.

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readBackendClaim, readTaskTombstone } from "./backend_claim";
import { readTaskIntent } from "./intent";
import {
	readTaskRecordV2Raw,
	readWorkspaceStateRaw,
} from "./storage";

const SOURCE_PATH = ".imm/memory/current_iteration.json";

export interface PiCanaryPrepareInput {
	task_id: string;
	now: string;
}

export interface PiCanaryPreparation {
	contract: "assurance_kernel/pi_canary_preparation/v1";
	task_id: string;
	generated_at: string;
	root_state_path: string;
	intent: {
		path: string;
		revision: number;
		content_hash: string;
	} | null;
	backend_claim: {
		present: boolean;
		task_id: string | null;
		lifecycle_status: string | null;
	};
	task_tombstone: {
		present: boolean;
		terminal_phase: string | null;
	};
	task_record_v2: {
		present: boolean;
		phase: string | null;
	} | null;
	workspace: {
		current_working: string | null;
	};
	digest: string;
}

function sha256Hex(bytes: string | Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}

/**
 * Build the immutable preparation identity for one exact canary task.
 * Read-only: no writes, no capability, no confirmation callback.
 */
export function preparePiCanary(root: string, input: PiCanaryPrepareInput): PiCanaryPreparation {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.task_id))
		throw new Error("task id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}");
	const canonicalRoot = resolve(root);
	const statePath = resolve(canonicalRoot, SOURCE_PATH);

	let intent: PiCanaryPreparation["intent"] = null;
	try {
		const read = readTaskIntent(canonicalRoot, input.task_id);
		intent = {
			path: read.intent_ref.path,
			revision: read.intent_ref.revision,
			content_hash: read.content_hash,
		};
	} catch {
		intent = null;
	}

	// Fail-closed owner reads: malformed, unreadable, symlinked, or
	// contradictory claim/record/workspace/tombstone state is a structured
	// rejection and is never normalized to absence. Only ENOENT means absent.
	const claim = readBackendClaim(canonicalRoot);
	const backend: PiCanaryPreparation["backend_claim"] = claim
		? {
				present: true,
				task_id: claim.task_id,
				lifecycle_status: claim.lifecycle_status,
			}
		: { present: false, task_id: null, lifecycle_status: null };
	if (claim && claim.task_id !== input.task_id)
		throw new Error(
			`backend claim belongs to task ${claim.task_id}, not ${input.task_id}`,
		);

	const tombstone = readTaskTombstone(canonicalRoot, input.task_id);
	const taskTombstone: PiCanaryPreparation["task_tombstone"] = tombstone
		? {
				present: true,
				terminal_phase: tombstone.terminal_phase,
			}
		: { present: false, terminal_phase: null };
	if (tombstone && claim)
		throw new Error(
			`task ${input.task_id} has both an active backend claim and a terminal tombstone`,
		);

	const current = readTaskRecordV2Raw(canonicalRoot, input.task_id);
	const record: PiCanaryPreparation["task_record_v2"] = current.record
		? { present: true, phase: current.record.phase }
		: { present: false, phase: null };
	if (claim && !current.record)
		throw new Error(
			`backend claim exists for task ${input.task_id} but its TaskRecord v2 is absent`,
		);
	if (claim && !intent)
		throw new Error(
			`backend claim exists for task ${input.task_id} but its intent sidecar is unreadable`,
		);
	if (current.record && current.record.task_id !== input.task_id)
		throw new Error(
			`task record identity is inconsistent for ${input.task_id}`,
		);

	const state = readWorkspaceStateRaw(canonicalRoot);
	const workspace: PiCanaryPreparation["workspace"] = {
		current_working: state.state.current_working,
	};
	if (claim && state.state.current_working !== claim.task_id)
		throw new Error(
			`workspace owner ${state.state.current_working} contradicts backend claim task ${claim.task_id}`,
		);

	const preparation: PiCanaryPreparation = {
		contract: "assurance_kernel/pi_canary_preparation/v1",
		task_id: input.task_id,
		generated_at: input.now,
		root_state_path: statePath,
		intent,
		backend_claim: backend,
		task_tombstone: taskTombstone,
		task_record_v2: record,
		workspace,
		digest: "",
	};
	preparation.digest = `sha256:${sha256Hex(stableStringify(preparation))}`;
	return preparation;
}

/**
 * Revalidate an immutable preparation: recompute from live owners and assert
 * the digest is unchanged. Read-only.
 */
export function revalidatePiCanary(
	root: string,
	input: PiCanaryPrepareInput,
	previous: PiCanaryPreparation,
): { unchanged: boolean; current: PiCanaryPreparation } {
	const current = preparePiCanary(root, input);
	return { unchanged: current.digest === previous.digest, current };
}
