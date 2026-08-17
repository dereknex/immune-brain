---
title: feat: add current step driver
type: feat
status: planned
date: 2026-05-07
origin: user correction during imm-planner continuation on 2026-05-07
---

# Iteration Plan

## Task
- Summary: Add a single-call current-step driver for Immune-Brain
- Origin: User clarified that the prior single-step orchestration adjustment was meant to let one `continue` or one `imm-work` call automatically decide whether to activate, execute, review, rework, or replan the current step.
- Research: Checked `IMMUNE.md`, `.imm/specs/single-step-orchestration.spec.md`, `.imm/specs/codex-native-interaction.spec.md`, `docs/solutions/single-step-orchestration-entry.md`, `skills/imm-work/SKILL.md`, `.imm/imm-work.py`, and `.imm/imm-review.py`. Conclusion: current implementation exposes `next_action` as a route hint, but it does not run a current-step driver and does not make executor evidence naturally reachable by QA.
- Decisions: D1 add a current-step driver slice instead of changing the existing routing contract; D2 keep full-plan autowork out of scope; D3 preserve executor authority for implementation and QA authority for closure; D4 make evidence handoff explicit so QA can decide without optimistic state changes.
- Assumptions: A single-call driver can be represented through `.imm/imm-work.py` state and skill text without introducing a new global router; executor evidence can be stored or surfaced in a minimal current-step field; existing plan validation remains sufficient.

## Steps

### Step 1
- Step ID: U1
- Result: 当前 step driver 契约明确
- Verification: `.imm/specs/current-step-driver.spec.md`, `skills/imm-work/SKILL.md`, and README describe the single-call current-step driver boundary with full-plan autowork excluded.
- Test scenarios: Covers IMM-WORKFLOW-003 AC1; Covers IMM-WORKFLOW-003 AC7
- Depends on: none

### Step 2
- Step ID: U2
- Result: continue 状态机可推进
- Verification: `.imm/imm-work.py` exposes a continue path that can activate the next executable step, identify execution work, route evidence-ready steps to QA, stop for replan, and stop after pass without starting the next step.
- Test scenarios: Covers IMM-WORKFLOW-003 AC2; Covers IMM-WORKFLOW-003 AC4; Covers IMM-WORKFLOW-003 AC5; Covers IMM-WORKFLOW-003 AC6
- Depends on: 1

### Step 3
- Step ID: U3
- Result: 执行证据交接可追踪
- Verification: executor output or current-step state records evidence in a form that `imm-qa` can consume, and missing evidence prevents an optimistic pass path.
- Test scenarios: Covers IMM-WORKFLOW-003 AC3
- Depends on: 2

### Step 4
- Step ID: U4
- Result: 单次继续体验可验证
- Verification: README or a documented smoke path shows one user continuation advancing the current step through the correct driver path while stopping before the next plan step.
- Test scenarios: Covers IMM-WORKFLOW-003 AC1; Covers IMM-WORKFLOW-003 AC4; Covers IMM-WORKFLOW-003 AC7
- Depends on: 3

## Notes
- Do not merge executor and QA authority into `imm-work`.
- Do not default to running every remaining plan step.
- If evidence storage becomes broader than one active step, return to replanning before implementation.
