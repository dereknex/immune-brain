import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8");

const BASELINE_CANONICAL = read("plugins/immune-brain/BASELINE.md");
const BASELINE_DIST = read("plugins/immune-brain/dist/BASELINE.md");
const BASELINE_SKILLS = read("plugins/immune-brain/skills/BASELINE.md");
const PLANNER_DIST = read("plugins/immune-brain/dist/imm-planner.md");
const PLANNER_SKILL = read("plugins/immune-brain/skills/imm-planner/SKILL.md");

const BASELINES = [BASELINE_CANONICAL, BASELINE_DIST, BASELINE_SKILLS];
const PLANNERS = [PLANNER_DIST, PLANNER_SKILL];

function expectDeletionIsCompletion(text: string) {
  // acceptance: deletion of source and contract text as a completion condition for retirement-class work
  expect(text).toContain("deletion of source and contract text");
  expect(text).toContain("completion condition");
  expect(text).toContain("retirement-class work");
}

function expectAbsenceScoped(text: string) {
  // acceptance: absence test is transitional evidence ... may not stand in place of one
  expect(text).toContain("An absence test is transitional");
  expect(text).toContain("may not stand in place of one");
  // distinction durable vs promise
  expect(text).toContain("guards something already gone");
  expect(text).toContain("durable and correct");
  expect(text).toContain("stands in for a deletion still owed");
  expect(text).toContain("promise recorded as if it were a result");
}

describe("retirement completion contract", () => {
  it("names deletion of source and contract text as a completion condition for retirement-class work (acc-deletion-is-completion)", () => {
    for (const content of BASELINES) {
      expectDeletionIsCompletion(content);
    }
    for (const content of PLANNERS) {
      expectDeletionIsCompletion(content);
    }
  });

  it("states that an absence test is transitional evidence of an in-progress deletion and may not stand in place of one (acc-absence-tests-scoped)", () => {
    for (const content of [...BASELINES, ...PLANNERS]) {
      expectAbsenceScoped(content);
    }
    // also ensure the scaffolding wording from goal is present
    for (const content of [...BASELINES, ...PLANNERS]) {
      expect(content).toContain("transitional scaffolding");
    }
  });

  it("keeps the distinction between durable guard and promise", () => {
    for (const content of [...BASELINES, ...PLANNERS]) {
      expect(content).toContain("already gone");
      expect(content).toContain("promise recorded");
    }
  });
});
