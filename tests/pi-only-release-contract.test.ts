import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadManifestVersions, validateManifests } from "../scripts/plugin_versioning";

const ROOT = resolve(import.meta.dir, "..");

describe("Pi-only release contract", () => {
  it("uses package.json as the sole version authority", () => {
    const versions = loadManifestVersions(ROOT);
    expect(Object.keys(versions)).toEqual([
      "package.json",
      "plugins/immune-brain/.claude-plugin/plugin.json",
    ]);
    expect(validateManifests(ROOT)).toMatchObject({
      package: "@immune-brain/agent-skills",
      files: ["package.json", "plugins/immune-brain/.claude-plugin/plugin.json"],
      valid: true,
    });
  });

  it("packs only the direct manifest package boundary", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const [pack] = JSON.parse(result.stdout);
    const files = pack.files.map((file: { path: string }) => file.path);
    for (const required of [
      "package.json",
      "README.md",
      "plugins/immune-brain/.pi-extension/imm-canary-work.ts",
      "plugins/immune-brain/skills/imm-loop/SKILL.md",
      "plugins/immune-brain/runtime/kernel/completion.ts",
      ".claude-plugin/marketplace.json",
    ]) expect(files).toContain(required);
    for (const prefix of [
      "tests/",
      "docs/",
      "scripts/",
      "public-release/",
      ".agents/",
      ".cursor-plugin/",
      ".codex-plugin/",
      ".opencode-plugin/",
    ]) expect(files.some((path: string) => path.startsWith(prefix))).toBe(false);
  });

  it("root package files omit development and historical source trees", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(manifest.files).not.toContain("docs");
    for (const path of ["CONTEXT.md", "HANDOFF.md", "AGENTS.md", "IMMUNE.md"])
      expect(manifest.files).not.toContain(path);
    expect(manifest.files).toContain("plugins/immune-brain/.pi-extension");
    expect(manifest.files).toContain("plugins/immune-brain/skills");
  });

  it("uses Changesets as the only version and publish entrypoint", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(existsSync(resolve(ROOT, "scripts/plugin_release.ts"))).toBe(false);
    expect(manifest.scripts["changeset:version"]).toBe(
      "changeset version && bun scripts/plugin_versioning.ts stamp && bun scripts/plugin_versioning.ts validate",
    );
    expect(manifest.scripts["changeset:publish"]).toBe(
      "bun scripts/plugin_versioning.ts validate && changeset publish",
    );

    const bump = spawnSync("bun", ["scripts/plugin_versioning.ts", "bump", "patch"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(bump.status).toBe(2);
    expect(bump.stderr).toContain("{stamp | validate");
  });
});
