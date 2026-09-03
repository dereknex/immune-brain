import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = resolve(ROOT, "plugins/immune-brain/dist/imm-agent-doc-maintain.md");
const SKILL = resolve(
  ROOT,
  "plugins/immune-brain/skills/imm-agent-doc-maintain/SKILL.md",
);
const REGISTRY = readFileSync(
  resolve(ROOT, "plugins/immune-brain/skills/registry.yaml"),
  "utf8",
);

const contract = readFileSync(DIST, "utf8").replace(/\s+/g, " ");
const loader = readFileSync(SKILL, "utf8");

function registryEntry(name: string): string {
  const marker = `  - name: ${name}\n`;
  const start = REGISTRY.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = REGISTRY.indexOf("\n  - name:", start + marker.length);
  return REGISTRY.slice(start, end < 0 ? undefined : end);
}

describe("imm-agent-doc-maintain contract", () => {
  test("is a compact loader referencing the owned packaged contract", () => {
    expect(loader).toContain("name: imm-agent-doc-maintain");
    expect(loader).toContain("dist/imm-agent-doc-maintain.md");
    expect(loader).toContain("standalone host-native");
  });

  test("is registered as a canonical standalone maintenance Skill", () => {
    const entry = registryEntry("imm-agent-doc-maintain");
    expect(entry).toContain("path: skills/imm-agent-doc-maintain/SKILL.md");
    expect(entry).toContain("role: execute");
    expect(entry).toContain("role_class: repair");
    expect(entry).toContain("canonical: true");
    expect(entry).toContain("output_artifacts: [maintain_report]");
    expect(entry).toContain("next_actions: []");
    expect(entry).toContain(
      "no Managed authority mutation, contract installation, or reference-document creation",
    );
  });

  test("requires explicit invocation and audit mode", () => {
    expect(contract).toContain("explicit invocation");
    expect(contract).toContain("audit");
    expect(contract).toContain("read-only");
  });

  test("inventories only tracked root and nested agent instruction files", () => {
    expect(contract).toContain("AGENTS.md");
    expect(contract).toContain("CLAUDE.md");
    expect(contract).toContain("GEMINI.md");
    expect(contract).toContain("nested tracked directories");
    expect(contract).toContain("User-level");
    expect(contract).toContain("~/.pi/agent/AGENTS.md");
  });

  test("blocks Git-tracked symlinks and other non-regular files", () => {
    expect(contract).toContain("tracked regular files");
    expect(contract).toContain("Git-tracked symlinks (`120000`)");
    expect(contract).toContain("non-regular modes are `BLOCKED`");
    expect(contract).toContain("before inventory, reading, or mutation");
  });

  test("applies the four-part persistent-rule value gate", () => {
    expect(contract).toContain("four-part persistent-rule value gate");
    expect(contract).toContain("non-obvious from ordinary");
    expect(contract).toContain("plausibly repeatable");
    expect(contract).toContain("stable beyond");
    expect(contract).toContain("costly to violate");
  });

  test("preserves native host file structure", () => {
    expect(contract).toContain("Preserve each file's native organization");
    expect(contract).toContain("Do not normalize files to a shared");
    expect(contract).toContain("template");
  });

  test("classifies candidates using maintenance categories", () => {
    for (const category of [
      "REMOVE",
      "REWRITE",
      "POINTER",
      "KEEP",
      "BLOCKED",
      "BLOCKED_ACTIVE_SCOPE",
      "UNVERIFIED",
      "MISSING_OWNER",
    ]) {
      expect(contract).toContain(category);
    }
  });

  test("keeps uncertain rules and blocks unresolved conflicts", () => {
    expect(contract).toContain("`UNVERIFIED` and are not deleted by default");
    expect(contract).toContain("Unresolved precedence or semantic conflicts");
    expect(contract).toContain("Filename convention, nesting, or guessed");
  });

  test("pointers require an existing authority and a trigger condition", () => {
    expect(contract).toContain("existing current authority");
    expect(contract).toContain("concrete trigger condition");
    expect(contract).toContain("does not create a reference document");
  });

  test("requires exact manifest approval and hash revalidation", () => {
    expect(contract).toContain(
      "Mutation mode also stops until the literal user approves exact manifest entries",
    );
    expect(contract).toContain("Broad approval");
    expect(contract).toContain(
      "Re-read candidate bytes, Git status, content hash, references, precedence evidence, and active scope immediately before each approved change",
    );
  });

  test("isolates dirty, untracked, and active-scope candidates", () => {
    expect(contract).toContain("dirty");
    expect(contract).toContain("untracked candidate is `BLOCKED`");
    expect(contract).toContain(
      "Classify each candidate overlapping the active TaskIntent `scope_hint` as `BLOCKED_ACTIVE_SCOPE` and continue auditing unaffected candidates. If the routing owner or scope cannot be read reliably, fail closed for mutation",
    );
  });

  test("does not set a compression quota or claim Token savings", () => {
    expect(contract).toContain("No fixed line, byte, percentage, or Token target");
    expect(contract).toContain("Do not translate byte changes into Token");
    expect(contract).not.toContain("must reduce");
  });

  test("does not execute instruction-file commands or install contracts", () => {
    expect(contract).toContain("Never execute commands");
    expect(contract).toContain("copied from instruction files");
    expect(contract).toContain("install");
    expect(contract).toContain("project contracts");
    expect(contract).toContain("does not install or continuously validate");
  });

  test("does not commit, persist reports, or add runtime authority", () => {
    expect(contract).toContain("does not commit");
    expect(contract).toContain("no persistent report");
    expect(contract).toContain("no runtime");
    expect(contract).toContain("No daemon");
    expect(contract).toContain("no telemetry");
    expect(contract).toContain("no automatic learning");
    expect(contract).toContain("no cron");
    expect(contract).toContain("no CI");
    expect(contract).toContain("no allowlist");
  });

  test("never creates or mutates Managed authority", () => {
    expect(contract).toContain(
      "without creating or mutating TaskIntent, TaskRecord, Kernel, Spec, or Plan authority",
    );
    expect(contract).toContain(
      "An already active Managed task remains owned by `imm-loop`",
    );
  });

  test("is standalone host-native and not a Loop internal role", () => {
    expect(contract).toContain("standalone host-native");
    expect(contract).toContain("not a Managed Path continuation");
    expect(contract).toContain("not an `imm-loop` internal-role dispatch");
    expect(contract).toContain("does not invoke `imm-doc-prune`");
  });

  test("terminal report is bounded to semantic dispositions and size deltas", () => {
    expect(contract).toContain("Removed");
    expect(contract).toContain("Rewritten");
    expect(contract).toContain("Moved to pointer");
    expect(contract).toContain("Kept");
    expect(contract).toContain("Blocked");
    expect(contract).toContain("Unverified");
    expect(contract).toContain("Verification");
    expect(contract).toContain("before/after line and byte counts");
  });
});
