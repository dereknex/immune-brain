/**
 * Loop Daemon: Event Normalization (E1-E11) (S1)
 *
 * Implements S1 and D2 of docs/specs/loop-daemon.spec.md.
 * Normalizes raw GitHub tracker, PR observations, and Lane facts into typed events.
 */

import { createHash } from "node:crypto";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type E1NewIssueEvent,
	type E2IssueEditedEvent,
	type E3OwnerCommentEvent,
	type E4PlanApprovedEvent,
	type E5ReadyTaskEvent,
	type E6LaneDecisionNeededEvent,
	type E7LaneDecisionRepliedEvent,
	type E8PRCheckFailedEvent,
	type E9PRConflictEvent,
	type E10PRReviewCommentEvent,
	type E11PRReadyOrMergedEvent,
	type LoopDaemonState,
	type NormalizedLoopEvent,
	type ObservationInput,
	type RawPR,
} from "./types.ts";

function normalizeLabelNames(labels?: Array<{ name: string } | string>): string[] {
	if (!labels || !Array.isArray(labels)) return [];
	return labels.map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
}

function parsePlanDigestFromComment(body: string): string | null {
	// 1. Check explicit marker: <!-- immune-brain:plan-digest=([^\s>]+) -->
	const markerMatch = body.match(/<!--\s*immune-brain:plan-digest=([^\s>]+)\s*-->/i);
	if (markerMatch) return markerMatch[1];

	// 2. Check commands: /approve <hash> or @imm-loop approve <hash>
	const cmdMatch = body.match(/(?:\/approve|@imm-loop\s+approve)\s+([a-zA-Z0-9:_-]{6,100})/i);
	if (cmdMatch) return cmdMatch[1];

	// 3. Fallback: "approve sha256:..." or "approved <hash>"
	const hashMatch = body.match(/\b(?:approved?|lgtm)\b.*?([a-zA-Z0-9:_-]{16,100})/i);
	if (hashMatch) return hashMatch[1];

	return null;
}

function parseLaneDecisionReply(
	body: string,
): { run_id: string; record_revision: string; selected_option: string } | null {
	// Marker formats or structured format:
	// <!-- immune-brain:run-id=<id> --> <!-- immune-brain:record-revision=<rev> -->
	// Option: 1, or Option A, or select: <id>
	const runMatch = body.match(/<!--\s*immune-brain:run-id=([^\s>]+)\s*-->/i) || body.match(/\brun_id:\s*([^\s]+)/i);
	const revMatch =
		body.match(/<!--\s*immune-brain:record-revision=([^\s>]+)\s*-->/i) ||
		body.match(/\brecord_revision:\s*([^\s]+)/i);

	const optionMatch =
		body.match(/<!--\s*immune-brain:decision-choice=([^\s>]+)\s*-->/i) ||
		body.match(/\b(?:option|choice|select)(?:\s+|:\s*)([a-zA-Z0-9_-]+)/i) ||
		body.match(/\boption\s+([0-9a-zA-Z_-]+)/i);

	if (runMatch && (revMatch || optionMatch)) {
		return {
			run_id: runMatch[1],
			record_revision: revMatch ? revMatch[1] : "unspecified",
			selected_option: optionMatch ? optionMatch[1] : body.trim(),
		};
	}

	return null;
}

export function isDaemonPr(pr: RawPR): boolean {
	const branch = pr.head_ref_name || "";
	return (
		branch.startsWith("imm/") ||
		branch.startsWith("imm-loop/") ||
		Boolean(pr.title && pr.title.includes("[imm-loop]"))
	);
}

