---
title: feat: activate data-integrity reviewer runtime slice
type: feat
status: planned
date: 2026-05-09
origin: user继续 subagents 里程碑收口后，沿着 `imm-preplan-review` 的单slice策略推进下一条 conditional-risk runtime 目标，优先补齐 `data-integrity-reviewer`
---

# Iteration Plan

## Task
- Summary: 在不引入 shared runtime 平台的前提下，为 `data-integrity-reviewer` 补齐 conditional-risk runtime activation-path 的最小闭环（docs-first contract + activation host + fallback/verification）
- Origin: `imm-preplan-review` 已指出首批 4 条运行态闭环完成后，下一步应缩小为单条 reviewer 切片；默认优先 `data-integrity-reviewer` 作为下一条。
- Research: 已复核 `IMMUNE.md`、相关 subagent 治理方案与已收口的 runtime 实践（`docs/solutions/conditional-risk-reviewer-activation-hosts.md`、`docs/solutions/dedicated-reviewer-activation-hosts.md`）、`docs/plans/2026-05-09-023-feat-activate-remaining-first-batch-runtime-slices-plan.md`、`remaining-first-batch-runtime-activation.spec`、现有 `security`/`api-contract` runtime/skill 落地模式。
- Decisions: D1 使用 Scope Reduction：本轮只处理 `data-integrity-reviewer` 单 slice，不扩展到更多 conditional-risk reviewer；D2 先补最小 activation host 与触发边界，再补本地 contract 与 manual validation path；D3 延续已有规则不引入 registry、共享调度或 multi-reviewer composition；D4 将可验证性第一目标定为 `advisory`、trigger-only、non-default 的可复用说明。
- Assumptions: `data-integrity-reviewer` 尚未有独立 runtime host；现有 reviewer 路线可复用（`security`/`api-contract`）的 host 验收模板；`tests/test_skill_contracts.py` 可继续扩展以覆盖此 slice。
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/data-integrity-reviewer-runtime.spec.md`, `skills/data-integrity-reviewer/SKILL.md`, `README.md`, `tests/test_skill_contracts.py`, `.imm/specs/system-subagents-design.spec.md`
  - dependencies_known: true
  - verification_path:
      - target: `data-integrity-reviewer` 可在 repo 层面以可触发、非默认、advisory 方式说明并落地；不存在误报激活路径
      - method: focused text contract + manual runtime validation scenario（后续若可行补 local regression）
  - blockers: 当前尚无既有 `data-integrity-reviewer` runtime 文档；若边界展开到 `reliability`/`release` 类范围需重回 preplan
  - replan_condition: 若执行中出现平台化调度、跨 reviewer 编排或必须加入 `data-integrity` 之外 roster 的需求，立即返回 `imm-preplan-review`

## Steps

### Step 1
- Step: 1
- Result: `data-integrity-reviewer` 的 runtime 目标与边界定义成独立可引用的基础 contract（新增 `.imm/specs/data-integrity-reviewer-runtime.spec.md`）
- Verification: Spec 明确触发面、输出范围、advisory-only、non-default、fallback 与 unavailable 场景；无平台化要求进入 spec。
- depends_on: none
- scope: `.imm/specs/data-integrity-reviewer-runtime.spec.md`
- replan_condition: 如果该 spec 需默认化成安全/接口平台规则，暂停并回到 `imm-preplan-review`

### Step 2
- Step: 2
- Result: `skills/data-integrity-reviewer/SKILL.md` 存在且以 dedicated activation host 实现边界化。
- Verification: skill 文本包含 trigger surface、`No tools...` 限制、`result` 字段、可复用的 findings 结构、fallback 到 `imm-code-review` + 当前 step notes。
- depends_on: 1
- scope: `skills/data-integrity-reviewer/SKILL.md`
- replan_condition: 如果无法在当前架构下声明独立 dedicated host 而不引入 shared dispatch，停止切片并返回 `imm-preplan-review`

### Step 3
- Step: 3
- Result: repo-level 路由与 fallback truth 与手动验证路径收口（`README.md` + `tests/test_skill_contracts.py` 关注点）
- Verification: README 仅对 `data-integrity-reviewer` 做 trigger-only、non-default 与 unavailable fallback 的精确定义；tests 增量检查看见性与边界声明；Codex manual validation 场景覆盖 available/unavailable。
- depends_on: 1,2
- scope: `README.md`, `tests/test_skill_contracts.py`
- replan_condition: 若验证路径要求同时新增 `reliability-reviewer`/`api-contract-reviewer` 的 runtime 路由，停止扩展并回到 `imm-preplan-review`

## Notes
- 本计划保持单条 slice，严格不扩成 conditional-risk reviewer runtime registry。
- 若验证路径受限，U3 明确保留 manual Codex runtime validation 作为 fallback。
