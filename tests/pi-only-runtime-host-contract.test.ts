import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveImmuneBrainLocalRoot } from "../plugins/immune-brain/runtime/agent_config";

describe("Pi-only runtime host contract", () => {
  it("binds local configuration state to Pi", () => {
    const home = mkdtempSync(join(tmpdir(), "imm-pi-only-"));
    try {
      const localRoot = resolveImmuneBrainLocalRoot({ home_dir: home });
      expect(localRoot.root).toBe(join(home, ".pi/agent/immune-brain"));
      expect("agent_id" in localRoot).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
