import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { readTaskIntent } from "./kernel/intent";

const CONTRACT = "immune_brain/github_issue_tracker_result/v1" as const;
const PROTOCOL_MARKER = "<!-- immune-brain-tracker:v1 -->";
const KIND_INITIATIVE_MARKER = "<!-- immune-brain:kind=initiative -->";
const KIND_TASK_MARKER = "<!-- immune-brain:kind=task -->";
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
		op: "create-initiative";
		initiative_id: string;
		goal: string;
		slices: InitiativeSlice[];
	}
	| {
		op: "upsert-task";
		initiative_id: string;
		task_id: string;
		slice_id: string;
		goal: string;
		risk: "routine" | "material" | "critical";
		acceptance: Array<{ id: string; summary: string }>;
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

function marker(name: "repo-id" | "initiative-id" | "task-id" | "slice-id", value: string | number): string {
	return `<!-- immune-brain:${name}=${value} -->`;
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

function ownershipMarkerValue(body: string, name: "initiative-id" | "slice-id"): string | null {
	const values = [...body.matchAll(new RegExp(`<!-- immune-brain:${name}=([A-Za-z0-9][A-Za-z0-9._-]{0,127}) -->`, "g"))];
	return values.length === 1 ? values[0][1] : null;
}

function taskLookup(issues: GithubIssue[], repositoryId: number, taskId: string): IssueLookup {
	const task = marker("task-id", taskId);
	const base = findIssue(issues, [task, KIND_TASK_MARKER], [marker("repo-id", repositoryId), task]);
	if (base.kind !== "found") return base;
	for (const name of ["initiative-id", "slice-id"] as const) {
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

async function confirmAttachment(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	parentNumber: number,
	childNumber: number,
): Promise<GithubTrackerResult | { attached: boolean }> {
	const listed = await gh.run(["api", `repos/${repository.name_with_owner}/issues/${parentNumber}/sub_issues?per_page=100`], { cwd: root });
	if (listed.exit_code !== 0 || listed.output_exceeded)
		return ghFailure(operation, listed, "cannot read native Sub-issue relations");
	let numbers: number[];
	try {
		numbers = parseSubIssueNumbers(listed.stdout);
	} catch (error) {
		return result(operation, "permanent_failure", error instanceof Error ? error.message : String(error));
	}
	const matches = numbers.filter((candidate) => candidate === childNumber).length;
	if (matches > 1) return result(operation, "ambiguous_remote_state", `Issue #${parentNumber} lists the Task Issue more than once`);
	return { attached: matches === 1 };
}

async function attachSubIssue(
	root: string,
	gh: GhTransport,
	operation: TrackerOperation["op"],
	repository: RepositoryInfo,
	parentNumber: number,
	childNumber: number,
): Promise<GithubTrackerResult | { attached: true }> {
	const mutation = await gh.run([
		"api",
		"-F",
		`sub_issue_id=${childNumber}`,
		`repos/${repository.name_with_owner}/issues/${parentNumber}/sub_issues`,
	], { cwd: root });
	if (mutation.exit_code !== 0 || mutation.output_exceeded)
		return ghFailure(operation, mutation, "native Sub-issue attachment failed");
	const confirmed = await confirmAttachment(root, gh, operation, repository, parentNumber, childNumber);
	if ("attached" in confirmed) return { attached: true };
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

async function createInitiative(
	root: string,
	gh: GhTransport,
	operation: Extract<TrackerOperation, { op: "create-initiative" }>,
	source: RepositorySnapshot,
): Promise<GithubTrackerResult> {
	const lookup = (issues: GithubIssue[]) => initiativeLookup(issues, source.repository.id, operation.initiative_id);
	const found = lookup(source.issues);
	if (found.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", found.message);
	const body = `${[
		PROTOCOL_MARKER,
		KIND_INITIATIVE_MARKER,
		marker("repo-id", source.repository.id),
		marker("initiative-id", operation.initiative_id),
	].join("\n")}\n\nOpt-in, non-authoritative Immune-Brain Initiative source. Created once; edit this Issue directly for all later planning changes.\n\n## Initiative\n\n${operation.goal}\n\n## Slices\n\n${
		operation.slices.length === 0
			? "No Slices recorded yet."
			: operation.slices.map((slice) => `- [ ] ${marker("slice-id", slice.id)} \`${slice.id}\`: ${slice.goal}`).join("\n")
	}\n`;
	if (found.kind === "missing") {
		const mutation = await gh.run([
			"issue", "create", "--repo", source.repository.name_with_owner,
			"--title", `[IB] ${titleText(operation.initiative_id)}: ${titleText(operation.goal)}`,
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
		return confirmed.issue.body === body
			? result(operation.op, "created", "Initiative Issue created as the single GitHub source", confirmed.issue)
			: result(operation.op, "retryable_failure", "Initiative Issue did not converge to the requested initial body", confirmed.issue);
	}
	if (found.issue.body === body)
		return result(operation.op, "already_current", "Initiative Issue already carries the requested initial source", found.issue);
	return result(
		operation.op,
		"permanent_failure",
		"Initiative Issue already exists and the tracker never rewrites it; edit the GitHub source directly for later planning changes",
		found.issue,
	);
}

function childBody(repository: RepositoryInfo, operation: Extract<TrackerOperation, { op: "upsert-task" }>): string {
	const acceptance = operation.acceptance
		.map((item) => `- \`${item.id}\`: ${item.summary}`)
		.join("\n");
	return `${[
		PROTOCOL_MARKER,
		KIND_TASK_MARKER,
		marker("repo-id", repository.id),
		marker("initiative-id", operation.initiative_id),
		marker("slice-id", operation.slice_id),
		marker("task-id", operation.task_id),
	].join("\n")}\n\nOpt-in, non-authoritative Immune-Brain Task observation. Open means this Task still needs attention.\n\nRisk: \`${operation.risk}\`\n\n## Goal\n\n${operation.goal}\n\n## Acceptance\n\n${acceptance}\n`;
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
	const body = childBody(source.repository, operation);
	let child: GithubIssue;
	let createdChild = false;
	if (found.kind === "missing") {
		const mutation = await gh.run([
			"issue", "create", "--repo", source.repository.name_with_owner,
			"--title", `[IB:${titleText(operation.initiative_id)}/S:${titleText(operation.slice_id)}] ${titleText(operation.task_id)}: ${titleText(operation.goal)}`,
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
		if (created.issue.body !== body)
			return result(operation.op, "retryable_failure", "Task Issue did not converge to the requested neutral body", created.issue);
		child = created.issue;
		createdChild = true;
	} else {
		const owned = ownedTaskLookup(source.issues, source.repository.id, operation.task_id, operation.initiative_id, operation.slice_id);
		if (owned.kind === "ambiguous") return result(operation.op, "ambiguous_remote_state", owned.message);
		child = owned.issue;
	}
	const attachment = await confirmAttachment(root, gh, operation.op, source.repository, parent.issue.number, child.number);
	if (!("attached" in attachment)) return attachment;
	if (attachment.attached)
		return createdChild
			? result(operation.op, "created", "Task Issue created and attached as a native Sub-issue", child)
			: result(operation.op, "already_current", "Task Issue and its native Sub-issue relation are current", child);
	const attach = await attachSubIssue(root, gh, operation.op, source.repository, parent.issue.number, child.number);
	if (!("attached" in attach)) return attach;
	return createdChild
		? result(operation.op, "created", "Task Issue created and attached as a native Sub-issue", child)
		: result(operation.op, "updated", "existing Task Issue attached as a native Sub-issue", child);
}

async function confirmTerminalOwnership(
	root: string,
	gh: GhTransport,
	operation: "mark-terminal",
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
	const updated = `${issue.body.trimEnd()}\n\n${terminalMarker(operation.terminal_event_id)}\nTerminal event: \`${operation.terminal_event_id}\`\n`;
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

function validateOperation(operation: TrackerOperation): TrackerOperation {
	if (operation.op === "create-initiative") {
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
			slice_id: identifier(operation.slice_id, "slice_id"),
			goal: publicText(operation.goal, "goal"),
			acceptance: operation.acceptance.map((item, index) => ({
				id: identifier(item.id, `acceptance[${index}].id`),
				summary: publicText(item.summary, `acceptance[${index}].summary`, 500),
			})),
		};
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

function valueAfter(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

function taskPublication(root: string, initiativeId: string, sliceId: string, intentPath: string): Extract<TrackerOperation, { op: "upsert-task" }> {
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
		slice_id: sliceId,
		goal: intent.goal,
		risk: intent.risk,
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
		if (op === "create-initiative" && args.length === 3 && args[1] === "--stdin") {
			const raw = JSON.parse((options.stdin ?? (() => readFileSync(0, "utf8")))()) as Record<string, unknown>;
			operation = {
				op: "create-initiative",
				initiative_id: raw.initiative_id as string,
				goal: raw.goal as string,
				slices: raw.slices as InitiativeSlice[],
			};
		} else if (op === "upsert-task" && args.length === 8) {
			const initiative = valueAfter(args, "--initiative-id");
			const slice = valueAfter(args, "--slice-id");
			const intent = valueAfter(args, "--intent");
			if (!initiative || !slice || !intent)
				throw new Error("upsert-task requires --initiative-id, --slice-id, and --intent");
			operation = taskPublication(root, initiative, slice, intent);
		} else {
			throw new Error("use create-initiative --stdin --json or upsert-task --initiative-id <id> --slice-id <id> --intent <path> --json");
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
