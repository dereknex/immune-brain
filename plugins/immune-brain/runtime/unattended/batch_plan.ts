import { createHash } from "node:crypto";
import { stableStringify } from "../canonical_json";
import { observeGithubInitiative } from "../github_issue_tracker";
import { hasLocalInitiative, observeLocalInitiative } from "../local_initiative";
import { readTaskTombstone } from "../kernel/backend_claim";
import {
	observeTaskIntent,
	TaskIntentObservationError,
} from "../kernel/intent";
import { readTaskRecordRaw } from "../kernel/storage";
import { inspectSpecBinding, type SpecBindingInspection } from "../kernel/spec_binding";
import { projectParallelGroups } from "./batch_schedule";
import type {
	BatchPlan,
	BatchPlanBudget,
	BatchPlanChild,
	BatchPlanChildReason,
	BatchPlanDigestChild,
	InitiativeObservation,
	InitiativeObservationReader,
	ProjectBatchPlanInput,
} from "./types";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFAULT_QA_FAILURE_LIMIT = 2;

/**
 * Enrollment refuses a child whose scope_hint cannot name its bound Spec pair,
 * so the plan excludes the same children here, before a confirmation offers
 * them and before an Executor writes their implementation. The reason carries a
 * stable code plus every path the intent must add. Advisory only: this mints,
 * alters, and consumes no authority.
 */
function specBindingReason(inspection: Extract<SpecBindingInspection, { ok: false }>): BatchPlanChildReason {
	// One shared branch renders the concrete paths of every refusal that carries
	// them — a `binding_missing` whose declared halves never paired included.
	// `binding_incomplete` always carries paths, so it has no entry of its own.
	if (inspection.missing.length > 0) return `spec_binding_incomplete: ${inspection.missing.join(", ")}`;
	return inspection.code === "binding_ambiguous" ? "spec_binding_ambiguous" : "spec_binding_missing";
}

function compareIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0)
		throw new Error(`${name} must be a positive safe integer`);
	return value as number;
}

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function timestamp(value: unknown, name: string): { milliseconds: number; iso: string } {
	if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value))
		throw new Error(`${name} must be an ISO timestamp`);
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds))
		throw new Error(`${name} must be an ISO timestamp`);
	return { milliseconds, iso: new Date(milliseconds).toISOString() };
}

/**
 * The Initiative's carrier decides the reader: a Local carrier file owns its
 * slug and is read with no GitHub operation; every other slug is a GitHub one.
 */
export const observeInitiative: InitiativeObservationReader = async (root, initiativeSlug) =>
	hasLocalInitiative(root, initiativeSlug)
		? observeLocalInitiative(root, initiativeSlug)
		: observeGithubInitiative(root, initiativeSlug);

