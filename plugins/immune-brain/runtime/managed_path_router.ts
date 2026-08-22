import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export type ManagedRoutePhase = "none" | "brainstorm" | "planner" | "loop";
export type ManagedRequestIntent =
	| "read_only"
	| "review_only"
	| "planning"
	| "implementation"
	| "ambiguous_mutation"
	| "unknown";
export type EnrollmentDisposition =
	| "none"
	| "deferred"
	| "existing_authority";
export type BootstrapDisposition = "not_required" | "initialized" | "complete";

export interface AssuranceRouteProjection {
	task_id: string;
	phase: string;
	next_action?: string;
}

export interface ManagedRequestClassification {
	phase: ManagedRoutePhase;
	intent: ManagedRequestIntent;
	enrollment: EnrollmentDisposition;
	reason: string;
}

export interface ManagedRequestRoute extends ManagedRequestClassification {
	contract: "immune_brain/managed_request_route/v1";
	mode: "standard" | "fast-track";
	bootstrap: BootstrapDisposition;
	authority: "none" | "preserved";
	task_id?: string;
	assurance?: AssuranceRouteProjection;
}

export interface ManagedRequestInput {
	root: string;
	request: string;
	task_id?: string;
	assurance?: AssuranceRouteProjection;
	fast_track?: boolean;
}

export type ManagedBootstrapStatus = "absent" | "complete" | "partial" | "incompatible";

export interface ManagedBootstrapInspection {
	status: ManagedBootstrapStatus;
	missing: string[];
	present: string[];
	reason: string | null;
}

export const MANAGED_BOOTSTRAP_DIRECTORIES = [
	".imm/memory",
	"docs/specs",
	"docs/brainstorms",
	"docs/plans",
] as const;

export const MANAGED_BOOTSTRAP_FILES = {
	"AGENTS.md": "AGENTS.md",
	"IMMUNE.md": "IMMUNE.template.md",
	"CONTEXT.md": "CONTEXT.template.md",
	".imm/memory/MEMORY.md": "MEMORY.md",
} as const;

const IMMUNE_START = "<!-- IMMUNE-BRAIN:START -->";
const IMMUNE_END = "<!-- IMMUNE-BRAIN:END -->";
const TEMPLATE_ROOT = resolve(__dirname, "bootstrap-templates");

const MUTATION_PATTERN =
	/\b(?:implement|add|build|create|make|develop|introduce|enable|support|ensure|fix|change|update|modify|refactor|remove|delete|write|ship|migrate|rename|move|replace|upgrade|improve|polish|optimi[sz]e|clean(?:\s+up)?)\b|实现|添加|增加|构建|开发|引入|启用|支持|确保|创建|修复|修改|重构|删除|编写|迁移|重命名|移动|替换|升级|改进|优化|清理/i;
const PLAN_PATTERN =
	/\b(?:plan|planning|roadmap|spec(?:ification)?|design)\b|计划|规划|方案|设计/i;
const MUTATION_FOLLOWUP_PATTERN =
	/\b(?:and|then|also|plus)\s+(?:implement|add|build|create|make|develop|introduce|enable|support|ensure|fix|change|update|modify|refactor|remove|delete|write|ship|migrate|rename|move|replace|upgrade|improve|polish|optimi[sz]e|clean(?:\s+up)?)\b|(?:并且|然后|同时|以及)(?:实现|添加|构建|创建|修复|修改|重构|删除|编写|迁移|重命名|移动|替换|升级|改进|优化|清理)/i;
const PLAN_REQUEST_PATTERN =
	/\b(?:create|write|make|draft|give)\s+(?:me\s+)?(?:a\s+)?(?:plan|roadmap|spec(?:ification)?|design)\b|(?:plan|roadmap|spec(?:ification)?|design)\s+(?:for|of)\b|(?:计划|规划|方案|设计)/i;
const READ_ONLY_PATTERN =
	/\b(?:explain|describe|how\s+(?:does|do|is)|why\s+(?:does|do|is)|what\s+is|show|tell\s+me|inspect|analy[sz]e|diagnose|review|audit)\b|解释|说明|如何|为什么|查看|分析|诊断|审查|审核|只读/i;
