import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { readTaskIntent } from "./kernel/intent";

const CONTRACT = "immune_brain/github_issue_tracker_result/v1" as const;
const PROTOCOL_MARKER = "<!-- immune-brain-tracker:v1 -->";
const KIND_INITIATIVE_MARKER = "<!-- immune-brain:kind=initiative -->";
const KIND_TASK_MARKER = "<!-- immune-brain:kind=task -->";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_GH_OUTPUT = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC = 512;
const GH_TIMEOUT_MS = 20_000;
const MAX_SNAPSHOT_PAGES = 100;
const GITHUB_ISSUE_BODY_LIMIT = 65_536;
const MAX_TERMINAL_EVENT_ID = 500;

type TrackerStatus =
	| "created"
	| "updated"
	| "already_current"
	| "retryable_failure"
	| "permanent_failure"
	| "ambiguous_remote_state";

export interface GithubTrackerResult {
	contract: typeof CONTRACT;
	operation: TrackerOperation["op"];
	status: TrackerStatus;
	association_found: boolean;
	issue_number?: number;
	issue_url?: string;
	node_id?: string;
	message: string;
}

export interface InitiativeSlice {
	id: string;
	goal: string;
	result?: string;
	blocked_by?: string[];
}

export interface InitiativeProjection {
	problem?: string;
	result?: string;
	design?: string;
	decisions?: string[];
	testing_strategy?: string;
	out_of_scope?: string[];
}

export interface InitiativePublicationInput {
	initiative_id: string;
	goal: string;
	projection: InitiativeProjection;
	tasks: Array<{
		slice_id: string;
		intent: string;
		projection?: TaskProjection;
	}>;
}

export interface GithubInitiativePublicationResult {
	contract: "immune_brain/github_initiative_publication/v1";
	operation: "publish-initiative";
	status: TrackerStatus;
	initiative?: GithubTrackerResult;
	tasks: Array<{
		task_id: string;
		slice_id: string;
		status: TrackerStatus;
		issue_number?: number;
		issue_url?: string;
		node_id?: string;
	}>;
	execution?: {
		recommended_first_task_id: string;
		recommended_first_issue_number: number;
		order: string[];
		issue_order: number[];
		parallel_groups: string[][];
		parallel_issue_groups: number[][];
	};
	message: string;
}

export interface TaskProjection {
	result?: string;
	current_behavior?: string;
	desired_behavior?: string;
	key_interfaces?: string[];
	verification?: string;
	blocked_by?: string[];
	out_of_scope?: string[];
	agent_handoff?: string;
}

export type TrackerOperation =
	| {
		op: "create-initiative";
		initiative_id: string;
		goal: string;
		slices: InitiativeSlice[];
		projection?: InitiativeProjection;
	}
	| {
		op: "upsert-task";
		initiative_id: string;
		task_id: string;
		slice_id: string;
		goal: string;
		risk: "routine" | "material" | "critical";
		acceptance: Array<{ id: string; summary: string }>;
		projection?: TaskProjection;
	}
	| {
		op: "mark-terminal";
		task_id: string;
		phase: "done" | "stopped";
		terminal_event_id: string;
	};

export interface GhExecution {
	exit_code: number;
	stdout: string;
	stderr: string;
	timed_out: boolean;
	output_exceeded: boolean;
}

export interface GhTransport {
	run(args: string[], options?: { cwd?: string; stdin?: string }): Promise<GhExecution>;
}

interface RepositoryInfo {
	id: number;
	name_with_owner: string;
}

interface GithubIssue {
	id: number;
	number: number;
	url: string;
	title: string;
	body: string;
	state: "open" | "closed";
	state_reason: string | null;
}

interface RepositorySnapshot {
	repository: RepositoryInfo;
	issues: GithubIssue[];
}

interface FoundIssue {
	kind: "found";
	issue: GithubIssue;
}

interface MissingIssue {
	kind: "missing";
}

interface AmbiguousIssue {
	kind: "ambiguous";
	message: string;
}

type IssueLookup = FoundIssue | MissingIssue | AmbiguousIssue;

function countLiteral(value: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let index = 0;
	while ((index = value.indexOf(needle, index)) !== -1) {
		count += 1;
		index += needle.length;
	}
	return count;
}

function marker(name: "repo-id" | "initiative-id" | "task-id" | "slice-id", value: string | number): string {
	return `<!-- immune-brain:${name}=${value} -->`;
}

function terminalMarker(eventId: string): string {
	return `<!-- immune-brain:terminal-event=${eventId} -->`;
}

function terminalSuffix(eventId: string): string {
	return `\n\n${terminalMarker(eventId)}\nTerminal event: \`${eventId}\`\n`;
}

const MAX_TERMINAL_SUFFIX_BYTES = Buffer.byteLength(terminalSuffix("x".repeat(MAX_TERMINAL_EVENT_ID)), "utf8");

function terminalEvent(value: unknown): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,500}$/.test(value))
		throw new Error("terminal_event_id must be a bounded opaque Kernel event id");
	if (/(?:gh[pousr]_|github_pat_)/i.test(value)) throw new Error("terminal_event_id must not contain a token-like value");
	return value;
}

function redactSecrets(value: string): string {
	return value
		.replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
		.replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
		.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
		.replace(/\b(?:token|secret|password)\s*[=:]\s*\S+/gi, "credential=[REDACTED]");
}

function publicText(value: unknown, name: string, max = 2_000): string {
	if (typeof value !== "string") throw new Error(`${name} must be a string`);
	const text = value.trim();
	if (!text || text.length > max || text.includes("\0"))
		throw new Error(`${name} must contain 1-${max} safe characters`);
	return redactSecrets(text).replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;");
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== "string" || !ID_PATTERN.test(value))
		throw new Error(`${name} must match ${ID_PATTERN}`);
	if (/^(?:gh[pousr]_|github_pat_)/i.test(value)) throw new Error(`${name} must not contain a token-like value`);
	return value;
}

function titleText(value: string): string {
	return redactSecrets(value).replace(/\s+/g, " ");
}

function issueTitle(owner: string, result: string): string {
	const title = `[${owner}] ${titleText(result)}`;
	if (title.length > 256) throw new Error("GitHub Issue title must not exceed 256 characters");
	return title;
}

export function redactGithubDiagnostic(value: string): string {
	return redactSecrets(value)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_DIAGNOSTIC);
}

function result(
	operation: TrackerOperation["op"],
	status: TrackerStatus,
	message: string,
	issue?: GithubIssue,
): GithubTrackerResult {
	return {
		contract: CONTRACT,
		operation,
		status,
		association_found: issue !== undefined,
		...(issue ? { issue_number: issue.number, issue_url: issue.url, node_id: String(issue.id) } : {}),
		message: redactGithubDiagnostic(message),
	};
}

function ghFailure(
	operation: TrackerOperation["op"],
	execution: GhExecution,
	message: string,
): GithubTrackerResult {
	const retryable = execution.timed_out
		|| /timeout|timed out|network|connection|temporar|rate limit|502|503|504/i.test(execution.stderr);
	return result(
		operation,
		retryable ? "retryable_failure" : "permanent_failure",
		`${message}: ${execution.output_exceeded ? "gh output limit exceeded" : execution.stderr || `gh exited ${execution.exit_code}`}`,
	);
}

