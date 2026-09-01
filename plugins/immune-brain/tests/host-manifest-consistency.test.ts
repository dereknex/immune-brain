import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const REMOVED_HOST_SURFACES = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin",
  ".cursor-plugin",
  "plugins/immune-brain/.codex-plugin",
  "plugins/immune-brain/.claude-plugin",
  "plugins/immune-brain/.cursor-plugin",
  "plugins/immune-brain/.opencode-plugin",
];

describe("Pi package manifest consistency", () => {
  it("keeps the root Pi manifest as the sole host package authority", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(manifest.name).toBe("immune-brain");
    expect(manifest.pi.skills).toEqual(["./plugins/immune-brain/skills"]);
    expect(manifest.pi.extensions).toEqual(["./plugins/immune-brain/.pi-extension"]);
    expect(existsSync(resolve(ROOT, "plugins/immune-brain/skills"))).toBe(true);
    expect(existsSync(resolve(ROOT, "plugins/immune-brain/.pi-extension"))).toBe(true);
    for (const path of REMOVED_HOST_SURFACES) {
      expect(existsSync(resolve(ROOT, path))).toBe(false);
    }
  });
});
