/**
 * Loop Daemon: Read-Only Judging Agent Session (S10)
 *
 * Implements D12 items 2 & 3 of docs/specs/loop-daemon.spec.md:
 * Handles low-confidence, truncated, disabled-point, or unavailable Tier-2
 * decisions via a read-only S9 headless session (`kind: "judging"`).
 * The returned handler is strictly validated against the closed 15-handler
 * catalogue (`LOOP_HANDLERS`); invalid or unavailable results execute nothing
 * side-effecting and yield `null` so the caller falls back to the point baseline.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	runAgentSession,
	sessionEnvironment,
	type AgentSessionProvider,
	type AgentSessionRecord,
} from "./agent_runner.ts";
import { isLoopHandler, type LoopHandler } from "./handlers.ts";
import type { NormalizedLoopEvent } from "./types.ts";

export const JUDGING_OUTPUT_PATH = ".imm-loop/judgement.json";

export interface JudgingContext {
	point: string;
	escalation_reason: string;
	event: NormalizedLoopEvent;
	model_choice?: string;
	model_confidence?: number;
	truncation?: string;
	options?: readonly string[];
	candidate?: { number: number; title: string; body: string; score?: number };
	offered_options?: Array<{ id: string; label: string; description?: string }>;
	extra?: Record<string, unknown>;
}

export interface JudgingDecision {
	handler: LoopHandler;
	reason: string;
	corrected_option?: string;
	lane_option?: string;
	session_record?: AgentSessionRecord;
}

export type JudgingAgentFn = (
	input: JudgingContext,
) => Promise<JudgingDecision | null> | JudgingDecision | null;

export interface ParsedJudgingOutput {
	handler: LoopHandler;
	reason: string;
	corrected_option?: string;
	lane_option?: string;
}

export function parseJudgingOutput(
	bytes: string,
	allowedOptions?: readonly string[],
	offeredOptionIds?: readonly string[],
): ParsedJudgingOutput | null {
	try {
		const raw = JSON.parse(bytes) as Record<string, unknown>;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
		if (typeof raw.handler !== "string" || !isLoopHandler(raw.handler)) return null;
		if (typeof raw.reason !== "string" || raw.reason.trim().length === 0) return null;
		let correctedOption: string | undefined;
		if (raw.corrected_option !== undefined && raw.corrected_option !== null) {
			if (typeof raw.corrected_option !== "string") return null;
			if (allowedOptions && !allowedOptions.includes(raw.corrected_option)) return null;
			correctedOption = raw.corrected_option;
		}
		let laneOption: string | undefined;
		if (raw.lane_option !== undefined && raw.lane_option !== null) {
			if (typeof raw.lane_option !== "string") return null;
			if (offeredOptionIds && !offeredOptionIds.includes(raw.lane_option)) return null;
			laneOption = raw.lane_option;
		}
		return {
			handler: raw.handler,
			reason: raw.reason.trim(),
			...(correctedOption !== undefined ? { corrected_option: correctedOption } : {}),
			...(laneOption !== undefined ? { lane_option: laneOption } : {}),
		};
	} catch {
		return null;
	}
}

function buildJudgingPrompt(input: JudgingContext): string {
	const safeEvent: Record<string, unknown> = {
		event_id: input.event.event_id,
		kind: input.event.kind,
		timestamp: input.event.timestamp,
		...("issue_number" in input.event ? { issue_number: input.event.issue_number } : {}),
		...("pr_number" in input.event ? { pr_number: input.event.pr_number } : {}),
		...("comment_id" in input.event ? { comment_id: input.event.comment_id } : {}),
		...("author" in input.event ? { author: input.event.author } : {}),
		...("title" in input.event ? { title: input.event.title } : {}),
		...("body" in input.event ? { body: input.event.body } : {}),
		...("path" in input.event ? { path: input.event.path } : {}),
	};

	const payload = {
		mode: "read_only_judging",
		point: input.point,
		escalation_reason: input.escalation_reason,
		model_choice: input.model_choice ?? null,
		model_confidence: input.model_confidence ?? null,
		truncation: input.truncation ?? null,
		options: input.options ?? null,
		candidate: input.candidate ?? null,
		offered_options: input.offered_options ?? null,
		event: safeEvent,
		...(input.extra ? { extra: input.extra } : {}),
	};

	return [
		"You are the read-only Judging Agent for immune-brain Loop Daemon.",
		"Do NOT modify repository files or run mutations. Inspect read-only evidence only.",
		`Select a single handler from the closed 15-handler catalogue and write JSON { "handler": string, "reason": string, "corrected_option"?: string } to ${JUDGING_OUTPUT_PATH}.`,
		"",
		JSON.stringify(payload, null, 2),
	].join("\n");
}

function prepareDetachedJudgingDir(root: string): { path: string; cleanup: () => void } {
	const tempParent = mkdtempSync(join(tmpdir(), "imm-loop-judge-"));
	const worktreePath = join(tempParent, "wt");
	const added = spawnSync("git", ["-C", root, "worktree", "add", "--detach", worktreePath, "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (added.status === 0) {
		return {
			path: worktreePath,
			cleanup: () => {
				spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath], {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				});
				rmSync(tempParent, { recursive: true, force: true });
			},
		};
	}

	return {
		path: tempParent,
		cleanup: () => {
			rmSync(tempParent, { recursive: true, force: true });
		},
	};
}

export interface SessionJudgingAgentOptions {
	root: string;
	provider: AgentSessionProvider;
	credential?: string | null;
	turn_budget?: number;
	timeout_ms?: number;
	output_path?: string;
	/** Test seam: explicit scratch/worktree path instead of spawning a git worktree. */
	worktree_path?: string;
}

/**
 * Builds a production `JudgingAgentFn` backed by the bounded S9 `runAgentSession`
 * runner (`kind: "judging"`). Runs in a read-only detached workspace and validates
 * the output against `LOOP_HANDLERS`.
 */
export function createSessionJudgingAgent(options: SessionJudgingAgentOptions): JudgingAgentFn {
	const outputPath = options.output_path ?? JUDGING_OUTPUT_PATH;
	const turnBudget = options.turn_budget ?? 4;
	const timeoutMs = options.timeout_ms ?? 60_000;

	return async (input: JudgingContext): Promise<JudgingDecision | null> => {
		const workspace = options.worktree_path
			? { path: options.worktree_path, cleanup: () => {} }
			: prepareDetachedJudgingDir(options.root);

		try {
			const offeredIds = input.offered_options?.map((opt) => opt.id);
			const record = await runAgentSession(
				{
					kind: "judging",
					worktree_path: workspace.path,
					prompt: buildJudgingPrompt(input),
					output_path: outputPath,
					turn_budget: turnBudget,
					timeout_ms: timeoutMs,
					env: sessionEnvironment(options.credential ?? null),
				},
				options.provider,
				{
					validate: (bytes) => parseJudgingOutput(bytes, input.options, offeredIds) !== null,
				},
			);

			if (record.status !== "completed" || record.output === null) {
				return null;
			}
			const parsed = parseJudgingOutput(record.output, input.options, offeredIds);
			if (!parsed || !isLoopHandler(parsed.handler)) {
				return null;
			}
			return {
				handler: parsed.handler,
				reason: parsed.reason,
				...(parsed.corrected_option !== undefined
					? { corrected_option: parsed.corrected_option }
					: {}),
				...(parsed.lane_option !== undefined ? { lane_option: parsed.lane_option } : {}),
				session_record: record,
			};
		} catch {
			return null;
		} finally {
			workspace.cleanup();
		}
	};
}
