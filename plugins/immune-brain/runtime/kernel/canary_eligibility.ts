// v4 storage retirement: canary eligibility is now derived exclusively from
// Kernel owners. The readiness/evidence pipeline is retired; a task is
// eligible when its Git-tracked TaskIntent is readable and no Kernel owner
// (workspace, backend claim, TaskRecord v2, tombstone) blocks enrollment.

import type { ReadinessReport } from "./readiness";
import type { ReadinessEvidenceInput } from "./readiness_evidence";

export type WaivableGate = "observation_window_days";

export interface CanaryWaiver {
	gate: WaivableGate;
	task_id: string;
	reason: string;
	actor: string;
	confirmation_ref: string;
	expires_at: string;
	nonce: string;
}

export interface CanaryTaskIdentity {
	id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
}

export interface CanaryEligibilityInput {
	readiness?: ReadinessReport;
	evidence?: ReadinessEvidenceInput;
	task: CanaryTaskIdentity;
	waiver?: CanaryWaiver;
	now: string;
}

export interface CanaryEligibilityResult {
	eligible: boolean;
	waived_gates: WaivableGate[];
	unmet_non_waivable: string[];
	rejections: string[];
}

export function evaluateCanaryEligibility(input: CanaryEligibilityInput): CanaryEligibilityResult {
	const result: CanaryEligibilityResult = {
		eligible: false,
		waived_gates: [],
		unmet_non_waivable: [],
		rejections: [],
	};
	if (!input.task || !input.task.id || !input.task.intent_path) {
		result.rejections.push("task identity required");
		return result;
	}
	// A waiver is never honored after v4 storage retirement: no readiness
	// window exists to waive. Any waiver passed by a caller is rejected.
	if (input.waiver) result.rejections.push("waiver route retired");
	// Legacy readiness/evidence inputs are ignored (never authority); they
	// are accepted for caller compatibility only when absent or syntactically
	// valid, and never influence eligibility.
	if (
		input.readiness &&
		(input.readiness.status !== "candidate" &&
			input.readiness.status !== "collecting" &&
			input.readiness.status !== "blocked")
	) {
		result.rejections.push("readiness status invalid");
	}
	if (input.evidence && !["valid", "missing", "invalid"].includes(input.evidence.status)) {
		result.rejections.push("evidence status invalid");
	}
	result.eligible = result.rejections.length === 0;
	return result;
}
