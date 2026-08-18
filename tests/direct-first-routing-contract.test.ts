import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const BASELINE = read("plugins/immune-brain/BASELINE.md");
const ROOT_IMMUNE = read("IMMUNE.md");
const INIT_AGENTS = read("plugins/immune-brain/runtime/bootstrap-templates/AGENTS.md");
const INIT_IMMUNE = read("plugins/immune-brain/runtime/bootstrap-templates/IMMUNE.template.md");
const INIT_SCRIPT = read("plugins/immune-brain/runtime/bootstrap.ts");
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

describe("Managed-by-default workflow routing contract", () => {
  it("routes repository mutations through Managed phases without a special phrase", () => {
    expectAll(BASELINE, [
      "Repository-mutating requests use Managed Path by default.",
      "The canonical host applies the Managed Path routing contract for this decision.",
      "Continue an existing Managed owner",
      "Keep non-mutating requests host-native",
      "Route materially ambiguous mutations to `imm-brainstorm`",
      "Route clear new mutations to `imm-planner`",
      "Fast-Track is compressed Managed Path",
      "Planner output is a candidate for later literal-user",
    ]);
    expect(BASELINE).not.toContain(
      "Direct Path is the default when no Managed trigger applies.",
    );
  });

  it("keeps non-mutating requests out of Enrollment and preserves routine breadth rules", () => {
    expectAll(BASELINE, [
      "read-only, explanation",
      "Plan-only requests may use `imm-planner`",
      "This path creates no Spec, Plan, TaskIntent, TaskRecord, State Ledger",
      "File count",
      "ordinary retries, read-only advisors",
      "Do not create or mutate workflow state while",
    ]);
    expect(BASELINE).not.toContain("Use the Direct Path only when all of these are true");
    expect(BASELINE).not.toContain("one direct, non-destructive verification");
  });

  it("retains authoritative evidence and privilege confirmation boundaries", () => {
    expectAll(BASELINE, [
      "Record reproducible evidence before reporting closure",
      "active Managed step boundary",
      "Managed scope changes",
      "return to `imm-planner`",
    ]);
    expectAll(BASELINE, [
      "Record reproducible evidence before reporting closure",
      "Require exact host confirmation only for",
      "publish, release, deployment, or remote-system mutation",
      "credential, secret, permission, or access-control changes",
    ]);
  });

  it("aligns project constitutions, bootstrap, and packaged consumers", () => {
    expectAll(ROOT_IMMUNE, ["Managed-by-default", "Host 在选择 Skill 前应用 routing contract", "literal-user Enrollment"]);
    expectAll(INIT_AGENTS, [
      "Repository-mutating requests use Managed Path by default",
      "The host applies the routing contract before selecting a Skill",
      "Planner output is a candidate for later literal-user Enrollment",
    ]);
    expectAll(INIT_IMMUNE, ["Repository-mutating requests use Managed Path by default", "partial or incompatible state fails"]);
    expect(INIT_SCRIPT).toContain('ready_for: ["imm-brainstorm", "imm-planner", "imm-loop"]');
    expect(INIT_SCRIPT).toContain("bootstrap_rejected");
    expect(INIT_SCRIPT).toContain("ensureManagedBootstrap");
    expectAll(README, ["Repository-mutating requests enter Managed Path automatically", "The host applies the routing contract before"]);
    expectAll(USER_GUIDE, ["Managed Path：仓库变更默认路径", "第一次仓库变更请求由 host 应用 routing contract"]);
    expectAll(PLANNER_SKILL, ["default planning phase for a clear repository mutation", "enrolls a task or enrolls generated", "artifacts unconditionally"]);
    expectAll(QUALITY_GATE, ["clear repository mutations default to `imm-planner`", "literal-user Enrollment remains the authority boundary"]);
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

  it("benchmarks clear mutations, hard-risk boundaries, and weak matches", () => {
    const ids = BENCHMARK.scenarios.map((scenario: { id: string }) => scenario.id);
    expect(ids).toContain("managed-default-mutation");
    expect(ids).toContain("hard-risk-managed-boundary");
    expect(ids).toContain("plugin-boundary");

    const mutation = BENCHMARK.scenarios.find(
      (scenario: { id: string }) => scenario.id === "managed-default-mutation",
    );
    const managed = BENCHMARK.scenarios.find(
      (scenario: { id: string }) => scenario.id === "hard-risk-managed-boundary",
    );
    expect([mutation.userInput, ...mutation.successChecklist].join("\n")).toContain(
      "without the user saying Managed Path",
    );
    expect([mutation.userInput, ...mutation.successChecklist].join("\n")).toContain(
      "initialized idempotently",
    );
    expect([managed.userInput, ...managed.successChecklist].join("\n")).toContain(
      "public runtime contract",
    );
    expect([managed.userInput, ...managed.successChecklist].join("\n")).toContain(
      "Managed",
    );
  });
});
