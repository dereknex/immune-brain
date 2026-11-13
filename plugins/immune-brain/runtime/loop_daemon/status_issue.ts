/**
 * Loop Daemon: Single In-Place Status Issue (S3)
 *
 * Implements D3.3 of docs/specs/loop-daemon.spec.md (BR-REQ-3, BR-DEFER-2: the
 * pinned status Issue plus `imm-loop status` are canonical; no dashboard).
 * Exactly one Issue carries `<!-- immune-brain:kind=loop-status -->` and its
 * body is edited in place. Rendering is deterministic so an unchanged snapshot
 * plans no write.
 */

import type { LoopIdentityPosture } from "./identity.ts";
import type { RawIssue } from "./types.ts";

export const LOOP_STATUS_MARKER = "<!-- immune-brain:kind=loop-status -->";

const MARKER_PATTERN = /<!--\s*immune-brain:kind=loop-status\s*-->/;

export interface LoopStatusSnapshot {
	identity_posture: LoopIdentityPosture;
	paused: boolean;
	pause_reason: string | null;
	active_leases: number;
	queue_depth: number;
	open_daemon_prs: number;
	budget_usage: { ticks_today: number; dispatches_today: number };
	/** Escalation keys already raised, most recent first. */
	recent_escalations: readonly string[];
	updated_at: string;
}

export function isLoopStatusIssue(issue: RawIssue): boolean {
	return MARKER_PATTERN.test(issue.body ?? "");
}

export function renderStatusIssueBody(snapshot: LoopStatusSnapshot): string {
	const escalations = snapshot.recent_escalations.length
		? snapshot.recent_escalations.map((key) => `- \`${key}\``).join("\n")
		: "- none";
	return [
		LOOP_STATUS_MARKER,
		"## Loop daemon status",
		"",
		`- Identity posture: **${snapshot.identity_posture}**`,
		`- Paused: ${snapshot.paused ? `yes (${snapshot.pause_reason ?? "no reason"})` : "no"}`,
		`- Active leases: ${snapshot.active_leases}`,
		`- Queue depth: ${snapshot.queue_depth}`,
		`- Open daemon PRs: ${snapshot.open_daemon_prs}`,
		`- Budget used today: ${snapshot.budget_usage.ticks_today} ticks, ${snapshot.budget_usage.dispatches_today} dispatches`,
		`- Updated: ${snapshot.updated_at}`,
		"",
		"### Recent escalations",
		escalations,
		"",
	].join("\n");
}

export interface StatusIssuePlan {
	action: "create" | "update" | "noop";
	/** The status Issue this plan edits, or null when it must first be created. */
	issue_number: number | null;
	body: string;
	/** Further Issues carrying the marker; the lowest number is the canonical one. */
	duplicate_issue_numbers: number[];
}

/** Resolve the single status Issue and the write it needs for this snapshot. */
export function planStatusIssue(
	issues: readonly RawIssue[],
	snapshot: LoopStatusSnapshot,
): StatusIssuePlan {
	const body = renderStatusIssueBody(snapshot);
	const carriers = issues.filter(isLoopStatusIssue).sort((a, b) => a.number - b.number);
	const [canonical, ...duplicates] = carriers;
	const duplicateNumbers = duplicates.map((issue) => issue.number);

	if (canonical === undefined) {
		return { action: "create", issue_number: null, body, duplicate_issue_numbers: duplicateNumbers };
	}
	const unchanged = (canonical.body ?? "").replace(/\s+/g, " ").trim() === body.replace(/\s+/g, " ").trim();
	return {
		action: unchanged ? "noop" : "update",
		issue_number: canonical.number,
		body,
		duplicate_issue_numbers: duplicateNumbers,
	};
}
