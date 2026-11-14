/**
 * Loop Daemon: Deterministic Code Guards G1-G10 (S2)
 *
 * Implements Tier 0 of D2 in docs/specs/loop-daemon.spec.md (BR-REQ-2, BR-SCN-1).
 * Every guard is a pure function of one normalized event and caller-supplied
 * facts: it never mutates state, never calls GitHub and never consults a model.
 *
 * G1 pause/shutdown, G2 budget exhaustion, G3 no-touch/authority path,
 * G4 active-lease dedup, G5 repair retry cap, G6 unresolved native `blocked_by`,
 * G7 unverified actor, G8 stale digest/revision, G9 dirty worktree/lock conflict,
 * G10 same-UID `degraded` capability.
 */

import { NO_TOUCH_PATH, noTouchPaths } from "../no_touch.ts";
import type { LoopHandler } from "./handlers.ts";
import type { LoopLease, NormalizedLoopEvent } from "./types.ts";

export type GuardId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8" | "G9" | "G10";

export interface GuardVerdict {
	guard: GuardId;
	blocked: boolean;
	detail: string;
}

export type ConfirmationSource = "user_session" | "tracker_approval" | "policy_auto";

/** Everything the guards may read. Every field is optional: an omitted fact never blocks on its own. */
export interface GuardFacts {
	paused?: boolean;
	shutdown_requested?: boolean;
	budget_exhausted?: boolean;
	/** Extra protected prefixes, e.g. the `paths` of `docs/agents/no-touch.json`. */
	no_touch_paths?: string[];
	/** Paths the pending action would write. */
	target_paths?: string[];
	active_leases?: Record<string, LoopLease>;
	/** Repairs already attempted, keyed by `repairKey()`. */
	retry_counts?: Record<string, number>;
	retry_cap?: number;
	/** Issue number -> still-open native `blocked_by` issues. */
	unresolved_blockers?: Record<number, number[]>;
	allowed_actors?: string[];
	allowed_associations?: string[];
	daemon_identity?: string | null;
	expected_plan_digest?: string | null;
	/** Per-Issue published plan digests; G8 reads this one before the single-value fallback. */
	expected_plan_digests?: Record<number, string>;
	expected_record_revision?: string | null;
	expected_record_revisions?: Record<string, string>;
	worktree_dirty?: boolean;
	lock_conflict?: boolean;
	identity_posture?: "degraded" | "isolated";
	confirmation_source?: ConfirmationSource | null;
	/** Best duplicate candidate for the event's issue, supplied by the caller. */
	duplicate_candidate?: { number: number; title: string; body: string; score?: number };
	/** Per-issue best duplicate candidates computed by deterministic lexical similarity. */
	duplicate_candidates_by_issue?: Record<number, { number: number; title: string; body: string; score?: number }>;
	/** Active parked Lane decision facts for binding unparsed owner replies. */
	lane_decision_facts?: {
		task_id: string;
		run_id: string;
		record_revision: string;
		options?: Array<{ id: string; label: string; description?: string }>;
		issue_number?: number;
	};
}

export const DEFAULT_ALLOWED_ASSOCIATIONS: readonly string[] = ["OWNER", "MEMBER", "COLLABORATOR"];
export const DEFAULT_REPAIR_RETRY_CAP = 2;

/**
 * What a blocked event becomes. A refused authority path or an exhausted repair
 * cap is owner-visible, so it escalates; every other block is a quiet noop.
 */
export const GUARD_FALLBACKS: Readonly<Record<GuardId, LoopHandler>> = {
	G1: "noop_record",
	G2: "noop_record",
	G3: "escalate",
	G4: "noop_record",
	G5: "escalate",
	G6: "noop_record",
	G7: "noop_record",
	G8: "noop_record",
	G9: "noop_record",
	G10: "noop_record",
};

export interface LoopTarget {
	kind: "issue" | "pr" | "lane";
	id: string;
}

export function eventTarget(event: NormalizedLoopEvent): LoopTarget {
	switch (event.kind) {
		case "E6_LANE_DECISION_NEEDED":
			return { kind: "lane", id: event.task_id };
		case "E8_PR_CHECK_FAILED":
		case "E9_PR_CONFLICT":
		case "E10_PR_REVIEW_COMMENT":
		case "E11_PR_READY_OR_MERGED":
			return { kind: "pr", id: String(event.pr_number) };
		default:
			return { kind: "issue", id: String(event.issue_number) };
	}
}

/** The GitHub actor whose comment carries the event, when the event has one. */
export function eventActor(event: NormalizedLoopEvent): { login: string; association: string } | null {
	switch (event.kind) {
		case "E3_OWNER_COMMENT":
		case "E4_PLAN_APPROVED":
		case "E7_LANE_DECISION_REPLIED":
		case "E10_PR_REVIEW_COMMENT":
			return { login: event.author, association: event.author_association };
		default:
			return null;
	}
}

export function repairKey(headSha: string, failureSignature: string): string {
	return `${headSha}:${failureSignature}`;
}

/**
 * The owner-verification boundary: the login is in `loop.allowed_actors`, its
 * association is allowlisted, and the author is never the daemon itself. An
 * absent or empty actor allowlist verifies nobody, so an unconfigured daemon
 * fails closed instead of trusting every collaborator.
 */
export function isVerifiedActor(login: string, association: string, facts: GuardFacts): boolean {
	if (!login) return false;
	const actors = facts.allowed_actors ?? [];
	if (!actors.includes(login)) return false;
	const associations = facts.allowed_associations ?? DEFAULT_ALLOWED_ASSOCIATIONS;
	if (!associations.includes(association)) return false;
	if (facts.daemon_identity && login === facts.daemon_identity) return false;
	return true;
}

