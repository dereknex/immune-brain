import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const BASELINE = read("plugins/immune-brain/BASELINE.md");
const ROOT_IMMUNE = read("IMMUNE.md");
const README = read("plugins/immune-brain/README.md");
const USER_GUIDE = read("plugins/immune-brain/USER_GUIDE.md");
const PLANNER_SKILL = read("plugins/immune-brain/dist/imm-planner.md");
const QUALITY_GATE = read("docs/reference/planning-quality-gate.md");
const PACKAGED_QUALITY_GATE = read(
  "plugins/immune-brain/dist/docs/reference/planning-quality-gate.md",
);
const BENCHMARK = JSON.parse(read("tests/fixtures/immune-brain-benchmark.json"));

function expectAll(text: string, fragments: string[]): void {
  for (const fragment of fragments) expect(text).toContain(fragment);
}

describe("Skill-explicit workflow routing contract", () => {
  it("keeps ordinary mutations host-native until an Immune Skill is explicit", () => {
    expectAll(BASELINE, [
      "Ordinary host input stays host-native",
      "new Managed workflow starts only from explicit",
      "Continue an existing Managed owner",
      "explicit `imm-brainstorm`",
      "imm-planner",
      "imm-loop",
    ]);
    expect(BASELINE).not.toContain("Repository-mutating requests use Managed Path by default");
  });

  it("keeps host-native work out of workflow authority", () => {
    expectAll(BASELINE, [
      "Ordinary host input stays host-native",
      "Do not inspect or mutate Immune-Brain state",
      "This path creates no Spec, Plan, TaskIntent, TaskRecord, State Ledger",
    ]);
    expect(BASELINE).not.toContain("Repository-mutating requests use Managed Path by default");
  });

  it("retains authoritative evidence and privilege confirmation boundaries", () => {
    expectAll(BASELINE, [
      "Record reproducible evidence before reporting closure",
      "active Managed step boundary",
      "Managed scope changes",
      "routes scope changes to `imm-planner`",
    ]);
    expectAll(BASELINE, [
      "Record reproducible evidence before reporting closure",
      "Require exact host confirmation only for",
      "publish, release, deployment, or remote-system mutation",
      "credential, secret, permission, or access-control changes",
    ]);
  });

  it("aligns project constitutions and packaged consumers", () => {
    expectAll(ROOT_IMMUNE, ["Skill-explicit Managed Path", "显式 Immune-Brain Skill", "literal-user Enrollment"]);
    expectAll(README, ["Managed Path starts only from explicit `imm-brainstorm`, `imm-planner`, or", "standalone `imm-pr-fix`,\n`imm-doc-prune`, and `imm-agent-doc-maintain` stay", "ordinary host input"]);
    expectAll(USER_GUIDE, ["Skill-explicit Managed Path", "普通 host input 保持 host-native"]);
    expectAll(PLANNER_SKILL, ["entered explicitly by the user", "enrolls a task or enrolls generated", "artifacts unconditionally"]);
    expectAll(QUALITY_GATE, ["explicit Immune-Brain Skill entry starts Managed planning", "literal-user Enrollment remains the authority boundary"]);
    expect(PACKAGED_QUALITY_GATE).toBe(QUALITY_GATE);
  });

  it("keeps the user guide on current Kernel authority instead of retired v3 operations", () => {
    expectAll(USER_GUIDE, [
      "`.imm/state/tasks/<task-id>.json`",
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

  it("benchmarks host-native mutations, explicit Managed boundaries, and weak matches", () => {
    const ids = BENCHMARK.scenarios.map((scenario: { id: string }) => scenario.id);
    expect(ids).toContain("host-native-mutation");
    expect(ids).toContain("explicit-managed-boundary");
    expect(ids).toContain("plugin-boundary");

    const mutation = BENCHMARK.scenarios.find(
      (scenario: { id: string }) => scenario.id === "host-native-mutation",
    );
    const managed = BENCHMARK.scenarios.find(
      (scenario: { id: string }) => scenario.id === "explicit-managed-boundary",
    );
    expect([mutation.userInput, ...mutation.successChecklist].join("\n")).toContain(
      "stays host-native",
    );
    expect([mutation.userInput, ...mutation.successChecklist].join("\n")).toContain(
      "does not create or inspect Immune-Brain workflow state",
    );
    expect([managed.userInput, ...managed.successChecklist].join("\n")).toContain(
      "explicit `imm-planner`",
    );
    expect([managed.userInput, ...managed.successChecklist].join("\n")).toContain(
      "public runtime contract",
    );
    expect([managed.userInput, ...managed.successChecklist].join("\n")).toContain(
      "Managed",
    );
  });
});
