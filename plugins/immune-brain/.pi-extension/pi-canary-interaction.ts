import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type Component, type SelectItem } from "@earendil-works/pi-tui";

export const USER_ATTENTION_EVENT = "immune-brain:user-attention.v1" as const;
export const TASK_RAIL_KEY = "immune-brain.task-rail" as const;

export type UserAttentionReason =
	| "enrollment"
	| "descriptor_waiver"
	| "breaking_intent_revision"
	| "review_authorization"
	| "authority_repair";

export interface UserAttentionEventV1 {
	active: boolean;
	attention_id: string;
	task_id: string;
	reason: UserAttentionReason;
	label?: string;
}

export type TaskRailState =
	| "Planning"
	| "Approval required"
	| "Working"
	| "Verifying"
	| "Reviewing"
	| "Blocked"
	| "Completed"
	| "Stopped";

export interface TaskRailView {
	task_id: string;
	state: TaskRailState;
	result: string;
	next: string;
}

export interface AuthorityDialogAction<T extends string> {
	value: T;
	label: string;
	description: string;
}

export interface AuthorityDialogOptions<T extends string> {
	title: string;
	summary: string;
	details: string;
	actions: readonly AuthorityDialogAction<T>[];
	signal?: AbortSignal;
}

type EventPublisher = Pick<ExtensionAPI, "events">;
type UiContext = Pick<ExtensionContext, "ui">;

const terminalRailUis = new WeakSet<object>();
const deliveredNotifications = new WeakMap<object, Set<string>>();

function beginUserAttention(
	pi: EventPublisher,
	event: Omit<UserAttentionEventV1, "active">,
): () => void {
	let active = true;
	emitAttention(pi, { ...event, active: true });
	return () => {
		if (!active) return;
		active = false;
		emitAttention(pi, {
			active: false,
			attention_id: event.attention_id,
			task_id: event.task_id,
			reason: event.reason,
		});
	};
}

async function withUserAttention<T>(
	pi: EventPublisher,
	event: Omit<UserAttentionEventV1, "active">,
	waitForUser: () => Promise<T>,
): Promise<T> {
	const endAttention = beginUserAttention(pi, event);
	try {
		return await waitForUser();
	} finally {
		endAttention();
	}
}

export async function requestAuthorityDialog<T extends string, R = T | undefined>(
	pi: EventPublisher,
	ctx: UiContext,
	event: Omit<UserAttentionEventV1, "active">,
	options: AuthorityDialogOptions<T>,
	completeDecision?: (selection: T | undefined) => Promise<R>,
): Promise<R> {
	return withUserAttention(pi, event, async () => {
		let selected: T | undefined;
		let finish: ((result: T | undefined) => void) | undefined;
		let settled = false;
		const complete = (result: T | undefined) => {
			if (settled) return;
			settled = true;
			finish?.(result);
		};
		const abort = () => complete(undefined);
		if (!options.signal?.aborted) {
			options.signal?.addEventListener("abort", abort, { once: true });
			try {
				selected = await ctx.ui.custom<T | undefined>((tui, theme, _keybindings, done) => {
					finish = done;
					if (settled || options.signal?.aborted) done(undefined);
					let expanded = false;
					const detailText = new Text(theme.fg("muted", "Details collapsed; press d to expand."), 1, 0);
					const selectList = new SelectList(
						options.actions.map((action): SelectItem => ({ ...action })),
						options.actions.length,
						{
							selectedPrefix: (text) => theme.fg("accent", text),
							selectedText: (text) => theme.fg("accent", text),
							description: (text) => theme.fg("muted", text),
							scrollInfo: (text) => theme.fg("dim", text),
							noMatch: (text) => theme.fg("warning", text),
						},
					);
					selectList.onSelect = (item) => complete(item.value as T);
					selectList.onCancel = () => complete(undefined);
					const container = new Container();
					container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
					container.addChild(new Text(theme.fg("accent", theme.bold(options.title)), 1, 0));
					container.addChild(new Text(options.summary, 1, 0));
					container.addChild(detailText);
					container.addChild(selectList);
					container.addChild(new Text(theme.fg("dim", "d: toggle details | enter: choose | esc: cancel"), 1, 0));
					container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
					return {
						render: (width) => container.render(width),
						invalidate: () => container.invalidate(),
						handleInput: (data) => {
							if (data === "d" || data === "D") {
								expanded = !expanded;
								detailText.setText(expanded ? options.details : theme.fg("muted", "Details collapsed; press d to expand."));
								tui.requestRender();
								return;
							}
							selectList.handleInput(data);
							tui.requestRender();
						},
					};
				}, {
					overlay: true,
					overlayOptions: { anchor: "center", width: "80%", maxHeight: "80%" },
				});
			} finally {
				options.signal?.removeEventListener("abort", abort);
			}
		}
		return completeDecision ? await completeDecision(selected) : selected as R;
	});
}

