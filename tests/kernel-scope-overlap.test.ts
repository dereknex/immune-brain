import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";
import {
	overlappingScopeEntries,
	projectParallelGroups,
	projectScopeOverlap,
	scopesOverlap,
} from "../plugins/immune-brain/runtime/kernel/scope_overlap";

const roots: string[] = [];

function tempRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-scope-overlap-"));
	roots.push(root);
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	return root;
}

function writeIntentFile(root: string, taskId: string, scopeHint: string[]): string {
	const rel = `docs/plans/${taskId}.intent.json`;
	writeFileSync(
		join(root, rel),
		JSON.stringify(
			{
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: `Goal for ${taskId}`,
				acceptance: [],
				scope_hint: scopeHint,
				risk: "routine",
				revision: 1,
			},
			null,
			2,
		),
	);
	return rel;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("scope_overlap", () => {
	it("treats provably disjoint repository paths as disjoint", () => {
		expect(scopesOverlap(["runtime/a.ts"], ["runtime/b.ts"])).toBe(false);
		expect(scopesOverlap(["docs/a"], ["docs/ab"])).toBe(false);
		expect(scopesOverlap(["docs/plans/*.json"], ["docs/specs/x.md"])).toBe(false);
		expect(scopesOverlap(["./runtime/a.ts"], ["runtime/b.ts"])).toBe(false);
		expect(overlappingScopeEntries(["runtime/a.ts"], ["runtime/b.ts"])).toEqual([]);
	});

	it("treats identical, nested, wildcard, and partial-segment scopes as overlapping", () => {
		expect(scopesOverlap(["runtime/a.ts"], ["runtime/a.ts"])).toBe(true);
		expect(scopesOverlap(["runtime"], ["runtime/a.ts"])).toBe(true);
		expect(scopesOverlap(["runtime/a.ts"], ["runtime/"])).toBe(true);
		expect(scopesOverlap(["runtime/**"], ["runtime/deep/file.ts"])).toBe(true);
		expect(scopesOverlap(["Runtime/A.ts"], ["runtime/a.ts"])).toBe(true);
		expect(scopesOverlap(["src/foo*"], ["src/foobar/x.ts"])).toBe(true);
		expect(scopesOverlap(["src/foo*"], ["src/other/x.ts"])).toBe(true);
		expect(scopesOverlap(["src/foo*"], ["docs/x.md"])).toBe(false);
		expect(overlappingScopeEntries(["runtime/**"], ["runtime/deep/file.ts"])).toEqual([
			["runtime/**", "runtime/deep/file.ts"],
		]);
	});

	it("fails closed when a scope cannot be proved disjoint", () => {
		for (const pattern of ["**/*.ts", "*.md", "{a,b}/x", "?/x", "[ab]/x"]) {
			expect(scopesOverlap([pattern], ["docs/a.md"])).toBe(true);
		}
		expect(scopesOverlap([], ["docs/a.md"])).toBe(true);
		expect(scopesOverlap(["docs/a.md"], [])).toBe(true);
		expect(scopesOverlap(["/etc/passwd"], ["docs/a.md"])).toBe(true);
		expect(scopesOverlap(["../outside/x"], ["docs/a.md"])).toBe(true);
		expect(scopesOverlap(["docs\\a.md"], ["tests/a.ts"])).toBe(true);
		expect(overlappingScopeEntries([], ["docs/a.md"])).toEqual([["", "docs/a.md"]]);
	});

	it("projects dependency waves and rejects cyclic dependency graphs", () => {
		const projection = projectParallelGroups([
			{ task_id: "s2", slice_id: "S2", blocked_by: ["s10"], scope_hint: ["dist/bundle.mjs"] },
			{ task_id: "s3", slice_id: "S3", blocked_by: ["s10", "s2"], scope_hint: ["dist/bundle.mjs"] },
			{ task_id: "s4", slice_id: "S4", blocked_by: [], scope_hint: ["dist/bundle.mjs"] },
			{ task_id: "s10", slice_id: "S10", blocked_by: [], scope_hint: ["dist/bundle.mjs"] },
		]);
		expect(projection.parallel_groups).toEqual([["s4", "s10"], ["s2"], ["s3"]]);
		expect(projection.scope_conflicts).toEqual([]);

		expect(() =>
			projectParallelGroups([
				{ task_id: "a", blocked_by: ["b"], scope_hint: ["x/a"] },
				{ task_id: "b", blocked_by: ["a"], scope_hint: ["x/b"] },
			]),
		).toThrow("acyclic");

		const report = projectScopeOverlap([
			{ task_id: "a", blocked_by: [], scope_hint: ["src/a.ts"] },
			{ task_id: "b", blocked_by: ["a"], scope_hint: ["src/a.ts"] },
			{ task_id: "c", blocked_by: [], scope_hint: ["docs/c.md"] },
		]);
		expect(report).toEqual({
			contract: "assurance_kernel/intent_scope_overlap/v1",
			overlaps: [{ task_ids: ["a", "b"], entries: [["src/a.ts", "src/a.ts"]] }],
			parallel_groups: [["a", "c"], ["b"]],
			scope_conflicts: [],
		});
	});

	it("runs imm-kernel intent overlap read-only and rejects invalid CLI arguments", () => {
		const root = tempRepo();
		const pathA = writeIntentFile(root, "task-a", ["src/shared.ts"]);
		const pathB = writeIntentFile(root, "task-b", ["src/shared.ts"]);
		const pathC = writeIntentFile(root, "task-c", ["docs/c.md"]);

		const ok = runKernelCommand(
			["intent", "overlap", pathA, pathB, pathC, "--blocked-by", "task-b=task-a", "--json"],
			root,
		);
		expect(ok.returncode).toBe(0);
		expect(JSON.parse(ok.stdout)).toEqual({
			contract: "assurance_kernel/intent_scope_overlap/v1",
			overlaps: [{ task_ids: ["task-a", "task-b"], entries: [["src/shared.ts", "src/shared.ts"]] }],
			parallel_groups: [["task-a", "task-c"], ["task-b"]],
			scope_conflicts: [],
		});

		const tooFew = runKernelCommand(["intent", "overlap", pathA, "--json"], root);
		expect(tooFew.returncode).toBe(2);

		const badEdge = runKernelCommand(
			["intent", "overlap", pathA, pathB, "--blocked-by", "invalid-edge", "--json"],
			root,
		);
		expect(badEdge.returncode).toBe(2);
	});
});
