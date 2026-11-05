import { PHASE_ENTRY_RECOVERY } from "../assurance/phase_entry";

export const PRIVILEGED_OPERATIONS = [
	"enroll",
	"request_authorization",
	"approve_breaking_intent_revision",
	"stop",
	"start_unattended_batch",
	"retire_stale_batch",
] as const;

export type PrivilegedOperation = (typeof PRIVILEGED_OPERATIONS)[number];
export type NativeDecision = "accept" | "decline" | "cancel";
export type NativeFailureCode =
	| "interaction_not_opened"
	| "user_denied"
	| "user_cancelled"
	| "correlation_missing"
	| "unsupported_host"
	| "workspace_changed"
	| "run_entry_required"
	| "phase_entry_required"
	| "plugin_bundle_stale";

export const RECOVERY_ACTIONS: Record<NativeFailureCode, string> = {
	interaction_not_opened: "retry through a fresh native gate in the current Host",
	user_denied: "wait for a fresh literal-user request",
	user_cancelled: "wait for a fresh literal-user request",
	correlation_missing: "retry through a fresh native gate in the current Host",
	unsupported_host: "upgrade to a supported Antigravity version and retry in the current Host",
	workspace_changed: "review the current workspace and retry through a fresh native gate",
	plugin_bundle_stale: "reload the Antigravity session so it loads the current bundle, then retry",
	...PHASE_ENTRY_RECOVERY,
};

export { NativeAuthorityError } from "../claude/interaction";

export function isPrivilegedOperation(operation: string): operation is PrivilegedOperation {
	return (PRIVILEGED_OPERATIONS as readonly string[]).includes(operation);
}

export interface NativeConfirmationInput {
	operation: string;
	interactive: boolean;
	decision?: NativeDecision;
}

export interface NativeConfirmationPort {
	confirm(input: NativeConfirmationInput): Promise<NativeDecision>;
}
