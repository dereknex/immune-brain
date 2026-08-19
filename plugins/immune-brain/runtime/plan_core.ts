/**
 * Plan parsing, normalization, signatures, and validation.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import process from "node:process";
import { stableStringify } from "./canonical_json";

// ── errors ───────────────────────────────────────────────────────────

export class PlanValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlanValidationError";
	}
}

// ── regexes (ported from plan_runtime.py) ────────────────────────────

const STEP_HEADER_RE = /^### Step (\d+)\s*$/;
const ROADMAP_PHASE_RE = /^###\s+(.+?)\s*$/;
const TASK_FIELD_RE = /^- ([A-Za-z][A-Za-z0-9 _-]*):\s*(.+?)\s*$/;
const FIELD_RE =
	/^- (Result|Scope|Verification|Depends on|Step ID|Test scenarios|Discovery cache|Parallel probes|Agent|Agent Hint|Dispatch):\s*(.*)\s*$/;
const ROADMAP_CRITERIA_RE =
	/^- (acceptance_criteria|promotion_criteria):\s*(.*?)\s*$/i;
const DISCOVERY_CACHE_ENTRY_RE = /^(.+?)\s*\((.+)\)\s*$/;
const MULTI_RESULT_MARKERS = [" and ", ",", ";", "；"];
const ACTION_RESULT_RE = /^(read|inspect|review|edit|modify|run|execute)\b/i;
const STEP_ID_RE = /^U[0-9]+$/;
const PLACEHOLDER_RE = /<[^>\n]+>/;
const NON_BEHAVIORAL_ACCEPTANCE_RE =
	/\b(implementation complete|code complete|definition of done|checklist|test plan)\b/i;
const BR_ITEM_RE = /^BR-(REQ|DEC|OUT|DEFER|Q)-[0-9]+$/;
const ROADMAP_SLICE_CONTRACT = "roadmap-slice/v1";
const ROADMAP_PHASE_ID_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;
const ROADMAP_SLICE_REQUIRED_FIELDS: Array<[key: string, label: string]> = [
	["roadmap_source", "Roadmap source"],
	["current_phase", "Current phase"],
	["plan_boundary", "Plan boundary"],
	["boundary_rationale", "Boundary rationale"],
	["scope_pressure", "Scope pressure"],
	["successor_candidate", "Successor candidate"],
	["successor_preconditions", "Successor preconditions"],
	["current-slice_warning", "Current-slice warning"],
];

// ── plan parsing helpers ─────────────────────────────────────────────

export function hasPlaceholder(value: string): boolean {
	const text = value || "";
	return Boolean(
		PLACEHOLDER_RE.test(text) || text.includes("<") || text.includes(">"),
	);
}

export function isActionStepResult(value: string): boolean {
	return ACTION_RESULT_RE.test((value || "").trim());
}

export function parseDependsOn(rawValue: string): number[] {
	const value = rawValue.trim();
	if (value.toLowerCase() === "none") return [];
	const deps: number[] = [];
	for (const part of value.split(",")) {
		const item = part.trim();
		if (!item) continue;
		if (/^\d+$/.test(item)) {
			deps.push(Number(item));
			continue;
		}
		if (STEP_ID_RE.test(item)) {
			deps.push(Number(item.slice(1)));
			continue;
		}
		throw new PlanValidationError(
			`Depends on contains an invalid step reference: ${item}. Use a step number like 1 or a Step ID like U1.`,
		);
	}
	return deps;
}

export function parseStepScope(rawValue: string): string[] {
	const codeSpans = [...rawValue.matchAll(/`([^`\n]+)`/g)].map((match) =>
		match[1].trim(),
	);
	const candidates =
		codeSpans.length > 0
			? codeSpans
			: rawValue
					.split(/[;,]/)
					.map((value) => value.trim())
					.filter((value) => value.length > 0 && !/\s/.test(value));
	const paths: string[] = [];
	for (const candidate of candidates) {
		const normalized = candidate.replace(/^\.\//, "").replace(/\\/g, "/");
		if (
			!normalized ||
			normalized.startsWith("/") ||
			normalized.split("/").includes("..") ||
			normalized.includes("\0")
		) {
			throw new PlanValidationError(
				`Scope contains an invalid project-relative path: ${candidate}`,
			);
		}
		if (!paths.includes(normalized)) paths.push(normalized);
	}
	return paths;
}

export function parseBrainstormManifestItems(rawValue: string): string[] {
	return rawValue
		? rawValue
				.split(/[;,]/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
		: [];
}

export function parseBrainstormTraceRow(
	stripped: string,
): Record<string, string> | null {
	if (!stripped.startsWith("|") || !stripped.endsWith("|")) return null;
	const cells = stripped
		.slice(1, -1)
		.split("|")
		.map((c) => c.trim());
	if (cells.length < 4) return null;
	const [item, status, target, reason] = cells.slice(0, 4);
	if (
		item.toLowerCase() === "item" ||
		(new Set(item).size <= 1 && [...item].every((c) => c === "-"))
	)
		return null;
	return { item, status, target, reason };
}

export function parseDiscoveryCache(
	rawValue: string,
): Array<{ path: string; reason: string }> {
	const value = (rawValue || "").trim();
	if (!value) return [];
	const entries: Array<{ path: string; reason: string }> = [];
	for (const part of value.split(";")) {
		const item = part.trim();
		if (!item) continue;
		const match = DISCOVERY_CACHE_ENTRY_RE.exec(item);
		if (!match) {
			throw new PlanValidationError(
				"Discovery cache entries must use 'path (reason)' format.",
			);
		}
		entries.push({ path: match[1].trim(), reason: match[2].trim() });
	}
	return entries;
}

export function validateParallelProbeShape(
	probe: Record<string, unknown>,
): Record<string, unknown> {
	if (typeof probe !== "object" || probe === null) {
		throw new PlanValidationError("Parallel probes must be objects.");
	}
	for (const field of ["scope", "output"]) {
		const value = (probe as Record<string, unknown>)[field];
		if (typeof value !== "string" || !value.trim()) {
			throw new PlanValidationError(
				`Parallel probes require a non-empty ${field}.`,
			);
		}
	}
	if (probe.readonly !== true) {
		throw new PlanValidationError(
			"Parallel probes must declare readonly: true.",
		);
	}
	return probe;
}

export function parseParallelProbeEntry(
	rawEntry: string,
): Record<string, unknown> {
	const probe: Record<string, unknown> = {};
	for (const part of rawEntry.split(",")) {
		const item = part.trim();
		if (!item) continue;
		const eq = item.indexOf("=");
		if (eq === -1) {
			throw new PlanValidationError(
				"Parallel probes entries must use key=value pairs or JSON.",
			);
		}
		const key = item.slice(0, eq).trim();
		const value = item.slice(eq + 1).trim();
		probe[key] = value;
	}
	if (Object.keys(probe).length === 0) {
		throw new PlanValidationError("Parallel probes entries must not be empty.");
	}
	if ("readonly" in probe) {
		probe.readonly = String(probe.readonly).toLowerCase() === "true";
	}
	return validateParallelProbeShape(probe);
}

export function parseParallelProbes(
	rawValue: string,
): Array<Record<string, unknown>> {
	const value = (rawValue || "").trim();
	if (!value) return [];
	if (value.startsWith("[")) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(value);
		} catch (exc) {
			throw new PlanValidationError(`Parallel probes JSON is invalid: ${exc}`);
		}
		if (!Array.isArray(parsed)) {
			throw new PlanValidationError("Parallel probes JSON must be a list.");
		}
		return parsed.map((p) =>
			validateParallelProbeShape(p as Record<string, unknown>),
		);
	}
	return value
		.split(";")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map((s) => parseParallelProbeEntry(s));
}

// ── spec reference normalization ─────────────────────────────────────

function parseSpecReference(rawValue: string): string {
	return (rawValue || "").trim().replace(/^`|`$/g, "");
}

export interface ParsedSpecDesign {
	path: string;
	exists: boolean;
	design_risk: string | null;
	diagram_decision: string | null;
	diagram_reason: string | null;
	has_technical_design: boolean;
	has_mermaid: boolean;
}

function contentOutsideFences(content: string): string {
	let inFence = false;
	return content
		.split("\n")
		.filter((line) => {
			if (/^\s*```/.test(line)) {
				inFence = !inFence;
				return false;
			}
			return !inFence && !/^\s*>/.test(line);
		})
		.join("\n");
}

function technicalDesignSection(content: string): string | null {
	const lines = content.split("\n");
	let inFence = false;
	let start = -1;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (
			start === -1 &&
			/^##\s+(?:\d+(?:\.\d+)*\.?\s+)?Technical Design\b/i.test(line)
		) {
			start = index;
			continue;
		}
		if (start !== -1 && /^##\s+/.test(line))
			return lines.slice(start, index).join("\n");
	}
	return start === -1 ? null : lines.slice(start).join("\n");
}

function parseSpecField(content: string, field: string): string | null {
	const match = new RegExp(
		`^(?:-\\s*)?(?:\\*\\*)?${field}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`,
		"im",
	).exec(contentOutsideFences(content));
	return match?.[1]?.trim() || null;
}

function resolveReferencedSpec(
	planPath: string,
	specReference: string,
): string {
	const absolutePlan = resolve(planPath);
	const marker = `${sep}docs${sep}plans${sep}`;
	const markerIndex = absolutePlan.lastIndexOf(marker);
	const projectRoot =
		markerIndex === -1 ? process.cwd() : absolutePlan.slice(0, markerIndex);
	return resolve(projectRoot, specReference);
}

function parseReferencedSpec(
	planPath: string,
	specReference: string | undefined,
): ParsedSpecDesign | null {
	if (!specReference) return null;
	const specPath = resolveReferencedSpec(planPath, specReference);
	if (!existsSync(specPath)) {
		return {
			path: specPath,
			exists: false,
			design_risk: null,
			diagram_decision: null,
			diagram_reason: null,
			has_technical_design: false,
			has_mermaid: false,
		};
	}

	const content = readFileSync(specPath, "utf-8");
	const technicalDesign = technicalDesignSection(content);
	return {
		path: specPath,
		exists: true,
		design_risk: parseSpecField(content, "Design risk"),
		diagram_decision: parseSpecField(content, "Diagram decision"),
		diagram_reason: parseSpecField(content, "Diagram reason"),
		has_technical_design: technicalDesign !== null,
		has_mermaid: technicalDesign
			? /```mermaid\b/i.test(technicalDesign)
			: false,
	};
}

// ── plan parsing ─────────────────────────────────────────────────────

export interface ParsedStep {
	number: number;
	result: string | null;
	verification: string | null;
	step_id: string | null;
	test_scenarios: string[];
	scope: string[];
	discovery_cache: Array<{ path: string; reason: string }>;
	parallel_probes: Array<Record<string, unknown>>;
	depends_on: number[];
	agent_hint: string | null;
}

export interface ParsedRoadmapPhase {
	title: string;
	acceptance_criteria_present: boolean;
	acceptance_criteria: string[];
	promotion_criteria_present: boolean;
	promotion_criteria: string[];
}

export interface PlanValidationWarning {
	code: string;
	message: string;
	phase?: string;
	field?: string;
}

export interface ParsedPlan {
	path: string;
	summary: string | null;
	task: Record<string, string>;
	spec_design: ParsedSpecDesign | null;
	brainstorm_trace: Array<Record<string, string>>;
	roadmap_phases: ParsedRoadmapPhase[];
	steps: ParsedStep[];
}

export function parsePlan(path: string): ParsedPlan {
	const lines = readFileSync(path, "utf-8").split("\n");
	let summary: string | null = null;
	const steps: ParsedStep[] = [];
	let currentStep: ParsedStep | null = null;
	const taskMeta: Record<string, string> = {};
	let inTaskSection = false;
	let inBrainstormTrace = false;
	const brainstormTrace: Array<Record<string, string>> = [];
	const roadmapPhases: ParsedRoadmapPhase[] = [];
	let inRoadmap = false;
	let currentRoadmapPhase: ParsedRoadmapPhase | null = null;
	let currentRoadmapField: "acceptance_criteria" | "promotion_criteria" | null =
		null;
	const pushRoadmapPhase = () => {
		if (currentRoadmapPhase) roadmapPhases.push(currentRoadmapPhase);
		currentRoadmapPhase = null;
		currentRoadmapField = null;
	};

	for (const line of lines) {
		const stripped = line.trim();
		if (stripped.startsWith("- Summary:")) {
			summary = stripped.slice("- Summary:".length).trim();
			continue;
		}
		if (stripped === "## Task") {
			inTaskSection = true;
			inBrainstormTrace = false;
			continue;
		}
		if (stripped === "## Brainstorm Trace") {
			inTaskSection = false;
			inBrainstormTrace = true;
			continue;
		}
		if (stripped.startsWith("## ") && stripped !== "## Task") {
			inTaskSection = false;
			if (stripped !== "## Brainstorm Trace") inBrainstormTrace = false;
			if (inRoadmap && !/roadmap/i.test(stripped)) pushRoadmapPhase();
			inRoadmap = /roadmap/i.test(stripped);
			currentRoadmapField = null;
		}

		if (inRoadmap) {
			const phaseMatch = ROADMAP_PHASE_RE.exec(stripped);
			if (phaseMatch) {
				pushRoadmapPhase();
				currentRoadmapPhase = {
					title: phaseMatch[1].trim(),
					acceptance_criteria_present: false,
					acceptance_criteria: [],
					promotion_criteria_present: false,
					promotion_criteria: [],
				};
				continue;
			}

			const criteriaMatch = ROADMAP_CRITERIA_RE.exec(stripped);
			if (criteriaMatch && currentRoadmapPhase) {
				const key = criteriaMatch[1].toLowerCase() as
					| "acceptance_criteria"
					| "promotion_criteria";
				const value = criteriaMatch[2].trim();
				currentRoadmapField = key;
				currentRoadmapPhase[`${key}_present`] = true;
				if (value) currentRoadmapPhase[key].push(value);
				continue;
			}

			const listMatch = /^-\s+(.+?)\s*$/.exec(stripped);
			if (listMatch && currentRoadmapPhase && currentRoadmapField) {
				currentRoadmapPhase[currentRoadmapField].push(listMatch[1].trim());
				continue;
			}

			if (stripped && !stripped.startsWith("-")) currentRoadmapField = null;
		}

		const stepMatch = STEP_HEADER_RE.exec(stripped);
		if (stepMatch) {
			if (currentStep) steps.push(currentStep);
			currentStep = {
				number: Number(stepMatch[1]),
				result: null,
				verification: null,
				step_id: null,
				test_scenarios: [],
				scope: [],
				discovery_cache: [],
				parallel_probes: [],
				depends_on: [],
				agent_hint: null,
			};
			continue;
		}

		if (inTaskSection) {
			const taskMatch = TASK_FIELD_RE.exec(stripped);
			if (taskMatch) {
				const [, key, value] = taskMatch;
				const normalizedKey = key.toLowerCase().replace(/ /g, "_");
				if (normalizedKey === "spec") {
					taskMeta[normalizedKey] = parseSpecReference(value);
				} else {
					taskMeta[normalizedKey] = value.trim();
				}
			}
			continue;
		}

		if (inBrainstormTrace) {
			const traceRow = parseBrainstormTraceRow(stripped);
			if (traceRow) brainstormTrace.push(traceRow);
			continue;
		}

		const fieldMatch = FIELD_RE.exec(stripped);
		if (fieldMatch && currentStep) {
			const [, key, value] = fieldMatch;
			if (key === "Result") currentStep.result = value.trim();
			else if (key === "Scope") currentStep.scope = parseStepScope(value);
			else if (key === "Verification") currentStep.verification = value.trim();
			else if (key === "Step ID") currentStep.step_id = value.trim();
			else if (key === "Test scenarios") {
				if (value)
					currentStep.test_scenarios = value
						.split(";")
						.map((s) => s.trim())
						.filter((s) => s.length > 0);
			} else if (key === "Discovery cache")
				currentStep.discovery_cache = parseDiscoveryCache(value);
			else if (key === "Parallel probes")
				currentStep.parallel_probes = parseParallelProbes(value);
			else if (key === "Depends on")
				currentStep.depends_on = parseDependsOn(value);
			else if (["Agent", "Agent Hint", "Dispatch"].includes(key))
				currentStep.agent_hint = value.trim();
		}
	}

	if (currentStep) steps.push(currentStep);
	if (inRoadmap) pushRoadmapPhase();

	return {
		path,
		summary,
		task: taskMeta,
		spec_design: parseReferencedSpec(path, taskMeta.spec),
		brainstorm_trace: brainstormTrace,
		roadmap_phases: roadmapPhases,
		steps,
	};
}

// ── plan signature ───────────────────────────────────────────────────

export interface NormalizedStep {
	number: number;
	step_id: string;
	result: string;
	verification: string;
	scope: string[];
	depends_on: number[];
	discovery_cache: Array<{ path: string; reason: string }>;
	parallel_probes: Array<Record<string, unknown>>;
	agent_hint?: string | null;
	test_scenarios?: string[] | null;
}

export interface NormalizedPlan {
	plan_path: string;
	summary: string;
	task: Record<string, string>;
	steps: NormalizedStep[];
}

export type WorkflowProfile = "standard" | "strict";
export type CompounderPolicy = "optional" | "required";

export function workflowProfileForTask(
	task: Record<string, string> | null | undefined,
): WorkflowProfile {
	return task?.workflow_profile?.trim().toLowerCase() === "standard"
		? "standard"
		: "strict";
}

export function compounderPolicyForTask(
	task: Record<string, string> | null | undefined,
): CompounderPolicy {
	if (task?.compounder?.trim().toLowerCase() === "optional") return "optional";
	return "required";
}

export function buildSignaturePayload(normalizedPlan: NormalizedPlan): string {
	// Keep cross-runtime parity: the legacy Plan signature predates Scope.
	const payload = {
		summary: normalizedPlan.summary,
		task: normalizedPlan.task,
		steps: normalizedPlan.steps.map((step) => ({
			number: step.number,
			step_id: step.step_id,
			result: step.result,
			verification: step.verification,
			test_scenarios: step.test_scenarios,
			discovery_cache: step.discovery_cache,
			parallel_probes: step.parallel_probes,
			depends_on: step.depends_on,
			agent_hint: step.agent_hint,
		})),
	};
	return stableStringify(payload);
}

export function buildPlanSignature(normalizedPlan: NormalizedPlan): string {
	return createHash("sha256")
		.update(buildSignaturePayload(normalizedPlan))
		.digest("hex");
}

export function normalizePlan(
	plan: ParsedPlan,
	projectRoot?: string,
): NormalizedPlan {
	const normalizedPlanPath = normalizePlanPath(plan.path, projectRoot);
	return {
		plan_path: normalizedPlanPath,
		summary: plan.summary || "",
		task: plan.task,
		steps: plan.steps.map((step) => ({
			number: step.number,
			step_id: step.step_id || "",
			result: step.result || "",
			verification: step.verification || "",
			scope: step.scope || [],
			test_scenarios: step.test_scenarios,
			discovery_cache: step.discovery_cache || [],
			parallel_probes: step.parallel_probes || [],
			depends_on: step.depends_on,
			agent_hint: step.agent_hint,
		})),
	};
}

export function normalizePlanPath(
	planPath: string,
	projectRoot?: string,
): string {
	const root = projectRoot ? projectRoot : process.cwd();
	const resolved = resolve(root, planPath);
	const rel = relative(root, resolved);
	return rel.startsWith("..") ? resolved : rel;
}

// ── plan validation ─────────────────────────────────────────────────

function validateRoadmapCriteria(
	phases: ParsedRoadmapPhase[],
): PlanValidationWarning[] {
	if (phases.length < 3) return [];
	const warnings: PlanValidationWarning[] = [];
	for (const phase of phases) {
		if (!phase.acceptance_criteria_present) {
			warnings.push({
				code: "roadmap_acceptance_criteria_missing",
				message: `${phase.title} is missing acceptance_criteria.`,
				phase: phase.title,
				field: "acceptance_criteria",
			});
		} else if (phase.acceptance_criteria.length === 0) {
			warnings.push({
				code: "roadmap_acceptance_criteria_empty",
				message: `${phase.title} has empty acceptance_criteria.`,
				phase: phase.title,
				field: "acceptance_criteria",
			});
		} else if (
			phase.acceptance_criteria.some((item) =>
				NON_BEHAVIORAL_ACCEPTANCE_RE.test(item),
			)
		) {
			warnings.push({
				code: "roadmap_acceptance_criteria_non_behavioral",
				message: `${phase.title} has non-behavioral acceptance_criteria.`,
				phase: phase.title,
				field: "acceptance_criteria",
			});
		}

		if (
			phase.promotion_criteria_present &&
			phase.promotion_criteria.length === 0
		) {
			warnings.push({
				code: "roadmap_promotion_criteria_empty",
				message: `${phase.title} has empty promotion_criteria.`,
				phase: phase.title,
				field: "promotion_criteria",
			});
		}
	}
	return warnings;
}

function validateSpecDesign(spec: ParsedSpecDesign | null): {
	errors: string[];
	warnings: PlanValidationWarning[];
} {
	if (!spec) return { errors: [], warnings: [] };
	if (!spec.exists)
		return {
			errors: [`Referenced Spec does not exist: ${spec.path}`],
			warnings: [],
		};

	const hasMetadata = Boolean(
		spec.design_risk || spec.diagram_decision || spec.diagram_reason,
	);
	if (!hasMetadata) {
		return {
			errors: [],
			warnings: [
				{
					code: "spec_design_metadata_missing",
					message: `${spec.path} uses the legacy design contract; add Design risk, Diagram decision, and Diagram reason when revising it.`,
					field: "design_metadata",
				},
			],
		};
	}

	const errors: string[] = [];
	const risk = spec.design_risk?.split(/\s|—|-/)[0].toLowerCase();
	const decision = spec.diagram_decision?.toLowerCase().replace(/[ -]+/g, "_");

	if (!risk || !["low", "medium", "high"].includes(risk)) {
		errors.push("Referenced Spec Design risk must be Low, Medium, or High.");
	}
	if (!decision || !["required", "not_required"].includes(decision)) {
		errors.push(
			"Referenced Spec Diagram decision must be required or not_required.",
		);
	}
	if (!spec.diagram_reason) {
		errors.push("Referenced Spec is missing Diagram reason.");
	}
	if (["medium", "high"].includes(risk || "") && !spec.has_technical_design) {
		errors.push(
			`Referenced ${risk}-risk Spec is missing a Technical Design section.`,
		);
	}
	if (decision === "required" && !spec.has_mermaid) {
		errors.push(
			"Referenced Spec requires a Mermaid diagram but does not contain one.",
		);
	}

	return { errors, warnings: [] };
}

function validateWorkflowProfile(plan: ParsedPlan): string[] {
	const errors: string[] = [];
	const rawProfile = (plan.task.workflow_profile || "").trim().toLowerCase();
	const rawCompounder = (plan.task.compounder || "").trim().toLowerCase();
	if (rawProfile && !["standard", "strict"].includes(rawProfile)) {
		errors.push(
			"Workflow profile must be standard or strict; Direct Path does not use a Plan.",
		);
		return errors;
	}
	if (rawCompounder && !["optional", "required"].includes(rawCompounder)) {
		errors.push("Compounder must be optional or required.");
	}
	const profile = workflowProfileForTask(plan.task);
	if (profile === "strict" && rawCompounder === "optional") {
		errors.push("Strict workflow profile requires Compounder: required.");
	}
	if (profile !== "standard") return errors;

	const risk = plan.spec_design?.design_risk
		?.split(/\s|—|-/)[0]
		.toLowerCase();
	if (risk === "high") {
		errors.push("High-risk Specs require Workflow profile: strict.");
	}
	for (const step of plan.steps) {
		if (!/`[^`]+`/.test(step.verification || "")) {
			errors.push(
				`Standard workflow profile requires automated Verification for Step ${step.number}.`,
			);
		}
	}
	return errors;
}

function validatePlanContract(task: Record<string, string>): string[] {
	const contract = (task.plan_contract || "").trim();
	if (!contract) return [];
	if (contract !== ROADMAP_SLICE_CONTRACT)
		return [`Unsupported Plan contract: ${contract}`];

	const errors: string[] = [];
	for (const [key, label] of ROADMAP_SLICE_REQUIRED_FIELDS) {
		if (!(task[key] || "").trim()) {
			errors.push(
				`${ROADMAP_SLICE_CONTRACT} is missing required Task field: ${label}.`,
			);
		}
	}

	const currentPhase = (task.current_phase || "").trim();
	if (
		currentPhase &&
		(currentPhase.toLowerCase() === "none" ||
			!ROADMAP_PHASE_ID_RE.test(currentPhase))
	) {
		errors.push(
			`${ROADMAP_SLICE_CONTRACT} has invalid Current phase: ${currentPhase}`,
		);
	}

	const successor = (task.successor_candidate || "").trim();
	const successorIsTerminal = successor.toLowerCase() === "none";
	if (
		successor &&
		!successorIsTerminal &&
		!ROADMAP_PHASE_ID_RE.test(successor)
	) {
		errors.push(
			`${ROADMAP_SLICE_CONTRACT} has invalid Successor candidate: ${successor}`,
		);
	}
	if (
		currentPhase &&
		successor &&
		!successorIsTerminal &&
		currentPhase === successor
	) {
		errors.push(
			`${ROADMAP_SLICE_CONTRACT} Successor candidate must differ from Current phase.`,
		);
	}

	const preconditions = (task.successor_preconditions || "").trim();
	if (
		successor &&
		!successorIsTerminal &&
		preconditions.toLowerCase() === "none"
	) {
		errors.push(
			`${ROADMAP_SLICE_CONTRACT} requires Successor preconditions for non-terminal candidate ${successor}.`,
		);
	}
	if (
		successorIsTerminal &&
		preconditions &&
		preconditions.toLowerCase() !== "none"
	) {
		errors.push(
			`${ROADMAP_SLICE_CONTRACT} terminal Successor candidate requires Successor preconditions: none.`,
		);
	}

	return errors;
}

export function validatePlan(plan: ParsedPlan): {
	errors: string[];
	warnings: PlanValidationWarning[];
} {
	const designValidation = validateSpecDesign(plan.spec_design);
	const legacySpecErrors = plan.task.spec?.startsWith("docs/architecture/")
		? [
				"Legacy Plan Spec references are not accepted; migrate the active project or update the Plan to docs/specs/.",
			]
		: [];
	const errors = [
		...legacySpecErrors,
		...designValidation.errors,
		...validateWorkflowProfile(plan),
		...validatePlanContract(plan.task),
	];
	const warnings = [
		...validateRoadmapCriteria(plan.roadmap_phases || []),
		...designValidation.warnings,
	];
	const steps = plan.steps;

	if (steps.length === 0) {
		errors.push("Plan must contain at least one independently closable step.");
	}

	const seenNumbers = new Set<number>();
	let previousNumber = 0;

	for (const step of steps) {
		const number = step.number;
		const result = (step.result || "").trim();
		const verification = (step.verification || "").trim();
		const dependsOn = step.depends_on;

		if (seenNumbers.has(number)) errors.push(`Step ${number} is duplicated.`);
		seenNumbers.add(number);

		if (number <= previousNumber)
			errors.push("Steps must be in strictly increasing order.");
		previousNumber = number;

		if (!result) errors.push(`Step ${number} is missing Result.`);
		else if (hasPlaceholder(result))
			errors.push(
				`Step ${number} Result still contains a template placeholder.`,
			);
		else if (isActionStepResult(result)) {
			errors.push(`Step ${number} Result is an action, not an outcome.`);
		}

		if (result) {
			for (const marker of MULTI_RESULT_MARKERS) {
				if (result.includes(marker)) {
					errors.push(
						`Step ${number} Result contains multi-result marker '${marker}'.`,
					);
					break;
				}
			}
		}

		if (!verification) errors.push(`Step ${number} is missing Verification.`);
		else if (hasPlaceholder(verification)) {
			errors.push(
				`Step ${number} Verification still contains a template placeholder.`,
			);
		}

		if (step.step_id && !STEP_ID_RE.test(step.step_id)) {
			errors.push(`Step ${number} has invalid Step ID: ${step.step_id}`);
		}

		for (const dep of dependsOn) {
			if (dep >= number) {
				errors.push(`Step ${number} depends on a later or equal step: ${dep}.`);
			}
			if (dep < 1) {
				errors.push(`Step ${number} depends on an invalid step: ${dep}.`);
			}
			if (!steps.some((s) => s.number === dep)) {
				errors.push(`Step ${number} depends on a missing step: ${dep}.`);
			}
		}
	}

	// brainstorm trace validation
	const manifestItems = parseBrainstormManifestItems(
		plan.task.brainstorm_manifest || "",
	);
	if (manifestItems.length > 0) {
		const traceItems = new Set(plan.brainstorm_trace.map((r) => r.item));
		for (const item of manifestItems) {
			if (!traceItems.has(item)) {
				errors.push(
					`Brainstorm manifest item ${item} is not mapped in Brainstorm Trace.`,
				);
			}
		}
		for (const row of plan.brainstorm_trace) {
			if (!BR_ITEM_RE.test(row.item)) {
				errors.push(`Brainstorm Trace item has invalid ID: ${row.item}`);
			}
		}
	}

	return { errors, warnings };
}

export interface OriginCoverageProjection {
	applicable: boolean;
	declared_items: number;
	mapped_items: number;
	unmapped_items: number;
	reason_required_without_reason: number;
	deferred_or_out_of_scope_without_reason: number;
	complete: boolean;
}

export interface PlanValidationProjection extends NormalizedPlan {
	warnings: PlanValidationWarning[];
	origin_coverage: OriginCoverageProjection;
}

const REASON_REQUIRED_STATUSES = new Set([
	"partially_covered",
	"out_of_scope",
	"deferred",
]);

export function deriveOriginCoverage(
	plan: ParsedPlan,
): OriginCoverageProjection {
	const declared = [
		...new Set(
			parseBrainstormManifestItems(plan.task.brainstorm_manifest || ""),
		),
	];
	if (declared.length === 0) {
		return {
			applicable: false,
			declared_items: 0,
			mapped_items: 0,
			unmapped_items: 0,
			reason_required_without_reason: 0,
			deferred_or_out_of_scope_without_reason: 0,
			complete: true,
		};
	}

	const declaredSet = new Set(declared);
	const mapped = new Set(
		plan.brainstorm_trace
			.map((row) => row.item)
			.filter((item) => declaredSet.has(item)),
	);
	const reasonRequiredWithoutReason = plan.brainstorm_trace.filter(
		(row) =>
			declaredSet.has(row.item) &&
			REASON_REQUIRED_STATUSES.has((row.status || "").trim().toLowerCase()) &&
			!(row.reason || "").trim(),
	).length;
	const unmappedItems = declared.filter((item) => !mapped.has(item)).length;

	return {
		applicable: true,
		declared_items: declared.length,
		mapped_items: mapped.size,
		unmapped_items: unmappedItems,
		reason_required_without_reason: reasonRequiredWithoutReason,
		deferred_or_out_of_scope_without_reason: reasonRequiredWithoutReason,
		complete: unmappedItems === 0 && reasonRequiredWithoutReason === 0,
	};
}

function boundedPlanError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/[\r\n]+/g, " ").slice(0, 1024);
}

export function projectPlanValidation(
	planPath: string,
	projectRoot = process.cwd(),
): PlanValidationProjection {
	let parsed: ParsedPlan;
	try {
		parsed = parsePlan(resolve(projectRoot, planPath));
	} catch (error) {
		throw new PlanValidationError(
			`Plan could not be read: ${boundedPlanError(error)}`,
		);
	}
	const validation = validatePlan(parsed);
	if (validation.errors.length > 0) {
		throw new PlanValidationError(
			`Plan validation failed: ${validation.errors.join("; ")}`.slice(0, 4096),
		);
	}
	return {
		...normalizePlan(parsed, projectRoot),
		warnings: validation.warnings,
		origin_coverage: deriveOriginCoverage(parsed),
	};
}

// ── state machine ────────────────────────────────────────────────────
