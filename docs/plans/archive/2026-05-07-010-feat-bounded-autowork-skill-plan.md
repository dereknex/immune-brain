---
title: feat: add bounded autowork skill design
type: feat
status: planned
date: 2026-05-07
origin: user request to create a standalone skill that auto-advances implementation from a plan
---

# Iteration Plan

## Task
- Summary: Define a standalone bounded autowork skill for plan-driven implementation
- Origin: User asked to create a separate skill that can automatically push implementation forward from a plan. `imm-brainstorm` and `imm-preplan-review` narrowed this to a standalone bounded autowork skill rather than expanding `imm-work` into default full-plan autowork.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/immune-brain-requirements.md`, `docs/brainstorms/imm-brainstorm-output-2026-05-07.md`, `docs/solutions/skill-local-workflow-guards.md`, `docs/solutions/single-step-orchestration-entry.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `.imm/imm-work.py`, `.imm/specs/current-step-driver.spec.md`, and prior plans for single-step orchestration and Codex plan sync. Conclusion: current contracts already allow same-turn current-step driving, but they explicitly reject default full-plan autowork, so the safe first slice is a separate bounded autowork entry with clear stop conditions.
- Decisions: D1 create a standalone autowork skill instead of changing `imm-work` default semantics; D2 first version targets `run until blocked` with optional small step-budget support; D3 preserve `imm-planner`, `imm-executor`, and `imm-qa` authority boundaries; D4 require explicit stop conditions for no plan, no executable step, missing evidence, rework, replan, blocker, and budget reached; D5 keep this slice contract-first and avoid background runners or speculative orchestration features.
- Assumptions: Existing `.imm` state and current-step driver logic are sufficient to support a bounded autowork contract; users value lower coordination friction more than full unattended execution; execution can stop safely at the same workflow boundaries already enforced by executor and QA roles.

## Steps

### Step 1
- Step ID: U1
- Result: bounded autowork skill scope is specified
- Verification: `.imm/specs/bounded-autowork-skill.spec.md` defines a standalone bounded autowork skill, states it is not default full-plan autowork, and records stop conditions plus authority boundaries.
- Test scenarios: Covers IMM-WORKFLOW-004 R1; Covers IMM-WORKFLOW-004 R4; Covers IMM-WORKFLOW-004 R6
- Depends on: none

### Step 2
- Step ID: U2
- Result: autowork workflow contract is decomposed into closable outcomes
- Verification: This plan defines separate outcomes for entry contract, bounded advance behavior, stop-condition handling, and validation expectations without collapsing them into execution-action micro steps.
- Test scenarios: Covers IMM-WORKFLOW-004 R2; Covers IMM-WORKFLOW-004 R3; Covers IMM-WORKFLOW-004 R5
- Depends on: 1

### Step 3
- Step ID: U3
- Result: validation path for first implementation is explicit
- Verification: The plan and spec together state how a later implementation must prove no-plan routing, step-to-step bounded advance, QA stop behavior, and completion/budget stop reporting.
- Test scenarios: Covers IMM-WORKFLOW-004 acceptance criteria 2; Covers IMM-WORKFLOW-004 acceptance criteria 3; Covers IMM-WORKFLOW-004 acceptance criteria 4; Covers IMM-WORKFLOW-004 acceptance criteria 5
- Depends on: 2

## Notes
- Keep this slice contract-first; do not implement executor, QA, or background automation changes during planning.
- Do not merge this work into `imm-work` default behavior unless a later plan explicitly changes that contract.
- If implementation exposes that full-plan autowork needs new workflow state, create a separate follow-up plan instead of silently expanding this one.
