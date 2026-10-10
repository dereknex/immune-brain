import { describe, expect, it, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	benchmarkPrompt,
	checkWorkflowBehaviorEvidence,
	main as benchmarkMain,
	sha256File,
	verifyWorkflowBehaviorEvidenceFiles,
	type WorkflowEvidenceCheckInput,
} from "../scripts/benchmark_eval";

type Document = Record<string, unknown>;
type CohortFixture = Parameters<typeof benchmarkPrompt>[1];

const repoRoot = resolve(import.meta.dir, "..");
const cohortPath = "tests/fixtures/workflow-decision-closure-benchmark.json";
const evidencePath = "tests/fixtures/workflow-decision-closure-evidence.json";
const historicalPlannerPath = "tests/fixtures/workflow-decision-closure-sources/imm-planner.md";
const plannerPath = "plugins/immune-brain/dist/imm-planner.md";
const historicalBrainstormPath = "tests/fixtures/workflow-decision-closure-sources/imm-brainstorm.md";
const brainstormPath = "plugins/immune-brain/dist/imm-brainstorm.md";

// The cohort predates later contract changes. Re-hash preserved source bytes,
// never replace the measured digest with a digest of today's contract.
function measuredSource(path: string): string {
	const preserved = path === plannerPath ? historicalPlannerPath
		: path === brainstormPath ? historicalBrainstormPath
		: path;
	return resolve(repoRoot, preserved);
}

const readJson = (path: string): Document =>
	JSON.parse(readFileSync(resolve(repoRoot, path), "utf8")) as Document;

const cohort = readJson(cohortPath);
const evidence = readJson(evidencePath);
const legacyFixture = readJson("tests/fixtures/immune-brain-benchmark.json");

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

/** Re-hash every source the evidence and the cohort require, as the offline verifier does. */
function bindingsFor(
	document: Document,
	cohortDocument: Document = cohort,
): Record<string, string> {
	const paths = new Set<string>([cohortPath]);
	for (const path of (
		(cohortDocument.evidence as Document | undefined)?.required_bindings as
			| string[]
			| undefined
	) ?? [])
		paths.add(path);
	const bindings = document.source_bindings as Document | undefined;
	for (const key of ["spec", "fixture", "runner_source"]) {
		const path = (bindings?.[key] as Document | undefined)?.path;
		if (typeof path === "string") paths.add(path);
	}
	for (const entry of (bindings?.contracts as Document[] | undefined) ?? []) {
		if (typeof entry.path === "string") paths.add(entry.path);
	}
	const computed: Record<string, string> = {};
	for (const path of paths) {
		const hex = sha256File(measuredSource(path));
		if (hex) computed[path] = hex;
	}
	return computed;
}

function historicalSourceRoot(): string {
	const directory = mkdtempSync(join(tmpdir(), "imm-historical-evidence-"));
	temporaryDirectories.push(directory);
	for (const path of [...Object.keys(bindingsFor(evidence)), evidencePath]) {
		const target = resolve(directory, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, readFileSync(measuredSource(path)));
	}
	return directory;
}

function inputFor(
	document: Document,
	cohortDocument: Document = cohort,
): WorkflowEvidenceCheckInput {
	return {
		evidence: document,
		cohort: cohortDocument,
		cohort_path: cohortPath,
		bindings: bindingsFor(document, cohortDocument),
	};
}

function codesFor(
	document: Document,
	cohortDocument?: Document,
): string[] {
	return checkWorkflowBehaviorEvidence(inputFor(document, cohortDocument))
		.reason_codes;
}

function withValue(
	document: Document,
	path: string[],
	value: unknown,
): Document {
	const next = structuredClone(document);
	let cursor: Document = next;
	for (const key of path.slice(0, -1)) cursor = cursor[key] as Document;
	cursor[path[path.length - 1] as string] = value;
	return next;
}

function withoutKey(document: Document, path: string[]): Document {
	const next = structuredClone(document);
	let cursor: Document = next;
	for (const key of path.slice(0, -1)) cursor = cursor[key] as Document;
	delete cursor[path[path.length - 1] as string];
	return next;
}

function scenarios(document: Document): Document[] {
	return document.scenarios as Document[];
}

function clone(document: Document): Document {
	return structuredClone(document);
}

/** Keep the offline CLI result out of the test transcript. */
async function quietly(run: () => Promise<number>): Promise<number> {
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((_chunk: unknown) => true) as typeof process.stdout.write;
	try {
		return await run();
	} finally {
		process.stdout.write = original;
	}
}

function expectCodes(codes: string[], expected: string[]): void {
	for (const code of expected) expect(codes).toContain(code);
}

