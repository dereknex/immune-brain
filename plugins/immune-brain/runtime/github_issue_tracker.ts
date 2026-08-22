import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { readTaskIntent } from "./kernel/intent";

const CONTRACT = "immune_brain/github_issue_tracker_result/v1" as const;
const PROTOCOL_MARKER = "<!-- immune-brain-tracker:v1 -->";
const MANAGED_START = "<!-- immune-brain:managed:start -->";
const MANAGED_END = "<!-- immune-brain:managed:end -->";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_GH_OUTPUT = 1024 * 1024;
const MAX_DIAGNOSTIC = 512;
const GH_TIMEOUT_MS = 20_000;

type TrackerStatus =
	| "created"
	| "updated"
	| "already_current"
	| "retryable_failure"
	| "permanent_failure"
	| "ambiguous_remote_state";

type TrackerState = "proposed" | "active" | "completed" | "not_planned";

export interface GithubTrackerResult {
	contract: typeof CONTRACT;
	operation: TrackerOperation["op"];
	status: TrackerStatus;
	association_found: boolean;
	issue_number?: number;
	issue_url?: string;
	message: string;
}

export interface InitiativeSlice {
	id: string;
	goal: string;
}

export type TrackerOperation =
	| {
		op: "upsert-initiative";
		initiative_id: string;
		goal: string;
		slices: InitiativeSlice[];
	}
	| {
		op: "upsert-task";
		initiative_id: string;
		task_id: string;
		goal: string;
		risk: "routine" | "material" | "critical";
		intent_path: string;
		acceptance: Array<{ id: string; summary: string }>;
	}
	| { op: "mark-active"; task_id: string }
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
	number: number;
	url: string;
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

function marker(name: "repo-id" | "initiative-id" | "task-id", value: string | number): string {
	return `<!-- immune-brain:${name}=${value} -->`;
}

function stateMarker(state: TrackerState): string {
	return `<!-- immune-brain:tracker-state=${state} -->`;
}

function terminalMarker(eventId: string): string {
	return `<!-- immune-brain:terminal-event=${eventId} -->`;
}

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
	return redactSecrets(value).replace(/\s+/g, " ").slice(0, 180);
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
		...(issue ? { issue_number: issue.number, issue_url: issue.url } : {}),
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
				!Number.isSafeInteger(item.number)
				|| typeof item.html_url !== "string"
				|| typeof item.body !== "string"
				|| (item.state !== "open" && item.state !== "closed")
			) throw new Error("gh returned a malformed Issue");
			return {
				number: item.number as number,
				url: item.html_url,
				body: item.body,
				state: item.state,
				state_reason: typeof item.state_reason === "string" ? item.state_reason.toLowerCase() : null,
			};
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
	const issuesExecution = await gh.run([
		"api",
		"--paginate",
		"--slurp",
		`repos/${repository.name_with_owner}/issues?state=all&per_page=100`,
	], { cwd: root });
	if (issuesExecution.exit_code !== 0 || issuesExecution.output_exceeded)
		return ghFailure(operation, issuesExecution, "cannot query GitHub Issues");
	try {
		return { repository, issues: parseIssues(issuesExecution.stdout) };
	} catch (error) {
		return result(operation, "permanent_failure", error instanceof Error ? error.message : String(error));
	}
}

function findIssue(issues: GithubIssue[], primary: string, required: string[]): IssueLookup {
	const candidates = issues.filter((issue) => issue.body.includes(primary));
	if (candidates.length === 0) return { kind: "missing" };
	if (candidates.length !== 1)
		return { kind: "ambiguous", message: `multiple Issues contain identity marker ${primary}` };
	const issue = candidates[0];
	for (const expected of [PROTOCOL_MARKER, ...required]) {
		if (countLiteral(issue.body, expected) !== 1)
			return { kind: "ambiguous", message: `Issue #${issue.number} has missing or duplicate identity markers` };
	}
	return { kind: "found", issue };
}

function initiativeLookup(issues: GithubIssue[], repositoryId: number, initiativeId: string): IssueLookup {
	const initiative = marker("initiative-id", initiativeId);
	return findIssue(issues, initiative, [marker("repo-id", repositoryId), initiative]);
}

