import { createHash, randomUUID } from "node:crypto";

export const PRIVILEGED_OPERATIONS = [
	"enroll",
	"request_authorization",
	"approve_breaking_intent_revision",
	"stop",
] as const;

export type PrivilegedOperation = (typeof PRIVILEGED_OPERATIONS)[number];
export type NativeDecision = "accept" | "decline" | "cancel";
export type NativeFailureCode =
	| "interaction_not_opened"
	| "user_denied"
	| "user_cancelled"
	| "correlation_missing"
	| "unsupported_host"
	| "workspace_changed";

const RECOVERY_ACTIONS: Record<NativeFailureCode, string> = {
	interaction_not_opened: "retry through a fresh native gate in the current Host",
	user_denied: "wait for a fresh literal-user request",
	user_cancelled: "wait for a fresh literal-user request",
	correlation_missing: "retry through a fresh native gate in the current Host",
	unsupported_host: "upgrade to a supported Claude Code version and retry in the current Host",
	workspace_changed: "review the current workspace and retry through a fresh native gate",
};

export class NativeAuthorityError extends Error {
	constructor(
		readonly reasonCode: NativeFailureCode,
		detail: string,
		readonly recoveryAction = RECOVERY_ACTIONS[reasonCode],
	) {
		super(`${reasonCode}: ${detail}; recovery: ${recoveryAction}`);
		this.name = "NativeAuthorityError";
	}
}

export function isPrivilegedOperation(operation: string): operation is PrivilegedOperation {
	return (PRIVILEGED_OPERATIONS as readonly string[]).includes(operation);
}

export function privilegedAnnotations(): Record<string, unknown> {
	return { destructiveHint: true };
}

export interface NativeGateInput {
	operation: string;
	interactive: boolean;
	decision?: NativeDecision;
}

export type NativeGateResult =
	| { ok: true }
	| { ok: false; error: NativeAuthorityError };

export function evaluateNativeGate(input: NativeGateInput): NativeGateResult {
	if (!isPrivilegedOperation(input.operation)) return { ok: true };
	if (!input.interactive) return { ok: false, error: new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable") };
	if (input.decision === "decline") return { ok: false, error: new NativeAuthorityError("user_denied", "native interaction declined") };
	if (input.decision === "cancel") return { ok: false, error: new NativeAuthorityError("user_cancelled", "native interaction cancelled") };
	if (input.decision !== "accept") return { ok: false, error: new NativeAuthorityError("interaction_not_opened", "native interaction returned no decision") };
	return { ok: true };
}

export interface NativeConfirmationInput {
	operation: PrivilegedOperation;
	taskId: string;
	toolCallId: string;
	risk?: string;
	intentRevision?: number;
	intentContentHash?: string;
	bindingDigest?: string;
	signal?: AbortSignal;
}

export interface NativeConfirmationResult {
	decision: NativeDecision;
	requestId: string;
}

export type NativeConfirmationPort = (input: NativeConfirmationInput) => Promise<NativeConfirmationResult>;

export function confirmationRef(input: {
	connectionId: string;
	toolCallId: string;
	requestId: string;
	operation: string;
	taskId: string;
	intentRevision?: number;
	intentContentHash?: string;
	bindingDigest?: string;
}): string {
	return `claude-confirm-${createHash("sha256")
		.update(`${input.connectionId}\0${input.toolCallId}\0${input.requestId}\0${input.operation}\0${input.taskId}\0${input.intentRevision ?? ""}\0${input.intentContentHash ?? ""}\0${input.bindingDigest ?? ""}`)
		.digest("hex")
		.slice(0, 16)}`;
}

export function enrollmentNonce(): string {
	return randomUUID();
}
