// A read-only Host notice for ordinary input while a Managed task is active in
// the workspace. It tells the model, and through it the user, that the task
// exists and what it is waiting for, so a fresh session does not commit or edit
// inside that task's scope blind. It never resumes the task: ordinary input
// stays host-native, and only an explicit `imm-run` entry continues it.
import { projectAssurance } from "../kernel/assurance_projection";
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
	let obligation = "unknown";
	let lifecycle = "unknown";
	let scope: string[] = [];
	try {
		const projection = await projectAssurance(root, taskId);
		if (!projection.error) {
			obligation = String(projection.projection.next_obligation);
			lifecycle = String(projection.projection.lifecycle);
		}
		scope = [...(readTaskRecordRaw(root, taskId).record?.intent_snapshot.scope_hint ?? [])];
	} catch {
		// The notice is advisory; an unreadable projection still names the task.
	}
	if (lifecycle === "done" || lifecycle === "stopped") return null;
	const shown = scope.slice(0, MAX_SCOPE_ENTRIES).join(", ") + (scope.length > MAX_SCOPE_ENTRIES ? ", ..." : "");
	return [
		`Immune-Brain: Managed task ${taskId} is active in this workspace (lifecycle ${lifecycle}, next obligation ${obligation}).`,
		"Ordinary input does not resume it, and another session may be running its assurance right now.",
		`Before committing or modifying files inside its scope${shown ? ` (${shown})` : ""}, read its status and tell the user that this task is active and what it is waiting for.`,
		"Only an explicit imm-run entry continues it.",
	].join(" ");
}
