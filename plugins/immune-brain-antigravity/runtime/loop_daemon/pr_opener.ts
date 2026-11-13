/**
 * Loop Daemon: Pull Request Opening (S5)
 *
 * Implements D5.3 of docs/specs/loop-daemon.spec.md (BR-SCN-2). Once a Lane has
 * settled, the daemon opens — or updates — one pull request on the task's own
 * branch, so re-entering after a lost response converges on the same PR instead
 * of opening a second one. The body carries the routing marker, the Issue it
 * closes, the verification summary and the risk classification. Merging stays
 * human-only in every posture (ADR 0039 Decision 11), so a non-routine PR is
 * opened as a draft.
 */

import type { TaskRisk } from "../kernel/types.ts";

export const LOOP_PR_MARKER = "<!-- immune-brain:kind=loop-pr -->";

/** The branch a solved task's work lands on. */
export function prBranchName(slug: string): string {
	return `imm/${slug}`;
}

export interface LoopPullRequestBodyInput {
	task_id: string;
	issue_number: number;
	risk: TaskRisk;
	verification_summary: string;
}

/** The canonical PR body: routing marker, closing reference, verification, risk. */
export function loopPullRequestBody(input: LoopPullRequestBodyInput): string {
	return [
		LOOP_PR_MARKER,
		"",
		`Closes #${input.issue_number}`,
		"",
		`- **Task**: \`${input.task_id}\``,
		`- **Risk**: ${input.risk}`,
		"",
		"## Verification",
		"",
		input.verification_summary.trim(),
		"",
	].join("\n");
}

export interface LoopPullRequestRequest extends LoopPullRequestBodyInput {
	slug: string;
	base: string;
	title: string;
	/** Draft unless the caller says otherwise; a non-routine delivery is a draft by default. */
	draft?: boolean;
}

export interface LoopPullRequestPort {
	/** Create the PR for this branch, or update the existing one. */
	upsert(input: {
		head: string;
		base: string;
		title: string;
		body: string;
		draft: boolean;
	}): Promise<{ number: number; url: string; created: boolean }>;
}

export interface OpenedLoopPullRequest {
	branch: string;
	body: string;
	draft: boolean;
	number: number;
	url: string;
	created: boolean;
}

/**
 * Open or update the task's PR. The branch name and body are derived here, so
 * the marker and the closing reference cannot drift between the two call sites.
 */
export async function openLoopPullRequest(
	request: LoopPullRequestRequest,
	port: LoopPullRequestPort,
): Promise<OpenedLoopPullRequest> {
	const branch = prBranchName(request.slug);
	const body = loopPullRequestBody(request);
	const draft = request.draft ?? request.risk !== "routine";
	const opened = await port.upsert({
		head: branch,
		base: request.base,
		title: request.title,
		body,
		draft,
	});
	return { branch, body, draft, ...opened };
}
