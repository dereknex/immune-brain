/**
 * Loop Daemon: Work Items (S5)
 *
 * Implements D5 of docs/specs/loop-agent-scheduling.spec.md. One rebuildable
 * state machine per Loop target under `.imm/state/loop/work_items/<target>.json`.
 * This store is orchestration state, never authority (ADR 0039 Decision 4):
 * `rebuildWorkItems()` reconstructs it from GitHub and the Kernel.
 *
 * A level event (E5, E6, E8, E9, E11) is judged only when its fact fingerprint
 * differs from `last_judged`; an edge event keeps its `event_id` deduplication.
 */

import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { observeEnrollmentTaskIntent } from "../kernel/intent.ts";
import { readPlanPublication } from "./agent_handlers.ts";
import { eventTarget } from "./guards.ts";
import type { LoopHandler } from "./handlers.ts";
import type { NormalizedLoopEvent, ObservationInput } from "./types.ts";

export const LOOP_WORK_ITEM_CONTRACT = "assurance_kernel/loop_work_item/v1" as const;

/** The D5 state machine. */
export type WorkItemState =
	| "triage"
	| "clarifying"
	| "awaiting_input"
	| "planning"
	| "plan_published"
	| "driving"
	| "pr_open"
	| "repairing"
	| "ready_for_merge"
	| "closed"
	| "escalated";

export const WORK_ITEM_TRANSITIONS: Readonly<Record<WorkItemState, readonly WorkItemState[]>> = {
	triage: ["clarifying", "planning", "escalated"],
	clarifying: ["awaiting_input", "planning", "escalated"],
	awaiting_input: ["clarifying", "driving"],
	// D8: a plan that cannot be finalised without the clarify framing returns to
	// `clarifying`, so the question has somewhere to park.
	planning: ["clarifying", "plan_published", "escalated"],
	plan_published: ["driving"],
	driving: ["awaiting_input", "pr_open", "escalated"],
	pr_open: ["repairing", "ready_for_merge"],
	repairing: ["pr_open", "escalated"],
	ready_for_merge: ["closed"],
	closed: [],
	escalated: ["triage"],
};

/** The state one handler moves its target to; `null` handlers move nothing. */
const HANDLER_STATES: Partial<Record<LoopHandler, WorkItemState>> = {
	clarify_issue: "clarifying",
	apply_clarify_reply: "clarifying",
	draft_plan: "planning",
	publish_plan_for_approval: "plan_published",
	enroll_and_drive: "driving",
	relay_lane_decision_question: "awaiting_input",
	apply_lane_decision_reply: "driving",
	open_pr: "pr_open",
	repair_pr_ci: "repairing",
	repair_pr_conflict: "repairing",
	address_pr_review: "repairing",
	mark_pr_ready: "ready_for_merge",
	close_out: "closed",
	escalate: "escalated",
};

export function handlerWorkItemState(handler: LoopHandler): WorkItemState | null {
	return HANDLER_STATES[handler] ?? null;
}

export interface WorkItemRefusal {
	from: WorkItemState;
	to: WorkItemState;
	handler: LoopHandler | null;
	reason: string;
	recorded_at: string;
}

export interface WorkItem {
	contract: typeof LOOP_WORK_ITEM_CONTRACT;
	target: string;
	state: WorkItemState;
	revision: number;
	binding: {
		plan_digest: string | null;
		task_ids: string[];
		run_id: string | null;
		pr: number | null;
	};
	pending_interactions: string[];
	jobs: string[];
	/** Per judged key: level-event fingerprints and edge-event ids. */
	last_judged: Record<string, string>;
	refused_transitions: WorkItemRefusal[];
	updated_at: string;
}

const MAX_REFUSALS = 20;

export function workItemsDir(stateDir: string): string {
	return join(stateDir, "work_items");
}

function workItemPath(stateDir: string, target: string): string {
	return join(workItemsDir(stateDir), `${target}.json`);
}

function ensureWorkItemsDir(stateDir: string): string {
	const directory = workItemsDir(stateDir);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	try {
		chmodSync(directory, 0o700);
	} catch {}
	return directory;
}

