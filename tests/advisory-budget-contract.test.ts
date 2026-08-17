import { describe, expect, it } from "bun:test";
import {
	buildBrainstormEnsembleDispatchEnvelopes,
	buildBrainstormEnsembleRequest,
	buildPlannerEnsembleRequest,
	normalizeBrainstormEnsemblePacket,
	normalizePiBrainstormAgentResults,
	normalizePlannerEnsemblePacket,
} from "../plugins/immune-brain/runtime/imm_core";

const config = {
	workflow_models: {
		brainstorm_ensemble: ["fast", "mid", "strong"],
		planner_ensemble: ["fast", "mid", "strong"],
	},
	subagent_models: {
		fast: "model-fast",
		mid: "model-mid",
		strong: "model-strong",
	},
};

describe("advisory packet budgets", () => {
	it("limits automatic candidates by risk while preserving explicit expansion", () => {
		expect(
			buildBrainstormEnsembleRequest({
				task_summary: "normal",
				brainstorm_risk: "normal",
				config,
			}).candidates,
		).toHaveLength(1);
		expect(
			buildBrainstormEnsembleRequest({
				task_summary: "elevated",
				brainstorm_risk: "elevated",
				config,
			}).candidates,
		).toHaveLength(2);
		expect(
			buildBrainstormEnsembleRequest({
				task_summary: "explicit",
				brainstorm_risk: "explicit",
				config,
			}).candidates,
		).toHaveLength(3);

		expect(
			buildPlannerEnsembleRequest({
				task_summary: "normal",
				planning_risk: "normal",
				config,
			}).candidates,
		).toHaveLength(1);
		expect(
			buildPlannerEnsembleRequest({
				task_summary: "elevated",
				planning_risk: "elevated",
				config,
			}).candidates,
		).toHaveLength(2);
		expect(
			buildPlannerEnsembleRequest({
				task_summary: "explicit",
				planning_risk: "explicit",
				config,
			}).candidates,
		).toHaveLength(3);
	});

	it("bounds Pi context and marks oversized brainstorm results as degraded", () => {
		const request = buildBrainstormEnsembleRequest({
			task_summary: "explicit",
			brainstorm_risk: "explicit",
			config: {
				...config,
				workflow_models: { brainstorm_ensemble: ["fast", "mid"] },
			},
		});
		const oversizedContext = "context ".repeat(1000);
		const envelopes = buildBrainstormEnsembleDispatchEnvelopes({
			request,
			task_summary: "task ".repeat(1000),
			shared_context_summary: oversizedContext,
		});

		expect(envelopes.ok).toBe(true);
		if (!envelopes.ok) throw new Error(envelopes.fallback_reason);
		expect(envelopes.envelopes).toHaveLength(2);
		for (const envelope of envelopes.envelopes) {
			const prompt = String(envelope.call.prompt);
			expect(prompt).toContain(
				"Result budget: max 3 entries per field; max 240 characters per entry",
			);
			expect(prompt.length).toBeLessThan(9000);
			expect(prompt).not.toContain(oversizedContext);
		}

		const result = normalizePiBrainstormAgentResults({
			request,
			results: request.candidates!.map((candidate) => ({
				candidate_id: candidate.candidate_id,
				output: {
					recommendations: Array.from({ length: 5 }, () => "r".repeat(300)),
					disagreements: ["d".repeat(300)],
					blockers: ["b".repeat(300)],
					open_questions: ["q".repeat(300)],
				},
			})),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.fallback_reason);
		expect(result.packet.truncated).toBe(true);
		expect(result.packet.degraded).toBe(true);
		expect(result.packet.budget.max_result_entries).toBe(3);
		expect(result.children[0].recommendations).toHaveLength(3);
		expect(
			result.children[0].recommendations.every((entry) => entry.length <= 240),
		).toBe(true);
		expect(result.children[0].truncated).toBe(true);
		expect(result.children[0].degraded).toBe(true);
		expect(result.packet.owner).toBe("imm-brainstorm");
		expect(result.packet.planner_handoff_owner).toBe("imm-planner");
	});

	it("bounds Planner packets without weakening planner ownership", () => {
		const packet = normalizePlannerEnsemblePacket([
			{
				candidate_id: "strong-risk",
				tier: "strong",
				recommendations: Array.from({ length: 5 }, () =>
					"recommendation ".repeat(30),
				),
				blockers: ["blocker ".repeat(30)],
			},
		]);

		expect(packet.owner).toBe("imm-planner");
		expect(packet.final_spec_and_plan_owner).toBe("imm-planner");
		expect(packet.children_advisory_only).toBe(true);
		expect(packet.truncated).toBe(true);
		expect(packet.degraded).toBe(true);
		expect(packet.budget.max_result_entries).toBe(3);
		expect(
			packet.agreement_evidence.every((entry) => entry.length <= 240),
		).toBe(true);
	});

	it("reapplies result budgets after ensemble aggregation", () => {
		const children = Array.from({ length: 3 }, (_, childIndex) => ({
			candidate_id: `candidate-${childIndex}`,
			tier: childIndex === 2 ? "strong" : childIndex === 1 ? "mid" : "fast",
			recommendations: ["shared-1", "shared-2", "shared-3"],
			disagreements: Array.from(
				{ length: 3 },
				(_, entryIndex) => `decision-${childIndex}-${entryIndex}`,
			),
			blockers: Array.from(
				{ length: 3 },
				(_, entryIndex) => `blocker-${childIndex}-${entryIndex}`,
			),
			open_questions: Array.from(
				{ length: 3 },
				(_, entryIndex) => `question-${childIndex}-${entryIndex}`,
			),
		}));

		const planner = normalizePlannerEnsemblePacket(children);
		const brainstorm = normalizeBrainstormEnsemblePacket(children);

		expect(planner.decision_criteria).toHaveLength(3);
		expect(planner.truncated).toBe(true);
		expect(planner.degraded).toBe(true);
		expect(brainstorm.decision_criteria).toHaveLength(3);
		expect(brainstorm.open_questions).toHaveLength(3);
		expect(brainstorm.truncated).toBe(true);
		expect(brainstorm.degraded).toBe(true);
	});
});