function normalizeObservation(value: InitiativeObservation, initiativeSlug: string): InitiativeObservation {
	const local = value?.contract === "immune_brain/local_initiative_observation/v1";
	if (!value || (!local && value.contract !== "immune_brain/github_initiative_observation/v1"))
		throw new Error("tracker returned an invalid Initiative observation contract");
	if (value.initiative_id !== initiativeSlug)
		throw new Error("tracker returned an observation for another Initiative");
	if (!local && (!Number.isSafeInteger(value.issue_number) || value.issue_number <= 0))
		throw new Error("tracker returned an invalid Initiative Issue number");
	if (!Array.isArray(value.tasks)) throw new Error("tracker returned an invalid Initiative Task list");
	const taskIds = new Set<string>();
	const sliceIds = new Set<string>();
	const tasks = value.tasks.map((task, index) => {
		if (!task || typeof task !== "object") throw new Error(`tracker Task ${index} is invalid`);
		if (!ID_PATTERN.test(task.task_id)) throw new Error(`tracker Task ${index} has an invalid task_id`);
		if (!ID_PATTERN.test(task.slice_id)) throw new Error(`tracker Task ${index} has an invalid slice_id`);
		const issueNumber = (task as { issue_number?: number }).issue_number;
		if (!local && (!Number.isSafeInteger(issueNumber) || issueNumber! <= 0))
			throw new Error(`tracker Task ${task.task_id} has an invalid Issue number`);
		if (!Array.isArray(task.blocked_by) || task.blocked_by.some((id) => typeof id !== "string" || !ID_PATTERN.test(id)))
			throw new Error(`tracker Task ${task.task_id} has invalid blocked_by dependencies`);
		if (taskIds.has(task.task_id)) throw new Error(`tracker returned duplicate Task ${task.task_id}`);
		if (sliceIds.has(task.slice_id)) throw new Error(`tracker returned duplicate Slice ${task.slice_id}`);
		taskIds.add(task.task_id);
		sliceIds.add(task.slice_id);
		const blockedBy = [...task.blocked_by].sort();
		if (new Set(blockedBy).size !== blockedBy.length || blockedBy.includes(task.task_id))
			throw new Error(`tracker Task ${task.task_id} has invalid blocked_by dependencies`);
		return { ...task, blocked_by: blockedBy };
	});
	for (const task of tasks) {
		const unknown = task.blocked_by.find((id) => !taskIds.has(id));
		if (unknown) throw new Error(`tracker Task ${task.task_id} depends on unknown Task ${unknown}`);
	}
	return { ...value, tasks: tasks.sort((left, right) => compareIds(left.task_id, right.task_id)) } as InitiativeObservation;
}

type ObservedTask = { task_id: string; slice_id: string; blocked_by: string[] };

function dependencyOrder(observation: InitiativeObservation): ObservedTask[] {
	const remaining = new Map<string, ObservedTask>(observation.tasks.map((task) => [task.task_id, task]));
	const done = new Set<string>();
	const order: ObservedTask[] = [];
	while (remaining.size) {
		const ready = [...remaining.values()]
			.filter((task) => task.blocked_by.every((id) => done.has(id)))
			.sort((left, right) => compareIds(left.task_id, right.task_id));
		if (!ready.length) throw new Error("Initiative Task dependencies must form an acyclic graph");
		for (const task of ready) {
			remaining.delete(task.task_id);
			done.add(task.task_id);
			order.push(task);
		}
	}
	return order;
}

function dependencyClosures(order: ObservedTask[]): Map<string, string[]> {
	const closures = new Map<string, string[]>();
	for (const task of order) {
		const closure = new Set<string>();
		for (const dependency of task.blocked_by) {
			closure.add(dependency);
			for (const transitive of closures.get(dependency) ?? []) closure.add(transitive);
		}
		closures.set(task.task_id, [...closure].sort());
	}
	return closures;
}

function budget(input: ProjectBatchPlanInput, enrollableCount: number): BatchPlanBudget {
	const maxChildren = input.budget?.max_children === undefined
		? positiveSafeInteger(enrollableCount, "budget.max_children")
		: positiveSafeInteger(input.budget.max_children, "budget.max_children");
	if (maxChildren > enrollableCount)
		throw new Error("budget.max_children exceeds the enrollable Child count");
	const qaFailureLimit = input.budget?.qa_failure_limit === undefined
		? DEFAULT_QA_FAILURE_LIMIT
		: positiveSafeInteger(input.budget.qa_failure_limit, "budget.qa_failure_limit");
	return { max_children: maxChildren, qa_failure_limit: qaFailureLimit };
}

