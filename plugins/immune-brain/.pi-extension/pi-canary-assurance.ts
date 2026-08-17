import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";

export const ASSURANCE_STATUS_KEY = "imm-canary-assure";
export const ASSURANCE_WIDGET_KEY = "imm-canary-assurance";

export type AssuranceRole = "qa" | "review";
export type AssuranceLifecycle =
	| "starting"
	| "running"
	| "slow"
	| "stalled"
	| "stop_requested"
	| "settling"
	| "cancellation_requested"
	| "completed"
	| "failed"
	| "timed_out"
	| "cancelled"
	| "awaiting_user";

export interface AssuranceCorrelation {
	record_revision: string;
	intent_content_hash: string;
	diff_hash: string;
}

export interface AssuranceView {
	task_id: string;
	operation_id: string;
	role: AssuranceRole;
	lifecycle: AssuranceLifecycle;
	stage: string;
	started_at: number;
	deadline_seconds: number;
	current?: number;
	total?: number;
	agent_id?: string;
	telemetry: "deterministic" | "native_lifecycle_only";
	footer?: string;
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

export type AssuranceNextAction =
	| "request_authorization"
	| "repair_findings"
	| "inspect_assurance_failure"
	| "none";

export interface AssuranceFollowUp extends AssuranceCorrelation {
	contract: "assurance_kernel/assurance_follow_up/v1";
	task_id: string;
	operation_id: string;
	role: AssuranceRole;
	terminal: "rework" | "verdict_ready" | "failed" | "timed_out" | "cancelled";
	summary: string;
	next_action: AssuranceNextAction;
	superseded?: boolean;
	presentation?: AssuranceResultPresentation;
}

export interface CanaryToolArgs {
	task_id: string;
	action: { op: string };
}

export function renderCanaryCall(args: CanaryToolArgs, theme: Theme): Component {
	const op = args.action?.op ?? "unknown";
	return new Text(
		`${theme.fg("toolTitle", theme.bold("imm_kernel_canary"))} ${theme.fg("muted", op)} ${theme.fg("accent", args.task_id)}`,
		0,
		0,
	);
}

export function renderCanaryResult(
	result: { content?: Array<{ type?: string; text?: string }>; details?: Record<string, unknown> },
	theme: Theme,
): Component {
	const details = result.details ?? {};
	const state = typeof details.state === "string" ? details.state : undefined;
	const operation = typeof details.operation === "string" ? details.operation : undefined;
	const phase = typeof details.phase === "string" ? details.phase : undefined;
	const reason = typeof details.reason === "string" ? details.reason : undefined;
	const resultSummary = typeof details.result === "string" ? details.result : undefined;
	const nextAction = typeof details.next_action === "string" ? details.next_action : undefined;
	if (state) {
		const status = phase ?? state;
		const result = resultSummary ?? reason ?? operation ?? state;
		const lines = [
			`${theme.fg("muted", "Status:")} ${theme.fg("accent", status)}`,
			`${theme.fg("muted", "Result:")} ${theme.fg(reason ? "warning" : "dim", result)}`,
		];
		if (nextAction) lines.push(`${theme.fg("muted", "Next:")} ${theme.fg("dim", nextAction)}`);
		return new Text(lines.join("\n"), 0, 0);
	}
	const text = result.content?.[0]?.type === "text" ? result.content[0].text ?? "" : "";
	return new Text(theme.fg("dim", text), 0, 0);
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

// Historical custom Widget copy said "native activity telemetry unavailable".
// R3-D1 deleted that Widget; the phrase remains only as a contract marker.
export class AssurancePresenter {
	private readonly deliveredFollowUps = new Set<string>();
	private lastContext: ExtensionContext | undefined;

	constructor(private readonly pi: Pick<ExtensionAPI, "sendMessage">) {}

	publish(ctx: ExtensionContext, _view: AssuranceView): void {
		this.lastContext = ctx;
	}

	clear(): void {
		const ctx = this.lastContext;
		this.lastContext = undefined;
		if (!ctx) return;
		try {
			ctx.ui.setStatus(ASSURANCE_STATUS_KEY, undefined);
			if (ctx.mode === "tui") ctx.ui.setWidget(ASSURANCE_WIDGET_KEY, undefined);
		} catch {
			// Session teardown may have already disposed the UI.
		}
	}

	deliverFollowUp(payload: AssuranceFollowUp): boolean {
		const key = `${payload.task_id}:${payload.operation_id}:${payload.role}`;
		if (this.deliveredFollowUps.has(key)) return false;
		try {
			const continuation = payload.next_action === "request_authorization"
				? " Call imm_kernel_canary request_authorization now; native confirmation is the only user interaction."
				: " Continue from the structured next_action without requiring the user to relay workflow state.";
			this.pi.sendMessage(
				{
					customType: "imm-assurance-result",
					content: `Assurance ${payload.role} ${payload.terminal} for ${payload.task_id} op ${payload.operation_id}: ${payload.summary}${payload.superseded ? " [superseded]" : ""}.${continuation}`,
					display: true,
					details: payload,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
			this.deliveredFollowUps.add(key);
			return true;
		} catch {
			return false;
		}
	}

	reset(): void {
		this.deliveredFollowUps.clear();
		this.clear();
	}
}