export function normalizeEvents(
	input: ObservationInput,
	previousState: LoopDaemonState | null,
): NormalizedLoopEvent[] {
	const events: NormalizedLoopEvent[] = [];
	const observedAt = input.observed_at || new Date().toISOString();

	const prevIssuesWatermark = previousState?.watermarks.issues_updated_at;
	const prevCommentsWatermark = previousState?.watermarks.comments_updated_at;
	const prevPrsWatermark = previousState?.watermarks.prs_updated_at;

	// Process Issues
	for (const issue of input.issues || []) {
		const labels = normalizeLabelNames(issue.labels);
		const isReady =
			labels.includes("ready-for-agent") ||
			labels.includes("status:ready") ||
			labels.includes("imm:ready");

		const hasUnresolvedBlocks = Array.isArray(issue.blocked_by) && issue.blocked_by.length > 0;

		const isNew = !prevIssuesWatermark || new Date(issue.created_at) > new Date(prevIssuesWatermark);
		const isEdited =
			!isNew &&
			prevIssuesWatermark &&
			new Date(issue.updated_at) > new Date(prevIssuesWatermark) &&
			issue.updated_at !== issue.created_at;

		if (isNew) {
			const evt: E1NewIssueEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-e1-${issue.number}-${issue.created_at}`,
				kind: "E1_NEW_ISSUE",
				timestamp: observedAt,
				issue_number: issue.number,
				title: issue.title,
				body: issue.body || "",
				author: issue.author?.login || "unknown",
				labels,
				created_at: issue.created_at,
				updated_at: issue.updated_at,
				sub_issue_of: issue.sub_issue_of,
				blocked_by: issue.blocked_by,
			};
			events.push(evt);
		} else if (isEdited) {
			const evt: E2IssueEditedEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-e2-${issue.number}-${issue.updated_at}`,
				kind: "E2_ISSUE_EDITED",
				timestamp: observedAt,
				issue_number: issue.number,
				title: issue.title,
				body: issue.body || "",
				author: issue.author?.login || "unknown",
				labels,
				updated_at: issue.updated_at,
				previous_updated_at: prevIssuesWatermark || undefined,
				sub_issue_of: issue.sub_issue_of,
				blocked_by: issue.blocked_by,
			};
			events.push(evt);
		}

		// Check E5_READY_TASK: labeled ready-for-agent or marked ready, without blockers
		if (issue.state === "open" && isReady && !hasUnresolvedBlocks) {
			// Extract task_id from body marker if present: <!-- immune-brain:task-id=<task-id> -->
			const taskMatch = (issue.body || "").match(/<!--\s*immune-brain:task-id=([^\s>]+)\s*-->/);
			const planMatch = (issue.body || "").match(/<!--\s*immune-brain:plan-digest=([^\s>]+)\s*-->/);
			const initMatch = (issue.body || "").match(/<!--\s*immune-brain:initiative=([^\s>]+)\s*-->/);

			const evt: E5ReadyTaskEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-e5-${issue.number}-${issue.updated_at}`,
				kind: "E5_READY_TASK",
				timestamp: observedAt,
				issue_number: issue.number,
				task_id: taskMatch ? taskMatch[1] : undefined,
				initiative_slug: initMatch ? initMatch[1] : undefined,
				plan_digest: planMatch ? planMatch[1] : undefined,
			};
			events.push(evt);
		}

		// Process comments for E3, E4, E7
		for (const comment of issue.comments || []) {
			const commentIsNew =
				!prevCommentsWatermark ||
				new Date(comment.created_at) > new Date(prevCommentsWatermark);

			if (!commentIsNew) continue;

			// Check E4_PLAN_APPROVED first
			const planDigest = parsePlanDigestFromComment(comment.body);
			if (planDigest) {
				const evt: E4PlanApprovedEvent = {
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: `evt-e4-${issue.number}-${comment.id}`,
					kind: "E4_PLAN_APPROVED",
					timestamp: observedAt,
					issue_number: issue.number,
					comment_id: comment.id,
					author: comment.user?.login || "unknown",
					author_association: comment.author_association || "NONE",
					plan_digest: planDigest,
					approved_at: comment.created_at,
					raw_command: comment.body,
				};
				events.push(evt);
				continue;
			}

			// Check E7_LANE_DECISION_REPLIED
			const decisionReply = parseLaneDecisionReply(comment.body);
			if (decisionReply) {
				const evt: E7LaneDecisionRepliedEvent = {
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: `evt-e7-${issue.number}-${comment.id}`,
					kind: "E7_LANE_DECISION_REPLIED",
					timestamp: observedAt,
					issue_number: issue.number,
					comment_id: comment.id,
					author: comment.user?.login || "unknown",
					author_association: comment.author_association || "NONE",
					run_id: decisionReply.run_id,
					record_revision: decisionReply.record_revision,
					selected_option: decisionReply.selected_option,
					reply_body: comment.body,
				};
				events.push(evt);
				continue;
			}

			// Otherwise E3_OWNER_COMMENT
			const evt: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-e3-${issue.number}-${comment.id}`,
				kind: "E3_OWNER_COMMENT",
				timestamp: observedAt,
				issue_number: issue.number,
				comment_id: comment.id,
				author: comment.user?.login || "unknown",
				author_association: comment.author_association || "NONE",
				body: comment.body,
				created_at: comment.created_at,
				updated_at: comment.updated_at,
			};
			events.push(evt);
		}
	}

	// Process Lane Decisions (E6)
	for (const dec of input.lane_decisions || []) {
		const evt: E6LaneDecisionNeededEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: `evt-e6-${dec.run_id}-${dec.record_revision}`,
			kind: "E6_LANE_DECISION_NEEDED",
			timestamp: observedAt,
			task_id: dec.task_id,
			run_id: dec.run_id,
			record_revision: dec.record_revision,
			question: dec.question,
			options: dec.options,
		};
		events.push(evt);
	}

	// Process Pull Requests (E8, E9, E10, E11)
	for (const pr of input.pull_requests || []) {
		if (!isDaemonPr(pr)) continue;

		// 1. Merged PR -> E11
		if (pr.state === "merged" || (pr.state === "closed" && pr.merged)) {
			const evt: E11PRReadyOrMergedEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-e11-${pr.number}-${pr.head_sha}-merged`,
				kind: "E11_PR_READY_OR_MERGED",
				timestamp: observedAt,
				pr_number: pr.number,
				branch: pr.head_ref_name,
				head_sha: pr.head_sha,
				status: "merged",
			};
			events.push(evt);
			continue;
		}

		if (pr.state !== "open") continue;

		// 2. PR Conflict -> E9
		const isConflicting =
			pr.mergeable === "CONFLICTING" ||
			pr.mergeable_state === "dirty";
		if (isConflicting) {
			const evt: E9PRConflictEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-e9-${pr.number}-${pr.head_sha}`,
				kind: "E9_PR_CONFLICT",
				timestamp: observedAt,
				pr_number: pr.number,
				branch: pr.head_ref_name,
				base_branch: pr.base_ref_name,
				head_sha: pr.head_sha,
			};
			events.push(evt);
		}

		// 3. Failed Checks -> E8
		let hasFailedChecks = false;
		for (const check of pr.checks || []) {
			const isFailed =
				check.conclusion === "failure" ||
				check.conclusion === "timed_out" ||
				check.conclusion === "action_required" ||
				check.conclusion === "cancelled";

			if (isFailed) {
				hasFailedChecks = true;
				const signature = createHash("sha256")
					.update(`${check.name}:${check.conclusion}`)
					.digest("hex");

				const evt: E8PRCheckFailedEvent = {
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: `evt-e8-${pr.number}-${check.name}-${signature.slice(0, 12)}`,
					kind: "E8_PR_CHECK_FAILED",
					timestamp: observedAt,
					pr_number: pr.number,
					branch: pr.head_ref_name,
					head_sha: pr.head_sha,
					check_name: check.name,
					failure_signature: signature,
					details_url: check.details_url,
				};
				events.push(evt);
			}
		}

		// 4. Review Comments and Reviews -> E10
		for (const reviewComment of pr.review_comments || []) {
			const isNew =
				!prevPrsWatermark ||
				new Date(reviewComment.created_at) > new Date(prevPrsWatermark);
			if (isNew) {
				const evt: E10PRReviewCommentEvent = {
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: `evt-e10-${pr.number}-${reviewComment.id}`,
					kind: "E10_PR_REVIEW_COMMENT",
					timestamp: observedAt,
					pr_number: pr.number,
					branch: pr.head_ref_name,
					comment_id: reviewComment.id,
					author: reviewComment.user?.login || "unknown",
					author_association: reviewComment.author_association || "NONE",
					body: reviewComment.body,
					path: reviewComment.path,
					line: reviewComment.line,
				};
				events.push(evt);
			}
		}

		for (const review of pr.reviews || []) {
			if (!review.body || !review.body.trim()) continue;
			const isNew =
				!prevPrsWatermark ||
				new Date(review.submitted_at) > new Date(prevPrsWatermark);
			if (isNew) {
				const evt: E10PRReviewCommentEvent = {
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: `evt-e10-rev-${pr.number}-${review.id}`,
					kind: "E10_PR_REVIEW_COMMENT",
					timestamp: observedAt,
					pr_number: pr.number,
					branch: pr.head_ref_name,
					review_id: review.id,
					comment_id: review.id,
					author: review.user?.login || "unknown",
					author_association: review.author_association || "NONE",
					body: review.body,
				};
				events.push(evt);
			}
		}

		// Discussion comments on PR conversation -> E3_OWNER_COMMENT / E4 / E7
		for (const comment of pr.comments || []) {
			const isNew =
				!prevPrsWatermark ||
				new Date(comment.created_at) > new Date(prevPrsWatermark);
			if (!isNew) continue;

			const planDigest = parsePlanDigestFromComment(comment.body);
			if (planDigest) {
				const evt: E4PlanApprovedEvent = {
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: `evt-e4-pr-${pr.number}-${comment.id}`,
					kind: "E4_PLAN_APPROVED",
					timestamp: observedAt,
					issue_number: pr.number,
					comment_id: comment.id,
					author: comment.user?.login || "unknown",
					author_association: comment.author_association || "NONE",
					plan_digest: planDigest,
					approved_at: comment.created_at,
					raw_command: comment.body,
				};
				events.push(evt);
				continue;
			}

			const decisionReply = parseLaneDecisionReply(comment.body);
			if (decisionReply) {
				const evt: E7LaneDecisionRepliedEvent = {
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: `evt-e7-pr-${pr.number}-${comment.id}`,
					kind: "E7_LANE_DECISION_REPLIED",
					timestamp: observedAt,
					issue_number: pr.number,
					comment_id: comment.id,
					author: comment.user?.login || "unknown",
					author_association: comment.author_association || "NONE",
					run_id: decisionReply.run_id,
					record_revision: decisionReply.record_revision,
					selected_option: decisionReply.selected_option,
					reply_body: comment.body,
				};
				events.push(evt);
				continue;
			}

			const evt: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-e3-pr-${pr.number}-${comment.id}`,
				kind: "E3_OWNER_COMMENT",
				timestamp: observedAt,
				issue_number: pr.number,
				comment_id: comment.id,
				author: comment.user?.login || "unknown",
				author_association: comment.author_association || "NONE",
				body: comment.body,
				created_at: comment.created_at,
				updated_at: comment.updated_at,
			};
			events.push(evt);
		}

		// 5. Clean & Ready PR -> E11 (ready)
		const checks = pr.checks || [];
		const hasCompletedChecks = checks.length > 0;
		const allChecksSuccessful =
			hasCompletedChecks &&
			checks.every((c) => c.status === "completed" && c.conclusion === "success");
		const hasPendingChecks = checks.some(
			(c) => c.status !== "completed" || c.conclusion === null,
		);

		if (
			!hasFailedChecks &&
			!isConflicting &&
			!hasPendingChecks &&
			allChecksSuccessful &&
			pr.mergeable === "MERGEABLE"
		) {
			const evt: E11PRReadyOrMergedEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-e11-${pr.number}-${pr.head_sha}-ready`,
				kind: "E11_PR_READY_OR_MERGED",
				timestamp: observedAt,
				pr_number: pr.number,
				branch: pr.head_ref_name,
				head_sha: pr.head_sha,
				status: "ready",
			};
			events.push(evt);
		}
	}

	return events;
}