describe("workflow behavior evidence: offline verifier is model-free", () => {
	it("is a synchronous pure check over already-read data", () => {
		expect(typeof checkWorkflowBehaviorEvidence).toBe("function");
		expect(checkWorkflowBehaviorEvidence.length).toBe(1);
		const outcome = checkWorkflowBehaviorEvidence(inputFor(evidence));
		expect(outcome instanceof Promise).toBe(false);
		expect(outcome.ok).toBe(true);
		expect(outcome.issues).toEqual([]);
	});

	it("accepts historical cohort evidence against independently re-hashed measured sources", () => {
		const directory = historicalSourceRoot();
		const outcome = verifyWorkflowBehaviorEvidenceFiles(
			directory,
			evidencePath,
			cohortPath,
		);
		expect(outcome.issues).toEqual([]);
		expect(outcome).toEqual({ ok: true, issues: [], reason_codes: [] });
	});

	it("rejects tampering with preserved historical source bytes", () => {
		const directory = historicalSourceRoot();
		writeFileSync(resolve(directory, plannerPath), "tampered historical Planner\n");
		expect(verifyWorkflowBehaviorEvidenceFiles(directory, evidencePath, cohortPath).reason_codes)
			.toEqual(["fingerprint_drift", "required_binding_missing"]);
	});

	it("re-hashes every bound source from disk instead of trusting declared hashes", () => {
		const declared = (
			(evidence.source_bindings as Document).fixture as Document
		).sha256 as string;
		expect(declared.replace("sha256:", "")).toBe(
			sha256File(resolve(repoRoot, cohortPath)),
		);
		expect(sha256File(resolve(repoRoot, "does/not/exist.json"))).toBeUndefined();
	});
});

describe("workflow behavior evidence: cohort fixture controls", () => {
	it("rejects a cohort that is not a sanitized serial multi-turn cohort", () => {
		const cases: [string, string[], unknown][] = [
			["kind", ["kind"], "plugin-eval-benchmark-v1"],
			["schemaVersion", ["schemaVersion"], 1],
			["targetName", ["targetName"], ""],
			["provider", ["runner", "provider"], undefined],
			["subagentType", ["runner", "subagentType"], undefined],
			["resultTransport", ["runner", "resultTransport"], "polling"],
			["serial", ["runner", "serial"], false],
			["parallel", ["runner", "parallel"], true],
			["isolated", ["runner", "isolated"], false],
			[
				"requiresInteractiveHost",
				["runner", "requiresInteractiveHost"],
				true,
			],
			["turnsPerScenario", ["runner", "turnsPerScenario"], 1],
			["attemptsPerScenario", ["runner", "attemptsPerScenario"], 3],
			["automaticRetry", ["runner", "automaticRetry"], true],
			[
				"allowScenarioChildSpawning",
				["runner", "allowScenarioChildSpawning"],
				true,
			],
			["metrics", ["metrics", "required"], []],
			["cost", ["metrics", "cost"], undefined],
			["claim_scope", ["evidence", "claim_scope"], "contract_only"],
			["required_bindings", ["evidence", "required_bindings"], []],
			["required_bindings", ["evidence", "required_bindings"], undefined],
		];
		for (const [label, path, value] of cases)
			expectCodes(codesFor(evidence, withValue(cohort, path, value)), [
				"cohort_fixture_invalid",
			]);
	});

	it("rejects cohort scenarios that are not bounded multi-turn criteria", () => {
		const singleTurn = withValue(cohort, ["scenarios"], [
			{
				id: "one",
				title: "t",
				purpose: "p",
				userInput: "u",
				turns: ["only one turn"],
				successChecklist: ["criterion", "criterion"],
			},
		]);
		expectCodes(codesFor(evidence, singleTurn), [
			"cohort_fixture_invalid",
			"scenario_missing",
		]);

		const thinCriteria = withValue(cohort, ["scenarios"], [
			{
				id: "one",
				title: "t",
				purpose: "p",
				userInput: "u",
				turns: ["a", "b"],
				successChecklist: ["only one criterion"],
			},
		]);
		expectCodes(codesFor(evidence, thinCriteria), ["cohort_fixture_invalid"]);

		const duplicatedIds = clone(cohort);
		duplicatedIds.scenarios = [
			...(scenarios(cohort) as Document[]),
			(scenarios(cohort) as Document[])[0] as Document,
		];
		expectCodes(codesFor(evidence, duplicatedIds), ["cohort_fixture_invalid"]);
	});
});

