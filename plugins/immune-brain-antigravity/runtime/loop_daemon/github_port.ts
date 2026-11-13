/**
 * Loop Daemon: GitHub Write Port (S8)
 *
 * Implements S8 and D10 item 5 of docs/specs/loop-daemon.spec.md.
 * One GitHub write port (built on the observer's gh invocation seam, with a fake in tests)
 * backs:
 *   - escalate (planEscalation() -> create or edit by key)
 *   - relay_lane_decision_question and apply_lane_decision_reply (decision_relay.ts)
 *   - open_pr (openLoopPullRequest())
 *   - mark_pr_ready and close_out (repair_agent.ts)
 *   - status Issue in-place update (planStatusIssue())
 */

import type { GhTransport } from "../github_issue_tracker.ts";
import type { LoopPullRequestPort } from "./pr_opener.ts";

export interface CommentWriteResult {
	id: number;
	url?: string;
}

export interface IssueWriteResult {
	number: number;
	url: string;
}

export interface PrReadyResult {
	success: boolean;
	error?: string;
}

export interface LoopGitHubPort extends LoopPullRequestPort {
	postComment(issueNumber: number, body: string): Promise<CommentWriteResult>;
	editComment(commentId: number, body: string): Promise<CommentWriteResult>;
	createIssue(title: string, body: string): Promise<IssueWriteResult>;
	editIssue(issueNumber: number, body: string): Promise<IssueWriteResult>;
	markPrReady(prNumber: number): Promise<PrReadyResult>;
}

