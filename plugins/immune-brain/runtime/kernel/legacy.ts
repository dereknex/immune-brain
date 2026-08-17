import type { LegacyMapping } from "./types";

const STEP_STATES = new Set([
	"pending",
	"active",
	"probing",
	"executing",
	"ready_for_review",
	"rework_needed",
	"closed",
	"replanning",
]);
const FOLLOW_UP_STATES = new Set([
	"pending",
	"executing",
	"ready_for_review",
	"rework_needed",
	"closed",
	"replanning",
]);
const FOLLOW_UP_GATES = new Set(["imm-code-review", "imm-ui-review"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && Boolean(value.trim());
}

function latestFinishResetPlanPath(state: Record<string, unknown>): string | null {
	if (!Array.isArray(state.history)) return null;
	for (let index = state.history.length - 1; index >= 0; index -= 1) {
		const entry = asRecord(state.history[index]);
		if (entry.action !== "finish_reset") continue;
		const planPath = asRecord(entry.details).plan_path;
		return nonEmptyString(planPath) ? planPath : null;
	}
	return null;
}

function isFinishedPlan(
	state: Record<string, unknown>,
	planPath: string,
): boolean {
	const steps = Object.values(asRecord(state.steps));
	return (
		steps.length > 0 &&
		steps.every((step) => asRecord(step).state === "closed") &&
		state.runtime_status === "idle" &&
		state.reset_reason === "intentional_reset" &&
		state.requires_replan === false &&
		(state.active_step === null || state.active_step === undefined) &&
		(state.pending_follow_up === null ||
			state.pending_follow_up === undefined) &&
		latestFinishResetPlanPath(state) === planPath
	);
}

function validFollowUp(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value) || !FOLLOW_UP_STATES.has(String(value.state))) return false;
	const origin = value.origin_review;
	return (
		nonEmptyString(value.id) &&
		Array.isArray(value.scope) &&
		value.scope.length > 0 &&
		value.scope.every(nonEmptyString) &&
		nonEmptyString(value.change_goal) &&
		nonEmptyString(value.verification_hint) &&
		isRecord(origin) &&
		FOLLOW_UP_GATES.has(String(origin.gate)) &&
		nonEmptyString(origin.evidence_ref) &&
		(value.execution_evidence === null || isRecord(value.execution_evidence)) &&
		nonEmptyString(value.opened_at) &&
		Number.isInteger(value.round) &&
		Number(value.round) >= 1 &&
		(value.qa_decision === undefined || isRecord(value.qa_decision)) &&
		(value.closed_at === undefined || nonEmptyString(value.closed_at))
	);
}

function inspectTerminal(
	state: Record<string, unknown>,
): "absent" | "valid" | "invalid" | "conflict" {
	if (state.plan_terminal === null || state.plan_terminal === undefined)
		return "absent";
	if (!isRecord(state.plan_terminal)) return "invalid";
	const terminalPath = state.plan_terminal.plan_path;
	if (
		!nonEmptyString(terminalPath) ||
		!(["cancelled", "superseded"] as unknown[]).includes(
			state.plan_terminal.status,
		)
	)
		return "invalid";
	if (
		nonEmptyString(state.plan_path) &&
		state.plan_path !== terminalPath
	)
		return "conflict";
	return "valid";
}

export interface LegacyAggregateInspection {
	step_states: Array<[string, string]>;
	current_steps: Array<[string, string]>;
	source_states: string[];
	follow_up_present: boolean;
	follow_up_state: string | null;
	follow_up_malformed: boolean;
	steps_malformed: boolean;
	active_step_mismatch: boolean;
	ownership_conflict: boolean;
	replan_signal: boolean;
	replan_mismatch: boolean;
	replan_type_invalid: boolean;
	terminal: "absent" | "valid" | "invalid" | "conflict";
}

