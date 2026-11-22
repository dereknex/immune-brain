/**
 * Test helper: a minimal active `v3` Lane batch record for the loop leader's
 * batch lookups (ULS D5.1/D5.4). Written where the batch store reads it, with
 * optional per-child session facts. Exit condition: none; shared by the leader
 * replan and briefing tests.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { batchStatePath } from "../../plugins/immune-brain/runtime/kernel/storage_paths.ts";

export interface SeedChild {
	task_id: string;
	state?: "pending" | "enrolled" | "needs_human";
	/** An `enrolled` child needs a Lane binding to pass the batch-state validation; a default is supplied. */
	lane?: { path: string; branch: string; base_head: string; lane_commit: string | null } | null;
	reason?: string | null;
	session?: { generation: number; no_progress: number; attention: string | null; entry_submitted: boolean };
}

export function seedLaneBatch(
	root: string,
	batchId: string,
	children: SeedChild[],
	options: { batch_state?: string; initiative_slug?: string; now: string } = { now: "2026-11-17T10:00:00.000Z" },
): void {
	const slug = options.initiative_slug ?? "widget-initiative";
	const record = {
		contract: "assurance_kernel/batch_run_state/v3",
		batch_id: batchId,
		initiative_slug: slug,
		base_head: "deadbeef",
		branch: `imm/${slug}`,
		plan_digest: "sha256:plan",
		confirmation_time: options.now,
		batch_state: options.batch_state ?? "running",
		max_parallel: 1,
		children: children.map((child) => ({
			task_id: child.task_id,
			slice_id: child.task_id,
			state: child.state ?? "pending",
			commit: null,
			blocked_by: [],
			reason: child.reason ?? null,
			qa_failures: 0,
			lane:
				child.lane !== undefined
					? child.lane
					: child.state === "enrolled"
						? { path: join(root, ".imm/lanes", child.task_id), branch: `imm-lane/${child.task_id}`, base_head: "deadbeef", lane_commit: null }
						: null,
			...(child.session
				? {
						session: {
							key: null,
							baseline: null,
							handle: null,
							exit_proof: null,
							...child.session,
						},
					}
				: {}),
		})),
		commits: [],
		consecutive_qa_failures: 0,
		budget: { max_children: children.length, qa_failure_limit: 2 },
		created_at: options.now,
		updated_at: options.now,
	};
	const path = join(root, batchStatePath(batchId));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}
