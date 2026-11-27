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

    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    expect(existsSync(resolve(ROOT, "scripts/plugin_release.ts"))).toBe(false);
    for (const token of ["scripts/sync-to-public.sh", "public-release/templates", "immune-brain-public"]) {
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

  it("records ADR 0043 as accepted and keeps the retired Loop surface out of active contracts", () => {
    const adr = (name: string) => readFileSync(resolve(ROOT, "docs/adr", name), "utf8");
    expect(adr("0043-loop-daemon-freeze-and-extraction.md")).toStartWith("---\nstatus: accepted\n---");
    for (const name of ["0039-loop-daemon.md", "0040-loop-interaction-protocol.md", "0042-loop-leader-role-catalog.md"])
      expect(adr(name)).toStartWith("---\nstatus: superseded by ADR-0043\n---");
    expect(adr("0038-supervised-session-port.md")).toStartWith("---\nstatus: accepted\n---");

    for (const path of ["CONTEXT.md", "plugins/immune-brain/BASELINE.md", "plugins/immune-brain/skills/BASELINE.md", "plugins/immune-brain/dist/BASELINE.md"]) {
      const retired = readFileSync(resolve(ROOT, path), "utf8").match(/Loop daemon|Interaction Request|Interaction Channel|imm-loop|Decision model/i)?.[0];
      expect({ path, retired }).toEqual({ path, retired: undefined });
    }
    for (const path of ["docs/agents/derived-files.json", "plugins/immune-brain/skills/registry.yaml"]) {
      const retired = readFileSync(resolve(ROOT, path), "utf8").match(/imm-loop|loop_daemon|decision_model|loop_interactions/)?.[0];
      expect({ path, retired }).toEqual({ path, retired: undefined });
    }
    for (const path of ["scripts/decision-eval", "scripts/review-eval", "tests/fixtures/decision-eval", "tests/fixtures/review-eval"])
      expect({ path, exists: existsSync(resolve(ROOT, path)) }).toEqual({ path, exists: false });
  });

  it("describe Pi, Claude Code, and Antigravity as the supported hosts", () => {
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
    expect(readFileSync(resolve(ROOT, "README.md"), "utf8")).toContain("Pi, Claude Code, and Antigravity (`plugins/immune-brain-antigravity/`) are the supported hosts");
    expect(readFileSync(resolve(ROOT, "README.zh-CN.md"), "utf8")).toContain("Pi、Claude Code 与 Antigravity（`plugins/immune-brain-antigravity/`）是支持的宿主");
    expect(readFileSync(resolve(ROOT, "plugins/immune-brain/USER_GUIDE.md"), "utf8")).toContain("Pi 与 Claude Code 工作流");
    expect(readFileSync(resolve(ROOT, "plugins/immune-brain/USER_GUIDE.md"), "utf8")).toContain("host native Review");
    expect(readFileSync(resolve(ROOT, "plugins/immune-brain/README.md"), "utf8")).toContain("Pi host extension or the Claude Code plugin");
    const preferencesDoc = readFileSync(resolve(ROOT, "docs/reference/immune-brain-config.md"), "utf8");
    // ADR 0041: one user file and one local project file; instruction-file directives are not read.
    for (const term of ["~/.config/immune-brain/config.json", "`.imm/config.json`", "imm-kernel config --json", "`docs/adr/0041-simplified-configuration.md`"])
      expect(preferencesDoc).toContain(term);
    const flat = preferencesDoc.replace(/\s+/g, " ");
    expect(flat).toContain("no preference line in `AGENTS.md` or `CLAUDE.md`");
    // Every retired source is named by the one migration, which folds it in and deletes nothing.
    const migrationNote = flat.slice(flat.indexOf("A file whose `contract` is a `v1` contract"), flat.indexOf("## Agents"));
    expect(migrationNote).toContain("imm-kernel config migrate --write");
    for (const legacy of ["`projects.<key>`", "`lanes`", "`.imm/lanes.local.json`", "`- Git integration:`", "`- Initiative carrier default:`"])
      expect({ legacy, named: migrationNote.includes(legacy) }).toEqual({ legacy, named: true });
    // ADR 0043: the retired decision-model sources are no longer migrated; the retired keys are removed.
    expect(migrationNote).toContain("It writes no `loop`, `decision_models`, `batch` or `session_providers` value and removes those keys");
    expect(migrationNote).toContain("It deletes none of those sources");
    expect(preferencesDoc).not.toContain("## Legacy Sources");
    expect(preferencesDoc).not.toContain("does not load an\nagent-local TOML file");
    expect(preferencesDoc).not.toContain("Lane preferences are the one exception");
    expect(readFileSync(resolve(ROOT, "plugins/immune-brain/dist/docs/reference/immune-brain-config.md"), "utf8")).toBe(preferencesDoc);
    for (const retired of ["Lane max parallel:", "Lane Executor Host:", "Lane Executor model:", "Lane Executor effort:"])
      expect(preferencesDoc).not.toContain(retired);
    for (const token of ["IMMUNE_BRAIN_AGENT_CONFIG", "IMMUNE_BRAIN_CONFIG", "[subagent_activation]", "[workflow_models]", "[subagent_models]"])
      expect(preferencesDoc).not.toContain(token);
  });

  it("keeps both READMEs on current skill names and workflow-health semantics", () => {
    const retiredSkill = /\bimm-(?:brainstorm|planner|run|retro|doc-slim|doc-prune|test-prune|pr-fix)(?![a-z0-9-])/;
    for (const path of ["README.md", "README.zh-CN.md"]) {
      const content = readFileSync(resolve(ROOT, path), "utf8");
      expect({ path, retired: content.match(retiredSkill)?.[0] }).toEqual({ path, retired: undefined });
    }
    const chinese = readFileSync(resolve(ROOT, "README.zh-CN.md"), "utf8");
    for (const skill of ["clarify", "draw-up", "drive", "fix-pr", "prune-docs", "slim", "prune-tests", "revisit", "design-review"]) {
      expect(chinese).toContain(`\`${skill}\``);
    }
    expect(chinese).not.toContain("按模型排名");
  });

  it("keeps both READMEs on in-place single-task drive and retired unattended batches", () => {
    for (const path of ["README.md", "README.zh-CN.md"]) {
      const content = readFileSync(resolve(ROOT, path), "utf8");
      for (const token of [
        "imm-batch/",
        "single-branch serial",
        "serially on one batch branch",
        "Runs serially by default",
        "start_unattended_batch",
        "retire_stale_batch",
        "imm/worktrees/",
        "imm-lane/",
        "refs/heads/imm/",
        "lane-steward",
        "batch.max_parallel",
      ]) {
        expect({ path, token, present: content.includes(token) }).toEqual({ path, token, present: false });
      }
      expect(content).toContain("## Initiatives");
      expect(content).toContain("docs/adr/0043-loop-daemon-freeze-and-extraction.md");
    }
    const chinese = readFileSync(resolve(ROOT, "README.zh-CN.md"), "utf8");
    for (const token of ["串行批次", "单分支串行", "单工作区串行", "在一个 batch 分支上串行", "在同一 Host 串行执行"]) {
      expect(chinese).not.toContain(token);
    }
  });

  it("documents valid Pi native research subagent invocations", () => {
    for (const path of [
      "plugins/immune-brain/dist/clarify.md",
      "plugins/immune-brain/dist/draw-up.md",
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
      "plugins/immune-brain/dist/drive.md",
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
