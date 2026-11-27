import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const plugin = join(root, "plugins/immune-brain");
const read = (path: string) => readFileSync(join(plugin, path), "utf8");
const flat = (path: string) => read(path).replace(/\s+/g, " ");

describe("published goal-driven run contract", () => {
 it("routes only Child entries and enrolls them in place while retaining native authority boundaries", () => {
  const loader = flat("skills/drive/SKILL.md");
  const loop = flat("dist/drive.md");
  expect(loader).toContain("`status` first");
  // retire-unattended-batch D2: a Parent Issue no longer selects a batch.
  expect(loader).toContain("A Parent Issue is not a `drive` target");
  expect(loader).toContain("A Child Issue selects only its TaskIntent");
  expect(loader).toContain("enrolls in the current worktree through `enroll` with `task_id`, one native gate");
  expect(loader).not.toContain("start_unattended_batch");
  expect(loop).toContain("no batch runs inside Immune-Brain (ADR 0043 Slice 3)");
  expect(existsSync(join(plugin, "dist/drive-batch.md"))).toBe(false);
 });
 it("keeps every Skill contract pointer reachable", () => {
  const source = join(plugin, "skills/drive/SKILL.md");
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
