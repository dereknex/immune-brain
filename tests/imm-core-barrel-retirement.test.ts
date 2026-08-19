import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BARREL = "plugins/immune-brain/runtime/imm_core.ts";
const BARREL_ABS = resolve(ROOT, BARREL);

const EXPECTED_REPOINTS: Record<string, Record<string, string>> = {
	"tests/role-prompt-bridge.test.ts": {
		buildLoopAction: "loop_contract.ts",
		buildLoopRoleDispatch: "loop_contract.ts",
		determineRequiredReviewGates: "state_ledger.ts",
		INTERNAL_ROLE_PROMPTS: "role_prompt_bridge.ts",
		loadRolePrompt: "role_prompt_bridge.ts",
		normalizeAdvisoryReviewerOutput: "loop_contract.ts",
		normalizeArchitectureExplorerOutput: "loop_contract.ts",
		resolveLoopRoute: "loop_contract.ts",
		InternalRole: "role_prompt_bridge.ts",
	},
	"tests/loop-execution-routing.test.ts": {
		buildLoopAction: "loop_contract.ts",
		buildLoopRoleDispatch: "loop_contract.ts",
		INTERNAL_ROLE_PROMPTS: "role_prompt_bridge.ts",
		resolveLoopRoute: "loop_contract.ts",
		InternalRole: "role_prompt_bridge.ts",
	},
	"tests/advisory-dispatch-core.test.ts": {
		buildAdvisoryDelegationPrompt: "advisory_dispatch.ts",
		buildAdvisoryDispatchEnvelope: "advisory_dispatch.ts",
		readImmuneBrainConfig: "advisory_dispatch.ts",
		resolveAdvisoryModel: "advisory_dispatch.ts",
		resolveWorkflowStageModels: "advisory_dispatch.ts",
	},
	"tests/planner-ensemble-contract.test.ts": {
		buildBrainstormEnsembleDispatchEnvelopes: "advisory_dispatch.ts",
		buildBrainstormEnsembleRequest: "advisory_dispatch.ts",
		buildPlannerEnsembleRequest: "advisory_dispatch.ts",
		normalizeBrainstormEnsemblePacket: "advisory_dispatch.ts",
		normalizePiBrainstormAgentResults: "advisory_dispatch.ts",
		normalizePlannerEnsemblePacket: "advisory_dispatch.ts",
		readImmuneBrainConfig: "advisory_dispatch.ts",
	},
	"tests/pi-only-runtime-host-contract.test.ts": {
		buildAdvisoryDispatchEnvelope: "advisory_dispatch.ts",
		resolveImmuneBrainLocalRoot: "advisory_dispatch.ts",
	},
	"tests/plan-validation.test.ts": {
		parsePlan: "plan_core.ts",
		normalizePlan: "plan_core.ts",
		buildPlanSignature: "plan_core.ts",
		validatePlan: "plan_core.ts",
		parseDependsOn: "plan_core.ts",
		parseBrainstormManifestItems: "plan_core.ts",
		parseDiscoveryCache: "plan_core.ts",
		parseParallelProbes: "plan_core.ts",
		workflowProfileForTask: "plan_core.ts",
		compounderPolicyForTask: "plan_core.ts",
		PlanValidationError: "plan_core.ts",
	},
	"tests/fast-track-detection.test.ts": {
		planSupportsFastTrack: "plan_core.ts",
	},
	"tests/loop-child-output-contract.test.ts": {
		validateQaChildOutput: "loop_contract.ts",
		validateReviewChildOutput: "loop_contract.ts",
	},
	"tests/advisory-budget-contract.test.ts": {
		buildBrainstormEnsembleDispatchEnvelopes: "advisory_dispatch.ts",
		buildBrainstormEnsembleRequest: "advisory_dispatch.ts",
		buildPlannerEnsembleRequest: "advisory_dispatch.ts",
		normalizeBrainstormEnsemblePacket: "advisory_dispatch.ts",
		normalizePiBrainstormAgentResults: "advisory_dispatch.ts",
		normalizePlannerEnsemblePacket: "advisory_dispatch.ts",
	},
	"tests/immune-brain-config-runtime.test.ts": {
		readImmuneBrainConfig: "advisory_dispatch.ts",
		resolveImmuneBrainLocalPath: "advisory_dispatch.ts",
		resolveWorkflowStageModels: "advisory_dispatch.ts",
		resolveImmuneBrainLocalRoot: "advisory_dispatch.ts",
	},
	"tests/runtime-state.test.ts": {
		activateStep: "state_ledger.ts",
		beginWorkProbes: "state_ledger.ts",
		getCompletedSteps: "state_ledger.ts",
		recordExecution: "state_ledger.ts",
		recordWorkProbeEvidence: "state_ledger.ts",
		reviewPass: "state_ledger.ts",
		transitionStep: "state_ledger.ts",
		validateReadyForReviewEvidence: "state_ledger.ts",
		VALID_TRANSITIONS: "state_ledger.ts",
		ACTIVE_STATES: "state_ledger.ts",
		STEP_STATES: "state_ledger.ts",
		applyIntentionalFinish: "state_ledger.ts",
		buildRoadmapPhaseCompletionRecord: "state_ledger.ts",
		createEmptyStateLedger: "state_ledger.ts",
		normalizeCurrentIteration: "state_ledger.ts",
		validateTransitionState: "state_ledger.ts",
		utcNow: "state_ledger.ts",
	},
	"tests/imm-loop-review-lifecycle-state.test.ts": {
		buildReviewChangedFilesSignature: "state_ledger.ts",
		collectReviewChangedFiles: "state_ledger.ts",
		compounderRequirement: "state_ledger.ts",
		followUpBudgetState: "state_ledger.ts",
		getReviewPassForChangedFiles: "state_ledger.ts",
		normalizeCurrentIteration: "state_ledger.ts",
		recordReviewPass: "state_ledger.ts",
	},
	"tests/handoff-scope-exclusion.test.ts": {
		captureGitWorkspaceSnapshot: "workspace_scope.ts",
	},
	"tests/handoff-projection.test.ts": {
		applyHandoffState: "handoff.ts",
		HANDOFF_END_MARKER: "handoff.ts",
		HANDOFF_START_MARKER: "handoff.ts",
		renderHandoffState: "handoff.ts",
	},
	"tests/pi-brainstorm-agent-result-contract.test.ts": {
		buildBrainstormEnsembleRequest: "advisory_dispatch.ts",
		normalizePiBrainstormAgentResults: "advisory_dispatch.ts",
	},
	"plugins/immune-brain/tests/review-gates.test.ts": {
		determineRequiredReviewGates: "state_ledger.ts",
	},
	"tests/heal-activation.test.ts": {
		validateActivationMode: "activation.ts",
		resolveActivationMode: "activation.ts",
		buildSoloPlan: "activation.ts",
	},
};