export function createGhTransport(binary = "gh"): GhTransport {
	return {
		run(args, options = {}) {
			return new Promise((complete) => {
				let stdout = Buffer.alloc(0);
				let stderr = Buffer.alloc(0);
				let timedOut = false;
				let outputExceeded = false;
				let timer: ReturnType<typeof setTimeout> | undefined;
				let settled = false;
				const finish = (exitCode: number, spawnError = ""): void => {
					if (settled) return;
					settled = true;
					if (timer) clearTimeout(timer);
					complete({
						exit_code: exitCode,
						stdout: stdout.toString("utf8"),
						stderr: `${stderr.toString("utf8")}${spawnError}`,
						timed_out: timedOut,
						output_exceeded: outputExceeded,
					});
				};
				let child: ReturnType<typeof spawn>;
				try {
					child = spawn(binary, args, {
						cwd: options.cwd,
						stdio: ["pipe", "pipe", "pipe"],
						env: process.env,
					});
				} catch (error) {
					finish(1, error instanceof Error ? error.message : String(error));
					return;
				}
				const append = (current: Buffer, chunk: Buffer): Buffer => {
					const available = Math.max(0, MAX_GH_OUTPUT - stdout.length - stderr.length);
					if (chunk.length > available) {
						outputExceeded = true;
						child.kill("SIGKILL");
					}
					return available > 0 ? Buffer.concat([current, chunk.subarray(0, available)]) : current;
				};
				child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
				child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
				child.once("error", (error) => { finish(1, error.message); });
				child.stdin.once("error", (error) => { finish(1, error.message); });
				timer = setTimeout(() => {
					timedOut = true;
					child.kill("SIGKILL");
				}, GH_TIMEOUT_MS);
				child.once("close", (code) => { finish(code ?? 1); });
				try {
					child.stdin.end(options.stdin ?? "");
				} catch (error) {
					finish(1, error instanceof Error ? error.message : String(error));
				}
			});
		},
	};
}

function parseRepository(raw: string): RepositoryInfo {
	const value = JSON.parse(raw) as { id?: unknown; full_name?: unknown };
	if (!Number.isSafeInteger(value.id) || typeof value.full_name !== "string" || !value.full_name.includes("/"))
		throw new Error("gh returned malformed repository identity");
	return { id: value.id as number, name_with_owner: value.full_name };
}

function parseIssues(raw: string): GithubIssue[] {
	const parsed = JSON.parse(raw) as unknown;
	const pages = Array.isArray(parsed) && parsed.every(Array.isArray) ? parsed.flat() : parsed;
	if (!Array.isArray(pages)) throw new Error("gh returned malformed Issue list");
	return pages
		.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !("pull_request" in (item as object)))
		.map((item) => {
			if (
				!Number.isSafeInteger(item.id)
				|| !Number.isSafeInteger(item.number)
				|| typeof item.html_url !== "string"
				|| typeof item.title !== "string"
				|| (typeof item.body !== "string" && item.body !== null)
				|| (item.state !== "open" && item.state !== "closed")
			) throw new Error("gh returned a malformed Issue");
			return {
				id: item.id as number,
				number: item.number as number,
				url: item.html_url,
				title: item.title,
				body: typeof item.body === "string" ? item.body : "",
				state: item.state,
				state_reason: typeof item.state_reason === "string" ? item.state_reason.toLowerCase() : null,
			};
		});
}

function parseSubIssueNumbers(raw: string): number[] {
	const parsed = JSON.parse(raw) as unknown;
	const pages = Array.isArray(parsed) && parsed.every(Array.isArray) ? parsed.flat() : parsed;
	if (!Array.isArray(pages)) throw new Error("gh returned malformed Sub-issue list");
	return pages.map((item, index) => {
		const number = (item as { number?: unknown })?.number;
		if (!Number.isSafeInteger(number)) throw new Error(`gh returned a malformed Sub-issue entry at ${index}`);
		return number;
	});
}

async function snapshot(root: string, gh: GhTransport, operation: TrackerOperation["op"]): Promise<RepositorySnapshot | GithubTrackerResult> {
	const repositoryExecution = await gh.run(["api", "repos/{owner}/{repo}"], { cwd: root });
	if (repositoryExecution.exit_code !== 0 || repositoryExecution.output_exceeded)
		return ghFailure(operation, repositoryExecution, "cannot resolve GitHub repository");
	let repository: RepositoryInfo;
	try {
		repository = parseRepository(repositoryExecution.stdout);
	} catch (error) {
		return result(operation, "permanent_failure", error instanceof Error ? error.message : String(error));
	}
	// ponytail: paginated fetch avoids single 1MiB slurp blob; 100 issues/page * 8MiB handles 65KB bodies without hitting limit
	const issues: GithubIssue[] = [];
	for (let page = 1; page <= MAX_SNAPSHOT_PAGES; page += 1) {
		const issuesExecution = await gh.run(
			["api", `repos/${repository.name_with_owner}/issues?state=all&per_page=100&page=${page}`],
			{ cwd: root },
		);
		if (issuesExecution.exit_code !== 0 || issuesExecution.output_exceeded)
			return ghFailure(operation, issuesExecution, "cannot query GitHub Issues");
		let raw: unknown;
		try {
			raw = JSON.parse(issuesExecution.stdout);
		} catch (error) {
			return result(operation, "permanent_failure", error instanceof Error ? error.message : String(error));
		}
		if (!Array.isArray(raw)) return result(operation, "permanent_failure", "gh returned malformed Issue list");
		const pageCount = raw.length;
		try {
			issues.push(...parseIssues(issuesExecution.stdout));
		} catch (error) {
			return result(operation, "permanent_failure", error instanceof Error ? error.message : String(error));
		}
		if (pageCount < 100) break;
		if (page === MAX_SNAPSHOT_PAGES)
			return result(operation, "permanent_failure", "too many GitHub Issues to snapshot");
	}
	return { repository, issues };
}

function findIssue(issues: GithubIssue[], primary: string[], required: string[]): IssueLookup {
	const candidates = issues.filter((issue) => primary.every((needle) => issue.body.includes(needle)));
	if (candidates.length === 0) return { kind: "missing" };
	if (candidates.length !== 1)
		return { kind: "ambiguous", message: `multiple Issues contain identity marker ${primary[0]}` };
	const issue = candidates[0];
	for (const expected of [PROTOCOL_MARKER, ...required]) {
		if (countLiteral(issue.body, expected) !== 1)
			return { kind: "ambiguous", message: `Issue #${issue.number} has missing or duplicate identity markers` };
	}
	return { kind: "found", issue };
}

function initiativeLookup(issues: GithubIssue[], repositoryId: number, initiativeId: string): IssueLookup {
	const initiative = marker("initiative-id", initiativeId);
	return findIssue(issues, [initiative, KIND_INITIATIVE_MARKER], [marker("repo-id", repositoryId), initiative]);
}

function ownershipMarkerValue(body: string, name: "initiative-id" | "slice-id" | "task-id"): string | null {
	const values = [...body.matchAll(new RegExp(`<!-- immune-brain:${name}=([A-Za-z0-9][A-Za-z0-9._-]{0,127}) -->`, "g"))];
	return values.length === 1 ? values[0][1] : null;
}

function taskLookup(issues: GithubIssue[], repositoryId: number, taskId: string): IssueLookup {
	const task = marker("task-id", taskId);
	const base = findIssue(issues, [task, KIND_TASK_MARKER], [marker("repo-id", repositoryId), task]);
	if (base.kind !== "found") return base;
	for (const name of ["task-id", "initiative-id", "slice-id"] as const) {
		if (!ownershipMarkerValue(base.issue.body, name))
			return { kind: "ambiguous", message: `Issue #${base.issue.number} has missing or duplicate ${name} ownership markers` };
	}
	return base;
}

function ownedTaskLookup(
	issues: GithubIssue[],
	repositoryId: number,
	taskId: string,
	initiativeId: string,
	sliceId: string,
): IssueLookup {
	const base = taskLookup(issues, repositoryId, taskId);
	if (base.kind !== "found") return base;
	return base.issue.body.includes(marker("initiative-id", initiativeId))
		&& base.issue.body.includes(marker("slice-id", sliceId))
		? base
		: { kind: "ambiguous", message: `Issue #${base.issue.number} belongs to another Initiative or Slice; Task ownership is immutable` };
}

function sliceCount(parentBody: string, sliceId: string): number {
	return countLiteral(parentBody, marker("slice-id", sliceId));
}

