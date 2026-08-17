---
title: feat: Add advisory party mode to Immune-Brain
type: feat
status: planned
date: 2026-05-07
origin: user request and .imm/specs/party-mode-advisory.spec.md
---

# Iteration Plan

## Task
- Summary: Add read-only advisory party mode for Immune-Brain planning decisions
- Origin: User asked how to fuse BMAD multi-role party discussions into this system; `.imm/specs/party-mode-advisory.spec.md`
- Research: Checked `IMMUNE.md`, `README.md`, existing `imm-*` role skills, `docs/brainstorms/immune-brain-requirements.md`, and BMAD Party Mode upstream docs. Conclusion: party mode should become an advisory decision layer, not an execution layer.
- Decisions: D1 use a new `imm-party` skill so the boundary is visible; D2 keep party read-only by default; D3 route party output into `imm-preplan-review` instead of directly into `imm-planner`; D4 keep solo fallback when independent sub-agents are unavailable.
- Assumptions: The first version only needs local skill and documentation integration; no runtime orchestrator or new Python state machine is required.

## Steps

### Step 1
- Step ID: U1
- Result: 治理文档说明会诊边界
- Verification: `README.md` and `IMMUNE.md` both describe party mode as a read-only advisory layer, and neither document grants it planner, executor, or QA authority.
- Test scenarios: Covers R1; Covers R5
- Depends on: none

### Step 2
- Step ID: U2
- Result: 新增 imm-party 角色契约
- Verification: `skills/imm-party/SKILL.md` exists and defines trigger rules, role selection, solo fallback, sub-agent usage conditions, output handoff, and write boundaries.
- Test scenarios: Covers R2; Covers R3
- Depends on: 1

### Step 3
- Step ID: U3
- Result: 会诊 handoff 进入 preplan
- Verification: `skills/imm-preplan-review/SKILL.md` documents how to consume an `imm-party` handoff while preserving final scope posture authority.
- Test scenarios: Covers R3; Covers R4
- Depends on: 2

### Step 4
- Step ID: U4
- Result: 安装入口包含 imm-party
- Verification: `mise run list-skills` or `mise run check-install` can discover `imm-party` after the install metadata is updated.
- Test scenarios: Covers R4
- Depends on: 2

### Step 5
- Step ID: U5
- Result: 示例会诊完成验收
- Verification: A documented sample under `docs/brainstorms/` or README shows a party handoff for a planning dispute and the handoff can be mapped into `imm-preplan-review` fields.
- Test scenarios: Covers R3; Covers R5
- Depends on: 3, 4

## Notes
- Keep this feature narrow: advisory discussion only.
- Do not add runtime state until repeated usage proves that durable party state is needed.
- If a party round produces implementation details, treat them as research notes for preplan review, not as executable scope.

