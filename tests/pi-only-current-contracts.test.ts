import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CURRENT_CONTRACTS = [
  "README.md",
  "CONTEXT.md",
  "docs/adr/0002-maintenance-surface-ownership.md",
  "docs/reference/immune-brain-config.md",
  "docs/reference/subagent-dispatch-protocol.md",
  "docs/reference/workflow-and-subagents.md",
  "docs/reference/HANDOFF-template.md",
  "docs/reference/immune-brain-skills-guide.md",
  "docs/user_manual.md",
  "plugins/immune-brain/README.md",
  "plugins/immune-brain/USER_GUIDE.md",
  "plugins/immune-brain/EVALUATION.md",
  "plugins/immune-brain/skills/registry.yaml",
  "plugins/immune-brain/dist/registry.yaml",
];
const UNSUPPORTED_HOST_CLAIM = /\b(Codex|Cursor|OpenCode)\b|\.(?:codex|cursor|opencode)(?:-plugin)?\//;

describe("current Pi-only contracts", () => {
  it("removes the retired public sync surface from active release contracts", () => {
    for (const path of [
      "scripts/sync-to-public.sh",
      "public-release/templates/CONTRIBUTING.md",
      "public-release/templates/README.md",
      "public-release/templates/SECURITY.md",
      "public-release/templates/mise.toml",
    ]) expect(existsSync(resolve(ROOT, path))).toBe(false);

    const release = readFileSync(resolve(ROOT, "scripts/plugin_release.ts"), "utf8");
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    for (const token of ["scripts/sync-to-public.sh", "public-release/templates", "immune-brain-public"]) {
      expect(release).not.toContain(token);
      expect(readme).not.toContain(token);
    }
  });

  it("does not retain the legacy progress projection surface", () => {
    for (const path of [
      "plugins/immune-brain/runtime/progress_projection.ts",
      "tests/progress-projection-runtime.test.ts",
    ]) expect(existsSync(resolve(ROOT, path))).toBe(false);

    const sources = [
      "plugins/immune-brain/runtime/commands/kernel.ts",
    ].map((path) => readFileSync(resolve(ROOT, path), "utf8"));
    for (const source of sources) {
      expect(source).not.toContain("progress_projection");
      expect(source).not.toContain("buildWorkProgressProjection");
      expect(source).not.toContain('"progress"');
    }
  });

  it("describe Pi and Claude Code as the supported hosts", () => {
    const distSkills = readdirSync(resolve(ROOT, "plugins/immune-brain/dist"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `plugins/immune-brain/dist/${name}`);
    for (const path of [...CURRENT_CONTRACTS, ...distSkills]) {
      const content = readFileSync(resolve(ROOT, path), "utf8");
      expect({ path, unsupported: content.match(UNSUPPORTED_HOST_CLAIM)?.[0] }).toEqual({
        path,
        unsupported: undefined,
      });
    }
    expect(readFileSync(resolve(ROOT, "README.md"), "utf8")).toContain("Pi and Claude Code are the supported hosts");
    expect(readFileSync(resolve(ROOT, "README.zh-CN.md"), "utf8")).toContain("Pi 与 Claude Code 是支持的宿主");
    expect(readFileSync(resolve(ROOT, "plugins/immune-brain/USER_GUIDE.md"), "utf8")).toContain("Pi 与 Claude Code 工作流");
    expect(readFileSync(resolve(ROOT, "plugins/immune-brain/USER_GUIDE.md"), "utf8")).toContain("host native Review");
    expect(readFileSync(resolve(ROOT, "plugins/immune-brain/README.md"), "utf8")).toContain("Pi host extension or the Claude Code plugin");
    const preferencesDoc = readFileSync(resolve(ROOT, "docs/reference/immune-brain-config.md"), "utf8");
    expect(preferencesDoc).toContain("Initiative carrier default: local");
    expect(preferencesDoc).toContain("Initiative carrier default: github");
    expect(preferencesDoc).toContain("does not load an\nagent-local TOML file");
    for (const token of ["IMMUNE_BRAIN_AGENT_CONFIG", "IMMUNE_BRAIN_CONFIG", "[subagent_activation]", "[workflow_models]", "[subagent_models]"])
      expect(preferencesDoc).not.toContain(token);
  });

  it("documents valid Pi native research subagent invocations", () => {
    for (const path of [
      "plugins/immune-brain/dist/imm-brainstorm.md",
      "plugins/immune-brain/dist/imm-planner.md",
    ]) {
      const content = readFileSync(resolve(ROOT, path), "utf8");
      expect({ path, nativeExplore: content.includes('subagent_type: "Explore"') }).toEqual({
        path,
        nativeExplore: true,
      });
      expect({ path, legacyAgentType: content.includes("generalPurpose") }).toEqual({
        path,
        legacyAgentType: false,
      });
    }
  });

  it("does not publish retired host selectors or host-specific workflow fields", () => {
    const activePaths = [
      "plugins/immune-brain/runtime/commands/kernel.ts",
      "plugins/immune-brain/dist/imm-loop.md",
      "plugins/immune-brain/dist/role-prompts/compounder.md",
    ];
    for (const path of activePaths) {
      const content = readFileSync(resolve(ROOT, path), "utf8");
      for (const token of ["coding_agent", "IMMUNE_BRAIN_CODING_AGENT", "--coding-agent", "codex_status", "codex_plan"]) {
        expect({ path, token, present: content.includes(token) }).toEqual({ path, token, present: false });
      }
    }
    expect(existsSync(resolve(ROOT, "docs/reference/compaction-handoff-hosts.md"))).toBe(false);
    expect(existsSync(resolve(ROOT, "plugins/immune-brain/dist/docs/reference/compaction-handoff-hosts.md"))).toBe(false);
  });
});