async function readSubIssueNumbers(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	parentNumber: number,
): Promise<GithubTrackerResult | number[]> {
	const listed = await gh.run(["api", "--paginate", "--slurp", `repos/${repository.name_with_owner}/issues/${parentNumber}/sub_issues?per_page=100`], { cwd: root });
	if (listed.exit_code !== 0 || listed.output_exceeded)
		return ghFailure(operation, listed, "cannot read native Sub-issue relations");
	try {
		return parseSubIssueNumbers(listed.stdout);
	} catch (error) {
		return result(operation, "permanent_failure", error instanceof Error ? error.message : String(error));
	}
}

async function confirmAttachment(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	parentNumber: number,
	childNumber: number,
): Promise<GithubTrackerResult | { attached: boolean }> {
	const read = await readSubIssueNumbers(root, gh, operation, repository, parentNumber);
	if (!Array.isArray(read)) return read;
	const matches = read.filter((candidate) => candidate === childNumber).length;
	if (matches > 1) return result(operation, "ambiguous_remote_state", `Issue #${parentNumber} lists the Task Issue more than once`);
	return { attached: matches === 1 };
}

async function attachSubIssue(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	parentNumber: number,
	child: GithubIssue,
): Promise<GithubTrackerResult | { attached: true }> {
	const mutation = await gh.run([
		"api",
		"-F",
		`sub_issue_id=${child.id}`,
		`repos/${repository.name_with_owner}/issues/${parentNumber}/sub_issues`,
	], { cwd: root });
	if (mutation.exit_code !== 0 || mutation.output_exceeded)
		return ghFailure(operation, mutation, "native Sub-issue attachment failed");
	const confirmed = await confirmAttachment(root, gh, operation, repository, parentNumber, child.number);
	if (!("attached" in confirmed)) return confirmed;
	return confirmed.attached
		? { attached: true }
		: result(operation, "retryable_failure", "native Sub-issue relation did not converge", child);
}

async function readBlockedByIds(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	childNumber: number,
): Promise<GithubTrackerResult | number[]> {
	const listed = await gh.run(["api", "--paginate", "--slurp", `repos/${repository.name_with_owner}/issues/${childNumber}/dependencies/blocked_by?per_page=100`], { cwd: root });
	if (listed.exit_code !== 0 || listed.output_exceeded) return ghFailure(operation, listed, "cannot read native blocked_by relations");
	try {
		const pages = JSON.parse(listed.stdout) as unknown;
		if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error("gh returned malformed blocked_by pages");
		const ids = pages.flat().map((item, index) => {
			const id = (item as { id?: unknown; issue_id?: unknown })?.issue_id ?? (item as { id?: unknown })?.id;
			if (!Number.isSafeInteger(id)) throw new Error(`gh returned malformed blocked_by entry at ${index}`);
			return id as number;
		});
		if (new Set(ids).size !== ids.length) return result(operation, "ambiguous_remote_state", `Issue #${childNumber} has duplicate native blocked_by relations`);
		return ids;
	} catch (error) {
		return result(operation, "permanent_failure", error instanceof Error ? error.message : String(error));
	}
}

async function confirmBlockedBy(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	childNumber: number,
	blockers: GithubIssue[],
): Promise<GithubTrackerResult | { complete: boolean }> {
	const ids = await readBlockedByIds(root, gh, operation, repository, childNumber);
	if (!Array.isArray(ids)) return ids;
	const expected = blockers.map((blocker) => blocker.id);
	if (ids.some((id) => !expected.includes(id)))
		return result(operation, "ambiguous_remote_state", `Issue #${childNumber} has unrequested native blocked_by relations`);
	return { complete: ids.length === expected.length && expected.every((id) => ids.includes(id)) };
}

async function attachBlockedBy(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	childNumber: number,
	blockers: GithubIssue[],
): Promise<GithubTrackerResult | { complete: true }> {
	const existing = await readBlockedByIds(root, gh, operation, repository, childNumber);
	if (!Array.isArray(existing)) return existing;
	for (const blocker of blockers) {
		if (existing.includes(blocker.id)) continue;
		const mutation = await gh.run([
			"api", "-F", `issue_id=${blocker.id}`,
			`repos/${repository.name_with_owner}/issues/${childNumber}/dependencies/blocked_by`,
		], { cwd: root });
		if (mutation.exit_code !== 0 || mutation.output_exceeded) return ghFailure(operation, mutation, `native blocked_by attachment failed for Issue #${blocker.number}`);
		existing.push(blocker.id);
	}
	const confirmed = await confirmBlockedBy(root, gh, operation, repository, childNumber, blockers);
	if ("complete" in confirmed) return confirmed.complete ? { complete: true } : result(operation, "retryable_failure", "native blocked_by relations did not converge");
	return confirmed;
}
function carrierConflict(root: string, operation: TrackerOperation["op"], initiativeId: string): GithubTrackerResult | null {
	if (!existsSync(resolve(root, "docs", "initiatives", `${initiativeId}.md`))) return null;
	return result(
		operation,
		"permanent_failure",
		`Initiative carrier conflict: docs/initiatives/${initiativeId}.md already owns this slug locally; remove the duplicate carrier before using the GitHub projection`,
	);
}

function listText(values: string[] | undefined, fallback: string): string {
	return values?.length ? values.map((value) => `- ${value}`).join("\n") : fallback;
}

function bodyLimitFailure(operation: TrackerOperation["op"], body: string, reserve = 0): GithubTrackerResult | null {
	return Buffer.byteLength(body, "utf8") + reserve <= GITHUB_ISSUE_BODY_LIMIT
		? null
		: result(operation, "permanent_failure", "rendered GitHub Issue body exceeds 65,536 UTF-8 bytes");
}

function createInitiativeBody(repository: RepositoryInfo, operation: Extract<TrackerOperation, { op: "create-initiative" }>): string {
	const projection = operation.projection ?? {};
	return `${[
		PROTOCOL_MARKER,
		KIND_INITIATIVE_MARKER,
		marker("repo-id", repository.id),
		marker("initiative-id", operation.initiative_id),
	].join("\n")}\n\n# ${titleText(projection.result ?? operation.goal)}\n\nOpt-in, non-authoritative Immune-Brain Initiative planning carrier. Kernel TaskIntent, TaskRecord, and Assurance remain the execution authority.\n\n## How to use this Issue\n\n- Edit planning prose and Slice ordering directly after creation.\n- Keep each Slice marker attached to exactly one stable Slice entry.\n- The tracker never rewrites or closes this Parent after creation; the tracker never changes or closes it automatically.\n\n## Problem\n\n${publicText(projection.problem ?? "The Initiative addresses the bounded delivery described below.", "projection.problem")}\n\n## Result\n\n${publicText(projection.result ?? operation.goal, "projection.result")}\n\n## Initiative design\n\n${publicText(projection.design ?? "Each Child preserves the shared Initiative decisions and boundaries recorded here.", "projection.design")}\n\n## Decisions\n\n${listText(projection.decisions, "- No additional Initiative decisions recorded.")}\n\n## Testing strategy\n\n${publicText(projection.testing_strategy ?? "Each Child closes from its focused acceptance verification.", "projection.testing_strategy")}\n\n## Out of scope\n\n${listText(projection.out_of_scope, "- Unrelated work outside this Initiative.")}\n\n## Slices\n\n${operation.slices.length === 0 ? "No Slices recorded yet." : operation.slices.map((slice) => `- [ ] ${marker("slice-id", slice.id)} **${slice.id}**: ${slice.result ?? slice.goal}${slice.blocked_by?.length ? ` (blocked by: ${slice.blocked_by.join(", ")})` : ""}`).join("\n")}\n\n## Authority boundary\n\nThis Issue is outbound visibility only. GitHub state never starts, authorizes, reprioritizes, or settles work. Native Sub-issues identify published Tasks; their state is only an observation.\n`;
}

