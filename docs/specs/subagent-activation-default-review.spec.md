# Spec: subagent activation default strategy check

**任务 ID**: IMM-SUBAGENT-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

确认仓库中现有 `imm-*` 子代理激活策略与以下边界一致：

- 优先并行激活可拆分且可并行的 subagent（含 reviewer、planner 类）
- 仅在任务不可拆、存在强耦合阻塞、或用户明确要求时才 fallback solo
- 任何实现动作必须先经过 `imm-planner`（或已有 follow-up 对应的 `imm-preplan-review`）再进入 `imm-work`

## 2. 范围

仅进行策略核验与不一致项收敛建议，不新增任何 runtime 机制、路由器或全局调度器。

## 3. 验证标准

- `IMMUNE.md`、`docs/brainstorms/*`、相关 `.imm/specs/*`、`docs/plans/*`、已激活的 skill 说明文件中，默认策略与上述三条边界一致。
- 仅形成“偏差清单 + 建议动作”，不在本轮产出代码或实现变更。

## 4. 非目标

- 不改 .imm/runtime 状态、.imm/scripting、CI 流程、skill 合同的执行测试。
- 不新增新 subagent 角色，不重写现有 skill 能力。