describe("workflow behavior evidence: live evidence and claim bounds", () => {
	it("rejects contract-only or simulated evidence", () => {
		expectCodes(
			codesFor(withValue(evidence, ["evidence_kind"], "contract_only_simulation")),
			["live_evidence_absent"],
		);
		expectCodes(
			codesFor(withValue(evidence, ["evidence_kind"], "deterministic_harness")),
			["live_evidence_absent"],
		);
	});

	it("rejects an untrusted metric source that is really a self-reported footer", () => {
		expectCodes(
			codesFor(
				withValue(evidence, ["metrics", "reported_tokens_source"], "child_footer"),
			),
			["metrics_source_untrusted"],
		);
		expectCodes(
			codesFor(
				withValue(
					evidence,
					["metrics", "reported_tokens_source"],
					"deterministic_harness",
				),
			),
			["metrics_source_untrusted"],
		);
	});

	it("rejects a contract or claim scope mismatch", () => {
		expectCodes(
			codesFor(
				withValue(
					evidence,
					["contract"],
					"immune_brain/workflow_behavior_evidence/v0",
				),
			),
			["evidence_contract_mismatch"],
		);
		expectCodes(
			codesFor(withoutKey(evidence, ["contract"])),
			["evidence_contract_mismatch"],
		);
		expectCodes(
			codesFor(withValue(evidence, ["claim_scope"], "universal_host_correctness")),
			["claim_scope_mismatch"],
		);
		expectCodes(codesFor(withoutKey(evidence, ["claim"])), [
			"claim_scope_mismatch",
		]);
	});

	it("rejects a claim that hides one of its required bounds", () => {
		const bounds: [RegExp, string][] = [
			[/universal/i, "universal"],
			[/attempt|retry/i, "attempt"],
			[/unknown|never zero/i, "unknown"],
			[/commit|github|enrollment/i, "commit"],
		];
		const limits = evidence.claim_limits as string[];
		for (const [pattern, label] of bounds) {
			const dropped = limits.filter((limit) => !pattern.test(limit));
			expectCodes(codesFor(withValue(evidence, ["claim_limits"], dropped)), [
				"claim_limit_missing",
			]);
			expect(limits.some((limit) => pattern.test(limit))).toBe(true);
			expect(label.length).toBeGreaterThan(0);
		}
		expectCodes(
			codesFor(withValue(evidence, ["claim_limits"], ["one", "two"])),
			["claim_limit_missing"],
		);
	});

	it("rejects an unreadable recording timestamp", () => {
		expectCodes(codesFor(withValue(evidence, ["recorded_at"], "someday")), [
			"provenance_untrusted",
		]);
		expectCodes(codesFor(withoutKey(evidence, ["recorded_at"])), [
			"provenance_untrusted",
		]);
	});
});

describe("workflow behavior evidence: runner, budget and seams", () => {
	it("rejects a runner that differs from the disclosed cohort model", () => {
		const cases: [string[], unknown][] = [
			[["runner", "model"], "antigravity/gemini-9.9-pro"],
			[["runner", "provider"], "other-provider"],
			[["runner", "subagent_type"], "Explore"],
			[["runner", "model_selection_evidence"], undefined],
			[["runner", "resolved_before_runs"], false],
			[["runner", "host"], undefined],
		];
		for (const [path, value] of cases)
			expectCodes(codesFor(withValue(evidence, path, value)), [
				"runner_identity_drift",
			]);
	});

	it("rejects fan-out, retry or turns that the cohort forbids", () => {
		const cases: [string[], unknown][] = [
			[["runner", "dispatch"], "background_job"],
			[["runner", "serial"], false],
			[["runner", "parallel_dispatch"], true],
			[["runner", "scenario_child_spawning"], true],
			[["runner", "automatic_retry"], true],
			[["runner", "isolated"], false],
			[["runner", "attempts_per_scenario"], 2],
			[["runner", "turns_per_scenario"], 1],
		];
		for (const [path, value] of cases)
			expectCodes(codesFor(withValue(evidence, path, value)), [
				"dispatch_contract_drift",
			]);
	});

	it("rejects an undeclared or exceeded call budget", () => {
		const cases: [string[], unknown][] = [
			[["runner", "authorized_budget", "declared_before_launch"], false],
			[["runner", "authorized_budget", "max_scenario_dispatches"], 11],
			[["runner", "authorized_budget", "max_attempts_per_scenario"], 2],
			[["runner", "authorized_budget", "scope"], undefined],
			[["runner", "authorized_budget"], undefined],
		];
		for (const [path, value] of cases)
			expectCodes(codesFor(withValue(evidence, path, value)), [
				"budget_missing_or_drifted",
			]);
	});

	it("rejects a scenario that performed a real commit, GitHub write or Enrollment", () => {
		const cases: [string[], unknown][] = [
			[["seams", "real_commit_performed"], true],
			[["seams", "real_github_write_performed"], true],
			[["seams", "real_enrollment_performed"], true],
			[["seams", "authority"], "real"],
			[["seams", "publication"], undefined],
		];
		for (const [path, value] of cases)
			expectCodes(codesFor(withValue(evidence, path, value)), [
				"real_effect_seam_violation",
			]);
	});

	it("records unavailable cost and telemetry as unknown, never as zero", () => {
		const cases: [string[], unknown][] = [
			[["metrics", "cost", "status"], "zero"],
			[["metrics", "cost", "status"], "reported"],
			[["metrics", "cost", "reason"], undefined],
			[["metrics", "cost"], undefined],
			[["metrics", "runtime_advisory_metrics", "status"], "zero"],
			[["metrics", "runtime_advisory_metrics", "reason"], undefined],
			[["metrics", "host_metrics_available"], []],
		];
		for (const [path, value] of cases) {
			const codes = codesFor(withValue(evidence, path, value));
			expect(
				codes.includes("cost_not_disclosed") ||
					codes.includes("metrics_provenance_drift"),
			).toBe(true);
		}
	});
});

