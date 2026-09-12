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
const MAX_TITLE_LENGTH = 80;
const MAX_DISPLAY_SHORT_NAME = 32;
const MAX_DISPLAY_TITLE = 60;
const READY_FOR_AGENT_LABEL = "ready-for-agent";
const BLOCKED_LABEL = "blocked";
const MANAGED_ISSUE_LABELS: readonly string[] = [READY_FOR_AGENT_LABEL, BLOCKED_LABEL];

/** Single compressed Activity/Authority footer shared by Parent and Task Issues. */
const ISSUE_FOOTER = "---\n\n_Outbound visibility only: GitHub state never authorizes or settles work — Kernel TaskIntent, TaskRecord, QA, Review, and Assurance remain the execution authority. An Open Issue only means the Task still needs attention; only a claimless terminal projection closes it (`done` → Completed, `stopped` → Not planned)._";

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
	short_name?: string;
	title?: string;
	source_issue?: string;
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
		acceptance: Array<{ id: string; summary: string }>;
		projection?: TaskProjection;
	}>;
	/**
	 * Explicit amendment input: binds the caller's desired pending frontier to
	 * the exact observed remote content it was approved against, and declares
	 * read-only historical Child identities. When omitted, publication keeps
	 * today's strict default semantics (create once, never rewrite).
	 */
	amendment?: {
		parent: InitiativeAmendmentBinding;
		tasks: Array<InitiativeTaskAmendment>;
		historical: InitiativeHistoricalChild[];
	};
}

/** Identity plus expected remote title/body/state for one bound Issue. */
export interface InitiativeAmendmentBinding {
	issue_number: number;
	title: string;
	body: string;
	state: "open" | "closed";
}

export interface InitiativeTaskAmendment {
	task_id: string;
	binding?: InitiativeAmendmentBinding;
}

export interface InitiativeHistoricalChild {
	task_id: string;
	binding: InitiativeAmendmentBinding;
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

export interface GithubInitiativeObservation {
	contract: "immune_brain/github_initiative_observation/v1";
	initiative_id: string;
	issue_number: number;
	tasks: Array<{
		task_id: string;
		slice_id: string;
		issue_number: number;
		blocked_by: string[];
	}>;
}

export interface TaskProjection {
	short_name?: string;
	title?: string;
	slice_ordinal?: number;
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
	labels: string[];
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
	// The suffix parser reports failures through the string sentinels "multiple"
	// and "malformed"; an event id equal to either sentinel would make valid
	// terminal evidence indistinguishable from a parser failure. Reject at the
	// validation boundary so no published marker can ever collide.
	if (value === "multiple" || value === "malformed")
		throw new Error(`terminal_event_id must not be the reserved parser sentinel: ${value}`);
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

/**
 * A Planner-supplied display name for an Issue title. Display names are the
 * only title source: the full goal/result prose stays in the body, and a
 * missing or oversized display name fails closed instead of being truncated.
 */
function displayName(value: unknown, name: string, max: number): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${name} is required: publish a bounded display name instead of the full goal text`);
	// Brackets are rejected on the raw value: redaction later introduces its own
	// bracketed marker, which must never be mistaken for caller-supplied syntax.
	if (/[[\]]/.test(value)) throw new Error(`${name} must not contain square brackets`);
	return projectionText(value, name, max);
}

function issueTitle(value: string): string {
	const title = titleText(value);
	if (title.length > MAX_TITLE_LENGTH)
		throw new Error(`GitHub Issue title must not exceed ${MAX_TITLE_LENGTH} characters: shorten the Planner display names`);
	return title;
}

function initiativeDisplayNames(projection: InitiativeProjection | undefined): { shortName: string } {
	const missing = (["short_name", "title"] as const).filter((field) => projection?.[field] === undefined);
	if (missing.length)
		throw new Error(`Initiative projection requires display names; missing ${missing.map((field) => `projection.${field}`).join(", ")}`);
	return { shortName: displayName(projection?.short_name, "projection.short_name", MAX_DISPLAY_SHORT_NAME) };
}

function initiativeIssueTitle(initiativeId: string, projection: InitiativeProjection | undefined): string {
	const { shortName } = initiativeDisplayNames(projection);
	const title = displayName(projection?.title, "projection.title", MAX_DISPLAY_TITLE);
	return issueTitle(`[${shortName}] ${title}`);
}

function taskDisplayNames(operation: Extract<TrackerOperation, { op: "upsert-task" }>): { shortName: string; title: string; ordinal: number } {
	const projection = operation.projection;
	if (projection?.short_name === undefined || projection.title === undefined || projection.slice_ordinal === undefined)
		throw new Error(`Task ${operation.task_id} requires projection.short_name, projection.title, and projection.slice_ordinal display names`);
	return {
		shortName: displayName(projection.short_name, "projection.short_name", MAX_DISPLAY_SHORT_NAME),
		title: displayName(projection.title, "projection.title", MAX_DISPLAY_TITLE),
		ordinal: projection.slice_ordinal,
	};
}

function taskIssueTitle(operation: Extract<TrackerOperation, { op: "upsert-task" }>, fallbackOrdinal?: number): string {
	const { shortName, title, ordinal } = taskDisplayNames(operation);
	return issueTitle(`[${shortName}] S${fallbackOrdinal ?? ordinal} ${title}`);
}

/**
 * The Slice position in the Initiative: the Parent's Slices checklist is the
 * declared order, so a Child keeps the same `S<n>` across amendment batches
 * instead of renumbering to its position inside the current batch.
 */
function sliceOrdinalFromChecklist(parentBody: string, sliceId: string, fallback: number): number {
	const declared = [...parentBody.matchAll(/^- \[[ xX]\] <!-- immune-brain:slice-id=([A-Za-z0-9._:-]+) -->/gm)].map((match) => match[1]);
	const index = declared.indexOf(sliceId);
	return index === -1 ? fallback : index + 1;
}

/** Labels a published Task Issue must carry; the Parent carries none of them. */
function desiredTaskLabels(operation: Extract<TrackerOperation, { op: "upsert-task" }>): string[] {
	return (operation.projection?.blocked_by ?? []).length
		? [READY_FOR_AGENT_LABEL, BLOCKED_LABEL]
		: [READY_FOR_AGENT_LABEL];
}

/** Converge managed labels from the observed set: add what is desired, remove only managed labels that are not. */
function labelMutationArgs(observed: string[], desired: string[]): string[] {
	const args: string[] = [];
	for (const label of desired) if (!observed.includes(label)) args.push("--add-label", label);
	for (const label of MANAGED_ISSUE_LABELS)
		if (observed.includes(label) && !desired.includes(label)) args.push("--remove-label", label);
	return args;
}

async function repositoryLabels(root: string, gh: GhTransport, repository: RepositoryInfo): Promise<string[] | GithubTrackerResult> {
	const execution = await gh.run(
		["label", "list", "--repo", repository.name_with_owner, "--json", "name", "--limit", "1000"],
		{ cwd: root },
	);
	if (execution.exit_code !== 0 || execution.output_exceeded)
		return ghFailure("upsert-task", execution, "cannot query repository labels");
	try {
		const parsed = JSON.parse(execution.stdout) as unknown;
		if (!Array.isArray(parsed)) throw new Error("gh returned malformed label list");
		return parsed
			.map((item) => (item as { name?: unknown })?.name)
			.filter((name): name is string => typeof name === "string");
	} catch (error) {
		return result("upsert-task", "permanent_failure", error instanceof Error ? error.message : String(error));
	}
}

/**
 * Labels are never created by the tracker: a repository missing a required
 * label fails closed before any Issue mutation, naming the exact label.
 */
async function labelAvailabilityFailure(
	root: string,
	gh: GhTransport,
	repository: RepositoryInfo,
	required: string[],
): Promise<GithubTrackerResult | null> {
	if (!required.length) return null;
	const labels = await repositoryLabels(root, gh, repository);
	if (!Array.isArray(labels)) return labels;
	const missing = required.filter((label) => !labels.includes(label));
	return missing.length
		? result("upsert-task", "permanent_failure", `repository labels missing: ${missing.join(", ")}; create them before publishing so Task Issues carry publication state`)
		: null;
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
				let stdout: Buffer = Buffer.alloc(0);
				let stderr: Buffer = Buffer.alloc(0);
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
				const append = (current: Buffer, chunk: Uint8Array): Buffer => {
					const available = Math.max(0, MAX_GH_OUTPUT - stdout.length - stderr.length);
					if (chunk.length > available) {
						outputExceeded = true;
						child.kill("SIGKILL");
					}
					return available > 0 ? Buffer.concat([current, chunk.subarray(0, available)]) : current;
				};
				const { stdout: childOut, stderr: childErr, stdin: childIn } = child;
				if (!childOut || !childErr || !childIn) {
					finish(1, "gh was spawned without the stdio pipes this reader requires");
					return;
				}
				childOut.on("data", (chunk: Uint8Array) => { stdout = append(stdout, chunk); });
				childErr.on("data", (chunk: Uint8Array) => { stderr = append(stderr, chunk); });
				child.once("error", (error) => { finish(1, error.message); });
				childIn.once("error", (error) => { finish(1, error.message); });
				timer = setTimeout(() => {
					timedOut = true;
					child.kill("SIGKILL");
				}, GH_TIMEOUT_MS);
				child.once("close", (code) => { finish(code ?? 1); });
				try {
					childIn.end(options.stdin ?? "");
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
				labels: Array.isArray(item.labels)
					? item.labels
						.map((label) => (typeof label === "string" ? label : (label as { name?: unknown })?.name))
						.filter((name): name is string => typeof name === "string")
					: [],
			};
		});
}

function parseSubIssueNumbers(raw: string): number[] {
	const parsed = JSON.parse(raw) as unknown;
	const pages = Array.isArray(parsed) && parsed.every(Array.isArray) ? parsed.flat() : parsed;
	if (!Array.isArray(pages)) throw new Error("gh returned malformed Sub-issue list");
	return pages.map((item, index) => {
		const number = (item as { number?: unknown })?.number;
		if (typeof number !== "number" || !Number.isSafeInteger(number)) throw new Error(`gh returned a malformed Sub-issue entry at ${index}`);
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

export async function observeGithubInitiative(
	root: string,
	initiativeId: string,
	gh: GhTransport = createGhTransport(),
): Promise<GithubInitiativeObservation> {
	const id = identifier(initiativeId, "initiative_id");
	const source = await snapshot(resolve(root), gh, "create-initiative");
	if ("contract" in source) throw new Error(source.message);
	const parent = initiativeLookup(source.issues, source.repository.id, id);
	if (parent.kind === "missing") throw new Error(`Initiative ${id} is not published`);
	if (parent.kind === "ambiguous") throw new Error(parent.message);
	const subIssueNumbers = await readSubIssueNumbers(root, gh, "create-initiative", source.repository, parent.issue.number);
	if (!Array.isArray(subIssueNumbers)) throw new Error(subIssueNumbers.message);
	if (new Set(subIssueNumbers).size !== subIssueNumbers.length)
		throw new Error(`Initiative ${id} has duplicate native Sub-issue relations`);
	const tasks = subIssueNumbers.map((issueNumber) => {
		const matches = source.issues.filter((issue) => issue.number === issueNumber);
		if (matches.length !== 1) throw new Error(`Initiative ${id} references an unreadable Sub-issue #${issueNumber}`);
		const issue = matches[0];
		const taskId = ownershipMarkerValue(issue.body, "task-id");
		const sliceId = ownershipMarkerValue(issue.body, "slice-id");
		if (!taskId || !sliceId || ownershipMarkerValue(issue.body, "initiative-id") !== id)
			throw new Error(`Sub-issue #${issueNumber} has invalid Initiative ownership markers`);
		const owned = ownedTaskLookup(source.issues, source.repository.id, taskId, id, sliceId);
		if (owned.kind !== "found" || owned.issue.number !== issueNumber)
			throw new Error(owned.kind === "ambiguous" ? owned.message : `Sub-issue #${issueNumber} has invalid Task ownership`);
		return { task_id: taskId, slice_id: sliceId, issue_number: issueNumber, issue_id: issue.id };
	});
	if (new Set(tasks.map((task) => task.task_id)).size !== tasks.length)
		throw new Error(`Initiative ${id} has duplicate Task identities`);
	if (new Set(tasks.map((task) => task.slice_id)).size !== tasks.length)
		throw new Error(`Initiative ${id} has duplicate Slice identities`);
	const taskByIssueId = new Map(tasks.map((task) => [task.issue_id, task.task_id]));
	const observed: GithubInitiativeObservation["tasks"] = [];
	for (const task of tasks.sort((left, right) => left.task_id < right.task_id ? -1 : left.task_id > right.task_id ? 1 : 0)) {
		const blockerIds = await readBlockedByIds(root, gh, "create-initiative", source.repository, task.issue_number);
		if (!Array.isArray(blockerIds)) throw new Error(blockerIds.message);
		const blockedBy = blockerIds.map((blockerId) => {
			const blocker = taskByIssueId.get(blockerId);
			if (!blocker) throw new Error(`Task ${task.task_id} depends on an Issue outside Initiative ${id}`);
			return blocker;
		}).sort();
		observed.push({
			task_id: task.task_id,
			slice_id: task.slice_id,
			issue_number: task.issue_number,
			blocked_by: blockedBy,
		});
	}
	return {
		contract: "immune_brain/github_initiative_observation/v1",
		initiative_id: id,
		issue_number: parent.issue.number,
		tasks: observed,
	};
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

