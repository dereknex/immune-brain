---
title: feat: Plan all-skills natural output
type: feat
status: planned
date: 2026-05-08
origin: User clarified that the output simplification should apply to all local `imm-*` skills instead of only `imm-brainstorm`
---

# Iteration Plan

## Task
- Summary: 把本仓库全部本地 `imm-*` skills 的默认用户输出收敛成更自然的 repo-wide contract，同时保留各角色的必要差异与 workflow guard。
- Origin: 先前已完成 `imm-brainstorm` 单点自然输出切片，但用户明确要求把范围提升到所有 local skills，而不是停在 framing 单点优化。
- Research: Reviewed `IMMUNE.md`, the local skill inventory under `skills/`, existing output-related specs/plans, `docs/solutions/default-debug-workflow-output-split.md`, `docs/solutions/framing-stage-terse-handoff.md`, and representative skill contracts including `imm-work`, `imm-qa`, `imm-code-review`, `imm-ui-review`, `imm-planner`, and `imm-brainstorm`; found that only part of the roster defines terse default output explicitly, while several skills still emphasize artifact schema more than user-facing default shape.
- Decisions: Apply `Selective Expansion`; expand from the completed narrow `imm-brainstorm` slice to all local `imm-*` skills, but keep the work on contract wording, focused docs, and regression guardrails only; do not force a single reply template across roles.
- Assumptions: “all skills” means the 13 local `skills/imm-*/SKILL.md` files in this repo; repo-facing alignment may require a shared pattern doc or README touch, but not runtime behavior changes.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-*` 共享 natural-output contract 基线
- Verification: 手工检查共享 spec / pattern / execution notes，确认 repo-wide 规则明确区分默认用户输出、按需展开字段、以及 role-specific 例外，而不是把所有 skill 压成同一模板。
- Test scenarios: Covers repo-wide density rule; Covers optional-by-default contract fields
- Depends on: none
- Scope: `.imm/specs/all-skills-natural-output.spec.md`，必要时 `docs/solutions/` 或 `README.md` 中与全局输出契约直接相关的文档
- Replan_condition: 若必须同步改 runtime state 或 CLI machine output 才能建立共享规则，说明范围混入实现层，应回到 planner 重新切分。

### Step 2
- Step ID: U2
- Result: Framing/planning skills 统一默认输出契约
- Verification: 手工检查 `imm-brainstorm`、`imm-preplan-review`、`imm-planner`、`imm-party` 的 skill contract，确认默认输出优先给结论与边界，不再默认逐项外显 artifact schema。
- Test scenarios: Covers conclusion-first framing output; Covers planner terse handoff; Covers advisory read-only output
- Depends on: 1
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-party/SKILL.md`
- Replan_condition: 若其中某个 role 需要默认输出大量过程说明才能稳定路由，说明该 skill 责任边界还没收敛，应先回 planner 审查该 role。

### Step 3
- Step ID: U3
- Result: Workflow/execution skills 统一默认输出契约
- Verification: 手工检查 `imm-work`、`imm-executor`、`imm-qa`、`imm-autowork`、`imm-compounder` 的 skill contract，确认默认成功路径以结果和最小证据为主，debug/state 字段只在需要时展开。
- Test scenarios: Covers continue-path brevity; Covers QA decision brevity; Covers autowork stop summary; Covers compound handoff brevity
- Depends on: 1
- Scope: `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-autowork/SKILL.md`, `skills/imm-compounder/SKILL.md`
- Replan_condition: 若 workflow roles 的默认简短输出会削弱 step tracing 或 QA closure 证据，应回 planner 重新定义 default/debug 边界。

### Step 4
- Step ID: U4
- Result: Support-skill 默认输出统一契约
- Verification: 手工检查 `imm-code-review`、`imm-ui-review`、`imm-pr-fix`、`imm-init` 的 skill contract，确认它们保留 findings-first 或 setup-first 的角色特性，但不再默认输出整段 schema 教程式文案。
- Test scenarios: Covers findings-first concise review; Covers repair stop summary; Covers bootstrap concise guidance
- Depends on: 1
- Scope: `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-pr-fix/SKILL.md`, `skills/imm-init/SKILL.md`
- Replan_condition: 若某个 skill 的默认输出无法在简短模式下传达必要风险优先级，说明该分组过粗，应拆成更细的 role slice。

### Step 5
- Step ID: U5
- Result: All-skills natural-output guardrail
- Verification: `python3 -m unittest tests/test_skill_contracts.py` 通过，且相关守卫能覆盖 repo-wide 自然输出 contract，而不是只检查个别 skill 的字段存在。
- Test scenarios: Covers repo-wide output-style coverage; Covers role-specific terse exceptions; Covers optional expansion rules
- Depends on: 2, 3, 4
- Scope: `tests/test_skill_contracts.py`，必要时与自然输出 contract 直接相关的 docs guard
- Replan_condition: 若现有测试框架无法表达 repo-wide 输出密度规则且需要大规模 harness 重写，回到 planner 重新决定 guard 放在测试还是文档。

## Notes
- 这份计划替代“只改 `imm-brainstorm`”作为输出风格主线；单点 brainstorm 切片可作为输入证据，但不再是最终边界。
- 统一的是默认密度和展开条件，不是要求 `review`、`qa`、`planner`、`work` 使用相同句式。
- 本轮仍不扩展到外部 skill、系统提示或 runtime JSON 结构。
