import { createHash } from "node:crypto";

export const STANDARD_AGENT_TOOL = "Agent";
export const STANDARD_AGENT_RESULT_TOOL = "get_subagent_result";

export interface NativeReviewResult {
	agentId: string;
	result: string;
	status: string;
	durationMs?: number;
	tokens?: { input: number; output: number; total: number };
}

const NATIVE_REVIEW_FAILURE_STATUSES = new Set([
	"failed",
	"error",
	"cancelled",
	"stopped",
	"terminated",
]);

export function nativeReviewResultIsFailure(result: NativeReviewResult): boolean {
	return NATIVE_REVIEW_FAILURE_STATUSES.has(result.status);
}

export interface NativeReviewHandle {
	agentId: string;
	result: Promise<NativeReviewResult>;
	stop(): Promise<void>;
}

export interface ReservedAgentParams {
	subagent_type: "general-purpose";
	description: string;
	prompt: string;
	inherit_context: false;
	isolated: true;
	isolation: "worktree";
	run_in_background: true;
	max_turns: number;
	model?: string;
}

export interface ReviewDispatchRequest {
	taskId: string;
	operationId: string;
	params: ReservedAgentParams;
}

export interface ToolExecutionEndLike {
	toolName?: string;
	toolCallId?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
}

export function reservedAgentDescription(taskId: string, operationId: string): string {
	return `Review ${shortId(taskId)} ${shortId(operationId)}`;
}

/**
 * Classify a standard Agent dispatch failure. Provider quota/transport
 * failures (429/rate-limit/quota/overloaded/503/ECONNRESET/ETIMEDOUT) are
 * no-verdict dispatch failures: zero authority writes, the reserved
 * operation stays valid, no terminal review event, and exactly one
 * re-dispatch of the same reserved operation is permitted. Any other
 * failure is an unknown dispatch outcome.
 */
export function classifyDispatchFailure(error: unknown): "no_verdict_dispatch_failure" | "dispatch_unknown" {
	const message = error instanceof Error ? error.message : String(error);
	const low = message.toLowerCase();
	const provider = [
		"429",
		"rate limit",
		"rate_limit",
		"quota",
		"overloaded",
		"503",
		"econnreset",
		"econnrefused",
		"etimedout",
		"socket hang up",
		"insufficient_quota",
		"resource_exhausted",
	];
	if (provider.some((marker) => low.includes(marker))) return "no_verdict_dispatch_failure";
	return "dispatch_unknown";
}

export function semanticNeighborhoodReviewPrompt(prompt: string): string {
	return [
		prompt,
		`For every neighborhood_files entry, verify git rev-parse HEAD:<path> equals base_oid, then analyze current_content exclusively from the immutable bundle. path_provenance is authoritative: diff marks task changes and neighborhood marks unchanged same-state-machine context selected only from scope_hint.`,
		`For settlement-class changes, enumerate every terminal, cancellation, timeout, and race path present across dirty_files and neighborhood_files before deciding the verdict; report findings for every affected path. Reference a bundle path at the start of each finding summary (for example, "path/to/file.ts: ...") so verdict v2 can identify neighborhood context without live repository reads.`,
	].join("\n");
}

export function reservedAgentParams(input: {
	taskId: string;
	operationId: string;
	prompt: string;
	model?: string;
	max_turns?: number;
}): ReservedAgentParams {
	return {
		subagent_type: "general-purpose",
		description: reservedAgentDescription(input.taskId, input.operationId),
		prompt: semanticNeighborhoodReviewPrompt(input.prompt),
		inherit_context: false,
		isolated: true,
		isolation: "worktree",
		run_in_background: true,
		max_turns: input.max_turns ?? 12,
		...(input.model ? { model: input.model } : {}),
	};
}

export function reviewDispatchFollowUp(input: ReviewDispatchRequest): string {
	const lines = [
		`Call the standard Agent tool exactly once for reserved Review ${input.taskId}.`,
		`Do not import a subagent package or call provider RPC. After the native completion notice, call get_subagent_result once; do not poll.`,
		`Use these exact parameters:`,
		`- subagent_type: ${input.params.subagent_type}`,
		`- description: ${input.params.description}`,
		`- inherit_context: ${String(input.params.inherit_context)}`,
		`- isolated: ${String(input.params.isolated)}`,
		`- isolation: ${input.params.isolation}`,
		`- run_in_background: ${String(input.params.run_in_background)}`,
		`- max_turns: ${input.params.max_turns}`,
	];
	if (input.params.model) lines.push(`- model: ${input.params.model}`);
	lines.push(`Use this exact reserved prompt for operation ${input.operationId}:`);
	lines.push(input.params.prompt);
	return lines.join("\n");
}