async function createInitiative(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "create-initiative" }>,
	source: RepositorySnapshot,
): Promise<GithubTrackerResult> {
	const lookup = (issues: GithubIssue[]) => initiativeLookup(issues, source.repository.id, operation.initiative_id);
	const found = lookup(source.issues);
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	const body = createInitiativeBody(source.repository, operation);
	const oversized = bodyLimitFailure(operation.op, body);
	if (oversized) return oversized;
	const title = issueTitle(operation.initiative_id, operation.projection?.result ?? operation.goal);
	if (found.kind === "missing") {
		const mutation = await gh.run([
			"issue", "create", "--repo", source.repository.name_with_owner,
			"--title", title,
			"--body-file", "-",
		], { cwd: root, stdin: body });
		const refreshed = await snapshot(root, gh, operation.op);
		if ("contract" in refreshed) return refreshed;
		const confirmed = lookup(refreshed.issues);
		if (confirmed.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", confirmed.message);
		if (confirmed.kind === "missing") {
			return mutation.exit_code !== 0 && !mutation.timed_out && !mutation.output_exceeded
				? ghFailure(operation.op, mutation, "Initiative Issue creation failed")
				: result(operation.op, "retryable_failure", "Initiative creation could not be confirmed");
		}
		return confirmed.issue.body === body && confirmed.issue.title === title
			? result(operation.op, "created", "Initiative Issue created as the single GitHub source", confirmed.issue)
			: result(operation.op, "retryable_failure", "Initiative Issue did not converge to the requested initial title and body", confirmed.issue);
	}
	if (found.issue.body === body && found.issue.title === title)
		return result(operation.op, "already_current", "Initiative Issue already carries the requested initial source", found.issue);
	return result(
		operation.op,
		"permanent_failure",
		"Initiative Issue already exists and the tracker never rewrites it; edit the GitHub source directly for later planning changes",
		found.issue,
	);
}

function childBody(
	repository: RepositoryInfo,
	operation: Extract<TrackerOperation, { op: "upsert-task" }>,
	parent: GithubIssue,
): string {
	const projection = operation.projection ?? {};
	const acceptance = operation.acceptance.map((item) => `- \`${item.id}\`: ${item.summary}`).join("\n");
	return `${[
		PROTOCOL_MARKER,
		KIND_TASK_MARKER,
		marker("repo-id", repository.id),
		marker("initiative-id", operation.initiative_id),
		marker("slice-id", operation.slice_id),
		marker("task-id", operation.task_id),
	].join("\n")}\n\n# ${titleText(projection.result ?? operation.goal)}\n\nOpt-in, non-authoritative Immune-Brain Task Issue. Kernel TaskIntent, TaskRecord, and Assurance remain the execution authority.\n\n## Parent\n\n| Initiative | \`${operation.initiative_id}\` |\n| Parent Issue | [#${parent.number}](${parent.url}) |\n| Slice | \`${operation.slice_id}\` |\n| Risk | \`${operation.risk}\` |\n\n## What to build\n\n${publicText(projection.result ?? operation.goal, "projection.result")}\n\n## Current behavior\n\n${publicText(projection.current_behavior ?? "The current behavior is defined by the repository's existing contract.", "projection.current_behavior")}\n\n## Desired behavior\n\n${publicText(projection.desired_behavior ?? operation.goal, "projection.desired_behavior")}\n\n## Key interfaces\n\n${listText(projection.key_interfaces, "- Canonical TaskIntent acceptance and Kernel lifecycle remain authoritative.")}\n\n## Acceptance criteria\n\n${acceptance}\n\n## Verification\n\n${publicText(projection.verification ?? "Run the focused acceptance verification declared by the TaskIntent.", "projection.verification")}\n\n## Blocked by\n\n${projection.blocked_by?.length ? projection.blocked_by.map((id) => `- \`${identifier(id, "blocked_by task_id")}\``).join("\n") : "None"}\n\n## Out of scope\n\n${listText(projection.out_of_scope, "- Scope not declared by the validated TaskIntent.")}\n\n## Agent handoff\n\n${publicText(projection.agent_handoff ?? "Implement only the bounded TaskIntent result and run the focused checks. Do not widen scope or treat GitHub as authorization.", "projection.agent_handoff")}\n\n## Lifecycle\n\n- **Open** means this Task still needs attention; it does not mean the Task is authorized or executing.\n- Only a fresh claimless terminal projection can close this Issue: \`done\` becomes **Completed**, and \`stopped\` becomes **Not planned**.\n\n## Authority boundary\n\nThis Issue is outbound visibility only. GitHub state never changes TaskIntent, TaskRecord, QA, Review, authorization, or Kernel settlement. Internal role prompts, tool policies, review gates, model reservations, and prompt digests are not part of this external handoff.\n`;
}