describe("workflow behavior evidence: source binding drift", () => {
	/** Flip the final hex nibble so a drift is real even when the hash ends in 0. */
	const driftHash = (hash: string): string =>
		`${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`;

	it("rejects a drifted fingerprint on any bound source", () => {
		const driftTargets: string[][] = [
			["source_bindings", "spec", "sha256"],
			["source_bindings", "fixture", "sha256"],
			["source_bindings", "runner_source", "sha256"],
			["source_bindings", "contracts", "0", "sha256"],
		];
		for (const path of driftTargets) {
			const current = path.reduce<unknown>(
				(value, key) =>
					(value as Record<string, unknown> | undefined)?.[key] as unknown,
				evidence,
			) as string;
			expect(driftHash(current)).not.toBe(current);
			expectCodes(codesFor(withValue(evidence, path, driftHash(current))), [
				"fingerprint_drift",
			]);
		}
	});

	it("rejects a bound path that cannot be re-hashed or declares no hash", () => {
		expectCodes(
			codesFor(withValue(evidence, ["source_bindings", "spec", "path"], "docs/specs/gone.md")),
			["fingerprint_drift"],
		);
		expectCodes(
			codesFor(withValue(evidence, ["source_bindings", "spec", "sha256"], "not-a-hash")),
			["fingerprint_drift"],
		);
		expectCodes(
			codesFor(withoutKey(evidence, ["source_bindings", "contracts", "0", "path"])),
			["fingerprint_drift"],
		);
	});

	it("rejects verifying against a cohort fixture other than the bound one", () => {
		const swapped = withValue(
			evidence,
			["source_bindings", "fixture", "path"],
			evidencePath,
		);
		const hash = sha256File(resolve(repoRoot, evidencePath)) as string;
		(
			(swapped.source_bindings as Document).fixture as Document
		).sha256 = `sha256:${hash}`;
		expectCodes(codesFor(swapped), [
			"binding_target_drift",
			"required_binding_missing",
		]);
	});

	it("rejects required provenance that disappears or is substituted", () => {
		const noContracts = withoutKey(evidence, ["source_bindings", "contracts"]);
		expect(codesFor(noContracts)).toContain("required_binding_missing");

		const dropped = clone(evidence);
		(dropped.source_bindings as Document).contracts = (
			(dropped.source_bindings as Document).contracts as Document[]
		).slice(1);
		expect(codesFor(dropped)).toContain("required_binding_missing");

		const substituted = clone(evidence);
		const first = (
			(substituted.source_bindings as Document).contracts as Document[]
		)[0] as Document;
		first.path = "README.md";
		first.sha256 = `sha256:${sha256File(resolve(repoRoot, "README.md"))}`;
		expectCodes(codesFor(substituted), ["required_binding_missing"]);
	});

	it("rejects bindings that do not disclose their non-Git-HEAD basis", () => {
		expectCodes(codesFor(withoutKey(evidence, ["source_bindings", "note"])), [
			"provenance_untrusted",
		]);
	});

	it("rejects an unverifiable execution-time runner claim", () => {
		// Live dispatch is Parent-mediated, so no script executes during a scenario.
		// Any declared execution-time runner revision is therefore an unverifiable
		// claim about bytes no offline check can tie to the cohort, and is rejected.
		expectCodes(
			codesFor(
				withValue(evidence, ["source_bindings", "runner_source_at_recording"], {
					path: "scripts/benchmark_eval.ts",
					sha256: "sha256:" + "a".repeat(64),
				}),
			),
			["provenance_untrusted"],
		);
	});

	it("binds the offline verifier and discloses parent-mediated dispatch", () => {
		const bindings = evidence.source_bindings as Document;
		const delivered = bindings.runner_source as Document;
		// The one bound runner is the offline verifier, re-hashed from disk.
		expect(delivered.sha256).toBe(
			`sha256:${sha256File(resolve(repoRoot, delivered.path as string))}`,
		);
		expect(bindings.runner_source_at_recording).toBeUndefined();
		// Dispatch provenance must name the real foreground path.
		expect(String((evidence.provenance as Document).dispatch)).toMatch(/foreground/i);
	});

	it("rejects dispatch provenance that hides or misstates the foreground path", () => {
		for (const dispatch of [
			undefined,
			"automated harness dispatched every scenario through a detached subprocess",
			"a script spawned each scenario",
		]) {
			expectCodes(
				codesFor(
					withValue(evidence, ["provenance", "dispatch"], dispatch),
				),
				["provenance_untrusted"],
			);
		}
	});
});