export function matchesReservedAgentArgs(
	args: unknown,
	params: ReservedAgentParams,
): boolean {
	if (!isRecord(args)) return false;
	return (
		args.subagent_type === params.subagent_type &&
		args.description === params.description &&
		args.prompt === params.prompt &&
		args.inherit_context === params.inherit_context &&
		args.isolated === params.isolated &&
		args.isolation === params.isolation &&
		args.run_in_background === params.run_in_background &&
		args.max_turns === params.max_turns &&
		(params.model === undefined || args.model === params.model)
	);
}

export function parseAgentSpawnReceipt(event: ToolExecutionEndLike): string | null {
	if (event.toolName !== STANDARD_AGENT_TOOL || event.isError) return null;
	const details = toolDetails(event.result);
	const status = stringField(details, "status");
	if (status && status !== "background") return null;
	const agentId =
		stringField(details, "agentId") ??
		stringField(details, "agent_id") ??
		firstMatch(toolText(event.result), /Agent ID:\s+(\S+)/);
	return agentId;
}

export function parseAgentResultPayload(
	event: ToolExecutionEndLike,
	expectedAgentId: string,
): NativeReviewResult | null {
	if (event.toolName !== STANDARD_AGENT_RESULT_TOOL || event.isError) return null;
	const text = toolText(event.result);
	if (!text) return null;
	const agentId = firstMatch(text, /^Agent:\s+(\S+)/m);
	if (agentId !== expectedAgentId) return null;
	const status = firstMatch(text, /Status:\s+([a-zA-Z_]+)/);
	if (!status) return null;
	if (NATIVE_REVIEW_FAILURE_STATUSES.has(status)) {
		return {
			agentId: expectedAgentId,
			result: firstMatch(text, /^Error:\s+(.+)$/m) ?? resultBody(text) ?? `native review ${expectedAgentId} ${status}`,
			status,
		};
	}
	if (!["completed", "steered", "wrapped_up"].includes(status)) return null;
	const durationMs = parseDurationMs(text);
	const body = resultBody(text);
	if (!body) return null;
	return {
		agentId: expectedAgentId,
		result: body,
		status,
		...(durationMs !== undefined ? { durationMs } : {}),
	};
}

export function promptDigest(prompt: string): string {
	return `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
}

function toolDetails(result: unknown): Record<string, unknown> | null {
	if (!isRecord(result)) return null;
	if (isRecord(result.details)) return result.details;
	if (Array.isArray(result.content)) {
		for (const item of result.content) {
			if (isRecord(item) && isRecord(item.details)) return item.details;
		}
	}
	return result;
}

function toolText(result: unknown): string {
	if (typeof result === "string") return result;
	if (!isRecord(result)) return "";
	if (typeof result.text === "string") return result.text;
	if (Array.isArray(result.content)) {
		return result.content
			.map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function resultBody(text: string): string | null {
	const marker = "\n\n";
	const index = text.indexOf(marker);
	if (index < 0) return text.trim() || null;
	const body = text.slice(index + marker.length).trim();
	return body || null;
}

function parseDurationMs(text: string): number | undefined {
	const raw = firstMatch(text, /Duration:\s+([0-9.]+)\s*(ms|s|m)?/);
	if (!raw) return undefined;
	const amount = Number(raw);
	if (!Number.isFinite(amount)) return undefined;
	const unit = firstMatch(text, /Duration:\s+[0-9.]+\s*(ms|s|m)?/) ?? "ms";
	if (unit === "s") return Math.round(amount * 1000);
	if (unit === "m") return Math.round(amount * 60_000);
	return Math.round(amount);
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
	const value = record?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function firstMatch(text: string, pattern: RegExp): string | null {
	return text.match(pattern)?.[1] ?? null;
}

function shortId(value: string): string {
	return value.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "review";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