export function readWorkItem(stateDir: string, target: string): WorkItem | null {
	try {
		const parsed = JSON.parse(readFileSync(workItemPath(stateDir, target), "utf8")) as WorkItem;
		if (parsed?.contract === LOOP_WORK_ITEM_CONTRACT && parsed.target === target && parsed.state in WORK_ITEM_TRANSITIONS) {
			return parsed;
		}
	} catch {}
	return null;
}

export function listWorkItems(stateDir: string): WorkItem[] {
	const directory = workItemsDir(stateDir);
	if (!existsSync(directory)) return [];
	const items: WorkItem[] = [];
	for (const file of readdirSync(directory)) {
		if (!file.endsWith(".json")) continue;
		const item = readWorkItem(stateDir, file.slice(0, -".json".length));
		if (item) items.push(item);
	}
	return items;
}

export function writeWorkItem(stateDir: string, item: WorkItem): void {
	ensureWorkItemsDir(stateDir);
	const target = workItemPath(stateDir, item.target);
	const temp = join(workItemsDir(stateDir), `${item.target}.${randomUUID()}.tmp`);
	writeFileSync(temp, `${JSON.stringify(item, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(temp, 0o600);
	} catch {}
	renameSync(temp, target);
	try {
		chmodSync(target, 0o600);
	} catch {}
}

export function newWorkItem(target: string, state: WorkItemState, now: string): WorkItem {
	return {
		contract: LOOP_WORK_ITEM_CONTRACT,
		target,
		state,
		revision: 1,
		binding: { plan_digest: null, task_ids: [], run_id: null, pr: null },
		pending_interactions: [],
		jobs: [],
		last_judged: {},
		refused_transitions: [],
		updated_at: now,
	};
}

export function isLegalWorkItemTransition(from: WorkItemState, to: WorkItemState): boolean {
	return from === to || WORK_ITEM_TRANSITIONS[from].includes(to);
}

/** Move one item; an illegal transition is recorded and refused, leaving the state unchanged. */
export function advanceWorkItem(
	item: WorkItem,
	to: WorkItemState,
	options: { handler?: LoopHandler | null; reason?: string; now: string },
): { item: WorkItem; refused: boolean } {
	if (isLegalWorkItemTransition(item.state, to)) {
		return {
			item: { ...item, state: to, revision: item.revision + 1, updated_at: options.now },
			refused: false,
		};
	}
	const refusal: WorkItemRefusal = {
		from: item.state,
		to,
		handler: options.handler ?? null,
		reason: options.reason ?? "illegal work item transition",
		recorded_at: options.now,
	};
	return {
		item: {
			...item,
			revision: item.revision + 1,
			refused_transitions: [...item.refused_transitions, refusal].slice(-MAX_REFUSALS),
			updated_at: options.now,
		},
		refused: true,
	};
}

export function workItemTarget(event: NormalizedLoopEvent): string {
	const target = eventTarget(event);
	return `${target.kind}-${target.id}`;
}

/**
 * Record one judged decision on its target's work item. A freshly observed
 * published plan reaches `plan_published` before any handler moves the item.
 */
export function recordWorkItemOutcome(
	stateDir: string,
	input: {
		event: NormalizedLoopEvent;
		handler: LoopHandler;
		plan_digest: string | null;
		now: string;
	},
): { item: WorkItem | null; refused: boolean } {
	const next = handlerWorkItemState(input.handler);
	const target = workItemTarget(input.event);
	let item = readWorkItem(stateDir, target);
	if (!item && next === null) return { item: null, refused: false };
	item ??= newWorkItem(target, "triage", input.now);

	let refused = false;
	if (input.plan_digest && item.binding.plan_digest !== input.plan_digest) {
		item = { ...item, binding: { ...item.binding, plan_digest: input.plan_digest } };
	}
	// D7: the bound task ids are the scheduler's scope evidence, so an event that
	// names its task binds it before the next tick schedules the target.
	const eventTaskId = "task_id" in input.event ? input.event.task_id : null;
	if (typeof eventTaskId === "string" && eventTaskId && !item.binding.task_ids.includes(eventTaskId)) {
		item = { ...item, binding: { ...item.binding, task_ids: [...item.binding.task_ids, eventTaskId] } };
	}
	if (item.state === "planning" && item.binding.plan_digest) {
		item = advanceWorkItem(item, "plan_published", {
			reason: "published plan observed",
			now: input.now,
		}).item;
	}
	if (next !== null) {
		const moved = advanceWorkItem(item, next, {
			handler: input.handler,
			reason: `handler ${input.handler}`,
			now: input.now,
		});
		item = moved.item;
		refused = moved.refused;
	}
	writeWorkItem(stateDir, item);
	return { item, refused };
}

/** Issue number -> the clarify interaction that Issue waits on. Read-only. */
export function pendingClarifyInteractions(stateDir: string): Record<number, string> {
	const pending: Record<number, string> = {};
	for (const item of listWorkItems(stateDir)) {
		const issue = /^issue-(\d+)$/.exec(item.target);
		const interaction = item.pending_interactions[0];
		if (issue && item.state === "awaiting_input" && interaction) pending[Number(issue[1])] = interaction;
	}
	return pending;
}

/** Park one target on its clarify question: the interaction it waits for, in `awaiting_input`. */
export function parkOnClarifyQuestion(
	stateDir: string,
	target: string,
	interactionId: string,
	now: string,
): WorkItem {
	let item = readWorkItem(stateDir, target) ?? newWorkItem(target, "clarifying", now);
	if (item.state === "planning") {
		item = advanceWorkItem(item, "clarifying", {
			reason: `clarify question ${interactionId} re-opens the framing`,
			now,
		}).item;
	}
	const moved = advanceWorkItem(item, "awaiting_input", { reason: `clarify question ${interactionId} posted`, now }).item;
	const next: WorkItem = { ...moved, pending_interactions: [interactionId] };
	writeWorkItem(stateDir, next);
	return next;
}

/** Leave `awaiting_input` for planning once the clarify answer produced a framing. */
export function releaseClarifyWait(stateDir: string, target: string, now: string): WorkItem {
	const item = readWorkItem(stateDir, target) ?? newWorkItem(target, "clarifying", now);
	let next: WorkItem = { ...item, pending_interactions: [] };
	if (next.state === "awaiting_input") {
		next = advanceWorkItem(next, "clarifying", { reason: "clarify answer applied", now }).item;
	}
	next = advanceWorkItem(next, "planning", { reason: "clarify framing ready", now }).item;
	writeWorkItem(stateDir, next);
	return next;
}

/** Record that a target's plan is published (D5: `planning` -> `plan_published`). */
export function markPlanPublished(
	stateDir: string,
	target: string,
	planDigest: string,
	now: string,
): WorkItem {
	const item = readWorkItem(stateDir, target) ?? newWorkItem(target, "planning", now);
	let next: WorkItem = { ...item, binding: { ...item.binding, plan_digest: planDigest } };
	if (next.state === "awaiting_input") {
		next = advanceWorkItem(next, "clarifying", { reason: "clarify answer applied", now }).item;
	}
	next = advanceWorkItem(next, "plan_published", { reason: `plan ${planDigest.slice(0, 12)} published`, now }).item;
	writeWorkItem(stateDir, next);
	return next;
}

/**
 * D7 ready buffer: the targets whose plan is published and awaiting execution.
 * The scheduler holds further planning at `max_ready_buffer` of these.
 */
export function plannedWorkItemCount(stateDir: string): number {
	return listWorkItems(stateDir).filter((item) => item.state === "plan_published").length;
}

/**
 * D7 candidate scope: the `scope_hint` of the target's bound TaskIntents, or of
 * the intents its published plan drafted (plan framing) when none is bound yet.
 * An empty result proves nothing about the target, so the scheduler serializes
 * it behind every in-flight lease instead of guessing.
 */
export function workItemScopeHint(root: string, stateDir: string, target: string): string[] {
	const scopes = new Set<string>();
	for (const taskId of readWorkItem(stateDir, target)?.binding.task_ids ?? []) {
		try {
			for (const entry of observeEnrollmentTaskIntent(root, taskId).intent.scope_hint) scopes.add(entry);
		} catch {}
	}
	const issueNumber = /^issue-(\d+)$/.exec(target);
	const plan = issueNumber ? readPlanPublication(stateDir, Number(issueNumber[1])) : null;
	if (plan) {
		for (const intent of plan.intents) {
			for (const entry of intentPathScopeHint(join(plan.worktree_path, intent.path))) scopes.add(entry);
		}
	}
	return [...scopes].sort();
}

/** One drafted TaskIntent's `scope_hint`, or [] when the file is gone or unreadable. */
function intentPathScopeHint(path: string): string[] {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { scope_hint?: unknown };
		return Array.isArray(parsed.scope_hint) ? parsed.scope_hint.filter((entry): entry is string => typeof entry === "string") : [];
	} catch {
		return [];
	}
}

const LEVEL_EVENT_KINDS: ReadonlySet<NormalizedLoopEvent["kind"]> = new Set([
	"E5_READY_TASK",
	"E6_LANE_DECISION_NEEDED",
	"E8_PR_CHECK_FAILED",
	"E9_PR_CONFLICT",
	"E11_PR_READY_OR_MERGED",
]);

export function isLevelEvent(event: NormalizedLoopEvent): boolean {
	return LEVEL_EVENT_KINDS.has(event.kind);
}

/** The fact a level event carries, ignoring the observation timestamp and event id. */
export function factFingerprint(event: NormalizedLoopEvent): string {
	const { timestamp: _timestamp, event_id: _eventId, ...facts } = event as Record<string, unknown> & NormalizedLoopEvent;
	const stable = JSON.stringify(
		Object.fromEntries(Object.entries(facts).sort(([left], [right]) => (left < right ? -1 : 1))),
	);
	return createHash("sha256").update(`${event.kind}:${stable}`).digest("hex");
}

function levelDiscriminator(event: NormalizedLoopEvent): string {
	switch (event.kind) {
		case "E6_LANE_DECISION_NEEDED":
			return `${event.run_id}:${event.record_revision}`;
		case "E8_PR_CHECK_FAILED":
			return event.check_name;
		case "E11_PR_READY_OR_MERGED":
			return event.status;
		default:
			return "";
	}
}

/** The `last_judged` key and the value that must differ before judging again. */
export function judgedKeyAndValue(event: NormalizedLoopEvent): { target: string; key: string; value: string } {
	const target = workItemTarget(event);
	if (isLevelEvent(event)) {
		const discriminator = levelDiscriminator(event);
		const key = discriminator ? `${event.kind}:${target}:${discriminator}` : `${event.kind}:${target}`;
		return { target, key, value: factFingerprint(event) };
	}
	// Edge events deduplicate by their own event id.
	return { target, key: `${event.kind}:${event.event_id}`, value: event.event_id };
}

export interface JudgedEventSelection {
	/** The events this tick must judge; an unchanged fact is not judged twice. */
	events: NormalizedLoopEvent[];
	/** `last_judged` entries to persist after judgement. */
	pending: Array<{ target: string; key: string; value: string }>;
}

export function selectUnjudgedEvents(
	events: readonly NormalizedLoopEvent[],
	stateDir: string,
): JudgedEventSelection {
	const cache = new Map<string, WorkItem | null>();
	const selection: JudgedEventSelection = { events: [], pending: [] };
	for (const event of events) {
		const { target, key, value } = judgedKeyAndValue(event);
		if (!cache.has(target)) cache.set(target, readWorkItem(stateDir, target));
		if (cache.get(target)?.last_judged[key] === value) continue;
		selection.events.push(event);
		selection.pending.push({ target, key, value });
	}
	return selection;
}

/** Persist the fingerprints of the events judged this tick. */
export function recordJudgedEvents(
	selection: JudgedEventSelection,
	stateDir: string,
	now: string,
): void {
	for (const entry of selection.pending) {
		const item = readWorkItem(stateDir, entry.target) ?? newWorkItem(entry.target, "triage", now);
		if (item.last_judged[entry.key] === entry.value) continue;
		writeWorkItem(stateDir, {
			...item,
			revision: item.revision + 1,
			last_judged: { ...item.last_judged, [entry.key]: entry.value },
			updated_at: now,
		});
	}
}

/** The Kernel-side fact a rebuild may read: an active run and its task record. */
export interface KernelWorkItemFact {
	target: string;
	task_ids: string[];
	run_id: string | null;
}

function normalizeLabels(labels?: Array<{ name: string } | string>): string[] {
	if (!Array.isArray(labels)) return [];
	return labels.map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
}

function isReadyIssue(labels: string[]): boolean {
	return labels.includes("ready-for-agent") || labels.includes("status:ready") || labels.includes("imm:ready");
}

/**
 * Rebuild the store from GitHub and the Kernel. Existing files are never
 * overwritten: this only fills targets the store has lost.
 */
export function rebuildWorkItems(
	stateDir: string,
	snapshot: ObservationInput,
	kernelFacts: readonly KernelWorkItemFact[],
	publishedPlanDigests: Record<number, string>,
	now: string,
): WorkItem[] {
	const rebuilt: WorkItem[] = [];
	const existing = new Set(listWorkItems(stateDir).map((item) => item.target));

	for (const issue of snapshot.issues) {
		const target = `issue-${issue.number}`;
		if (existing.has(target)) continue;
		const labels = normalizeLabels(issue.labels);
		const digest = publishedPlanDigests[issue.number] ?? null;
		// A published plan is where the Issue was: it waits on the owner's approval.
		const state: WorkItemState =
			issue.state === "closed" ? "closed" : digest ? "plan_published" : isReadyIssue(labels) ? "planning" : "triage";
		const item = newWorkItem(target, state, now);
		item.binding.plan_digest = digest;
		writeWorkItem(stateDir, item);
		rebuilt.push(item);
		existing.add(target);
	}

	for (const pr of snapshot.pull_requests) {
		const target = `pr-${pr.number}`;
		if (existing.has(target)) continue;
		const merged = pr.state === "merged" || pr.merged;
		const state: WorkItemState = merged ? "closed" : pr.state === "closed" ? "closed" : "pr_open";
		const item = newWorkItem(target, state, now);
		item.binding.pr = pr.number;
		writeWorkItem(stateDir, item);
		rebuilt.push(item);
		existing.add(target);
	}

	for (const fact of kernelFacts) {
		if (existing.has(fact.target)) continue;
		const item = newWorkItem(fact.target, "driving", now);
		item.binding.task_ids = [...fact.task_ids];
		item.binding.run_id = fact.run_id;
		writeWorkItem(stateDir, item);
		rebuilt.push(item);
		existing.add(fact.target);
	}

	return rebuilt;
}

/**
 * Ensure the store exists before scheduling: an absent or empty directory is
 * rebuilt from GitHub and the Kernel instead of being scheduled empty. In a
 * store that has items, a target whose file is missing is rebuilt alone when
 * GitHub or the Kernel still shows where it was (a published plan, an active
 * run), so losing one file does not reset that target to `triage`.
 */
export function ensureWorkItems(
	root: string,
	stateDir: string,
	snapshot: ObservationInput,
	publishedPlanDigests: Record<number, string>,
	now: string,
): WorkItem[] {
	const populated =
		existsSync(workItemsDir(stateDir)) && readdirSync(workItemsDir(stateDir)).some((f) => f.endsWith(".json"));
	if (!populated) return rebuildWorkItems(stateDir, snapshot, scanKernelWorkItems(root), publishedPlanDigests, now);
	const recoverable: ObservationInput = {
		...snapshot,
		issues: snapshot.issues.filter((issue) => publishedPlanDigests[issue.number] !== undefined),
		pull_requests: [],
	};
	return rebuildWorkItems(stateDir, recoverable, scanKernelWorkItems(root), publishedPlanDigests, now);
}

/** Active Kernel runs are the rebuild fixture: `.imm/runs/<id>/{run,task-record}.json`. */
export function scanKernelWorkItems(root: string): KernelWorkItemFact[] {
	const runsDir = join(root, ".imm/runs");
	if (!existsSync(runsDir)) return [];
	const facts: KernelWorkItemFact[] = [];
	for (const entry of readdirSync(runsDir)) {
		for (const file of ["run.json", "task-record.json"]) {
			const path = join(runsDir, entry, file);
			if (!existsSync(path)) continue;
			try {
				const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
				const active =
					record.lifecycle === "active" || record.artifact_state === "active" || record.status === "active";
				if (!active) continue;
				const issueNumber = record.issue_number ?? record.target_issue;
				const taskId = typeof record.task_id === "string" ? record.task_id : null;
				const target = issueNumber ? `issue-${issueNumber}` : taskId ? `lane-${taskId}` : null;
				if (!target) continue;
				facts.push({
					target,
					task_ids: taskId ? [taskId] : [],
					run_id: typeof record.run_id === "string" ? record.run_id : null,
				});
				break;
			} catch {}
		}
	}
	return facts;
}