function leaseKeys(event: NormalizedLoopEvent): string[] {
	const target = eventTarget(event);
	const keys = [`${target.kind}-${target.id}`, target.id];
	if (event.kind === "E5_READY_TASK" && event.task_id) {
		keys.push(event.task_id);
	}
	return keys;
}

function unresolvedBlockers(event: NormalizedLoopEvent): number[] {
	switch (event.kind) {
		case "E1_NEW_ISSUE":
		case "E2_ISSUE_EDITED":
			return event.blocked_by ?? [];
		default:
			return [];
	}
}

function issueNumber(event: NormalizedLoopEvent): number | null {
	switch (event.kind) {
		case "E6_LANE_DECISION_NEEDED":
			return null;
		case "E8_PR_CHECK_FAILED":
		case "E9_PR_CONFLICT":
		case "E10_PR_REVIEW_COMMENT":
		case "E11_PR_READY_OR_MERGED":
			return null;
		default:
			return event.issue_number;
	}
}

/** Every applicable guard, in G1..G10 order. Absent entries are guards that do not apply to the event. */
export function evaluateGuards(event: NormalizedLoopEvent, facts: GuardFacts = {}): GuardVerdict[] {
	const verdicts: GuardVerdict[] = [];
	const verdict = (guard: GuardId, blocked: boolean, detail: string): void => {
		verdicts.push({ guard, blocked, detail });
	};

	verdict(
		"G1",
		facts.paused === true || facts.shutdown_requested === true,
		facts.shutdown_requested === true ? "shutdown requested" : facts.paused === true ? "daemon paused" : "daemon is running",
	);
	verdict("G2", facts.budget_exhausted === true, facts.budget_exhausted === true ? "daily dispatch budget exhausted" : "budget available");

	const targetPaths = facts.target_paths ?? [];
	const forbidden = noTouchPaths(targetPaths, [...(facts.no_touch_paths ?? []), NO_TOUCH_PATH]);
	verdict(
		"G3",
		forbidden.length > 0,
		forbidden.length > 0 ? `authority path targeted: ${forbidden.join(", ")}` : "no authority path targeted",
	);

	const leased = leaseKeys(event)
		.map((key) => facts.active_leases?.[key])
		.find((lease): lease is LoopLease => lease !== undefined && lease.status !== "releasing");
	verdict("G4", leased !== undefined, leased === undefined ? "target is not leased" : `target is leased by ${leased.target_id}`);

	if (event.kind === "E8_PR_CHECK_FAILED") {
		const attempts = facts.retry_counts?.[repairKey(event.head_sha, event.failure_signature)] ?? 0;
		const cap = facts.retry_cap ?? DEFAULT_REPAIR_RETRY_CAP;
		verdict("G5", attempts >= cap, `repair attempts ${attempts}/${cap} for this head and failure signature`);
	}

	const number = issueNumber(event);
	if (number !== null) {
		const blockers = facts.unresolved_blockers?.[number] ?? unresolvedBlockers(event);
		verdict("G6", blockers.length > 0, blockers.length > 0 ? `blocked_by ${blockers.join(", ")} unresolved` : "no unresolved blocker");
	}

	const actor = eventActor(event);
	if (actor !== null) {
		const verified = isVerifiedActor(actor.login, actor.association, facts);
		verdict("G7", !verified, verified ? `${actor.login} (${actor.association}) is verified` : `${actor.login} (${actor.association}) is not a verified owner`);
	}

	if (event.kind === "E4_PLAN_APPROVED") {
		// Fail closed: an approval is only evidence when it names the published digest.
		const expected = facts.expected_plan_digests?.[event.issue_number] ?? facts.expected_plan_digest ?? null;
		const stale = expected === null || event.plan_digest !== expected;
		verdict("G8", stale, expected === null ? "no published plan digest to match" : stale ? `plan digest ${event.plan_digest} is not the published ${expected}` : "plan digest matches the published plan");
	} else if (event.kind === "E7_LANE_DECISION_REPLIED") {
		const expected =
			(event.run_id ? facts.expected_record_revisions?.[event.run_id] : null)
			?? (event.task_id ? facts.expected_record_revisions?.[event.task_id] : null)
			?? facts.expected_record_revisions?.[String(event.issue_number)]
			?? facts.expected_record_revisions?.[`issue-${event.issue_number}`]
			?? facts.expected_record_revision
			?? null;
		const stale = expected === null || event.record_revision !== expected;
		verdict("G8", stale, expected === null ? "no current record revision to match" : stale ? `record revision ${event.record_revision} is not the current ${expected}` : "record revision is current");
	} else {
		verdict("G8", false, "no digest or revision to compare");
	}

	const worktree = facts.worktree_dirty === true;
	const lockConflict = facts.lock_conflict === true;
	verdict("G9", worktree || lockConflict, worktree ? "worktree is dirty" : lockConflict ? "lock conflict" : "worktree clean and unlocked");

	const degraded = facts.identity_posture === "degraded" && facts.confirmation_source === "policy_auto";
	verdict("G10", degraded, degraded ? "same-UID degraded posture cannot self-authorize policy_auto" : "capability posture allows this action");

	return verdicts;
}

export function firstBlock(verdicts: readonly GuardVerdict[]): GuardVerdict | null {
	return verdicts.find((entry) => entry.blocked) ?? null;
}