export function presentTaskRail(ctx: UiContext, view: TaskRailView): void {
	try {
		ctx.ui.setWidget(TASK_RAIL_KEY, (_tui, theme) => {
			return {
				render(width: number): string[] {
					return renderTaskRail(view, width, theme);
				},
				invalidate(): void {},
			};
		}, { placement: "aboveEditor" });
		if (view.state === "Completed" || view.state === "Stopped") terminalRailUis.add(ctx.ui);
		else terminalRailUis.delete(ctx.ui);
	} catch {
		notifyOnce(ctx, `task-rail:${view.task_id}`, "Task Rail is unavailable; Tool results remain authoritative.", "warning");
	}
}

export function presentTaskRailResult(
	ctx: UiContext,
	taskId: string,
	details: Record<string, unknown> | undefined,
): void {
	if (!details) return;
	const taskState = record(details.task_state);
	const lifecycle = string(taskState?.lifecycle) ?? string(details.lifecycle) ?? string(details.stage);
	const operation = string(details.operation);
	const rawState = string(details.state);
	const result = string(details.result) ?? string(details.reason) ?? operation ?? rawState ?? "Task state updated";
	const next = string(details.next_action) ?? "Follow the projected Obligation";
	presentTaskRail(ctx, {
		task_id: taskId,
		state: railState({ lifecycle, obligation: string(taskState?.next_obligation), operation, state: rawState }),
		result,
		next,
	});
}

export function clearTerminalTaskRailOnInput(ctx: UiContext): void {
	if (!terminalRailUis.has(ctx.ui)) return;
	clearTaskRail(ctx);
}

export function clearTaskRail(ctx: UiContext): void {
	try {
		ctx.ui.setWidget(TASK_RAIL_KEY, undefined);
	} catch {
		// Tool rows remain the fallback observation surface.
	}
	terminalRailUis.delete(ctx.ui);
}

export function resetInteractionPresentation(ctx?: UiContext): void {
	if (!ctx) return;
	clearTaskRail(ctx);
	deliveredNotifications.delete(ctx.ui);
}

export function notifyOnce(
	ctx: UiContext,
	key: string,
	message: string,
	level: "warning" | "error",
): void {
	let delivered = deliveredNotifications.get(ctx.ui);
	if (!delivered) {
		delivered = new Set<string>();
		deliveredNotifications.set(ctx.ui, delivered);
	}
	if (delivered.has(key)) return;
	delivered.add(key);
	try {
		ctx.ui.notify(message, level);
	} catch {
		// Notifications never participate in workflow authority.
	}
}

export function renderStructuredCall(
	tool: string,
	action: string,
	subject: string | undefined,
	theme: Theme,
): Component {
	return new Text(
		[
			theme.fg("toolTitle", theme.bold(tool)),
			theme.fg("muted", action),
			...(subject ? [theme.fg("accent", subject)] : []),
		].join(" "),
		0,
		0,
	);
}

export function renderStructuredResult(
	result: { content?: Array<{ type?: string; text?: string }>; details?: Record<string, unknown> },
	theme: Theme,
): Component {
	const details = result.details;
	if (!details) return new Text(theme.fg("dim", "Result details unavailable"), 0, 0);
	const taskState = record(details.task_state);
	const lifecycle = string(taskState?.lifecycle) ?? string(details.lifecycle) ?? string(details.stage);
	const state = string(details.state) ?? "unknown";
	const summary = string(details.result) ?? string(details.reason) ?? string(details.operation) ?? state;
	const next = string(details.next_action) ?? "No action reported";
	const terminal = lifecycle === "done" || lifecycle === "stopped";
	const lines = [
		`${theme.fg("muted", "State:")} ${theme.fg(state === "blocked" || state === "failed" ? "warning" : "accent", lifecycle ?? state)}`,
		`${theme.fg("muted", "Result:")} ${theme.fg(state === "blocked" || state === "failed" ? "warning" : "dim", summary)}`,
		`${theme.fg("muted", "Next:")} ${theme.fg("dim", next)}`,
	];
	if (terminal && taskState) lines.push(...renderFinalLines(taskState, theme));
	return new Text(lines.join("\n"), 0, 0);
}

