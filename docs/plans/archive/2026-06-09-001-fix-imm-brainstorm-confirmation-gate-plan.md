---
title: "fix(brainstorm): require confirmation before planner handoff"
type: fix
status: proposed
date: 2026-06-09
origin: imm-brainstorm framing - user confirmed explicit approval must precede planner handoff
---

# Iteration Plan

## Task

- Summary: 让 `imm-brainstorm` 只有在用户显式确认推荐方案后才建议进入 `imm-planner`。
- Spec: docs/specs/imm-brainstorm-confirmation-gate.spec.md
- Origin: 用户指出 brainstorm 当前无论进展如何都推荐进入 planner。brainstorm 已确认新规则：必须等用户说“确认 / 可以 / 按这个来”，但允许先输出“我建议这样做，确认后进入 planner”。
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-DEC-1; BR-OUT-1
- Research: `CONTEXT.md` 定义 Brainstorm 是只读问题 framing 阶段，Plan 和 Spec 由 `imm-planner` 负责。`plugins/immune-brain/dist/imm-brainstorm.md` 当前 `Default Next Route` 强化默认 handoff 到 `imm-planner`，`Next Action` gate 只要求 framing stable 和 narrowing questions 已回复，缺少用户显式确认 proposed direction / scope 的硬门槛。`docs/specs/imm-brainstorm-natural-output.spec.md` 已允许默认输出保留最少必要的下一步和确认需求。`tests/test_skill_contracts.py` 已有 brainstorm terse handoff、inline clarification 和 gated Next Action contract，可补 focused assertion 防止回漂。
- Decisions: D1 把“用户显式确认推荐方案”作为 planner handoff 的必备 gate。D2 保留 brainstorm 给推荐方案的能力，但未确认时 Next Action 只能请求确认。D3 不恢复 `imm-preplan-review` 默认阶段，也不让 brainstorm 写 Plan。D4 本切片只改 skill contract 和 focused contract test，不新增 runtime 状态。
- Assumptions: 当前确认门槛可由 skill 文案和 contract test 约束，暂不需要机器可解析的 confirmation flag。`imm-planner` 仍可在用户直接点名 planner 且 scope 已确认时正常工作。
- Scope Mode: Hold Scope
- Planner research dispatch: solo；这是单域小范围 skill contract 切片，本地证据足够拆步。

## Output Language

- Human-readable prose: Chinese
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-1 | covered_by_step | U1 | Step U1 为 planner handoff 增加用户显式确认 gate。 |
| BR-REQ-2 | covered_by_step | U1 | Step U1 保留 brainstorm 提出推荐方案的能力。 |
| BR-DEC-1 | covered_by_step | U1 | Step U1 要求未确认时 Next Action 请求确认且不命名下一 skill。 |
| BR-OUT-1 | captured_as_decision | D3 | 本 Plan 明确不改变 brainstorm 只读边界，不让它写 Plan 或实现。 |

## Devil's Advocate Audit

1. **Rollback Resilience**: 本切片应只触碰 `imm-brainstorm` contract、focused contract test、Spec 和 Plan。若新门槛造成过度阻塞，回退这些文件即可恢复旧路由文案，不需要修复 State Ledger。
2. **Verification Vanity**: 只检查出现 “confirmation” 会太弱。验证必须锁住两个行为：未确认时不建议 `imm-planner`，已确认后才允许 planner handoff。
3. **Spec Dilution Detection**: 用户要求的是“先讨论明确待方案确认后再建议进入 planner”，不是单纯改一句 softer wording。Plan 明确要求显式确认 gate，并保留“推荐方案，确认后进入 planner”的可用表达。

## Planning Quality Gate

- contract surface: `plugins/immune-brain/dist/imm-brainstorm.md`、`tests/test_skill_contracts.py`、`docs/specs/imm-brainstorm-confirmation-gate.spec.md`、本 Plan。
- compatibility: additive contract tightening；既有用户直接显式确认后仍可进入 planner，不引入文件格式或 runtime schema 迁移。
- interruption recovery: 若执行中断，rerun focused unittest 能暴露文案和测试是否未对齐。
- rollback path: 回退 skill contract、测试、Spec 和 Plan。无需修改 `.imm/memory/current_iteration.json` 之外的正常 Plan sync 状态。
- verification strength: 使用 focused unittest assertion 加 `imm-plan --json`。避免只靠人工阅读。
- Brainstorm traceability: 上游 `BR-*` 均在 `Brainstorm Trace` 中映射。

## Steps

### Step 1

- Step ID: U1
- Result: Brainstorm confirmation gate contract
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_brainstorm_requires_explicit_confirmation_before_planner_handoff tests.test_skill_contracts.SkillContractTests.test_brainstorm_defines_terse_default_handoff tests.test_skill_contracts.ReviewFollowUpAppendContractTests.test_inline_clarification_and_preplan_demotion tests.test_skill_contracts.SkillContractTests.test_gated_handoff_discipline_in_workflow_skills && python3 .imm/imm-plan.py docs/plans/2026-06-09-001-fix-imm-brainstorm-confirmation-gate-plan.md --json`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers BR-REQ-1 by asserting planner handoff requires explicit user confirmation of proposed direction or scope; Covers BR-REQ-2 by asserting brainstorm may recommend a direction before confirmation; Covers BR-DEC-1 by asserting unconfirmed output must request confirmation and must not name a next skill; Covers BR-OUT-1 by preserving read-only implementation boundary assertions.
- Discovery cache: plugins/immune-brain/dist/imm-brainstorm.md (skill contract to tighten); tests/test_skill_contracts.py (focused contract assertions); docs/specs/imm-brainstorm-confirmation-gate.spec.md (accepted behavior); docs/specs/imm-brainstorm-natural-output.spec.md (natural output confirmation need); docs/specs/inline-clarification-preplan-demotion.spec.md (existing brainstorm to planner route model); CONTEXT.md (Brainstorm and Plan vocabulary)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: 如果 focused assertion 与既有 inline clarification contract 冲突，优先保持“确认后进入 planner”的新 gate，并在同一 Step 内更新旧 wording，不能退回无条件 default route。
- security_considerations: 本切片不处理安全敏感数据；主要风险是 workflow routing 误导，测试应防止未确认方案被静默升级为 planner 输入。

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-09-001-fix-imm-brainstorm-confirmation-gate-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-09-001-fix-imm-brainstorm-confirmation-gate-plan.md --sync`

## Notes

- 这是一个 one-step Plan，因为可闭合结果是单一 contract 行为。
- Step U1 后续可以同时更新文案和测试，但验收只围绕 confirmation gate 是否成立。
- 验证通过并完成 runtime sync 后，继续通过 `imm-work` 激活 Step 1。