function taskLookup(issues: GithubIssue[], repositoryId: number, taskId: string): IssueLookup {
	const task = marker("task-id", taskId);
	const lookup = findIssue(issues, task, [marker("repo-id", repositoryId), task]);
	if (lookup.kind !== "found") return lookup;
	const initiativeMarkers = lookup.issue.body.match(/<!-- immune-brain:initiative-id=[A-Za-z0-9][A-Za-z0-9._-]{0,127} -->/g) ?? [];
	return initiativeMarkers.length === 1
		? lookup
		: { kind: "ambiguous", message: `Issue #${lookup.issue.number} has missing or duplicate Initiative markers` };
}

function managedRegion(contents: string): string {
	return `${MANAGED_START}\n${contents.trim()}\n${MANAGED_END}`;
}

function reconcileManagedBody(existing: string, desiredRegion: string): { body?: string; error?: string } {
	if (countLiteral(existing, MANAGED_START) !== 1 || countLiteral(existing, MANAGED_END) !== 1)
		return { error: "managed region delimiters are missing or duplicated" };
	const start = existing.indexOf(MANAGED_START);
	const end = existing.indexOf(MANAGED_END, start);
	if (end < start) return { error: "managed region delimiters are reversed" };
	return { body: `${existing.slice(0, start)}${desiredRegion}${existing.slice(end + MANAGED_END.length)}` };
}

function initiativeRegion(goal: string, slices: InitiativeSlice[]): string {
	const rows = slices.length === 0
		? "No future Slices recorded."
		: slices.map((slice) => `- [ ] \`${slice.id}\`: ${slice.goal}`).join("\n");
	return managedRegion(`## Initiative\n\n${goal}\n\n## Planned Slices\n\n${rows}`);
}

function taskRegion(operation: Extract<TrackerOperation, { op: "upsert-task" }>, state: TrackerState): string {
	const acceptance = operation.acceptance
		.map((item) => `- \`${item.id}\`: ${item.summary}`)
		.join("\n");
	return managedRegion([
		stateMarker(state),
		`State: \`${state}\``,
		`Risk: \`${operation.risk}\``,
		`TaskIntent: \`${operation.intent_path}\``,
		"",
		"## Goal",
		"",
		operation.goal,
		"",
		"## Acceptance",
		"",
		acceptance,
	].join("\n"));
}

function issueBody(markers: string[], introduction: string, region: string): string {
	return `${[PROTOCOL_MARKER, ...markers].join("\n")}\n\n${introduction}\n\n${region}\n`;
}

function trackerState(body: string): TrackerState | null {
	const values = [...body.matchAll(/<!-- immune-brain:tracker-state=(proposed|active|completed|not_planned) -->/g)];
	return values.length === 1 ? values[0][1] as TrackerState : null;
}

function transitionBody(body: string, next: TrackerState, terminalEventId?: string): { body?: string; error?: string } {
	const current = trackerState(body);
	if (!current) return { error: "tracker state marker is missing or duplicated" };
	const visible = `State: \`${current}\``;
	if (countLiteral(body, visible) !== 1)
		return { error: "visible tracker state is missing or duplicated" };
	let updated = body
		.replace(stateMarker(current), stateMarker(next))
		.replace(visible, `State: \`${next}\``);
	if (terminalEventId) {
		const existing = [...updated.matchAll(/<!-- immune-brain:terminal-event=([A-Za-z0-9._:-]+) -->/g)];
		if (existing.length > 1 || (existing.length === 1 && existing[0][1] !== terminalEventId))
			return { error: "terminal event marker conflicts with authoritative settlement" };
		if (existing.length === 0) {
			const terminal = `${terminalMarker(terminalEventId)}\nTerminal event: \`${terminalEventId}\`\n`;
			updated = updated.replace(MANAGED_END, `${terminal}${MANAGED_END}`);
		}
	}
	return { body: updated };
}

