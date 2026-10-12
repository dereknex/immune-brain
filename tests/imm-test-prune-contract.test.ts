import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const contract = read("plugins/immune-brain/dist/imm-test-prune.md");
const loader = read("plugins/immune-brain/skills/imm-test-prune/SKILL.md");
const registry = Bun.YAML.parse(read("plugins/immune-brain/skills/registry.yaml")) as {
  skills: Array<Record<string, unknown>>;
};

// Whitespace-normalized body of one heading, up to the next heading of any level.
function section(heading: string): string {
  const start = contract.indexOf(`${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = contract.slice(start + heading.length);
  const end = rest.search(/\n#{1,6} /);
  return (end < 0 ? rest : rest.slice(0, end)).replace(/\s+/g, " ");
}

describe("imm-test-prune contract", () => {
  test("registers a standalone repair Skill with no Managed next action", () => {
    expect(registry.skills.find((skill) => skill.name === "imm-test-prune")).toMatchObject({
      path: "skills/imm-test-prune/SKILL.md",
      role: "execute",
      role_class: "repair",
      canonical: true,
      output_artifacts: ["test_prune_report"],
      next_actions: [],
    });
    expect(loader).toContain("dist/imm-test-prune.md");
    expect(loader).toContain("standalone host-native");
  });

  test("audit stops at the manifest and mutation needs exact approval", () => {
    const invocation = section("## Invocation");
    expect(invocation).toContain("`imm-test-prune audit`: read-only. Produce the manifest and stop.");
    expect(invocation).toContain("no dependency installation, and no automatic commit");
    const manifest = section("### Inventory and Manifest");
    expect(manifest).toContain("literal user approves exact manifest entries");
    expect(manifest).toContain("Broad approval such as \"clean up the tests\" is insufficient");
  });

  test("preserves active Managed scope and defers document-only tests", () => {
    const boundary = section("## Authority Boundary");
    expect(boundary).toContain("`BLOCKED_ACTIVE_SCOPE`");
    expect(boundary).toContain("active acceptance descriptor's verification `argv`");
    expect(boundary).toContain("`DEFER_DOC_PRUNE`");
    expect(read("plugins/immune-brain/dist/imm-doc-prune.md").replace(/\s+/g, " ")).toContain(
      "test structure and behavioral coverage belong to `imm-test-prune`",
    );
  });

  test("uses only the repository's own commands and degrades without coverage", () => {
    const manifest = section("### Inventory and Manifest");
    expect(manifest).toContain("without installing anything");
    expect(manifest).toContain("Never add a coverage tool, plugin, or configuration");
    for (const capability of ["`isolated`", "`file`", "`unavailable`"]) expect(manifest).toContain(capability);
    expect(manifest).toContain("A file already failing at baseline is `BLOCKED`");
  });

  test("deletion needs retirement proof or coverage-backed subsumption", () => {
    const manifest = section("### Inventory and Manifest");
    expect(manifest).toContain("Age, file length, test count, and intermittent failure alone never prove");
    expect(manifest).toContain("covered lines must be a superset of the removed test's covered lines");
    expect(manifest).toContain("Line coverage is necessary, not sufficient");
    expect(manifest).toContain("`UNVERIFIED` and not mutable when any of these holds");
  });

  test("mutation never weakens a live guarantee or leaves test scope", () => {
    const envelope = section("## Mutation Envelope");
    expect(envelope).toContain("Never weaken a live guarantee.");
    expect(envelope).toContain("loosen an assertion's strength");
    expect(envelope).toContain("widen a timeout");
    expect(envelope).toContain("production source");
    expect(envelope).toContain("dependencies, lockfiles, or coverage configuration");
    expect(section("### Approved Mutation")).toContain("Drift blocks that item");
  });

  test("verification preserves the pass set and blocks coverage loss", () => {
    const verify = section("## Verify and Report");
    expect(verify).toContain("The baseline pass set must be preserved");
    expect(verify).toContain("Any decrease blocks the run");
    expect(verify).toContain("This Skill does not commit.");
    expect(section("## Recovery")).toContain("`Recovery: git log -- <path>`");
  });
});
