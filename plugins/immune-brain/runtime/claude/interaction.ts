import { createHash, randomUUID } from "node:crypto";
import { parsePermissionMode, type PermissionMode } from "./capability";

export const PRIVILEGED_OPERATIONS = [
	"enroll",
	"request_authorization",
	"approve_breaking_intent_revision",
	"stop",
	"repair_authority_state",
] as const;

export type PrivilegedOperation = (typeof PRIVILEGED_OPERATIONS)[number];
export type NativeDecision = "accept" | "deny" | "cancel";

export function isPrivilegedOperation(operation: string): operation is PrivilegedOperation {
	return (PRIVILEGED_OPERATIONS as readonly string[]).includes(operation);
}

export function privilegedAnnotations(): Record<string, unknown> {
	return {
		destructiveHint: true,
		"anthropic/requiresUserInteraction": true,
	};
}

export interface NativeGateInput {
	operation: string;
	permissionMode: PermissionMode | string;
	requiresUserInteraction: boolean;
	interactive: boolean;
	decision?: NativeDecision;
}

export type NativeGateResult =
	| { ok: true }
	| { ok: false; reason: string };

export function evaluateNativeGate(input: NativeGateInput): NativeGateResult {
	if (!isPrivilegedOperation(input.operation)) return { ok: true };
	if (!input.interactive) return { ok: false, reason: "non-interactive execution cannot mint authority" };
	const mode = parsePermissionMode(input.permissionMode);
	if (!mode) return { ok: false, reason: `unsupported permission mode ${String(input.permissionMode)}` };
	if (mode === "dontAsk") return { ok: false, reason: "dontAsk cannot mint authority" };
	if (!input.requiresUserInteraction) {
		return { ok: false, reason: "privileged operation requires anthropic/requiresUserInteraction" };
	}
	if (input.decision === "deny") return { ok: false, reason: "native interaction denied" };
	if (input.decision === "cancel") return { ok: false, reason: "native interaction cancelled" };
	if (input.decision !== "accept") return { ok: false, reason: "native interaction missing" };
	return { ok: true };
}

export function confirmationRef(input: {
	sessionId: string;
	toolCallId: string;
	operation: string;
	taskId: string;
	intentRevision?: number;
	intentContentHash?: string;
	bindingDigest?: string;
}): string {
	return `claude-confirm-${createHash("sha256")
		.update(`${input.sessionId}\0${input.toolCallId}\0${input.operation}\0${input.taskId}\0${input.intentRevision ?? ""}\0${input.intentContentHash ?? ""}\0${input.bindingDigest ?? ""}`)
		.digest("hex")
		.slice(0, 16)}`;
}

export function enrollmentNonce(): string {
	return randomUUID();
}
