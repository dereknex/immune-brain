---
title: refactor: Plan imm-brainstorm natural output
type: refactor
status: planned
date: 2026-05-08
origin: User said the current `imm-brainstorm` answer feels too rigid and overly formatted, and asked to simplify the output information
---

# Iteration Plan

## Task
- Summary: 收窄 `imm-brainstorm` 默认输出契约，让回复更自然、更短，并保留最少必要的 handoff 与 workflow guard。
- Origin: 本轮先经 `imm-brainstorm` 收敛出“只改默认输出表现，不改流程职责”的边界，随后用户显式切到 `imm-planner` 要求落计划。
- Research: Reviewed `IMMUNE.md`, `skills/imm-brainstorm/SKILL.md`, `docs/brainstorms/imm-brainstorm-template-short.md`, `tests/test_skill_contracts.py`, `.imm/specs/framing-stage-terse-output.spec.md`, and `docs/plans/2026-05-08-005-feat-framing-stage-terse-output-plan.md`; found an existing broader framing-stage terse plan, while the current ask is narrower and specifically about `imm-brainstorm` sounding rigid.
- Decisions: Apply `Scope Reduction`; keep this slice on `imm-brainstorm` only; treat “natural conclusion-first output” as the primary outcome and “contract drift guard” as the secondary outcome; do not reopen `imm-preplan-review` in the same plan.
- Assumptions: The current contract tests can be tightened without introducing a new workflow harness; `docs/brainstorms/imm-brainstorm-template-short.md` is the right template to reflect the softer default tone.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-brainstorm` 默认 handoff 改为自然结论优先而非 rigid template
- Verification: 手工检查 `skills/imm-brainstorm/SKILL.md` 与 `docs/brainstorms/imm-brainstorm-template-short.md`，确认默认输出强调“结论 / 范围 / 下一步”，且不再默认要求完整字段逐项外显。
- Test scenarios: Covers terse-default handoff wording; Covers optional-by-default boundary fields
- Depends on: none
- Scope: `skills/imm-brainstorm/SKILL.md`, `docs/brainstorms/imm-brainstorm-template-short.md`
- Replan_condition: 若仅靠 `imm-brainstorm` 单点文案无法消除僵硬感，而必须同步重写其他 framing roles，回到 planner 重新扩 scope。

### Step 2
- Step ID: U2
- Result: `imm-brainstorm` 自然输出 contract guard 可阻止文案回漂
- Verification: `python3 -m unittest tests.test_skill_contracts.py` 通过，且相关断言能表达“默认自然、按需展开”而不是只检查 terse 字段存在。
- Test scenarios: Covers natural-output contract guard
- Depends on: 1
- Scope: `tests/test_skill_contracts.py`
- Replan_condition: 若现有测试无法表达“去模板化”要求且需要更大规模测试框架调整，回到 planner 改为文档守卫优先的小切片。

## Notes
- 本轮不把 `imm-preplan-review`、`README.md` 或更广的 session output 一起打包。
- Step 1 先锁 contract 与模板语气，Step 2 再补守卫，避免把“写文案”和“建框架”混成同一步结果。
