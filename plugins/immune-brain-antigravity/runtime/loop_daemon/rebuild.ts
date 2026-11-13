/**
 * Loop Daemon: State Rebuild Mechanism (S1)
 *
 * Implements S1 and D2 of docs/specs/loop-daemon.spec.md.
 * If .imm/state/loop/state.json is deleted or corrupt, rebuildLoopState() reconstructs
 * watermarks and active leases from GitHub fixtures/API, open branches, and .imm/runs/*
 * without re-dispatching active work.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import type { GhTransport } from "../github_issue_tracker.ts";
import { createGhTransport } from "../github_issue_tracker.ts";
import { pollIssuesFromGithub, pollPRsFromGithub } from "./observer.ts";
import { ensureLoopStateDir, saveLease, saveLoopState } from "./state.ts";
import {
	LOOP_DAEMON_LEASE_CONTRACT,
	LOOP_DAEMON_STATE_CONTRACT,
	type LoopDaemonState,
	type LoopDaemonWatermarks,
	type LoopLease,
	type ObservationInput,
} from "./types.ts";

export interface RebuildResult {
	state: LoopDaemonState;
	reconstructedLeases: LoopLease[];
}

export function listLocalBranches(root: string): string[] {
	try {
		const out = execFileSync("git", ["branch", "--list", "imm/*", "imm-loop/*"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out
			.split("\n")
			.map((b) => b.replace(/^\*?\s+/, "").trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export async function rebuildLoopState(
	root: string,
	options?: {
		gh?: GhTransport;
		stateDir?: string;
		fixtureSnapshot?: ObservationInput;
	},
): Promise<RebuildResult> {
	const stateDir = options?.stateDir ?? join(root, ".imm/state/loop");
	ensureLoopStateDir(stateDir);

	const reconstructedLeasesMap = new Map<string, LoopLease>();
	const now = new Date().toISOString();

	// 1. Scan .imm/runs/* for active runs and leases
	const runsDir = join(root, ".imm/runs");
	if (existsSync(runsDir)) {
		try {
			const entries = readdirSync(runsDir);
			for (const entry of entries) {
				const runDir = join(runsDir, entry);
				const runJsonPath = join(runDir, "run.json");
				const taskRecordPath = join(runDir, "task-record.json");

				const chosenPath = existsSync(runJsonPath)
					? runJsonPath
					: existsSync(taskRecordPath)
						? taskRecordPath
						: null;

				if (!chosenPath) continue;

				try {
					const raw = readFileSync(chosenPath, "utf8");
					const parsed = JSON.parse(raw) as Record<string, any>;
					const isActive =
						parsed.lifecycle === "active" ||
						parsed.artifact_state === "active" ||
						parsed.status === "active";

					if (isActive) {
						const taskId = parsed.task_id || entry;
						const hasDecisions =
							(typeof parsed.open_user_decision_count === "number" &&
								parsed.open_user_decision_count > 0) ||
							Boolean(parsed.lane_decision_facts || parsed.laneDecisionFacts);

						const lease: LoopLease = {
							contract: LOOP_DAEMON_LEASE_CONTRACT,
							target_id: taskId,
							kind: "drive",
							owner_pid: process.pid,
							host_token: "reconstructed",
							worktree_path: parsed.worktree_path || undefined,
							scope_hint: Array.isArray(parsed.scope_hint) ? parsed.scope_hint : [],
							acquired_at: parsed.created_at || now,
							heartbeat_at: now,
							status: hasDecisions ? "parked_for_decision" : "active",
						};
						reconstructedLeasesMap.set(taskId, lease);
					}
				} catch {}
			}
		} catch {}
	}

	// 2. Scan open branches (imm/* and imm-loop/*)
	const branches = listLocalBranches(root);
	for (const branch of branches) {
		if (branch.startsWith("imm-loop/")) {
			const issuePart = branch.slice("imm-loop/".length);
			const targetId = issuePart.startsWith("issue-") ? issuePart : `issue-${issuePart}`;
			if (!reconstructedLeasesMap.has(targetId)) {
				reconstructedLeasesMap.set(targetId, {
					contract: LOOP_DAEMON_LEASE_CONTRACT,
					target_id: targetId,
					kind: "plan",
					owner_pid: process.pid,
					host_token: "reconstructed",
					acquired_at: now,
					heartbeat_at: now,
					status: "active",
				});
			}
		} else if (branch.startsWith("imm/")) {
			const slug = branch.slice("imm/".length);
			if (!reconstructedLeasesMap.has(slug)) {
				reconstructedLeasesMap.set(slug, {
					contract: LOOP_DAEMON_LEASE_CONTRACT,
					target_id: slug,
					kind: "drive",
					owner_pid: process.pid,
					host_token: "reconstructed",
					acquired_at: now,
					heartbeat_at: now,
					status: "active",
				});
			}
		}
	}

	// 3. Scan GitHub Issues & PRs for markers and watermarks
	let maxIssues: string | null = null;
	let maxComments: string | null = null;
	let maxPrs: string | null = null;

	let issues = options?.fixtureSnapshot?.issues;
	let prs = options?.fixtureSnapshot?.pull_requests;

	if (!issues || !prs) {
		const gh = options?.gh ?? createGhTransport();
		if (!issues) issues = await pollIssuesFromGithub(gh, root);
		if (!prs) prs = await pollPRsFromGithub(gh, root);
	}

	for (const issue of issues || []) {
		if (!maxIssues || new Date(issue.updated_at) > new Date(maxIssues)) {
			maxIssues = issue.updated_at;
		}
		for (const c of issue.comments || []) {
			const ts = c.updated_at || c.created_at;
			if (!maxComments || new Date(ts) > new Date(maxComments)) {
				maxComments = ts;
			}
		}

		// Check if open issue has active task lease
		const taskMatch = (issue.body || "").match(/<!--\s*immune-brain:task-id=([a-zA-Z0-9._-]+)\s*-->/);
		if (taskMatch && issue.state === "open") {
			const taskId = taskMatch[1];
			if (!reconstructedLeasesMap.has(taskId)) {
				// If issue is marked in progress or ready
				const labels = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
				if (labels.includes("in-progress") || labels.includes("imm:running")) {
					reconstructedLeasesMap.set(taskId, {
						contract: LOOP_DAEMON_LEASE_CONTRACT,
						target_id: taskId,
						kind: "drive",
						owner_pid: process.pid,
						host_token: "reconstructed",
						acquired_at: issue.updated_at,
						heartbeat_at: now,
						status: "active",
					});
				}
			}
		}
	}

	for (const pr of prs || []) {
		// Finding 4: Reconstruct active leases from open daemon PRs (remote or local)
		if (pr.state === "open") {
			const branch = pr.head_ref_name || "";
			const taskMatch = (pr.title + "\n" + (pr.comments?.map((c) => c.body).join("\n") || "")).match(
				/<!--\s*immune-brain:task-id=([a-zA-Z0-9._-]+)\s*-->/,
			);
			let targetId: string | null = null;
			let leaseKind: LoopLease["kind"] = "drive";

			if (taskMatch) {
				targetId = taskMatch[1];
			} else if (branch.startsWith("imm-loop/")) {
				const issuePart = branch.slice("imm-loop/".length);
				targetId = issuePart.startsWith("issue-") ? issuePart : `issue-${issuePart}`;
				leaseKind = "plan";
			} else if (branch.startsWith("imm/")) {
				targetId = branch.slice("imm/".length);
				leaseKind = "drive";
			}

			if (targetId && !reconstructedLeasesMap.has(targetId)) {
				reconstructedLeasesMap.set(targetId, {
					contract: LOOP_DAEMON_LEASE_CONTRACT,
					target_id: targetId,
					kind: leaseKind,
					owner_pid: process.pid,
					host_token: "reconstructed",
					acquired_at: pr.updated_at || now,
					heartbeat_at: now,
					status: "active",
				});
			}
		}

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

	const reconstructedLeases = Array.from(reconstructedLeasesMap.values());
	const activeLeasesRecord: Record<string, LoopLease> = {};
	for (const lease of reconstructedLeases) {
		activeLeasesRecord[lease.target_id] = lease;
		saveLease(stateDir, lease);
	}

	const reconstructedEtags: Record<string, string> = {};
	if ((issues as any)?.etag) reconstructedEtags.issues = (issues as any).etag;
	if ((prs as any)?.etag) reconstructedEtags.pull_requests = (prs as any).etag;

	const watermarks: LoopDaemonWatermarks = {
		issues_updated_at: maxIssues,
		comments_updated_at: maxComments,
		prs_updated_at: maxPrs,
		etag_by_resource: reconstructedEtags,
	};

	const state: LoopDaemonState = {
		contract: LOOP_DAEMON_STATE_CONTRACT,
		updated_at: now,
		watermarks,
		active_leases: activeLeasesRecord,
		paused: false,
		pause_reason: null,
		stats: {
			ticks_total: 0,
			events_observed_total: 0,
			last_tick_at: now,
		},
	};

	saveLoopState(stateDir, state);

	return {
		state,
		reconstructedLeases,
	};
}