function createInitiativeBody(
	repository: RepositoryInfo,
	operation: Extract<TrackerOperation, { op: "create-initiative" }>,
	historicalSlices: string[] = [],
): string {
	const projection = operation.projection ?? {};
	const provenance = projection.source_issue
		? `## Provenance\n\n- Derived from #${projection.source_issue}: the originating feature Issue for this Initiative.\n\n`
		: "";
	return `${[
		PROTOCOL_MARKER,
		KIND_INITIATIVE_MARKER,
		marker("repo-id", repository.id),
		marker("initiative-id", operation.initiative_id),
	].join("\n")}\n\n${provenance}## How to use this Issue\n\n- Edit planning prose and Slice ordering directly after creation.\n- Keep each Slice marker attached to exactly one stable Slice entry.\n- The tracker never rewrites or closes this Parent after creation; the tracker never changes or closes it automatically.\n\n## Problem\n\n${publicText(projection.problem ?? "The Initiative addresses the bounded delivery described below.", "projection.problem")}\n\n## Result\n\n${publicText(projection.result ?? operation.goal, "projection.result")}\n\n## Initiative design\n\n${publicText(projection.design ?? "Each Child preserves the shared Initiative decisions and boundaries recorded here.", "projection.design")}\n\n## Decisions\n\n${listText(projection.decisions, "- No additional Initiative decisions recorded.")}\n\n## Testing strategy\n\n${publicText(projection.testing_strategy ?? "Each Child closes from its focused acceptance verification.", "projection.testing_strategy")}\n\n## Out of scope\n\n${listText(projection.out_of_scope, "- Unrelated work outside this Initiative.")}\n\n## Slices\n\n${operation.slices.length + historicalSlices.length === 0 ? "No Slices recorded yet." : [...historicalSlices, ...operation.slices.map((slice) => `- [ ] ${marker("slice-id", slice.id)} **${slice.id}**: ${slice.result ?? slice.goal}${slice.blocked_by?.length ? ` (blocked by: ${slice.blocked_by.join(", ")})` : ""}`)].join("\n")}\n\n${ISSUE_FOOTER}\n`;
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
	const title = initiativeIssueTitle(operation.initiative_id, operation.projection);
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
	if (found.issue.body === body && found.issue.title === title) {
		// A repeated complete batch is a convergence pass: managed labels the Parent
		// must not carry are repaired here, without rewriting its content.
		const labelArgs = labelMutationArgs(found.issue.labels, []);
		if (labelArgs.length) {
			const edited = await gh.run([
				"issue", "edit", String(found.issue.number), "--repo", source.repository.name_with_owner,
				...labelArgs,
			], { cwd: root });
			if (edited.exit_code !== 0 || edited.output_exceeded)
				return ghFailure(operation.op, edited, "Initiative Parent label convergence failed");
			const refreshed = await snapshot(root, gh, operation.op);
			if ("contract" in refreshed) return refreshed;
			const confirmed = lookup(refreshed.issues);
			if (confirmed.kind !== "found")
				return result(operation.op, "ambiguous_remote_state", "Initiative Parent became ambiguous after label convergence", found.issue);
			return confirmed.issue.title === title && confirmed.issue.body === body && !labelMutationArgs(confirmed.issue.labels, []).length
				? result(operation.op, "updated", "Initiative Issue managed labels converged", confirmed.issue)
				: result(operation.op, "retryable_failure", "Initiative Issue did not converge to an unlabeled Parent", confirmed.issue);
		}
		return result(operation.op, "already_current", "Initiative Issue already carries the requested initial source", found.issue);
	}
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
	].join("\n")}\n\n## Parent\n\n| Initiative | \`${operation.initiative_id}\` |\n| Parent Issue | [#${parent.number}](${parent.url}) |\n| Slice | \`${operation.slice_id}\` |\n| Risk | \`${operation.risk}\` |\n\n## Current behavior\n\n${publicText(projection.current_behavior ?? "The current behavior is defined by the repository's existing contract.", "projection.current_behavior")}\n\n## Desired behavior\n\n${publicText(projection.desired_behavior ?? projection.result ?? operation.goal, "projection.desired_behavior")}\n\n## Key interfaces\n\n${listText(projection.key_interfaces, "- Canonical TaskIntent acceptance and Kernel lifecycle remain authoritative.")}\n\n## Acceptance criteria\n\n${acceptance}\n\n## Verification\n\n${publicText(projection.verification ?? "Run the focused acceptance verification declared by the TaskIntent.", "projection.verification")}\n\n## Blocked by\n\n${projection.blocked_by?.length ? projection.blocked_by.map((id) => `- \`${identifier(id, "blocked_by task_id")}\``).join("\n") : "None"}\n\n## Out of scope\n\n${listText(projection.out_of_scope, "- Scope not declared by the validated TaskIntent.")}\n\n## Agent handoff\n\n${publicText(projection.agent_handoff ?? "Implement only the bounded TaskIntent result and run the focused checks. Do not widen scope or treat GitHub as authorization.", "projection.agent_handoff")}\n\n${ISSUE_FOOTER}\n`;
}

/** Derived approved-final content and baseline-derived historical evidence for an amendment. */
interface AmendmentExecutionContext {
	/** Approved final title/body per pending Task id. */
	pendingContent: Map<string, { title: string; body: string }>;
	/** Approved final Parent title/body. */
	parent: { title: string; body: string };
	/** Approved bound Parent issue number. */
	parentIssueNumber: number;
	/** Historical Slice lines derived from the approved Parent baseline (exact bytes). */
	historicalSlices: string[];
	/** Historical dependency database IDs and terminal state_reason snapshotted before any write. */
	historicalRelations: Map<string, { blocked_by: number[]; state_reason: string | null }>;
}

/**
 * Derive the approved-final content for every amendment write from the current
 * TaskIntents and the approved baseline. Historical Slice lines are extracted
 * from the Parent binding's baseline body so the final expectation is fixed
 * before any mutation, never derived from post-write remote state.
 */
function approvedAmendmentContent(
	root: string,
	repository: RepositoryInfo,
	parentIssue: GithubIssue,
	prepared: ReturnType<typeof preflightPublication>,
	amendment: ReturnType<typeof validateAmendment>,
): AmendmentExecutionContext | string {
	const parent = validateOperation({
		op: "create-initiative",
		initiative_id: prepared.initiative.initiative_id,
		goal: prepared.initiative.goal,
		projection: prepared.initiative.projection,
		slices: prepared.order.map((operation) => ({
			id: operation.slice_id,
			goal: operation.goal,
			result: operation.projection?.result,
			blocked_by: operation.projection?.blocked_by,
		})),
	}) as Extract<TrackerOperation, { op: "create-initiative" }>;
	const historicalSliceIds: Set<string> = new Set();
	for (const child of amendment.historical.values()) {
		const sliceId = ownershipMarkerValue(child.body, "slice-id");
		if (!sliceId) throw new Error("historical amendment binding must carry a slice-id marker");
		if (historicalSliceIds.has(sliceId)) throw new Error(`duplicate historical slice-id: ${sliceId}`);
		historicalSliceIds.add(sliceId);
	}
	const amendedSliceIds = new Set(parent.slices.map((slice) => slice.id));
	for (const sliceId of amendedSliceIds) {
		if (historicalSliceIds.has(sliceId))
			return `pending Task Slice ${sliceId} collides with a historical Task Slice of the same id; Slice identities must be unique across historical and pending Children`;
	}
	const boundSliceIds = new Set(
		parent.slices
			.filter((slice) => prepared.order.some((operation) => operation.slice_id === slice.id && amendment.tasks.get(operation.task_id) !== undefined))
			.map((slice) => slice.id),
	);
	const historicalSlices = baselineHistoricalSlices(amendment.parent.body, amendedSliceIds, boundSliceIds);
	if (typeof historicalSlices === "string") return historicalSlices;
	const sourceStub = {
		repository,
		issues: [parentIssue],
	};
	void sourceStub;
	// The approved final Parent body fixes the Slices checklist, so every Child
	// title is numbered from the Initiative order rather than from this batch.
	const parentBody = createInitiativeBody(sourceStub.repository, parent, historicalSlices);
	const oversizedParent = bodyLimitFailure("create-initiative", parentBody);
	if (oversizedParent) return `${oversizedParent.status}: ${oversizedParent.message}`;
	const pendingContent = new Map<string, { title: string; body: string }>();
	for (const operation of prepared.order) {
		const body = childBody(repository, operation, parentIssue);
		const oversized = bodyLimitFailure("upsert-task", body, MAX_TERMINAL_SUFFIX_BYTES);
		if (oversized) return `${oversized.status}: ${oversized.message}`;
		pendingContent.set(operation.task_id, {
			title: taskIssueTitle(operation, sliceOrdinalFromChecklist(parentBody, operation.slice_id, operation.projection?.slice_ordinal ?? 1)),
			body,
		});
	}
	return {
		pendingContent,
		parent: {
			title: initiativeIssueTitle(parent.initiative_id, parent.projection),
			body: parentBody,
		},
		parentIssueNumber: parentIssue.number,
		historicalSlices,
		historicalRelations: new Map(),
	};
}

/**
 * Extract historical Slice lines from the approved Parent baseline body.
 * Accepts any exactly-once Slice marker representation and returns the exact
 * baseline line bytes; fails closed on malformed Slice entries. Only Slices of
 * bound pending Tasks must already exist in the baseline; unbound new Tasks
 * contribute fresh Slice lines to the approved final Parent body.
 */
