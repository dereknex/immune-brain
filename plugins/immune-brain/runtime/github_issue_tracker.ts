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

/**
 * How much remote effect the caller may believe, stated explicitly instead of
 * inferred from the status code.
 *
 * `confirmed` means every step settled and was read back. `uncertain` means the
 * caller may not assume zero writes: the call must re-read exact ownership,
 * topology and intent-hash state before replaying the same approved manifest.
 * The layer never claims "zero writes" itself, because a status code cannot
 * prove the absence of a remote effect; only the transport's own call record
 * can, and a caller that needs that decides from its own readback.
 */
export type PublicationWriteState = "confirmed" | "uncertain";

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
	/** Truthful effect reporting for the whole batch. */
	write_state: PublicationWriteState;
	/** Task ids whose step is confirmed written and read back. */
	confirmed_steps: string[];
	/** Task ids whose step is not yet confirmed. */
	pending_steps: string[];
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
		/** The canonical TaskIntent content hash this Task was prepared from. */
		intent_hash?: string;
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
	run(args: string[], options?: { cwd?: string; stdin?: string; signal?: { readonly aborted: boolean } }): Promise<GhExecution>;
}

/**
 * External cancellation for a multi-step operation. There is no cumulative
 * deadline: one publication call is a finite step sequence that stops at its
 * first failed call, and each call keeps its own per-call timeout. Only the
 * caller's abort signal is forwarded to every call.
 */
export interface OperationCancellation {
	/** Optional external cancellation signal (user cancel / host abort). */
	signal?: { readonly aborted: boolean };
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

function marker(name: "repo-id" | "initiative-id" | "task-id" | "slice-id" | "intent-hash", value: string | number): string {
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
	// A transport failure is the one class where re-reading the approved state and
	// replaying the same manifest is the correct recovery, so that action is
	// attached here, at the origin. Any other failure keeps its own message as
	// the single action; nothing generic is layered on top of it.
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
				// A cancelled operation never starts another remote call.
				if (options.signal?.aborted) {
					complete({
						exit_code: 1,
						stdout: "",
						stderr: "operation cancelled by the caller",
						timed_out: true,
						output_exceeded: false,
					});
					return;
				}
				const remaining = GH_TIMEOUT_MS;
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
				}, remaining);
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

/**
 * The published Intent identity marker, when the Child carries one. `null` means
 * this Child was published before the marker existed: an upgraded tracker still
 * converges it (the marker is additive), which keeps a previously published
 * batch idempotently replayable across the upgrade. It is never invented
 * locally: the value is the canonical hash of the Intent the Child was prepared
 * from.
 */
/** Any published-identity markers on the body, in order. */
function publishedIntentHashMarkers(body: string): string[] {
	return [...body.matchAll(/<!-- immune-brain:intent-hash=([A-Za-z0-9][A-Za-z0-9._:-]{0,127}) -->/g)].map((match) => match[1]);
}

/**
 * The published Intent identity of a Child, as three distinct states:
 *
 * - `absent`: published before the marker existed. It is a pre-upgrade
 *   publication and still converges, because the marker is additive.
 * - `bound`: exactly one well-formed marker. It must agree with the Intent
 *   being published.
 * - `ambiguous`: two or more markers. The Child states several conflicting
 *   identities, so nothing can be trusted about which Intent it came from; it
 *   fails closed rather than being read as `absent`.
 *
 * Collapsing `ambiguous` into `absent` would let a Child carry both the correct
 * and a stale hash and still pass every check, so the three states are kept
 * separate everywhere the identity is read.
 */
type PublishedIntentIdentity =
	| { kind: "absent" }
	| { kind: "bound"; hash: string }
	| { kind: "ambiguous"; hashes: string[] };

function publishedIntentIdentity(body: string): PublishedIntentIdentity {
	const hashes = publishedIntentHashMarkers(body);
	if (hashes.length === 0) return { kind: "absent" };
	if (hashes.length === 1) return { kind: "bound", hash: hashes[0] };
	return { kind: "ambiguous", hashes };
}

/** The identity mismatch message for one Child, or null when it is acceptable. */
function publishedIntentMismatch(body: string, taskId: string, expected: string | undefined): string | null {
	const identity = publishedIntentIdentity(body);
	if (identity.kind === "ambiguous")
		return `published Task ${taskId} carries ${identity.hashes.length} conflicting intent-hash markers; its published Intent identity is ambiguous`;
	if (identity.kind === "absent" || expected === undefined) return null;
	if (identity.hash !== expected)
		return `published Task ${taskId} was published from a different TaskIntent revision; the published identity no longer matches the Intent being published`;
	return null;
}

/**
 * Bodies compared for drift, ignoring the optional published-identity marker.
 *
 * The identity marker is additive, so a Child published before it existed has
 * none and must still compare equal here; the identity itself is checked
 * separately, and a multiply-marked body is rejected outright rather than
 * having its markers stripped and ignored.
 */
function sameTrackedBody(current: string, expected: string): boolean {
	return stripPublishedIntentHash(current) === stripPublishedIntentHash(expected);
}

function stripPublishedIntentHash(body: string): string {
	return body.replace(/<!-- immune-brain:intent-hash=[A-Za-z0-9][A-Za-z0-9._:-]{0,127} -->\n?/g, "");
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
	].join("\n")}\n\n${provenance}## How to use this Issue\n\n- Edit planning prose and Slice ordering directly after creation.\n- Keep each Slice marker attached to exactly one stable Slice entry.\n- The tracker never rewrites this Parent after creation; the tracker closes it as completed once every Slice Child is completed, and never closes it otherwise.\n\n## Problem\n\n${publicText(projection.problem ?? "The Initiative addresses the bounded delivery described below.", "projection.problem")}\n\n## Result\n\n${publicText(projection.result ?? operation.goal, "projection.result")}\n\n## Initiative design\n\n${publicText(projection.design ?? "Each Child preserves the shared Initiative decisions and boundaries recorded here.", "projection.design")}\n\n## Decisions\n\n${listText(projection.decisions, "- No additional Initiative decisions recorded.")}\n\n## Testing strategy\n\n${publicText(projection.testing_strategy ?? "Each Child closes from its focused acceptance verification.", "projection.testing_strategy")}\n\n## Out of scope\n\n${listText(projection.out_of_scope, "- Unrelated work outside this Initiative.")}\n\n## Slices\n\n${operation.slices.length + historicalSlices.length === 0 ? "No Slices recorded yet." : [...historicalSlices, ...operation.slices.map((slice) => `- [ ] ${marker("slice-id", slice.id)} **${slice.id}**: ${slice.result ?? slice.goal}${slice.blocked_by?.length ? ` (blocked by: ${slice.blocked_by.join(", ")})` : ""}`)].join("\n")}\n\n${ISSUE_FOOTER}\n`;
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
		// The approved Intent identity travels with the published Child, so an
		// idempotent replay can compare against what was actually published
		// instead of against whatever bytes it happens to read this time.
		...(operation.intent_hash ? [marker("intent-hash", operation.intent_hash)] : []),
	].join("\n")}\n\n## Parent\n\n| Initiative | \`${operation.initiative_id}\` |\n| Parent Issue | [#${parent.number}](${parent.url}) |\n| Slice | \`${operation.slice_id}\` |\n| Risk | \`${operation.risk}\` |\n\n## Current behavior\n\n${publicText(projection.current_behavior ?? "The current behavior is defined by the repository's existing contract.", "projection.current_behavior")}\n\n## Desired behavior\n\n${publicText(projection.desired_behavior ?? projection.result ?? operation.goal, "projection.desired_behavior")}\n\n## Key interfaces\n\n${listText(projection.key_interfaces, "- Canonical TaskIntent acceptance and Kernel lifecycle remain authoritative.")}\n\n## Acceptance criteria\n\n${acceptance}\n\n## Verification\n\n${publicText(projection.verification ?? "Run the focused acceptance verification declared by the TaskIntent.", "projection.verification")}\n\n## Blocked by\n\n${projection.blocked_by?.length ? projection.blocked_by.map((id) => `- \`${identifier(id, "blocked_by task_id")}\``).join("\n") : "None"}\n\n## Out of scope\n\n${listText(projection.out_of_scope, "- Scope not declared by the validated TaskIntent.")}\n\n## Agent handoff\n\n${publicText(projection.agent_handoff ?? "Implement only the bounded TaskIntent result and run the focused checks. Do not widen scope or treat GitHub as authorization.", "projection.agent_handoff")}\n\n${ISSUE_FOOTER}\n`;
}

