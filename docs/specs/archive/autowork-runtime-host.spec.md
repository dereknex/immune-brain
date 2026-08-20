# Spec: autowork runtime host

**任务 ID**: IMM-WORKFLOW-006
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把 `imm-autowork` 从“主要依赖 skill prose 的编排入口”推进为一个真实的 host-bound
runtime surface，使其在显式 opt-in 的前提下，能稳定驱动 validated Plan Step 与
pending reviewer `follow_up` 的自动推进闭环，而不会在 `imm-qa` 边界前误停。

本次提升的目标是让 `imm-autowork` 成为 **单一 shared workflow host**：

- 它复用既有的 `imm-work -> imm-executor -> imm-qa` 权限链
- 它把 QA 视为同一轮 run 内必须进入的 authority phase，而不是遇到边界就停的理由
- 它仍然不是后台执行器、平台化 dispatcher、或新的 authority source

## 2. 问题背景

仓库现状已经完成了两层工作：

1. `bounded-autowork-skill.spec.md` 与相关 docs/skills 已经把 `imm-autowork`
   定义成显式 opt-in 的 bounded autowork 入口；
2. `autowork-workflow-refinement.spec.md` 又补上了 `can_auto_advance`，
   让 `imm-work status --json` 能提供机器可读推进信号。

但当前缺口仍然存在：

- `imm-autowork` 还没有一个真实的 runtime host surface 去消费这些信号；
- host 容易把 “不要绕过 `imm-qa` authority” 误读成 “到 QA 边界应停”；
- focused tests 只证明 `imm-work` 会在 `ready_for_review` 时把下一步路由成
  `qa`，没有证明 `imm-autowork` 会把这个 `qa` 当作 **同轮继续阶段**；
- 因此当前系统更像 “contract exists” 而不是 “runtime truth exists”。

下一刀不应直接跳到 shared registry、automatic dispatcher 或后台运行器，而应先让
`imm-autowork` 自己成为第一条真实、可回归的 workflow runtime host path。

## 3. 功能需求

### R1. Single shared runtime host for autowork

- `imm-autowork` 必须新增真实 runtime surface，而不只是一段 skill prose。
- 该 surface 可以表现为本地 `.imm` helper、plugin runtime tool、或两者组合，
  但必须有 focused regression 可验证。
- 当前只允许把 `imm-autowork` 提升为 shared workflow host；不得同时把
  `imm-work`、`run` 或其他 workflow coordinator 一起升级成同类 runtime host。

### R2. Same-run loop must cross QA boundary

- 当 `imm-work status --json` 返回：
  - `can_auto_advance: true`
  - `next_action.action == "qa"`
  时，`imm-autowork` 必须把这视为 **same-run continuation phase**，
  而不是 stop reason。
- `imm-autowork` 必须在同一轮 run 内进入 QA authority phase，并在 QA `pass`
  之后重新读取 workflow status，决定是否继续下一个已解锁 Step。
- `imm-autowork` 仍不得伪造 QA 结论；QA closure 仍通过既有 `imm-review`
  / `imm-qa` authority path 记录。

### R3. Deterministic run accounting without new authority

- `imm-autowork` 必须维护 machine-readable run accounting，至少包括：
  - active plan path
  - completed steps in run
  - whether a pending `follow_up` was consumed
  - stop reason
  - next recommended skill
- 它可以自动完成确定性状态推进，例如读取 status、触发 activation、
  记录 run snapshot。
- 它不得直接写 planner-owned scope、不得直接改 executor code、不得直接伪造
  QA `pass` / `rework` / `replan`。

### R4. Follow-up path and stop reasons remain bounded

- `imm-autowork` 仍必须支持两类 bounded target：
  - validated Plan Step progression
  - completed Plan plus pending reviewer `follow_up`
- 以下情况必须停止并明确原因：
  - no validated plan
  - malformed or missing `follow_up`
  - `rework`
  - `replan`
  - dependency gap / no executable step
  - budget reached
  - true completion
- `budget reached` 必须被视为 intentional stop，而不是 blocker。