const NO_MODIFICATION_PATTERN =
	/\b(?:do\s+not|don't|without|no)\s+(?:change|modify|edit|write|implement|touch|code)\b|\b(?:read[- ]only|no\s+code\s+changes?)\b|不要(?:修改|改动|编辑)|无需修改|不改(?:代码|文件)?|仅(?:解释|查看|审查|规划)/i;
const UNCERTAINTY_PATTERN =
	/\b(?:not\s+sure|unsure|unclear|uncertain|maybe|might|help\s+me\s+decide|which\s+should|what\s+should|explore)\b|不确定|不清楚|不知道|可能|帮我判断|该怎么选|探索/i;
const TERMINAL_ASSURANCE_PHASES = new Set([
	"done",
	"stopped",
	"cancelled",
	"superseded",
	"terminal",
]);

function template(name: string): string {
	return readFileSync(join(TEMPLATE_ROOT, name), "utf8");
}

function allManagedPaths(root: string): string[] {
	return [
		...MANAGED_BOOTSTRAP_DIRECTORIES,
		...Object.keys(MANAGED_BOOTSTRAP_FILES),
	];
}

function pathExists(root: string, relativePath: string): boolean {
	return existsSync(join(root, relativePath));
}

function symlinkInPath(root: string, relativePath: string): string | null {
	let current = root;
	for (const component of relativePath.split("/")) {
		current = join(current, component);
		try {
			if (lstatSync(current).isSymbolicLink()) return current;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			return current;
		}
	}
	return null;
}

function validateBootstrapFile(relativePath: string, content: string): string | null {
	if (relativePath === "AGENTS.md") {
		if (!content.includes(IMMUNE_START) || !content.includes(IMMUNE_END)) {
			return "AGENTS.md has an incompatible Immune-Brain bounded section";
		}
		return null;
	}
	if (relativePath === "IMMUNE.md" && !content.includes("Managed Path")) {
		return "IMMUNE.md has an incompatible Managed Path route contract";
	}
	if (relativePath === "CONTEXT.md" && !content.includes("# Project Context")) {
		return "CONTEXT.md has an incompatible project context schema";
	}
	if (
		relativePath === ".imm/memory/MEMORY.md" &&
		!content.includes("# MEMORY.md")
	) {
		return ".imm/memory/MEMORY.md has an incompatible memory schema";
	}
	return null;
}

export function inspectManagedBootstrap(root: string): ManagedBootstrapInspection {
	const resolvedRoot = resolve(root);
	const allPaths = allManagedPaths(resolvedRoot);
	const present = allPaths.filter((path) => pathExists(resolvedRoot, path));
	const missing = allPaths.filter((path) => !pathExists(resolvedRoot, path));
	for (const relativePath of allPaths) {
		const symlinkPath = symlinkInPath(resolvedRoot, relativePath);
		if (symlinkPath) {
			return {
				status: "incompatible",
				missing,
				present,
				reason: `${symlinkPath} must not be a symbolic link`,
			};
		}
	}
	if (present.length === 0) {
		return { status: "absent", missing, present, reason: null };
	}
	if (missing.length > 0) {
		return {
			status: "partial",
			missing,
			present,
			reason: `partial Immune-Brain state; missing ${missing.join(", ")}`,
		};
	}
	for (const relativePath of MANAGED_BOOTSTRAP_DIRECTORIES) {
		try {
			if (!lstatSync(join(resolvedRoot, relativePath)).isDirectory()) {
				return {
					status: "incompatible",
					missing,
					present,
					reason: `${relativePath} is not a directory`,
				};
			}
		} catch {
			return {
				status: "incompatible",
				missing,
				present,
				reason: `${relativePath} cannot be inspected`,
			};
		}
	}
	for (const relativePath of Object.keys(MANAGED_BOOTSTRAP_FILES)) {
		try {
			if (!lstatSync(join(resolvedRoot, relativePath)).isFile()) {
				return {
					status: "incompatible",
					missing,
					present,
					reason: `${relativePath} is not a regular file`,
				};
			}
			const reason = validateBootstrapFile(
				relativePath,
				readFileSync(join(resolvedRoot, relativePath), "utf8"),
			);
			if (reason) {
				return { status: "incompatible", missing, present, reason };
			}
		} catch {
			return {
				status: "incompatible",
				missing,
				present,
				reason: `${relativePath} cannot be read`,
			};
		}
	}
	return { status: "complete", missing, present, reason: null };
}

export function ensureManagedBootstrap(root: string): BootstrapDisposition {
	const resolvedRoot = resolve(root);
	const inspection = inspectManagedBootstrap(resolvedRoot);
	if (inspection.status === "complete") return "complete";
	if (inspection.status === "partial" || inspection.status === "incompatible") {
		throw new Error(inspection.reason ?? "Immune-Brain bootstrap state is invalid");
	}
	const files = Object.entries(MANAGED_BOOTSTRAP_FILES).map(([relativePath, templateName]) => ({
		relativePath,
		content: template(templateName),
	}));
	for (const relativePath of MANAGED_BOOTSTRAP_DIRECTORIES) {
		mkdirSync(join(resolvedRoot, relativePath), { recursive: true });
	}
	for (const file of files) {
		writeFileSync(join(resolvedRoot, file.relativePath), file.content, "utf8");
	}
	return "initialized";
}

export function classifyManagedRequest(request: string): ManagedRequestClassification {
	const text = request.trim();
	if (!text) {
		return {
			phase: "none",
			intent: "unknown",
			enrollment: "none",
			reason: "empty_request",
		};
	}
	const explicitNoModification = NO_MODIFICATION_PATTERN.test(text);
	const mutation = MUTATION_PATTERN.test(text);
	const planningRequest = PLAN_REQUEST_PATTERN.test(text);
	const planningOnly =
		planningRequest &&
		!/\b(?:and|then)\s+(?:implement|add|build|create|fix|change|update|modify|refactor|remove|delete)\b/i.test(text);
	const readOnly =
		READ_ONLY_PATTERN.test(text) &&
		!(mutation && MUTATION_FOLLOWUP_PATTERN.test(text));
	if (explicitNoModification || readOnly) {
		return {
			phase: "none",
			intent: explicitNoModification ? "read_only" : "review_only",
			enrollment: "none",
			reason: explicitNoModification ? "explicit_no_modification" : "read_only_request",
		};
	}
	if (planningOnly || (PLAN_PATTERN.test(text) && !mutation)) {
		return {
			phase: "planner",
			intent: "planning",
			enrollment: "none",
			reason: "planning_only_request",
		};
	}
	if (mutation && UNCERTAINTY_PATTERN.test(text)) {
		return {
			phase: "brainstorm",
			intent: "ambiguous_mutation",
			enrollment: "none",
			reason: "material_mutation_ambiguity",
		};
	}
	if (mutation) {
		return {
			phase: "planner",
			intent: "implementation",
			enrollment: "deferred",
			reason: "new_mutation_request",
		};
	}
	if (planningOnly || PLAN_PATTERN.test(text)) {
		return {
			phase: "planner",
			intent: "planning",
			enrollment: "none",
			reason: "planning_request",
		};
	}
	return {
		phase: "none",
		intent: "unknown",
		enrollment: "none",
		reason: "no_managed_mutation_detected",
	};
}

function routeFromAssurance(
	input: ManagedRequestInput,
): ManagedRequestRoute | null {
	const assurance = input.assurance;
	if (!assurance) return null;
	if (!assurance.task_id || !assurance.phase) {
		throw new Error("Assurance projection is missing task identity or phase");
	}
	if (input.task_id && input.task_id !== assurance.task_id) {
		throw new Error("Assurance projection task identity does not match request task identity");
	}
	if (TERMINAL_ASSURANCE_PHASES.has(assurance.phase)) {
		if (assurance.next_action === "repair_authority_state") {
			return {
				contract: "immune_brain/managed_request_route/v1",
				phase: "loop",
				intent: "implementation",
				enrollment: "existing_authority",
				reason: "resume_assurance_projection",
				mode: input.fast_track ? "fast-track" : "standard",
				bootstrap: "not_required",
				authority: "preserved",
				task_id: assurance.task_id,
				assurance: { ...assurance },
			};
		}
		return {
			contract: "immune_brain/managed_request_route/v1",
			phase: "none",
			intent: "implementation",
			enrollment: "none",
			reason: "assurance_terminal",
			mode: "standard",
			bootstrap: "not_required",
			authority: "none",
			task_id: assurance.task_id,
			assurance: { ...assurance, next_action: "none" },
		};
	}
	return {
		contract: "immune_brain/managed_request_route/v1",
		phase: "loop",
		intent: "implementation",
		enrollment: "existing_authority",
		reason: "resume_assurance_projection",
		mode: input.fast_track ? "fast-track" : "standard",
		bootstrap: "not_required",
		authority: "preserved",
		task_id: assurance.task_id,
		assurance: { ...assurance },
	};
}

export function routeManagedRequest(input: ManagedRequestInput): ManagedRequestRoute {
	const assuranceRoute = routeFromAssurance(input);
	if (assuranceRoute) {
		return {
			...assuranceRoute,
			bootstrap: assuranceRoute.phase === "none"
				? "not_required"
				: ensureManagedBootstrap(input.root),
		};
	}
	const classification = classifyManagedRequest(input.request);
	if (classification.phase === "none") {
		return {
			contract: "immune_brain/managed_request_route/v1",
			...classification,
			mode: "standard",
			bootstrap: "not_required",
			authority: "none",
		};
	}
	return {
		contract: "immune_brain/managed_request_route/v1",
		...classification,
		mode: input.fast_track ? "fast-track" : "standard",
		bootstrap: ensureManagedBootstrap(input.root),
		authority: "preserved",
		...(input.task_id ? { task_id: input.task_id } : {}),
	};
}
