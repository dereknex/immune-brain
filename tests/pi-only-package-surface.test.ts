import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const REMOVED_HOST_PATHS = [
  ".agents/plugins/marketplace.json",
  ".cursor-plugin",
  "plugins/immune-brain/.codex-plugin",
  "plugins/immune-brain/.cursor-plugin",
  "plugins/immune-brain/.opencode-plugin",
  "plugins/immune-brain/.pi-extension/index.ts",
  "plugins/immune-brain/.pi-extension/progress_client.ts",
  "plugins/immune-brain/.pi-extension/progress_views.ts",
  "plugins/immune-brain/skills/imm-init/templates/CLAUDE.md",
  "docs/reference/compaction-handoff-hosts.md",
  "plugins/immune-brain/dist/docs/reference/compaction-handoff-hosts.md",
];

describe("Pi-only package surface", () => {
  it("ships one Pi+Claude package allowlist and no undeclared adapters", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(manifest.pi).toEqual({
      skills: ["./plugins/immune-brain/skills"],
      extensions: ["./plugins/immune-brain/.pi-extension"],
    });
    expect(manifest.dependencies?.["@opencode-ai/plugin"]).toBeUndefined();
    expect(manifest.devDependencies?.["@opencode-ai/plugin"]).toBeUndefined();
    expect(manifest.files).toContain("plugins/immune-brain/.pi-extension");
    for (const path of REMOVED_HOST_PATHS) {
      expect(existsSync(resolve(ROOT, path))).toBe(false);
    }
  });
});
