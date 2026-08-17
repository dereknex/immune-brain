# Spec: Immune-Brain 会话流顺滑化与输出收敛

**任务 ID**: IMM-WORKFLOW-UX-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标
把 Immune-Brain 的默认协作体验从“暴露流程执行日志”收敛为“直接交付结果”，重点解决三类问题：

- 流程反复：减少 `imm-work` / `imm-executor` / `imm-qa` 在用户视角的来回切换。
- 输出啰嗦：默认只暴露结论、产物、下一步，不回显内部状态机和中间动作。
- 状态失配：对无效 `plan_path`、重复运行态文件、无效 active step 提供进入前静默修复路径。

## 2. 需求

### R1. 单一继续入口与成功路径自动推进
- 用户继续当前任务时，默认只进入 `imm-work` 单入口。
- `imm-work` 在同一轮内应尽量自动推进当前 step 到安全边界，不要求用户显式切 skill。
- 成功路径只在到达边界时汇报，不逐条播报 `activate`、`record-execution`、`ready_for_review`、`pass`。

### R2. 默认输出收敛为结果模式
- 默认输出格式收敛为三段：结论、产物、下一步。
- 非调试场景下，不默认输出 `workflow_packet`、`history`、`driver_state`、`next_skill`、完整 JSON 状态包。
- 仅在 `rework`、`replan`、状态异常、或用户明确要求复核/调试时展开详细过程。

### R3. 状态源唯一化与预检查自愈
- `current_iteration` 必须有单一 source of truth，不允许并行运行态文件导致读写分叉。
- 进入 `imm-work` 前增加 lightweight preflight：
  - `plan_path` 是否存在
  - active step 是否合法
  - step 依赖是否满足
  - plan 是否可被本地解析
- 对可自动修复的问题，优先静默修复并继续，而不是先向用户暴露脏状态。

### R4. QA 与全局输出契约收紧
- `imm-qa` 在 `pass` 场景下只输出一句结论和一句证据。
- 失败路径才输出 gap、阻塞项、下一动作。
- 全局默认输出避免暴露 skill 名称、状态机字段名、内部 JSON 结构。

## 3. 验收标准
- [ ] 用户在成功路径中看到的默认收尾输出控制在 3-6 行。
- [ ] 当前 step 成功闭环时，不再要求用户显式切换到 `imm-executor` 或 `imm-qa`。
- [ ] 当运行态存在可修复脏状态时，`imm-work` 能自动修复并继续，除非存在真正阻塞。
- [ ] `imm-qa` 的 `pass` 不再输出完整 closure packet。
- [ ] 技能文档、测试或回归夹具能证明默认输出与异常输出分流已经收紧。

## 4. 依赖项
- 依赖 `IMMUNE.md` 中的角色边界和计划/执行/验收职责分离。
- 依赖现有 `imm-work`、`imm-qa`、`imm-planner` skill 契约。
- 依赖当前 workflow loop、skill contract、health gate 相关测试或夹具。

## 5. 非目标
- 不在本轮引入新的 workflow skill。
- 不把输出收敛扩展为完整 UI 或交互层重构。
- 不顺带做无关实现重写或大规模架构清理。