async function upsertTask(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "upsert-task" }>,
	source: RepositorySnapshot,
): Promise<GithubTrackerResult> {
	const parent = initiativeLookup(source.issues, source.repository.id, operation.initiative_id);
	if (parent.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", parent.message);
	if (parent.kind === "missing")
		return result(operation.op, "permanent_failure", "the Initiative Parent Issue must exist before publishing a Task");
	if (sliceCount(parent.issue.body, operation.slice_id) !== 1)
		return result(
			operation.op,
			"ambiguous_remote_state",
			`Parent Issue #${parent.issue.number} has missing or duplicate Slice marker ${operation.slice_id}; restore exactly one stable Slice entry in the GitHub source`,
			parent.issue,
		);
	const lookup = (issues: GithubIssue[]) => taskLookup(issues, source.repository.id, operation.task_id);
	const found = lookup(source.issues);
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	const blockerIds = operation.projection?.blocked_by ?? [];
	const blockers: GithubIssue[] = [];
	for (const blockerId of blockerIds) {
		if (blockerId === operation.task_id)
			return result(operation.op, "ambiguous_remote_state", "a Task cannot block itself", parent.issue);
		const blocker = taskLookup(source.issues, source.repository.id, blockerId);
		if (blocker.kind === "missing") return result(operation.op, "permanent_failure", `blocking Task ${blockerId} has not been published`, parent.issue);
		if (blocker.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", blocker.message, parent.issue);
		const ownership = await confirmTerminalOwnership(root, gh, operation.op, source, blocker.issue);
		if (!("owned" in ownership)) return ownership;
		blockers.push(blocker.issue);
	}
	const body = childBody(source.repository, operation, parent.issue);
	const oversized = bodyLimitFailure(operation.op, body, MAX_TERMINAL_SUFFIX_BYTES);
	if (oversized) return oversized;
	const title = issueTitle(`${operation.initiative_id}/${operation.slice_id}`, operation.projection?.result ?? operation.goal);
	let child: GithubIssue;
	let createdChild = false;
	if (found.kind === "missing") {
		const mutation = await gh.run([
			"issue", "create", "--repo", source.repository.name_with_owner,
			"--title", title,
			"--body-file", "-",
		], { cwd: root, stdin: body });
		const refreshed = await snapshot(root, gh, operation.op);
		if ("contract" in refreshed) return refreshed;
		const created = lookup(refreshed.issues);
		if (created.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", created.message);
		if (created.kind === "missing") {
			return mutation.exit_code !== 0 && !mutation.timed_out && !mutation.output_exceeded
				? ghFailure(operation.op, mutation, "Task Issue creation failed")
				: result(operation.op, "retryable_failure", "Task creation could not be confirmed");
		}
		if (created.issue.body !== body || created.issue.title !== title)
			return result(operation.op, "retryable_failure", "Task Issue did not converge to the requested title and body", created.issue);
		child = created.issue;
		createdChild = true;
	} else {
		if (found.issue.body !== body || found.issue.title !== title)
			return result(operation.op, "permanent_failure", "Task Issue already exists with a different title or Agent Brief; edit the GitHub source or retry the original projection before changing native relations", found.issue);
		const owned = ownedTaskLookup(source.issues, source.repository.id, operation.task_id, operation.initiative_id, operation.slice_id);
		if (owned.kind !== "found") return result(operation.op, "ambiguous_remote_state", owned.kind === "ambiguous" ? owned.message : "Task Issue ownership changed during publication", found.issue);
		child = owned.issue;
	}
	const attachment = await confirmAttachment(root, gh, operation.op, source.repository, parent.issue.number, child.number);
	if (!("attached" in attachment)) return attachment;
	if (!attachment.attached) {
		const attach = await attachSubIssue(root, gh, operation.op, source.repository, parent.issue.number, child);
		if (!("attached" in attach)) return attach;
	}
	const dependencies = await confirmBlockedBy(root, gh, operation.op, source.repository, child.number, blockers);
	if (!("complete" in dependencies)) return dependencies;
	if (!dependencies.complete) {
		const attached = await attachBlockedBy(root, gh, operation.op, source.repository, child.number, blockers);
		if (!("complete" in attached)) return attached;
	}
	const finalSource = await snapshot(root, gh, operation.op);
	if ("contract" in finalSource) return finalSource;
	const finalChild = ownedTaskLookup(finalSource.issues, finalSource.repository.id, operation.task_id, operation.initiative_id, operation.slice_id);
	if (finalChild.kind !== "found" || finalChild.issue.id !== child.id || finalChild.issue.title !== title || finalChild.issue.body !== body)
		return result(operation.op, "ambiguous_remote_state", "Task Issue changed identity, title, or body during dependency publication", child);
	const finalChildOwnership = await confirmTerminalOwnership(root, gh, operation.op, finalSource, finalChild.issue);
	if (!("owned" in finalChildOwnership)) return finalChildOwnership;
	child = finalChild.issue;
	for (let index = 0; index < blockerIds.length; index += 1) {
		const current = taskLookup(finalSource.issues, finalSource.repository.id, blockerIds[index]);
		if (current.kind !== "found" || current.issue.id !== blockers[index].id)
			return result(operation.op, "ambiguous_remote_state", `blocking Task ${blockerIds[index]} changed ownership during dependency publication`, child);
		const ownership = await confirmTerminalOwnership(root, gh, operation.op, finalSource, current.issue);
		if (!("owned" in ownership)) return ownership;
	}
	const finalDependencies = await confirmBlockedBy(root, gh, operation.op, finalSource.repository, child.number, blockers);
	if (!("complete" in finalDependencies)) return finalDependencies;
	if (!finalDependencies.complete)
		return result(operation.op, "ambiguous_remote_state", "native blocked_by relations changed during dependency publication", child);
	if (attachment.attached && dependencies.complete)
		return createdChild
			? result(operation.op, "created", "Task Issue created and attached with native blocking relations", child)
			: result(operation.op, "already_current", "Task Issue, native Sub-issue relation, and blocking relations are current", child);
	return createdChild
		? result(operation.op, "created", "Task Issue created and attached as a native Sub-issue", child)
		: result(operation.op, "updated", "existing Task Issue attached as a native Sub-issue", child);
}

async function confirmTerminalOwnership(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	source: RepositorySnapshot,
	child: GithubIssue,
): Promise<GithubTrackerResult | { owned: true }> {
	const initiativeId = ownershipMarkerValue(child.body, "initiative-id");
	const sliceId = ownershipMarkerValue(child.body, "slice-id");
	if (!initiativeId || !sliceId)
		return result(operation, "ambiguous_remote_state", `Issue #${child.number} has invalid ownership markers`, child);
	const parent = initiativeLookup(source.issues, source.repository.id, initiativeId);
	if (parent.kind !== "found")
		return result(operation, "ambiguous_remote_state", parent.kind === "ambiguous" ? parent.message : `Issue #${child.number} has no exact Initiative Parent`, child);
	if (sliceCount(parent.issue.body, sliceId) !== 1)
		return result(operation, "ambiguous_remote_state", `Issue #${child.number} has no exact Slice in Parent #${parent.issue.number}`, child);
	const attachment = await confirmAttachment(root, gh, operation, source.repository, parent.issue.number, child.number);
	if (!("attached" in attachment)) return attachment;
	return attachment.attached
		? { owned: true }
		: result(operation, "ambiguous_remote_state", `Issue #${child.number} is not attached to its marker-bound Parent #${parent.issue.number}`, child);
}

async function closeTerminalIssue(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "mark-terminal" }>,
	source: RepositorySnapshot,
	issue: GithubIssue,
	lookup: (issues: GithubIssue[]) => IssueLookup,
): Promise<GithubTrackerResult> {
	const desiredReason = operation.phase === "done" ? "completed" : "not_planned";
	const close = await gh.run([
		"issue", "close", String(issue.number), "--repo", source.repository.name_with_owner,
		"--reason", operation.phase === "done" ? "completed" : "not planned",
	], { cwd: root });
	const refreshed = await snapshot(root, gh, operation.op);
	if ("contract" in refreshed) return refreshed;
	const found = lookup(refreshed.issues);
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	if (found.kind === "missing") return result(operation.op, "retryable_failure", "terminal Issue closure could not be confirmed");
	if (countLiteral(found.issue.body, terminalMarker(operation.terminal_event_id)) !== 1)
		return result(operation.op, "ambiguous_remote_state", "terminal Issue body changed during closure", found.issue);
	if (found.issue.state === "closed" && found.issue.state_reason === desiredReason)
		return result(operation.op, "updated", "terminal Task Issue closure confirmed", found.issue);
	return close.exit_code !== 0
		? ghFailure(operation.op, close, "terminal Issue closure failed")
		: result(operation.op, "retryable_failure", "terminal Issue closure did not converge", found.issue);
}

async function markTerminal(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "mark-terminal" }>,
	source: RepositorySnapshot,
): Promise<GithubTrackerResult> {
	const lookup = (issues: GithubIssue[]) => taskLookup(issues, source.repository.id, operation.task_id);
	const found = lookup(source.issues);
	if (found.kind === "missing") return result(operation.op, "already_current", "Task has no opted-in tracker association");
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	const issue = found.issue;
	const ownership = await confirmTerminalOwnership(root, gh, operation.op, source, issue);
	if (!("owned" in ownership)) return ownership;
	const existingEvents = [...issue.body.matchAll(/<!-- immune-brain:terminal-event=([A-Za-z0-9._:-]+) -->/g)];
	if (existingEvents.length > 1 || (existingEvents.length === 1 && existingEvents[0][1] !== operation.terminal_event_id))
		return result(operation.op, "ambiguous_remote_state", "terminal Issue conflicts with authoritative settlement", issue);
	const desiredReason = operation.phase === "done" ? "completed" : "not_planned";
	if (existingEvents.length === 1) {
		if (issue.state === "closed")
			return issue.state_reason === desiredReason
				? result(operation.op, "already_current", "terminal Task Issue is current", issue)
				: result(operation.op, "ambiguous_remote_state", "closed Issue reason conflicts with authoritative settlement", issue);
		return closeTerminalIssue(root, gh, operation, source, issue, lookup);
	}
	if (issue.state === "closed")
		return result(operation.op, "ambiguous_remote_state", "a manually closed nonterminal Task Issue is preserved and never reopened automatically", issue);
	const updated = `${issue.body.trimEnd()}${terminalSuffix(operation.terminal_event_id)}`;
	const oversized = bodyLimitFailure(operation.op, updated);
	if (oversized) return oversized;
	const edited = await gh.run([
		"issue", "edit", String(issue.number), "--repo", source.repository.name_with_owner,
		"--body-file", "-",
	], { cwd: root, stdin: updated });
	if (edited.exit_code !== 0 || edited.output_exceeded)
		return ghFailure(operation.op, edited, "terminal marker publication failed");
	const refreshed = await snapshot(root, gh, operation.op);
	if ("contract" in refreshed) return refreshed;
	const reread = lookup(refreshed.issues);
	if (reread.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", reread.message);
	if (reread.kind === "missing" || countLiteral(reread.issue.body, terminalMarker(operation.terminal_event_id)) !== 1)
		return result(operation.op, "retryable_failure", "terminal marker publication could not be confirmed");
	const refreshedOwnership = await confirmTerminalOwnership(root, gh, operation.op, refreshed, reread.issue);
	if (!("owned" in refreshedOwnership)) return refreshedOwnership;
	return closeTerminalIssue(root, gh, operation, refreshed, reread.issue, lookup);
}

function normalizedList(value: unknown, name: string, max = 2_000): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
	return value.map((item, index) => publicText(item, `${name}[${index}]`, max));
}

function projectionText(value: unknown, name: string, max = 2_000): string {
	const text = publicText(value, name, max);
	if (/(?:docs\/plans\/|\.intent\.json\b|internal[\s_-]+roles?|role[\s_-]+prompts?|review[\s_-]+reservations?|model[\s_-]+reservations?|prompt[\s_-]+digests?|kernel[\s_-]+runtimes?(?:[\s_-]+states?)?|runtime[\s_-]+states?|review[\s_-]+gates?|tool[\s_-]+polic(?:y|ies)|mutable[\s_-]+scopes?|scope[\s_-]+authorit(?:y|ies)|widen[\s_-]+scopes?|QA[\s_-]+settlements?|record_approval|submit_review|advance_assurance|request_authorization)/i.test(text))
		throw new Error(`${name} contains restricted authority context`);
	return text;
}

function normalizedProjectionList(value: unknown, name: string, max = 2_000): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
	return value.map((item, index) => projectionText(item, `${name}[${index}]`, max));
}