describe("workflow behavior evidence: coverage, duplicates and failures", () => {
	it("rejects evidence that is not a JSON object", () => {
		expect(
			checkWorkflowBehaviorEvidence({ ...inputFor(evidence), evidence: null })
				.reason_codes,
		).toEqual(["evidence_unreadable"]);
		expect(
			checkWorkflowBehaviorEvidence({ ...inputFor(evidence), cohort: "x" })
				.reason_codes,
		).toEqual(["cohort_unreadable"]);
	});

	it("fails closed on a missing scenario", () => {
		const trimmed = clone(evidence);
		scenarios(trimmed).shift();
		const summary = trimmed.cohort_summary as Document;
		summary.scenarios_completed = 9;
		summary.scenarios_passed = 7;
		summary.scenarios_failed = 2;
		summary.scenarios_missing = 1;
		summary.attempts_total = 9;
		// The two surviving failed scenarios still carry their own disclosures.
		summary.deviations_recorded = (
			summary.deviations_recorded as Document[]
		).filter((record) =>
			[
				"partial-publication-receipt-recovery",
				"bounded-discovery-and-partial-edit-recovery",
			].includes(record.scenario_id as string),
		);
		expect(codesFor(trimmed)).toEqual(["scenario_missing"]);
	});

	it("fails closed on a duplicated scenario", () => {
		const doubled = clone(evidence);
		const first = scenarios(doubled)[0] as Document;
		scenarios(doubled).push(structuredClone(first));
		const summary = doubled.cohort_summary as Document;
		summary.scenarios_duplicated = 1;
		summary.attempts_total = 11;
		expectCodes(codesFor(doubled), ["scenario_duplicate"]);
	});

	it("fails closed on an unexpected scenario id", () => {
		const renamed = clone(evidence);
		(scenarios(renamed)[0] as Document).scenario_id = "not-in-the-cohort";
		expectCodes(codesFor(renamed), [
			"scenario_unexpected",
			"scenario_missing",
			"summary_count_drift",
		]);
	});

	it("fails closed on a second attempt or a non-completed scenario", () => {
		expectCodes(
			codesFor(withValue(evidence, ["scenarios", "0", "attempt"], 2)),
			["scenario_attempt_drift", "summary_count_drift"],
		);
		expectCodes(
			codesFor(withValue(evidence, ["scenarios", "0", "attempt"], undefined)),
			["scenario_attempt_drift"],
		);
		expectCodes(
			codesFor(withValue(evidence, ["scenarios", "0", "scenario_status"], "aborted")),
			["scenario_not_completed", "summary_count_drift"],
		);
		expectCodes(
			codesFor(withValue(evidence, ["scenarios", "0", "turns"], 1)),
			["scenario_incomplete"],
		);
	});

	it("rejects a self-awarded or absent outcome verdict", () => {		expectCodes(
			codesFor(withValue(evidence, ["scenarios", "0", "outcome"], "self_awarded_pass")),
			["scenario_outcome_invalid", "summary_count_drift"],
		);
		expectCodes(
			codesFor(withoutKey(evidence, ["scenarios", "0", "outcome"])),
			["scenario_outcome_invalid"],
		);
	});

	it("rejects a scenario with no independently inspected transcript decisions", () => {
		expectCodes(
			codesFor(
				withValue(evidence, ["scenarios", "0", "observed_decisions"], [
					"only one decision inspected",
				]),
			),
			["observed_decisions_missing"],
		);
		expectCodes(
			codesFor(withoutKey(evidence, ["scenarios", "0", "observed_decisions"])),
			["observed_decisions_missing"],
		);
	});

	it("rejects missing or zero-filled required metrics", () => {
		const required = (cohort.metrics as Document).required as string[];
		expect(required).toContain("reported_tokens");
		for (const metric of required) {
			if (metric === "scenario_status") continue;
			expectCodes(
				codesFor(withValue(evidence, ["scenarios", "0", metric], null)),
				["scenario_metrics_missing"],
			);
			expectCodes(
				codesFor(withValue(evidence, ["scenarios", "0", metric], -1)),
				["scenario_metrics_missing"],
			);
		}
		expectCodes(
			codesFor(withValue(evidence, ["scenarios", "0", "reported_tokens"], 0)),
			["metric_unknown_recorded_as_zero"],
		);
		expectCodes(
			codesFor(withValue(evidence, ["scenarios", "0", "duration_ms"], 0)),
			["metric_unknown_recorded_as_zero"],
		);
	});
});