function baselineHistoricalSlices(parentBaselineBody: string, amendedSliceIds: Set<string>, boundSliceIds: Set<string>): string[] | string {
	const lines: string[] = [];
	for (const match of parentBaselineBody.matchAll(/^.*?<!-- immune-brain:slice-id=([A-Za-z0-9._:-]+) -->.*$/gm)) {
		const sliceId = match[1];
		const line = match[0];
		// A baseline line must carry exactly one Slice marker: a line mixing a
		// historical marker with a pending marker, or duplicating a marker, is
		// ambiguous remote state — greedy whole-line matching would otherwise
		// silently drop one side's marker when the Parent is rewritten.
		const markersOnLine = [...line.matchAll(/<!-- immune-brain:slice-id=([A-Za-z0-9._:-]+) -->/g)];
		if (markersOnLine.length !== 1)
			return `historical Slice ${sliceId} shares a baseline line with another Slice marker; each Slice marker must sit on its own line`;
		if (amendedSliceIds.has(sliceId)) {
			// The pending batch replaces this Slice line: the line belongs to the
			// amendment's own pending or historical Children (membership and slice
			// uniqueness are validated elsewhere), so it must not be carried over.
			continue;
		}
		if (countLiteral(line, marker("slice-id", sliceId)) !== 1)
			return `historical Slice ${sliceId} has missing or duplicate Slice markers in the approved Parent baseline`;
		if (!ownershipMarkerValue(line, "slice-id"))
			return `historical Slice ${sliceId} has a malformed Slice marker in the approved Parent baseline`;
		lines.push(line);
	}
	for (const sliceId of boundSliceIds) {
		if (countLiteral(parentBaselineBody, marker("slice-id", sliceId)) !== 1)
			return `approved Parent baseline does not carry exactly one Slice marker for bound pending Slice ${sliceId}`;
	}
	return lines;
}

/** Edit an open Initiative Parent's title/body to the approved amendment content. */
async function amendInitiativeParent(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "create-initiative" }>,
	source: RepositorySnapshot,
	binding: InitiativeAmendmentBinding,
	context: AmendmentExecutionContext,
): Promise<GithubTrackerResult> {
	const lookup = (issues: GithubIssue[]) => initiativeLookup(issues, source.repository.id, operation.initiative_id);
	const body = context.parent.body;
	const oversized = bodyLimitFailure(operation.op, body);
	if (oversized) return oversized;
	const title = context.parent.title;
	// Re-read the Parent immediately before writing: earlier topology and
	// historical-dependency reads may have raced a concurrent user edit.
	const reread = await snapshot(root, gh, operation.op);
	if ("contract" in reread) return reread;
	const found = lookup(reread.issues);
	if (found.kind !== "found")
		return result(operation.op, "permanent_failure", "an amendment requires the Initiative Parent to already exist");
	if (found.issue.state !== "open")
		return result(operation.op, "ambiguous_remote_state", "an amendment requires the Initiative Parent to remain open", found.issue);
	if (binding.issue_number !== found.issue.number)
		return result(operation.op, "ambiguous_remote_state", `amendment Parent is bound to Issue #${binding.issue_number} but observed Issue #${found.issue.number}`, found.issue);
	if (found.issue.body === body && found.issue.title === title && !labelMutationArgs(found.issue.labels, []).length)
		return result(operation.op, "already_current", "Initiative Issue already carries the requested amended content", found.issue);
	// Content that already matches the approved final bytes still converges labels;
	// anything else must still be the approved amendment baseline.
	if ((found.issue.body !== body || found.issue.title !== title)
		&& (found.issue.body !== binding.body || found.issue.title !== binding.title))
		return result(operation.op, "ambiguous_remote_state", "Initiative Parent changed since the approved amendment baseline", found.issue);
	// The Parent carries no Task state labels: any managed label observed on it is
	// drift and is removed by the same edit that writes the amended content.
	const labelArgs = labelMutationArgs(found.issue.labels, []);
	const edited = await gh.run([
		"issue", "edit", String(found.issue.number), "--repo", source.repository.name_with_owner,
		"--title", title,
		"--body-file", "-",
		...labelArgs,
	], { cwd: root, stdin: body });
	if (edited.exit_code !== 0 || edited.output_exceeded) return ghFailure(operation.op, edited, "Initiative amendment edit failed");
	const refreshed = await snapshot(root, gh, operation.op);
	if ("contract" in refreshed) return refreshed;
	const confirmed = lookup(refreshed.issues);
	if (confirmed.kind !== "found") return result(operation.op, "ambiguous_remote_state", "Initiative Parent became ambiguous after amendment", found.issue);
	if (MANAGED_ISSUE_LABELS.some((label) => confirmed.issue.labels.includes(label)))
		return result(operation.op, "retryable_failure", "Initiative amendment did not converge to an unlabeled Parent", confirmed.issue);
	return confirmed.issue.body === body && confirmed.issue.title === title
		? result(operation.op, "updated", "Initiative Issue updated with approved amendment content", confirmed.issue)
		: result(operation.op, "retryable_failure", "Initiative amendment did not converge to the requested title and body", confirmed.issue);
}

