import { describe, expect, it } from "bun:test";
import {
	projectParallelGroups,
	scopesOverlap,
	startableChildren,
	type ScheduleChild,
	type ScheduleChildState,
} from "../plugins/immune-brain/runtime/unattended/batch_schedule";

function child(
	task_id: string,
	scope_hint: string[],
	state: ScheduleChildState = "pending",
	blocked_by: string[] = [],
): ScheduleChild {
	return { task_id, state, blocked_by, scope_hint };
}

describe("scope overlap", () => {
	it("treats provably disjoint paths as disjoint", () => {
		expect(scopesOverlap(["runtime/a.ts"], ["runtime/b.ts"])).toBe(false);
		expect(scopesOverlap(["docs/a"], ["docs/ab"])).toBe(false);
		expect(scopesOverlap(["docs/plans/*.json"], ["docs/specs/x.md"])).toBe(false);
		expect(scopesOverlap(["runtime/a.ts", "docs/x.md"], ["tests/a.test.ts", "scripts/b.ts"])).toBe(false);
		expect(scopesOverlap(["./runtime/a.ts"], ["runtime/b.ts"])).toBe(false);
	});

	it("treats identical, prefix-nested and wildcard scopes as overlapping", () => {
		expect(scopesOverlap(["runtime/a.ts"], ["runtime/a.ts"])).toBe(true);
		expect(scopesOverlap(["runtime"], ["runtime/a.ts"])).toBe(true);
		expect(scopesOverlap(["runtime/a.ts"], ["runtime/"])).toBe(true);
		expect(scopesOverlap(["runtime/**"], ["runtime/deep/file.ts"])).toBe(true);
		expect(scopesOverlap(["runtime/deep/*.ts"], ["runtime/**"])).toBe(true);
		expect(scopesOverlap(["./runtime/a.ts"], ["runtime/a.ts"])).toBe(true);
		expect(scopesOverlap(["Runtime/A.ts"], ["runtime/a.ts"])).toBe(true);
		// `src/foo*` can match `src/foobar/x`, so the partial segment is no boundary.
		expect(scopesOverlap(["src/foo*"], ["src/foobar/x.ts"])).toBe(true);
		// The pattern only proves it lives under `src`, so a sibling there overlaps too.
		expect(scopesOverlap(["src/foo*"], ["src/other/x.ts"])).toBe(true);
		expect(scopesOverlap(["src/foo*"], ["docs/x.md"])).toBe(false);
	});

	it("treats a pattern with an empty literal prefix as overlapping everything", () => {
		for (const pattern of ["**/*.ts", "*.md", "{a,b}/x", "?/x", "[ab]/x"])
			expect(scopesOverlap([pattern], ["docs/a.md"])).toBe(true);
	});

	it("never claims disjointness for scopes it cannot prove", () => {
		expect(scopesOverlap([], ["docs/a.md"])).toBe(true);
		expect(scopesOverlap(["docs/a.md"], [])).toBe(true);
		expect(scopesOverlap(["/etc/passwd"], ["docs/a.md"])).toBe(true);
		expect(scopesOverlap(["../outside/x"], ["docs/a.md"])).toBe(true);
		expect(scopesOverlap(["docs\\a.md"], ["tests/a.ts"])).toBe(true);
		expect(scopesOverlap([""], ["docs/a.md"])).toBe(true);
	});
});

