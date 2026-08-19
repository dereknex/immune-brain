import { describe, expect, it } from "bun:test";
import {
	buildBrainstormEnsembleRequest,
	normalizePiBrainstormAgentResults,
} from "../plugins/immune-brain/runtime/advisory_dispatch";

const request = buildBrainstormEnsembleRequest({
	task_summary: "explicit brainstorm",
	brainstorm_risk: "explicit",
	config: {
		workflow_models: { brainstorm_ensemble: ["fast", "mid"] },
		subagent_models: { fast: "model-fast", mid: "model-mid" },
	},
});

describe("Pi Brainstorm agent result contract", () => {
	it("normalizes a legacy bounded child output into a parent-owned packet", () => {
		const result = normalizePiBrainstormAgentResults({
			request,
			results: request.candidates.map((candidate, index) => ({
				candidate_id: candidate.candidate_id,
				output: JSON.stringify({
					recommendations: [
						index === 0
							? "keep the child advisory-only"
							: "retain parent ownership",
					],
					open_questions: ["what evidence is still missing?"],
				}),
			})),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.fallback_reason);
		expect(result.packet.owner).toBe("imm-brainstorm");
		expect(result.packet.planner_handoff_owner).toBe("imm-planner");
		expect(result.packet.children_advisory_only).toBe(true);
	});

	it("rejects an unknown child result instead of merging it", () => {
		const result = normalizePiBrainstormAgentResults({
			request,
			results: [{ candidate_id: "unknown", output: {} }],
		});

		expect(result).toEqual({
			ok: false,
			host: "pi",
			fallback_reason: "unknown_candidate",
			candidate_id: "unknown",
		});
	});
});
