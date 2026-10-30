// Rework root-cause lessons from the workflow retro must stay written into the
// contracts that were changed to carry them: the reviewer prompt (and its
// packaged mirror), the Loop rework step, the Planner authoring rule, the
// authority-key ADR, and the `revisit` follow-through method.
//
// These are prose contracts, so the check is on the sentences that carry the
// rule, normalized for line wrapping.

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readFlat(rel: string): string {
	return readFileSync(resolve(REPO_ROOT, rel), "utf-8").replace(/\s+/g, " ");
}

describe("rework generalization rule", () => {
	it("reviews a repeated trigger as a claim about the fix's scope", () => {
		const reviewer = readFlat("plugins/immune-brain/runtime/prompts/code-review.md");
		expect(reviewer).toContain("do not file it as a fresh single-trigger defect");
		expect(reviewer).toContain("a second variant of the same trigger is a claim about the fix's scope");
		expect(reviewer).toContain("advisory note against that boundary, never as blocking rework");
	});

	it("packages the reviewer rule in the shipped role-prompt mirror", () => {
		const source = readFileSync(
			resolve(REPO_ROOT, "plugins/immune-brain/runtime/prompts/code-review.md"),
			"utf-8",
		);
		const packaged = readFileSync(
			resolve(REPO_ROOT, "plugins/immune-brain/dist/role-prompts/code-review.md"),
			"utf-8",
		);
		expect(packaged).toBe(source);
	});

	it("requires the second rework to generalize or refute", () => {
		const loop = readFlat("plugins/immune-brain/dist/drive.md");
		expect(loop).toContain("On the second rework of one acceptance id or anchor");
		expect(loop).toContain("covers every known trigger class of the violated invariant");
		expect(loop).toContain("`refute_finding` bound to fresh QA evidence");
		expect(loop).toContain("Escalating a local heuristic a third time");
	});
});

describe("state-machine consumer enumeration", () => {
	it("is required before authoring the intent", () => {
		const planner = readFlat("plugins/immune-brain/dist/draw-up.md");
		expect(planner).toContain("adds a field or verdict branch to a state machine");
		expect(planner).toContain("every consumer of that value and of the version gates");
		expect(planner).toContain("Name all of them in `scope_hint`.");
	});
});

describe("authority uniqueness keys ADR", () => {
	const rel = "docs/adr/0012-authority-uniqueness-keys.md";

	it("records run identity as the key and task_id as display-only", () => {
		expect(existsSync(resolve(REPO_ROOT, rel))).toBe(true);
		const adr = readFlat(rel);
		expect(adr).toContain("status: accepted");
		expect(adr).toContain("`run_id` plus `enrollment_event_id`");
		expect(adr).toContain("`task_id` is a display label");
		expect(adr).toContain("never by itself a deduplication, freshness or deletion basis");
	});

	it("lists each remaining coarse-key site with an exit", () => {
		const adr = readFlat(rel);
		for (const site of ["auditTaskDirPath", "readAuditTaskPair", "runs.task_id TEXT NOT NULL UNIQUE"])
			expect(adr).toContain(site);
		expect(adr).toContain("mws-migration-release");
	});
});

describe("retro per-task aggregation", () => {
	it("groups rounds per task and separates infrastructure jitter", () => {
		const retro = readFlat("plugins/immune-brain/dist/revisit.md");
		expect(retro).toContain("Aggregate per task before proposing any pattern");
		expect(retro).toContain("for every task at three or more rounds");
		expect(retro).toContain("as infrastructure jitter and keep it out of the content-rework count");
	});
});

describe("revisit follow-through", () => {
	const revisit = readFlat("plugins/immune-brain/dist/revisit.md");

	it("traces repeated cross-boundary findings through the real entry to the downstream consumer", () => {
		expect(revisit).toContain("real public/host entry, authorization and preconditions");
		expect(revisit).toContain("reload and downstream consumer");
	});

	it("orders the fix ladder", () => {
		expect(revisit).toContain("architecture > types > lint > test > docs");
	});

	it("is report-only and ends each candidate with a copy-ready draft", () => {
		expect(revisit).toContain("each candidate ends with a copy-ready TaskIntent or issue draft");
		expect(revisit).toContain("`revisit` creates no issue, TaskIntent, branch or commit");
	});

	it("retires the project-local workflow-evidence-retro Skill", () => {
		expect(existsSync(resolve(REPO_ROOT, ".agents/skills/workflow-evidence-retro"))).toBe(false);
	});
});