describe("startable children", () => {
	it("starts ready children with disjoint scopes together, up to the limit", () => {
		const children = [child("a", ["runtime/a.ts"]), child("b", ["docs/b.md"]), child("c", ["tests/c.ts"])];
		expect(startableChildren(children, 3)).toEqual(["a", "b", "c"]);
		expect(startableChildren(children, 2)).toEqual(["a", "b"]);
		expect(startableChildren(children, Number.POSITIVE_INFINITY)).toEqual(["a", "b", "c"]);
	});

	it("serializes identical, nested and pattern scopes", () => {
		expect(startableChildren([child("a", ["runtime/a.ts"]), child("b", ["runtime/a.ts"])], 4)).toEqual(["a"]);
		expect(startableChildren([child("a", ["runtime"]), child("b", ["runtime/b.ts"])], 4)).toEqual(["a"]);
		expect(startableChildren([child("a", ["runtime/**"]), child("b", ["runtime/x/y.ts"])], 4)).toEqual(["a"]);
		expect(startableChildren([child("a", ["**/*.ts"]), child("b", ["docs/b.md"])], 4)).toEqual(["a"]);
	});

	it("skips an overlapping child but still starts a later disjoint one", () => {
		const children = [child("a", ["runtime/a.ts"]), child("b", ["runtime/a.ts"]), child("c", ["docs/c.md"])];
		expect(startableChildren(children, 3)).toEqual(["a", "c"]);
	});

	it("never starts a child with an unmet blocked_by", () => {
		const unmet: ScheduleChildState[] = ["pending", "enrolled", "settled", "lane_admitted", "lane_committed", "needs_human", "skipped_blocked"];
		for (const state of unmet)
			expect(startableChildren([child("a", ["runtime/a.ts"], state), child("b", ["docs/b.md"], "pending", ["a"])], 4))
				.not.toContain("b");
		for (const state of ["committed", "integrated", "released"] as const)
			expect(startableChildren([child("a", ["runtime/a.ts"], state), child("b", ["docs/b.md"], "pending", ["a"])], 4))
				.toEqual(["b"]);
	});

	it("holds a child back while an in-flight sibling overlaps it, and counts in-flight against the limit", () => {
		const inFlight: ScheduleChildState[] = ["lane_admitted", "enrolled", "settled", "lane_committed"];
		for (const state of inFlight) {
			expect(startableChildren([child("a", ["runtime/a.ts"], state), child("b", ["runtime/a.ts"])], 4)).toEqual([]);
			expect(startableChildren([child("a", ["runtime/a.ts"], state), child("b", ["docs/b.md"])], 4)).toEqual(["b"]);
			expect(startableChildren([child("a", ["runtime/a.ts"], state), child("b", ["docs/b.md"])], 1)).toEqual([]);
		}
		const two = [
			child("a", ["runtime/a.ts"], "enrolled"),
			child("b", ["docs/b.md"], "lane_admitted"),
			child("c", ["tests/c.ts"]),
			child("d", ["scripts/d.ts"]),
		];
		expect(startableChildren(two, 3)).toEqual(["c"]);
		expect(startableChildren(two, 4)).toEqual(["c", "d"]);
		expect(startableChildren(two, 2)).toEqual([]);
	});

	it("does not let a parked or skipped sibling occupy a slot", () => {
		const children = [child("a", ["runtime/a.ts"], "needs_human"), child("b", ["docs/b.md"], "skipped_blocked"), child("c", ["tests/c.ts"])];
		expect(startableChildren(children, 1)).toEqual(["c"]);
	});

	it("yields exactly the serial runner's choice when max_parallel is 1", () => {
		// Reference: the serial runner's `nextEnrollableChild`, copied as the oracle.
		const serialNext = (children: ScheduleChild[]): string[] => {
			const next = children.find(
				(candidate) =>
					candidate.state === "pending" &&
					children.every((other) => !candidate.blocked_by.includes(other.task_id) || other.state === "committed"),
			);
			return next ? [next.task_id] : [];
		};
		const states: ScheduleChildState[] = ["pending", "committed", "needs_human", "skipped_blocked"];
		const shape: Array<[string, string[]]> = [["a", []], ["b", ["a"]], ["c", ["a"]], ["d", ["b", "c"]], ["e", []]];
		const total = states.length ** shape.length;
		for (let code = 0; code < total; code += 1) {
			let rest = code;
			// Every child shares one scope: a serial batch's children may overlap or not.
			const children = shape.map(([id, blockedBy]) => {
				const state = states[rest % states.length];
				rest = Math.floor(rest / states.length);
				return child(id, id === "e" ? ["docs/e.md"] : ["runtime/shared.ts"], state, blockedBy);
			});
			expect(startableChildren(children, 1)).toEqual(serialNext(children));
		}
	});

	it("starts nothing for a serial run while a child is enrolled", () => {
		const children = [child("a", ["runtime/a.ts"], "enrolled"), child("b", ["docs/b.md"])];
		expect(startableChildren(children, 1)).toEqual([]);
	});

	it("rejects an invalid limit", () => {
		for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])
			expect(() => startableChildren([child("a", ["runtime/a.ts"])], bad)).toThrow("max_parallel");
	});
});

describe("plan parallel groups", () => {
	it("reports waves and the children that serialize behind an overlapping sibling", () => {
		const projection = projectParallelGroups([
			{ task_id: "a", blocked_by: [], scope_hint: ["runtime/a/**"] },
			{ task_id: "b", blocked_by: [], scope_hint: ["docs/b.md"] },
			{ task_id: "c", blocked_by: [], scope_hint: ["runtime/a/deep.ts"] },
			{ task_id: "d", blocked_by: ["a", "b"], scope_hint: ["tests/d.ts"] },
		]);
		expect(projection.parallel_groups).toEqual([["a", "b"], ["c", "d"]]);
		expect(projection.scope_conflicts).toEqual([{ task_id: "c", overlaps_with: ["a"] }]);
	});

	it("reports a strictly serial plan as one child per wave", () => {
		const projection = projectParallelGroups([
			{ task_id: "s1", blocked_by: [], scope_hint: ["runtime/x.ts"] },
			{ task_id: "s2", blocked_by: ["s1"], scope_hint: ["runtime/x.ts"] },
			{ task_id: "s3", blocked_by: ["s1", "s2"], scope_hint: ["runtime/x.ts"] },
		]);
		expect(projection.parallel_groups).toEqual([["s1"], ["s2"], ["s3"]]);
		expect(projection.scope_conflicts).toEqual([]);
	});

	it("rejects a cyclic dependency graph", () => {
		expect(() =>
			projectParallelGroups([
				{ task_id: "a", blocked_by: ["b"], scope_hint: ["x/a"] },
				{ task_id: "b", blocked_by: ["a"], scope_hint: ["x/b"] },
			]),
		).toThrow("acyclic");
	});
});
