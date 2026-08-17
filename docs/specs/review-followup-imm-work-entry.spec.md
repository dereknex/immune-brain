# Spec: review follow-up imm-work entry

**任务 ID**: IMM-REVIEW-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把“同一目标边界内的小修复”从当前的默认 follow-up 认知
`reviewer -> follow_up -> imm-planner`
收口成对外默认继续入口
`reviewer -> follow_up -> imm-work`，
同时保持 `imm-planner` 仍是唯一拥有 plan 写入/追加 authority 的角色。

本轮目标是入口收口，不是 authority merge：

1. reviewer 继续只负责判断和输出 bounded `follow_up` handoff；
2. 用户面对 same-boundary review fix 时，默认继续入口改为 `imm-work`；
3. `imm-work` 在内部判断该 follow-up 应走 one-step plan、`append_to_plan`，还是 `new_slice -> imm-planner`；
4. 不把 reviewer 或 `imm-work` 升级成自动修复器、自动建计划器或绕过验证的执行入口。

## 2. 问题背景

现有 contract 已经完成了 review follow-up handoff 的第一层收口：

- reviewer 可以输出 bounded `follow_up` packet；
- `imm-planner` 能消费 `origin_review`、route judgment、scope hint 和 verification hint；
- completed current plan 的 same-boundary follow-up 已经支持 `append_to_plan` 的 planner contract。

但对外继续入口仍有一个明显摩擦：

- 用户看到 reviewer 结论后，默认被引导到 `imm-planner`；
- 与此同时，系统别处又反复强调 validated plan 之后的稳定 continue entry 应尽量收口到 `imm-work`；
- 这让 same-boundary repair 同时表现出“planner 是 authority”与“planner 是用户默认入口”两种语义，增加了角色/入口混淆。

本轮要解决的不是“planner 是否还存在”，而是：
**planner 保持内部 authority，`imm-work` 成为外部默认继续入口。**

## 3. 功能需求

### R1. Same-boundary review follow-up defaults to `imm-work`

- 当 reviewer 结论属于当前目标边界内的 bounded repair 时，默认用户可见 next action 应收口到 `imm-work`。
- 该规则覆盖：
  - `direct_fix` follow-up
  - 命中条件时的 `append_to_plan` follow-up
- reviewer 仍必须保留 `origin_review`、`recommended_route`、`success_target`、`verification_hint` 等 handoff 信息；
  本轮只改变默认 continue entry，不删除 handoff packet。

### R2. `imm-work` must explicitly absorb review follow-up routing

- `imm-work` contract 必须明确：当输入来源是 review follow-up packet 时，它可以作为默认继续入口，
  再在内部决定：
  - 转成最小 validated one-step plan；
  - 命中 `append_to_plan` 条件并把追加 authority 交给 `imm-planner`；
  - 或因为超边界/条件不满足而转成 `new_slice -> imm-planner`。
- `imm-work` 不得自己写 spec/plan，也不得绕过 validated plan gate 直接进入 executor 语义。

### R3. Planner authority remains explicit

- `imm-planner` 必须继续作为唯一可写 spec / plan / append plan 的 authority role。
- 文档与 skill contract 必须明确：
  - `imm-work` 是 default continue entry；
  - `imm-planner` 是 internal planning authority；
  - same-boundary review fix 进入 `imm-work` 后，并不意味着跳过 planning。
- 如果当前 runtime plan 为空、不是 current runtime plan、或 findings 已超出原边界，
  `imm-work` 必须把请求交还给 `imm-planner`，而不是假装可以继续执行。

### R4. PR blocker path stays separate

- PR review thread、remote CI failure、merge conflict 这类远端事实源问题仍保持
  `imm-pr-fix` 为默认修复入口。
- 本轮不把 `imm-pr-fix` 吸收到 `imm-work`。
- README / skill contract 需要保留：
  - same-boundary review follow-up -> `imm-work`
  - PR blocker -> `imm-pr-fix`

### R5. Scope remains narrow

- 不在本轮重命名 `direct_fix` / `append_to_plan` / `new_slice` route enum。
- 不实现 reviewer 自动创建 plan 文件。
- 不实现 `imm-work` 自动执行代码修改或自动触发 `imm-autowork`。
- 不重写 `imm-review` / `imm-qa` 的 current-step `rework` 语义。

## 4. 验收标准

- [ ] same-boundary review fix 的默认用户可见 continue entry 收口到 `imm-work`。
- [ ] `imm-work` contract 明确承接 review follow-up packet，并把 plan authority 保留给 `imm-planner`。
- [ ] `imm-planner` contract 与 README 明确区分 “default continue entry” 和 “planning authority”。
- [ ] `append_to_plan` 与 `new_slice` 边界在新的 `imm-work` 入口叙述下仍保持清晰。
- [ ] PR blocker 仍由 `imm-pr-fix` 负责，不与 same-boundary review fix 混流。
- [ ] focused tests 覆盖新的 route wording / continue-entry truth；若涉及 runtime 状态输出，也要有定向回归验证。

## 5. 非目标

- 不在本轮统一重命名 reviewer route 术语。
- 不新增 review queue、background repair scheduler、或自动 follow-up dispatcher。
- 不把 `imm-work`、`imm-planner`、`imm-pr-fix` 合并成单一 authority role。
- 不扩展到完整 reviewer family packet redesign；只修本轮触达的 shared contract。

## 6. 依赖项

- 依赖 [review-followup-handoff.spec.md](docs/specs/review-followup-handoff.spec.md)
  的 bounded `follow_up` packet contract。
- 依赖 [completed-plan-followup-append.spec.md](docs/specs/completed-plan-followup-append.spec.md)
  对 `append_to_plan` 的现有边界定义。
- 依赖 [role-entrypoint-contract-repair.spec.md](docs/specs/role-entrypoint-contract-repair.spec.md)
  已建立的 “default continue entry vs authority role” 分离原则。
