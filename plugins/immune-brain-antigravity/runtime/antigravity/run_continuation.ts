import { readActiveClaimTaskId } from "../unattended/batch_preflight";
import { projectTaskStatus } from "../assurance/coordinator";
import type { AssuranceObligation } from "../kernel/types";
import type { AntigravityStopPayload } from "./lane_guard";

export async function antigravityRunContinuationHook(
	payload: AntigravityStopPayload,
): Promise<{ decision?: "continue"; reason?: string }> {
	const workspace = payload.workspacePaths?.[0] ?? process.cwd();

	const taskId = readActiveClaimTaskId(workspace);
	if (!taskId) {
		return {};
	}

	let status;
	try {
		status = await projectTaskStatus(workspace, taskId);
	} catch {
		return {};
	}

	if (!status || status.error || !status.projection) {
		return {};
	}

	const projection = status.projection;
	if (projection.lifecycle !== "active") {
		return {};
	}

	// If waiting on user, allow stop
	if (
		projection.next_obligation === "resolve_user_decision" ||
		projection.next_obligation === "revise_intent" ||
		projection.open_user_decision_count > 0 ||
		projection.unresolved_user_decision_ids.length > 0
	) {
		return {};
	}

	// Automated obligations that should continue the loop
	const automatedObligations: AssuranceObligation[] = [
		"run_qa",
		"run_review",
		"submit_assurance",
		"resolve_findings",
	];

	if (automatedObligations.includes(projection.next_obligation)) {
		return {
			decision: "continue",
			reason: `Task ${taskId} is active with next obligation: ${projection.next_obligation}. Please proceed.`,
		};
	}

	return {};
}
