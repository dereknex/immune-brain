import { afterEach, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildBrainstormEnsembleDispatchEnvelopes,
	buildBrainstormEnsembleRequest,
	buildPlannerEnsembleRequest,
	normalizeBrainstormEnsemblePacket,
	normalizePiBrainstormAgentResults,
	normalizePlannerEnsemblePacket,
	readImmuneBrainConfig,
} from "../plugins/immune-brain/runtime/advisory_dispatch";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];

function read(rel: string): string {
	return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function tempHome(): string {
	const dir = mkdtempSync(join(tmpdir(), "imm-planner-"));
	temps.push(dir);
	return dir;
}

function write(path: string, content: string): void {
	mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
	writeFileSync(path, content);
}

afterEach(() => {
	while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("planner ensemble contract", () => {
	it("lets imm-planner request advisory candidates from workflow_models.planner_ensemble", () => {
		const request = buildPlannerEnsembleRequest({
			task_summary: "Plan a multi-host model dispatch workflow.",
			planning_risk: "explicit",
			config: {
				workflow_models: { planner_ensemble: ["fast", "mid", "strong"] },
				workflow_model_options: {
					planner_ensemble: { reasoning_effort: "high", verbosity: "low" },
				},
				subagent_models: {
					fast: "model-fast",
					mid: "model-mid",
					strong: "model-strong",
				},
			},
		});

		expect(request.dispatch).toBe(true);
		expect(request.stage).toBe("planner_ensemble");
		expect(request.candidates.map((c) => c.model)).toEqual([
			"model-fast",
			"model-mid",
			"model-strong",
		]);
		expect(request.candidates.map((c) => c.tier)).toEqual([
			"fast",
			"mid",
			"strong",
		]);
		expect(request.candidates.every((c) => c.advisory_only)).toBe(true);
		expect(request.candidates.every((c) => c.tool_policy === "no tools")).toBe(
			true,
		);
		expect(
			request.candidates.every(
				(c) => c.model_options?.reasoning_effort === "high",
			),
		).toBe(true);
		expect(
			request.candidates.every((c) => c.model_options?.verbosity === "low"),
		).toBe(true);
		expect(JSON.stringify(request)).not.toContain("plan_write");
		expect(JSON.stringify(request)).not.toContain("qa_closure");
	});

	it("normalizes agreement, disagreement, and strong-model blockers into a planner-owned packet", () => {
		const packet = normalizePlannerEnsemblePacket([
			{
				candidate_id: "fast-options",
				tier: "fast",
				recommendations: ["keep dispatch read-only", "use preset-first config"],
				disagreements: ["whether executor should use ensemble now"],
			},
			{
				candidate_id: "mid-plan",
				tier: "mid",
				recommendations: ["keep dispatch read-only", "use preset-first config"],
				disagreements: ["whether executor should use ensemble now"],
			},
			{
				candidate_id: "strong-risk",
				tier: "strong",
				recommendations: ["keep dispatch read-only"],
				blockers: ["verify no child can write Plans or close QA"],
			},
		]);

		expect(packet.owner).toBe("imm-planner");
		expect(packet.children_advisory_only).toBe(true);
		expect(packet.agreement_evidence).toEqual([
			"keep dispatch read-only",
			"use preset-first config",
		]);
		expect(packet.decision_criteria).toEqual([
			"whether executor should use ensemble now",
		]);
		expect(packet.risk_verification_requirements).toEqual([
			"verify no child can write Plans or close QA",
		]);
		expect(JSON.stringify(packet)).not.toContain("final_plan_writer:child");
	});

	it("does not fan out small plans by default", () => {
		const request = buildPlannerEnsembleRequest({
			task_summary: "Rename one config key.",
			planning_risk: "small",
			config: { workflow: { model_preset: "ensemble" } },
		});

		expect(request.dispatch).toBe(false);
		expect(request.fallback_reason).toBe("cost_scope_mismatch");
		expect(request.candidates).toEqual([]);
	});

	it("lets imm-brainstorm request advisory candidates from workflow_models.brainstorm_ensemble", () => {
		const request = buildBrainstormEnsembleRequest({
			task_summary: "Frame multi-model Brainstorm behavior.",
			brainstorm_risk: "explicit",
			config: {
				workflow_models: { brainstorm_ensemble: ["fast", "mid", "strong"] },
				subagent_models: {
					fast: "model-fast",
					mid: "model-mid",
					strong: "model-strong",
				},
			},
		});

		expect(request.dispatch).toBe(true);
		expect(request.stage).toBe("brainstorm_ensemble");
		expect(request.candidates.map((c) => c.model)).toEqual([
			"model-fast",
			"model-mid",
			"model-strong",
		]);
		expect(request.candidates.map((c) => c.role)).toEqual([
			"clarify_scope",
			"divergent_options",
			"risk_review",
		]);
		expect(request.candidates.every((c) => c.advisory_only)).toBe(true);
		expect(request.candidates.every((c) => c.tool_policy === "no tools")).toBe(
			true,
		);
		expect(JSON.stringify(request)).not.toContain("plan_write");
		expect(JSON.stringify(request)).not.toContain("qa_closure");
	});

	it("keeps small brainstorms solo by default", () => {
		const request = buildBrainstormEnsembleRequest({
			task_summary: "Clarify one label.",
			brainstorm_risk: "small",
			config: { workflow: { model_preset: "ensemble" } },
		});

		expect(request.dispatch).toBe(false);
		expect(request.fallback_reason).toBe("cost_scope_mismatch");
		expect(request.candidates).toEqual([]);
	});

	it("maps brainstorm ensemble candidates to Pi Agent envelopes", () => {
		const request = buildBrainstormEnsembleRequest({
			task_summary: "Frame multi-model Brainstorm behavior.",
			brainstorm_risk: "explicit",
			config: {
				workflow_models: { brainstorm_ensemble: ["fast", "mid"] },
				workflow_model_options: {
					brainstorm_ensemble: { reasoning_effort: "medium", verbosity: "low" },
				},
				subagent_models: {
					fast: "model-fast",
					mid: "model-mid",
				},
			},
		});

		const result = buildBrainstormEnsembleDispatchEnvelopes({
			request,
			task_summary: "Frame multi-model Brainstorm behavior.",
			shared_context_summary: "Brainstorm stays advisory-only.",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.fallback_reason);
		expect(result.envelopes.map((envelope) => envelope.primitive)).toEqual([
			"Agent",
			"Agent",
		]);
		expect(result.envelopes.map((envelope) => envelope.call.model)).toEqual([
			"model-fast",
			"model-mid",
		]);
		for (const envelope of result.envelopes) {
			expect(envelope.call).toMatchObject({
				subagent_type: "general-purpose",
				inherit_context: false,
				run_in_background: false,
			});
			expect(envelope.call.prompt).toContain("tool_policy: no tools");
			expect(envelope.call.prompt).toContain(
				"advisory-only; no code edits; no plan writes; no workflow-state mutation; no QA closure",
			);
			expect(envelope.call.prompt).toContain(
				`Brainstorm candidate role: ${envelope.role}`,
			);
			expect(envelope.call.prompt).toContain(
				"recommendations, disagreements, open_questions, blockers",
			);
			expect(envelope.routing_metadata?.model_options).toEqual({
				reasoning_effort: "medium",
				verbosity: "low",
			});
			expect(Object.keys(envelope.call)).not.toContain("readonly");
			expect(Object.keys(envelope.call)).not.toContain("reasoning_effort");
			expect(Object.keys(envelope.call)).not.toContain("verbosity");
		}
	});

	it("does not let callers force brainstorm envelopes into the background", () => {
		const request = buildBrainstormEnsembleRequest({
			task_summary: "Frame foreground dispatch.",
			brainstorm_risk: "elevated",
			config: {
				workflow_models: { brainstorm_ensemble: ["fast", "mid"] },
				subagent_models: { fast: "model-fast", mid: "model-mid" },
			},
		});

		const result = buildBrainstormEnsembleDispatchEnvelopes({
			request,
			task_summary: "Frame foreground dispatch.",
			run_in_background: true,
		} as Parameters<typeof buildBrainstormEnsembleDispatchEnvelopes>[0] & {
			run_in_background: boolean;
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.fallback_reason);
		expect(
			result.envelopes.every(
				(envelope) => envelope.call.run_in_background === false,
			),
		).toBe(true);
	});

	it("does not build brainstorm dispatch envelopes when dispatch is false", () => {
		const result = buildBrainstormEnsembleDispatchEnvelopes({
			request: {
				dispatch: false,
				fallback_reason: "config_disabled",
				candidates: [],
			},
			task_summary: "Frame multi-model Brainstorm behavior.",
		});

		expect(result).toEqual({
			ok: false,
			host: "pi",
			envelopes: [],
			fallback_reason: "config_disabled",
		});
	});

	it("normalizes Pi brainstorm Agent results into a brainstorm-owned packet", () => {
		const request = buildBrainstormEnsembleRequest({
			task_summary: "Frame multi-model Brainstorm behavior.",
			brainstorm_risk: "explicit",
			config: {
				workflow_models: { brainstorm_ensemble: ["fast", "mid", "strong"] },
				subagent_models: {
					fast: "model-fast",
					mid: "model-mid",
					strong: "model-strong",
				},
			},
		});

		const result = normalizePiBrainstormAgentResults({
			request,
			results: [
				{
					candidate_id: "brainstorm-clarify_scope",
					output: JSON.stringify({
						recommendations: [
							"reuse workflow stage resolver",
							"do not call providers in runtime",
						],
						disagreements: ["whether CLI exposure belongs in this slice"],
						open_questions: ["which host launches candidates"],
					}),
				},
				{
					candidate_id: "brainstorm-divergent_options",
					output: {
						recommendations: [
							"reuse workflow stage resolver",
							"do not call providers in runtime",
						],
						disagreements: ["whether CLI exposure belongs in this slice"],
						open_questions: ["which host launches candidates"],
					},
				},
				{
					candidate_id: "brainstorm-risk_review",
					output: JSON.stringify({
						recommendations: ["reuse workflow stage resolver"],
						blockers: ["verify Brainstorm cannot write Specs or Plans"],
					}),
				},
			],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.fallback_reason);
		expect(result.packet.owner).toBe("imm-brainstorm");
		expect(result.packet.children_advisory_only).toBe(true);
		expect(result.children.map((child) => child.tier)).toEqual([
			"fast",
			"mid",
			"strong",
		]);
		expect(result.packet.framing_evidence).toEqual([
			"reuse workflow stage resolver",
			"do not call providers in runtime",
		]);
		expect(result.packet.decision_criteria).toEqual([
			"whether CLI exposure belongs in this slice",
		]);
		expect(result.packet.open_questions).toEqual([
			"which host launches candidates",
		]);
		expect(result.packet.risk_verification_requirements).toEqual([
			"verify Brainstorm cannot write Specs or Plans",
		]);
		expect(result.packet.planner_handoff_owner).toBe("imm-planner");
	});

	it("rejects unknown, duplicate, and missing Pi brainstorm Agent results", () => {
		const request = buildBrainstormEnsembleRequest({
			task_summary: "Frame multi-model Brainstorm behavior.",
			brainstorm_risk: "explicit",
			config: {
				workflow_models: { brainstorm_ensemble: ["fast", "mid"] },
				subagent_models: { fast: "model-fast", mid: "model-mid" },
			},
		});

		expect(
			normalizePiBrainstormAgentResults({
				request,
				results: [
					{
						candidate_id: "brainstorm-clarify_scope",
						output: { recommendations: ["reuse resolver"] },
					},
					{
						candidate_id: "brainstorm-unknown",
						output: { recommendations: ["wrong child"] },
					},
				],
			}),
		).toEqual({
			ok: false,
			host: "pi",
			fallback_reason: "unknown_candidate",
			candidate_id: "brainstorm-unknown",
		});

		expect(
			normalizePiBrainstormAgentResults({
				request,
				results: [
					{
						candidate_id: "brainstorm-clarify_scope",
						output: { recommendations: ["reuse resolver"] },
					},
					{
						candidate_id: "brainstorm-clarify_scope",
						output: { recommendations: ["duplicated"] },
					},
					{
						candidate_id: "brainstorm-divergent_options",
						output: { recommendations: ["reuse resolver"] },
					},
				],
			}),
		).toEqual({
			ok: false,
			host: "pi",
			fallback_reason: "duplicate_candidate_result",
			candidate_id: "brainstorm-clarify_scope",
		});

		expect(
			normalizePiBrainstormAgentResults({
				request,
				results: [
					{
						candidate_id: "brainstorm-clarify_scope",
						output: { recommendations: ["reuse resolver"] },
					},
				],
			}),
		).toEqual({
			ok: false,
			host: "pi",
			fallback_reason: "missing_candidate_result",
			candidate_id: "brainstorm-divergent_options",
		});
	});

	it("keeps failed Pi brainstorm Agent children as blockers", () => {
		const request = buildBrainstormEnsembleRequest({
			task_summary: "Frame multi-model Brainstorm behavior.",
			brainstorm_risk: "explicit",
			config: {
				workflow_models: { brainstorm_ensemble: ["fast", "strong"] },
				subagent_models: { fast: "model-fast", strong: "model-strong" },
			},
		});

		const result = normalizePiBrainstormAgentResults({
			request,
			results: [
				{
					candidate_id: "brainstorm-clarify_scope",
					output: { recommendations: ["reuse resolver"] },
				},
				{
					candidate_id: "brainstorm-divergent_options",
					error: "child Agent failed before returning JSON",
				},
			],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.fallback_reason);
		expect(
			result.children.find(
				(child) => child.candidate_id === "brainstorm-divergent_options",
			)?.blockers,
		).toEqual(["child Agent failed before returning JSON"]);
		expect(result.packet.risk_verification_requirements).toEqual([
			"child Agent failed before returning JSON",
		]);
	});

	it("normalizes brainstorm agreement, disagreement, questions, and strong blockers into a brainstorm-owned packet", () => {
		const packet = normalizeBrainstormEnsemblePacket([
			{
				candidate_id: "fast-scope",
				tier: "fast",
				recommendations: [
					"reuse workflow stage resolver",
					"do not call providers in runtime",
				],
				disagreements: ["whether CLI exposure belongs in this slice"],
				open_questions: ["which host launches candidates"],
			},
			{
				candidate_id: "mid-options",
				tier: "mid",
				recommendations: [
					"reuse workflow stage resolver",
					"do not call providers in runtime",
				],
				disagreements: ["whether CLI exposure belongs in this slice"],
				open_questions: ["which host launches candidates"],
			},
			{
				candidate_id: "strong-risk",
				tier: "strong",
				recommendations: ["reuse workflow stage resolver"],
				blockers: ["verify Brainstorm cannot write Specs or Plans"],
			},
		]);

		expect(packet.owner).toBe("imm-brainstorm");
		expect(packet.children_advisory_only).toBe(true);
		expect(packet.framing_evidence).toEqual([
			"reuse workflow stage resolver",
			"do not call providers in runtime",
		]);
		expect(packet.decision_criteria).toEqual([
			"whether CLI exposure belongs in this slice",
		]);
		expect(packet.open_questions).toEqual(["which host launches candidates"]);
		expect(packet.risk_verification_requirements).toEqual([
			"verify Brainstorm cannot write Specs or Plans",
		]);
		expect(packet.planner_handoff_owner).toBe("imm-planner");
	});

	it("uses agent-local workflow_models for planner ensemble candidates", () => {
		const home = tempHome();
		write(
			join(home, ".pi/agent/immune-brain/config.toml"),
			'[workflow_models]\nplanner_ensemble = ["fast", "strong"]\n\n[subagent_models]\nfast = "file-fast"\nstrong = "file-strong"\n',
		);

		const request = buildPlannerEnsembleRequest({
			task_summary: "Plan host-local config routing.",
			planning_risk: "elevated",
			config: readImmuneBrainConfig({ home_dir: home })
				.config,
		});

		expect(request.dispatch).toBe(true);
		expect(request.candidates.map((candidate) => candidate.model)).toEqual([
			"file-fast",
			"file-strong",
		]);
	});

	it("documents planner-owned ensemble boundaries in source and packaged planner contracts", () => {
		for (const rel of [
			"plugins/immune-brain/skills/imm-planner/SKILL.md",
			"plugins/immune-brain/dist/imm-planner.md",
		]) {
			const content = read(rel);
			expect(content).toContain("planner ensemble");
			expect(content).toContain("workflow_models.planner_ensemble");
			expect(content).toContain("advisory-only");
			expect(content).toContain("final Spec and Plan");
			expect(content).toContain("Agreement becomes evidence");
			expect(content).toContain("Disagreement becomes decision criteria");
			expect(content).toContain("strong-model blockers");
		}
	});

	it("documents brainstorm-owned ensemble boundaries in source and packaged brainstorm contracts", () => {
		for (const rel of [
			"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
			"plugins/immune-brain/dist/imm-brainstorm.md",
		]) {
			const content = read(rel);
			expect(content).toContain("Brainstorm ensemble");
			expect(content).toContain("workflow_models.brainstorm_ensemble");
			expect(content).toContain("advisory-only");
			expect(content).toContain(
				"Final Spec and Plan authority stays with `imm-planner`",
			);
			expect(content).toContain(
				"Pi's adapter may consume `brainstorm_ensemble` dispatch JSON",
			);
			expect(content).not.toContain("Pi host adapters");
			expect(content).toContain("does not transfer framing authority");
			expect(content).toContain(
				"mutate state, or own final Spec/Plan authority",
			);
			expect(content).toContain("Agreement becomes framing evidence");
			expect(content).toContain("Disagreement becomes decision criteria");
			expect(content).toContain("strong-model blockers");
		}

		const packaged = read("plugins/immune-brain/dist/imm-brainstorm.md");
		expect(packaged).toContain("one foreground Agent at a time");
		expect(packaged).toContain("direct result");
		expect(packaged).toContain("remaining dispatch budget");
		expect(packaged).not.toContain("Pi itself may launch those subagents");
		expect(packaged).not.toContain("poll background work");
	});
});
