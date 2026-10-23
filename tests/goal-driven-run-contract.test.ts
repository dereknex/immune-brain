import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const plugin = join(root, "plugins/immune-brain");
const read = (path: string) => readFileSync(join(plugin, path), "utf8");
const flat = (path: string) => read(path).replace(/\s+/g, " ");

describe("published goal-driven run contract", () => {
 it("routes Parent and Child separately while retaining native authority boundaries", () => {
  const loader = flat("skills/imm-run/SKILL.md");
  const batch = flat("dist/imm-run-batch.md");
  expect(loader).toContain("`status` first");
  expect(loader).toContain("A Parent Issue selects its whole planned batch");
  expect(loader).toContain("A Child Issue selects only its TaskIntent");
  expect(batch).toContain("Parent selection is the batch opt-in; it needs no separate chat question");
  // branch-boundary-r2 D18: every batch runs Lanes, so there is no serial mode to share commands with.
  expect(batch).toContain("Every new batch uses runtime-created Lanes");
  expect(batch).toContain("The confirmed batch records `final_verification` commands");
  expect(batch).toContain("whole-plan proof");
  expect(batch).toContain("fresh single-task native Enrollment");
 });
 it("keeps every Skill contract pointer reachable", () => {
  const source = join(plugin, "skills/imm-run/SKILL.md");
  for (const match of readFileSync(source, "utf8").matchAll(/\]\(([^)]+)\)/g)) {
   const target = match[1]!.split("#")[0]!;
   if (target && !target.includes(":")) expect(existsSync(resolve(dirname(source), target))).toBe(true);
  }
 });
 it("observes Claude tool failure and Stop through the same shipped Hook command", () => {
  const hooks = JSON.parse(read("hooks/hooks.json")).hooks;
  const command = hooks.Stop[0].hooks[0].command;
  expect(command).toContain("${CLAUDE_PLUGIN_ROOT}/dist/claude/mcp-server.mjs");
  for (const event of ["PostToolUse", "PostToolUseFailure", "UserPromptSubmit", "SessionEnd"])
   expect(hooks[event][0].hooks[0]).toMatchObject({ type: "command", command });
 });
});
