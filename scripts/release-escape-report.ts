// Release-escape metric (Spec e2e-release-gate D10, S10-AC2): how many post-release fixes land within
// 7 days after each `immune-brain-v*` tag, attributed to that version.
//
// A commit counts when its subject starts `fix` or `repair`, or when it states
// `Fixes-release: <version>` in its body or in a changeset it adds. A closed Issue labeled `bug`
// counts by its close time. An item with no `Fixes-release:` line belongs to the newest tag at or
// before it; one with the line belongs to that version, and only inside that version's window. The
// window is [tag time, tag time + 7 days]: a fix after it is not counted.
//
//   bun scripts/release-escape-report.ts [--from 8.6.0] [--to 9.1.0] [--no-issues] [--now <ISO>]
//
// `buildReport` and `renderReport` are pure; the git and `gh` readers sit below them.

export const TAG_PREFIX = "immune-brain-v";
export const WINDOW_DAYS = 7;
export const BASELINE = { from: "8.6.0", to: "9.1.0" } as const;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const FIX_SUBJECT = /^(fix|repair)\b/i;
const FIXES_RELEASE = /^[ \t]*Fixes-release:[ \t]*v?(\d+\.\d+\.\d+)[ \t]*$/gm;

export interface ReleaseTag {
	version: string;
	date: string;
}
export interface CommitRecord {
	sha: string;
	date: string;
	subject: string;
	body?: string;
	/** Text of each `.changeset/*.md` file the commit adds. */
	changesets?: readonly string[];
}
export interface IssueRecord {
	number: number;
	title: string;
	closedAt: string;
}
export interface VersionRow {
	version: string;
	tagDate: string;
	windowEnd: string;
	/** True while the 7-day window has not yet closed at `now`, so the counts can still grow. */
	open: boolean;
	commits: CommitRecord[];
	issues: IssueRecord[];
}
export interface Report {
	rows: VersionRow[];
	/** False when the Issue source was unavailable, so Issue counts are absent rather than zero. */
	issuesIncluded: boolean;
	now: string;
}

const time = (iso: string): number => Date.parse(iso);

/** Versions a commit declares it fixes, from its body and the changesets it adds. */
export function declaredFixes(commit: CommitRecord): string[] {
	const text = [commit.body ?? "", ...(commit.changesets ?? [])].join("\n");
	return [...text.matchAll(FIXES_RELEASE)].map((match) => match[1]);
}

/** The release a moment falls inside: the newest tag at or before it whose window still covers it. */
function owningTag(tags: readonly ReleaseTag[], at: string): ReleaseTag | undefined {
	const newestBefore = tags.filter((tag) => time(tag.date) <= time(at)).sort((a, b) => time(b.date) - time(a.date))[0];
	return newestBefore && time(at) - time(newestBefore.date) <= WINDOW_MS ? newestBefore : undefined;
}

const inWindow = (tag: ReleaseTag, at: string): boolean => time(at) >= time(tag.date) && time(at) - time(tag.date) <= WINDOW_MS;

/**
 * Attributes fix commits and bug Issues to the tags in `tags`. `issues` is `null` when no Issue
 * source was available.
 */
export function buildReport(input: { tags: readonly ReleaseTag[]; commits: readonly CommitRecord[]; issues: readonly IssueRecord[] | null; now: string }): Report {
	const tags = [...input.tags].sort((a, b) => time(a.date) - time(b.date));
	const rows: VersionRow[] = tags.map((tag) => ({
		version: tag.version,
		tagDate: tag.date,
		windowEnd: new Date(time(tag.date) + WINDOW_MS).toISOString(),
		open: time(input.now) < time(tag.date) + WINDOW_MS,
		commits: [],
		issues: [],
	}));
	const row = (version: string): VersionRow | undefined => rows.find((candidate) => candidate.version === version);

	for (const commit of input.commits) {
		const declared = declaredFixes(commit);
		if (declared.length) {
			for (const version of new Set(declared)) {
				const tag = tags.find((candidate) => candidate.version === version);
				if (tag && inWindow(tag, commit.date)) row(version)?.commits.push(commit);
			}
		} else if (FIX_SUBJECT.test(commit.subject)) {
			const tag = owningTag(tags, commit.date);
			if (tag) row(tag.version)?.commits.push(commit);
		}
	}
	for (const issue of input.issues ?? []) {
		const tag = owningTag(tags, issue.closedAt);
		if (tag) row(tag.version)?.issues.push(issue);
	}
	return { rows, issuesIncluded: input.issues !== null, now: input.now };
}

const day = (iso: string): string => iso.slice(0, 10);

