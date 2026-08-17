/**
 * HANDOFF.md projection.
 *
 * HANDOFF.md is read by humans opening the repo cold, so the state a reader
 * needs has to be on disk rather than behind a CLI call. The runtime owns only
 * the region between the markers below; everything else — session decisions,
 * priority-file judgement — is narrative the runtime cannot derive and must
 * never overwrite.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const HANDOFF_START_MARKER =
	"<!-- GENERATED: immune-brain-handoff-state -->";
export const HANDOFF_END_MARKER =
	"<!-- END GENERATED: immune-brain-handoff-state -->";

function stepLabel(step: Record<string, any> | undefined): string | null {
	if (!step) return null;
	const id = step.step_id || `Step ${step.number}`;
	return step.result ? `${id}: ${step.result}` : String(id);
}

const DEFAULT_HANDOFF = `# Immune-Brain Handoff

## Decisions this session

- None recorded.
`;

/**
 * Best-effort by contract: the Ledger write has already committed by the time
 * this runs, so a failure here must leave the workflow decision standing rather
 * than surface as a failed review.
 */
export function refreshHandoffFile(
	root: string,
	state: Record<string, any>,
): boolean {
	const path = resolve(root, "HANDOFF.md");
	try {
		const existing = existsSync(path)
			? readFileSync(path, "utf8")
			: DEFAULT_HANDOFF;
		writeFileSync(path, applyHandoffState(existing, state));
		return true;
	} catch {
		return false;
	}
}

export function renderHandoffState(state: Record<string, any>): string {
	const steps = (state.steps || {}) as Record<string, Record<string, any>>;
	const completed = Array.isArray(state.completed_steps)
		? state.completed_steps
		: [];
	const completedLines = completed
		.map((number: number) => stepLabel(steps[String(number)]))
		.filter((label: string | null): label is string => Boolean(label))
		.map((label: string) => `- ${label}`);
	const active =
		state.active_step === null || state.active_step === undefined
			? null
			: stepLabel(steps[String(state.active_step)]);

	const blockerLines = Object.values(steps)
		.filter((step) => {
			const evidence = step?.execution_evidence;
			return (
				evidence &&
				(evidence.failure_exit || evidence.status === "blocked" ||
					evidence.status === "failed")
			);
		})
		.map((step) => {
			const evidence = step.execution_evidence;
			const reason = evidence.failure_exit || evidence.status;
			return `- ${step.step_id || `Step ${step.number}`}: ${reason}`;
		});

	return [
		"## Current state",
		"",
		`- Plan: \`${state.plan_path || "none"}\``,
		`- Summary: ${state.plan_summary || "none"}`,
		"",
		"### Completed steps",
		"",
		...(completedLines.length > 0 ? completedLines : ["None."]),
		"",
		"### Active step",
		"",
		active ? `- ${active}` : "None.",
		"",
		"### Known blockers",
		"",
		...(blockerLines.length > 0 ? blockerLines : ["None."]),
	].join("\n");
}

function markedBlock(generated: string): string {
	return `${HANDOFF_START_MARKER}\n${generated}\n${HANDOFF_END_MARKER}`;
}

export function applyHandoffState(
	existing: string,
	state: Record<string, any>,
): string {
	const generated = renderHandoffState(state);
	const start = existing.indexOf(HANDOFF_START_MARKER);
	const end =
		start < 0
			? -1
			: existing.indexOf(
					HANDOFF_END_MARKER,
					start + HANDOFF_START_MARKER.length,
				);

	// A HANDOFF that predates the markers is adopted, never rewritten: the block
	// goes in below the title and every existing line survives underneath it.
	if (start < 0 || end < 0) {
		const lines = existing.split("\n");
		const titleIndex = lines.findIndex((line) => line.startsWith("# "));
		const insertAt = titleIndex < 0 ? 0 : titleIndex + 1;
		const head = lines.slice(0, insertAt).join("\n");
		const tail = lines.slice(insertAt).join("\n");
		return `${head}${head ? "\n" : ""}\n${markedBlock(generated)}\n${tail}`;
	}

	return `${existing.slice(0, start)}${markedBlock(generated)}${existing.slice(end + HANDOFF_END_MARKER.length)}`;
}
