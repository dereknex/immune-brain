# Spec: review follow-up handoff

**任务 ID**: IMM-REVIEW-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把 review 阶段产出的 `needs_fix` / `block` 结论收敛成可直接进入后续实现闭环的
follow-up handoff，减少用户手动把 findings 再翻译成 plan 的成本，同时保持
`review -> planner/work -> qa` 的 authority boundary 不变。

首轮只做 review contract 和 plan handoff 收口：

1. review 结果能明确区分“当前边界内的 same-boundary follow-up candidate”与“需要新的 follow-up plan”；
2. `imm-planner` 能直接消费 review handoff，快速产出 one-step 或 multi-step plan；
3. README 与 focused contract tests 对齐这条新路由；
4. 不把 review 升级成自动建计划器或自动修复器。

## 2. 问题背景

当前仓库已经通过 `imm-code-review` 明确要求区分 repair boundary 与 replan boundary，
也已有 “requires a new follow-up plan” 的 wording 与 focused tests。但现状仍有两个摩擦：

- review finding 虽然能判断该走 same-boundary repair 还是 `replan`，却没有稳定的 plan-ready handoff，
  用户仍需手动把 finding 整理成 planner 可消费的任务 framing；
- 小型 `need fix` 虽然理论上应走 one-step plan fast path，但 review 结果没有直接提供
  最小 scope、成功目标和验证提示，导致 follow-up 进入 `imm-planner` 时仍要重做一次转换。

因此，本轮不是扩大 review 权限，而是把 review 输出补成更强的 handoff：
既能保留 “当前边界内可继续 follow-up” 与 “需要新切片” 的区分，也能让 `imm-planner`
更快生成最小实现计划。

## 3. 功能需求

### R1. Review findings must carry follow-up routing metadata

- `imm-code-review` 在 `result = needs_fix | block` 且存在需处理 finding 时，必须提供
  plan-ready `follow_up` 信息，而不只给 `fix` / `replan` 标签。
- 每条进入 follow-up 的 finding 至少要能表达：
  - `route`: `direct_fix` | `new_slice` | `defer`
  - `scope`: 最小改动面（文件/模块/边界）
  - `change_goal`: 要修成什么状态
  - `verification_hint`: 最小验证路径
  - `open_risk`: 仍待确认的不确定项（无则可省略）
- 默认 user-facing 输出必须直接讲清是：
  - 当前边界内的 same-boundary follow-up candidate；
  - 还是需要新的 follow-up 计划。
- `direct_fix` 在这里表示 reviewer 认为问题仍留在当前 repair boundary，允许 planner 继续收敛；
  它本身不是 `append_to_plan` 判决，也不直接授予执行权。

### R2. Review must emit a concise follow-up packet

- `imm-code-review` 至少要支持一个聚合级 handoff，供 `imm-planner` 直接消费：
  - `origin_review`
  - `recommended_route`
  - `scope_mode_hint`
  - `items`
  - `success_target`
  - `verification_hint`
- 这个 packet 的目标是减少 planner 重述，不是替代 planner 写 spec/plan。
- 如果所有问题都属于单一、无歧义、单边界修复，packet 仍然应进入
  validated one-step plan，而不是绕过 `imm-planner` 直接执行。
- 若 handoff 属于 same-boundary follow-up candidate，是否进一步命中 `append_to_plan`
  必须由 planner / planning validation 根据 current runtime plan、verification surface 与
  completion history 统一判断。

### R3. Planner and adjacent reviewer docs must consume the same handoff

- `imm-planner` 必须明确说明：当来源是 review follow-up 时，应把 handoff 里的
  `origin_review`、routing judgment、scope hints 和 verification hints
  映射进 `Origin` / `Research` / `Decisions` / `Assumptions`。
- `imm-planner` 还必须明确：review handoff 若只证明 same-boundary repair，不等于已经证明
  `append_to_plan` 合法；append eligibility 仍属于 planner-owned gate。
- `imm-ui-review` 应至少在 `needs_fix` / `replan` 路由上与同一套 follow-up handoff
  对齐，避免 reviewer family 内再次出现不同说法。
- README 需要把这条路径讲清楚：
  review 负责找问题和补 handoff，planner 负责把 handoff 落成 plan，
  `imm-work` / `imm-executor` 才负责真正改代码。

### R4. Scope stays bounded

- 不新增 review 阶段的自动计划文件写入。
- 不新增 workflow state、memory store、background queue 或自动执行入口。
- 不把 `imm-code-review`、`imm-ui-review` 变成 `imm-pr-fix` / `imm-executor` 的替代物。
- 不扩展到 repo-wide shared reviewer runtime framework；首轮仅覆盖已存在的
  `imm-code-review` 和 `imm-ui-review`。

## 4. 验收标准

- [ ] `imm-code-review` 的 contract 能表达 `direct_fix` 作为 same-boundary follow-up candidate 与 `new_slice` 的差异。
- [ ] review 输出含有 planner 可直接消费的 `follow_up` handoff，而不是只剩抽象 finding。
- [ ] `imm-planner` 明确写出如何消费 review follow-up handoff，并保留 one-step plan fast path 与 planner-owned append gate。
- [ ] `imm-ui-review` 的 `needs_fix` / `replan` 路由与同一 follow-up handoff 语义对齐。
- [ ] README 与 focused contract tests 覆盖新的 review-to-follow-up contract。
- [ ] 本轮不新增自动计划生成、自动修复或新的 workflow state 仓库。

## 5. 非目标

- 不实现 review 结束后自动创建 `docs/plans/*.md`。
- 不实现 review 结果自动触发 `imm-work` 或 `imm-autowork`。
- 不设计通用 findings registry、review queue 或跨 reviewer 编排平台。
- 不修改实现代码、测试运行器或 `.imm/memory/current_iteration.json` 的 runtime 语义。

## 6. 依赖项

- 依赖 `.imm/specs/workflow-friction-retrospective-followup.spec.md` 中
  “R1. Code review 必须明确 repairability 路由” 的既有目标。
- 依赖 `skills/imm-code-review/SKILL.md`、`skills/imm-ui-review/SKILL.md`、
  `skills/imm-planner/SKILL.md` 与 `README.md` 的当前边界定义。
- 依赖 `tests/test_skill_contracts.py` 作为 focused contract regression 入口。
