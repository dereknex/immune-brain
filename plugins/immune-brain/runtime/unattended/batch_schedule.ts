// Pure scheduling for unattended batches: only declared dependencies and the
// parallelism limit constrain starts. Scope hints remain planning evidence.
export {
	dependencyWaves,
	overlappingScopeEntries,
	projectParallelGroups,
	projectScopeOverlap,
	scopesOverlap,
	type PlanScheduleChild,
	type ScopeOverlapReport,
} from "../kernel/scope_overlap";

/**
 * Child states the scheduler understands. The serial record (v1) uses
 * `committed`; the lane record names the same milestone `integrated`/`released`
 * and adds the in-flight lane states. Listing both keeps this function usable
 * for either record without a persisted-state change.
 */
export type ScheduleChildState =
	| "pending"
	| "lane_admitted"
	| "enrolled"
	| "settled"
	| "lane_committed"
	| "committed"
	| "integrated"
	| "released"
	| "needs_human"
	| "skipped_blocked";

const IN_FLIGHT_STATES: ReadonlySet<ScheduleChildState> = new Set([
	"lane_admitted",
	"enrolled",
	"settled",
	"lane_committed",
]);

const DONE_STATES: ReadonlySet<ScheduleChildState> = new Set(["committed", "integrated", "released"]);

export interface ScheduleChild {
	task_id: string;
	/** Slice position retained as planning metadata. */
	slice_id?: string;
	state: ScheduleChildState;
	blocked_by: string[];
	scope_hint: string[];
}

const PARKED_STATES = new Set(["needs_human", "skipped_blocked"]);

/** Pending children transitively blocked by a parked declared prerequisite. */
export function blockedByParked(
	children: ReadonlyArray<Pick<ScheduleChild, "task_id" | "slice_id" | "blocked_by" | "scope_hint"> & { state: string }>,
): Map<string, string> {
	const blocker = new Map<string, string>();
	for (const child of children) if (PARKED_STATES.has(child.state)) blocker.set(child.task_id, child.task_id);
	const blocked = new Map<string, string>();
	for (let changed = true; changed;) {
		changed = false;
		for (const child of children) {
			if (child.state !== "pending" || blocker.has(child.task_id)) continue;
			const parked = child.blocked_by.find((id) => blocker.has(id));
			if (parked === undefined) continue;
			blocker.set(child.task_id, blocker.get(parked)!);
			blocked.set(child.task_id, blocker.get(parked)!);
			changed = true;
		}
	}
	return blocked;
}

/**
 * Pending children whose declared dependencies are done, up to the free slots.
 * `maxParallel` arrives already validated (`parseMaxParallel`, record check).
 */
export function startableChildren(children: readonly ScheduleChild[], maxParallel: number): string[] {
	const done = new Set(children.filter((child) => DONE_STATES.has(child.state)).map((child) => child.task_id));
	const occupied = children.filter((child) => IN_FLIGHT_STATES.has(child.state));
	const startable: string[] = [];
	for (const child of children) {
		if (occupied.length >= maxParallel) break;
		if (child.state !== "pending") continue;
		if (!child.blocked_by.every((id) => done.has(id))) continue;
		startable.push(child.task_id);
		occupied.push(child);
	}
	return startable;
}