export function createLoopGitHubPort(gh: GhTransport, cwd: string): LoopGitHubPort {
	return {
		async postComment(issueNumber: number, body: string): Promise<CommentWriteResult> {
			const res = await gh.run(["api", `repos/{owner}/{repo}/issues/${issueNumber}/comments`, "-f", `body=${body}`], { cwd });
			if (res.exit_code !== 0) {
				throw new Error(`Failed to post comment on issue #${issueNumber}: ${res.stderr || `exit code ${res.exit_code}`}`);
			}
			try {
				const data = JSON.parse(res.stdout);
				return { id: data.id ?? 0, url: data.html_url };
			} catch {
				return { id: 0 };
			}
		},

		async editComment(commentId: number, body: string): Promise<CommentWriteResult> {
			const res = await gh.run(["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${commentId}`, "-f", `body=${body}`], { cwd });
			if (res.exit_code !== 0) {
				throw new Error(`Failed to edit comment #${commentId}: ${res.stderr || `exit code ${res.exit_code}`}`);
			}
			try {
				const data = JSON.parse(res.stdout);
				return { id: data.id ?? commentId, url: data.html_url };
			} catch {
				return { id: commentId };
			}
		},

		async createIssue(title: string, body: string): Promise<IssueWriteResult> {
			const res = await gh.run(["api", "repos/{owner}/{repo}/issues", "-f", `title=${title}`, "-f", `body=${body}`], { cwd });
			if (res.exit_code !== 0) {
				throw new Error(`Failed to create issue '${title}': ${res.stderr || `exit code ${res.exit_code}`}`);
			}
			const data = JSON.parse(res.stdout);
			return { number: data.number, url: data.html_url || "" };
		},

		async editIssue(issueNumber: number, body: string): Promise<IssueWriteResult> {
			const res = await gh.run(["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/${issueNumber}`, "-f", `body=${body}`], { cwd });
			if (res.exit_code !== 0) {
				throw new Error(`Failed to edit issue #${issueNumber}: ${res.stderr || `exit code ${res.exit_code}`}`);
			}
			const data = JSON.parse(res.stdout);
			return { number: data.number ?? issueNumber, url: data.html_url || "" };
		},

		async upsert(input: {
			head: string;
			base: string;
			title: string;
			body: string;
			draft: boolean;
		}): Promise<{ number: number; url: string; created: boolean }> {
			const listRes = await gh.run(["pr", "list", "--head", input.head, "--json", "number,url"], { cwd });
			if (listRes.exit_code === 0 && listRes.stdout.trim()) {
				try {
					const existing = JSON.parse(listRes.stdout);
					if (Array.isArray(existing) && existing.length > 0 && existing[0]?.number) {
						const pr = existing[0];
						await gh.run(["pr", "edit", String(pr.number), "--title", input.title, "--body", input.body], { cwd });
						return { number: pr.number, url: pr.url || "", created: false };
					}
				} catch {}
			}

			const args = [
				"pr",
				"create",
				"--head",
				input.head,
				"--base",
				input.base,
				"--title",
				input.title,
				"--body",
				input.body,
			];
			if (input.draft) args.push("--draft");
			const createRes = await gh.run(args, { cwd });
			if (createRes.exit_code !== 0) {
				throw new Error(`Failed to create PR for ${input.head}: ${createRes.stderr || `exit code ${createRes.exit_code}`}`);
			}
			const url = createRes.stdout.trim();
			const match = url.match(/\/pull\/(\d+)/);
			const number = match ? parseInt(match[1], 10) : 0;
			return { number, url, created: true };
		},

		async markPrReady(prNumber: number): Promise<PrReadyResult> {
			const res = await gh.run(["pr", "ready", String(prNumber)], { cwd });
			if (res.exit_code !== 0) {
				return { success: false, error: res.stderr || `exit code ${res.exit_code}` };
			}
			return { success: true };
		},
	};
}

export interface FakeRecordedCall {
	method: string;
	args: unknown[];
}

export interface FakeLoopGitHubPort extends LoopGitHubPort {
	calls: FakeRecordedCall[];
	comments: Map<number, { id: number; issueNumber: number; body: string }>;
	issues: Map<number, { number: number; title: string; body: string }>;
	prs: Map<number, { number: number; head: string; base: string; title: string; body: string; draft: boolean }>;
	nextCommentId: number;
	nextIssueNumber: number;
}

export function createFakeLoopGitHubPort(): FakeLoopGitHubPort {
	const calls: FakeRecordedCall[] = [];
	const comments = new Map<number, { id: number; issueNumber: number; body: string }>();
	const issues = new Map<number, { number: number; title: string; body: string }>();
	const prs = new Map<number, { number: number; head: string; base: string; title: string; body: string; draft: boolean }>();
	let nextCommentId = 1000;
	let nextIssueNumber = 500;

	return {
		calls,
		comments,
		issues,
		prs,
		get nextCommentId() {
			return nextCommentId;
		},
		set nextCommentId(v: number) {
			nextCommentId = v;
		},
		get nextIssueNumber() {
			return nextIssueNumber;
		},
		set nextIssueNumber(v: number) {
			nextIssueNumber = v;
		},

		async postComment(issueNumber: number, body: string): Promise<CommentWriteResult> {
			calls.push({ method: "postComment", args: [issueNumber, body] });
			const id = nextCommentId++;
			comments.set(id, { id, issueNumber, body });
			return { id, url: `https://github.com/example/repo/issues/${issueNumber}#issuecomment-${id}` };
		},

		async editComment(commentId: number, body: string): Promise<CommentWriteResult> {
			calls.push({ method: "editComment", args: [commentId, body] });
			const existing = comments.get(commentId);
			if (existing) {
				existing.body = body;
			} else {
				comments.set(commentId, { id: commentId, issueNumber: 0, body });
			}
			return { id: commentId, url: `https://github.com/example/repo/issues/comments/${commentId}` };
		},

		async createIssue(title: string, body: string): Promise<IssueWriteResult> {
			calls.push({ method: "createIssue", args: [title, body] });
			const number = nextIssueNumber++;
			issues.set(number, { number, title, body });
			return { number, url: `https://github.com/example/repo/issues/${number}` };
		},

		async editIssue(issueNumber: number, body: string): Promise<IssueWriteResult> {
			calls.push({ method: "editIssue", args: [issueNumber, body] });
			const existing = issues.get(issueNumber);
			if (existing) {
				existing.body = body;
			} else {
				issues.set(issueNumber, { number: issueNumber, title: "", body });
			}
			return { number: issueNumber, url: `https://github.com/example/repo/issues/${issueNumber}` };
		},

		async upsert(input: {
			head: string;
			base: string;
			title: string;
			body: string;
			draft: boolean;
		}): Promise<{ number: number; url: string; created: boolean }> {
			calls.push({ method: "upsert", args: [input] });
			for (const pr of prs.values()) {
				if (pr.head === input.head) {
					pr.title = input.title;
					pr.body = input.body;
					return { number: pr.number, url: `https://github.com/example/repo/pull/${pr.number}`, created: false };
				}
			}
			const number = nextIssueNumber++;
			prs.set(number, { number, ...input });
			return { number, url: `https://github.com/example/repo/pull/${number}`, created: true };
		},

		async markPrReady(prNumber: number): Promise<PrReadyResult> {
			calls.push({ method: "markPrReady", args: [prNumber] });
			const existing = prs.get(prNumber);
			if (existing) existing.draft = false;
			return { success: true };
		},
	};
}
