// Pure scheduling for unattended batches. No I/O, no persisted state, no Host
// concept: given child states, dependency edges, scope hints and a parallelism
// limit it answers which children may start now, and which children of a plan
// serialize because their scopes cannot be proved disjoint.
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

function positiveLimit(maxParallel: number): number {
	if (maxParallel === Number.POSITIVE_INFINITY) return maxParallel;
	if (!Number.isSafeInteger(maxParallel) || maxParallel <= 0)
		throw new Error("max_parallel must be a positive safe integer");
	return maxParallel;
}

/**
 * The children that may start now, in record order. A pending child starts when
 * every dependency is done, its scope is disjoint from every in-flight child and
 * from every child already chosen in this call, and the in-flight count stays
 * below `maxParallel`. With `maxParallel` 1 and nothing in flight this is
 * exactly the serial runner's choice: the first pending child whose
 * dependencies are done.
 */
export function startableChildren(children: readonly ScheduleChild[], maxParallel: number): string[] {
	const limit = positiveLimit(maxParallel);
	const done = new Set(children.filter((child) => DONE_STATES.has(child.state)).map((child) => child.task_id));
	const occupied = children.filter((child) => IN_FLIGHT_STATES.has(child.state));
	const startable: string[] = [];
	for (const child of children) {
		if (occupied.length >= limit) break;
		if (child.state !== "pending") continue;
		if (!child.blocked_by.every((id) => done.has(id))) continue;
		if (occupied.some((other) => scopesOverlap(child.scope_hint, other.scope_hint))) continue;
		startable.push(child.task_id);
		occupied.push(child);
	}
	return startable;
}

export interface PlanScheduleChild {
	task_id: string;
	blocked_by: string[];
	scope_hint: string[];
}

/**
 * Project a plan's enrollable children into start waves. Each wave is the
 * largest set that is ready (every dependency in an earlier wave) and pairwise
 * scope-disjoint, chosen in plan order. A child that was ready but left out of
 * a wave because its scope overlaps a member of that wave is reported once with
 * every child it overlapped, so a confirmation can say why it serializes.
 */
export function projectParallelGroups(children: readonly PlanScheduleChild[]): {
	parallel_groups: BatchPlanParallelGroups;
	scope_conflicts: BatchPlanScopeConflict[];
} {
	const remaining = [...children];
	const placed = new Set<string>();
	const groups: BatchPlanParallelGroups = [];
	const conflicts = new Map<string, Set<string>>();
	while (remaining.length) {
		const ready = remaining.filter((child) => child.blocked_by.every((id) => placed.has(id)));
		if (!ready.length) throw new Error("Initiative Task dependencies must form an acyclic graph");
		const wave: PlanScheduleChild[] = [];
		for (const child of ready) {
			const overlapped = wave.filter((member) => scopesOverlap(child.scope_hint, member.scope_hint));
			if (overlapped.length) {
				const known = conflicts.get(child.task_id) ?? new Set<string>();
				for (const member of overlapped) known.add(member.task_id);
				conflicts.set(child.task_id, known);
				continue;
			}
			wave.push(child);
		}
		groups.push(wave.map((child) => child.task_id));
		for (const child of wave) {
			placed.add(child.task_id);
			remaining.splice(remaining.indexOf(child), 1);
		}
	}
	const scopeConflicts = children
		.filter((child) => conflicts.has(child.task_id))
		.map((child) => ({ task_id: child.task_id, overlaps_with: [...conflicts.get(child.task_id)!].sort() }));
	return { parallel_groups: groups, scope_conflicts: scopeConflicts };
}
