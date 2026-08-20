# Spec: review task handling workflow

**任务 ID**: IMM-REVIEW-003
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把 Immune-Brain 当前分散的 review 相关处理路径收敛成一套完整、可验证、可继续执行的 workflow contract，覆盖：

- current step QA closure 失败后的 `rework`
- same-boundary review follow-up
- 超出原边界的 `new_slice`
- PR blocker 类修复
- 以及 same-boundary follow-up 内部可能命中的 `append_to_plan` disposition

本轮目标是完整规划 review 任务处理，而不是只修其中某一条入口文案：

1. 定义 review 结果的 route matrix；
2. 明确每条 route 的默认 continue entry 与 authority role；
3. 明确 `imm-work`、`imm-planner`、`imm-qa`、`imm-pr-fix`、reviewer family 的职责边界；
4. 为 README、runtime truth 和 focused regression 提供统一真源。

## 2. 问题背景

仓库当前已经有多块相邻 contract，但它们尚未被统一规划成一条完整 review 处理链：

- `imm-qa` / `imm-review` 已经定义了 `pass` / `rework` / `replan` 的 current-step closure 语义；
- `imm-code-review` / `imm-ui-review` 已经定义了 bounded `follow_up` handoff；
- `imm-planner` 已支持消费 review handoff；
- `append_to_plan` 已定义 completed current plan 的窄追加边界；
- `imm-pr-fix` 已覆盖 PR review feedback、CI failure 和 merge conflict。

但现状仍有 3 个系统性摩擦：

- 用户看到 “review 需要修复” 时，缺少一张统一路由表，不知道该回当前 step、进 `imm-work`、进 `imm-planner`，还是直接进 `imm-pr-fix`；
- same-boundary repair、current-step `rework`、PR blocker 这三类“都像需要修复”的事情，在 skill wording 和 README 里仍然容易混流；
- 现有 `042` 只覆盖 same-boundary follow-up 的 continue-entry 问题，不能替代完整 review handling 规划。

因此，本轮要做的是 **review task handling workflow 的全量 planning**，而不是继续局部修补。

## 3. 功能需求

### R1. Review route matrix must be explicit

- 系统必须把 review 相关处理至少分成以下 4 类顶层 user-facing route：
  - `current_step_rework`
  - `same_boundary_follow_up`
  - `new_slice`
  - `pr_blocker`
- 对每类 top-level route 都必须明确：
  - 触发条件
  - 默认 continue entry
  - authority role
  - 不允许跨越的边界
- 若存在 planner / runtime 内部 disposition，也必须单独标明其层级，不得伪装成并列顶层 route。

### R2. Current-step QA loop stays separate

- `imm-qa` / `imm-review` 产出的 `rework` 只表示当前 active step 没闭合。
- `rework` 的默认继续入口应保持为 `imm-work`，再回到当前 step 的执行语义。
- `rework` 不得与 same-boundary review follow-up 或 PR blocker 混为同一类 repair。

### R3. Same-boundary review follow-up re-enters through `imm-work`

- 当 reviewer family 结论属于当前目标边界内的 bounded repair 时，默认 continue entry 应收口到 `imm-work`。
- `imm-work` 只负责吸收 follow-up 入口，并在内部决定：
  - 交给 `imm-planner` 收敛成最小 one-step plan；
  - 命中条件时走 `append_to_plan`；
  - 或转成 `new_slice`。
- `imm-work` 不得自己写 spec / plan，也不得绕过 validated plan gate 直接执行。
- `append_to_plan` 在这里表示 same-boundary follow-up 的内部 disposition，不是并列顶层 route。
- reviewer family 在这一层只负责证明 “same-boundary follow-up” 是否成立；
  `append_to_plan` 的 legality 仍需由 planner / planning validation 继续判断。

### R4. Completed-plan append stays narrow