export function loopResultDetails(result: unknown, operation: string): Record<string, unknown> {
	const projected = record(result);
	const next = string(projected?.next) ?? "none";
	return {
		state: "projected",
		operation,
		result: `Loop selected ${next} without state mutation`,
		next_action: next === "none" ? "No action required" : `Follow ${next} authority`,
	};
}

function emitAttention(pi: EventPublisher, event: UserAttentionEventV1): void {
	try {
		pi.events.emit(USER_ATTENTION_EVENT, event);
	} catch {
		// External attention adapters are optional and non-authoritative.
	}
}

function formatTaskRailState(state: TaskRailState, theme?: Theme): string {
	const symbolAndColor: Record<TaskRailState, { symbol: string; color: string }> = {
		Planning: { symbol: "●", color: "muted" },
		"Approval required": { symbol: "▲", color: "accent" },
		Working: { symbol: "●", color: "accent" },
		Verifying: { symbol: "●", color: "accent" },
		Reviewing: { symbol: "●", color: "accent" },
		Blocked: { symbol: "⚠", color: "warning" },
		Completed: { symbol: "✓", color: "success" },
		Stopped: { symbol: "■", color: "muted" },
	};
	const cfg = symbolAndColor[state] ?? { symbol: "●", color: "dim" };
	if (!theme) return `${cfg.symbol} ${state}`;
	return `${theme.fg(cfg.color, cfg.symbol)} ${theme.fg(cfg.color, state)}`;
}

function renderTaskRail(view: TaskRailView, width = 120, theme?: Theme): string[] {
	const prefixWidth = 8; // "Result: " or "Next: "
	const availableContentWidth = Math.max(20, width - prefixWidth);
	const taskIdWidth = Math.max(16, Math.min(52, width - 26));
	const stateFormatted = formatTaskRailState(view.state, theme);
	const label = (text: string) => (theme ? theme.fg("muted", text) : text);
	const body = (text: string) => (theme ? theme.fg("dim", text) : text);

	return [
		`Task ${boundedMiddle(view.task_id, taskIdWidth)} · ${stateFormatted}`,
		`${label("Result:")} ${body(bounded(view.result, availableContentWidth))}`,
		`${label("Next:")} ${body(bounded(view.next, availableContentWidth))}`,
	];
}

function railState(input: { lifecycle?: string; obligation?: string; operation?: string; state?: string }): TaskRailState {
	if (input.state === "blocked" || input.state === "failed" || input.state === "settlement_unknown") return "Blocked";
	if (input.lifecycle === "done") return "Completed";
	if (input.lifecycle === "stopped") return "Stopped";
	if (input.state === "awaiting_user" || input.operation === "request_authorization") return "Approval required";
	if (input.operation === "advance_assurance") return "Verifying";
	if (input.operation === "submit_review" || input.obligation === "run_review") return "Reviewing";
	if (input.lifecycle === "active") return "Working";
	if (input.state === "running") return "Planning";
	return "Working";
}

function renderFinalLines(taskState: Record<string, unknown>, theme: Theme): string[] {
	const fresh = strings(taskState.fresh_acceptance_ids).length;
	const missing = strings(taskState.missing_acceptance_ids).length;
	const approvals = strings(taskState.fresh_approval_kinds);
	const blockers = strings(taskState.blocking_finding_ids).length
		+ strings(taskState.unresolved_user_decision_ids).length
		+ strings(taskState.replan_required_ids).length;
	const diffHash = string(taskState.diff_hash);
	return [
		`${theme.fg("muted", "Acceptance:")} ${theme.fg(missing === 0 ? "success" : "warning", `${fresh}/${fresh + missing} fresh`)}`,
		`${theme.fg("muted", "QA / Review:")} ${theme.fg("dim", approvals.length > 0 ? approvals.join(", ") : "not recorded")}`,
		`${theme.fg("muted", "Residual blockers:")} ${theme.fg(blockers === 0 ? "dim" : "warning", String(blockers))}`,
		`${theme.fg("muted", "Repository health:")} ${theme.fg("dim", "not assessed")}`,
		`${theme.fg("muted", "Git:")} ${theme.fg("dim", diffHash ? `task diff ${diffHash.slice(0, 15)}` : "not reported")}`,
	];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function string(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function bounded(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function boundedMiddle(value: string, max: number): string {
	if (value.length <= max) return value;
	const visible = max - 1;
	const start = Math.ceil(visible / 2);
	return `${value.slice(0, start)}…${value.slice(-(visible - start))}`;
}
