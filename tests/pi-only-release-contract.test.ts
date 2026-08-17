import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadManifestVersions, validateManifests } from "../scripts/plugin_versioning";

const ROOT = resolve(import.meta.dir, "..");

describe("Pi-only release contract", () => {
  it("uses package.json as the sole version authority", () => {
    const versions = loadManifestVersions(ROOT);
    expect(Object.keys(versions)).toEqual(["package.json"]);
    expect(validateManifests(ROOT)).toMatchObject({
      package: "@immune-brain/agent-skills",
      files: ["package.json"],
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
      "plugins/immune-brain/skills/imm-canary-work/SKILL.md",
      "plugins/immune-brain/runtime/kernel/completion.ts",
    ]) expect(files).toContain(required);
    for (const prefix of [
      "tests/",
      "docs/",
      "scripts/",
      "public-release/",
      ".agents/",
      ".claude-plugin/",
      ".cursor-plugin/",
      ".codex-plugin/",
      ".opencode-plugin/",
    ]) expect(files.some((path: string) => path.startsWith(prefix))).toBe(false);
  });

  it("root package files omit development and historical source trees", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(manifest.private).toBe(true);
    expect(manifest.files).not.toContain("docs");
    for (const path of ["CONTEXT.md", "HANDOFF.md", "AGENTS.md", "IMMUNE.md"])
      expect(manifest.files).not.toContain(path);
    expect(manifest.files).toContain("plugins/immune-brain/.pi-extension");
    expect(manifest.files).toContain("plugins/immune-brain/skills");
  });

  it("uses the root artifact by default and preserves explicit adapter overrides", () => {
    const runRelease = (extra: string[] = []) => spawnSync("bun", [
      "scripts/plugin_release.ts",
      "release",
      "--repo-root",
      ROOT,
      "--branch",
      "main",
      "--json",
      ...extra,
    ], { cwd: ROOT, encoding: "utf8" });

    const blocked = runRelease();
    expect(blocked.status).toBe(0);
    const blockedPublish = JSON.parse(blocked.stdout).phases.find((phase: { phase: string }) => phase.phase === "publish");
    expect(blockedPublish).toMatchObject({
      artifact_path: ROOT,
      manifest_path: "package.json",
      reason: "package_adapter_not_configured",
      status: "blocked",
    });

    const configured = runRelease(["--adapter-command", "publish", "artifact_path", "manifest_path"]);
    expect(configured.status).toBe(0);
    const configuredPublish = JSON.parse(configured.stdout).phases.find((phase: { phase: string }) => phase.phase === "publish");
    expect(configuredPublish).toMatchObject({
      artifact_path: ROOT,
      manifest_path: "package.json",
      status: "planned",
      command: ["publish", ROOT, "package.json"],
    });

    const override = resolve(ROOT, ".release-artifact-override");
    const overridden = runRelease([
      "--artifact-path",
      override,
      "--adapter-command",
      "publish",
      "artifact_path",
    ]);
    expect(overridden.status).toBe(0);
    const overriddenPublish = JSON.parse(overridden.stdout).phases.find((phase: { phase: string }) => phase.phase === "publish");
    expect(overriddenPublish).toMatchObject({
      artifact_path: override,
      command: ["publish", override],
    });
  });
});
