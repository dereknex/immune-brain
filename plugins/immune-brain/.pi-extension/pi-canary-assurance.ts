import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { renderStructuredCall, renderStructuredResult } from "./pi-canary-interaction";

export type AssuranceRole = "qa" | "review";

export interface AssuranceCorrelation {
	record_revision: string;
	intent_content_hash: string;
	diff_hash: string;
}

export interface AssuranceFindingPresentation {
	id: string;
	kind: "blocking" | "advisory";
	acceptance_id: string | null;
	summary: string;
}

export interface AssuranceResultPresentation {
	passed_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	findings: AssuranceFindingPresentation[];
}


export interface CanaryToolArgs {
	task_id: string;
	action: { op: string };
}

export function renderCanaryCall(args: CanaryToolArgs, theme: Theme): Component {
	return renderStructuredCall(
		"imm_kernel_canary",
		args.action?.op ?? "unknown",
		args.task_id,
		theme,
	);
}

export function renderCanaryResult(
	result: { content?: Array<{ type?: string; text?: string }>; details?: Record<string, unknown> },
	theme: Theme,
): Component {
	return renderStructuredResult(result, theme);
}

export function renderAssuranceResultMessage(
	message: { content?: unknown; details?: unknown },
	options: { expanded?: boolean; outputPad?: number },
	theme: Theme,
): Component {
	const payload = isRecord(message.details) ? message.details : undefined;
	if (
		!payload
		|| typeof payload.task_id !== "string"
		|| (payload.role !== "qa" && payload.role !== "review")
		|| typeof payload.terminal !== "string"
	) {
		const fallback = typeof message.content === "string" ? message.content : "Assurance result unavailable";
		return new Text(theme.fg("dim", fallback), options.outputPad ?? 0, 0);
	}

	const presentation = isAssuranceResultPresentation(payload.presentation)
		? payload.presentation
		: undefined;
	const findings = presentation?.findings ?? [];
	const blockers = findings.filter((finding) => finding.kind === "blocking");
	const warnings = findings.filter((finding) => finding.kind === "advisory");
	const passed = presentation?.passed_acceptance_ids ?? [];
	const missing = presentation?.missing_acceptance_ids ?? [];
	const terminal = payload.terminal.replaceAll("_", " ");
	const role = payload.role === "qa" ? "QA" : "Review";
	const status = `${role} ${terminal}`;
	const lines = [`${theme.fg("muted", "Status:")} ${theme.fg("accent", capitalize(status))}`];

	if (presentation) {
		lines.push(
			`${theme.fg("muted", "Result:")} ${[
				theme.fg(blockers.length > 0 ? "error" : "muted", `Blockers: ${blockers.length}`),
				theme.fg(warnings.length > 0 ? "warning" : "muted", `Warnings: ${warnings.length}`),
				theme.fg("success", `Passed: ${passed.length}`),
				theme.fg(missing.length > 0 ? "warning" : "muted", `Missing: ${missing.length}`),
			].join(" | ")}`,
		);
		const next = renderNextAction(payload.next_action);
		if (next) lines.push(`${theme.fg("muted", "Next:")} ${theme.fg("dim", next)}`);
		for (const finding of blockers) lines.push(renderFinding(finding, theme));
		if (options.expanded) {
			for (const finding of warnings) lines.push(renderFinding(finding, theme));
			if (passed.length > 0) lines.push(theme.fg("dim", `Passed acceptance: ${passed.join(", ")}`));
			if (missing.length > 0) lines.push(theme.fg("warning", `Missing acceptance: ${missing.join(", ")}`));
			if (typeof payload.summary === "string" && payload.summary) lines.push(theme.fg("dim", payload.summary));
		}
	} else if (typeof payload.summary === "string" && payload.summary) {
		lines.push(`${theme.fg("muted", "Result:")} ${theme.fg("dim", payload.summary)}`);
	}

	return new Text(lines.join("\n"), options.outputPad ?? 0, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssuranceResultPresentation(value: unknown): value is AssuranceResultPresentation {
	if (!isRecord(value)) return false;
	if (!isStringArray(value.passed_acceptance_ids) || !isStringArray(value.missing_acceptance_ids)) return false;
	return Array.isArray(value.findings) && value.findings.every((finding) =>
		isRecord(finding)
		&& typeof finding.id === "string"
		&& (finding.kind === "blocking" || finding.kind === "advisory")
		&& (finding.acceptance_id === null || typeof finding.acceptance_id === "string")
		&& typeof finding.summary === "string");
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function capitalize(value: string): string {
	return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function renderNextAction(value: unknown): string | undefined {
	switch (value) {
		case "request_authorization":
			return "Agent opens native confirmation";
		case "repair_findings":
			return "Agent repairs blocking findings";
		case "inspect_assurance_failure":
			return "Agent inspects the assurance failure";
		case "none":
			return "No action required";
		default:
			return undefined;
	}
}

function renderFinding(finding: AssuranceFindingPresentation, theme: Theme): string {
	const label = finding.kind === "blocking"
		? theme.fg("error", "[blocking]")
		: theme.fg("warning", "[advisory]");
	const acceptance = finding.acceptance_id ? ` (${finding.acceptance_id})` : "";
	return `${label} ${finding.id}${acceptance}: ${finding.summary}`;
}

// Foreground Tool results render directly in the chat transcript. There is no
// session-owned status or message continuation channel.
export class AssurancePresenter {
	publish(): void {}
	clear(): void {}
	reset(): void {}
}