describe("workflow behavior evidence: criterion coverage is recomputed, never partial", () => {
	it("records every required criterion of the cohort fixture", () => {
		const required = new Map(
			(scenarios(cohort) as Document[]).map((scenario) => [
				scenario.id as string,
				(scenario.successChecklist as string[]).length,
			]),
		);
		for (const scenario of scenarios(evidence)) {
			const id = scenario.scenario_id as string;
			const total = required.get(id) as number;
			if (scenario.outcome === "passed") {
				expect(scenario.criteria_met).toBe(total);
			} else {
				expect(scenario.criteria_required_for_pass).toBe(total);
				expect((scenario.unmet_criteria as string[]).length).toBeGreaterThan(0);
				expect(scenario.criteria_met).toBe(
					total - (scenario.unmet_criteria as string[]).length,
				);
			}
		}
	});

	it("rejects a pass that records less than every required criterion", () => {
		const required = (scenarios(evidence)[0] as Document).criteria_met as number;
		for (const met of [required - 1, required + 1]) {
			const partial = withValue(
				evidence,
				["scenarios", "0", "criteria_met"],
				met,
			);
			expectCodes(codesFor(partial), ["criteria_coverage_drift"]);
			expect(checkWorkflowBehaviorEvidence(inputFor(partial)).ok).toBe(false);
		}
		expectCodes(codesFor(withoutKey(evidence, ["scenarios", "0", "criteria_met"])), [
			"criteria_coverage_drift",
		]);
	});

	it("rejects a criterion tally above the cohort's own criteria", () => {
		const inflated = withValue(cohort, ["scenarios", "0", "successChecklist"], [
			"a",
			"b",
			"c",
			"d",
			"e",
		]);
		expectCodes(codesFor(evidence, inflated), ["criteria_coverage_drift"]);
	});

	it("accepts a failure only when it is fully disclosed", () => {
		const failedIndex = scenarios(evidence).findIndex(
			(scenario) => scenario.outcome === "failed",
		);
		expect(failedIndex).toBeGreaterThanOrEqual(0);
		const failed = [`scenarios`, String(failedIndex)];
		// The checked-in failure is closed and honest.
		expect(
			checkWorkflowBehaviorEvidence(inputFor(evidence)).ok,
		).toBe(true);
		// An undisclosed failure: faked as a pass, or with a tally that hides it.
		expectCodes(codesFor(withValue(evidence, [...failed, "outcome"], "passed")), [
			"criteria_coverage_drift",
		]);
		expectCodes(codesFor(withoutKey(evidence, [...failed, "unmet_criteria"])), [
			"failure_not_disclosed",
		]);
		expectCodes(codesFor(withValue(evidence, [...failed, "unmet_criteria"], [])), [
			"failure_not_disclosed",
		]);
		expectCodes(codesFor(withoutKey(evidence, [...failed, "failure_class"])), [
			"failure_not_disclosed",
		]);
		expectCodes(
			codesFor(withoutKey(evidence, [...failed, "criteria_required_for_pass"])),
			["failure_not_disclosed"],
		);
		// A tally consistent with the unmet list is required.
		const required = (scenarios(evidence)[failedIndex] as Document)
			.criteria_required_for_pass as number;
		expectCodes(codesFor(withValue(evidence, [...failed, "criteria_met"], required)), [
			"failure_not_disclosed",
		]);
	});

	it("requires a cohort deviation record for a failed scenario", () => {
		const withoutRecord = clone(evidence);
		(
			withoutRecord.cohort_summary as Document
		).deviations_recorded = [];
		expectCodes(codesFor(withoutRecord), ["failure_not_disclosed"]);
	});

	it("rejects a pass that still carries failure bookkeeping", () => {
		// The reviewer's combined trigger: flip the outcome and the tally to a full
		// pass and 10/0, but leave unmet_criteria and the failure classification
		// behind. A count-only check would accept this.
		const failedIndex = scenarios(evidence).findIndex(
			(scenario) => scenario.outcome === "failed",
		);
		const failed = [`scenarios`, String(failedIndex)];
		const required = (scenarios(evidence)[failedIndex] as Document)
			.criteria_required_for_pass as number;
		let forged = withValue(evidence, [...failed, "outcome"], "passed");
		forged = withValue(forged, [...failed, "criteria_met"], required);
		const summary = forged.cohort_summary as Document;
		summary.scenarios_passed = 10;
		summary.scenarios_failed = 0;
		// The pass still lists an unmet criterion and a failure classification.
		expectCodes(codesFor(forged), ["criteria_coverage_drift"]);
	});

	it("rejects a failure whose unmet criterion is not its own", () => {
		const failedIndex = scenarios(evidence).findIndex(
			(scenario) => scenario.outcome === "failed",
		);
		const failed = [`scenarios`, String(failedIndex)];
		const required = (scenarios(evidence)[failedIndex] as Document)
			.criteria_required_for_pass as number;
		// Arbitrary text standing in for a real criterion, with a tally that still
		// arithmetically matches its length.
		let forged = withValue(evidence, [...failed, "unmet_criteria"], ["undisclosed"]);
		forged = withValue(forged, [...failed, "criteria_met"], required - 1);
		forged = withValue(
			forged,
			["cohort_summary", "deviations_recorded", "0", "detail"],
			"undisclosed",
		);
		expectCodes(codesFor(forged), ["failure_not_disclosed"]);
		// A partial restatement of a real criterion is still not the criterion.
		const realCriterion = (
			((cohort.scenarios as Document[])[failedIndex] as Document)
				.successChecklist as string[]
		)[0] as string;
		expectCodes(
			codesFor(
				withValue(evidence, [...failed, "unmet_criteria"], [
					realCriterion.slice(0, 12),
				]),
			),
			["failure_not_disclosed"],
		);
		// The same real criterion listed twice is not two unmet criteria.
		const genuine = (scenarios(evidence)[failedIndex] as Document)
			.unmet_criteria as string[];
		expectCodes(
			codesFor(
				withValue(evidence, [...failed, "unmet_criteria"], [
					genuine[0],
					genuine[0],
				]),
			),
			["failure_not_disclosed"],
		);
	});

	it("requires every criterion to link to a recorded observation", () => {
		const first = ["scenarios", "0"];
		// The reviewer's trigger: drop the observation that substantiates a criterion
		// while leaving outcome='passed' and the full numeric tally. A count-only check
		// accepts this; criterion-linked evidence must not.
		const full = scenarios(evidence)[0] as Document;
		const decisions = full.observed_decisions as string[];
		const assessments = full.criterion_assessments as Document[];
		const orphaned = assessments[assessments.length - 1] as Document;
		const remainingDecisions = decisions.filter(
			(decision) => decision !== orphaned.observation,
		);
		let forged = withValue(evidence, [...first, "observed_decisions"], remainingDecisions);
		forged = withValue(
			forged,
			[...first, "criterion_assessments"],
			assessments.slice(0, -1),
		);
		expectCodes(codesFor(forged), ["criterion_evidence_incomplete"]);
		expect(checkWorkflowBehaviorEvidence(inputFor(forged)).ok).toBe(false);
		// An assessment must be a real checklist entry, not free text.
		expectCodes(
			codesFor(
				withValue(
					evidence,
					[...first, "criterion_assessments", "0", "criterion"],
					"a criterion that is not in the checklist",
				),
			),
			["criterion_evidence_incomplete"],
		);
		// An assessment must cite one of the recorded decisions, not invented prose.
		expectCodes(
			codesFor(
				withValue(
					evidence,
					[...first, "criterion_assessments", "0", "observation"],
					"an observation that was never recorded",
				),
			),
			["criterion_evidence_incomplete"],
		);
		// `met` must be a boolean, and each criterion at most once.
		expectCodes(
			codesFor(
				withValue(
					evidence,
					[...first, "criterion_assessments", "0", "met"],
					"yes",
				),
			),
			["criterion_evidence_incomplete"],
		);
		expectCodes(
			codesFor(
				withValue(evidence, [...first, "criterion_assessments"], [
					assessments[0],
					assessments[0],
				]),
			),
			["criterion_evidence_incomplete"],
		);
		// Every criterion must still be present exactly once.
		expectCodes(
			codesFor(
				withValue(
					evidence,
					[...first, "criterion_assessments"],
					assessments.slice(0, -1),
				),
			),
			["criterion_evidence_incomplete"],
		);
	});

	it("rejects an assessment that contradicts the disclosed outcome", () => {
		const failedIndex = scenarios(evidence).findIndex(
			(scenario) => scenario.outcome === "failed",
		);
		const failed = ["scenarios", String(failedIndex)];
		const failedScenario = scenarios(evidence)[failedIndex] as Document;
		const assessments = failedScenario.criterion_assessments as Document[];
		const unmetCriterion = (failedScenario.unmet_criteria as string[])[0] as string;
		// Flip the genuinely unmet criterion to met while continuing to disclose it.
		const flipped = assessments.map((assessment) =>
			assessment.criterion === unmetCriterion
				? { ...assessment, met: true }
				: assessment,
		);
		expectCodes(
			codesFor(withValue(evidence, [...failed, "criterion_assessments"], flipped)),
			["failure_not_disclosed"],
		);
	});

	it("rejects a deviation classification that contradicts the outcome", () => {
		const deviations = evidence.cohort_summary as Document;
		const records = deviations.deviations_recorded as Document[];
		const failureRecord = records.find(
			(record) => /fail/i.test(String(record.classified_as)),
		);
		expect(failureRecord).toBeDefined();
		// A failed scenario classified as if it had passed.
		expectCodes(
			codesFor(
				withValue(evidence, ["cohort_summary", "deviations_recorded"], [
					{ ...failureRecord, classified_as: "scenario_passed_with_recorded_deviation" },
				]),
			),
			["failure_not_disclosed"],
		);
	});
});