async function upsertTask(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "upsert-task" }>,
	source: RepositorySnapshot,
	pendingBinding: InitiativeAmendmentBinding | undefined | null = null,
	amendmentContext: AmendmentExecutionContext | undefined = undefined,
): Promise<GithubTrackerResult> {
	const labelFailure = await labelAvailabilityFailure(root, gh, source.repository, desiredTaskLabels(operation));
	if (labelFailure) return labelFailure;
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
	if (found.kind === "missing" && pendingBinding !== null && pendingBinding !== undefined)
		return result(operation.op, "ambiguous_remote_state", `Task ${operation.task_id} is bound to Issue #${pendingBinding.issue_number} but that Issue no longer holds its Task marker; amend the binding or restore the marker instead of recreating`, parent.issue);
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
	const title = taskIssueTitle(operation, sliceOrdinalFromChecklist(parent.issue.body, operation.slice_id, operation.projection?.slice_ordinal ?? 1));
	let child: GithubIssue;
	let createdChild = false;
	let labelsConverged = false;
	if (found.kind === "missing") {
		// Pre-create re-read (amendment path): a concurrent writer may have already
		// created this unbound Task between the initial snapshot and our create — the
		// same resumable-creation contract applies before we issue any write, so we
		// fail closed on divergent content instead of issuing a duplicate create.
		if (amendmentContext !== undefined) {
			const reRead = await snapshot(root, gh, operation.op);
			if ("contract" in reRead) return reRead;
			// The re-read snapshot must also still hold the amendment's Parent exactly
			// as approved: a Parent closed or edited after the initial snapshot fails
			// closed here, before any Child create (avoiding an avoidable remote write
			// that the post-create attachment guard would otherwise reject).
			const reReadParent = initiativeLookup(reRead.issues, reRead.repository.id, operation.initiative_id);
			if (reReadParent.kind !== "found")
				return result(operation.op, "ambiguous_remote_state", reReadParent.kind === "ambiguous" ? reReadParent.message : "amendment Parent is not observable before creating a new Child", parent.issue);
			if (reReadParent.issue.number !== amendmentContext.parentIssueNumber)
				return result(operation.op, "ambiguous_remote_state", `amendment Parent is bound to Issue #${amendmentContext.parentIssueNumber} but observed Issue #${reReadParent.issue.number} before creating a new Child`, reReadParent.issue);
			if (reReadParent.issue.state !== "open")
				return result(operation.op, "ambiguous_remote_state", "amendment Parent is no longer open before creating a new Child", reReadParent.issue);
			if (amendmentContext.parent.title !== reReadParent.issue.title || amendmentContext.parent.body !== reReadParent.issue.body)
				return result(operation.op, "ambiguous_remote_state", "amendment Parent content changed before creating a new Child", reReadParent.issue);
			if (sliceCount(reReadParent.issue.body, operation.slice_id) !== 1)
				return result(operation.op, "ambiguous_remote_state", `Parent Issue #${reReadParent.issue.number} lost its exact Slice marker ${operation.slice_id} before creating a new Child`, reReadParent.issue);
			const raced = lookup(reRead.issues);
			if (raced.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", raced.message);
			if (raced.kind === "found") {
				const approved = amendmentContext.pendingContent.get(operation.task_id);
				const resumable = approved !== undefined
					&& raced.issue.state === "open"
					&& carriesApprovedContent(raced.issue.title, raced.issue.body, approved);
				if (!resumable)
					return result(operation.op, "ambiguous_remote_state", `new pending Task ${operation.task_id} is unbound but Issue #${raced.issue.number} already exists with divergent content; bind it to amend`, raced.issue);
				return updatePendingChild(root, gh, reRead, operation, raced.issue, undefined, blockers, approved, amendmentContext);
			}
		}
		const mutation = await gh.run([
			"issue", "create", "--repo", source.repository.name_with_owner,
			"--title", title,
			"--body-file", "-",
			...desiredTaskLabels(operation).flatMap((label) => ["--label", label]),
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
		if (amendmentContext !== undefined) {
			// Amendment unbound new Child: creation converged, but the Child must
			// still be open — a concurrent close between create and read fails closed
			// instead of attaching and wiring dependencies onto closed work.
			if (created.issue.state !== "open")
				return result(operation.op, "ambiguous_remote_state", `new pending Task ${operation.task_id} (Issue #${created.issue.number}) is not open after creation`, created.issue);
			// Route through the amendment convergence path so attachment (R4
			// re-attach) and every dependency write carry the same pre-write
			// revalidation as bound pending Children.
			return updatePendingChild(root, gh, source, operation, created.issue, undefined, blockers, amendmentContext.pendingContent.get(operation.task_id), amendmentContext);
		}
		child = created.issue;
		createdChild = true;
	} else {
		const owned = ownedTaskLookup(source.issues, source.repository.id, operation.task_id, operation.initiative_id, operation.slice_id);
		if (owned.kind !== "found") return result(operation.op, "ambiguous_remote_state", owned.kind === "ambiguous" ? owned.message : "Task Issue ownership changed during publication", found.issue);
		child = owned.issue;
		if (pendingBinding !== null) {
			if (child.state !== "open")
				return result(operation.op, "ambiguous_remote_state", `Task ${operation.task_id} is closed and cannot be amended as pending work`, found.issue);
			// The bound pending Child must still be the Issue its binding pins (review-5):
			// a replacement Issue that took over the markers fails closed instead of
			// being edited or recreated.
			if (pendingBinding !== undefined && pendingBinding.issue_number !== child.number)
				return result(operation.op, "ambiguous_remote_state", `Task ${operation.task_id} is bound to Issue #${pendingBinding.issue_number} but observed Issue #${child.number}`, found.issue);
			const approvedFinal = amendmentContext?.pendingContent.get(operation.task_id);
			// A Child left open with a validated terminal suffix (failed terminal close)
			// counts as approved-final when its suffix-free bytes match the approved bytes.
			const isFinal = approvedFinal !== undefined && carriesApprovedContent(found.issue.title, found.issue.body, approvedFinal);
			if (!isFinal) {
				// Suffix-aware baseline equality: a Child whose remote bytes carry a validated
				// terminal suffix over the binding baseline (failed terminal close) still
				// matches its binding, because the suffix is terminal evidence, not drift.
				const baselineMatches = pendingBinding !== undefined
					&& pendingBinding.title === found.issue.title
					&& carriesApprovedContent(found.issue.title, found.issue.body, pendingBinding);
				if (!baselineMatches)
					return result(operation.op, "ambiguous_remote_state", `Task ${operation.task_id} changed since the approved amendment baseline`, found.issue);
			}
			return updatePendingChild(root, gh, source, operation, child, pendingBinding?.issue_number, blockers, approvedFinal, amendmentContext);
		}
		if (amendmentContext !== undefined) {
			// Amendment unbound Child observed before any write: it is only valid
			// as the exact approved-final creation of this same batch (resumable
			// creation); anything else fails closed.
			const approvedFinal = amendmentContext.pendingContent.get(operation.task_id);
			const resumable = approvedFinal !== undefined
				&& child.state === "open"
				&& carriesApprovedContent(found.issue.title, found.issue.body, approvedFinal);
			if (!resumable)
				return result(operation.op, "ambiguous_remote_state", `new pending Task ${operation.task_id} is unbound but Issue #${child.number} already exists with divergent content; bind it to amend`, found.issue);
			return updatePendingChild(root, gh, source, operation, child, undefined, blockers, approvedFinal, amendmentContext);
		}
		if (found.issue.body !== body || found.issue.title !== title)
			return result(operation.op, "permanent_failure", "Task Issue already exists with a different title or Agent Brief; edit the GitHub source or retry the original projection before changing native relations", found.issue);
		// A repeated complete batch is a convergence pass: managed label drift is
		// repaired here without rewriting content the tracker never owns.
		const observedLabelArgs = labelMutationArgs(child.labels, desiredTaskLabels(operation));
		if (observedLabelArgs.length) {
			const edited = await gh.run([
				"issue", "edit", String(child.number), "--repo", source.repository.name_with_owner,
				...observedLabelArgs,
			], { cwd: root });
			if (edited.exit_code !== 0 || edited.output_exceeded)
				return ghFailure(operation.op, edited, `Task Issue #${child.number} label convergence failed`);
			labelsConverged = true;
		}
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
			: result(operation.op, labelsConverged ? "updated" : "already_current", "Task Issue, native Sub-issue relation, and blocking relations are current", child);
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
	if (value.slice_ordinal !== undefined
		&& (typeof value.slice_ordinal !== "number" || !Number.isSafeInteger(value.slice_ordinal) || value.slice_ordinal < 1 || value.slice_ordinal > 999))
		throw new Error("projection.slice_ordinal must be an integer between 1 and 999");
	return {
		short_name: value.short_name,
		title: value.title,
		slice_ordinal: value.slice_ordinal,
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
	if (value.source_issue !== undefined && (typeof value.source_issue !== "string" || !/^[1-9][0-9]{0,9}$/.test(value.source_issue)))
		throw new Error("projection.source_issue must be a GitHub Issue number");
	return {
		short_name: value.short_name,
		title: value.title,
		source_issue: value.source_issue,
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
		initiativeIssueTitle(normalized.initiative_id, normalized.projection);
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
		taskIssueTitle(normalized);
		return normalized;
	}
	return {
		...operation,
		task_id: identifier(operation.task_id, "task_id"),
		terminal_event_id: terminalEvent(operation.terminal_event_id),
	};
}

/** Run one amendment pending Task: create unbound new Children, amend bound drift. */
async function runAmendmentTaskOperation(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "upsert-task" }>,
	pendingBinding: InitiativeAmendmentBinding | undefined | null,
	context: AmendmentExecutionContext | undefined,
): Promise<GithubTrackerResult> {
	const absoluteRoot = resolve(root);
	const source = await snapshot(absoluteRoot, gh, operation.op);
	if ("contract" in source) return source;
	return upsertTask(absoluteRoot, gh, operation, source, pendingBinding, context);
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

function publicationPlan(operations: Array<Extract<TrackerOperation, { op: "upsert-task" }>>, satisfiedPrerequisites: Set<string> = new Set()): {
	order: Array<Extract<TrackerOperation, { op: "upsert-task" }>>;
	parallel_groups: string[][];
} {
	const remaining = new Set(operations.map((operation) => operation.task_id));
	const done = new Set<string>(satisfiedPrerequisites);
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
	foreign_dependers: Map<string, string[]>;
} {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("publication must be an object");
	if (!Array.isArray(input.tasks) || input.tasks.length < (input.amendment ? 1 : 2))
		throw new Error("a complete Initiative publication requires at least two Tasks");
	if (!input.projection || typeof input.projection !== "object" || Array.isArray(input.projection))
		throw new Error("publication projection must be an object");
	for (const field of ["problem", "result", "design"] as const) {
		if (input.projection[field] === undefined)
			throw new Error(`a complete Initiative publication requires projection.${field}`);
	}
	// The Initiative display names are validated once here, before any Task
	// projection is stamped with them, so a missing or oversized display name
	// fails the batch closed with zero remote writes.
	const initiativeShortName = initiativeDisplayNames(input.projection).shortName;
	const publications = input.tasks.map((task, index) => {
		if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`tasks[${index}] must be an object`);
		if (typeof task.intent !== "string") throw new Error(`tasks[${index}].intent must be a string`);
		return taskPublication(root, input.initiative_id, task.slice_id, task.intent, task.acceptance, task.projection, index + 1, initiativeShortName);
	});
	const historicalIds = new Set<string>();
	if (input.amendment) {
		if (!Array.isArray(input.amendment.historical)) throw new Error("amendment.historical must be an array");
		for (const child of input.amendment.historical) historicalIds.add(identifier(child.task_id, "amendment.historical task_id"));
	}
	const operations = publications.map((publication) => publication.operation);
	const taskIds = new Set<string>();
	const sliceIds = new Set<string>();
	for (const operation of operations) {
		if (taskIds.has(operation.task_id)) throw new Error(`duplicate Task id: ${operation.task_id}`);
		if (sliceIds.has(operation.slice_id)) throw new Error(`duplicate Slice id: ${operation.slice_id}`);
		taskIds.add(operation.task_id);
		sliceIds.add(operation.slice_id);
	}
	const foreignDependers = new Map<string, string[]>();
	for (const operation of operations) {
		for (const blocker of operation.projection?.blocked_by ?? []) {
			if (!taskIds.has(blocker) && !historicalIds.has(blocker)) {
				if (input.amendment === undefined)
					throw new Error(`Task ${operation.task_id} depends on ${blocker}, which is outside the complete Initiative batch`);
				foreignDependers.set(blocker, [...(foreignDependers.get(blocker) ?? []), operation.task_id]);
			}
		}
	}
	const foreignIds = new Set(foreignDependers.keys());
	const plan = input.amendment === undefined
		? publicationPlan(operations)
		: publicationPlan(operations, new Set([...historicalIds, ...foreignIds]));
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
	return { initiative, ...plan, intent_bindings: intentBindings, foreign_dependers: foreignDependers };
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
}, actual: GithubIssue, title: string, body: string, label: string, options?: { allowTerminalSuffix?: boolean }): string | null {
	if (expected.issue_number !== actual.number || expected.issue_url !== actual.url || expected.node_id !== String(actual.id))
		return `${label} identity changed during Initiative publication`;
	if (actual.state !== "open") return `${label} is no longer open`;
	if (actual.title !== title || actual.body !== body) {
		// Only a pending amendment Child left open with a validated terminal suffix
		// (failed terminal close) matches its suffix-free expected content. The
		// Parent and the strict non-amendment path have no terminal-suffix
		// lifecycle: byte-exact comparison, any extra suffix is real drift.
		if (options?.allowTerminalSuffix && carriesApprovedContent(actual.title, actual.body, { title, body })) return null;
		return `${label} content changed during Initiative publication`;
	}
	return null;
}

/** One bound Issue's expected remote identity and content. */
function validateAmendmentBinding(binding: unknown, label: string): InitiativeAmendmentBinding {
	if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error(`${label} must be an object`);
	const raw = binding as Record<string, unknown>;
	if (!Number.isSafeInteger(raw.issue_number) || (raw.issue_number as number) < 1)
		throw new Error(`${label}.issue_number must be a positive integer`);
	if (raw.state !== "open" && raw.state !== "closed") throw new Error(`${label}.state must be "open" or "closed"`);
	if (typeof raw.title !== "string" || !raw.title.trim()) throw new Error(`${label}.title must be a non-empty string`);
	if (typeof raw.body !== "string") throw new Error(`${label}.body must be a string`);
	if (Buffer.byteLength(raw.body, "utf8") > GITHUB_ISSUE_BODY_LIMIT) throw new Error(`${label}.body exceeds 65,536 UTF-8 bytes`);
	return { issue_number: raw.issue_number as number, title: raw.title, body: raw.body, state: raw.state };
}

function validateAmendment(input: InitiativePublicationInput): {
	parent: InitiativeAmendmentBinding;
	tasks: Map<string, InitiativeAmendmentBinding | undefined>;
	historical: Map<string, InitiativeAmendmentBinding>;
} {
	const amendment = input.amendment!;
	const parent = validateAmendmentBinding(amendment.parent, "amendment.parent");
	if (parent.state !== "open") throw new Error("amendment.parent must be an open Issue");
	const tasks = new Map<string, InitiativeAmendmentBinding | undefined>();
	const historical = new Map<string, InitiativeAmendmentBinding>();
	if (!Array.isArray(amendment.tasks)) throw new Error("amendment.tasks must be an array");
	for (const [index, task] of amendment.tasks.entries()) {
		if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`amendment.tasks[${index}] must be an object`);
		const taskId = identifier((task as { task_id: unknown }).task_id, `amendment.tasks[${index}].task_id`);
		if (tasks.has(taskId) || historical.has(taskId)) throw new Error(`duplicate amendment Task id: ${taskId}`);
		const binding = (task as { binding: unknown }).binding as InitiativeAmendmentBinding | undefined;
		if (binding !== undefined && binding.state !== "open")
			throw new Error(`amendment.tasks[${index}].binding.state must be "open" for pending Children`);
		tasks.set(taskId, binding === undefined ? undefined : validateAmendmentBinding(binding, `amendment.tasks[${index}].binding`));
	}
	if (!Array.isArray(amendment.historical)) throw new Error("amendment.historical must be an array");
	for (const [index, child] of amendment.historical.entries()) {
		if (!child || typeof child !== "object" || Array.isArray(child)) throw new Error(`amendment.historical[${index}] must be an object`);
		const raw = child as { task_id: unknown; binding: unknown };
		const taskId = identifier(raw.task_id, `amendment.historical[${index}].task_id`);
		if (tasks.has(taskId) || historical.has(taskId)) throw new Error(`duplicate amendment Task id: ${taskId}`);
		historical.set(taskId, validateAmendmentBinding(raw.binding, `amendment.historical[${index}].binding`));
	}
	return { parent, tasks, historical };
}

/** Compare a bound Issue's observed remote identity/content against the approved baseline. */
function amendmentBindingDrift(binding: InitiativeAmendmentBinding, actual: GithubIssue, label: string): string | null {
	if (binding.issue_number !== actual.number) return `${label} is bound to Issue #${binding.issue_number} but observed Issue #${actual.number}`;
	if (binding.state !== actual.state) return `${label} is bound as ${binding.state} but observed as ${actual.state}`;
	if (binding.title !== actual.title || binding.body !== actual.body) return `${label} remote content does not match the approved baseline`;
	return null;
}

/** Split observed Sub-issues into bound pending vs bound historical, verifying complete membership. */
function classifyObservedChildren(
	source: RepositorySnapshot,
	initiativeId: string,
	pendingBindings: Map<string, InitiativeAmendmentBinding | undefined>,
	historicalBindings: Map<string, InitiativeAmendmentBinding>,
): Map<string, GithubIssue> | string {
	const observed = new Map<string, GithubIssue>();
	for (const issue of source.issues) {
		if (issue.body.includes(marker("initiative-id", initiativeId)) && issue.body.includes(KIND_TASK_MARKER)) {
			const taskId = ownershipMarkerValue(issue.body, "task-id");
			if (!taskId) return `Issue #${issue.number} has missing or duplicate task-id ownership markers`;
			if (observed.has(taskId)) return `duplicate Task Issue identity: ${taskId}`;
			observed.set(taskId, issue);
		}
	}
	const pendingIds = new Set(pendingBindings.keys());
	const historicalIds = new Set(historicalBindings.keys());
	for (const [taskId, issue] of observed) {
		if (issue.state === "closed" && pendingIds.has(taskId))
			return `pending Task ${taskId} (Issue #${issue.number}) is closed; the amendment cannot treat closed work as pending`;
		if (issue.state === "closed" && !historicalIds.has(taskId))
			return `closed Child ${taskId} (Issue #${issue.number}) must be declared as historical`;
		if (pendingIds.has(taskId)) continue;
		if (historicalIds.has(taskId)) {
			const binding = historicalBindings.get(taskId)!;
			const drift = amendmentBindingDrift(binding, issue, `historical Task ${taskId}`);
			if (drift) return drift;
			continue;
		}
		return `observed Child ${taskId} (Issue #${issue.number}) is neither approved pending nor declared historical; the amendment must declare the complete membership`;
	}
	return observed;
}

async function validateAmendmentTopology(
	root: string,
	gh: GhTransport,
	source: RepositorySnapshot,
	initiativeId: string,
	parentIssue: GithubIssue,
	pendingBindings: Map<string, InitiativeAmendmentBinding | undefined>,
	historicalBindings: Map<string, InitiativeAmendmentBinding>,
	foreignDependers: Map<string, string[]>,
	approvedFinal: {
		pendingContent: Map<string, { title: string; body: string }>;
		parent: { title: string; body: string };
		historicalSlices: string[];
	},
	order: Array<Extract<TrackerOperation, { op: "upsert-task" }>>,
): Promise<Map<string, GithubIssue> | GithubTrackerResult> {
	const classified = classifyObservedChildren(source, initiativeId, pendingBindings, historicalBindings);
	if (typeof classified === "string") return result("create-initiative", "ambiguous_remote_state", classified, parentIssue);
	const bound = classified;
	const pendingIds = new Set(pendingBindings.keys());
	const historicalIds = new Set(historicalBindings.keys());
	const attached = await readSubIssueNumbers(root, gh, "create-initiative", source.repository, parentIssue.number);
	if (!Array.isArray(attached)) return attached;
	const attachedNumbers = new Set(attached);
	for (const [taskId, binding] of historicalBindings) {
		const issue = bound.get(taskId);
		if (!issue) return result("create-initiative", "ambiguous_remote_state", `historical Task ${taskId} is not observable`, parentIssue);
		if (binding.issue_number !== issue.number)
			return result("create-initiative", "ambiguous_remote_state", `historical Task ${taskId} is bound to Issue #${binding.issue_number} but observed Issue #${issue.number}`, issue);
		// Historical Children carry the same repository/protocol/marker-uniqueness
		// ownership guarantees as pending Children: a full taskLookup must resolve
		// the exact bound Issue, or the amendment fails closed before any write.
		const owned = taskLookup(source.issues, source.repository.id, taskId);
		if (owned.kind !== "found" || owned.issue.number !== issue.number)
			return result("create-initiative", "ambiguous_remote_state", owned.kind === "found" ? `historical Task ${taskId} resolves to Issue #${owned.issue.number}, not the bound Issue #${issue.number}` : `historical Task ${taskId} ownership failed: ${owned.kind === "ambiguous" ? owned.message : "not observable"}`, issue);
		if (!attachedNumbers.has(issue.number))
			return result("create-initiative", "ambiguous_remote_state", `historical Task ${taskId} (Issue #${issue.number}) is not attached to the Parent`, issue);
		const ownership = await confirmTerminalOwnership(root, gh, "create-initiative", source, issue);
		if (!("owned" in ownership)) return ownership;
	}
	for (const [taskId, binding] of pendingBindings) {
		const issue = bound.get(taskId);
		// Terminal evidence is validated before any mutation, including exact-baseline
		// matches: a lone marker, truncated suffix, or multiple markers in a bound
		// or resumable Child is malformed evidence (Kernel-only boundary), never
		// synthesizable content.
		if (issue) {
			const suffixEvent = issueTerminalEventId(issue.body);
			if (suffixEvent === "multiple")
				return result("create-initiative", "ambiguous_remote_state", `pending Task ${taskId} has multiple terminal markers`, issue);
			if (suffixEvent === "malformed")
				return result("create-initiative", "ambiguous_remote_state", `pending Task ${taskId} carries a malformed terminal marker (marker without its exact canonical suffix)`, issue);
		}
		if (binding === undefined) {
			// Unbound new Child: either it must not exist yet (fresh creation), or it
			// may already be the exact approved-final creation from a prior partial
			// write of this same batch (resumable creation) — anything else fails closed.
			// Resolve the task_id repo-wide regardless of whether the issue was found
			// under this Initiative: an unbound Task whose id is already owned by
			// another Initiative (or ambiguous repo-wide) must be rejected here,
			// before any Parent or preceding Child rewrite — not later in upsertTask.
			const ownedNew = taskLookup(source.issues, source.repository.id, taskId);
			if (ownedNew.kind !== "missing") {
				if (ownedNew.kind === "found") {
					if (issue && ownedNew.issue.number === issue.number) {
						const approved = approvedFinal.pendingContent.get(taskId)!;
						// An open Child left by a failed terminal close carries a terminal suffix;
						// the suffix is validated terminal evidence, not baseline drift.
						const resumable = issue.state === "open"
							&& approved !== undefined
							&& carriesApprovedContent(issue.title, issue.body, approved);
						if (!resumable)
							return result("create-initiative", "ambiguous_remote_state", `new pending Task ${taskId} is unbound but Issue #${issue.number} already exists with divergent content; bind it to amend`, issue);
					} else {
						return result("create-initiative", "ambiguous_remote_state", `new pending Task ${taskId} is unbound but task_id is already owned by Issue #${ownedNew.issue.number}; bind it to amend`, ownedNew.issue);
					}
				} else {
					return result("create-initiative", "ambiguous_remote_state", `new pending Task ${taskId} ownership failed: ${ownedNew.kind === "ambiguous" ? ownedNew.message : "not observable"}`, parentIssue);
				}
			}
			continue;
		}
		if (!issue) return result("create-initiative", "ambiguous_remote_state", `bound pending Task ${taskId} is not observable`, parentIssue);
		if (binding.issue_number !== issue.number)
			return result("create-initiative", "ambiguous_remote_state", `pending Task ${taskId} is bound to Issue #${binding.issue_number} but observed Issue #${issue.number}`, issue);
		if (issue.state !== "open")
			return result("create-initiative", "ambiguous_remote_state", `pending Task ${taskId} (Issue #${issue.number}) is closed and cannot be amended`, issue);
		// Repository-wide ownership resolution must hold for pending Children too,
		// before any Parent rewrite: a missing repo/protocol marker or a duplicate
		// task-id in another Initiative fails closed here, not later in upsertTask.
		const ownedPending = taskLookup(source.issues, source.repository.id, taskId);
		if (ownedPending.kind !== "found" || ownedPending.issue.number !== issue.number)
			return result("create-initiative", "ambiguous_remote_state", ownedPending.kind === "found" ? `pending Task ${taskId} resolves to Issue #${ownedPending.issue.number}, not the observed Issue #${issue.number}` : `pending Task ${taskId} ownership failed: ${ownedPending.kind === "ambiguous" ? ownedPending.message : "not observable"}`, issue);
		// The observed Child's Slice identity must match the operation's requested
		// slice before any write: a bound Child observed under another Task's slice
		// (e.g. a historical slice) is immutable ownership, never a rewrite target.
		const requestedSlice = order.find((operation) => operation.task_id === taskId)?.slice_id;
		const observedSlice = ownershipMarkerValue(issue.body, "slice-id");
		if (requestedSlice !== undefined && observedSlice !== null && observedSlice !== requestedSlice)
			return result("create-initiative", "ambiguous_remote_state", `pending Task ${taskId} (Issue #${issue.number}) carries slice-id=${observedSlice}, which does not match its requested Slice ${requestedSlice}`, issue);
		const approved = approvedFinal.pendingContent.get(taskId)!;
		const matchesBaseline = binding.title === issue.title
			&& carriesApprovedContent(issue.title, issue.body, binding);
		const matchesApprovedFinal = approved && carriesApprovedContent(issue.title, issue.body, approved);
		// Attachment is required only for the baseline observation; an unattached
		// Child that already carries exact approved-final content (a prior partial
		// write) re-attaches during the upsert instead of failing closed.
		const carriesApprovedFinal = matchesApprovedFinal && issue.state === "open";
		if (!attachedNumbers.has(issue.number) && !carriesApprovedFinal)
			return result("create-initiative", "ambiguous_remote_state", `pending Task ${taskId} (Issue #${issue.number}) is not attached to the Parent`, issue);
		if (!matchesBaseline && !matchesApprovedFinal)
			return result("create-initiative", "ambiguous_remote_state", `pending Task ${taskId} remote content does not match the approved baseline or already-applied approved content`, issue);
		if (!carriesApprovedFinal) {
			// Ownership demands native Sub-issue attachment; an unattached Child that
			// already carries exact approved-final content (a prior partial write) skips
			// the attachment check here and is re-attached during the upsert instead.
			const ownership = await confirmTerminalOwnership(root, gh, "create-initiative", source, issue);
			if (!("owned" in ownership)) return ownership;
		}
	}
	for (const number of attachedNumbers) {
		const issue = source.issues.find((candidate) => candidate.number === number);
		const taskId = issue ? ownershipMarkerValue(issue.body, "task-id") : null;
		if (!taskId || (!pendingIds.has(taskId) && !historicalIds.has(taskId)))
			return result("create-initiative", "ambiguous_remote_state", `Parent Sub-issue #${number} is not part of the declared amendment membership`, parentIssue);
	}
	for (const [blockerId, dependers] of foreignDependers) {
		const issue = [...bound.values()].find((candidate) => ownershipMarkerValue(candidate.body, "task-id") === blockerId)
			?? source.issues.find((candidate) => ownershipMarkerValue(candidate.body, "task-id") === blockerId);
		if (!issue)
			return result("create-initiative", "ambiguous_remote_state", `Task ${dependers.join(", ")} depends on ${blockerId}, which is not part of the declared amendment membership`, parentIssue);
		if (!attachedNumbers.has(issue.number))
			return result("create-initiative", "ambiguous_remote_state", `blocking Task ${blockerId} (Issue #${issue.number}) is not attached to the Parent`, issue);
	}
	return bound;
}

/**
 * Extract a single validated terminal suffix from an Issue body, or null.
 * A marker only counts as terminal evidence when the body ends with the exact
 * canonical suffix for that event id (marker + evidence line + bounded id):
 * a lone marker or truncated suffix is malformed evidence, not a suffix.
 */
function issueTerminalEventId(body: string): string | null | "multiple" | "malformed" {
	const suffixMatch = [...body.matchAll(/<!-- immune-brain:terminal-event=([A-Za-z0-9._:-]+) -->/g)];
	if (suffixMatch.length === 0) return null;
	if (suffixMatch.length > 1) return "multiple";
	const eventId = suffixMatch[0][1];
	if (eventId.length > MAX_TERMINAL_EVENT_ID || !body.endsWith(terminalSuffix(eventId)))
		return "malformed";
	return eventId;
}

/**
 * Strip one validated terminal suffix from an Issue body, returning the
 * suffix-free bytes. Returns null when the body carries no terminal suffix;
 * callers treat a "multiple" result as fail-closed before calling.
 */
/** Extract a validated terminal suffix from raw body bytes, or null. */
function stripTerminalSuffixFromBytes(body: string | undefined): string | null | "multiple" | "malformed" {
	if (body === undefined) return null;
	const eventId = issueTerminalEventId(body);
	if (eventId === null || eventId === "multiple" || eventId === "malformed") return eventId;
	const suffix = terminalSuffix(eventId);
	if (!body.endsWith(suffix)) return null;
	return body.slice(0, body.length - suffix.length);
}

/**
 * Suffix-aware content equality: an Issue (or raw baseline body) whose bytes
 * match the approved bytes exactly, or whose suffix-stripped bytes match the
 * approved (suffix-free) bytes, counts as carrying the approved content. A
 * validated terminal suffix is terminal evidence, not content drift. Multiple
 * terminal markers always fail closed.
 */
function carriesApprovedContent(title: string, body: string, approved: { title: string; body: string }): boolean {
	if (title !== approved.title) return false;
	if (body === approved.body) return true;
	const stripped = stripTerminalSuffixFromBytes(body);
	return typeof stripped === "string" && stripped.trimEnd() === approved.body.trimEnd();
}

async function updatePendingChild(
	root: string,
	gh: GhTransport,
	source: RepositorySnapshot,
	op: Extract<TrackerOperation, { op: "upsert-task" }>,
	child: GithubIssue,
	boundNumber: number | undefined,
	desiredBlockers: GithubIssue[],
	approvedFinal: { title: string; body: string } | undefined,
	amendmentContext: AmendmentExecutionContext | undefined = undefined,
): Promise<GithubTrackerResult> { // eslint-disable-line @typescript-eslint/no-unused-vars -- boundNumber retained for call-site symmetry
	const parent = initiativeLookup(source.issues, source.repository.id, op.initiative_id);
	const body = childBody(source.repository, op, parent.kind === "found" ? parent.issue : child);
	const oversized = bodyLimitFailure(op.op, body, MAX_TERMINAL_SUFFIX_BYTES);
	if (oversized) return oversized;
	const title = taskIssueTitle(op, sliceOrdinalFromChecklist(parent.kind === "found" ? parent.issue.body : child.body, op.slice_id, op.projection?.slice_ordinal ?? 1));
	// Parent content expectation for pre-write revalidation: on the amendment
	// path the expectation is always the fixed approved final Parent bytes —
	// never re-adopt freshly observed content as the baseline, so an edit that
	// lands between the Parent write and this Child write fails closed. On the
	// non-amendment path (no amendmentContext) no Parent content expectation is
	// enforced here.
	const parentApprovedContent = amendmentContext?.parent;
	const parentBoundNumber = amendmentContext?.parentIssueNumber;
	const baseBody = child.body;
	const suffixEvent = issueTerminalEventId(baseBody);
	if (suffixEvent === "multiple") return result(op.op, "ambiguous_remote_state", "pending Task has multiple terminal markers", child);
	if (suffixEvent === "malformed") return result(op.op, "ambiguous_remote_state", `pending Task ${op.task_id} carries a malformed terminal marker (marker without its exact canonical suffix)`, child);
	// An open Child left by a failed terminal close retains its validated terminal
	// suffix; the approved-final bytes keep that suffix so the original-input batch
	// retry converges instead of failing closed on its own partial write.
	let finalBody = suffixEvent !== null ? `${body.trimEnd()}${terminalSuffix(suffixEvent)}` : body;
	// The approved-final bytes are suffix-free by construction; a Child carrying a
	// validated terminal suffix matches when its suffix-free bytes are exact.
	const approvedMatches = approvedFinal !== undefined && carriesApprovedContent(title, body, approvedFinal);
	if (!approvedMatches)
		return result(op.op, "ambiguous_remote_state", `pending Task ${op.task_id} carries a terminal suffix that diverges from the approved amendment content`, child);
	// R4 re-attach: a Child that already carries the exact approved-final content
	// but lost its native Sub-issue attachment (a detached intermediate state from
	// a prior partial write) is re-attached instead of failing closed, keeping the
	// original batch retryable. The Child must be bound to this amendment's
	// Parent (its marker Initiative) and carry no other parent edge — a foreign
	// attachment is ambiguous remote state, never re-attached.
	const approvedNow = approvedFinal !== undefined && carriesApprovedContent(child.title, child.body, approvedFinal);
	if (approvedNow) {
		const currentParent = initiativeLookup(source.issues, source.repository.id, op.initiative_id);
		if (currentParent.kind !== "found")
			return result(op.op, "ambiguous_remote_state", "pending Task Parent is not observable before attachment convergence", child);
		// Re-read and revalidate the Child immediately before the attachment
		// mutation: the earlier snapshot may have raced a concurrent edit or
		// close. exact identity, open state and approved-final bytes must hold,
		// or the re-attach fails closed with zero relation writes. The attachment
		// check is skipped here: the re-attach itself converges it and verifies
		// the relation after the write.
		const revalidated = await revalidatePendingChildBeforeWrite(root, gh, child.number, op.task_id, approvedFinal, undefined, true, parentApprovedContent, parentBoundNumber);
		if ("contract" in revalidated) return revalidated;
		const targetParentNumber = parentBoundNumber ?? currentParent.issue.number;
		const attachment = await confirmAttachment(root, gh, op.op, source.repository, targetParentNumber, child.number);
		if (!("attached" in attachment)) return attachment;
		if (!attachment.attached) {
			const attached = await attachSubIssue(root, gh, op.op, source.repository, targetParentNumber, child);
			if (!("attached" in attached)) return attached;
		}
	}
	// The authoritative remote observation for the write decision is the
	// revalidated pre-write read, not the earlier snapshot: a terminal suffix
	// that landed after the snapshot must be preserved exactly, never
	// overwritten by bytes computed from stale data.
	let observed = child;
	const desiredLabels = desiredTaskLabels(op);
	if (child.title !== title || child.body !== finalBody || labelMutationArgs(child.labels, desiredLabels).length) {
		// Re-read the Child immediately before writing: earlier blocker ownership
		// reads may have raced a concurrent user edit. The bound issue_number must
		// still hold and the remote content must still be baseline-or-approved-final.
		// revalidatePendingChildBeforeWrite additionally rechecks native Parent
		// attachment and exact Parent/Slice ownership so a detached or moved Child
		// never receives a content rewrite.
		const revalidated = await revalidatePendingChildBeforeWrite(
			root, gh, child.number, op.task_id, approvedFinal,
			{ title: child.title, body: child.body },
			false, parentApprovedContent, parentBoundNumber,
		);
		if ("contract" in revalidated) return revalidated;
		observed = revalidated;
		// A newly observed terminal suffix on the remote (approved-final content
		// plus evidence appended after the snapshot) must survive this write: the
		// written body keeps the observed suffix instead of the snapshot-derived one.
		const observedEvent = issueTerminalEventId(observed.body);
		if (observedEvent === "malformed") return result(op.op, "ambiguous_remote_state", `pending Task ${op.task_id} carries a malformed terminal marker (marker without its exact canonical suffix)`, child);
		const writeBody = typeof observedEvent === "string"
			? `${body.trimEnd()}${terminalSuffix(observedEvent)}`
			: finalBody;
		const labelArgs = labelMutationArgs(observed.labels, desiredLabels);
		if (observed.title !== title || observed.body !== writeBody || labelArgs.length) {
			const edited = await gh.run([
				"issue", "edit", String(child.number), "--repo", source.repository.name_with_owner,
				"--title", title,
				"--body-file", "-",
				...labelArgs,
			], { cwd: root, stdin: writeBody });
			if (edited.exit_code !== 0 || edited.output_exceeded) return ghFailure(op.op, edited, `pending Task Issue #${child.number} update failed`);
			finalBody = writeBody;
		}
	}
	const dependencies = await convergePendingDependencies(root, gh, source, child.number, op.task_id, desiredBlockers, approvedFinal, parentApprovedContent, parentBoundNumber);
	if (!("complete" in dependencies)) return dependencies;
	const refreshed = await snapshot(root, gh, op.op);
	if ("contract" in refreshed) return refreshed;
	const reread = ownedTaskLookup(refreshed.issues, refreshed.repository.id, op.task_id, op.initiative_id, op.slice_id);
	if (reread.kind !== "found" || reread.issue.number !== child.number)
		return result(op.op, "ambiguous_remote_state", `pending Task ${op.task_id} changed identity during amendment`, child);
	if (reread.issue.title !== title || reread.issue.body !== finalBody)
		return result(op.op, "retryable_failure", `pending Task ${op.task_id} update did not converge`, reread.issue);
	const labelsCurrent = !desiredLabels.some((label) => !reread.issue.labels.includes(label));
	if (!labelsCurrent)
		return result(op.op, "retryable_failure", `pending Task ${op.task_id} labels did not converge`, reread.issue);
	const currentDependencies = await confirmBlockedBy(root, gh, op.op, refreshed.repository, reread.issue.number, desiredBlockers);
	if (!("complete" in currentDependencies)) return currentDependencies;
	if (!currentDependencies.complete)
		return result(op.op, "retryable_failure", `pending Task ${op.task_id} dependencies did not converge`, reread.issue);
	const contentCurrent = child.title === title && child.body === finalBody
		&& labelMutationArgs(child.labels, desiredLabels).length === 0;
	return contentCurrent
		? result(op.op, "already_current", `pending Task ${op.task_id} already carries the approved amendment content`, reread.issue)
		: result(op.op, "updated", `pending Task ${op.task_id} Agent Brief updated with approved amendment content`, reread.issue);
}

/** Converge the exact approved dependency set on a pending Child (amendment only). */
async function convergePendingDependencies(
	root: string,
	gh: GhTransport,
	source: RepositorySnapshot,
	childNumber: number,
	childTaskId: string,
	requestedBlockers: GithubIssue[],
	approvedFinal: { title: string; body: string } | undefined,
	parentApprovedContent: { title: string; body: string } | undefined = undefined,
	parentBoundNumber: number | undefined = undefined,
): Promise<GithubTrackerResult | { complete: true }> {
	const expected = requestedBlockers.map((blocker) => blocker.id);
	const existing = await readBlockedByIds(root, gh, "upsert-task", source.repository, childNumber);
	if (!Array.isArray(existing)) return existing;
	const removed = existing.filter((id) => !expected.includes(id));
	for (const id of removed) {
		const revalidated = await revalidatePendingChildBeforeWrite(root, gh, childNumber, childTaskId, approvedFinal, undefined, false, parentApprovedContent, parentBoundNumber);
		if ("contract" in revalidated) return revalidated;
		const mutation = await gh.run([
			"api", "--method", "DELETE",
			`repos/${source.repository.name_with_owner}/issues/${childNumber}/dependencies/blocked_by/${id}`,
		], { cwd: root });
		if (mutation.exit_code !== 0 || mutation.output_exceeded)
			return ghFailure("upsert-task", mutation, `native blocked_by removal failed for Issue #${childNumber}`);
	}
	const additions = requestedBlockers.filter((blocker) => !existing.includes(blocker.id));
	for (const blocker of additions) {
		const revalidated = await revalidatePendingChildBeforeWrite(root, gh, childNumber, childTaskId, approvedFinal, undefined, false, parentApprovedContent, parentBoundNumber);
		if ("contract" in revalidated) return revalidated;
		const mutation = await gh.run([
			"api", "-F", `issue_id=${blocker.id}`,
			`repos/${source.repository.name_with_owner}/issues/${childNumber}/dependencies/blocked_by`,
		], { cwd: root });
		if (mutation.exit_code !== 0 || mutation.output_exceeded)
			return ghFailure("upsert-task", mutation, `native blocked_by attachment failed for Issue #${blocker.number}`);
	}
	const confirm = await confirmBlockedBy(root, gh, "upsert-task", source.repository, childNumber, requestedBlockers);
	if (!("complete" in confirm)) return confirm;
	return confirm.complete ? { complete: true } : { complete: true };
}

/**
 * Re-snapshot and re-validate a pending Child's bound identity, open state,
 * ownership, and baseline-or-approved-final content immediately before each
 * dependency write. Any drift stops the remaining mutations and fails closed
 * as ambiguous remote state. On success returns the validated Child
 * observation so callers can write the bytes actually present on the remote
 * (preserving a terminal suffix that landed after their earlier snapshot).
 * The return is discriminated by `contract`: a GithubTrackerResult failure
 * short-circuits the caller, a GithubIssue is the validated observation.
 */
async function revalidatePendingChildBeforeWrite(
	root: string,
	gh: GhTransport,
	childNumber: number,
	childTaskId: string,
	approvedFinal: { title: string; body: string } | undefined,
	/** Additional byte-exact content this Child is allowed to carry (e.g. its pre-update baseline). */
	allowedBaseline: { title: string; body: string } | undefined = undefined,
	/** When true the native Sub-issue attachment check is skipped (re-attach phase: the attachment write itself is about to run). */
	skipAttachmentCheck = false,
	/** Expected exact Parent bytes (approved final after the Parent write, baseline before it); undefined skips the Parent content check. */
	parentApproved: { title: string; body: string } | undefined = undefined,
	/** Expected exact bound Parent issue number; undefined skips the Parent issue_number check. */
	parentExpectedNumber: number | undefined = undefined,
): Promise<GithubTrackerResult | GithubIssue> {
	const refreshed = await snapshot(root, gh, "upsert-task");
	if ("contract" in refreshed) return refreshed;
	// Repository-wide identity resolution: a duplicate Task Issue introduced after
	// the caller's snapshot must fail closed here, not at a later lookup — the
	// immediate pre-write observation is the authoritative one.
	const resolved = taskLookup(refreshed.issues, refreshed.repository.id, childTaskId);
	if (resolved.kind !== "found")
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} is not uniquely owned before a write: ${resolved.kind}`);
	const child = resolved.issue;
	if (child.number !== childNumber)
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} resolves to Issue #${child.number}, not the bound Issue #${childNumber}`, child);
	if (child.state !== "open")
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} (Issue #${childNumber}) is no longer open before a dependency write`, child);
	const contentFinal = approvedFinal !== undefined && carriesApprovedContent(child.title, child.body, approvedFinal);
	const contentBaseline = allowedBaseline !== undefined && child.title === allowedBaseline.title && child.body === allowedBaseline.body;
	if (!contentFinal && !contentBaseline)
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} (Issue #${childNumber}) content is no longer the approved final bytes before a dependency write`, child);
	const initiativeId = [...child.body.matchAll(/<!-- immune-brain:initiative-id=([A-Za-z0-9._:-]+) -->/g)].map((match) => match[1])[0];
	if (!initiativeId)
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} (Issue #${childNumber}) lost its Initiative marker before a dependency write`, child);
	const parent = initiativeLookup(refreshed.issues, refreshed.repository.id, initiativeId);
	if (parent.kind !== "found" || parent.issue.state !== "open")
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} (Issue #${childNumber}) lost its open Parent before a dependency write`, child);
	if (parentExpectedNumber !== undefined && parent.issue.number !== parentExpectedNumber)
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} (Issue #${childNumber}) Parent resolves to Issue #${parent.issue.number}, not the bound Parent Issue #${parentExpectedNumber} before a dependency write`, child);
	// The Parent must still carry exactly the expected amendment bytes before any
	// Child write: after the Parent write it is the approved final content; before
	// the Parent write (non-amendment or pre-write paths) the earlier caller
	// snapshot bytes apply. A concurrent edit that keeps ownership markers intact
	// must fail closed here, not after the dependency mutations in final verification.
	if (parentApproved !== undefined
		&& (parent.issue.title !== parentApproved.title || parent.issue.body !== parentApproved.body))
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} (Issue #${childNumber}) Parent changed since the approved amendment content before a dependency write`, child);
	// Native Sub-issue attachment must still hold immediately before each
	// dependency write: a detached Child no longer belongs to the amendment.
	if (!skipAttachmentCheck) {
		const attachedNow = await readSubIssueNumbers(root, gh, "upsert-task", refreshed.repository, parent.issue.number);
		if (!Array.isArray(attachedNow)) return attachedNow;
		if (!attachedNow.includes(childNumber))
			return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} (Issue #${childNumber}) is no longer attached to the Parent before a dependency write`, child);
	}
	const sliceId = ownershipMarkerValue(child.body, "slice-id");
	if (sliceId && sliceCount(parent.issue.body, sliceId) !== 1)
		return result("upsert-task", "ambiguous_remote_state", `pending Task ${childTaskId} (Issue #${childNumber}) lost its exact Slice in the Parent before a dependency write`, child);
	return child;
}