function projectionRisk(value: unknown): "routine" | "material" | "critical" {
	if (value === "routine" || value === "material" || value === "critical") return value;
	throw new Error("risk must be routine, material, or critical");
}

function normalizeProjection(value: TaskProjection | undefined): TaskProjection | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("projection must be an object");
	const blockedBy = normalizedProjectionList(value.blocked_by, "projection.blocked_by", 128)?.map((id) => identifier(id, "projection.blocked_by task_id"));
	if (blockedBy && new Set(blockedBy).size !== blockedBy.length) throw new Error("projection.blocked_by must not contain duplicate Task IDs");
	return {
		result: value.result === undefined ? undefined : projectionText(value.result, "projection.result"),
		current_behavior: value.current_behavior === undefined ? undefined : projectionText(value.current_behavior, "projection.current_behavior"),
		desired_behavior: value.desired_behavior === undefined ? undefined : projectionText(value.desired_behavior, "projection.desired_behavior"),
		key_interfaces: normalizedProjectionList(value.key_interfaces, "projection.key_interfaces", 500),
		verification: value.verification === undefined ? undefined : projectionText(value.verification, "projection.verification"),
		blocked_by: blockedBy,
		out_of_scope: normalizedProjectionList(value.out_of_scope, "projection.out_of_scope", 500),
		agent_handoff: value.agent_handoff === undefined ? undefined : projectionText(value.agent_handoff, "projection.agent_handoff"),
	};
}

function normalizeInitiativeProjection(value: InitiativeProjection | undefined): InitiativeProjection | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("projection must be an object");
	return {
		problem: value.problem === undefined ? undefined : projectionText(value.problem, "projection.problem"),
		result: value.result === undefined ? undefined : projectionText(value.result, "projection.result"),
		design: value.design === undefined ? undefined : projectionText(value.design, "projection.design"),
		decisions: normalizedProjectionList(value.decisions, "projection.decisions", 500),
		testing_strategy: value.testing_strategy === undefined ? undefined : projectionText(value.testing_strategy, "projection.testing_strategy"),
		out_of_scope: normalizedProjectionList(value.out_of_scope, "projection.out_of_scope", 500),
	};
}

function validateOperation(operation: TrackerOperation): TrackerOperation {
	if (operation.op === "create-initiative") {
		const seen = new Set<string>();
		const normalized: Extract<TrackerOperation, { op: "create-initiative" }> = {
			...operation,
			initiative_id: identifier(operation.initiative_id, "initiative_id"),
			goal: projectionText(operation.goal, "goal"),
			projection: normalizeInitiativeProjection(operation.projection),
			slices: operation.slices.map((slice, index) => {
				const id = identifier(slice.id, `slices[${index}].id`);
				if (seen.has(id)) throw new Error(`duplicate Slice id: ${id}`);
				seen.add(id);
				return {
				id,
				goal: projectionText(slice.goal, `slices[${index}].goal`, 1_000),
				result: slice.result === undefined ? undefined : projectionText(slice.result, `slices[${index}].result`, 1_000),
				blocked_by: normalizedList(slice.blocked_by, `slices[${index}].blocked_by`, 128)?.map((taskId, blockerIndex) =>
					identifier(projectionText(taskId, `slices[${index}].blocked_by[${blockerIndex}]`, 128), `slices[${index}].blocked_by task_id`)),
			};
			}),
		};
		issueTitle(normalized.initiative_id, normalized.projection?.result ?? normalized.goal);
		return normalized;
	}
	if (operation.op === "upsert-task") {
		const normalized: Extract<TrackerOperation, { op: "upsert-task" }> = {
			...operation,
			initiative_id: identifier(operation.initiative_id, "initiative_id"),
			task_id: identifier(operation.task_id, "task_id"),
			slice_id: identifier(operation.slice_id, "slice_id"),
			risk: projectionRisk(operation.risk),
			goal: projectionText(operation.goal, "goal"),
			projection: normalizeProjection(operation.projection),
			acceptance: operation.acceptance.map((item, index) => ({
				id: identifier(item.id, `acceptance[${index}].id`),
				summary: projectionText(item.summary, `acceptance[${index}].summary`, 500),
			})),
		};
		issueTitle(`${normalized.initiative_id}/${normalized.slice_id}`, normalized.projection?.result ?? normalized.goal);
		return normalized;
	}
	return {
		...operation,
		task_id: identifier(operation.task_id, "task_id"),
		terminal_event_id: terminalEvent(operation.terminal_event_id),
	};
}

export async function runGithubTrackerOperation(
	root: string,
	input: TrackerOperation,
	gh: GhTransport = createGhTransport(),
): Promise<GithubTrackerResult> {
	let operation: TrackerOperation;
	try {
		operation = validateOperation(input);
	} catch (error) {
		return result(input.op, "permanent_failure", error instanceof Error ? error.message : String(error));
	}
	const absoluteRoot = resolve(root);
	if (operation.op !== "mark-terminal") {
		const conflict = carrierConflict(absoluteRoot, operation.op, operation.initiative_id);
		if (conflict) return conflict;
	}
	const source = await snapshot(absoluteRoot, gh, operation.op);
	if ("contract" in source) return source;
	switch (operation.op) {
		case "create-initiative": return createInitiative(absoluteRoot, gh, operation, source);
		case "upsert-task": return upsertTask(absoluteRoot, gh, operation, source);
		case "mark-terminal": return markTerminal(absoluteRoot, gh, operation, source);
	}
}

function publicationResult(
	status: TrackerStatus,
	message: string,
	initiative?: GithubTrackerResult,
	tasks: GithubInitiativePublicationResult["tasks"] = [],
	execution?: GithubInitiativePublicationResult["execution"],
): GithubInitiativePublicationResult {
	return {
		contract: "immune_brain/github_initiative_publication/v1",
		operation: "publish-initiative",
		status,
		...(initiative ? { initiative } : {}),
		tasks,
		...(execution ? { execution } : {}),
		message: redactGithubDiagnostic(message),
	};
}

interface PreparedPublicationTask {
	operation: Extract<TrackerOperation, { op: "upsert-task" }>;
	intent_path: string;
	intent_content_hash: string;
}

