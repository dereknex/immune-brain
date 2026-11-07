// Pure scheduling for unattended batches: only declared dependencies and the
// parallelism limit constrain starts. Scope hints remain planning evidence.
import type { BatchPlanParallelGroups, BatchPlanScopeConflict } from "./types";

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

const WILDCARD = /[*?[\]{}!]/;

/**
 * Reduce one scope entry to the directory prefix it is certain to live under.
 * A literal path keeps all its segments. A pattern keeps only the whole
 * segments before its first wildcard: `src/foo*` could match `src/foobar/x`, so
 * the partial segment `foo` is not a safe prefix. An empty result means the
 * entry can match anywhere. Anything that is not a plain repository-relative
 * path is also treated as matching anywhere, because disjointness is only ever
 * claimed for entries that can be proved.
 */
function scopePrefix(entry: string): string[] {
	if (typeof entry !== "string") return [];
	let value = entry.trim().toLowerCase();
	while (value.startsWith("./")) value = value.slice(2);
	if (!value || value.startsWith("/") || value.includes("\\")) return [];
	const wildcard = value.search(WILDCARD);
	const literal = wildcard === -1 ? value : value.slice(0, value.lastIndexOf("/", wildcard) + 1);
	const segments = literal.split("/").filter((segment) => segment.length > 0);
	if (segments.some((segment) => segment === "." || segment === "..")) return [];
	return segments;
}

function prefixOverlaps(left: string[], right: string[]): boolean {
	if (!left.length || !right.length) return true;
	const shared = Math.min(left.length, right.length);
	for (let index = 0; index < shared; index += 1) if (left[index] !== right[index]) return false;
	return true;
}

/**
 * Two scope lists overlap unless every pair of entries is provably disjoint:
 * neither entry's directory prefix equals or contains the other. Identical,
 * nested, and wildcard scopes therefore overlap; an empty list proves nothing
 * about the child and overlaps everything.
 */
export function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
	if (!left.length || !right.length) return true;
	const rightPrefixes = right.map(scopePrefix);
	return left.some((entry) => {
		const prefix = scopePrefix(entry);
		return rightPrefixes.some((other) => prefixOverlaps(prefix, other));
	});
}

/**
 * The entry pairs that make two scope lists overlap, in list order: the
 * machine evidence behind `scopesOverlap`, so a plan can name the shared paths
 * instead of asserting disjointness by hand. An empty list on either side
 * overlaps everything and is reported as the pair `["", entry]`.
 */
export function overlappingScopeEntries(left: readonly string[], right: readonly string[]): Array<[string, string]> {
	if (!left.length || !right.length) return [[left[0] ?? "", right[0] ?? ""]];
	const pairs: Array<[string, string]> = [];
	for (const entry of left) {
		const prefix = scopePrefix(entry);
		for (const other of right) if (prefixOverlaps(prefix, scopePrefix(other))) pairs.push([entry, other]);
	}
	return pairs;
}

export interface ScopeOverlapReport {
	contract: "assurance_kernel/intent_scope_overlap/v1";
	overlaps: Array<{ task_ids: [string, string]; entries: Array<[string, string]> }>;
	parallel_groups: BatchPlanParallelGroups;
	scope_conflicts: BatchPlanScopeConflict[];
}

/**
 * Compare the `scope_hint` of every pair of Intents of one Initiative. The
 * groups use the same projection the Batch Plan uses, so the Planner's review
 * table and the batch confirmation agree on what runs together.
 */
export function projectScopeOverlap(children: readonly PlanScheduleChild[]): ScopeOverlapReport {
	const overlaps: ScopeOverlapReport["overlaps"] = [];
	for (let i = 0; i < children.length; i += 1)
		for (let j = i + 1; j < children.length; j += 1) {
			const entries = scopesOverlap(children[i]!.scope_hint, children[j]!.scope_hint)
				? overlappingScopeEntries(children[i]!.scope_hint, children[j]!.scope_hint)
				: [];
			if (entries.length) overlaps.push({ task_ids: [children[i]!.task_id, children[j]!.task_id], entries });
		}
	return { contract: "assurance_kernel/intent_scope_overlap/v1", overlaps, ...projectParallelGroups(children) };
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

function positiveLimit(maxParallel: number): number {
	if (maxParallel === Number.POSITIVE_INFINITY) return maxParallel;
	if (!Number.isSafeInteger(maxParallel) || maxParallel <= 0)
		throw new Error("max_parallel must be a positive safe integer");
	return maxParallel;
}

/** Pending children whose declared dependencies are done, up to the free slots. */
export function startableChildren(children: readonly ScheduleChild[], maxParallel: number): string[] {
	const limit = positiveLimit(maxParallel);
	const done = new Set(children.filter((child) => DONE_STATES.has(child.state)).map((child) => child.task_id));
	const occupied = children.filter((child) => IN_FLIGHT_STATES.has(child.state));
	const startable: string[] = [];
	for (const child of children) {
		if (occupied.length >= limit) break;
		if (child.state !== "pending") continue;
		if (!child.blocked_by.every((id) => done.has(id))) continue;
		startable.push(child.task_id);
		occupied.push(child);
	}
	return startable;
}

export interface PlanScheduleChild {
	task_id: string;
	slice_id?: string;
	blocked_by: string[];
	scope_hint: string[];
}

/** Project the declared dependency graph into start waves for the batch gate. */
export function projectParallelGroups(children: readonly PlanScheduleChild[]): {
	parallel_groups: BatchPlanParallelGroups;
	scope_conflicts: BatchPlanScopeConflict[];
} {
	const remaining = [...children];
	const placed = new Set<string>();
	const groups: BatchPlanParallelGroups = [];
	while (remaining.length) {
		const wave = remaining.filter((child) => child.blocked_by.every((id) => placed.has(id)));
		if (!wave.length) throw new Error("Initiative Task dependencies must form an acyclic graph");
		groups.push(wave.map((child) => child.task_id));
		for (const child of wave) {
			placed.add(child.task_id);
			remaining.splice(remaining.indexOf(child), 1);
		}
	}
	return { parallel_groups: groups, scope_conflicts: [] };
}
