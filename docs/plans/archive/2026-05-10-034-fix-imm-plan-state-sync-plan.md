---
title: fix: route plan-level state sync through imm-plan
type: fix
status: planned
date: 2026-05-10
origin: 用户明确要求：任何 plan 变更都应由 imm-plan 同步 plan/runtime 关系，禁止由 imm-work 维护计划级状态写入；结合现有 workflow 保证 imm-work 继续负责 step 执行闭环。
---

# Iteration Plan

## Task
- Summary: 收敛 plan-state 运行态同步边界，要求计划层写入只走 `imm-plan`，把 `imm-work` 限制为 step 生命周期的 current-step driver，避免运行态真源漂移。
- Origin: 用户最新反馈指出当前计划更新策略不统一，计划创建、验证通过后状态更新不应再由 `imm-work` 承担，应统一由 `imm-plan` 在验证成功后更新。
- Research:
  - 已读取 `IMMUNE.md`，确认规划-only 阶段写边界及 plan/workflow 责任链。
  - 已读取现有 truth 规格：`codex-plan-sync.spec.md`、`current-iteration-closure-contract.spec.md`、`workflow-trigger-repair.spec.md`。
  - 已检查 `skills/imm-planner/SKILL.md`、`skills/imm-work/SKILL.md` 与现有 `.imm/imm-plan.py`、`.imm/imm-work.py` 的职责描述。
- Decisions: 采用 Scope Reduction，优先做职责边界与可验证收敛；不引入新状态源，不改变 executor/qa 角色边界；先把计划同步语义收口到 `imm-plan`，再更新文档与验证。
- Assumptions:
  - “plan 变化”范围限定为：新建/更新 plan 文件后，需通过 `imm-plan --json` 变更可追溯计划摘要与活跃计划元信息；
  - `imm-work` 继续保留 step activation 与 step lifecycle 的原始职责；
  - 本轮仅收敛到本地 plan/workflow 契约，不扩展到外部调度器或跨项目 registry。
- Scope Mode: Scope Reduction
- Replan condition: 如需在执行时新增 runtime schema 或迁移现有 state 行为，先 route 回 `imm-planner` 重切片。

## Steps

### Step 1
- Step ID: U1
- Result: 建立 plan-level 真源归属：仅由 `imm-plan` 同步 plan 状态。
- Verification: 修改 `.imm/specs/plan-state-sync-via-imm-plan.spec.md` 与 `skills/imm-work/SKILL.md` 后，明确可见 `imm-plan` 与 `imm-work` 职责不重叠。
- Test scenarios:
  - `imm-plan` 在成功验证后负责更新 `current_iteration` 计划元数据；
  - `imm-work` 文档不再宣称 plan-level 同步回写为其职责。
- Depends on: none
- Scope: `.imm/specs/plan-state-sync-via-imm-plan.spec.md`, `skills/imm-work/SKILL.md`
- Replan condition: 如果现有契约要求改动后再加一条执行约束（例如影响 `imm-work` 已有 step state），该 step 需回到 `imm-preplan-review` 重新界定边界。

### Step 2
- Step ID: U2
- Result: 在 `imm-plan` 验证成功后完成 plan 元信息的标准写入。
- Verification: 运行 `python3 .imm/imm-plan.py /Users/derek/Workspaces/agent-skills/docs/plans/2026-05-10-034-fix-imm-plan-state-sync-plan.md --json`，并确认 `.imm/memory/current_iteration.json` plan-level 字段。
- Test scenarios:
  - 同一个 plan 重复验证不应乱序重置已有 step 状态；
  - plan 内容变更后 revalidate，状态重置行为符合 spec。
- Depends on: 1
- Scope: `.imm/imm-plan.py`
- Replan condition: 若发现运行时状态字段已在其他工具持有不一致所有权，需返 `imm-planner` 增加一条专门的状态兼容子步。

### Step 3
- Step ID: U3
- Result: 将 `codex_plan` 限定为只读展示层并保持本地 runtime 写入.
- Verification: 通过 `python3 .imm/imm-plan.py /Users/derek/Workspaces/agent-skills/docs/plans/2026-05-10-034-fix-imm-plan-state-sync-plan.md --json` 与 `python3 .imm/imm-work.py status --json` 验证展示与状态源一致。
- Test scenarios:
  - 从 validated plan 到 continue 到当前 step，展示面板信息与 runtime source of truth 一致；
  - 验证通过后的 plan 在 `imm-work status`/`status --json` 中可见；
  - 无需新增全新状态源或 scheduler。
- Depends on: 1, 2
- Scope: `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `.imm/imm-work.py`, `tests`
- Replan condition: 若展示一致性只能通过改动 `imm-work` 的 plan source 读取路径来保证，先回到 `imm-planner` 明确最小闭环范围再继续。

## Notes
- 这是一个职责修复切片：目标不是减少 `imm-work` 价值，而是把它从“计划层真源写入者”剥离，恢复到 step driver。
- 优先使用 `python3 .imm/imm-plan.py ... --json` 形成 plan-level state sync 的标准入口，后续执行都从该入口获取可证据化触发。
