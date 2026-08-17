# Spec: current-step driver

**任务 ID**: IMM-WORKFLOW-003
**负责人**: Planner
**状态**: Draft

## 1. 目标

让用户只需要说一次“继续”或调用一次 `imm-work`，系统就能围绕当前 step 自动判断并推进可闭合动作：激活可执行 step、进入执行、收集执行证据、进入验收、处理返工或回退重拆。该能力只覆盖当前 step，不默认连续执行完整 plan。

## 2. 问题背景

`IMM-WORKFLOW-002` 已经让 `imm-work status` 返回 `next_action`，但实际落地仍是路由提示。当前实现不会自动执行 `next_action`，也没有从 `imm-executor` 证据到 `imm-qa` 闭合判断的状态交接，因此用户仍需要在每个 step 手动切换 `imm-work`、`imm-executor` 和 `imm-qa`。

## 3. 功能需求

- **单次继续入口**：
  - `imm-work` 必须提供一个明确的 continue 入口，用于推进当前 step 的下一段闭环。
  - 没有 active step 但存在可执行 plan step 时，continue 可以激活该 step。
  - 激活 step 后如果下一状态是执行，必须在同一轮进入 executor 语义；不得要求用户
    再说一次“继续”。
  - continue 每次最多推进当前 step，不自动激活并执行下一个未完成 step。
- **执行交接**：
  - active step 为 `active` 或 `needs_rework` 时，continue 必须进入 executor 语义。
  - 用户本次 continue / `imm-work` 调用即为进入当前 active step 执行语义的授权；
    不得只输出 `Next Action: imm-executor` 并要求用户再次手动切换或确认。
  - executor 完成后必须留下可追踪 evidence，供 QA 判断 pass、rework 或 replan。
  - 执行证据不足时，状态不得被乐观标记为可通过。
- **验收交接**：
  - 当前 step 已有执行证据时，continue 必须进入 QA 语义。
  - QA 仍是唯一能记录 `pass`、`rework` 或 `replan` 的角色。
  - `pass` 后必须停止在当前 step 之后，只报告下一个可继续 step。
- **边界约束**：
  - 不取消 `imm-executor` 的实现边界。
  - 不取消 `imm-qa` 的验收边界。
  - 不把 `imm-work` 扩展成 full-plan autowork。
  - 需要重拆时必须停止并返回 `imm-planner`。

## 4. 验收标准

- [ ] `imm-work` 文档说明一次“继续”会推进当前 step 的闭环，而不是只报告下一角色。
- [ ] active step 需要执行时，Codex-facing contract 不要求额外用户确认才进入
      `imm-executor` 语义。
- [ ] 本地状态或命令能区分 `needs_execution`、`ready_for_review`、`needs_rework`、`replan_required` 和 `done`。
- [ ] executor 产出的 evidence 能被后续 QA 决策消费。
- [ ] QA pass 后不会静默执行下一个 step。
- [ ] rework 只回到当前 step 的执行语义，不扩大 scope。
- [ ] replan 会停止当前推进并路由到 `imm-planner`。
- [ ] 文档明确 full-plan autowork 仍是非目标。

## 5. 非目标

- 不实现完整计划自动执行。
- 不让 `imm-work` 绕过 executor 直接改实现文件。
- 不让 `imm-work` 绕过 QA 直接记录 pass。
- 不重写所有历史 plan。
- 不新增复杂多代理调度系统。

## 6. 依赖项

- 依赖 `.imm/specs/single-step-orchestration.spec.md` 的 `next_action` 路由基础。
- 依赖 `.imm/specs/plan-work-review-rewrite.spec.md` 的小步闭环定义。
- 依赖当前 `.imm/imm-work.py`、`.imm/imm-review.py` 和 `.imm/memory/current_iteration.json` 的 active step 状态。