export async function projectBatchPlan(
	root: string,
	initiativeSlug: string,
	input: ProjectBatchPlanInput,
	readInitiative: InitiativeObservationReader = observeInitiative,
): Promise<BatchPlan> {
	if (!ID_PATTERN.test(initiativeSlug)) throw new Error("initiative_slug is invalid");
	if (!input || typeof input !== "object") throw new Error("batch plan input is required");
	const confirmationTime = timestamp(input.confirmation_time, "confirmation_time");
	const trackerObservation = normalizeObservation(await readInitiative(root, initiativeSlug), initiativeSlug);
	const order = dependencyOrder(trackerObservation);
	const closures = dependencyClosures(order);
	const children: BatchPlanChild[] = [];
	const scopeHints = new Map<string, string[]>();
	for (const task of order) {
		const blockedBy = closures.get(task.task_id)!;
		const child = { task_id: task.task_id, slice_id: task.slice_id, blocked_by: blockedBy };
		const tombstone = readTaskTombstone(root, task.task_id);
		const record = readTaskRecordRaw(root, task.task_id).record;
		if (tombstone && record) throw new Error(`Task ${task.task_id} has conflicting settled and active state`);
		if (tombstone) {
			children.push({ ...child, status: "already_settled", reason: null, intent_path: null, intent_revision: null, intent_content_hash: null });
			continue;
		}
		if (record) {
			children.push({ ...child, status: "already_owned", reason: null, intent_path: null, intent_revision: null, intent_content_hash: null });
			continue;
		}
		const intentPath = `docs/plans/${task.task_id}.intent.json`;
		try {
			const read = observeTaskIntent(root, task.task_id, intentPath);
			if (read.intent.risk === "critical") {
				children.push({
					...child,
					status: "needs_human",
					reason: "critical",
					intent_path: read.intent_ref.path,
					intent_revision: read.intent_ref.revision,
					intent_content_hash: read.content_hash,
				});
				continue;
			}
			const binding = inspectSpecBinding(read.intent);
			if (!binding.ok) {
				children.push({
					...child,
					status: "needs_human",
					reason: specBindingReason(binding),
					intent_path: read.intent_ref.path,
					intent_revision: read.intent_ref.revision,
					intent_content_hash: read.content_hash,
				});
				continue;
			}
			scopeHints.set(task.task_id, [...read.intent.scope_hint]);
			children.push({
				...child,
				status: "enrollable",
				reason: null,
				intent_path: read.intent_ref.path,
				intent_revision: read.intent_ref.revision,
				intent_content_hash: read.content_hash,
			});
		} catch (error) {
			if (!(error instanceof TaskIntentObservationError)) throw error;
			children.push({ ...child, status: "needs_human", reason: "invalid_intent", intent_path: null, intent_revision: null, intent_content_hash: null });
		}
	}
	const directDependencies = new Map(order.map((task) => [task.task_id, task.blocked_by]));
	const childById = new Map(children.map((child) => [child.task_id, child]));
	for (const child of children) {
		if (child.status !== "enrollable") continue;
		if (directDependencies.get(child.task_id)!.some((id) => {
			const status = childById.get(id)!.status;
			return status === "already_owned" || status === "needs_human" || status === "blocked";
		})) {
			child.status = "blocked";
			child.reason = "dependency_unavailable";
		}
	}
	const enrollable: BatchPlanDigestChild[] = children
		.filter((child) => child.status === "enrollable")
		.map((child) => ({
			task_id: child.task_id,
			intent_path: child.intent_path!,
			intent_revision: child.intent_revision!,
			intent_content_hash: child.intent_content_hash!,
			blocked_by: child.blocked_by.filter((id) => childById.get(id)?.status === "enrollable"),
		}));
	if (!enrollable.length)
		throw new Error("batch plan has no enrollable children; nothing to confirm");
	const planDigest = `sha256:${createHash("sha256").update(stableStringify(enrollable)).digest("hex")}`;
	return {
		contract: "assurance_kernel/batch_plan/v1",
		initiative_slug: initiativeSlug,
		confirmation_time: confirmationTime.iso,
		tracker_observation: trackerObservation,
		children,
		enrollable,
		plan_digest: planDigest,
		budget: budget(input, enrollable.length),
		...projectParallelGroups(
			enrollable.map((child) => ({
				task_id: child.task_id,
				blocked_by: child.blocked_by,
				scope_hint: scopeHints.get(child.task_id)!,
			})),
		),
	};
}
