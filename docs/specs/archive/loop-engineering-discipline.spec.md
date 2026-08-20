# Spec: Loop Engineering Discipline for Immune-Brain

**任务 ID**: IMM-WORKFLOW-LOOP-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

吸收 loop engineering 中对 AI coding agents 有价值的纪律：明确失败退出、结构化反馈、短 loop trace、预算停止和策略变化要求。该吸收必须服务于 Immune-Brain 现有的 `Step`、`Executor`、`QA`、`State Ledger` 和 `Compounder` 闭环，而不是引入新的自动调度平台。

本 Spec 是总设计说明和当前执行切片的行为契约。它先统一方向，再由 Plan 拆成可验证 Step。

## 2. 背景

MindStudio 的 loop engineering 文章强调：高质量 agent loop 需要清晰目标、可用工具、上下文管理、终止逻辑和错误恢复。Immune-Brain 已经具备更强的 workflow 骨架：authority 分离、validated Plan、execution evidence、QA 闭合和 durable Learning。

当前可吸收的不是“更自动地循环”，而是让已有循环在失败、重复、预算和证据表达上更清楚。

## 3. 需求

### R1. failure exit 必须成为一等契约

- `imm-executor`、`imm-work`、`imm-autowork`、`imm-qa` 的人类可读契约应能区分至少这些失败退出：重复同错、工具失败、无进展、缺少凭据或外部权限、目标或验收不清。
- 失败退出不能被写成泛泛的 “blocked”；必须保留可恢复的下一步说明。

### R2. execution evidence 应包含最小 loop trace

- `Executor` 交给 `QA` 的 evidence 应鼓励包含短格式 loop trace：尝试、观察、判断、下一步策略。
- loop trace 不应变成完整 transcript；它只保留影响 QA 判断的关键反馈。

### R3. 工具反馈应被结构化压缩

- 对 test、lint、stack trace、tool failure 等输出，Executor 应总结目标、失败点、相关文件、是否重复、下一策略，而不是把 raw dump 当作主要证据。
- raw output 仍可作为 evidence，但用户可见和 QA 消费的摘要要可读、可比较、可恢复。

### R4. 重复失败必须要求 strategy change

- 当同一失败重复出现时，下一轮 rework 不能只是重跑同一动作。
- `QA` 应把“重复失败但没有策略变化”视为 rework 或 replan 信号。

### R5. `imm-autowork` 应有预算与停止语义

- `imm-autowork` 仍是显式 opt-in 的 bounded autowork，不变成默认 `imm-work` 行为。
- 契约应明确预算语言：最大 Step 数、最大 rework 次数、无进展停止、工具失败停止、需要用户输入停止。
- 预算停止只报告边界和下一步，不自动通过 QA。

### R6. 失败路径也要有验证

- 当前切片应增加 focused contract coverage，证明上述纪律没有漂移为新 dispatcher、runtime default QA pass 或全局 memory plane。
- 后续 runtime slice 若出现，必须先证明契约层已经稳定。

## 4. Roadmap

### Phase 1. Contract adoption

当前可执行切片。更新 skill contract、repo-facing workflow guidance 和 focused tests，让 loop discipline 成为可回归的文档/契约事实。

### Phase 2. Runtime signal tightening

仅在 Phase 1 证明有价值后考虑。可能把部分 failure exit 或 budget fields 变成 machine-readable runtime snapshot，但不得替代 `QA`。

### Phase 3. Learning and telemetry synthesis

仅在已有真实执行 evidence 后考虑。把重复失败、rework 次数、budget stop 等沉淀为 `docs/solutions/` 或 dev insights 输入。

## 5. 验收标准

- [ ] `imm-executor` / `imm-qa` 契约描述最小 loop trace、structured feedback 和 repeated-failure strategy change。
- [ ] `imm-autowork` 契约描述预算与停止语义，并保持 no default QA pass。
- [ ] repo-facing workflow guidance 说明 Loop Engineering Discipline 是对现有 `Step` 闭环的增强，不是新平台。
- [ ] focused tests 锁住 failure exit、loop trace、strategy change、budget stop 和 rejected boundaries。
- [ ] Plan validation 通过，并保留完整 `Brainstorm Trace`。

## 6. 非目标

- 不新增 shared registry。
- 不新增 generic dispatcher。
- 不新增 `imm-autowork-driver`。
- 不让 runtime 根据 executor verification 自动执行 QA `pass`。
- 不引入 SQLite、wiki plane 或新的全局 memory authority。
- 不让 subagents 绕过 `imm-work`、`Executor` 或 `QA`。

## 7. 依赖项

- `CONTEXT.md` 中 `Step`、`Plan`、`Executor`、`QA`、`State Ledger`、`Compounder` 的 canonical terms。
- `IMMUNE.md` 中 authority 分离、host-bound evidence loops 和 `imm-autowork` deterministic checkpoint runtime 边界。
- `docs/reference/workflow-and-subagents.md` 中 Skill 边界和 subagent authority class。
- `docs/reference/planning-quality-gate.md` 中 elevated-risk planning checks。
- `docs/solutions/rejected-autowork-driver-default-pass.md`。
- `docs/solutions/rejected-shared-registry-generic-dispatcher.md`。
- `docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md`。