async function confirmBody(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	lookup: (issues: GithubIssue[]) => IssueLookup,
	desiredBody: string,
	created: boolean,
): Promise<GithubTrackerResult> {
	const refreshed = await snapshot(root, gh, operation);
	if ("contract" in refreshed) return refreshed;
	if (refreshed.repository.id !== repository.id)
		return result(operation, "ambiguous_remote_state", "repository identity changed during GitHub mutation");
	const observed = lookup(refreshed.issues);
	if (observed.kind === "ambiguous") return result(operation, "ambiguous_remote_state", observed.message);
	if (observed.kind === "missing") return result(operation, "retryable_failure", "GitHub mutation outcome could not be confirmed");
	return observed.issue.body === desiredBody
		? result(operation, created ? "created" : "updated", "GitHub Issue projection confirmed", observed.issue)
		: result(operation, "retryable_failure", "GitHub Issue did not converge to the requested body", observed.issue);
}

async function createIssue(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	title: string,
	body: string,
	lookup: (issues: GithubIssue[]) => IssueLookup,
): Promise<GithubTrackerResult> {
	const mutation = await gh.run([
		"issue", "create", "--repo", repository.name_with_owner,
		"--title", title, "--body-file", "-",
	], { cwd: root, stdin: body });
	const confirmed = await confirmBody(root, gh, operation, repository, lookup, body, true);
	if (
		confirmed.status === "retryable_failure"
		&& mutation.exit_code !== 0
		&& !mutation.timed_out
		&& !mutation.output_exceeded
	) return ghFailure(operation, mutation, "GitHub Issue creation failed");
	return confirmed;
}

async function editIssue(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	issue: GithubIssue,
	body: string,
	lookup: (issues: GithubIssue[]) => IssueLookup,
): Promise<GithubTrackerResult> {
	const mutation = await gh.run([
		"issue", "edit", String(issue.number), "--repo", repository.name_with_owner,
		"--body-file", "-",
	], { cwd: root, stdin: body });
	const confirmed = await confirmBody(root, gh, operation, repository, lookup, body, false);
	if (
		confirmed.status === "retryable_failure"
		&& mutation.exit_code !== 0
		&& !mutation.timed_out
		&& !mutation.output_exceeded
	) return ghFailure(operation, mutation, "GitHub Issue update failed");
	return confirmed;
}

function validateOperation(operation: TrackerOperation): TrackerOperation {
	if (operation.op === "upsert-initiative") {
		const seen = new Set<string>();
		return {
			...operation,
			initiative_id: identifier(operation.initiative_id, "initiative_id"),
			goal: publicText(operation.goal, "goal"),
			slices: operation.slices.map((slice, index) => {
				const id = identifier(slice.id, `slices[${index}].id`);
				if (seen.has(id)) throw new Error(`duplicate Slice id: ${id}`);
				seen.add(id);
				return { id, goal: publicText(slice.goal, `slices[${index}].goal`, 1_000) };
			}),
		};
	}
	if (operation.op === "upsert-task") {
		return {
			...operation,
			initiative_id: identifier(operation.initiative_id, "initiative_id"),
			task_id: identifier(operation.task_id, "task_id"),
			goal: publicText(operation.goal, "goal"),
			intent_path: publicText(operation.intent_path, "intent_path", 500),
			acceptance: operation.acceptance.map((item, index) => ({
				id: identifier(item.id, `acceptance[${index}].id`),
				summary: publicText(item.summary, `acceptance[${index}].summary`, 500),
			})),
		};
	}
	if (operation.op === "mark-active")
		return { ...operation, task_id: identifier(operation.task_id, "task_id") };
	return {
		...operation,
		task_id: identifier(operation.task_id, "task_id"),
		terminal_event_id: terminalEvent(operation.terminal_event_id),
	};
}

async function upsertInitiative(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "upsert-initiative" }>,
	source: RepositorySnapshot,
): Promise<GithubTrackerResult> {
	const lookup = (issues: GithubIssue[]) => initiativeLookup(issues, source.repository.id, operation.initiative_id);
	const found = lookup(source.issues);
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	const region = initiativeRegion(operation.goal, operation.slices);
	const body = issueBody([
		marker("repo-id", source.repository.id),
		marker("initiative-id", operation.initiative_id),
	], "Opt-in, non-authoritative Immune-Brain Initiative projection.", region);
	if (found.kind === "missing")
		return createIssue(root, gh, operation.op, source.repository, `[IB] ${titleText(operation.initiative_id)}: ${titleText(operation.goal)}`, body, lookup);
	const reconciled = reconcileManagedBody(found.issue.body, region);
	if (reconciled.error) return result(operation.op, "ambiguous_remote_state", reconciled.error, found.issue);
	if (reconciled.body === found.issue.body)
		return result(operation.op, "already_current", "Initiative Issue is current", found.issue);
	return editIssue(root, gh, operation.op, source.repository, found.issue, reconciled.body!, lookup);
}