const TOKEN_SCAN_PATHS = [
	"plugins/immune-brain/runtime/commands/kernel.ts",
];

function listFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map((entry) => resolve(dir, typeof entry === "string" ? entry : entry.toString()))
		.filter((abs) => statSync(abs).isFile());
}

function runtimeImports(source: string): Array<{ spec: string; names: string[] }> {
	return [...source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)]
		.map((match) => ({
			spec: match[2],
			names: match[1]
				.split(",")
				.map((part) => part.replace(/\btype\b/g, "").replace(/\sas\s+\w+/g, "").trim())
				.filter(Boolean),
		}))
		.filter((entry) => entry.spec.includes("/runtime/") || /\/(activation|advisory_dispatch|handoff|loop_contract|plan_core|role_prompt_bridge|state_ledger|workspace_scope)(?:\.ts)?$/.test(entry.spec));
}

describe("imm_core barrel retirement", () => {
	test("the barrel file is gone and no source imports or path-asserts it", () => {
		expect(existsSync(BARREL_ABS)).toBe(false);

		const offenders: string[] = [];
		for (const abs of [...listFiles(resolve(ROOT, "tests")), ...listFiles(resolve(ROOT, "plugins/immune-brain"))]) {
			if (!abs.endsWith(".ts")) continue;
			const rel = relative(ROOT, abs).split(sep).join("/");
			if (rel.endsWith("imm-core-barrel-retirement.test.ts")) continue;
			const text = readFileSync(abs, "utf8");
			if (text.includes("runtime/imm_core") || /from\s+["'][^"']*imm_core["']/.test(text)) {
				offenders.push(rel);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("former barrel importers keep the same symbols from the defining modules", () => {
		const mismatches: string[] = [];
		for (const [rel, expected] of Object.entries(EXPECTED_REPOINTS)) {
			const source = readFileSync(resolve(ROOT, rel), "utf8");
			const imports = runtimeImports(source);
			const symbols = imports.flatMap((entry) => entry.names);
			const missing = Object.keys(expected).filter((name) => !symbols.includes(name));
			if (missing.length > 0) {
				mismatches.push(`${rel}: missing=${missing.join(",")}`);
				continue;
			}
			for (const [name, owner] of Object.entries(expected)) {
				const hit = imports.some((entry) =>
					entry.names.includes(name)
					&& (entry.spec.endsWith(`/${owner.replace(/\.ts$/, "")}`) || entry.spec.endsWith(`/${owner}`)),
				);
				if (!hit) mismatches.push(`${rel}: ${name} not imported from ${owner}`);
				const ownerSource = readFileSync(resolve(ROOT, "plugins/immune-brain/runtime", owner), "utf8");
				const exported = new RegExp(
					`export (?:async )?function ${name}\\b|export (?:const|class|type|interface) ${name}\\b`,
				).test(ownerSource);
				if (!exported) mismatches.push(`${rel}: ${name} is not exported from ${owner}`);
			}
		}
		expect(mismatches).toEqual([]);
	});

	test("pi-only token scans still cover remaining live runtime sources", () => {
		const contract = readFileSync(resolve(ROOT, "tests/pi-only-current-contracts.test.ts"), "utf8");
		expect(contract).not.toContain(BARREL);
		for (const path of TOKEN_SCAN_PATHS) {
			expect(contract).toContain(path);
			expect(existsSync(resolve(ROOT, path))).toBe(true);
		}
	});
});
