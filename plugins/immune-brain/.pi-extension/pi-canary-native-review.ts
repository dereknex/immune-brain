import { createHash } from "node:crypto";

export const STANDARD_AGENT_TOOL = "Agent";

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

export interface ReservedAgentParams {
	subagent_type: "Review";
	description: string;
	prompt: string;
	name: "";
	model: "";
	thinking: "";
	inherit_context: false;
	isolated: true;
	isolation: "worktree";
	run_in_background: false;
	max_turns: number;
	resume: "";
	schedule: "";
}

export interface ToolExecutionEndLike {
	toolName?: string;
	toolCallId?: string;
	args?: unknown;
	input?: unknown;
	result?: unknown;
	content?: unknown;
	details?: unknown;
	isError?: boolean;
}

export interface ToolResultLike extends ToolExecutionEndLike {}

export function reservedAgentDescription(taskId: string, operationId: string): string {
	return `Review ${shortId(taskId)} ${shortId(operationId)}`;
}

export function semanticNeighborhoodReviewPrompt(prompt: string): string {
	if (prompt.includes("assurance_kernel/review_manifest/v5")) {
		return [
			prompt,
			`For every changed_paths entry, inspect the immutable Git objects with git diff and git show against the supplied base_head and review_commit. Verify the review_commit parent and tree before analyzing it; do not read live worktree files or expect source bytes in the manifest.`,
			`Unchanged files are outside mutation authority. Read an unchanged path only when directly required by an acceptance assertion, a changed caller, or the same state machine, and cite the path and reason in the finding. Do not enumerate neighborhood files or explore the repository broadly.`,
		].join("\n");
	}
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
	max_turns?: number;
}): ReservedAgentParams {
	return {
		subagent_type: "Review",
		description: reservedAgentDescription(input.taskId, input.operationId),
		prompt: semanticNeighborhoodReviewPrompt(input.prompt),
		name: "",
		model: "",
		thinking: "",
		inherit_context: false,
		isolated: true,
		isolation: "worktree",
		run_in_background: false,
		max_turns: input.max_turns ?? 16,
		resume: "",
		schedule: "",
	};
}

export function matchesReservedAgentArgs(
	args: unknown,
	params: ReservedAgentParams,
): boolean {
	if (!isRecord(args)) return false;
	const expectedKeys = Object.entries(params)
		.filter(([, value]) => value !== undefined)
		.map(([key]) => key);
	// Pi host normalizes optional Agent fields before the extension observes the
	// call. Keep the complete envelope in the reservation, including empty
	// host-owned fields: empty model/thinking values still let the selected
	// Review agent config resolve without allowing a different call to match.
	const normalizedArgs: Record<string, unknown> = { ...(args as Record<string, unknown>) };
	if (!Object.hasOwn(normalizedArgs, "inherit_context") && (params as unknown as Record<string, unknown>)["inherit_context"] === false) {
		normalizedArgs["inherit_context"] = false;
	}
	if (
		Object.keys(normalizedArgs).length !== expectedKeys.length ||
		expectedKeys.some((key) => !Object.hasOwn(normalizedArgs, key))
	) return false;
	return (
		normalizedArgs.subagent_type === params.subagent_type &&
		normalizedArgs.description === params.description &&
		normalizedArgs.prompt === params.prompt &&
		normalizedArgs.name === params.name &&
		normalizedArgs.model === params.model &&
		normalizedArgs.thinking === params.thinking &&
		normalizedArgs.inherit_context === params.inherit_context &&
		normalizedArgs.isolated === params.isolated &&
		normalizedArgs.isolation === params.isolation &&
		normalizedArgs.run_in_background === params.run_in_background &&
		normalizedArgs.max_turns === params.max_turns &&
		normalizedArgs.resume === params.resume &&
		normalizedArgs.schedule === params.schedule
	);
}

export function parseForegroundAgentResult(
	event: ToolResultLike,
	fallbackAgentId: string,
): NativeReviewResult {
	if (event.toolName !== STANDARD_AGENT_TOOL || event.isError)
		throw new Error("foreground Agent result is unavailable");
	const details = isRecord(event.details)
		? event.details
		: toolDetails(event.result);
	const status = stringField(details, "status") ?? "completed";
	if (NATIVE_REVIEW_FAILURE_STATUSES.has(status)) {
		throw new Error(stringField(details, "error") ?? `foreground Agent ${status}`);
	}
	if (!["completed", "steered", "wrapped_up"].includes(status))
		throw new Error(`foreground Agent returned unsupported status: ${status}`);
	const content = event.content ?? event.result;
	const result = toolText(content);
	if (!result.trim()) throw new Error("foreground Agent returned no review result");
	const agentId = stringField(details, "agentId")
		?? stringField(details, "agent_id")
		?? `foreground-${fallbackAgentId}`;
	const durationMs = parseDurationMs(result);
	return {
		agentId,
		result,
		status,
		...(durationMs === undefined ? {} : { durationMs }),
	};
}

export function promptDigest(prompt: string): string {
	return `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
}

export function toolResultText(result: unknown): string {
	return toolText(result);
}

export function toolResultDetails(result: unknown): Record<string, unknown> | null {
	return toolDetails(result);
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
	if (Array.isArray(result)) {
		return result
			.map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
			.filter(Boolean)
			.join("\n");
	}
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

function parseDurationMs(text: string): number | undefined {
	const match = text.match(/Duration:\s+([0-9.]+)\s*(ms|s|m)?/i);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount)) return undefined;
	switch ((match[2] ?? "ms").toLowerCase()) {
		case "s": return Math.round(amount * 1000);
		case "m": return Math.round(amount * 60_000);
		default: return Math.round(amount);
	}
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
	const value = record?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function shortId(value: string): string {
	return value.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "review";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
