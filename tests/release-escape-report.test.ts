// Release-escape metric (Spec e2e-release-gate D10, S10-AC2): fix and repair commits and bug Issues
// within 7 days after a release tag are attributed to that version; later fixes are not counted.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASELINE, buildReport, type CommitRecord, parseArgs, readCommits, readTags, renderReport, tagsInRange } from "../scripts/release-escape-report";

const tag = (version: string, date: string) => ({ version, date: `${date}T00:00:00.000Z` });
const commit = (subject: string, date: string, extra: Partial<CommitRecord> = {}): CommitRecord => ({ sha: `${subject.length}${date}`.padEnd(40, "0"), date: `${date}T12:00:00.000Z`, subject, ...extra });
const NOW = "2026-03-01T00:00:00.000Z";
const TAGS = [tag("1.0.0", "2026-01-01"), tag("1.1.0", "2026-01-20")];
const counts = (report: ReturnType<typeof buildReport>) => Object.fromEntries(report.rows.map((row) => [row.version, [row.commits.length, row.issues.length]]));

describe("buildReport", () => {
	test("counts fix and repair commits within 7 days after a tag, attributed to that version", () => {
		const report = buildReport({
			tags: TAGS,
			commits: [commit("fix(review): receipts", "2026-01-03"), commit("repair: stale cache", "2026-01-07"), commit("Fix: capitalised subject", "2026-01-06"), commit("fix: after the next tag", "2026-01-22")],
			issues: [],
			now: NOW,
		});
		expect(counts(report)).toEqual({ "1.0.0": [3, 0], "1.1.0": [1, 0] });
	});

	test("a fix after the 7-day window is not counted", () => {
		const report = buildReport({ tags: [tag("1.0.0", "2026-01-01")], commits: [commit("fix: just late", "2026-01-09"), commit("fix: much later", "2026-02-10")], issues: [], now: NOW });
		expect(counts(report)).toEqual({ "1.0.0": [0, 0] });
	});

	test("a commit before the tag, and non-fix subjects, are not counted", () => {
		const report = buildReport({
			tags: [tag("1.0.0", "2026-01-01")],
			commits: [commit("fix: before the release", "2025-12-30"), commit("feat: new", "2026-01-02"), commit("fixture: rename", "2026-01-02"), commit("chore: version packages", "2026-01-02"), commit("prefix: fix inside", "2026-01-02")],
			issues: [],
			now: NOW,
		});
		expect(counts(report)).toEqual({ "1.0.0": [0, 0] });
	});

	test("an unlabeled fix belongs to the newest tag before it, not every open window", () => {
		const report = buildReport({ tags: [tag("1.0.0", "2026-01-01"), tag("1.0.1", "2026-01-03")], commits: [commit("fix: x", "2026-01-04")], issues: [], now: NOW });
		expect(counts(report)).toEqual({ "1.0.0": [0, 0], "1.0.1": [1, 0] });
	});

	test("Fixes-release in a commit body or a changeset names the version it fixes", () => {
		const report = buildReport({
			tags: [tag("1.0.0", "2026-01-01"), tag("1.0.1", "2026-01-03")],
			commits: [
				commit("chore: patch", "2026-01-04", { body: "Details\nFixes-release: 1.0.0\n" }),
				commit("docs: note", "2026-01-05", { changesets: ["---\n\"immune-brain\": patch\n---\n\nFixes-release: v1.0.0\n"] }),
				commit("fix: late declared", "2026-01-20", { body: "Fixes-release: 1.0.0" }),
			],
			issues: [],
			now: NOW,
		});
		expect(counts(report)).toEqual({ "1.0.0": [2, 0], "1.0.1": [0, 0] });
	});

	test("closed bug issues within the window count and later ones do not; a missing Issue source is reported, not zeroed", () => {
		const issues = [{ number: 7, title: "in window", closedAt: "2026-01-05T00:00:00Z" }, { number: 8, title: "too late", closedAt: "2026-01-12T00:00:00Z" }];
		const report = buildReport({ tags: [tag("1.0.0", "2026-01-01")], commits: [], issues, now: NOW });
		expect(report.rows[0].issues.map((issue) => issue.number)).toEqual([7]);
		const unavailable = buildReport({ tags: [tag("1.0.0", "2026-01-01")], commits: [], issues: null, now: NOW });
		expect(unavailable.issuesIncluded).toBe(false);
	});

	test("a window that has not closed at now is marked open", () => {
		const report = buildReport({ tags: [tag("1.0.0", "2026-02-27")], commits: [], issues: [], now: NOW });
		expect(report.rows[0].open).toBe(true);
		expect(buildReport({ tags: [tag("1.0.0", "2026-01-01")], commits: [], issues: [], now: NOW }).rows[0].open).toBe(false);
	});
});

