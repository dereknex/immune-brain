import { PlanValidationError } from "./plan_core";

export interface ActivationChild {
	name: string;
	model_tier: string;
	lens: string;
	triggers: string[];
	path_patterns: string[];
}

export interface ActivationPlan {
	host: string;
	activation_mode: string;
	children: ActivationChild[];
	solo: boolean;
	reason: string;
}

export function buildSoloPlan(host: string, reason: string): ActivationPlan {
	return {
		host,
		activation_mode: "explicit_only",
		children: [],
		solo: true,
		reason,
	};
}

export function validateActivationMode(mode: string): string {
	const valid = ["auto", "explicit_only", "disabled"];
	if (!valid.includes(mode)) {
		throw new PlanValidationError(`Invalid activation mode: ${mode}`);
	}
	return mode;
}

export function resolveActivationMode(
	explicitSolo: boolean,
	explicitSubagents: boolean,
	configMode = "auto",
): { mode: string; reason: string } {
	if (explicitSolo) return { mode: "explicit_only", reason: "explicit_solo" };
	if (explicitSubagents) return { mode: "auto", reason: "explicit_subagents" };
	return { mode: configMode, reason: "config_default" };
}