export function renderReport(report: Report, range: { from: string; to: string }): string {
	const isBaseline = range.from === BASELINE.from && range.to === BASELINE.to;
	const lines = [
		`# Release escapes: v${range.from}–v${range.to}${isBaseline ? " (baseline)" : ""}`,
		"",
		`Fixes landing within ${WINDOW_DAYS} days after each \`${TAG_PREFIX}*\` tag, attributed to that version. Report time: ${report.now}.`,
		"",
		report.issuesIncluded ? "| Version | Tagged | Window closes | Fix commits | Bug issues | Escapes |" : "| Version | Tagged | Window closes | Fix commits | Escapes |",
		report.issuesIncluded ? "| --- | --- | --- | ---: | ---: | ---: |" : "| --- | --- | --- | ---: | ---: |",
	];
	let commits = 0;
	let issues = 0;
	for (const row of report.rows) {
		commits += row.commits.length;
		issues += row.issues.length;
		const closes = `${day(row.windowEnd)}${row.open ? " (open)" : ""}`;
		const cells = [`v${row.version}`, day(row.tagDate), closes, String(row.commits.length)];
		if (report.issuesIncluded) cells.push(String(row.issues.length));
		cells.push(String(row.commits.length + row.issues.length));
		lines.push(`| ${cells.join(" | ")} |`);
	}
	const totals = ["Total", "", "", String(commits)];
	if (report.issuesIncluded) totals.push(String(issues));
	totals.push(String(commits + issues));
	lines.push(`| ${totals.map((cell, index) => (index === 0 ? `**${cell}**` : cell)).join(" | ")} |`, "");
	if (!report.issuesIncluded) lines.push("Bug issues were not counted: no Issue source was available (`--no-issues`, or `gh` missing or failing).", "");
	if (report.rows.some((row) => row.open)) lines.push("Rows marked (open) are still inside their window, so their counts can grow.", "");
	for (const row of report.rows) {
		if (!row.commits.length && !row.issues.length) continue;
		lines.push(`## v${row.version}`, "");
		for (const commit of row.commits) lines.push(`- ${commit.sha.slice(0, 11)} ${day(commit.date)} ${commit.subject}`);
		for (const issue of row.issues) lines.push(`- #${issue.number} ${day(issue.closedAt)} ${issue.title}`);
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

/** Keeps the tags from `range.from` through `range.to` inclusive. */
export function tagsInRange(tags: readonly ReleaseTag[], range: { from: string; to: string }): ReleaseTag[] {
	const key = (version: string): number[] => version.split(".").map(Number);
	const compare = (a: string, b: string): number => {
		const [left, right] = [key(a), key(b)];
		for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
		return 0;
	};
	return tags.filter((tag) => compare(tag.version, range.from) >= 0 && compare(tag.version, range.to) <= 0);
}

// --- readers -------------------------------------------------------------------------------

function git(args: string[], cwd?: string): string {
	const done = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe", cwd });
	if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr.toString().trim()}`);
	return done.stdout.toString();
}

export function readTags(cwd?: string): ReleaseTag[] {
	const out = git(["for-each-ref", "--format=%(refname:short)\t%(creatordate:iso-strict)", `refs/tags/${TAG_PREFIX}*`], cwd);
	return out
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [name, date] = line.split("\t");
			return { version: name.slice(TAG_PREFIX.length), date: new Date(date).toISOString() };
		})
		.filter((tag) => /^\d+\.\d+\.\d+$/.test(tag.version));
}

const RECORD = "\x1e";
const FIELD = "\x1f";

/** Non-merge commits reachable from HEAD since `since`, each with the changesets it adds. */
export function readCommits(since: string, cwd?: string): CommitRecord[] {
	const out = git(["log", "--no-merges", `--since=${since}`, "--name-status", `--format=${RECORD}%H${FIELD}%cI${FIELD}%s${FIELD}%b${FIELD}`], cwd);
	return out
		.split(RECORD)
		.filter(Boolean)
		.map((chunk) => {
			const [sha, date, subject, body, files = ""] = chunk.split(FIELD);
			const changesets = files
				.split("\n")
				.filter((line) => line.startsWith("A\t"))
				.map((line) => line.slice(2).trim())
				.filter((path) => /^\.changeset\/[^/]+\.md$/.test(path) && path !== ".changeset/README.md")
				.map((path) => git(["show", `${sha}:${path}`], cwd));
			return { sha, date: new Date(date).toISOString(), subject, body, changesets };
		});
}

/** Closed `bug` Issues via `gh`; null when `gh` is missing or fails. */
export function readBugIssues(): IssueRecord[] | null {
	try {
		const done = Bun.spawnSync(["gh", "issue", "list", "--state", "closed", "--label", "bug", "--limit", "1000", "--json", "number,title,closedAt"], { stdout: "pipe", stderr: "pipe" });
		if (done.exitCode !== 0) return null;
		return (JSON.parse(done.stdout.toString()) as IssueRecord[]).filter((issue) => issue.closedAt);
	} catch {
		return null;
	}
}

export function parseArgs(argv: readonly string[]): { from: string; to: string; issues: boolean; now: string } {
	const options = { from: BASELINE.from as string, to: BASELINE.to as string, issues: true, now: new Date().toISOString() };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--no-issues") options.issues = false;
		else if (arg === "--from" || arg === "--to" || arg === "--now") {
			const value = argv[++i];
			if (!value) throw new Error(`${arg} needs a value`);
			if (arg === "--now") options.now = new Date(value).toISOString();
			else options[arg === "--from" ? "from" : "to"] = value.replace(/^v/, "");
		} else throw new Error(`unknown argument ${arg}`);
	}
	return options;
}

if (import.meta.main) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const tags = tagsInRange(readTags(), options);
		if (!tags.length) throw new Error(`no ${TAG_PREFIX}* tags between v${options.from} and v${options.to}`);
		const earliest = tags.map((tag) => tag.date).sort()[0];
		const report = buildReport({ tags, commits: readCommits(earliest), issues: options.issues ? readBugIssues() : null, now: options.now });
		process.stdout.write(renderReport(report, options));
	} catch (error) {
		console.error(`release escape report: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