export async function runGithubInitiativePublication(
	root: string,
	input: InitiativePublicationInput,
	gh: GhTransport = createGhTransport(),
): Promise<GithubInitiativePublicationResult> {
	const absoluteRoot = resolve(root);
	let prepared: ReturnType<typeof preflightPublication>;
	let amendment: ReturnType<typeof validateAmendment> | undefined;
	let amendmentContext: AmendmentExecutionContext | undefined;
	try {
		prepared = preflightPublication(absoluteRoot, input);
		if (input.amendment !== undefined) {
			if (prepared.order.length < 1)
				throw new Error("an amendment requires at least one pending Task");
			const validated = validateAmendment(input);
			const declared = new Set([...validated.tasks.keys(), ...validated.historical.keys()]);
			for (const operation of prepared.order) {
				if (!declared.has(operation.task_id))
					throw new Error(`amendment.tasks must declare pending Task ${operation.task_id}`);
			}
			// The pending batch must be exactly the declared amendment membership: an
			// input.tasks projection that omits a declared pending Task would pass
			// topology preflight and mutate the Parent before failing at final
			// membership, leaving the Parent without that Child's Slice line.
			const projectedIds = new Set(prepared.order.map((operation) => operation.task_id));
			for (const taskId of validated.tasks.keys()) {
				if (!projectedIds.has(taskId))
					throw new Error(`amendment.tasks declares pending Task ${taskId} but input.tasks omits its projection; the pending batch must cover every declared pending Task`);
			}
			for (const [taskId] of validated.historical) {
				if (projectedIds.has(taskId))
					throw new Error(`Task ${taskId} is declared historical but also projected in input.tasks`);
			}
			for (const [taskId, binding] of validated.historical) {
				if (binding.state === "open")
					throw new Error(`historical Task ${taskId} must be a closed Issue; open work belongs in amendment.tasks`);
			}
			amendment = validated;
		}
	} catch (error) {
		return publicationResult("permanent_failure", error instanceof Error ? error.message : String(error));
	}
	const conflict = carrierConflict(absoluteRoot, "create-initiative", prepared.initiative.initiative_id);
	if (conflict) return publicationResult(conflict.status, conflict.message, conflict);
	const initial = await snapshot(absoluteRoot, gh, "create-initiative");
	if ("contract" in initial) return publicationResult(initial.status, initial.message, initial);
	const initialParent = initiativeLookup(initial.issues, initial.repository.id, prepared.initiative.initiative_id);
	if (initialParent.kind === "ambiguous") return publicationResult("ambiguous_remote_state", initialParent.message);
	if (amendment && initialParent.kind === "missing")
		return publicationResult("permanent_failure", "an amendment requires the Initiative Parent to already exist");
	// Label availability is validated before any remote mutation: the tracker
	// never creates labels, so a missing label fails the whole batch closed
	// instead of half-publishing an Initiative.
	const requiredLabels = [...new Set(prepared.order.flatMap((operation) => desiredTaskLabels(operation)))];
	const labelFailure = await labelAvailabilityFailure(absoluteRoot, gh, initial.repository, requiredLabels);
	if (labelFailure) return publicationResult(labelFailure.status, labelFailure.message, labelFailure);
	const parentForPreflight = initialParent.kind === "found" ? initialParent.issue : {
		id: Number.MAX_SAFE_INTEGER,
		number: Number.MAX_SAFE_INTEGER,
		url: `https://github.com/${initial.repository.name_with_owner}/issues/${Number.MAX_SAFE_INTEGER}`,
		title: "",
		body: "",
		state: "open" as const,
		state_reason: null,
		labels: [],
	};
	const parentBodyFailure = bodyLimitFailure("create-initiative", createInitiativeBody(initial.repository, prepared.initiative));
	if (parentBodyFailure) return publicationResult(parentBodyFailure.status, parentBodyFailure.message, parentBodyFailure);
	for (const operation of prepared.order) {
		const childFailure = bodyLimitFailure("upsert-task", childBody(initial.repository, operation, parentForPreflight), MAX_TERMINAL_SUFFIX_BYTES);
		if (childFailure) return publicationResult(childFailure.status, childFailure.message, childFailure);
	}

	if (amendment) {
		if (initialParent.kind !== "found")
			return publicationResult("permanent_failure", "an amendment requires the Initiative Parent to already exist");
		// Caller-controlled binding constraints (missing or duplicate historical
		// Slice markers) must surface as structured fail-closed publication results,
		// never as thrown exceptions escaping the guarded validation boundary.
		let approvedFinalParent: ReturnType<typeof approvedAmendmentContent>;
		try {
			approvedFinalParent = approvedAmendmentContent(absoluteRoot, initial.repository, initialParent.issue, prepared, amendment);
		} catch (error) {
			return publicationResult("permanent_failure", error instanceof Error ? error.message : String(error));
		}
		// Slice identity collisions are deterministic input contract violations (the
		// batch itself declares two Children with one Slice id), not remote drift.
		if (typeof approvedFinalParent === "string" && approvedFinalParent.includes("collides with a historical Task Slice"))
			return publicationResult("permanent_failure", approvedFinalParent);
		if (typeof approvedFinalParent === "string") return publicationResult("ambiguous_remote_state", approvedFinalParent);
		const { parent, pendingContent, historicalSlices } = approvedFinalParent;
		// Deterministic prerequisite completion is validated before any write: a
		// historical prerequisite already closed without state_reason "completed"
		// (e.g. not_planned) makes the batch permanently unfulfillable, so it must
		// fail closed in preflight with zero mutations instead of after the Parent
		// and Child writes (the final check still guards concurrent races).
		for (const operation of prepared.order) {
			for (const blockerId of operation.projection?.blocked_by ?? []) {
				if (!amendment.historical.has(blockerId)) continue;
				const blocker = taskLookup(initial.issues, initial.repository.id, blockerId);
				if (blocker.kind === "found" && (blocker.issue.state !== "closed" || blocker.issue.state_reason !== "completed"))
					return publicationResult("ambiguous_remote_state", `Task ${operation.task_id} depends on stopped historical prerequisite ${blockerId}`);
			}
		}
		const parentBaseline = amendment.parent.body !== initialParent.issue.body || amendment.parent.title !== initialParent.issue.title;
		const parentApproved = initialParent.issue.title === parent.title && initialParent.issue.body === parent.body;
		if (parentBaseline && !parentApproved) return publicationResult("ambiguous_remote_state", `amendment Parent changed since the approved amendment baseline`);
		if (amendment.parent.issue_number !== initialParent.issue.number)
			return publicationResult("ambiguous_remote_state", `amendment Parent is bound to Issue #${amendment.parent.issue_number} but observed Issue #${initialParent.issue.number}`);
		if (initialParent.issue.state !== "open")
			return publicationResult("ambiguous_remote_state", "an amendment requires the Initiative Parent to remain open");
		const topology = await validateAmendmentTopology(
			absoluteRoot, gh, initial, prepared.initiative.initiative_id, initialParent.issue,
			amendment.tasks, amendment.historical,
			prepared.foreign_dependers,
			{ pendingContent, parent, historicalSlices },
			prepared.order,
		);
		if (!("get" in topology)) return publicationResult(topology.status, topology.message, topology);
		const historicalRelations = new Map<string, { blocked_by: number[]; state_reason: string | null }>();
		for (const [taskId, binding] of amendment.historical) {
			const issue = topology.get(taskId)!;
			const observed = await readBlockedByIds(absoluteRoot, gh, "upsert-task", initial.repository, issue.number);
			if (!Array.isArray(observed)) return publicationResult(observed.status, observed.message, observed);
			historicalRelations.set(taskId, { blocked_by: observed, state_reason: issue.state_reason });
		}
		amendmentContext = {
			pendingContent,
			parent,
			parentIssueNumber: amendment.parent.issue_number,
			historicalSlices,
			historicalRelations,
		};
	}

	const beforeParentWrite = publicationIntentDrift(absoluteRoot, prepared.intent_bindings);
	if (beforeParentWrite) return publicationResult("ambiguous_remote_state", beforeParentWrite);
	let parentResult: GithubTrackerResult;
	if (amendment && amendmentContext) {
		parentResult = await amendInitiativeParent(absoluteRoot, gh, prepared.initiative, initial, amendment.parent, amendmentContext);
	} else {
		parentResult = await runGithubTrackerOperation(absoluteRoot, prepared.initiative, gh);
	}
	if (!isSuccessfulTrackerStatus(parentResult.status))
		return publicationResult(parentResult.status, parentResult.message, parentResult);
	const taskResults: GithubInitiativePublicationResult["tasks"] = [];
	for (const operation of prepared.order) {
		const intentDrift = publicationIntentDrift(absoluteRoot, prepared.intent_bindings, [operation.task_id]);
		if (intentDrift) return publicationResult("ambiguous_remote_state", intentDrift, parentResult, taskResults);
		const taskResult = amendment
			? await runAmendmentTaskOperation(absoluteRoot, gh, operation, amendment.tasks.get(operation.task_id), amendmentContext)
			: await runGithubTrackerOperation(absoluteRoot, operation, gh);
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
	if (amendment) {
		// Repeat complete observed-membership classification on the final snapshot:
		// an undeclared closed Task carrying this Initiative's markers that becomes
		// observable only after preflight (detached, so the Sub-issue parity check
		// cannot see it) must still fail the publication, not report success.
		const finalClassified = classifyObservedChildren(finalSource, prepared.initiative.initiative_id, amendment.tasks, amendment.historical);
		if (typeof finalClassified === "string") return publicationResult("ambiguous_remote_state", finalClassified, parentResult, taskResults);
	}
	const parent = initiativeLookup(finalSource.issues, finalSource.repository.id, prepared.initiative.initiative_id);
	if (parent.kind !== "found") return publicationResult("ambiguous_remote_state", parent.kind === "ambiguous" ? parent.message : "published Initiative Parent disappeared", parentResult, taskResults);
	const amendedFinalSliceIds = new Set(prepared.initiative.slices.map((slice) => slice.id));
	const parentDrift = publicationIssueDrift(
		parentResult,
		parent.issue,
		amendmentContext ? amendmentContext.parent.title : initiativeIssueTitle(prepared.initiative.initiative_id, prepared.initiative.projection),
		amendmentContext
			? amendmentContext.parent.body
			: createInitiativeBody(finalSource.repository, prepared.initiative),
		"Initiative Parent",
	);
	if (parentDrift) return publicationResult("ambiguous_remote_state", parentDrift, parentResult, taskResults);
	if (amendmentContext) {
		// The rewritten Parent must carry each declared historical Slice marker
		// exactly once: generation drops or duplicates would break terminal
		// ownership without failing any other final check.
		for (const line of amendmentContext.historicalSlices) {
			const sliceId = ownershipMarkerValue(line, "slice-id");
			if (!sliceId || countLiteral(parent.issue.body, marker("slice-id", sliceId)) !== 1)
				return publicationResult("ambiguous_remote_state", `regenerated Parent does not carry historical Slice ${sliceId ?? "?"} exactly once`, parentResult, taskResults);
		}
	}
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
			taskIssueTitle(operation, sliceOrdinalFromChecklist(parent.issue.body, operation.slice_id, operation.projection?.slice_ordinal ?? 1)),
			childBody(finalSource.repository, operation, parent.issue),
			`Task ${operation.task_id}`,
			{ allowTerminalSuffix: amendmentContext !== undefined },
		);
		if (childDrift) return publicationResult("ambiguous_remote_state", childDrift, parentResult, taskResults);
		const expectedLabels = desiredTaskLabels(operation);
		if (childResult.status !== "already_current" && expectedLabels.some((label) => !child.issue.labels.includes(label)))
			return publicationResult("ambiguous_remote_state", `Task ${operation.task_id} is missing publication labels after publication`, parentResult, taskResults);
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
	if (amendment) {
		for (const [taskId, binding] of amendment.historical) {
			// Full ownership lookup: repository, protocol, marker uniqueness, and
			// repo-wide Task identity must resolve the exact bound Issue.
			const owned = taskLookup(finalSource.issues, finalSource.repository.id, taskId);
			if (owned.kind !== "found" || owned.issue.number !== binding.issue_number)
				return publicationResult("ambiguous_remote_state", `historical Task ${taskId} ownership failed after publication`, parentResult, taskResults);
			const historical = owned.issue;
			const drift = amendmentBindingDrift(binding, historical, `historical Task ${taskId}`);
			if (drift) return publicationResult("ambiguous_remote_state", drift, parentResult, taskResults);
			if (!attached.includes(historical.number))
				return publicationResult("ambiguous_remote_state", `historical Task ${taskId} lost its native Sub-issue attachment`, parentResult, taskResults);
			// R1 final check: historical Slice identities must not collide with any
			// pending Slice published by this batch — two Children must never share
			// one Slice identity, including historical Children whose Parent lines are
			// carried over rather than re-rendered.
			const historicalSliceId = ownershipMarkerValue(historical.body, "slice-id");
			if (historicalSliceId && amendedFinalSliceIds.has(historicalSliceId))
				return publicationResult("ambiguous_remote_state", `historical Task ${taskId} Slice ${historicalSliceId} collides with a pending Task Slice of the same id`, parentResult, taskResults);
			const snapshotRelations = amendmentContext?.historicalRelations.get(taskId);
			if (snapshotRelations) {
				if (historical.state_reason !== snapshotRelations.state_reason)
					return publicationResult("ambiguous_remote_state", `historical Task ${taskId} terminal state_reason changed during amendment`, parentResult, taskResults);
				const finalBlockedBy = await readBlockedByIds(absoluteRoot, gh, "upsert-task", finalSource.repository, historical.number);
				if (!Array.isArray(finalBlockedBy)) return publicationResult(finalBlockedBy.status, finalBlockedBy.message, parentResult, taskResults);
				if (finalBlockedBy.length !== snapshotRelations.blocked_by.length || finalBlockedBy.some((id, index) => id !== snapshotRelations.blocked_by[index]))
					return publicationResult("ambiguous_remote_state", `historical Task ${taskId} native blocked_by relations changed during amendment`, parentResult, taskResults);
			}
		}
		const attachedNumbers = new Set(attached);
		for (const number of attachedNumbers) {
			const issue = finalSource.issues.find((candidate) => candidate.number === number);
			const taskId = issue ? ownershipMarkerValue(issue.body, "task-id") : null;
		if (!taskId || (!amendment.tasks.has(taskId) && !amendment.historical.has(taskId)))
				return publicationResult("ambiguous_remote_state", `Parent Sub-issue #${number} is not part of the declared amendment membership`, parentResult, taskResults);
		}
		for (const operation of prepared.order) {
			for (const blockerId of operation.projection?.blocked_by ?? []) {
				if (amendment.historical.has(blockerId)) {
					const blocker = taskLookup(finalSource.issues, finalSource.repository.id, blockerId);
					if (blocker.kind !== "found" || blocker.issue.state_reason !== "completed")
						return publicationResult("ambiguous_remote_state", `Task ${operation.task_id} depends on stopped historical prerequisite ${blockerId}`, parentResult, taskResults);
				}
			}
		}
	}
	const sortedAttached = [...attached].sort((left, right) => left - right);
	const sortedExpected = [...expectedNumbers, ...(amendment ? [...amendment.historical.values()].map((binding) => binding.issue_number) : [])].sort((left, right) => left - right);
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

function taskPublication(
	root: string,
	initiativeId: string,
	sliceId: string,
	intentPath: string,
	acceptance: unknown,
	projection: TaskProjection | undefined,
	ordinal: number,
	initiativeShortName: string,
): PreparedPublicationTask {
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
	if (!Array.isArray(acceptance)) throw new Error(`Task ${taskId} requires public acceptance summaries`);
	const expectedIds = new Set(intent.acceptance.map((item) => item.id));
	const publicById = new Map<string, { id: string; summary: string }>();
	acceptance.forEach((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item))
			throw new Error(`Task ${taskId} acceptance[${index}] must be an object`);
		const raw = item as Record<string, unknown>;
		const id = identifier(raw.id, `Task ${taskId} acceptance[${index}].id`);
		if (!expectedIds.has(id)) throw new Error(`Task ${taskId} has unknown public acceptance id: ${id}`);
		if (publicById.has(id)) throw new Error(`Task ${taskId} has duplicate public acceptance id: ${id}`);
		publicById.set(id, { id, summary: projectionText(raw.summary, `Task ${taskId} acceptance[${index}].summary`, 500) });
	});
	const missingIds = [...expectedIds].filter((id) => !publicById.has(id));
	if (missingIds.length) throw new Error(`Task ${taskId} is missing public acceptance ids: ${missingIds.join(", ")}`);
	// Display names are stamped from the Initiative so every Child title carries
	// the same short name and its declared Slice position; an explicitly
	// supplied value must agree, never silently override.
	if (projection?.short_name !== undefined && projection.short_name !== initiativeShortName)
		throw new Error(`Task ${taskId} projection.short_name must match the Initiative short name`);
	if (projection?.slice_ordinal !== undefined && projection.slice_ordinal !== ordinal)
		throw new Error(`Task ${taskId} projection.slice_ordinal must match its declared Slice position ${ordinal}`);
	const stampedProjection: TaskProjection = {
		...(projection ?? {}),
		short_name: initiativeShortName,
		slice_ordinal: ordinal,
	};
	return {
		operation: validateOperation({
			op: "upsert-task",
			initiative_id: initiativeId,
			task_id: intent.task_id,
			slice_id: sliceId,
			goal: intent.goal,
			risk: intent.risk,
			acceptance: intent.acceptance.map((item) => publicById.get(item.id)!),
			projection: stampedProjection,
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
