// Scope Overlap
//
// Owner: Kernel — pure planning evidence over TaskIntent scope hints.
// Interface: `scopesOverlap`, `overlappingScopeEntries`, `projectScopeOverlap`,
// `dependencyWaves`, `projectParallelGroups`.
// Side Effects: none.
// Verification: `bun test tests/kernel-scope-overlap.test.ts`.

/** Task ids grouped into start waves of the declared dependency graph. */
type ParallelGroups = string[][];

/**
 * A ready child held out of a start wave because its scope cannot be proved
 * disjoint from the listed children, so it serializes after them.
 */
export interface ScopeOverlapConflict {
	task_id: string;
	overlaps_with: string[];
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
	parallel_groups: ParallelGroups;
	scope_conflicts: ScopeOverlapConflict[];
}

/**
 * Compare the `scope_hint` of every pair of Intents of one Initiative and
 * project declared dependency waves for `imm-kernel intent overlap`.
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

export interface PlanScheduleChild {
	task_id: string;
	slice_id?: string;
	blocked_by: string[];
	scope_hint: string[];
}

/**
 * Peel the declared dependency graph wave by wave. A graph whose remaining
 * nodes all wait on an unplaced or unknown dependency never yields a wave, so
 * the caller names that rejection in its own terms.
 */
export function dependencyWaves<T extends { task_id: string; blocked_by: string[] }>(
	nodes: readonly T[],
	cycleMessage: string,
): T[][] {
	const remaining = [...nodes];
	const placed = new Set<string>();
	const waves: T[][] = [];
	while (remaining.length) {
		const wave = remaining.filter((node) => node.blocked_by.every((id) => placed.has(id)));
		if (!wave.length) throw new Error(cycleMessage);
		waves.push(wave);
		for (const node of wave) {
			placed.add(node.task_id);
			remaining.splice(remaining.indexOf(node), 1);
		}
	}
	return waves;
}

/** Project the declared dependency graph into Initiative dependency waves. */
export function projectParallelGroups(children: readonly PlanScheduleChild[]): {
	parallel_groups: ParallelGroups;
	scope_conflicts: ScopeOverlapConflict[];
} {
	const parallel_groups = dependencyWaves(children, "Initiative Task dependencies must form an acyclic graph")
		.map((wave) => wave.map((child) => child.task_id));
	return { parallel_groups, scope_conflicts: [] };
}
