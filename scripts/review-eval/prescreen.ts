import { decide } from "../../plugins/immune-brain/runtime/decision_model/decide.ts";
import type { DecideResult } from "../../plugins/immune-brain/runtime/decision_model/contract.ts";

export type Candidate = {
	id: string;
	evidence: { trigger: unknown; caller_chain: unknown; violated: unknown };
	disposition: string;
	weight: number;
};

type Decision = (state: Candidate["evidence"]) => Promise<DecideResult>;

/** The model ranks candidates only; its output is never a gold label. */
export async function prescreen(candidates: Candidate[], options: { root: string; enabled: boolean; decide?: Decision }) {
	const call = options.decide ?? ((state) => decide({ point: "a1_review_finding_prescreen", state }, {
		root: options.root, env: process.env, fetch: globalThis.fetch,
	}));
	const rows = await Promise.all(candidates.map(async (candidate) => {
		const result = options.enabled ? await call(candidate.evidence) : null;
		if (!result || result.status === "unavailable") return {
			id: candidate.id, probabilities: null, model: null, threshold_set_version: "a1/v0",
			path: "weight_rule" as const, selected: false, reason: result ? `unavailable:${result.reason}` : "disabled",
			weight: candidate.weight, uncertainty: 0, disagreement: false,
		};
		const envelope = result.envelope;
		return {
			id: candidate.id, probabilities: envelope.probabilities, model: envelope.model,
			threshold_set_version: envelope.threshold_set_version, path: "model" as const,
			selected: false, reason: "model_rank", weight: candidate.weight,
			uncertainty: 1 - Math.max(...Object.values(envelope.probabilities)),
			disagreement: (candidate.disposition === "resolved" && envelope.choice === "likely_false") ||
				(candidate.disposition === "refuted" && envelope.choice === "likely_true"),
		};
	}));
	if (rows.some((row) => row.path === "weight_rule")) {
		for (const row of rows) {
			if (row.path === "model") Object.assign(row, { probabilities: null, model: null, path: "weight_rule", reason: "incomplete_prescreen", uncertainty: 0, disagreement: false });
		}
	}
	rows.sort((a, b) => Number(b.disagreement) - Number(a.disagreement) || b.uncertainty - a.uncertainty || b.weight - a.weight || a.id.localeCompare(b.id, "en"));
	return rows.map(({ weight: _weight, uncertainty: _uncertainty, disagreement: _disagreement, ...row }, index) => ({ ...row, selected: index < 30 }));
}
