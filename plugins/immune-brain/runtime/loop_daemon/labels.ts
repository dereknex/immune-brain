/**
 * Loop Daemon: Disagreement & Reversal Label Corpus Append Log (S10)
 *
 * Implements D12 item 4 of docs/specs/loop-daemon.spec.md:
 * Appends `labels.jsonl` (mode 0600) rows whenever the judging agent overrides a
 * model-skipped decision during reconciliation, or when a verified owner
 * `@imm-loop retry` / `@imm-loop ignore` reverses a model-decided event.
 * Output rows conform to scripts/decision-eval/harness.ts `loadCorpus()` rows.
 */

import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureLoopStateDir } from "./state.ts";

export type LabelSource = "judging_agent" | "owner";

export interface LoopLabelRow {
	id: string;
	point: string;
	gold: string;
	model_choice: string;
	source: LabelSource;
	recorded_at: string;
	decision_id?: string;
	event_id?: string;
	target_id?: string;
	handler?: string;
	reason?: string;
}

export const LABELS_FILENAME = "labels.jsonl";

const LOOP_POINT_OPTIONS: Readonly<Record<string, readonly string[]>> = {
	a14_pr_comment_triage: ["blocking", "nit", "out_of_scope", "duplicate"],
	a15_task_granularity: ["clear_single_task", "needs_initiative_decomposition", "needs_clarification"],
	a18_event_prefilter: ["actionable", "ignore"],
	a19_owner_comment_intent: [
		"approve_plan",
		"request_plan_revision",
		"answer_lane_decision",
		"command",
		"discussion",
	],
	a20_issue_duplicate_pair: ["duplicate", "related", "unrelated"],
};

export function isValidLabelChoice(
	point: string,
	choice: string,
	allowedOptions?: readonly string[],
): boolean {
	const options = allowedOptions ?? LOOP_POINT_OPTIONS[point];
	if (!options) return false;
	return options.includes(choice);
}

export function labelsFilePath(stateDir: string): string {
	return join(stateDir, LABELS_FILENAME);
}

export function appendLoopLabel(
	stateDir: string,
	row: LoopLabelRow,
	options?: { allowedOptions?: readonly string[] },
): void {
	if (!row.id || !row.point || !row.gold) {
		throw new Error("Loop label row requires non-empty id, point, and gold");
	}
	if (!isValidLabelChoice(row.point, row.gold, options?.allowedOptions)) {
		throw new Error(`Invalid gold label "${row.gold}" for application point "${row.point}"`);
	}

	ensureLoopStateDir(stateDir);
	const path = labelsFilePath(stateDir);
	const line = `${JSON.stringify(row)}\n`;
	appendFileSync(path, line, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {}
}

export function loadLoopLabels(stateDir: string): LoopLabelRow[] {
	const path = labelsFilePath(stateDir);
	if (!existsSync(path)) return [];
	try {
		return readFileSync(path, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as LoopLabelRow);
	} catch {
		return [];
	}
}