### R5. Non-platform boundary is explicit

- 本次实现不得引入：
  - shared registry
  - generic dispatcher
  - background scheduler
  - multi-active-step execution
  - cross-session hidden queue
- `imm-autowork` 的 runtime host 必须保持 host-bound、single-purpose、
  validated-plan-first 的边界。

## 4. 验收标准

- [ ] `imm-autowork` 拥有真实 runtime surface，而不是仅靠 skill prose 编排。
- [ ] 当 `next_action.action == "qa"` 且 `can_auto_advance: true` 时，autowork
      继续进入 QA phase，而不是停在 “权限边界提醒”。
- [ ] QA `pass` 后，autowork 会继续下一个已解锁 Step；`rework` / `replan` 时停止。
- [ ] completed Plan plus pending reviewer `follow_up` 仍可通过 autowork 闭环到
      QA or safe stop。
- [ ] run accounting 明确区分 `finished`、`blocked`、`rework_needed`、
      `budget_reached`、`follow_up_complete` 等停止类型。
- [ ] focused regression 明确证明 “single host runtime path exists” 与
      “no platform expansion truth still holds”。

## 5. 非目标

- 不把 `imm-work` 改造成默认 full-plan autowork。
- 不让 `imm-autowork` 绕过 `imm-executor` 或 `imm-qa` authority。
- 不实现后台自动运行、heartbeat、reminder 或 queue。
- 不在本次引入 shared registry、automatic dispatcher、agent-to-agent 通信。
- 不把 review / planner / release 类 host 一起纳入同一 runtime rollout。

## 6. 依赖项

- 依赖 [docs/specs/bounded-autowork-skill.spec.md](docs/specs/bounded-autowork-skill.spec.md)
  作为显式 opt-in 与 stop condition 基线。
- 依赖 [docs/specs/autowork-workflow-refinement.spec.md](docs/specs/autowork-workflow-refinement.spec.md)
  作为 `can_auto_advance` 信号基线。
- 依赖 [docs/specs/autowork-followup-completion.spec.md](docs/specs/autowork-followup-completion.spec.md)
  作为 completed-plan plus `follow_up` 例外路径基线。
- 依赖 [docs/solutions/shared-runtime-host-before-platform.md](docs/solutions/shared-runtime-host-before-platform.md)
  作为 “先做单一 shared host、不要直接平台化” 的复用模式。
- 依赖 [docs/solutions/rejected-shared-registry-generic-dispatcher.md](docs/solutions/rejected-shared-registry-generic-dispatcher.md)
  作为被拒绝方案边界。

## 7. Codex Runtime Manual Validation

当 repo 内自动化测试无法完整模拟同一轮 host 驱动 executor / QA 的真实对话时，
使用以下手工验证路径：

### Scenario A. ordinary plan-step run

1. 准备一个至少有两个小步的 validated plan。
2. 通过 `imm-autowork` 进入显式 autowork run。
3. 预期行为：
   - host 读取 `imm-work status --json`
   - `activate` / `executor` / `qa` 都被视为同一轮 run 的内部阶段
   - 当 status 到达 `qa` 时，host 不以“进入 `imm-qa` 边界”为由停止
   - `pass` 后继续下一个已解锁 Step，直到 blocker、budget 或完成

### Scenario B. pending reviewer follow-up

1. 准备一个 completed Plan，且当前上下文存在 bounded pending reviewer `follow_up`。
2. 通过 `imm-autowork` 启动 follow-up run。
3. 预期行为：
   - host 不错误地直接路由到 `imm-compounder`
   - 而是继续通过 `imm-work -> imm-executor -> imm-qa`
   - follow-up 闭合后，才报告 finished 或进入 compounder handoff

### Scenario C. non-platform boundary

1. 观察本轮实现 surface 与测试。
2. 预期行为：
   - 只新增 `imm-autowork` 单一 shared workflow host
   - 不出现 shared registry / generic dispatcher / background queue 叙述
   - 不出现多 active step、隐式 scope 扩张或 authority 升级