function publicationPlan(operations: Array<Extract<TrackerOperation, { op: "upsert-task" }>>): {
	order: Array<Extract<TrackerOperation, { op: "upsert-task" }>>;
	parallel_groups: string[][];
} {
	const remaining = new Set(operations.map((operation) => operation.task_id));
	const done = new Set<string>();
	const order: Array<Extract<TrackerOperation, { op: "upsert-task" }>> = [];
	const parallelGroups: string[][] = [];
	while (remaining.size) {
		const ready = operations.filter((operation) => remaining.has(operation.task_id)
			&& (operation.projection?.blocked_by ?? []).every((taskId) => done.has(taskId)));
		if (!ready.length) throw new Error("Initiative Task dependencies must form an acyclic graph");
		parallelGroups.push(ready.map((operation) => operation.task_id));
		for (const operation of ready) {
			remaining.delete(operation.task_id);
			done.add(operation.task_id);
			order.push(operation);
		}
	}
	return { order, parallel_groups: parallelGroups };
}

function preflightPublication(root: string, input: InitiativePublicationInput): {
	initiative: Extract<TrackerOperation, { op: "create-initiative" }>;
	order: Array<Extract<TrackerOperation, { op: "upsert-task" }>>;
	parallel_groups: string[][];
	intent_bindings: Map<string, Pick<PreparedPublicationTask, "intent_path" | "intent_content_hash">>;
} {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("publication must be an object");
	if (!Array.isArray(input.tasks) || input.tasks.length < 2)
		throw new Error("a complete Initiative publication requires at least two Tasks");
	if (!input.projection || typeof input.projection !== "object" || Array.isArray(input.projection))
		throw new Error("publication projection must be an object");
	for (const field of ["problem", "result", "design"] as const) {
		if (input.projection[field] === undefined)
			throw new Error(`a complete Initiative publication requires projection.${field}`);
	}
	const publications = input.tasks.map((task, index) => {
		if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`tasks[${index}] must be an object`);
		if (typeof task.intent !== "string") throw new Error(`tasks[${index}].intent must be a string`);
		return taskPublication(root, input.initiative_id, task.slice_id, task.intent, task.projection);
	});
	const operations = publications.map((publication) => publication.operation);
	const taskIds = new Set<string>();
	const sliceIds = new Set<string>();
	for (const operation of operations) {
		if (taskIds.has(operation.task_id)) throw new Error(`duplicate Task id: ${operation.task_id}`);
		if (sliceIds.has(operation.slice_id)) throw new Error(`duplicate Slice id: ${operation.slice_id}`);
		taskIds.add(operation.task_id);
		sliceIds.add(operation.slice_id);
	}
	for (const operation of operations) {
		for (const blocker of operation.projection?.blocked_by ?? []) {
			if (!taskIds.has(blocker)) throw new Error(`Task ${operation.task_id} depends on ${blocker}, which is outside the complete Initiative batch`);
		}
	}
	const plan = publicationPlan(operations);
	const initiative = validateOperation({
		op: "create-initiative",
		initiative_id: input.initiative_id,
		goal: input.goal,
		projection: input.projection,
		slices: operations.map((operation) => ({
			id: operation.slice_id,
			goal: operation.goal,
			result: operation.projection?.result,
			blocked_by: operation.projection?.blocked_by,
		})),
	}) as Extract<TrackerOperation, { op: "create-initiative" }>;
	const intentBindings = new Map(publications.map((publication) => [publication.operation.task_id, {
		intent_path: publication.intent_path,
		intent_content_hash: publication.intent_content_hash,
	}]));
	return { initiative, ...plan, intent_bindings: intentBindings };
}

