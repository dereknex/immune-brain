export interface ToolFailureV1 {
	contract: "immune_brain/tool_failure/v1";
	tool: "imm_canary_enrollment" | "imm_kernel_canary";
	task_id: string;
	operation: string;
	state: "blocked" | "failed" | "authority_conflict" | "settlement_unknown";
	code: string;
	message: string;
	next_action: string;
}

export function throwToolFailure(
	failure: Omit<ToolFailureV1, "contract">,
): never {
	throw new Error(JSON.stringify({
		contract: "immune_brain/tool_failure/v1",
		...failure,
	} satisfies ToolFailureV1));
}

export function isToolFailureState(
	state: unknown,
): state is ToolFailureV1["state"] {
	return state === "blocked"
		|| state === "failed"
		|| state === "authority_conflict"
		|| state === "settlement_unknown";
}
