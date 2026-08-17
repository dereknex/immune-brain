import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const BASELINE = read("plugins/immune-brain/BASELINE.md");
const CANARY_SKILL = read("plugins/immune-brain/skills/imm-canary-work/SKILL.md");
const PACKAGED_CANARY_SKILL = read("plugins/immune-brain/dist/imm-canary-work.md");
const ROOT_IMMUNE = read("IMMUNE.md");
const INIT_AGENTS = read("plugins/immune-brain/skills/imm-init/templates/AGENTS.md");
const INIT_IMMUNE = read("plugins/immune-brain/skills/imm-init/templates/IMMUNE.template.md");
const INIT_SCRIPT = read("plugins/immune-brain/skills/imm-init/scripts/init_project.ts");
const README = read("plugins/immune-brain/README.md");
const USER_GUIDE = read("plugins/immune-brain/USER_GUIDE.md");
const INIT_SKILL = read("plugins/immune-brain/dist/imm-init.md");
const PLANNER_SKILL = read("plugins/immune-brain/dist/imm-planner.md");
const QUALITY_GATE = read("docs/reference/planning-quality-gate.md");
const PACKAGED_QUALITY_GATE = read(
  "plugins/immune-brain/dist/docs/reference/planning-quality-gate.md",
);
const BENCHMARK = JSON.parse(read("tests/fixtures/immune-brain-benchmark.json"));

function expectAll(text: string, fragments: string[]): void {
  for (const fragment of fragments) expect(text).toContain(fragment);
}

describe("Direct-first workflow routing contract", () => {
  it("selects Direct by default through one ordered negative-trigger matrix", () => {
    expectAll(BASELINE, [
      "Direct Path is the default when no Managed trigger applies.",
      "Apply this ordered route before selecting an Immune-Brain Skill",
      "Continue an existing Managed owner",
      "Honor explicit Managed intent",
      "Route hard Managed triggers",
      "Resolve only material uncertainty",
      "Otherwise use Direct",
    ]);

    expectAll(BASELINE, [
      "security, credentials, permissions, or access control",
      "public API, schema, compatibility, migration, or persisted-state behavior",
      "concurrency, recovery, release, deployment, or external writes",
      "destructive or irreversible effects, Git history rewrite, authority discard, or risk override",
      "multiple independently owned domains",
    ]);
  });

  it("does not turn routine breadth or rework into Managed workflow state", () => {
    expectAll(BASELINE, [
      "Do not select Managed merely because",
      "multiple files",
      "multiple local verifier commands",
      "ordinary implementation retries",
      "optional read-only advisors",
      "unrelated dirty files",
      "Do not create or mutate workflow state while selecting the route",
    ]);
    expect(BASELINE).not.toContain("Use the Direct Path only when all of these are true");
    expect(BASELINE).not.toContain("one direct, non-destructive verification");
  });

  it("closes Direct work with scoped evidence and reserves confirmation for privilege", () => {
    expectAll(BASELINE, [
      "reproducible task-scoped verification",
      "stable task-owned diff",
      "zero task-owned unresolved failures",
      "The whole Git worktree need not be clean",
      "Stage only explicit task-owned paths",
      "Never use `git add .` or `git add -A`",
      "Require exact host confirmation only for",
      "publish, release, deployment, or remote-system mutation",
      "credential, secret, permission, or access-control changes",
      "Do not request confirmation for local in-scope edits, local verification, ordinary Direct rework, scoped diff review, or completion reporting",
    ]);
  });

  it("requires authoritative evidence before claiming scope or breaking-intent drift", () => {
    for (const text of [CANARY_SKILL, PACKAGED_CANARY_SKILL]) {
      expectAll(text, [
        "Before claiming scope drift, a Breaking Revision, or out-of-scope work",
        "authoritative TaskIntent",
        "current Kernel projection",
        "staged task snapshot",
        "scoped Git diff",
        "Do not infer authority drift from prose",
      ]);
    }
  });

  it("aligns project constitutions and initialization with Direct-first entry", () => {
    expectAll(ROOT_IMMUNE, ["Direct Path 是默认路径", "Managed Path", "不会创建或更新 `.imm/` 工作流状态"]);
    expect(ROOT_IMMUNE).not.toContain("在修改任何核心逻辑前，必须在 `docs/specs/` 下存在或创建");

    expectAll(INIT_AGENTS, [
      "Direct Path is the default when no Managed trigger applies.",
      "Use `imm-planner` only when a Managed trigger applies",
    ]);
    expect(INIT_AGENTS).not.toContain("Use `imm-planner` before implementation work.");
    expectAll(INIT_IMMUNE, ["Direct Path is the default", "Managed Path"]);
    expect(INIT_IMMUNE).not.toContain("Plan before code.");

    expect(INIT_SCRIPT).toContain('ready_for: ["direct", "imm-brainstorm", "imm-planner"]');
    expect(INIT_SCRIPT).toContain("Ready for: direct, imm-brainstorm, imm-planner");
  });

  it("aligns packaged and user-facing consumers without hiding Managed entrypoints", () => {
    for (const text of [README, USER_GUIDE, INIT_SKILL, PLANNER_SKILL, QUALITY_GATE]) {
      expect(text).toContain("Direct");
      expect(text).toContain("Managed");
    }
    expect(README).toContain("Direct Path is the default");
    expect(USER_GUIDE).toContain("默认路径");
    expect(INIT_SKILL).toContain("continue directly with the ordinary host agent");
    expect(PLANNER_SKILL).toContain("file count and local verifier count are not Managed triggers");
    expect(QUALITY_GATE).toContain("Eligible work stays on the Direct Path regardless of file count or local verifier count");
    expect(PACKAGED_QUALITY_GATE).toBe(QUALITY_GATE);
  });

  it("keeps the user guide on current Kernel authority instead of retired v3 operations", () => {
    expectAll(USER_GUIDE, [
      "`.imm/tasks/<task-id>.json`",
      "TaskIntent 与 TaskRecord 是独立 authority",
      "v3 mutating commands 已退出生产路径",
      "v4 不自动迁移",
      "advance_assurance",
      "request_authorization",
    ]);
    for (const retiredClaim of [
      "执行 `imm-migrate --json` 会先在 `.imm/migrations/` 创建内容寻址备份",
      "写状态的命令会在首次修改前自动执行同一迁移",
      "所有决策历史保存在 State Ledger 中",
      "代码变更和 UI 变更会自动触发对应的审查流程",
      "`imm-loop` 是最省心的入口",
    ]) {
      expect(USER_GUIDE).not.toContain(retiredClaim);
    }
  });

  it("benchmarks both unprompted Direct routing and hard-risk Managed routing", () => {
    const ids = BENCHMARK.scenarios.map((scenario: { id: string }) => scenario.id);
    expect(ids).toContain("low-risk-direct-path");
    expect(ids).toContain("hard-risk-managed-boundary");

    const direct = BENCHMARK.scenarios.find(
      (scenario: { id: string }) => scenario.id === "low-risk-direct-path",
    );
    const managed = BENCHMARK.scenarios.find(
      (scenario: { id: string }) => scenario.id === "hard-risk-managed-boundary",
    );
    expect([direct.userInput, ...direct.successChecklist].join("\n")).toContain(
      "multiple local verifiers",
    );
    expect([direct.userInput, ...direct.successChecklist].join("\n")).toContain(
      "zero workflow-state writes",
    );
    expect([managed.userInput, ...managed.successChecklist].join("\n")).toContain(
      "public runtime contract",
    );
    expect([managed.userInput, ...managed.successChecklist].join("\n")).toContain(
      "Managed",
    );
  });
});