function publicationIntentDrift(
	root: string,
	bindings: Map<string, Pick<PreparedPublicationTask, "intent_path" | "intent_content_hash">>,
	taskIds: Iterable<string> = bindings.keys(),
): string | null {
	for (const taskId of taskIds) {
		const expected = bindings.get(taskId);
		if (!expected) return `TaskIntent ${taskId} is missing its publication binding`;
		try {
			const current = readTaskIntent(root, taskId);
			if (current.intent_ref.path !== expected.intent_path || current.content_hash !== expected.intent_content_hash)
				return `TaskIntent ${taskId} changed during Initiative publication`;
		} catch (error) {
			return `TaskIntent ${taskId} became unreadable during Initiative publication: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	return null;
}

function publicationIssueDrift(expected: {
	issue_number?: number;
	issue_url?: string;
	node_id?: string;
}, actual: GithubIssue, title: string, body: string, label: string): string | null {
	if (expected.issue_number !== actual.number || expected.issue_url !== actual.url || expected.node_id !== String(actual.id))
		return `${label} identity changed during Initiative publication`;
	if (actual.state !== "open") return `${label} is no longer open`;
	if (actual.title !== title || actual.body !== body) return `${label} content changed during Initiative publication`;
	return null;
}

export async function runGithubInitiativePublication(
	root: string,
	input: InitiativePublicationInput,
	gh: GhTransport = createGhTransport(),
): Promise<GithubInitiativePublicationResult> {
	const absoluteRoot = resolve(root);
	let prepared: ReturnType<typeof preflightPublication>;
	try {
		prepared = preflightPublication(absoluteRoot, input);
	} catch (error) {
		return publicationResult("permanent_failure", error instanceof Error ? error.message : String(error));
	}
	const conflict = carrierConflict(absoluteRoot, "create-initiative", prepared.initiative.initiative_id);
	if (conflict) return publicationResult(conflict.status, conflict.message, conflict);
	const initial = await snapshot(absoluteRoot, gh, "create-initiative");
	if ("contract" in initial) return publicationResult(initial.status, initial.message, initial);
	const initialParent = initiativeLookup(initial.issues, initial.repository.id, prepared.initiative.initiative_id);
	if (initialParent.kind === "ambiguous") return publicationResult("ambiguous_remote_state", initialParent.message);
	const parentForPreflight = initialParent.kind === "found" ? initialParent.issue : {
		id: Number.MAX_SAFE_INTEGER,
		number: Number.MAX_SAFE_INTEGER,
		url: `https://github.com/${initial.repository.name_with_owner}/issues/${Number.MAX_SAFE_INTEGER}`,
		title: "",
		body: "",
		state: "open" as const,
		state_reason: null,
	};
	const parentBodyFailure = bodyLimitFailure("create-initiative", createInitiativeBody(initial.repository, prepared.initiative));
	if (parentBodyFailure) return publicationResult(parentBodyFailure.status, parentBodyFailure.message, parentBodyFailure);
	for (const operation of prepared.order) {
		const childFailure = bodyLimitFailure("upsert-task", childBody(initial.repository, operation, parentForPreflight), MAX_TERMINAL_SUFFIX_BYTES);
		if (childFailure) return publicationResult(childFailure.status, childFailure.message, childFailure);
	}

	const beforeParentWrite = publicationIntentDrift(absoluteRoot, prepared.intent_bindings);
	if (beforeParentWrite) return publicationResult("ambiguous_remote_state", beforeParentWrite);
	const parentResult = await runGithubTrackerOperation(absoluteRoot, prepared.initiative, gh);
	if (!isSuccessfulTrackerStatus(parentResult.status))
		return publicationResult(parentResult.status, parentResult.message, parentResult);
	const taskResults: GithubInitiativePublicationResult["tasks"] = [];
	for (const operation of prepared.order) {
		const intentDrift = publicationIntentDrift(absoluteRoot, prepared.intent_bindings, [operation.task_id]);
		if (intentDrift) return publicationResult("ambiguous_remote_state", intentDrift, parentResult, taskResults);
		const taskResult = await runGithubTrackerOperation(absoluteRoot, operation, gh);
		taskResults.push({
			task_id: operation.task_id,
			slice_id: operation.slice_id,
			status: taskResult.status,
			...(taskResult.issue_number === undefined ? {} : { issue_number: taskResult.issue_number }),
			...(taskResult.issue_url === undefined ? {} : { issue_url: taskResult.issue_url }),
			...(taskResult.node_id === undefined ? {} : { node_id: taskResult.node_id }),
		});
		if (!isSuccessfulTrackerStatus(taskResult.status))
			return publicationResult(taskResult.status, taskResult.message, parentResult, taskResults);
	}

	const finalIntentDrift = publicationIntentDrift(absoluteRoot, prepared.intent_bindings);
	if (finalIntentDrift) return publicationResult("ambiguous_remote_state", finalIntentDrift, parentResult, taskResults);
	const finalSource = await snapshot(absoluteRoot, gh, "upsert-task");
	if ("contract" in finalSource) return publicationResult(finalSource.status, finalSource.message, parentResult, taskResults);
	const parent = initiativeLookup(finalSource.issues, finalSource.repository.id, prepared.initiative.initiative_id);
	if (parent.kind !== "found") return publicationResult("ambiguous_remote_state", parent.kind === "ambiguous" ? parent.message : "published Initiative Parent disappeared", parentResult, taskResults);
	const parentDrift = publicationIssueDrift(
		parentResult,
		parent.issue,
		issueTitle(prepared.initiative.initiative_id, prepared.initiative.projection?.result ?? prepared.initiative.goal),
		createInitiativeBody(finalSource.repository, prepared.initiative),
		"Initiative Parent",
	);
	if (parentDrift) return publicationResult("ambiguous_remote_state", parentDrift, parentResult, taskResults);
	const resultByTask = new Map(taskResults.map((task) => [task.task_id, task]));
	const expectedNumbers: number[] = [];
	for (const operation of prepared.order) {
		const child = ownedTaskLookup(finalSource.issues, finalSource.repository.id, operation.task_id, operation.initiative_id, operation.slice_id);
		if (child.kind !== "found") return publicationResult("ambiguous_remote_state", child.kind === "ambiguous" ? child.message : `published Task ${operation.task_id} disappeared`, parentResult, taskResults);
		const childResult = resultByTask.get(operation.task_id);
		if (!childResult) return publicationResult("ambiguous_remote_state", `published Task ${operation.task_id} has no batch result`, parentResult, taskResults);
		const childDrift = publicationIssueDrift(
			childResult,
			child.issue,
			issueTitle(`${operation.initiative_id}/${operation.slice_id}`, operation.projection?.result ?? operation.goal),
			childBody(finalSource.repository, operation, parent.issue),
			`Task ${operation.task_id}`,
		);
		if (childDrift) return publicationResult("ambiguous_remote_state", childDrift, parentResult, taskResults);
		expectedNumbers.push(child.issue.number);
		const ownership = await confirmTerminalOwnership(absoluteRoot, gh, "upsert-task", finalSource, child.issue);
		if (!("owned" in ownership)) return publicationResult(ownership.status, ownership.message, parentResult, taskResults);
		const blockers: GithubIssue[] = [];
		for (const blockerId of operation.projection?.blocked_by ?? []) {
			const blocker = taskLookup(finalSource.issues, finalSource.repository.id, blockerId);
			if (blocker.kind !== "found") return publicationResult("ambiguous_remote_state", `published blocker ${blockerId} disappeared`, parentResult, taskResults);
			blockers.push(blocker.issue);
		}
		const dependencies = await confirmBlockedBy(absoluteRoot, gh, "upsert-task", finalSource.repository, child.issue.number, blockers);
		if (!("complete" in dependencies)) return publicationResult(dependencies.status, dependencies.message, parentResult, taskResults);
		if (!dependencies.complete) return publicationResult("ambiguous_remote_state", `Task ${operation.task_id} has incomplete blocking relations`, parentResult, taskResults);
	}
	const attached = await readSubIssueNumbers(absoluteRoot, gh, "upsert-task", finalSource.repository, parent.issue.number);
	if (!Array.isArray(attached)) return publicationResult(attached.status, attached.message, parentResult, taskResults);
	const sortedAttached = [...attached].sort((left, right) => left - right);
	const sortedExpected = [...expectedNumbers].sort((left, right) => left - right);
	if (sortedAttached.length !== sortedExpected.length || sortedAttached.some((number, index) => number !== sortedExpected[index]))
		return publicationResult("ambiguous_remote_state", "Initiative Parent Sub-issues do not match the complete publication batch", parentResult, taskResults);
	const statuses = [parentResult.status, ...taskResults.map((task) => task.status)];
	const status: TrackerStatus = statuses.every((item) => item === "created")
		? "created"
		: statuses.every((item) => item === "already_current") ? "already_current" : "updated";
	const issueByTask = new Map(taskResults.map((task) => [task.task_id, task.issue_number]));
	if ([...issueByTask.values()].some((number) => number === undefined))
		return publicationResult("ambiguous_remote_state", "published Task result is missing an Issue number", parentResult, taskResults);
	const issueNumber = (taskId: string): number => issueByTask.get(taskId)!;
	const firstTaskId = prepared.order[0].task_id;
	return publicationResult(status, "complete Initiative Parent, Children, and dependency graph published", parentResult, taskResults, {
		recommended_first_task_id: firstTaskId,
		recommended_first_issue_number: issueNumber(firstTaskId),
		order: prepared.order.map((operation) => operation.task_id),
		issue_order: prepared.order.map((operation) => issueNumber(operation.task_id)),
		parallel_groups: prepared.parallel_groups,
		parallel_issue_groups: prepared.parallel_groups.map((group) => group.map(issueNumber)),
	});
}

function isSuccessfulTrackerStatus(status: TrackerStatus): boolean {
	return status === "created" || status === "updated" || status === "already_current";
}

function taskPublication(root: string, initiativeId: string, sliceId: string, intentPath: string, projection?: TaskProjection): PreparedPublicationTask {
	const absoluteRoot = resolve(root);
	const absolutePath = resolve(absoluteRoot, intentPath);
	const rel = relative(absoluteRoot, absolutePath);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("TaskIntent path escapes the repository");
	const filename = basename(rel);
	if (!filename.endsWith(".intent.json")) throw new Error("TaskIntent path must name a canonical sidecar");
	const taskId = identifier(filename.slice(0, -".intent.json".length), "task_id");
	const read = readTaskIntent(absoluteRoot, taskId);
	if (read.intent_ref.path !== rel) throw new Error("TaskIntent path must match its canonical sidecar path");
	const intent = read.intent;
	return {
		operation: validateOperation({
			op: "upsert-task",
			initiative_id: initiativeId,
			task_id: intent.task_id,
			slice_id: sliceId,
			goal: intent.goal,
			risk: intent.risk,
			acceptance: intent.acceptance.map((item) => ({ id: item.id, summary: item.assertion })),
			projection,
		}) as Extract<TrackerOperation, { op: "upsert-task" }>,
		intent_path: read.intent_ref.path,
		intent_content_hash: read.content_hash,
	};
}

export async function runGithubTrackerCli(
	args: string[],
	root: string,
	options: { gh?: GhTransport; stdin?: () => string } = {},
): Promise<{ stdout: string; stderr: string; returncode: number }> {
	const op = args[0];
	if (!args.includes("--json"))
		return { stdout: "", stderr: "invalid_tracker_command: --json is required\n", returncode: 2 };
	try {
		if (op !== "publish-initiative" || args.length !== 3 || args[1] !== "--stdin")
			throw new Error("use publish-initiative --stdin --json");
		const raw = JSON.parse((options.stdin ?? (() => readFileSync(0, "utf8")))()) as InitiativePublicationInput;
		const published = await runGithubInitiativePublication(root, raw, options.gh);
		return {
			stdout: `${JSON.stringify(published, null, 2)}\n`,
			stderr: "",
			returncode: isSuccessfulTrackerStatus(published.status) ? 0 : 1,
		};
	} catch (error) {
		return {
			stdout: "",
			stderr: `invalid_tracker_command: ${redactGithubDiagnostic(error instanceof Error ? error.message : String(error))}\n`,
			returncode: 2,
		};
	}
}
