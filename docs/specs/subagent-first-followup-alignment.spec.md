# Spec: subagent-first follow-up alignment

**任务 ID**: IMM-SUBAGENT-003
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 `033` 完成后的两条 residual follow-up，使共享 `subagent-first` truth 在用户入口文案和 focused regression 上真正闭环：

- README 顶部的直接触发模板需要显式体现“可清晰拆分的 review/advisory work 默认优先 bounded subagents”
- `tests/test_skill_contracts.py` 需要直接覆盖 `.imm/specs/workflow-skill-subagent-orchestration.spec.md`
  与 `.imm/specs/skill-trigger-template-routing.spec.md` 的 shared truth，而不只锁定 README / skill 文案

首版只修复 shared contract summary 和 regression coverage，不扩展到 runtime state 修复、scheduler、或更多 project-specific skill surfaces。

## 2. 问题背景

`033` 已完成 shared subagent-first contract alignment，但后续 `imm-code-review` 识别出两个仍在同一产品/技术边界内的问题：

- README 在“直接触发模板与编排规则”的最小模板列表中，仍未把“可清晰拆分的 review/advisory work -> 默认优先 bounded subagents”写成入口级摘要
- focused regression 目前主要锁定 README 与 skill wording，尚未直接断言两个 shared spec source-of-truth

这两个问题都属于 `033` 的 residual direct-fix boundary，但由于当前 `.imm/memory/current_iteration.json` 已不再保留 `033` 作为 current runtime plan，不能安全走 `append_to_plan`，因此需要一个新的 narrow follow-up slice。

## 3. 功能需求

### R1. README entry summary alignment

- README 顶部模板列表必须把“可清晰拆分的 review/advisory work 默认优先 bounded subagents”表达为入口级 shared truth
- 该补充不得改变现有 workflow chain、`imm-work` continue entry、或 dedicated reviewer trigger-only boundary

### R2. Focused spec coverage

- `tests/test_skill_contracts.py` 必须直接断言：
  - `.imm/specs/workflow-skill-subagent-orchestration.spec.md` 中存在 `subagent-first` 默认拆分 truth
  - `.imm/specs/skill-trigger-template-routing.spec.md` 中存在 `review / advisory work -> 默认优先 bounded subagents` truth
  - solo 只作为 explicit fallback 被表达
- regression 仍保持 focused，不扩展到 runtime orchestration tests

### R3. Verification path

- focused verification 至少证明：
  - README 顶部模板与 shared spec truth 一致
  - regression 直接覆盖 shared spec source-of-truth
  - `python3 -m unittest tests.test_skill_contracts` 通过

## 4. 验收标准

- [ ] README 顶部模板显式包含 `subagent-first` 的入口级 summary。
- [ ] `tests/test_skill_contracts.py` 直接断言 shared spec truth，而不只间接依赖 README / skill wording。
- [ ] focused suite 通过，且不引入新的 runtime harness。

## 5. 非目标

- 不修改 `.imm/memory/current_iteration.json` 或 plan/runtime sync 逻辑。
- 不重写 `033` 的 shared workflow / reviewer contracts。
- 不扩展到 dedicated reviewer runtime specs 或更多 README 段落。

## 6. 依赖项

- 依赖 [default-subagent-first-activation.spec.md](docs/specs/default-subagent-first-activation.spec.md) 的 shared target truth。
- 依赖 [2026-05-10-033-fix-default-subagent-first-activation-plan.md](docs/plans/2026-05-10-033-fix-default-subagent-first-activation-plan.md) 已完成的 contract alignment。
- 依赖最近一次 `imm-code-review` 对 README summary drift 与 spec-coverage gap 的 follow-up judgment。
