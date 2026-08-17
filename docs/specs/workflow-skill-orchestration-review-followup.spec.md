# Spec: workflow skill orchestration review follow-up

**任务 ID**: IMM-WORKFLOW-009
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 orchestration contract 落地后的两条 review follow-up：

- 让 `.imm/memory/MEMORY.md` 的 durable summary 与已完成的 workflow 状态一致
- 收紧 `tests/test_skill_contracts.py` 中新增的 orchestration planner assertion，
  避免用过宽泛的片段放过后续 contract 漂移

首版只处理这两条 direct-fix follow-up，不扩展到新的 orchestration 规则、shared
test harness、runtime automation 或 plan/state 机制改造。

## 2. 问题背景

上一轮 orchestration slice 已完成并通过 focused verification，但 review 指出两个
仍在当前修复边界内的问题：

- `MEMORY.md` 顶部仍写着“Continue through imm-work ... starting with U1”，
  与 `.imm/memory/current_iteration.json` 中 029 计划已全部完成的状态不一致。
- 新增的 focused contract test 对 planner orchestration 规则的断言只检查
  过宽片段，真实 contract 漂移时可能仍然通过。

这两个问题都不要求重开 orchestration scope，也不要求新的 runtime 行为；它们是
上一次交付的 bounded follow-up fix。

## 3. 功能需求

### R1. Durable summary sync

- `MEMORY.md` 的 `最新摘要`、`待办事项` 与 `最后同步` 必须反映 029 计划已完成的事实，
  不得继续把下一步写成 “从 U1 开始继续执行”。
- 下一步应与当前 workflow status 对齐：当前 plan 已完成，正常路由应转入
  `imm-compounder` 或明确指出已完成而非继续执行。

### R2. Focused planner assertion tightening

- `tests/test_skill_contracts.py` 中关于 planner orchestration 规则的新增断言必须
  更具体地绑定以下 truth：
  - `imm-code-review` 是 broad review baseline
  - conditional reviewers 只有在 trigger surface 明确时加入
  - trigger 缺失时 planner 保持 solo
- 不允许只用容易误命中的泛词片段（如单独的 `broad`）来代表完整规则。

### R3. Verification path

- 首版至少要能验证：
  - `MEMORY.md` 顶部摘要不再与 current workflow state 冲突
  - focused contract suite 仍通过，并能覆盖更具体的 planner orchestration 断言

## 4. 验收标准

- [ ] `MEMORY.md` 顶部摘要与 029 计划已完成的 workflow state 一致。
- [ ] `tests/test_skill_contracts.py` 对 planner orchestration 规则的断言明显强于当前宽片段版本。
- [ ] focused contract verification 可通过，且不引入新的 test harness 或 runtime 自动化。

## 5. 非目标

- 不改 `.imm/memory/current_iteration.json` 的 state machine 结构。
- 不新增 orchestration spec 字段、reviewer 类型或 runtime routing 逻辑。
- 不扩展到 `README.md`、skill contract 或 029 计划本身的再次重写，除非验证直接暴露新冲突。

## 6. 依赖项

- 依赖 [workflow-skill-subagent-orchestration.spec.md](docs/specs/workflow-skill-subagent-orchestration.spec.md)
  的当前 orchestration truth。
- 依赖 [2026-05-09-029-feat-workflow-skill-subagent-orchestration-plan.md](docs/plans/2026-05-09-029-feat-workflow-skill-subagent-orchestration-plan.md)
  的完成状态。
- 依赖最近一次 `imm-code-review` follow-up 对 `CR-001` 与 `CR-002` 的 direct-fix 路由判断。
