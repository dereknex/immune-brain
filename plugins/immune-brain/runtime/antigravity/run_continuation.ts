// Antigravity Stop hook: payload parsing and rendering only. The decision is a
// host-core function over the task projection (Spec
// docs/specs/host-neutral-adapter-core.spec.md D9, D11).
//
// Interface: `antigravityRunContinuationHook`.
// Invariants: an active claim's projection decides whether Stop continues; a
// user-only wait always allows stop; a workspace without an active claim is untouched.
// Side Effects: reads the active claim and the Kernel projection.
// Verification: `bun test tests/antigravity-assurance-conformance.test.ts -t 'Run Continuation Hook'`.

import { readActiveClaimTaskId } from "../unattended/batch_preflight";
import { projectTaskStatus } from "../assurance/coordinator";
import { decideAutomatedStop } from "../host-core/run_continuation_session";
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

	return decideAutomatedStop(taskId, status.projection);
}