describe("workflow behavior evidence: summary and deviation truthfulness", () => {
	it("recomputes the cohort summary from recorded scenarios", () => {
		const overstated = withValue(
			evidence,
			["scenarios", "0", "outcome"],
			"failed",
		);
		expectCodes(codesFor(overstated), [
			"summary_count_drift",
			"failure_not_disclosed",
		]);

		const truthfullyFailed = clone(evidence);
		(truthfullyFailed.scenarios as Document[])[0]!.outcome = "failed";
		const summary = truthfullyFailed.cohort_summary as Document;
		summary.scenarios_passed = 8;
		summary.scenarios_failed = 2;
		expectCodes(codesFor(truthfullyFailed), ["failure_not_disclosed"]);
		expect(
			checkWorkflowBehaviorEvidence(inputFor(truthfullyFailed)).ok,
		).toBe(false);
		const fields = [
			"scenarios_expected",
			"scenarios_completed",
			"scenarios_passed",
			"scenarios_failed",
			"scenarios_missing",
			"scenarios_duplicated",
			"attempts_total",
		];
		for (const field of fields) {
			const summary = structuredClone(evidence.cohort_summary) as Document;
			summary[field] = undefined;
			expect(codesFor(withValue(evidence, ["cohort_summary"], summary))).toContain(
				"summary_count_drift",
			);
		}
		const inflated = structuredClone(evidence.cohort_summary) as Document;
		inflated.scenarios_passed = 11;
		expectCodes(
			codesFor(withValue(evidence, ["cohort_summary"], inflated)),
			["summary_count_drift"],
		);
	});

	it("links every transcript deviation to a cohort deviation record", () => {
		const flagged = clone(evidence);
		const decisions = (scenarios(flagged)[0] as Document).observed_decisions as string[];
		decisions.push("One recorded deviation: the answer skipped a required phase.");
		expectCodes(codesFor(flagged), ["deviation_linkage_drift"]);

		const summary = structuredClone(evidence.cohort_summary) as Document;
		summary.deviations_recorded = [
			...((summary.deviations_recorded as Document[]) ?? []),
			{
				scenario_id: "bounded-discovery-and-partial-edit-recovery",
				detail: "proposed reverting the partial edit",
				classified_as: "scenario_passed_with_recorded_deviation",
			},
		];
		expectCodes(
			codesFor(withValue(evidence, ["cohort_summary"], summary)),
			["deviation_record_incomplete"],
		);

		const orphan = structuredClone(evidence.cohort_summary) as Document;
		orphan.deviations_recorded = [
			...((orphan.deviations_recorded as Document[]) ?? []),
			{
				scenario_id: "scenario-that-was-never-run",
				detail: "x",
				classified_as: "y",
				rationale: "z",
			},
		];
		expectCodes(codesFor(withValue(evidence, ["cohort_summary"], orphan)), [
			"deviation_record_incomplete",
		]);
	});
});