describe("renderReport", () => {
	test("prints the baseline table with per-version counts, a total and the attributed items", () => {
		const report = buildReport({
			tags: [tag("8.6.0", "2026-01-01"), tag("9.0.0", "2026-01-10")],
			commits: [commit("fix: one", "2026-01-02"), commit("fix: two", "2026-01-04"), commit("fix: late", "2026-01-15")],
			issues: [{ number: 12, title: "crash", closedAt: "2026-01-11T00:00:00Z" }],
			now: NOW,
		});
		const text = renderReport(report, BASELINE);
		expect(text).toContain("# Release escapes: v8.6.0–v9.1.0 (baseline)");
		expect(text).toContain("| v8.6.0 | 2026-01-01 | 2026-01-08 | 2 | 0 | 2 |");
		expect(text).toContain("| v9.0.0 | 2026-01-10 | 2026-01-17 | 1 | 1 | 2 |");
		expect(text).toContain("| **Total** |  |  | 3 | 1 | 4 |");
		expect(text).toContain("## v8.6.0");
		expect(text).toContain("fix: one");
		expect(text).toContain("#12 2026-01-11 crash");
		expect(text).not.toContain("(open)");
	});

	test("omits the issue column and says so when no Issue source was available", () => {
		const text = renderReport(buildReport({ tags: [tag("8.6.0", "2026-01-01")], commits: [commit("fix: one", "2026-01-02")], issues: null, now: NOW }), { from: "8.6.0", to: "8.6.0" });
		expect(text).not.toContain("(baseline)");
		expect(text).not.toContain("Bug issues |");
		expect(text).toContain("Bug issues were not counted");
	});
});

describe("tagsInRange and parseArgs", () => {
	test("tag ranges compare numerically and include both ends", () => {
		const all = ["8.5.0", "8.6.0", "9.0.0", "9.1.0", "9.10.0"].map((version) => tag(version, "2026-01-01"));
		expect(tagsInRange(all, BASELINE).map((entry) => entry.version)).toEqual(["8.6.0", "9.0.0", "9.1.0"]);
	});

	test("defaults to the baseline range and rejects unknown flags", () => {
		expect(parseArgs([])).toMatchObject({ from: "8.6.0", to: "9.1.0", issues: true });
		expect(parseArgs(["--from", "v9.0.0", "--no-issues", "--now", "2026-01-01"])).toMatchObject({ from: "9.0.0", issues: false, now: "2026-01-01T00:00:00.000Z" });
		expect(() => parseArgs(["--bogus"])).toThrow("unknown argument");
	});
});

describe("git readers", () => {
	const dir = mkdtempSync(join(tmpdir(), "imm-escape-report-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const git = (args: string[], date: string): void => {
		const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
		const done = Bun.spawnSync(["git", ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
		if (done.exitCode !== 0) throw new Error(done.stderr.toString());
	};
	const commitFile = (path: string, content: string, message: string, date: string): void => {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), content);
		git(["add", "."], date);
		git(["commit", "-m", message], date);
	};

	test("reads release tags, fix commits and the changesets a commit adds from a real repository", () => {
		git(["init", "-q", "-b", "main"], "2026-01-01T00:00:00Z");
		commitFile("a.txt", "1", "feat: first", "2026-01-01T00:00:00Z");
		git(["tag", "immune-brain-v1.0.0"], "2026-01-01T00:00:00Z");
		git(["tag", "v0.9.0"], "2026-01-01T00:00:00Z");
		commitFile("b.txt", "2", "fix: within the window", "2026-01-03T00:00:00Z");
		commitFile(".changeset/patch.md", '---\n"immune-brain": patch\n---\n\nFixes-release: 1.0.0\n', "chore: tidy", "2026-01-05T00:00:00Z");
		commitFile("c.txt", "3", "fix: out of window", "2026-01-20T00:00:00Z");
		// A fix that only modifies existing files adds nothing, yet must still be read.
		commitFile("a.txt", "1 fixed", "fix: modifies only", "2026-01-04T00:00:00Z");

		const tags = readTags(dir);
		expect(tags).toEqual([{ version: "1.0.0", date: "2026-01-01T00:00:00.000Z" }]);
		const commits = readCommits("2026-01-01T00:00:00Z", dir);
		expect(commits.map((entry) => entry.subject).sort()).toEqual(["chore: tidy", "feat: first", "fix: modifies only", "fix: out of window", "fix: within the window"]);
		const report = buildReport({ tags, commits, issues: [], now: "2026-02-01T00:00:00Z" });
		expect(report.rows[0].commits.map((entry) => entry.subject).sort()).toEqual(["chore: tidy", "fix: modifies only", "fix: within the window"]);
	});
});
