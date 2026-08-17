# Spec: workflow friction retrospective follow-up

**任务 ID**: IMM-WORKFLOW-005
**负责人**: Planner
**状态**: Proposed

## 1. 目标

基于本次 telemetry session 的复盘，收敛一组高收益、低耦合的 workflow friction 修复，
降低多轮计划/审查/自动推进场景下的状态噪音、路由不清和 durable summary 漂移，同时保持
现有 authority boundary 不变。

首轮只处理 4 类问题：

1. `imm-code-review` 对 follow-up fix 的路由信息不够强；
2. `imm-work status` 默认输出被长历史和深层状态淹没；
3. `MEMORY.md` 顶部 durable summary 仍容易与真实完成态漂移；
4. focused tests / execution evidence 的正常 CLI 打印噪音偏高。

## 2. 问题背景

这轮 session 暴露的摩擦不在“系统不能闭环”，而在“闭环过程成本偏高”：

- 同一 telemetry 主题先后出现多个 follow-up plan，虽然每次都合理，但缺少更强的
  review-to-repair 路由提示，导致用户需要手动判断是“当前 step 修”还是“新切片计划”。
- `.imm/memory/current_iteration.json` 的历史轨迹不断累积，`imm-work status`
  默认输出里真正高信号的当前 plan / step / next action 被埋住。
- `MEMORY.md` 顶部摘要多次依赖补丁式 hotfix 对齐，说明 durable summary 仍缺少更稳定的
  completion/compound 收口约束。
- focused tests 会把成功路径 CLI 打印带进证据面，影响 review / autowork 的可读性。

同时，也有两个复盘点本轮暂不处理：

- 自动 skill 切换减少用户手动点名；
- 更普遍的“少读全文、优先读增量”上下文优化框架。

这两个问题涉及更广的 orchestration / prompt 行为约束，超出本轮最小修复范围。

## 3. 功能需求

### R1. Code review 必须明确 repairability 路由

- `imm-code-review` 的结构化 findings 或默认输出必须能明确区分至少两类 follow-up：
  - 当前 active step / 当前实现边界内可直接修复；
  - 需要新 follow-up plan 的结构性问题。
- 当 review 结论要求新计划时，用户-facing 输出必须直接说明“需要新 fix slice”，而不是仅给
  笼统的 `fix`。
- follow-up planning artifact 必须显式引用来源 plan 或来源 review，避免同主题 plan churn
  缺少可追踪上下文。

### R2. `imm-work status` 默认输出必须压缩为高信号视图

- 默认 status 应优先展示：
  - active plan path / summary
  - active step
  - completed step ids 或 count
  - latest review
  - next action
- 长 history、完整 codex snapshot、旧 plan 轨迹不应继续作为默认成功输出主体。
- 如需保留完整状态，必须通过显式 debug / verbose / JSON 路径访问，而不是占用默认人类可读面。

### R3. Durable summary 必须稳定对齐闭合态

- `MEMORY.md` 顶部 `最新摘要` 与 `待办事项` 必须在 plan 完成并进入 compound/finish 后，
  明确反映当前已闭合事实，而不是继续描述过期执行态。
- 本轮允许通过 finish / compound / summary-sync 路径统一收口，但不重写
  `.imm/memory/current_iteration.json` 的 source-of-truth 语义。
- focused regression 必须覆盖至少一个“plan 完成后 summary 及时切回完成态”的路径。

### R4. Focused verification 输出必须降噪

- 面向回归测试和 execution evidence 的成功路径，不应默认把普通 CLI 打印混进测试输出，
  除非该打印本身就是待验证 contract。
- 新增或更新的 focused tests 应优先断言结构化返回值、文件内容或状态字段，而不是依赖
  stdout 杂讯。
- 本轮只处理本仓库内 `imm-*` workflow / telemetry 相关 focused tests，不扩展到所有测试风格。

## 4. 验收标准

- [ ] `imm-code-review` 对 follow-up fix 能区分“当前边界可修”和“需要新计划”。
- [ ] follow-up plan 会明确写出来源 review / 来源 plan，而不是孤立出现。
- [ ] `imm-work status` 默认输出压缩为高信号视图，完整历史退到显式调试路径。
- [ ] `MEMORY.md` 顶部摘要在计划闭合后不再经常滞留在 planned / execute wording。
- [ ] 至少一条 focused regression 覆盖 durable summary 与已完成 runtime state 的对齐。
- [ ] focused test 成功路径的 CLI 杂讯被显著压缩，execution evidence 更可读。
- [ ] 本轮不引入 authority merge、自动 skill routing、隐藏后台执行或新的状态仓库。

## 5. 非目标

- 不实现自动 skill/role 切换，仍保持显式 workflow 入口。
- 不设计全局 prompt/context 优化框架，也不试图直接控制模型的全文读取策略。
- 不重写 `.imm/memory/current_iteration.json` 的 canonical runtime state 语义。
- 不把 `imm-code-review` 升级为自动修复器。
- 不扩展到默认 full-plan autowork、后台调度或新的 orchestration mode。

## 6. 依赖项

- 依赖 `.imm/specs/workflow-friction-reduction.spec.md` 的默认入口收口与 preplan gate 边界。
- 依赖 `.imm/specs/workflow-friction-review-followup.spec.md` 和既有 durable summary sync 热修切片经验。
- 依赖 `docs/solutions/default-debug-workflow-output-split.md`、
  `docs/solutions/closure-side-durable-summary-sync.md`、
  `docs/solutions/repo-facing-trigger-contract-parity.md` 的现有模式约束。
