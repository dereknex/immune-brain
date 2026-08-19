import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BARREL = "plugins/immune-brain/runtime/imm_core.ts";
const BARREL_ABS = resolve(ROOT, BARREL);

const EXPECTED_REPOINTS: Record<string, Record<string, string>> = {
	"tests/role-prompt-bridge.test.ts": {
		buildLoopAction: "loop_contract.ts",
		buildLoopRoleDispatch: "loop_contract.ts",
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
	"tests/state-ledger-migration.test.ts": {
		AUTHORITY_OBSERVATION_GENERATION_V2: "authority_commit_receipts.ts",
		AUTHORITY_OBSERVER_VERSION_V2: "authority_commit_receipts.ts",
		authorityStatePathIdentity: "authority_commit_receipts.ts",
		prepareAuthorityCommit: "authority_commit_receipts.ts",
		readAuthorityCommitReceipts: "authority_commit_receipts.ts",
		terminalizeAuthorityCommit: "authority_commit_receipts.ts",
		buildAutomaticObservationV2: "kernel/observation.ts",
		appendAutomaticObservationV2: "kernel/automatic_observations.ts",
		readAutomaticObservationsV2: "kernel/automatic_observations.ts",
		buildPlanSignature: "plan_core.ts",
		normalizePlan: "plan_core.ts",
		parsePlan: "plan_core.ts",
	},
	"tests/handoff-scope-exclusion.test.ts": {
		captureGitWorkspaceSnapshot: "workspace_scope.ts",
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
		.filter((entry) => entry.spec.includes("/runtime/") || entry.spec.startsWith("../plugins/immune-brain/runtime/"));
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
			if (text.includes("runtime/imm_core") || /from\s+["'][^"']*imm_core["']/.test(text)) offenders.push(rel);
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
