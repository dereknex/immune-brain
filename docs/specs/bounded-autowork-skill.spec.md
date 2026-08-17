# Spec: bounded autowork skill

**任务 ID**: IMM-WORKFLOW-004
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 新增一个独立的 bounded autowork skill，使系统在存在 validated plan 的前提下，能够按明确 stop condition 自动推进实现流程，减少用户在 `imm-work`、`imm-executor`、`imm-qa` 之间反复手动切换。

首版只要求“按计划推进到安全阻塞点并汇报”，不要求无条件跑完整个 plan，也不允许绕过现有的 planning、execution、QA 权限边界。

## 2. 问题背景

`IMM-WORKFLOW-003` 已让 `imm-work` 成为 current-step driver，并支持 same-turn 进入 executor 或 QA 语义，但它仍明确限制为“每次只推进当前 step 到下一个安全边界”，并且非目标中已经写明不做 full-plan autowork。

现在的问题不是 current-step driver 不存在，而是当一个 plan 已经拆得足够小、用户也明确想“按计划自动推进实现”时，系统缺少一个独立入口去保守地连续推进多个 step，直到遇到 blocker、rework、replan、缺证据或用户设定的预算上限。

## 3. 功能需求

### R1. 独立 skill 入口

- 系统必须新增一个独立 bounded autowork skill。
- 该 skill 必须以 validated plan 作为前提，不得在没有 validated plan 的情况下启动执行。
- 该 skill 不得把 `imm-work` 的默认语义改成 full-plan autowork。
- 该 skill 必须被定义为 orchestration entry，而不是新的并行执行权限来源。

### R2. 自动推进模式

- 首版必须至少支持 `run until blocked` 模式。
- 首版可以额外支持受限预算模式，例如“最多推进 1 个 step”或“最多推进 N 个 step”，但不得把预算配置做成复杂策略系统。
- autowork 过程中每次只允许有一个 active step。
- 当前 step `pass` 后，系统可以激活并继续下一个已满足依赖的 step；如果没有下一个可执行 step，则停止并汇报。

### R3. 权限边界复用

- 计划创建与变更仍由 `imm-planner` 负责。
- step 激活和运行态状态仍以 `.imm` 工作流状态为准。
- 实现改动仍必须服从 `imm-executor` 的单 step 边界。
- 闭合判断仍必须服从 `imm-qa` 的 `pass` / `rework` / `replan` 决策边界。
- autowork skill 可以编排进入这些语义，但不得绕过 evidence、QA 或 replan。

### R4. stop condition

- 遇到以下情况时，autowork 必须停止并明确汇报原因：
  - 没有 validated plan
  - 没有可执行 step
  - active step 缺少执行证据
  - QA 返回 `rework`
  - QA 返回 `replan`
  - 当前 step 暴露 scope 膨胀或依赖缺失
  - 达到用户设定的 step budget
- 当停止原因为 `rework` 或 `replan` 时，输出必须明确下一步应回到哪个 skill。

### R5. 可追溯输出

- autowork skill 的输出必须至少包含：
  - active plan
  - 本轮完成的 steps
  - 停止原因
  - 下一步 skill
  - 是否需要用户介入
- 输出必须区分：
  - 正常完成全部计划
  - 推进到 blocker 停止
  - 因 rework / replan 停止
  - 因预算上限停止

### R6. 非侵入式首版

- 首版不得重写历史 plan 文件。
- 首版不得引入复杂多代理调度器、后台自动运行器或独立长期状态机。
- 首版不得默认自动运行完整 plan。
- 若需要为 autowork 新增 CLI 或状态字段，必须保持与当前 `.imm/imm-work.py` / `.imm/imm-review.py` 的状态模型兼容。

## 4. 验收标准

- [ ] 存在一个独立 bounded autowork skill 定义，文档说明它不是 `imm-work` 的默认 full-plan autowork 扩展。
- [ ] 有 validated plan 时，autowork contract 能说明如何从当前状态推进到下一个 blocker 或完成点。
- [ ] 没有 validated plan 时，autowork 会停止并返回 `imm-planner`，而不是开始改代码。
- [ ] QA `pass` 后 autowork 可以继续到下一个已解锁 step；QA `rework` / `replan` 时会停止。
- [ ] stop condition 覆盖 blocker、缺证据、rework、replan、预算上限和 plan 完成。
- [ ] 文档明确保留 `imm-executor` 和 `imm-qa` 的 authority boundary。
- [ ] `python3 .imm/imm-plan.py <plan-path> --json` 可以通过对应 iteration plan 校验。

## 5. 非目标

- 不把 `imm-work` 直接改造成默认 full-plan autowork。
- 不让 autowork skill 绕过 `imm-executor` 直接任意改实现文件。
- 不让 autowork skill 绕过 `imm-qa` 直接记录 `pass`。
- 不实现后台定时运行、自动提醒或 heartbeat。
- 不引入复杂策略引擎、并行 step 执行或多 active step。

## 6. 依赖项

- 依赖 `.imm/specs/current-step-driver.spec.md` 中的 current-step continue contract。
- 依赖 `.imm/specs/single-step-orchestration.spec.md` 中的 `next_action` 路由基础。
- 依赖当前 `.imm/imm-work.py`、`.imm/imm-review.py` 和 `.imm/memory/current_iteration.json` 提供 active step、completed steps 和 review state。
- 依赖现有 `imm-planner -> imm-work -> imm-executor -> imm-qa` 的权限边界仍然成立。

## 7. 首版验证路径

首版实现完成后，至少必须证明下面四类路径；没有这些证据，不得宣称
`imm-autowork` 已经闭合：

### V1. no-plan routing

- 场景：没有 validated plan，或当前 plan 不可解析。
- 期望：`imm-autowork` 立即停止，不进入实现语义，并把下一步路由回
  `imm-planner`。
- 证明方式：命令输出或结构化状态中明确出现 `next_skill = imm-planner`
  与 no-plan stop reason。

### V2. step-to-step bounded advance

- 场景：存在至少两个可顺序执行的小步计划。
- 期望：
  - `imm-autowork` 每次只允许一个 active step；
  - 当前 step `pass` 后，只在预算允许且依赖满足时进入下一个 step；
  - 不能跳过 `imm-executor` / `imm-qa` 边界。
- 证明方式：fixture plan 或可复现 workflow log 显示
  `activate -> execution evidence -> QA pass -> next step activation` 的顺序，
  且不存在双 active step 或越权 `pass`。

### V3. QA stop behavior

- 场景：当前 step 缺证据、QA 返回 `rework`、或 QA 返回 `replan`。
- 期望：
  - 缺证据时不能乐观通过；
  - `rework` 时停止并回到当前 step 的执行语义；
  - `replan` 时停止并回到 `imm-planner`。
- 证明方式：状态输出或 review records 明确区分这三类停止原因，并给出对应
  `next_skill`。

### V4. completion / budget stop reporting

- 场景：计划全部完成，或运行到用户指定的小预算上限。
- 期望：
  - 全部完成时报告 plan complete；
  - 预算耗尽时报告 budget reached，而不是伪装成 blocker；
  - 两种情况都要给出本轮完成的 steps 和下一步建议。
- 证明方式：运行摘要中明确包含 stop reason、completed-in-run steps、
  next skill，以及用户是否需要介入。