async function upsertTask(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "upsert-task" }>,
	source: RepositorySnapshot,
): Promise<GithubTrackerResult> {
	const parent = initiativeLookup(source.issues, source.repository.id, operation.initiative_id);
	if (parent.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", parent.message);
	if (parent.kind === "missing") return result(operation.op, "permanent_failure", "Initiative Issue must exist before publishing a Task");
	const lookup = (issues: GithubIssue[]) => taskLookup(issues, source.repository.id, operation.task_id);
	const found = lookup(source.issues);
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	const region = taskRegion(operation, "proposed");
	const body = issueBody([
		marker("repo-id", source.repository.id),
		marker("initiative-id", operation.initiative_id),
		marker("task-id", operation.task_id),
	], `Parent Initiative: #${parent.issue.number}`, region);
	if (found.kind === "missing")
		return createIssue(root, gh, operation.op, source.repository, `[IB:${titleText(operation.initiative_id)}] ${titleText(operation.task_id)}: ${titleText(operation.goal)}`, body, lookup);
	const state = trackerState(found.issue.body);
	if (!state) return result(operation.op, "ambiguous_remote_state", "tracker state marker is missing or duplicated", found.issue);
	if (state !== "proposed")
		return result(operation.op, "already_current", `Task Issue is already ${state}; proposed publication cannot downgrade it`, found.issue);
	if (found.issue.state !== "open")
		return result(operation.op, "ambiguous_remote_state", "a proposed Task Issue is unexpectedly closed", found.issue);
	const reconciled = reconcileManagedBody(found.issue.body, region);
	if (reconciled.error) return result(operation.op, "ambiguous_remote_state", reconciled.error, found.issue);
	if (reconciled.body === found.issue.body)
		return result(operation.op, "already_current", "Task Issue is current", found.issue);
	return editIssue(root, gh, operation.op, source.repository, found.issue, reconciled.body!, lookup);
}

async function markActive(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "mark-active" }>,
	source: RepositorySnapshot,
): Promise<GithubTrackerResult> {
	const lookup = (issues: GithubIssue[]) => taskLookup(issues, source.repository.id, operation.task_id);
	const found = lookup(source.issues);
	if (found.kind === "missing") return result(operation.op, "already_current", "Task has no opted-in tracker association");
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	const state = trackerState(found.issue.body);
	if (!state) return result(operation.op, "ambiguous_remote_state", "tracker state marker is missing or duplicated", found.issue);
	if (state === "active")
		return found.issue.state === "open"
			? result(operation.op, "already_current", "Task Issue is already active", found.issue)
			: result(operation.op, "ambiguous_remote_state", "the active Task Issue is unexpectedly closed", found.issue);
	if (state === "completed" || state === "not_planned")
		return result(operation.op, "already_current", `Task Issue is already ${state}`, found.issue);
	if (found.issue.state !== "open")
		return result(operation.op, "permanent_failure", "a closed proposed Issue cannot be activated automatically", found.issue);
	const transitioned = transitionBody(found.issue.body, "active");
	if (transitioned.error) return result(operation.op, "ambiguous_remote_state", transitioned.error, found.issue);
	return editIssue(root, gh, operation.op, source.repository, found.issue, transitioned.body!, lookup);
}

