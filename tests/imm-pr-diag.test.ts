import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../plugins/immune-brain/bin/imm-pr-diag");
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const comment = (id: string, body = "Please fix") => ({
	id, url: `https://github.com/upstream/project/pull/42#${id}`,
	author: { login: "reviewer" }, body, createdAt: "2026-01-01", updatedAt: "2026-01-01",
});
const thread = (overrides = {}) => ({
	id: "thread-1", path: "src/index.ts", line: 4, startLine: null,
	isResolved: false, isOutdated: true, viewerCanResolve: true,
	comments: { nodes: [comment("comment-1"), comment("comment-2", "Withdrawn; no change needed")], totalCount: 2 },
	...overrides,
});
const review = (id: number, state: string, author = "reviewer") => ({
	id, user: { login: author }, state, body: "Summary-only request",
	html_url: `https://github.com/upstream/project/pull/42#review-${id}`,
	submitted_at: `2026-01-0${id}`, commit_id: "baseline-sha",
});
function fixture(overrides: Record<string, unknown> = {}) {
	return {
		pr: {
			number: 42, headRefName: "fix", headRefOid: "baseline-sha",
			headRepository: { name: "fork" }, headRepositoryOwner: { login: "contributor" },
			baseRefName: "main", url: "https://github.com/upstream/project/pull/42",
			mergeable: "MERGEABLE",
		},
		checks: [], checksExit: 0, reviews: [[]], comments: [[]],
		threads: [{ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }],
		...overrides,
	};
}
function run(data: ReturnType<typeof fixture>) {
	const root = mkdtempSync(join(tmpdir(), "imm-pr-diag-"));
	roots.push(root);
	writeFileSync(join(root, "fixture.json"), JSON.stringify(data));
	writeFileSync(join(root, "gh"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + "\\n");
const f = JSON.parse(fs.readFileSync(process.env.FIXTURE, "utf8"));
let key;
if (args[0] === "pr" && args[1] === "view") key = "pr";
else if (args[0] === "pr" && args[1] === "checks") key = "checks";
else if (args[0] === "api") {
  if (!args.includes("--paginate") || !args.includes("--slurp")) throw Error("pagination missing");
  if (!args.includes("--hostname") || !args.includes("github.com")) throw Error("host missing");
  if (args.some(a => a.endsWith("/reviews"))) key = "reviews";
  else if (args.some(a => a.endsWith("/comments"))) key = "comments";
  else if (args.some(a => a.startsWith("id="))) key = "discussion";
  else key = "threads";
} else throw Error("unexpected command: " + args.join(" "));
if (f.fail === key) { console.error("fixture query failed: " + key); process.exit(1); }
console.log(JSON.stringify(f[key]));
process.exit(key === "checks" ? f.checksExit : 0);
`, { mode: 0o755 });
	const callsPath = join(root, "calls.jsonl");
	const result = Bun.spawnSync(["sh", script, "https://github.com/upstream/project/pull/42"], {
		env: { ...process.env, PATH: `${root}:${process.env.PATH}`, FIXTURE: join(root, "fixture.json"), CALLS: callsPath },
	});
	return {
		code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString(),
		calls: readFileSync(callsPath, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]),
	};
}
function success(data: ReturnType<typeof fixture>) {
	const result = run(data);
	expect(result.code, result.stderr).toBe(0);
	return { report: JSON.parse(result.stdout), calls: result.calls };
}

describe("imm-pr-diag", () => {
	test("pins queries to the PR repository and preserves fork/head identity", () => {
		const { report, calls } = success(fixture());
		expect(report.pr_target).toMatchObject({ repository: "upstream/project", head_repository: "contributor/fork", head_sha: "baseline-sha" });
		expect(calls.find(a => a[1] === "checks")).toContain("github.com/upstream/project");
		expect(calls.some(a => a.includes("repos/upstream/project/pulls/42/reviews"))).toBe(true);
		expect(calls.some(a => a.includes("repos/upstream/project/issues/42/comments"))).toBe(true);
		const graph = calls.find(a => a.includes("owner=upstream"));
		expect(graph).toContain("repo=project");
		expect(graph).toContain("pr=42");
		expect(calls.some(a => a[0] === "repo")).toBe(false);
	});

	test("summary-only requests count; later COMMENTED does not revoke them", () => {
		const { report } = success(fixture({ reviews: [[review(1, "CHANGES_REQUESTED")], [review(2, "COMMENTED")]] }));
		expect(report.reviews).toHaveLength(2);
		expect(report.reviews[0]).toMatchObject({ id: 1, author: "reviewer", body: "Summary-only request" });
		expect(report.blocker_summary.pending_feedback_count).toBe(1);
		expect(report.blocker_summary.pending_thread_count).toBe(0);
		expect(report.blocker_summary.changes_requested_review_ids).toEqual([1]);
		expect(report.blocker_summary.blocker_categories).toEqual(["feedback_repair"]);
	});

	test.each(["APPROVED", "DISMISSED"])("a later %s decision supersedes the request", state => {
		const { report } = success(fixture({ reviews: [[review(1, "CHANGES_REQUESTED"), review(2, state)]] }));
		expect(report.blocker_summary.changes_requested_review_ids).toEqual([]);
		expect(report.blocker_summary.blocker_categories).toEqual([]);
	});

	test("keeps full discussions, stable identifiers and ordinary comments without auto-classifying comments", () => {
		const { report } = success(fixture({
			threads: [{ data: { repository: { pullRequest: { reviewThreads: { nodes: [thread()] } } } } }],
			comments: [[{ id: 3, user: { login: "author" }, html_url: "comment-url", body: "FYI" }]],
		}));
		expect(report.review_threads[0]).toMatchObject({ id: "thread-1", isOutdated: true, viewerCanResolve: true });
		expect(report.review_threads[0].comments[1]).toMatchObject({ body: "Withdrawn; no change needed", url: expect.any(String) });
		expect(report.comments[0]).toMatchObject({ id: 3, author: "author", url: "comment-url" });
		expect(report.blocker_summary.pending_feedback_count).toBe(1);
		const commentsOnly = success(fixture({ comments: [[{ id: 3, body: "FYI" }]] })).report;
		expect(commentsOnly.blocker_summary.blocker_categories).toEqual([]);
	});

	test("paginates both threads and long discussions independently", () => {
		const pages = [0, 1].map(i => ({ data: { repository: { pullRequest: { reviewThreads: {
			nodes: [thread({ id: `thread-${i}`, comments: { nodes: [], totalCount: i === 0 ? 101 : 0 } })],
		} } } } }));
		const discussion = [0, 1].map(i => ({ data: { node: { comments: { nodes: [comment(`page-${i}`)] } } } }));
		const { report, calls } = success(fixture({ threads: pages, discussion }));
		expect(report.review_threads).toHaveLength(2);
		expect(report.review_threads[0].comments.map((c: { id: string }) => c.id)).toEqual(["page-0", "page-1"]);
		expect(calls.filter(a => a.includes("id=thread-0"))).toHaveLength(1);
	});

	test("reports pending CI and unknown mergeability rather than false success", () => {
		const data = fixture({ checks: [{ name: "build", bucket: "pending", state: "IN_PROGRESS" }], checksExit: 8 });
		data.pr.mergeable = "UNKNOWN";
		const { report } = success(data);
		expect(report.conflicts).toMatchObject({ has_conflicts: null, conflicting_files_status: "unknown" });
		expect(report.blocker_summary).toMatchObject({ pending_checks: ["build"], mergeability_unknown: true, has_merge_conflicts: null });
		expect(report.blocker_summary.blocker_categories).toEqual([]);
	});

	test("still classifies failed checks and confirmed conflicts", () => {
		const data = fixture({ checks: [{ name: "build", bucket: "fail", state: "FAILURE" }], checksExit: 1 });
		data.pr.mergeable = "CONFLICTING";
		const { report } = success(data);
		expect(report.conflicts).toMatchObject({ has_conflicts: true, conflicting_files_status: "unknown", conflicting_files: [] });
		expect(report.blocker_summary.blocker_categories).toEqual(["check_repair", "conflict_repair"]);
	});

	test.each(["reviews", "comments", "threads", "checks", "discussion"])("%s query failure produces no success report", fail => {
		const data = fixture({ fail });
		if (fail === "discussion") data.threads = [{ data: { repository: { pullRequest: { reviewThreads: { nodes: [thread({ comments: { nodes: [], totalCount: 101 } })] } } } } }];
		const result = run(data);
		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("failed");
	});

	test("an error response with the failed-check exit code is still a query failure", () => {
		const result = run(fixture({ checks: { message: "permission denied" }, checksExit: 1 }));
		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("failed to fetch PR checks");
	});

	test("a partial GraphQL error is not silently treated as zero threads", () => {
		const result = run(fixture({ threads: [{ data: { repository: { pullRequest: null } }, errors: [{ message: "denied" }] }] }));
		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("incomplete review thread response");
	});
});
