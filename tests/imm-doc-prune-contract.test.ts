import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = resolve(ROOT, "plugins/immune-brain/dist/imm-doc-prune.md");
const SKILL = resolve(
  ROOT,
  "plugins/immune-brain/skills/imm-doc-prune/SKILL.md",
);
const REGISTRY = readFileSync(
  resolve(ROOT, "plugins/immune-brain/skills/registry.yaml"),
  "utf8",
);

const contract = readFileSync(DIST, "utf8");
const loader = readFileSync(SKILL, "utf8");

function registryEntry(name: string): string {
  const marker = `  - name: ${name}\n`;
  const start = REGISTRY.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = REGISTRY.indexOf("\n  - name:", start + marker.length);
  return REGISTRY.slice(start, end < 0 ? undefined : end);
}

describe("imm-doc-prune contract", () => {
  test("is a compact loader referencing the owned packaged contract", () => {
    expect(loader).toContain("name: imm-doc-prune");
    expect(loader).toContain("dist/imm-doc-prune.md");
    expect(loader).toContain("standalone host-native");
  });

  test("is registered as a canonical standalone maintenance Skill", () => {
    const entry = registryEntry("imm-doc-prune");
    expect(entry).toContain("path: skills/imm-doc-prune/SKILL.md");
    expect(entry).toContain("role: execute");
    expect(entry).toContain("role_class: repair");
    expect(entry).toContain("canonical: true");
    expect(entry).toContain("output_artifacts: [prune_report]");
    expect(entry).toContain("next_actions: []");
    expect(entry).toContain("no Managed authority mutation or authority-artifact deletion");
  });

  test("requires explicit invocation and audit mode", () => {
    expect(contract).toContain("explicit invocation");
    expect(contract).toContain("audit");
    expect(contract).toContain("read-only");
  });

  test("inventories all tracked current documentation", () => {
    expect(contract).toContain(".md");
    expect(contract).toContain(".mdx");
    expect(contract).toContain(".rst");
    expect(contract).toContain(".adoc");
    expect(contract).toContain("AGENTS.md");
    expect(contract).toContain("CLAUDE.md");
    expect(contract).toContain("GEMINI.md");
  });

  test("excludes dependencies, build output, and source comments", () => {
    expect(contract).toContain("node_modules");
    expect(contract).toContain("vendor");
    expect(contract).toContain("build output");
  });

  test("preserves historical-by-purpose records", () => {
    expect(contract).toContain("CHANGELOG");
    expect(contract).toContain("release notes");
    expect(contract).toContain("migration records");
    expect(contract).toContain("incident reports");
  });

  test("classifies candidates using evidence categories", () => {
    for (const category of [
      "DELETE",
      "EDIT",
      "KEEP",
      "BLOCKED",
      "BLOCKED_ACTIVE_SCOPE",
      "UNVERIFIED",
      "HISTORICAL_GIT_ONLY",
      "MISSING_CURRENT_DOC",
    ]) {
      expect(contract).toContain(category);
    }
  });

  test("requires Git recoverability and candidate-clean status", () => {
    expect(contract).toContain("Git history");
    expect(contract).toContain("recover");
    expect(contract).toContain("untracked");
    expect(contract).toContain("dirty");
  });

  test("requires exact manifest approval and hash revalidation", () => {
    expect(contract).toMatch(
      /Mutation mode\s+also stops until the literal user approves exact manifest entries/,
    );
    expect(contract).toContain("Broad approval");
    expect(contract).toMatch(
      /Re-read candidate bytes, Git status,\s+inbound references, generated ownership, and active scope immediately\s+before each approved change/,
    );
  });

  test("categorically excludes Managed authority artifacts", () => {
    expect(contract).toMatch(
      /categorically does not delete active or frozen Specs, TaskIntents,\s+TaskRecords, tombstones, or other `.imm` authority/,
    );
  });

  test("blocks only active-scope candidates and fails closed on unreadable scope", () => {
    expect(contract).toMatch(
      /Classify each candidate overlapping the active\s+TaskIntent `scope_hint` as `BLOCKED_ACTIVE_SCOPE` and continue auditing\s+unaffected candidates\. If the routing owner or scope cannot be read reliably,\s+fail closed for mutation/,
    );
  });

  test("does not maintain retired/superseded document tombstones", () => {
    expect(contract).toContain("delete");
    expect(contract).not.toContain("status: retired");
    expect(contract).not.toContain("status: superseded");
  });

  test("does not renumber ADRs or create new ADRs to complete pruning", () => {
    expect(contract).toContain("renumber");
    expect(contract).toContain("Never renumber");
    expect(contract).toContain("new ADR");
  });

  test("does not probe external URLs in the first version", () => {
    expect(contract).toContain("External URL");
    expect(contract).toContain("not probed");
  });

  test("does not execute arbitrary documented commands", () => {
    expect(contract).toContain("arbitrary");
    expect(contract).toContain("does not execute");
  });

  test("does not commit, persist reports, or add runtime authority", () => {
    expect(contract).toContain("does not commit");
    expect(contract).toContain("no persistent report");
    expect(contract).toContain("no runtime");
    expect(contract).toContain("No daemon");
    expect(contract).toContain("no cron");
    expect(contract).toContain("no CI");
    expect(contract).toContain("no allowlist");
  });

  test("never creates or mutates Managed authority", () => {
    expect(contract).toContain(
      "without creating or mutating\nTaskIntent, TaskRecord, Kernel, Spec, or Plan authority",
    );
    expect(contract).toContain(
      "An already active\nManaged task remains owned by `imm-loop`",
    );
  });

  test("is standalone host-native and not a Loop internal role", () => {
    expect(contract).toContain("standalone host-native");
    expect(contract).toContain("not a Managed Path continuation");
    expect(contract).toContain("not an `imm-loop` internal-role dispatch");
  });

  test("verification re-scans residual names, links, and generated parity", () => {
    expect(contract).toContain("residual");
    expect(contract).toContain("local\n    links");
    expect(contract).toContain("generated");
    expect(contract).toContain("git diff --check");
  });

  test("terminal report is bounded and recovery is Git-based", () => {
    expect(contract).toContain("Deleted");
    expect(contract).toContain("Edited");
    expect(contract).toContain("Blocked");
    expect(contract).toContain("Unverified");
    expect(contract).toContain("Historical Git-only references");
    expect(contract).toContain("Recovery: git log");
  });
});