export function inspectLegacyAggregate(raw: unknown): LegacyAggregateInspection {
	const state = asRecord(raw);
	const rawSteps = state.steps;
	const stepsRecord = isRecord(rawSteps) ? rawSteps : {};
	const stepEntries = Object.entries(stepsRecord);
	const stepStates: Array<[string, string]> = [];
	let stepsMalformed = !isRecord(rawSteps);
	for (const [key, value] of stepEntries) {
		const stepState = asRecord(value).state;
		if (!nonEmptyString(stepState) || !STEP_STATES.has(stepState)) {
			stepsMalformed = true;
			continue;
		}
		stepStates.push([key, stepState]);
	}
	const currentSteps = stepStates.filter(
		([, stepState]) => stepState !== "closed" && stepState !== "pending",
	);

	const followUpPresent =
		state.pending_follow_up !== null && state.pending_follow_up !== undefined;
	const followUpValid = followUpPresent && validFollowUp(state.pending_follow_up);
	const followUpState = followUpValid
		? String(asRecord(state.pending_follow_up).state)
		: null;

	let activeStepKey: string | null = null;
	let activeStepMalformed = false;
	if (state.active_step !== null && state.active_step !== undefined) {
		if (
			typeof state.active_step === "number" ||
			nonEmptyString(state.active_step)
		)
			activeStepKey = String(state.active_step);
		else activeStepMalformed = true;
	}
	const activeStepMismatch = activeStepMalformed ||
		(activeStepKey !== null &&
			(currentSteps.length !== 1 || currentSteps[0][0] !== activeStepKey)) ||
		(activeStepKey === null &&
			currentSteps.length === 1 &&
			!followUpPresent &&
			currentSteps[0][1] !== "replanning");
	const ownershipConflict = currentSteps.length > 1 ||
		(currentSteps.length > 0 && followUpValid && followUpState !== "closed");
	const replanSignal =
		currentSteps.some(([, stepState]) => stepState === "replanning") ||
		followUpState === "replanning";
	const replanTypeInvalid =
		state.requires_replan !== undefined &&
		typeof state.requires_replan !== "boolean";
	const replanMismatch =
		!replanTypeInvalid && (state.requires_replan === true) !== replanSignal;
	const sourceStates = Array.from(
		new Set([
			...stepStates.map(([, stepState]) => stepState),
			...(followUpState ? [`follow_up:${followUpState}`] : []),
		]),
	).sort();

	const terminal = inspectTerminal(state);
	return {
		step_states: stepStates,
		current_steps: currentSteps,
		source_states: sourceStates,
		follow_up_present: followUpPresent,
		follow_up_state: followUpState,
		follow_up_malformed: followUpPresent && !followUpValid,
		steps_malformed: stepsMalformed,
		active_step_mismatch: activeStepMismatch,
		ownership_conflict: ownershipConflict,
		replan_signal: replanSignal,
		replan_mismatch: replanMismatch,
		replan_type_invalid: replanTypeInvalid,
		terminal:
			terminal === "valid" &&
			(currentSteps.length > 0 || followUpPresent)
				? "conflict"
				: terminal,
	};
}

function stopped(
	states: string[],
	reason = "legacy-inconsistent",
	ambiguous = true,
): LegacyMapping {
	return {
		phase: "stopped",
		reason,
		ambiguous,
		source_states: states,
	};
}

function mapCurrentState(state: string, sourceStates: string[]): LegacyMapping {
	if (state === "ready_for_review")
		return {
			phase: "review",
			reason: "legacy-review",
			ambiguous: false,
			source_states: sourceStates,
		};
	if (["active", "executing", "probing", "rework_needed"].includes(state))
		return {
			phase: "working",
			reason: "legacy-working",
			ambiguous: false,
			source_states: sourceStates,
		};
	return stopped(sourceStates);
}

export function mapLegacyState(raw: unknown): LegacyMapping {
	const state = asRecord(raw);
	const aggregate = inspectLegacyAggregate(raw);
	const states = aggregate.source_states;

	if (
		aggregate.steps_malformed ||
		aggregate.follow_up_malformed ||
		aggregate.active_step_mismatch ||
		aggregate.ownership_conflict ||
		aggregate.replan_mismatch ||
		aggregate.replan_type_invalid ||
		aggregate.terminal === "invalid" ||
		aggregate.terminal === "conflict"
	)
		return stopped(states);
	if (aggregate.terminal === "valid")
		return stopped(states, "legacy-terminal");
	if (aggregate.follow_up_state === "closed") return stopped(states);
	if (aggregate.replan_signal)
		return stopped(states, "legacy-replan", false);
	if (aggregate.follow_up_state) {
		if (aggregate.follow_up_state === "ready_for_review")
			return {
				phase: "review",
				reason: "legacy-review",
				ambiguous: false,
				source_states: states,
			};
		return {
			phase: "working",
			reason: "legacy-working",
			ambiguous: false,
			source_states: states,
		};
	}

	if (aggregate.step_states.length === 0)
		return stopped(states, "legacy-empty");
	if (aggregate.current_steps.length === 1)
		return mapCurrentState(aggregate.current_steps[0][1], states);
	if (aggregate.step_states.some(([, stepState]) => stepState === "pending"))
		return {
			phase: "working",
			reason: "legacy-working",
			ambiguous: false,
			source_states: states,
		};
	if (!nonEmptyString(state.plan_path)) return stopped(states);
	if (isFinishedPlan(state, state.plan_path))
		return {
			phase: "done",
			reason: "legacy-finished",
			ambiguous: false,
			source_states: states,
		};
	return {
		phase: "review",
		reason: "legacy-review",
		ambiguous: false,
		source_states: states,
	};
}