async function closeTerminalIssue(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "mark-terminal" }>,
	source: RepositorySnapshot,
	issue: GithubIssue,
	lookup: (issues: GithubIssue[]) => IssueLookup,
): Promise<GithubTrackerResult> {
	const desiredState: TrackerState = operation.phase === "done" ? "completed" : "not_planned";
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
	const exactBody = trackerState(found.issue.body) === desiredState
		&& countLiteral(found.issue.body, terminalMarker(operation.terminal_event_id)) === 1;
	if (!exactBody) return result(operation.op, "ambiguous_remote_state", "terminal Issue body changed during closure", found.issue);
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
	let found = lookup(source.issues);
	if (found.kind === "missing") return result(operation.op, "already_current", "Task has no opted-in tracker association");
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	const desiredState: TrackerState = operation.phase === "done" ? "completed" : "not_planned";
	const desiredReason = operation.phase === "done" ? "completed" : "not_planned";
	const current = trackerState(found.issue.body);
	if (!current) return result(operation.op, "ambiguous_remote_state", "tracker state marker is missing or duplicated", found.issue);
	if (current === "completed" || current === "not_planned") {
		const exactEvent = countLiteral(found.issue.body, terminalMarker(operation.terminal_event_id)) === 1;
		if (current !== desiredState || !exactEvent)
			return result(operation.op, "ambiguous_remote_state", "terminal Issue conflicts with authoritative settlement", found.issue);
		if (found.issue.state === "closed")
			return found.issue.state_reason === desiredReason
				? result(operation.op, "already_current", "terminal Task Issue is current", found.issue)
				: result(operation.op, "ambiguous_remote_state", "closed Issue reason conflicts with authoritative settlement", found.issue);
		return closeTerminalIssue(root, gh, operation, source, found.issue, lookup);
	}
	if (found.issue.state !== "open")
		return result(operation.op, "permanent_failure", "a manually closed nonterminal Issue is not reopened automatically", found.issue);
	const transitioned = transitionBody(found.issue.body, desiredState, operation.terminal_event_id);
	if (transitioned.error) return result(operation.op, "ambiguous_remote_state", transitioned.error, found.issue);
	const edited = await editIssue(root, gh, operation.op, source.repository, found.issue, transitioned.body!, lookup);
	if (edited.status !== "updated" && edited.status !== "already_current") return edited;
	return closeTerminalIssue(root, gh, operation, source, found.issue, lookup);
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
	const source = await snapshot(resolve(root), gh, operation.op);
	if ("contract" in source) return source;
	switch (operation.op) {
		case "upsert-initiative": return upsertInitiative(root, gh, operation, source);
		case "upsert-task": return upsertTask(root, gh, operation, source);
		case "mark-active": return markActive(root, gh, operation, source);
		case "mark-terminal": return markTerminal(root, gh, operation, source);
	}
}

function valueAfter(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

function taskPublication(root: string, initiativeId: string, intentPath: string): Extract<TrackerOperation, { op: "upsert-task" }> {
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
		op: "upsert-task",
		initiative_id: initiativeId,
		task_id: intent.task_id,
		goal: intent.goal,
		risk: intent.risk,
		intent_path: rel,
		acceptance: intent.acceptance.map((item) => ({ id: item.id, summary: item.assertion })),
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
	let operation: TrackerOperation;
	try {
		if (op === "upsert-initiative" && args.length === 3 && args[1] === "--stdin") {
			const raw = JSON.parse((options.stdin ?? (() => readFileSync(0, "utf8")))()) as Record<string, unknown>;
			operation = {
				op: "upsert-initiative",
				initiative_id: raw.initiative_id as string,
				goal: raw.goal as string,
				slices: raw.slices as InitiativeSlice[],
			};
		} else if (op === "upsert-task" && args.length === 6) {
			const initiative = valueAfter(args, "--initiative-id");
			const intent = valueAfter(args, "--intent");
			if (!initiative || !intent) throw new Error("upsert-task requires --initiative-id and --intent");
			operation = taskPublication(root, initiative, intent);
		} else {
			throw new Error("use upsert-initiative --stdin --json or upsert-task --initiative-id <id> --intent <path> --json");
		}
	} catch (error) {
		return {
			stdout: "",
			stderr: `invalid_tracker_command: ${redactGithubDiagnostic(error instanceof Error ? error.message : String(error))}\n`,
			returncode: 2,
		};
	}
	const projected = await runGithubTrackerOperation(root, operation, options.gh);
	return {
		stdout: `${JSON.stringify(projected, null, 2)}\n`,
		stderr: "",
		returncode: projected.status === "permanent_failure" || projected.status === "ambiguous_remote_state" ? 1 : 0,
	};
}
