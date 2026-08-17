# Pattern: Reviewer Follow-up Closure Contract

**领域**: Agent workflow / review-to-work routing / QA closure contracts
**描述**: 当 reviewer `follow_up` 从 planner-ready handoff 升级为可由 `imm-work` 直接消费的 execution artifact 时，不能只更新入口路由。闭环必须同时覆盖 reviewer handoff、work routing gate、executor evidence handoff、QA evidence check 和 stale route cleanup，否则小修复会进入执行态但卡在 closure 阶段。

**reusability**: high
**next_reuse_scenarios**: [`reviewer` 输出可执行 follow-up artifact, 新增非 Plan execution target, 把 advisory handoff 接入 work/QA loop, 清理旧 planner-owned route wording, code review 发现入口已改但闭合契约未贯通]

## 场景

- review 发现的问题仍在当前 repair boundary 内，重新走 planner 会制造摩擦。
- 系统想让 reviewer 产出轻量 `follow_up`，由 `imm-work` 直接消费并进入 executor/QA loop。
- 原有 QA contract 只认识 active Plan step，导致 follow-up evidence 没有明确 pass gate。
- 旧 reviewer 文案还残留 planner-only disposition，例如把 direct same-boundary repair 引回 `append_to_plan`。

## 方案模板

1. **把 follow-up 当成 execution target，而不是 Plan mutation**: reviewer 的 `follow_up` 至少保留 `scope`、`change_goal`、`verification_hint` 和 `origin_review`，并把 Next Action 指向 `imm-work`。
2. **让 `imm-work` gate 同时接受 Plan step 和 follow-up**: Decision Tree、Boundary、Next Action gate 都要明确 pending `follow_up` 可以进入 executor 或 QA 语义。
3. **让 QA 读取同一条 evidence-first 标准**: `imm-qa` 不应只检查 active step；它要检查 active Plan step 或 `follow_up` target 是否已由 `imm-work record-execution` 标为 `ready_for_review`，并用 step verification text 或 follow-up verification hint 复核证据。
4. **清理旧 route wording**: 一旦 direct same-boundary follow-up 不再需要 planner append，就从 reviewer skill 中删除 `append_to_plan` 等旧口径，避免 reviewer 再把用户送回 planner-owned path。
5. **用正反两条 grep 守住 contract**: 正向检查 `follow_up` 是否覆盖 reviewer/work/QA，反向检查 stale route token 是否从 reviewer skill 消失。

## 可复用前提

- `follow_up` 是轻量会话态 artifact，不需要持久化到 `.imm/specs/`。
- 系统仍保留 `imm-work -> imm-executor -> imm-qa` 的权限分离。
- `imm-work record-execution` 是 follow-up 和 Plan step 共享的 evidence handoff。
- 当前变化是 skill/documentation contract，不涉及 runtime Python 状态机改造。

## 验证依据

- [.imm/specs/review-followup-dual-track-closure-contracts.spec.md](docs/specs/review-followup-dual-track-closure-contracts.spec.md) 定义了 QA、work routing 和 code review handoff 的 closure-contract 修复范围。
- [docs/plans/2026-05-14-083-fix-review-followup-dual-track-closure-contracts-plan.md](docs/plans/2026-05-14-083-fix-review-followup-dual-track-closure-contracts-plan.md) 将三个 review findings 收敛为一个 outcome step，避免拆成读/改/验动作清单。
- [skills/imm-qa/SKILL.md](skills/imm-qa/SKILL.md) 现在明确支持 active Plan step 或 reviewer `follow_up` target 的 evidence verification。
- [skills/imm-work/SKILL.md](skills/imm-work/SKILL.md) 现在把 Next Action gate 改为接受 validated Plan active step 或 pending `follow_up` execution target。
- [skills/imm-code-review/SKILL.md](skills/imm-code-review/SKILL.md) 已去除 `append_to_plan`，并把 same-boundary finding 交给 `imm-work` 作为 execution artifact。
- `rg -n "follow_up" skills/imm-qa/SKILL.md skills/imm-work/SKILL.md skills/imm-code-review/SKILL.md` 返回三份 skill 的匹配。
- `rg -n "append_to_plan" skills/imm-code-review/SKILL.md` 无匹配。
- `imm-work status` 显示 `2026-05-14-083-fix-review-followup-dual-track-closure-contracts-plan.md` 的 U1 已 `pass`，计划完成。

## 约束与建议

- 不要把 follow-up execution target 扩大成默认跳过 plan 的 bugfix 通道；它只适用于 reviewer 已经给出同边界、可验证的 follow-up artifact。
- 不要只更新 `imm-work`。凡是新增 execution target，都要同步检查 reviewer 输出、work gate、QA closure 和过期 route token。
- 不要把 stale token 检查只留给人工 review；负向 grep 很适合守住“旧路由不再出现”的 contract。
- 如果后续要让 `follow_up` 持久化或进入 runtime Python 状态机，应单独规划；不要把持久化和 skill contract 修补混在同一切片。

---
*沉淀日期: 2026-05-14 | 来源: 2026-05-14-083-fix-review-followup-dual-track-closure-contracts-plan*
