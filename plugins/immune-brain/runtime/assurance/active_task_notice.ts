// A read-only Host notice for ordinary input while a Managed task is active in
// the workspace. It tells the model, and through it the user, that the task
// exists and what it is waiting for, so a fresh session does not commit or edit
// inside that task's scope blind. It never resumes the task: ordinary input
// stays host-native, and only an explicit `imm-run` entry continues it.
import { readTaskRecordRaw } from "../kernel/storage";
import { readActiveClaimTaskId } from "../unattended/batch_preflight";

const MAX_SCOPE_ENTRIES = 12;

export async function activeTaskNotice(root: string): Promise<string | null> {
	let taskId: string | null;
	try {
		taskId = readActiveClaimTaskId(root);
	} catch {
		return null;
	}
	if (!taskId) return null;
	// One TaskRecord read, no workspace diff: this runs on every prompt, and the
	// exact next obligation is what the model reads from `status` afterwards.
	let lifecycle = "unknown";
	let artifactState = "unknown";
	let scope: string[] = [];
	try {
		const record = readTaskRecordRaw(root, taskId).record;
		if (record) {
			lifecycle = record.lifecycle;
			artifactState = record.artifact_state;
			scope = [...record.intent_snapshot.scope_hint];
		}
	} catch {
		// The notice is advisory; an unreadable projection still names the task.
	}
	if (lifecycle === "done" || lifecycle === "stopped") return null;
	const shown = scope.slice(0, MAX_SCOPE_ENTRIES).join(", ") + (scope.length > MAX_SCOPE_ENTRIES ? ", ..." : "");
	return [
		`Immune-Brain: Managed task ${taskId} is active in this workspace (lifecycle ${lifecycle}, artifacts ${artifactState}).`,
		"Ordinary input does not resume it, and another session may be running its assurance right now.",
		`Before committing or modifying files inside its scope${shown ? ` (${shown})` : ""}, read its status and tell the user that this task is active and which obligation it is waiting on.`,
		"Only an explicit imm-run entry continues it.",
	].join(" ");
}
