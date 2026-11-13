/**
 * Loop Daemon: GitHub and Runtime Observer (S1)
 *
 * Implements S1 and D2 of docs/specs/loop-daemon.spec.md.
 * Polls GitHub REST/GraphQL state and local runs, normalizes events E1-E11,
 * and maintains observation watermarks.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { GhTransport } from "../github_issue_tracker.ts";
import { createGhTransport } from "../github_issue_tracker.ts";
import { normalizeEvents } from "./events.ts";
import {
	type LoopDaemonState,
	type LoopDaemonWatermarks,
	type NormalizedLoopEvent,
	type ObservationInput,
	type RawIssue,
	type RawLaneDecisionFact,
	type RawPR,
} from "./types.ts";

export interface ObservationResult {
	events: NormalizedLoopEvent[];
	watermarks: LoopDaemonWatermarks;
	snapshot: ObservationInput;
}

export function scanLocalLaneDecisions(root: string): RawLaneDecisionFact[] {
	const runsDir = join(root, ".imm/runs");
	if (!existsSync(runsDir)) return [];

	const decisions: RawLaneDecisionFact[] = [];
	try {
		const entries = readdirSync(runsDir);
		for (const entry of entries) {
			const runDir = join(runsDir, entry);
			const runJsonPath = join(runDir, "run.json");
			const taskRecordPath = join(runDir, "task-record.json");

			const recordPath = existsSync(runJsonPath)
				? runJsonPath
				: existsSync(taskRecordPath)
					? taskRecordPath
					: null;

			if (!recordPath) continue;

			try {
				const raw = readFileSync(recordPath, "utf8");
				const parsed = JSON.parse(raw) as Record<string, any>;
				if (parsed.lifecycle === "active" || parsed.artifact_state === "active") {
					// Check if paused awaiting literal-user decision
					if (parsed.lane_decision_facts || parsed.laneDecisionFacts) {
						const facts = parsed.lane_decision_facts || parsed.laneDecisionFacts;
						decisions.push({
							task_id: parsed.task_id || entry,
							run_id: parsed.run_id || entry,
							record_revision: parsed.record_revision || "rev-1",
							question: facts.question || "Decision required",
							options: Array.isArray(facts.options) ? facts.options : [],
						});
					} else if (
						typeof parsed.open_user_decision_count === "number" &&
						parsed.open_user_decision_count > 0 &&
						Array.isArray(parsed.unresolved_user_decisions)
					) {
						const first = parsed.unresolved_user_decisions[0];
						decisions.push({
							task_id: parsed.task_id || entry,
							run_id: parsed.run_id || entry,
							record_revision: parsed.record_revision || "rev-1",
							question: first.prompt || first.question || "Decision required",
							options: Array.isArray(first.options)
								? first.options.map((opt: any) => ({
										id: typeof opt === "string" ? opt : opt.id || String(opt),
										label: typeof opt === "string" ? opt : opt.label || String(opt),
									}))
								: [],
						});
					}
				}
			} catch {}
		}
	} catch {}
	return decisions;
}

function parseRawIssues(items: any[]): RawIssue[] {
	return items.map((item: any) => {
		const blockedByNumbers: number[] = [];
		if (Array.isArray(item.blockedBy)) {
			for (const b of item.blockedBy) {
				const num = typeof b === "number" ? b : typeof b?.number === "number" ? b.number : null;
				if (typeof num === "number") blockedByNumbers.push(num);
			}
		} else if (Array.isArray(item.blocked_by)) {
			for (const b of item.blocked_by) {
				const num = typeof b === "number" ? b : typeof b?.number === "number" ? b.number : null;
				if (typeof num === "number") blockedByNumbers.push(num);
			}
		}

		const parentNumber =
			typeof item.parent?.number === "number"
				? item.parent.number
				: typeof item.sub_issue_of === "number"
					? item.sub_issue_of
					: null;

		return {
			id: item.id || item.number,
			number: item.number,
			title: item.title || "",
			body: item.body || "",
			state: item.state === "CLOSED" || item.state === "closed" ? "closed" : "open",
			created_at: item.createdAt || item.created_at || new Date().toISOString(),
			updated_at: item.updatedAt || item.updated_at || new Date().toISOString(),
			author: item.author || { login: "unknown" },
			labels: item.labels || [],
			sub_issue_of: parentNumber,
			blocked_by: blockedByNumbers,
			comments: Array.isArray(item.comments)
				? item.comments.map((c: any) => ({
						id: c.id,
						body: c.body || "",
						user: c.author || c.user || { login: "unknown" },
						author_association: c.authorAssociation || c.author_association || "NONE",
						created_at: c.createdAt || c.created_at || new Date().toISOString(),
						updated_at: c.updatedAt || c.updated_at || new Date().toISOString(),
					}))
				: [],
		};
	});
}

export async function pollIssuesFromGithub(
	gh: GhTransport,
	cwd: string,
	options?: {
		etag?: string | null;
		previousIssues?: RawIssue[];
	},
): Promise<RawIssue[]> {
	let conditionalEtag: string | null = null;

	// Finding 5: ETag/If-None-Match conditional request
	if (options?.etag) {
		try {
			const condRes = await gh.run(
				[
					"api",
					"repos/{owner}/{repo}/issues?state=all&per_page=100",
					"-H",
					`If-None-Match: ${options.etag}`,
					"-i",
				],
				{ cwd },
			);
			if (
				condRes.exit_code === 304 ||
				condRes.stdout.includes("304 Not Modified") ||
				condRes.stdout.includes("HTTP/1.1 304") ||
				condRes.stdout.includes("HTTP/2 304")
			) {
				return Object.assign([...(options.previousIssues ?? [])], {
					etag: options.etag,
					not_modified: true,
				});
			}
			if (condRes.exit_code === 0 && condRes.stdout.trim()) {
				const etagMatch = condRes.stdout.match(/^[Ee][Tt][Aa][Gg]:\s*"?([^"\r\n]+)"?/m);
				if (etagMatch) conditionalEtag = etagMatch[1];
				const parts = condRes.stdout.split(/\r?\n\r?\n/);
				const body = parts.length > 1 ? parts.slice(1).join("\n\n") : parts[0];
				try {
					const raw = JSON.parse(body);
					// If the response payload already contains GraphQL comments array and blockedBy (e.g. in mocks)
					if (
						Array.isArray(raw) &&
						raw.length > 0 &&
						(Array.isArray(raw[0].comments) || Array.isArray(raw[0].blockedBy))
					) {
						const mapped = parseRawIssues(raw);
						return Object.assign(mapped, {
							etag: conditionalEtag ?? `W/"sha256:${createHash("sha256").update(body).digest("hex")}"`,
							not_modified: false,
						});
					}
				} catch {}
			}
		} catch {
			// Fallback to standard issue list if api endpoint not handled by mock
		}
	}

	// Finding 1: Ensure full issue completeness (GraphQL comments array, native blockedBy, parent)
	const res = await gh.run(
		[
			"issue",
			"list",
			"--state",
			"all",
			"--limit",
			"100",
			"--json",
			"id,number,title,body,state,createdAt,updatedAt,author,labels,comments,blockedBy,parent,subIssues",
		],
		{ cwd },
	);

	if (res.exit_code !== 0 || res.timed_out || res.output_exceeded) {
		throw new Error(
			`gh issue list failed (exit ${res.exit_code}): ${res.stderr || (res.timed_out ? "timed out" : "output exceeded")}`,
		);
	}

	if (!res.stdout.trim()) {
		return Object.assign([], { etag: null, not_modified: false });
	}

	const parsed = JSON.parse(res.stdout);
	if (!Array.isArray(parsed)) {
		return Object.assign([], { etag: null, not_modified: false });
	}

	const mapped = parseRawIssues(parsed);
	const computedEtag = conditionalEtag ?? `W/"sha256:${createHash("sha256").update(res.stdout).digest("hex")}"`;
	return Object.assign(mapped, {
		etag: computedEtag,
		not_modified: false,
	});
}

export async function pollPRsFromGithub(
	gh: GhTransport,
	cwd: string,
	options?: {
		etag?: string | null;
		previousPRs?: RawPR[];
	},
): Promise<RawPR[]> {
	// Finding 5: ETag/If-None-Match conditional request
	if (options?.etag) {
		try {
			const condRes = await gh.run(
				[
					"api",
					"repos/{owner}/{repo}/pulls?state=all&per_page=100",
					"-H",
					`If-None-Match: ${options.etag}`,
					"-i",
				],
				{ cwd },
			);
			if (
				condRes.exit_code === 304 ||
				condRes.stdout.includes("304 Not Modified") ||
				condRes.stdout.includes("HTTP/1.1 304") ||
				condRes.stdout.includes("HTTP/2 304")
			) {
				return Object.assign([...(options.previousPRs ?? [])], {
					etag: options.etag,
					not_modified: true,
				});
			}
		} catch {
			// Fallback to standard pr list if api endpoint not handled by mock
		}
	}

	// Finding 4: Request updatedAt in --json field selection
	const res = await gh.run(
		[
			"pr",
			"list",
			"--state",
			"all",
			"--limit",
			"100",
			"--json",
			"number,title,headRefName,headRefOid,baseRefName,state,mergedAt,mergeable,statusCheckRollup,reviews,comments,updatedAt",
		],
		{ cwd },
	);

	if (res.exit_code !== 0 || res.timed_out || res.output_exceeded) {
		throw new Error(
			`gh pr list failed (exit ${res.exit_code}): ${res.stderr || (res.timed_out ? "timed out" : "output exceeded")}`,
		);
	}

	if (!res.stdout.trim()) {
		return Object.assign([], { etag: null, not_modified: false });
	}

	const parsed = JSON.parse(res.stdout);
	if (!Array.isArray(parsed)) {
		return Object.assign([], { etag: null, not_modified: false });
	}

	const mappedPrs: RawPR[] = parsed.map((item: any) => {
		const checks: Array<{
			name: string;
			status: string;
			conclusion: string | null;
			details_url?: string;
		}> = [];

		if (Array.isArray(item.statusCheckRollup)) {
			for (const c of item.statusCheckRollup) {
				checks.push({
					name: c.name || c.context || "unknown-check",
					status: c.status ? c.status.toLowerCase() : "completed",
					conclusion: c.conclusion ? c.conclusion.toLowerCase() : null,
					details_url: c.detailsUrl || c.target_url,
				});
			}
		}

		// Discussion comments on the PR
		const discussionComments = Array.isArray(item.comments)
			? item.comments.map((c: any) => ({
					id: c.id,
					body: c.body || "",
					user: c.author || c.user || { login: "unknown" },
					author_association: c.authorAssociation || c.author_association || "NONE",
					created_at: c.createdAt || c.created_at || new Date().toISOString(),
					updated_at: c.updatedAt || c.updated_at || new Date().toISOString(),
				}))
			: [];

		// Inline review comments on files (if present in payload)
		const reviewComments = Array.isArray(item.review_comments || item.reviewComments)
			? (item.review_comments || item.reviewComments).map((rc: any) => ({
					id: rc.id,
					user: rc.author || rc.user || { login: "unknown" },
					author_association: rc.authorAssociation || rc.author_association || "NONE",
					body: rc.body || "",
					path: rc.path || "",
					line: rc.line,
					created_at: rc.createdAt || rc.created_at || new Date().toISOString(),
					updated_at: rc.updatedAt || rc.updated_at || new Date().toISOString(),
				}))
			: [];

		return {
			number: item.number,
			title: item.title || "",
			head_ref_name: item.headRefName || "",
			head_sha: item.headRefOid || item.head_sha || "sha0000",
			base_ref_name: item.baseRefName || "main",
			state: item.mergedAt
				? "merged"
				: item.state === "CLOSED" || item.state === "closed"
					? "closed"
					: "open",
			merged: Boolean(item.mergedAt),
			mergeable: item.mergeable || "UNKNOWN",
			mergeable_state: item.mergeable_state,
			updated_at: item.updatedAt || item.updated_at,
			merged_at: item.mergedAt || item.merged_at,
			checks,
			reviews: Array.isArray(item.reviews)
				? item.reviews.map((r: any) => ({
						id: r.id,
						user: r.author || r.user || { login: "unknown" },
						author_association: r.authorAssociation || r.author_association || "NONE",
						state: r.state,
						body: r.body || "",
						submitted_at: r.submittedAt || r.submitted_at || new Date().toISOString(),
					}))
				: [],
			comments: discussionComments,
			review_comments: reviewComments,
		};
	});

	// Finding 1: Fetch inline review comments for open PRs at the GitHub polling seam
	for (const pr of mappedPrs) {
		if (
			(!pr.review_comments || pr.review_comments.length === 0) &&
			(pr.state === "open" ||
				pr.head_ref_name.startsWith("imm/") ||
				pr.head_ref_name.startsWith("imm-loop/"))
		) {
			try {
				const commentsRes = await gh.run(
					["api", `repos/{owner}/{repo}/pulls/${pr.number}/comments`],
					{ cwd },
				);
				if (commentsRes.exit_code === 0 && commentsRes.stdout.trim()) {
					const rawComments = JSON.parse(commentsRes.stdout);
					if (Array.isArray(rawComments) && rawComments.length > 0) {
						pr.review_comments = rawComments.map((rc: any) => ({
							id: rc.id,
							user: rc.user || rc.author || { login: "unknown" },
							author_association: rc.author_association || rc.authorAssociation || "NONE",
							body: rc.body || "",
							path: rc.path || "",
							line: rc.line ?? rc.original_line,
							created_at: rc.created_at || rc.createdAt || new Date().toISOString(),
							updated_at: rc.updated_at || rc.updatedAt || new Date().toISOString(),
						}));
					}
				}
			} catch {
				// Best-effort if mock/transport does not implement pulls/:num/comments
			}
		}
	}

	const computedEtag = `W/"sha256:${createHash("sha256").update(res.stdout).digest("hex")}"`;
	return Object.assign(mappedPrs, {
		etag: computedEtag,
		not_modified: false,
	});
}

export function calculateNewWatermarks(
	snapshot: ObservationInput,
	prev: LoopDaemonWatermarks,
): LoopDaemonWatermarks {
	let maxIssues = prev.issues_updated_at;
	let maxComments = prev.comments_updated_at;
	let maxPrs = prev.prs_updated_at;

	for (const issue of snapshot.issues) {
		if (!maxIssues || new Date(issue.updated_at) > new Date(maxIssues)) {
			maxIssues = issue.updated_at;
		}
		for (const comment of issue.comments || []) {
			const ts = comment.updated_at || comment.created_at;
			if (!maxComments || new Date(ts) > new Date(maxComments)) {
				maxComments = ts;
			}
		}
	}

	for (const pr of snapshot.pull_requests) {
		// Finding 2: Advance prs_updated_at from all PR observations
		if (pr.updated_at && (!maxPrs || new Date(pr.updated_at) > new Date(maxPrs))) {
			maxPrs = pr.updated_at;
		}
		if (pr.merged_at && (!maxPrs || new Date(pr.merged_at) > new Date(maxPrs))) {
			maxPrs = pr.merged_at;
		}
		for (const comment of pr.comments || []) {
			const ts = comment.updated_at || comment.created_at;
			if (ts && (!maxPrs || new Date(ts) > new Date(maxPrs))) {
				maxPrs = ts;
			}
		}
		for (const review of pr.reviews || []) {
			const ts = review.submitted_at;
			if (ts && (!maxPrs || new Date(ts) > new Date(maxPrs))) {
				maxPrs = ts;
			}
		}
		for (const rc of pr.review_comments || []) {
			const ts = rc.updated_at || rc.created_at;
			if (!maxPrs || new Date(ts) > new Date(maxPrs)) {
				maxPrs = ts;
			}
		}
	}

	// Finding 5: Record and update ETags in etag_by_resource
	const updatedEtags: Record<string, string> = { ...prev.etag_by_resource };
	if ((snapshot.issues as any)?.etag) {
		updatedEtags.issues = (snapshot.issues as any).etag;
	}
	if ((snapshot.pull_requests as any)?.etag) {
		updatedEtags.pull_requests = (snapshot.pull_requests as any).etag;
	}

	return {
		issues_updated_at: maxIssues,
		comments_updated_at: maxComments,
		prs_updated_at: maxPrs,
		etag_by_resource: updatedEtags,
	};
}

export async function observeGithub(
	root: string,
	options?: {
		gh?: GhTransport;
		previousState?: LoopDaemonState | null;
		snapshotOverride?: ObservationInput;
	},
): Promise<ObservationResult> {
	const gh = options?.gh ?? createGhTransport();
	const prev = options?.previousState?.watermarks ?? {
		issues_updated_at: null,
		comments_updated_at: null,
		prs_updated_at: null,
		etag_by_resource: {},
	};

	let snapshot: ObservationInput;
	if (options?.snapshotOverride) {
		snapshot = options.snapshotOverride;
	} else {
		const [issues, pull_requests] = await Promise.all([
			pollIssuesFromGithub(gh, root, {
				etag: prev.etag_by_resource?.issues,
			}),
			pollPRsFromGithub(gh, root, {
				etag: prev.etag_by_resource?.pull_requests,
			}),
		]);
		const lane_decisions = scanLocalLaneDecisions(root);

		snapshot = {
			issues,
			pull_requests,
			lane_decisions,
			observed_at: new Date().toISOString(),
		};
	}

	const events = normalizeEvents(snapshot, options?.previousState ?? null);
	const watermarks = calculateNewWatermarks(snapshot, prev);

	return {
		events,
		watermarks,
		snapshot,
	};
}
