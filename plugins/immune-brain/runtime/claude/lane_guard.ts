// Claude Code hook decisions that are not Review observation. PreToolUse guard for batch Lanes: an Edit, Write, MultiEdit or
// NotebookEdit whose target resolves outside the Lane is denied before it
// runs, the same rule the Pi extension applies to `edit`/`write`. Bash is not
// intercepted. Outside a Lane the hook answers nothing and the tool runs as
// configured.
import { laneWriteRefusal } from "../unattended/lane_workspace";
import { activeTaskNotice } from "../assurance/active_task_notice";

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** The hook's stdout for one PreToolUse payload, or null to stay silent. */
export function laneGuardHookOutput(payload: Record<string, unknown>): string | null {
	if (payload.hook_event_name !== "PreToolUse" || !FILE_TOOLS.has(String(payload.tool_name))) return null;
	const input = (payload.tool_input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
	const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
	const refusal = laneWriteRefusal(cwd, input.file_path ?? input.notebook_path);
	if (!refusal) return null;
	return JSON.stringify({
		hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: refusal },
	});
}

/**
 * UserPromptSubmit: when the workspace has an active Managed task, add the
 * advisory notice as context. It never resumes the task.
 */
export async function activeTaskHookOutput(payload: Record<string, unknown>): Promise<string | null> {
	if (payload.hook_event_name !== "UserPromptSubmit") return null;
	const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
	const notice = await activeTaskNotice(cwd);
	if (!notice) return null;
	return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: notice } });
}
