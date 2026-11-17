/**
 * Loop Daemon: Leader Briefing (S2)
 *
 * Implements D2.1 of docs/specs/loop-leader.spec.md (BR-REQ-2, BR-DEC-3). The
 * briefing is a pure function of local state: work items, batch summaries,
 * pending interactions, recent outcomes, reconcile candidates, the catalog and
 * the owner's hints. It carries facts only — no timestamps and no counters — so
 * its digest is exactly the fingerprint the wake rule compares: a tick with no
 * new external or local fact reproduces the previous digest and wakes nothing.
 *
 * Budgets enter as availability only (`available` / `exhausted`), never as an
 * exact count, so the wake's own dispatch counter cannot change the fingerprint.
 */

import { createHash } from "node:crypto";

export const LOOP_LEADER_BRIEFING_CONTRACT = "immune_brain/loop_leader_briefing/v1" as const;
/** The serialized briefing never exceeds 64 KiB (D2.1). */
export const LEADER_BRIEFING_MAX_BYTES = 64 * 1024;
/** Recent handler and worker outcomes the briefing carries. */
export const LEADER_RECENT_OUTCOMES = 20;

export interface LeaderBriefingWorkItem {
	target: string;
	state: string;
	revision: number;
	binding: { plan_digest: string | null; task_ids: string[]; run_id: string | null; pr: number | null };
	refusals: Array<{ from: string; to: string; handler: string | null; reason: string }>;
	replan_rounds: number;
	paused: boolean;
}

export interface LeaderBriefingBatch {
	batch_id: string;
	initiative_slug: string | null;
	batch_state: string;
	children: Array<{ task_id: string; state: string }>;
}

export interface LeaderBriefingInteraction {
	id: string;
	kind: string;
	subject: string;
}

export interface LeaderBriefingOutcome {
	handler: string | null;
	outcome: string;
	detail: string;
}

export interface LeaderBriefingRole {
	name: string;
	base: string;
	when: string | null;
}

export interface LeaderBriefingInput {
	work_items: LeaderBriefingWorkItem[];
	batches: LeaderBriefingBatch[];
	interactions: LeaderBriefingInteraction[];
	/** Chronological, oldest first; the cap drops from this end. */
	outcomes: LeaderBriefingOutcome[];
	reconcile_candidates: Array<{ target: string; reason: string }>;
	roles: LeaderBriefingRole[];
	owner_hints: string[];
	budget: { leader_wakes: "available" | "exhausted"; dispatches: "available" | "exhausted" };
}

export interface LeaderBriefing extends LeaderBriefingInput {
	contract: typeof LOOP_LEADER_BRIEFING_CONTRACT;
}

export interface CompiledLeaderBriefing {
	briefing: LeaderBriefing;
	/** The canonical serialization the cap applies to and the digest is taken over. */
	json: string;
	bytes: number;
	fingerprint: string;
	/** Outcomes left out: beyond the recent window, or dropped to meet the cap. */
	dropped_outcomes: number;
}

/** Key-sorted JSON, so two equal briefings always serialize to the same bytes. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value !== null && typeof value === "object") {
		const source = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(source)
				.sort()
				.map((key) => [key, sortKeys(source[key])]),
		);
	}
	return value;
}

function fingerprintOf(json: string): string {
	return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}

/**
 * Serialize and fingerprint one briefing. Over the cap, the oldest outcomes are
 * dropped first; a work item is never dropped, so a briefing that cannot shrink
 * below the cap stays over it rather than lose orchestration state.
 */
export function compileLeaderBriefing(input: LeaderBriefingInput): CompiledLeaderBriefing {
	const briefing: LeaderBriefing = {
		contract: LOOP_LEADER_BRIEFING_CONTRACT,
		work_items: input.work_items,
		batches: input.batches,
		interactions: input.interactions,
		outcomes: input.outcomes.slice(-LEADER_RECENT_OUTCOMES),
		reconcile_candidates: input.reconcile_candidates,
		roles: input.roles,
		owner_hints: input.owner_hints,
		budget: input.budget,
	};
	let dropped = input.outcomes.length - briefing.outcomes.length;
	let json = canonicalJson(briefing);
	while (Buffer.byteLength(json, "utf8") > LEADER_BRIEFING_MAX_BYTES && briefing.outcomes.length > 0) {
		briefing.outcomes.shift();
		dropped += 1;
		json = canonicalJson(briefing);
	}
	return { briefing, json, bytes: Buffer.byteLength(json, "utf8"), fingerprint: fingerprintOf(json), dropped_outcomes: dropped };
}

/** The digest of a briefing already in hand; the wake rule compares two of these. */
export function leaderBriefingFingerprint(briefing: LeaderBriefing): string {
	return fingerprintOf(canonicalJson(briefing));
}