/** Derived approved-final content and baseline-derived historical evidence for an amendment. */
interface AmendmentExecutionContext {
	/** Approved final title/body per pending Task id. */
	pendingContent: Map<string, { title: string; body: string }>;
	/** Approved final Parent title/body. */
	parent: { title: string; body: string };
	/** Historical Slice lines derived from the approved Parent baseline (exact bytes). */
	historicalSlices: string[];
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
		historicalSlices,
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


async function upsertTask(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "upsert-task" }>,
	source: RepositorySnapshot,
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
		child = created.issue;
		createdChild = true;
	} else {
		const owned = ownedTaskLookup(source.issues, source.repository.id, operation.task_id, operation.initiative_id, operation.slice_id);
		if (owned.kind !== "found") return result(operation.op, "ambiguous_remote_state", owned.kind === "ambiguous" ? owned.message : "Task Issue ownership changed during publication", found.issue);
		child = owned.issue;
		if (!sameTrackedBody(found.issue.body, body) || found.issue.title !== title)
			return result(operation.op, "permanent_failure", "Task Issue already exists with a different title or Agent Brief; edit the GitHub source or retry the original projection before changing native relations", found.issue);
		// The published surface records the approved Intent identity. A Child that
		// carries it must agree exactly; a Child published before the marker
		// existed has nothing to compare against and still converges.
		const intentMismatch = publishedIntentMismatch(found.issue.body, operation.task_id, operation.intent_hash);
		if (intentMismatch) return result(operation.op, "ambiguous_remote_state", intentMismatch, found.issue);
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
	if (finalChild.kind !== "found" || finalChild.issue.id !== child.id || finalChild.issue.title !== title || !sameTrackedBody(finalChild.issue.body, body))
		return result(operation.op, "ambiguous_remote_state", "Task Issue changed identity, title, or body during dependency publication", child);
	const finalIdentityMismatch = publishedIntentMismatch(finalChild.issue.body, operation.task_id, operation.intent_hash);
	if (finalIdentityMismatch) return result(operation.op, "ambiguous_remote_state", finalIdentityMismatch, child);
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

async function markChildTerminal(
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

/**
 * The Parent decision reads only Issue-scoped endpoints (the Parent and its
 * Sub-issue list), never a repository listing. A failed read or close is a
 * tracker observation whose single retry action is the same `mark-terminal`;
 * the Child's terminal closure is already confirmed and stays unchanged.
 */
async function closeParentWhenComplete(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "mark-terminal" }>,
	source: RepositorySnapshot,
	childResult: GithubTrackerResult,
): Promise<GithubTrackerResult> {
	const child = taskLookup(source.issues, source.repository.id, operation.task_id);
	if (child.kind !== "found") return childResult;
	const initiativeId = ownershipMarkerValue(child.issue.body, "initiative-id");
	if (!initiativeId) return childResult;
	const parentLookup = initiativeLookup(source.issues, source.repository.id, initiativeId);
	if (parentLookup.kind !== "found") return childResult;
	const parentNumber = parentLookup.issue.number;
	const retry = (message: string, status: TrackerStatus = "retryable_failure") =>
		result(operation.op, status, `Parent #${parentNumber}: ${message}; the Task closure is unchanged, retry the same mark-terminal`, child.issue);
	const endpoint = `repos/${source.repository.name_with_owner}/issues/${parentNumber}`;
	const readParent = async (): Promise<GithubIssue | GithubTrackerResult> => {
		const read = await gh.run(["api", endpoint], { cwd: root });
		if (read.exit_code !== 0 || read.output_exceeded) {
			const failed = ghFailure(operation.op, read, "cannot read the Initiative Parent");
			return retry(failed.message, failed.status);
		}
		try {
			const [issue] = parseIssues(`[${read.stdout}]`);
			return issue ?? retry("gh returned a malformed Issue", "permanent_failure");
		} catch (error) {
			return retry(error instanceof Error ? error.message : String(error), "permanent_failure");
		}
	};
	const parent = await readParent();
	if ("contract" in parent) return parent;
	if (parent.state === "closed") return childResult;
	const listed = await gh.run(["api", "--paginate", "--slurp", `${endpoint}/sub_issues?per_page=100`], { cwd: root });
	if (listed.exit_code !== 0 || listed.output_exceeded) {
		const failed = ghFailure(operation.op, listed, "cannot read the Initiative Sub-issues");
		return retry(failed.message, failed.status);
	}
	let children: GithubIssue[];
	try {
		children = parseIssues(listed.stdout);
	} catch (error) {
		return retry(error instanceof Error ? error.message : String(error), "permanent_failure");
	}
	const sliceChildren = children.filter((candidate) =>
		candidate.body.includes(marker("initiative-id", initiativeId))
		&& /<!-- immune-brain:slice-id=[^>]+ -->/.test(candidate.body));
	if (sliceChildren.length === 0
		|| !sliceChildren.every((candidate) => candidate.state === "closed" && candidate.state_reason === "completed"))
		return childResult;
	const close = await gh.run(["issue", "close", String(parentNumber), "--repo", source.repository.name_with_owner, "--reason", "completed"], { cwd: root });
	const confirmed = await readParent();
	if ("contract" in confirmed) return confirmed;
	if (confirmed.state === "closed" && confirmed.state_reason === "completed")
		return result(operation.op, "updated", `${childResult.message}; Initiative Parent #${parentNumber} closed as completed`, child.issue);
	if (close.exit_code !== 0 || close.output_exceeded) {
		const failed = ghFailure(operation.op, close, "Initiative Parent closure failed");
		return retry(failed.message, failed.status);
	}
	return retry("closure did not converge");
}

async function markTerminal(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "mark-terminal" }>,
	source: RepositorySnapshot,
): Promise<GithubTrackerResult> {
	const terminal = await markChildTerminal(root, gh, operation, source);
	if (operation.phase !== "done" || (terminal.status !== "updated" && terminal.status !== "already_current") || !terminal.association_found)
		return terminal;
	return closeParentWhenComplete(root, gh, operation, source, terminal);
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

/**
 * The publication result builder. `plannedTaskIds` is the operation's complete
 * step set, known before the first remote write; every Task that is not
 * confirmed is a pending step, so a Parent failure, an early Child failure, or
 * a post-plan validation refusal still reports every unfinished Task instead of
 * an empty list.
 */
function publicationResultWithPlan(
	plannedTaskIds: readonly string[],
	status: TrackerStatus,
	message: string,
	initiative?: GithubTrackerResult,
	tasks: GithubInitiativePublicationResult["tasks"] = [],
	execution?: GithubInitiativePublicationResult["execution"],
): GithubInitiativePublicationResult {
	const settledTaskSteps = tasks.filter((task) => isSuccessfulTrackerStatus(task.status));
	const confirmedIds = new Set(settledTaskSteps.map((task) => task.task_id));
	const planned = plannedTaskIds.length > 0 ? plannedTaskIds : tasks.map((task) => task.task_id);
	const pendingSteps = planned.filter((taskId) => !confirmedIds.has(taskId));
	// Truthful effect reporting: a caller must be able to tell a confirmed, read
	// back write from an outcome it may not treat as zero writes. A failure says
	// nothing about how much already landed, so its write state is `uncertain`,
	// never `confirmed` and never "zero writes".
	const writeState: PublicationWriteState = status === "created" || status === "updated" || status === "already_current"
		? "confirmed"
		: "uncertain";
	// A failure never proves zero writes, so that fact is always stated. The
	// replay *action* is offered only when replaying could actually work: a
	// permanent_failure needs its own specific fix first, so its own message stays
	// the single action instead of being joined by a replay suggestion.
	const uncertainty = writeState === "confirmed"
		? ""
		: "This failure does not prove zero writes; earlier steps may already have landed. ";
	// One action for the whole retryable class, so a failure that reaches this
	// builder without the transport-level attribution still gets exactly one
	// corrective action instead of none. Permanent failures keep their own.
	const recovery = status === "retryable_failure"
		? "Re-read the exact ownership, Sub-issue topology and intent hashes, then replay the same approved manifest. "
		: "";
	// A permanent_failure needs its own specific repair, and its own message is
	// that single action; nothing generic is layered on top of it.
	return {
		contract: "immune_brain/github_initiative_publication/v1",
		operation: "publish-initiative",
		status,
		...(initiative ? { initiative } : {}),
		tasks,
		write_state: writeState,
		confirmed_steps: settledTaskSteps.map((task) => task.task_id),
		pending_steps: pendingSteps,
		...(execution ? { execution } : {}),
		message: `${uncertainty}${recovery}${redactGithubDiagnostic(message)}`,
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

/**
 * Whole-batch validation before any recovery write.
 *
 * A repeated publication is a recovery pass: it may repair managed label drift
 * and converge pending Children. Before the first such write, every already
 * published Child of this batch must still be the one this Intent approves --
 * correct ownership markers, exactly one Slice entry in the Parent, and the
 * published Intent identity where the Child carries one. Otherwise a later
 * Child's mismatch could be discovered only after earlier Children had already
 * been written, which is exactly the partial recovery this pass must not cause.
 */
function publicationBatchDrift(
	source: RepositorySnapshot,
	initiativeId: string,
	order: readonly Extract<TrackerOperation, { op: "upsert-task" }>[],
): string | null {
	const parent = initiativeLookup(source.issues, source.repository.id, initiativeId);
	// A missing Parent is not a batch-drift condition: creation is the normal path.
	if (parent.kind === "missing") return null;
	if (parent.kind === "ambiguous") return parent.message;
	// Narrow by construction: this check exists solely because the published
	// Intent identity is verified inside each Child's own convergence pass, so a
	// later Child's mismatch would otherwise be discovered only after an earlier
	// Child had already been repaired. Every other precondition keeps its
	// existing classification on the existing path.
	for (const operation of order) {
		const found = ownedTaskLookup(
			source.issues,
			source.repository.id,
			operation.task_id,
			initiativeId,
			operation.slice_id,
		);
		if (found.kind !== "found") continue;
		const mismatch = publishedIntentMismatch(found.issue.body, operation.task_id, operation.intent_hash);
		if (mismatch) return mismatch;
	}
	return null;
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

/**
 * The Issue number at the end of a `gh issue create` response URL, or null.
 * Creation takes its number from the create response: no read-back follows a
 * write, so a response that cannot be parsed leaves the outcome uncertain
 * rather than asking the repository what landed.
 */
function parseCreatedIssueNumber(stdout: string): number | null {
	const match = stdout.trim().match(/\/issues\/(\d+)\/?$/);
	if (!match) return null;
	const number = Number(match[1]);
	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Resolve one Issue's database id. Assumption A1 fallback: `gh issue create`
 * returns only the Issue URL, so the id the relation endpoints require is read
 * once per created Issue immediately after its create. The id is never
 * re-resolved for an Issue the start listing already carries.
 */
async function resolveIssueId(
	root: string,
	gh: GhTransport,
	repository: RepositoryInfo,
	number: number,
): Promise<GithubTrackerResult | number> {
	const read = await gh.run(
		["api", "--jq", ".id", `repos/${repository.name_with_owner}/issues/${number}`],
		{ cwd: root },
	);
	if (read.exit_code !== 0 || read.output_exceeded)
		return ghFailure("upsert-task", read, `cannot resolve the database id of Issue #${number}`);
	const id = Number(read.stdout.trim());
	return Number.isSafeInteger(id) && id > 0
		? id
		: result("upsert-task", "retryable_failure", `Issue #${number} identity could not be resolved`);
}

/**
 * Direct publication: S1 of docs/specs/tracker-direct-publication.spec.md.
 *
 * Mirrors the `to-spec`/`to-tickets` write flow. One start-of-run read of the
 * repository identity and the Issue listing (plus the label list, resolved by
 * the caller), then one create per absent Issue in dependency order, one native
 * Sub-issue attach per Child, and one `blocked_by` write per dependency edge --
 * every Issue number and id taken from its create response. Nothing is re-read
 * after a write, so a half-landed batch is recovered by rerunning the same
 * approved manifest: the next start listing adopts whatever landed and only the
 * missing relations are written. The reads that are not the start listing -- the
 * Parent's native Sub-issue list, each adopted Child's `blocked_by` set, and one
 * id resolution per created Issue -- are targeted at Issues the batch itself
 * owns and all happen before the relation write they inform.
 */
async function publishInitiativeDirect(
	root: string,
	gh: GhTransport,
	prepared: ReturnType<typeof preflightPublication>,
	initial: RepositorySnapshot,
): Promise<GithubInitiativePublicationResult> {
	const plannedTaskIds = prepared.order.map((operation) => operation.task_id);
	const initiativeId = prepared.initiative.initiative_id;
	const repository = initial.repository;
	const desiredParentTitle = initiativeIssueTitle(initiativeId, prepared.initiative.projection);
	const desiredParentBody = createInitiativeBody(repository, prepared.initiative);
	let initiativeResult: GithubTrackerResult | undefined;
	const taskResults: GithubInitiativePublicationResult["tasks"] = [];
	const failed = (failure: GithubTrackerResult): GithubInitiativePublicationResult =>
		publicationResultWithPlan(plannedTaskIds, failure.status, failure.message, initiativeResult, taskResults);

	const parentLookup = initiativeLookup(initial.issues, repository.id, initiativeId);
	if (parentLookup.kind === "ambiguous")
		return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", parentLookup.message);
	const existingParent = parentLookup.kind === "found" ? parentLookup.issue : null;
	// A closed Parent is start-of-run drift: it is state the listing already
	// reveals, so it fails closed here rather than being adopted as current.
	if (existingParent && existingParent.state !== "open")
		return publicationResultWithPlan(
			plannedTaskIds,
			"ambiguous_remote_state",
			"Initiative Parent is no longer open",
			result("create-initiative", "ambiguous_remote_state", "Initiative Parent is no longer open", existingParent),
		);
	// Whole-batch validation before the first write: every already-published
	// Child of this batch must still be the one this Intent approves, including
	// its published Intent identity. This runs before the Parent content check
	// because the Parent body embeds the Child goal prose, so a stale Intent must
	// be reported as the identity mismatch it is, not as Parent drift.
	const batchDrift = publicationBatchDrift(
		initial,
		initiativeId,
		prepared.order as Extract<TrackerOperation, { op: "upsert-task" }>[],
	);
	if (batchDrift) return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", batchDrift);
	// The Parent is never rewritten: an existing Parent that no longer carries
	// the exact approved bytes is a permanent, caller-fixable drift.
	if (existingParent && (existingParent.title !== desiredParentTitle || existingParent.body !== desiredParentBody))
		return publicationResultWithPlan(
			plannedTaskIds,
			"permanent_failure",
			"Initiative Issue already exists and the tracker never rewrites it; edit the GitHub source directly for later planning changes",
			result("create-initiative", "permanent_failure", "Initiative Issue already exists and the tracker never rewrites it", existingParent),
		);

	const existingChildren = new Map<string, GithubIssue>();
	for (const operation of prepared.order) {
		const owned = ownedTaskLookup(initial.issues, repository.id, operation.task_id, initiativeId, operation.slice_id);
		if (owned.kind === "ambiguous")
			return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", owned.message);
		if (owned.kind === "found") existingChildren.set(operation.task_id, owned.issue);
	}
	// An owned Child whose Parent is gone cannot be adopted under a new Parent:
	// the Child still carries the old Parent link, so recreating the Parent would
	// silently re-home it. This is caller-fixable remote drift, not a create path.
	if (!existingParent && existingChildren.size > 0)
		return publicationResultWithPlan(
			plannedTaskIds,
			"ambiguous_remote_state",
			"an owned Child of this Initiative exists but its Parent Issue is missing; the tracker never recreates a Parent over its existing Children",
		);
	// A closed Child is start-of-run drift for the same reason as a closed Parent.
	for (const operation of prepared.order) {
		const issue = existingChildren.get(operation.task_id);
		if (issue && issue.state !== "open")
			return publicationResultWithPlan(
				plannedTaskIds,
				"ambiguous_remote_state",
				`Task ${operation.task_id} is no longer open`,
				result("upsert-task", "ambiguous_remote_state", `Task ${operation.task_id} is no longer open`, issue),
			);
	}
	if (existingParent) {
		for (const operation of prepared.order) {
			const issue = existingChildren.get(operation.task_id);
			if (!issue) continue;
			const title = taskIssueTitle(operation, sliceOrdinalFromChecklist(desiredParentBody, operation.slice_id, operation.projection?.slice_ordinal ?? 1));
			const body = childBody(repository, operation, existingParent);
			if (issue.title !== title || !sameTrackedBody(issue.body, body))
				return publicationResultWithPlan(
					plannedTaskIds,
					"ambiguous_remote_state",
					`Task ${operation.task_id} published content no longer matches the approved Intent publication`,
					result("upsert-task", "ambiguous_remote_state", `Task ${operation.task_id} published content drifted`, issue),
				);
		}
	}

	// The only reads besides the start listing; all before the first write. They
	// exist to find MISSING relations. A relation that is already present but not
	// approved by this Intent is drift the listing makes visible, so it fails
	// closed here instead of being reported as already_current.
	const attachedNumbers: number[] = [];
	if (existingParent) {
		const attached = await readSubIssueNumbers(root, gh, "upsert-task", repository, existingParent.number);
		if (!Array.isArray(attached))
			return publicationResultWithPlan(plannedTaskIds, attached.status, attached.message);
		if (new Set(attached).size !== attached.length)
			return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", "the Initiative Parent lists the same Sub-issue more than once");
		const ownedNumbers = new Set([...existingChildren.values()].map((issue) => issue.number));
		if (attached.some((number) => !ownedNumbers.has(number)))
			return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", "the Initiative Parent carries Sub-issues this batch does not own");
		attachedNumbers.push(...attached);
	}
	const existingBlockerIds = new Map<string, number[]>();
	for (const operation of prepared.order) {
		const issue = existingChildren.get(operation.task_id);
		if (!issue) continue;
		const ids = await readBlockedByIds(root, gh, "upsert-task", repository, issue.number);
		if (!Array.isArray(ids))
			return publicationResultWithPlan(plannedTaskIds, ids.status, ids.message);
		const approved = new Set<number>();
		for (const blockerId of operation.projection?.blocked_by ?? []) {
			const blocker = taskLookup(initial.issues, repository.id, blockerId);
			if (blocker.kind === "found") approved.add(blocker.issue.id);
		}
		if (ids.some((id) => !approved.has(id)))
			return publicationResultWithPlan(
				plannedTaskIds,
				"ambiguous_remote_state",
				`Task ${operation.task_id} carries native blocked_by relations this Intent does not approve`,
			);
		existingBlockerIds.set(operation.task_id, ids);
	}
	const beforeParentWrite = publicationIntentDrift(root, prepared.intent_bindings);
	if (beforeParentWrite)
		return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", beforeParentWrite);

	let parentNumber: number;
	if (existingParent) {
		parentNumber = existingParent.number;
		const labelArgs = labelMutationArgs(existingParent.labels, []);
		if (labelArgs.length === 0) {
			initiativeResult = result("create-initiative", "already_current", "Initiative Issue already carries the requested initial source", existingParent);
		} else {
			const edited = await gh.run(
				["issue", "edit", String(parentNumber), "--repo", repository.name_with_owner, ...labelArgs],
				{ cwd: root },
			);
			if (edited.exit_code !== 0 || edited.output_exceeded)
				return failed(ghFailure("create-initiative", edited, "Initiative Parent label convergence failed"));
			initiativeResult = result(
				"create-initiative",
				"updated",
				"Initiative Issue managed labels converged",
				{ ...existingParent, labels: [] },
			);
		}
	} else {
		const created = await gh.run(
			["issue", "create", "--repo", repository.name_with_owner, "--title", desiredParentTitle, "--body-file", "-"],
			{ cwd: root, stdin: desiredParentBody },
		);
		if (created.exit_code !== 0 || created.output_exceeded)
			return failed(ghFailure("create-initiative", created, "Initiative Issue creation failed"));
		const number = parseCreatedIssueNumber(created.stdout);
		if (number === null)
			return publicationResultWithPlan(plannedTaskIds, "retryable_failure", "Initiative creation could not be confirmed", initiativeResult, taskResults);
		parentNumber = number;
		initiativeResult = {
			contract: CONTRACT,
			operation: "create-initiative",
			status: "created",
			association_found: true,
			issue_number: number,
			issue_url: created.stdout.trim(),
			message: "Initiative Issue created as the single GitHub source",
		};
	}
	const parentReference: GithubIssue = existingParent ?? {
		id: 0,
		number: parentNumber,
		url: initiativeResult.issue_url ?? `https://github.com/${repository.name_with_owner}/issues/${parentNumber}`,
		title: desiredParentTitle,
		body: desiredParentBody,
		state: "open",
		state_reason: null,
		labels: [],
	};
	const numberByTask = new Map<string, number>();
	const numberByTaskId = new Map<string, number>();
	const blockerNumber = (blockerId: string): number | undefined =>
		numberByTask.get(blockerId) ?? existingChildren.get(blockerId)?.number;

	for (const operation of prepared.order) {
		const intentDrift = publicationIntentDrift(root, prepared.intent_bindings, [operation.task_id]);
		if (intentDrift) return failed(result("upsert-task", "ambiguous_remote_state", intentDrift));
		const blockers: Array<{ taskId: string; number: number; id: number | undefined }> = [];
		for (const blockerId of operation.projection?.blocked_by ?? []) {
			if (blockerId === operation.task_id)
				return failed(result("upsert-task", "ambiguous_remote_state", "a Task cannot block itself"));
			const number = blockerNumber(blockerId);
			if (number === undefined)
				return failed(result("upsert-task", "permanent_failure", `blocking Task ${blockerId} has not been published`));
			blockers.push({ taskId: blockerId, number, id: numberByTaskId.get(blockerId) ?? existingChildren.get(blockerId)?.id });
		}
		const existing = existingChildren.get(operation.task_id);
		if (existing) {
			let mutated = false;
			const labelArgs = labelMutationArgs(existing.labels, desiredTaskLabels(operation));
			if (labelArgs.length) {
				const edited = await gh.run(
					["issue", "edit", String(existing.number), "--repo", repository.name_with_owner, ...labelArgs],
					{ cwd: root },
				);
				if (edited.exit_code !== 0 || edited.output_exceeded)
					return failed(ghFailure("upsert-task", edited, `Task Issue #${existing.number} label convergence failed`));
				mutated = true;
			}
			if (!attachedNumbers.includes(existing.number)) {
				const attach = await attachChildDirect(root, gh, repository, parentNumber, existing.id, existing.number);
				if ("contract" in attach) return failed(attach);
				attachedNumbers.push(existing.number);
				mutated = true;
			}
			const currentIds = existingBlockerIds.get(operation.task_id) ?? [];
			for (const blocker of blockers) {
				if (blocker.id !== undefined && currentIds.includes(blocker.id)) continue;
				const added = await addBlockedByDirect(root, gh, repository, existing.number, blocker.id, blocker.number);
				if ("contract" in added) return failed(added);
				mutated = true;
			}
			taskResults.push({
				task_id: operation.task_id,
				slice_id: operation.slice_id,
				status: mutated ? "updated" : "already_current",
				issue_number: existing.number,
				issue_url: existing.url,
				node_id: String(existing.id),
			});
			continue;
		}
		const title = taskIssueTitle(operation, sliceOrdinalFromChecklist(desiredParentBody, operation.slice_id, operation.projection?.slice_ordinal ?? 1));
		const body = childBody(repository, operation, parentReference);
		const created = await gh.run(
			[
				"issue", "create", "--repo", repository.name_with_owner,
				"--title", title,
				"--body-file", "-",
				...desiredTaskLabels(operation).flatMap((label) => ["--label", label]),
			],
			{ cwd: root, stdin: body },
		);
		if (created.exit_code !== 0 || created.output_exceeded)
			return failed(ghFailure("upsert-task", created, "Task Issue creation failed"));
		const number = parseCreatedIssueNumber(created.stdout);
		if (number === null)
			return publicationResultWithPlan(plannedTaskIds, "retryable_failure", "Task creation could not be confirmed", initiativeResult, taskResults);
		const id = await resolveIssueId(root, gh, repository, number);
		if (typeof id !== "number") return failed(id);
		const attach = await attachChildDirect(root, gh, repository, parentNumber, id, number);
		if ("contract" in attach) return failed(attach);
		for (const blocker of blockers) {
			const added = await addBlockedByDirect(root, gh, repository, number, blocker.id, blocker.number);
			if ("contract" in added) return failed(added);
		}
		numberByTask.set(operation.task_id, number);
		numberByTaskId.set(operation.task_id, id);
		taskResults.push({
			task_id: operation.task_id,
			slice_id: operation.slice_id,
			status: "created",
			issue_number: number,
			issue_url: created.stdout.trim(),
		});
	}

	const finalIntentDrift = publicationIntentDrift(root, prepared.intent_bindings);
	if (finalIntentDrift) return failed(result("upsert-task", "ambiguous_remote_state", finalIntentDrift));
	const statuses = [initiativeResult.status, ...taskResults.map((task) => task.status)];
	const status: TrackerStatus = statuses.every((item) => item === "created")
		? "created"
		: statuses.every((item) => item === "already_current") ? "already_current" : "updated";
	const issueNumber = (taskId: string): number => numberByTask.get(taskId) ?? existingChildren.get(taskId)!.number;
	const firstTaskId = prepared.order[0].task_id;
	return publicationResultWithPlan(plannedTaskIds, status, "complete Initiative Parent, Children, and dependency graph published", initiativeResult, taskResults, {
		recommended_first_task_id: firstTaskId,
		recommended_first_issue_number: issueNumber(firstTaskId),
		order: prepared.order.map((operation) => operation.task_id),
		issue_order: prepared.order.map((operation) => issueNumber(operation.task_id)),
		parallel_groups: prepared.parallel_groups,
		parallel_issue_groups: prepared.parallel_groups.map((group) => group.map(issueNumber)),
	});
}

/** Attach one Child as a native Sub-issue of the Parent. */
async function attachChildDirect(
	root: string,
	gh: GhTransport,
	repository: RepositoryInfo,
	parentNumber: number,
	childId: number,
	childNumber: number,
): Promise<GithubTrackerResult | { attached: true }> {
	const mutation = await gh.run(
		["api", "-F", `sub_issue_id=${childId}`, `repos/${repository.name_with_owner}/issues/${parentNumber}/sub_issues`],
		{ cwd: root },
	);
	if (mutation.exit_code !== 0 || mutation.output_exceeded)
		return ghFailure("upsert-task", mutation, `native Sub-issue attachment failed for Issue #${childNumber}`);
	return { attached: true };
}

/** Create one native `blocked_by` edge; the blocker id is already known. */
async function addBlockedByDirect(
	root: string,
	gh: GhTransport,
	repository: RepositoryInfo,
	childNumber: number,
	blockerId: number | undefined,
	blockerNumber: number,
): Promise<GithubTrackerResult | { complete: true }> {
	const resolved = blockerId ?? await resolveIssueId(root, gh, repository, blockerNumber);
	if (typeof resolved !== "number") return resolved;
	const mutation = await gh.run(
		["api", "-F", `issue_id=${resolved}`, `repos/${repository.name_with_owner}/issues/${childNumber}/dependencies/blocked_by`],
		{ cwd: root },
	);
	if (mutation.exit_code !== 0 || mutation.output_exceeded)
		return ghFailure("upsert-task", mutation, `native blocked_by attachment failed for Issue #${childNumber}`);
	return { complete: true };
}

/**
 * Direct amendment: S2 of docs/specs/tracker-direct-publication.spec.md.
 *
 * The approved baseline is verified once at the start, against the start listing
 * plus Issue-scoped reads (the Parent's Sub-issue list and each adopted Child's
 * `blocked_by` set). Then the Parent is edited at most once, each pending brief is
 * edited at most once, absent pending Children are created as in S1, and each
 * pending Child's `blocked_by` set is converged to the approved set from the
 * start read. Nothing is re-read after a write and no closing recheck runs, so a
 * baseline drift that appears after the start listing is not detected in this
 * run; it surfaces at the start of the next run.
 */
async function publishAmendmentDirect(
	root: string,
	gh: GhTransport,
	prepared: ReturnType<typeof preflightPublication>,
	initial: RepositorySnapshot,
	amendment: ReturnType<typeof validateAmendment>,
	context: AmendmentExecutionContext,
): Promise<GithubInitiativePublicationResult> {
	const plannedTaskIds = prepared.order.map((operation) => operation.task_id);
	const initiativeId = prepared.initiative.initiative_id;
	const repository = initial.repository;
	const taskResults: GithubInitiativePublicationResult["tasks"] = [];
	// The confirmed Parent result, when it exists, must survive a later Child or
	// relation failure: a step whose response was already received is not lost just
	// because a later step failed. Set once the Parent write has been confirmed.
	let confirmedParent: GithubTrackerResult | undefined;
	const failed = (failure: GithubTrackerResult): GithubInitiativePublicationResult =>
		publicationResultWithPlan(plannedTaskIds, failure.status, failure.message, confirmedParent, taskResults);

	const parentLookup = initiativeLookup(initial.issues, repository.id, initiativeId);
	if (parentLookup.kind !== "found")
		return publicationResultWithPlan(plannedTaskIds, "permanent_failure", "an amendment requires the Initiative Parent to already exist");
	const parentIssue = parentLookup.issue;

	// Baseline verification, once, before any write: membership, bound identity,
	// baseline-or-approved-final content, native attachment and terminal ownership.
	const topology = await validateAmendmentTopology(
		root, gh, initial, initiativeId, parentIssue,
		amendment.tasks, amendment.historical,
		prepared.foreign_dependers,
		{ pendingContent: context.pendingContent, parent: context.parent, historicalSlices: context.historicalSlices },
		prepared.order,
	);
	if (!("get" in topology)) return failed(topology);
	const bound = topology;

	// The only reads besides the start listing; all before the first write. They
	// exist to find MISSING relations, so an unapproved relation already present
	// fails closed here instead of being reported as already_current.
	const attached = await readSubIssueNumbers(root, gh, "upsert-task", repository, parentIssue.number);
	if (!Array.isArray(attached)) return failed(attached);
	if (new Set(attached).size !== attached.length)
		return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", "the Initiative Parent lists the same Sub-issue more than once");
	const attachedNumbers = new Set(attached);
	const blockerIdsByTask = new Map<string, number[]>();
	for (const operation of prepared.order) {
		const issue = bound.get(operation.task_id);
		if (!issue) continue;
		const ids = await readBlockedByIds(root, gh, "upsert-task", repository, issue.number);
		if (!Array.isArray(ids)) return failed(ids);
		// The approved set is the convergence target, so an unapproved edge present at
		// start is simply removed by the same run; it is state this run owns, not drift.
		blockerIdsByTask.set(operation.task_id, ids);
	}
	const beforeWrite = publicationIntentDrift(root, prepared.intent_bindings);
	if (beforeWrite) return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", beforeWrite);

	// One Parent edit at most, and only when the approved bytes or labels differ.
	const parentNeedsEdit = parentIssue.title !== context.parent.title
		|| parentIssue.body !== context.parent.body
		|| labelMutationArgs(parentIssue.labels, []).length > 0;
	let parentResult: GithubTrackerResult;
	if (!parentNeedsEdit) {
		parentResult = result("create-initiative", "already_current", "Initiative Issue already carries the requested amended content", parentIssue);
	} else {
		const edited = await gh.run(
			[
				"issue", "edit", String(parentIssue.number), "--repo", repository.name_with_owner,
				"--title", context.parent.title,
				"--body-file", "-",
				...labelMutationArgs(parentIssue.labels, []),
			],
			{ cwd: root, stdin: context.parent.body },
		);
		if (edited.exit_code !== 0 || edited.output_exceeded)
			return failed(ghFailure("create-initiative", edited, "Initiative amendment edit failed"));
		parentResult = result("create-initiative", "updated", "Initiative Issue updated with approved amendment content", {
			...parentIssue,
			title: context.parent.title,
			body: context.parent.body,
			labels: [],
		});
	}
	confirmedParent = parentResult;

	const numberByTask = new Map<string, number>();
	const idByTask = new Map<string, number>();
	const blockerRef = (blockerId: string): { number: number; id: number } | undefined => {
		const number = numberByTask.get(blockerId) ?? bound.get(blockerId)?.number;
		if (number === undefined) return undefined;
		const observedBlocker = taskLookup(initial.issues, repository.id, blockerId);
		const id = idByTask.get(blockerId) ?? bound.get(blockerId)?.id
			?? (observedBlocker.kind === "found" ? observedBlocker.issue.id : undefined);
		if (id === undefined || !Number.isSafeInteger(id)) return undefined;
		return { number, id };
	};

	for (const operation of prepared.order) {
		const intentDrift = publicationIntentDrift(root, prepared.intent_bindings, [operation.task_id]);
		if (intentDrift) return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", intentDrift, parentResult, taskResults);
		const approved = context.pendingContent.get(operation.task_id);
		if (!approved) return failed(result("upsert-task", "permanent_failure", `pending Task ${operation.task_id} has no approved amendment content`));
		const desiredBlockers: Array<{ number: number; id: number }> = [];
		for (const blockerId of operation.projection?.blocked_by ?? []) {
			if (blockerId === operation.task_id)
				return failed(result("upsert-task", "ambiguous_remote_state", "a Task cannot block itself"));
			const resolved = blockerRef(blockerId);
			if (!resolved)
				return failed(result("upsert-task", "permanent_failure", `blocking Task ${blockerId} has not been published`));
			desiredBlockers.push(resolved);
		}

		const observed = bound.get(operation.task_id);
		let number: number;
		let id: number;
		// Content/label mutation decides the reported status; relation convergence
		// alone leaves an already-current pending brief as already_current.
		let contentMutated = false;
		if (observed) {
			number = observed.number;
			id = observed.id;
		} else {
			// Absent pending Child: one create, number from the create response and id
			// resolved once for the relation endpoints (Assumption A1).
			const created = await gh.run(
				[
					"issue", "create", "--repo", repository.name_with_owner,
					"--title", approved.title,
					"--body-file", "-",
					...desiredTaskLabels(operation).flatMap((label) => ["--label", label]),
				],
				{ cwd: root, stdin: approved.body },
			);
			if (created.exit_code !== 0 || created.output_exceeded)
				return failed(ghFailure("upsert-task", created, `Task Issue creation failed for ${operation.task_id}`));
			const parsed = parseCreatedIssueNumber(created.stdout);
			if (parsed === null)
				return publicationResultWithPlan(plannedTaskIds, "retryable_failure", `Task ${operation.task_id} creation could not be confirmed`, parentResult, taskResults);
			number = parsed;
			const resolvedId = await resolveIssueId(root, gh, repository, number);
			if (typeof resolvedId !== "number") return failed(resolvedId);
			id = resolvedId;
		}

		if (!attachedNumbers.has(number)) {
			const attach = await attachChildDirect(root, gh, repository, parentIssue.number, id, number);
			if ("contract" in attach) return failed(attach);
			attachedNumbers.add(number);
		}

		if (observed) {
			// One edit at most, and only when the approved content or labels differ. A
			// validated terminal suffix observed in the start listing is terminal
			// evidence, so it is preserved by the rewrite instead of being dropped.
			const suffixEvent = issueTerminalEventId(observed.body);
			if (suffixEvent === "multiple")
				return failed(result("upsert-task", "ambiguous_remote_state", `pending Task ${operation.task_id} has multiple terminal markers`, observed));
			if (suffixEvent === "malformed")
				return failed(result("upsert-task", "ambiguous_remote_state", `pending Task ${operation.task_id} carries a malformed terminal marker (marker without its exact canonical suffix)`, observed));
			const writeBody = suffixEvent !== null ? `${approved.body.trimEnd()}${terminalSuffix(suffixEvent)}` : approved.body;
			const labelArgs = labelMutationArgs(observed.labels, desiredTaskLabels(operation));
			if (!carriesApprovedContent(observed.title, observed.body, approved) || labelArgs.length) {
				const edited = await gh.run(
					[
						"issue", "edit", String(number), "--repo", repository.name_with_owner,
						"--title", approved.title,
						"--body-file", "-",
						...labelArgs,
					],
					{ cwd: root, stdin: writeBody },
				);
				if (edited.exit_code !== 0 || edited.output_exceeded)
					return failed(ghFailure("upsert-task", edited, `pending Task Issue #${number} update failed`));
				contentMutated = true;
			}
		}

		// Converge the approved dependency set from the start read: no read follows
		// the relation writes, and only the missing or unapproved edges are touched.
		const current = blockerIdsByTask.get(operation.task_id) ?? [];
		const expected = desiredBlockers.map((blocker) => blocker.id);
		for (const removedId of current.filter((currentId) => !expected.includes(currentId))) {
			const mutation = await gh.run(
				["api", "--method", "DELETE", `repos/${repository.name_with_owner}/issues/${number}/dependencies/blocked_by/${removedId}`],
				{ cwd: root },
			);
			if (mutation.exit_code !== 0 || mutation.output_exceeded)
				return failed(ghFailure("upsert-task", mutation, `native blocked_by removal failed for Issue #${number}`));
		}
		for (const blocker of desiredBlockers.filter((candidate) => !current.includes(candidate.id))) {
			const added = await addBlockedByDirect(root, gh, repository, number, blocker.id, blocker.number);
			if ("contract" in added) return failed(added);
		}

		numberByTask.set(operation.task_id, number);
		idByTask.set(operation.task_id, id);
		taskResults.push({
			task_id: operation.task_id,
			slice_id: operation.slice_id,
			status: !observed ? "created" : contentMutated ? "updated" : "already_current",
			issue_number: number,
			issue_url: observed?.url ?? `https://github.com/${repository.name_with_owner}/issues/${number}`,
		});
	}

	const finalIntentDrift = publicationIntentDrift(root, prepared.intent_bindings);
	if (finalIntentDrift) return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", finalIntentDrift, parentResult, taskResults);
	const statuses = [parentResult.status, ...taskResults.map((task) => task.status)];
	const status: TrackerStatus = statuses.every((item) => item === "created")
		? "created"
		: statuses.every((item) => item === "already_current") ? "already_current" : "updated";
	const issueNumber = (taskId: string): number => numberByTask.get(taskId) ?? bound.get(taskId)!.number;
	const firstTaskId = prepared.order[0].task_id;
	return publicationResultWithPlan(plannedTaskIds, status, "complete Initiative Parent, Children, and dependency graph published", parentResult, taskResults, {
		recommended_first_task_id: firstTaskId,
		recommended_first_issue_number: issueNumber(firstTaskId),
		order: prepared.order.map((operation) => operation.task_id),
		issue_order: prepared.order.map((operation) => issueNumber(operation.task_id)),
		parallel_groups: prepared.parallel_groups,
		parallel_issue_groups: prepared.parallel_groups.map((group) => group.map(issueNumber)),
	});
}

export async function runGithubInitiativePublication(
	root: string,
	input: InitiativePublicationInput,
	rawGh: GhTransport = createGhTransport(),
	budget?: OperationCancellation,
): Promise<GithubInitiativePublicationResult> {
	const absoluteRoot = resolve(root);
	// One publication call is a finite remote step sequence with no cumulative
	// deadline: the caller may still supply a cancellation signal, which is
	// forwarded to every call, and each call keeps its own per-call timeout.
	const gh: GhTransport = budget?.signal === undefined
		? rawGh
		: { run: (args, options = {}) => rawGh.run(args, { ...options, signal: budget.signal }) };
	// The complete planned step set, known before the first remote write. Every
	// unconfirmed Task from this set is a pending step, so a Parent failure or an
	// early Child failure still names each unfinished Task.
	let prepared: ReturnType<typeof preflightPublication>;
	let amendment: ReturnType<typeof validateAmendment> | undefined;
	// Assigned the moment the plan exists. Every result built after that point
	// reports the same planned Task set, including the error paths.
	let plannedTaskIds: string[] = [];
	try {
		prepared = preflightPublication(absoluteRoot, input);
		plannedTaskIds = prepared.order.map((operation) => operation.task_id);
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
		return publicationResultWithPlan(plannedTaskIds, "permanent_failure", error instanceof Error ? error.message : String(error));
	}
	const conflict = carrierConflict(absoluteRoot, "create-initiative", prepared.initiative.initiative_id);
	if (conflict) return publicationResultWithPlan(plannedTaskIds, conflict.status, conflict.message, conflict);
	const initial = await snapshot(absoluteRoot, gh, "create-initiative");
	if ("contract" in initial) return publicationResultWithPlan(plannedTaskIds, initial.status, initial.message, initial);
	const initialParent = initiativeLookup(initial.issues, initial.repository.id, prepared.initiative.initiative_id);
	if (initialParent.kind === "ambiguous") return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", initialParent.message);
	if (amendment && initialParent.kind === "missing")
		return publicationResultWithPlan(plannedTaskIds, "permanent_failure", "an amendment requires the Initiative Parent to already exist");
	// Label availability is validated before any remote mutation: the tracker
	// never creates labels, so a missing label fails the whole batch closed
	// instead of half-publishing an Initiative.
	const requiredLabels = [...new Set(prepared.order.flatMap((operation) => desiredTaskLabels(operation)))];
	const labelFailure = await labelAvailabilityFailure(absoluteRoot, gh, initial.repository, requiredLabels);
	if (labelFailure) return publicationResultWithPlan(plannedTaskIds, labelFailure.status, labelFailure.message, labelFailure);
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
	if (parentBodyFailure) return publicationResultWithPlan(plannedTaskIds, parentBodyFailure.status, parentBodyFailure.message, parentBodyFailure);
	for (const operation of prepared.order) {
		const childFailure = bodyLimitFailure("upsert-task", childBody(initial.repository, operation, parentForPreflight), MAX_TERMINAL_SUFFIX_BYTES);
		if (childFailure) return publicationResultWithPlan(plannedTaskIds, childFailure.status, childFailure.message, childFailure);
	}
	// Ordinary publication and amendment share the direct write flow: neither
	// re-reads after a write.
	if (!amendment) return publishInitiativeDirect(absoluteRoot, gh, prepared, initial);

	if (initialParent.kind !== "found")
		return publicationResultWithPlan(plannedTaskIds, "permanent_failure", "an amendment requires the Initiative Parent to already exist");
	// Caller-controlled binding constraints (missing or duplicate historical
	// Slice markers) must surface as structured fail-closed publication results,
	// never as thrown exceptions escaping the guarded validation boundary.
	let approvedFinalParent: ReturnType<typeof approvedAmendmentContent>;
	try {
		approvedFinalParent = approvedAmendmentContent(absoluteRoot, initial.repository, initialParent.issue, prepared, amendment);
	} catch (error) {
		return publicationResultWithPlan(
			plannedTaskIds,
			"permanent_failure",
			error instanceof Error ? error.message : String(error),
		);
	}
	// Slice identity collisions are deterministic input contract violations (the
	// batch itself declares two Children with one Slice id), not remote drift.
	if (typeof approvedFinalParent === "string" && approvedFinalParent.includes("collides with a historical Task Slice"))
		return publicationResultWithPlan(plannedTaskIds, "permanent_failure", approvedFinalParent);
	if (typeof approvedFinalParent === "string") return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", approvedFinalParent);
	const { parent, pendingContent, historicalSlices } = approvedFinalParent;
	// Deterministic prerequisite completion is validated before any write: a
	// historical prerequisite already closed without state_reason "completed"
	// (e.g. not_planned) makes the batch permanently unfulfillable.
	for (const operation of prepared.order) {
		for (const blockerId of operation.projection?.blocked_by ?? []) {
			if (!amendment.historical.has(blockerId)) continue;
			const blocker = taskLookup(initial.issues, initial.repository.id, blockerId);
			if (blocker.kind === "found" && (blocker.issue.state !== "closed" || blocker.issue.state_reason !== "completed"))
				return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", `Task ${operation.task_id} depends on stopped historical prerequisite ${blockerId}`);
		}
	}
	// The approved baseline is the only accepted starting point. Every fact here
	// comes from the start listing, before any write.
	const parentBaseline = amendment.parent.body !== initialParent.issue.body || amendment.parent.title !== initialParent.issue.title;
	const parentApproved = initialParent.issue.title === parent.title && initialParent.issue.body === parent.body;
	if (parentBaseline && !parentApproved)
		return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", "amendment Parent changed since the approved amendment baseline");
	if (amendment.parent.issue_number !== initialParent.issue.number)
		return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", `amendment Parent is bound to Issue #${amendment.parent.issue_number} but observed Issue #${initialParent.issue.number}`);
	if (initialParent.issue.state !== "open")
		return publicationResultWithPlan(plannedTaskIds, "ambiguous_remote_state", "an amendment requires the Initiative Parent to remain open");
	const amendmentContextValue: AmendmentExecutionContext = {
		pendingContent,
		parent,
		historicalSlices,
	};
	return publishAmendmentDirect(absoluteRoot, gh, prepared, initial, amendment, amendmentContextValue);
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
			intent_hash: read.content_hash,
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
