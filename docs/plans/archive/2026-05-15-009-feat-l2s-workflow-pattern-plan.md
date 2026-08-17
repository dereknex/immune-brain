---
title: "feat: codify L2S-WF (Lightweight 2-Step Workflow) pattern"
type: feat
status: planned
date: 2026-05-15
origin: brainstorm - simplify workflow without compromising Immune-Brain philosophy
---

# Iteration Plan: Codify L2S-WF Pattern

## Task

- Summary: Formalize the 2-step lightweight workflow pattern (/prep and /run) in repository documentation and system instructions.
- Origin: User requested a lightweight 2-step workflow for efficiency. Best solution is decoupled instructions (/prep and /run) driving existing skills.
- Spec: `.imm/specs/l2s-workflow-pattern.spec.md`

## Research

- `IMMUNE.md`: Defines core roles and boundaries.
- `BASELINE.md`: Defines shared operating rules.
- `skills/imm-work/SKILL.md`: Already mentions "Fast-Track" for 2-step plans.
- `docs/patterns/`: Currently empty, ideal for new workflow patterns.

## Decisions

- D1: Create a dedicated pattern document in `docs/patterns/`.
- D2: Update `IMMUNE.md` to explicitly mention the "Two-Step Instruction Alias" as a valid orchestration mode.
- D3: Do not create new skills; use high-level "Instruction" naming to describe the orchestration of existing skills.

## Assumptions

- Users understand that `/prep` and `/run` are conceptual aliases for a sequence of tool-driven skills.

## Steps

### Step 1

- Step ID: U1
- Result: L2S-WF Pattern documented
- Verification: File `docs/patterns/l2s-workflow.md` exists and contains the approved orchestration logic for `/prep` and `/run`.
- Verification type: automated
- Scope: `docs/patterns/l2s-workflow.md`

### Step 2

- Step ID: U2
- Result: System Constitution (IMMUNE.md) updated
- Verification: `IMMUNE.md` contains the "L2S-WF" pattern in the "組合式主线" (Composable Mainline) section.
- Verification type: automated
- Depends on: 1
- Scope: `IMMUNE.md`

### Step 3

- Step ID: U3
- Result: Learning extracted to workflow hub
- Verification: `docs/solutions/workflow.md` contains an entry for the L2S-WF pattern and its benefits.
- Verification type: automated
- Depends on: 2
- Scope: `docs/solutions/workflow.md`