describe("workflow behavior evidence: provenance controls", () => {
	it("rejects evidence that trusts a child's self-report or keeps raw output", () => {
		const cases: [string[], unknown][] = [
			[["provenance", "parent_independent_inspection"], false],
			[["provenance", "model_self_report_trusted"], true],
			[["provenance", "collection"], undefined],
			[["provenance", "retention"], "full raw transcripts retained"],
		];
		for (const [path, value] of cases)
			expectCodes(codesFor(withValue(evidence, path, value)), [
				"provenance_untrusted",
			]);
	});
});

describe("workflow behavior evidence: legacy benchmark modes", () => {
	it("keeps the legacy parallel batch dispatch for existing fixtures", () => {
		const prompt = benchmarkPrompt(
			"tests/fixtures/immune-brain-benchmark.json",
			legacyFixture as unknown as CohortFixture,
		);
		expect(prompt).toContain(
			"Launch every scenario in one parallel foreground Agent batch.",
		);
		expect(prompt).not.toContain("serially");
		expect(JSON.stringify(legacyFixture)).not.toContain("turnsPerScenario");
	});

	it("dispatches the serial cohort without fan-out or retry", () => {
		const prompt = benchmarkPrompt(cohortPath, cohort as unknown as CohortFixture);
		expect(prompt).toContain(
			"Dispatch the scenarios serially in this foreground session: exactly one scenario at a time, never a parallel batch.",
		);
		expect(prompt).toContain("Run exactly 2 turns per scenario");
		expect(prompt).toContain("Make 1 attempt per scenario");
		expect(prompt).toContain("no scenario child spawning");
		expect(prompt).toContain(
			"Do not call get_subagent_result; foreground Agent tool results are the scenario evidence.",
		);
		expect(prompt).not.toContain(
			"Launch every scenario in one parallel foreground Agent batch.",
		);
	});

	it("still rejects unknown runner arguments", async () => {
		await expect(benchmarkMain(["--nonsense"])).rejects.toThrow(
			"Unknown or incomplete argument: --nonsense",
		);
	});

	it("exits non-zero from the offline CLI when a bound source drifts", async () => {
		const directory = mkdtempSync(join(tmpdir(), "imm-workflow-evidence-"));
		temporaryDirectories.push(directory);
		const drifted = join(directory, "drifted-evidence.json");
		const copy = clone(evidence);
		(
			(copy.source_bindings as Document).spec as Document
		).sha256 = "sha256:".padEnd(71, "0");
		writeFileSync(drifted, `${JSON.stringify(copy, null, 2)}\n`, "utf8");
		expect(
			await quietly(() =>
				benchmarkMain(["--fixture", cohortPath, "--verify-evidence", drifted]),
			),
		).toBe(1);
	});

	it("current-source CLI rejects stale historical evidence", async () => {
		expect(await quietly(() => benchmarkMain([
			"--fixture", cohortPath, "--verify-evidence", evidencePath,
		]))).toBe(1);
		expect(verifyWorkflowBehaviorEvidenceFiles(repoRoot, evidencePath, cohortPath).reason_codes)
			.toEqual(["fingerprint_drift", "required_binding_missing"]);
	});

	it("offline CLI accepts the preserved historical source tree", () => {
		const result = spawnSync(process.execPath, [resolve(repoRoot, "scripts/benchmark_eval.ts"),
			"--fixture", cohortPath, "--verify-evidence", evidencePath], {
			cwd: historicalSourceRoot(), encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).ok).toBe(true);
	});
});