- `append_to_plan` 只适用于 current runtime plan 仍有效、findings 仍属于同一目标边界、且只需追加 step 即可闭合的场景。
- `append_to_plan` 的 plan mutation authority 继续只属于 `imm-planner`。
- 如果 runtime plan 已切换、已 finish、或验证面改变，则不得继续声称可 append。
- 它应从 `same_boundary_follow_up` 内部命中，而不是作为另一条顶层用户路由与之并列。
- reviewer 不能因为发现 same-boundary repair 就直接替 planner 宣布可 append；
  append 不可证明时，默认仍应回到 `new_slice`。

### R5. PR blockers stay with `imm-pr-fix`

- PR review thread、remote CI failure、merge conflict 这类远端事实源阻塞必须继续由 `imm-pr-fix` 负责。
- 这类问题不能因为“也需要修复”就默认并入 same-boundary follow-up。
- 只有在需要额外本地技术分诊时，才允许 reviewer 先做只读分析；最终修复入口仍是 `imm-pr-fix`。

### R6. Planner authority and route wording must stay coherent

- `imm-planner` 必须继续作为 spec / plan / append plan 的唯一 authority role。
- reviewer family 的 `follow_up` wording、`imm-work` 的 continue-entry wording、`imm-planner` 的 consumption wording、README 的用户路由说明，必须表达同一套 truth。
- 本轮允许保留现有 `direct_fix` / `append_to_plan` / `new_slice` enum，但必须把它们映射到更易理解的 route matrix。
- 其中 `direct_fix` 只应表达 reviewer 视角的 same-boundary candidate，
  不应再次漂移成 reviewer-owned append decision。

### R7. Docs and regression truth must cover the matrix

- README 必须包含一张用户可见的 review handling route table。
- focused regression 至少要覆盖：
  - `rework` 只回当前 step
  - same-boundary follow-up 默认进 `imm-work`
  - `append_to_plan` 的窄边界
  - `new_slice` 的 planner fallback
  - `pr_blocker` 的 `imm-pr-fix` 独立路径

## 4. 验收标准

- [ ] review 相关处理被统一表达为明确的 route matrix，而不是 scattered wording。
- [ ] `rework`、same-boundary follow-up、`new_slice`、`pr_blocker` 这 4 条顶层 route 的 continue entry 与 authority role 都清晰可见。
- [ ] `append_to_plan` 作为 same-boundary follow-up 的内部 disposition，其命中条件与 authority role 也清晰可见。
- [ ] reviewer family、planner、README 对 “same-boundary follow-up vs planner-owned append disposition” 的层级表达一致。
- [ ] `imm-work`、`imm-planner`、`imm-qa`、`imm-pr-fix` 的职责边界在同一套 contract 中不冲突。
- [ ] README 和 focused tests 能直接证明完整 review handling workflow，而不只证明其中一条局部路径。
- [ ] 本轮不通过合并 authority role、自动建计划、或自动执行来换取更短路径。

## 5. 非目标

- 不在本轮统一重命名历史 route enum。
- 不设计新的 review queue、后台 dispatcher、或自动 repair scheduler。
- 不把 `imm-work`、`imm-planner`、`imm-pr-fix` 合并成单一角色。
- 不扩展到 repo 外 GitHub 流程、发布流程或 generic incident management。

## 6. 依赖项

- 依赖 [review-followup-handoff.spec.md](docs/specs/review-followup-handoff.spec.md)
  的 bounded `follow_up` packet contract。
- 依赖 [completed-plan-followup-append.spec.md](docs/specs/completed-plan-followup-append.spec.md)
  的 append 边界定义。
- 依赖 [review-followup-imm-work-entry.spec.md](docs/specs/review-followup-imm-work-entry.spec.md)
  对 same-boundary follow-up continue entry 的既有 narrowing。
- 依赖 [pr-fix-remote-context.spec.md](docs/specs/pr-fix-remote-context.spec.md)
  的 PR blocker remote-truth contract。
- 依赖 [role-entrypoint-contract-repair.spec.md](docs/specs/role-entrypoint-contract-repair.spec.md)
  的 default entry / authority 分离原则。
