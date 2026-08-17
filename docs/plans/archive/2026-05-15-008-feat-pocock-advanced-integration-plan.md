---
title: "feat: Pocock Advanced Integration for Immune-Brain"
type: feat
status: active
date: 2026-05-15
origin: brainstorm — 5 advanced execution-phase practices (diagnose loop, active architecture deepening, strict TDD, high-risk grilling, zoom-out perspective) derived from mattpocock/skills
---

# Iteration Plan

## Task
- Summary: Integrate 5 advanced execution-phase disciplines from Matt Pocock's skills into Immune-Brain, focusing on rigid diagnostic loops, active architectural deepening, strict TDD sequencing, relentless grilling for high-risk plans, and global zoom-out reviews.
- Origin: User discussion analyzing Matt Pocock's skills repository. Identified that while artifact concepts (CONTEXT.md) were adopted, the micro-disciplines during execution (like forcing a feedback loop before fixing) are missing.
- Research: Pocock's `/diagnose` enforces feedback-loop-first; `/improve-codebase-architecture` actively hunts shallow modules; `/tdd` enforces strict Red-Green-Refactor temporal flow; `/grill-with-docs` forces decision tree resolution; `/zoom-out` breaks tunnel vision.
- Decisions: D1 The disciplines will be embedded into existing `imm-*` skills rather than creating new commands. D2 `imm-executor` and `debug-investigator` will enforce the diagnostic loop and TDD sequence. D3 `imm-compounder` will adopt active architecture deepening. D4 `imm-preplan-review` will adopt the relentless grilling mode. D5 `imm-qa` and `imm-code-review` will enforce the zoom-out perspective. D6 All changes are text-based prompt updates in `SKILL.md` files.
- Assumptions: Target `SKILL.md` files exist and contract tests can be updated to assert the presence of these new rules. 
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/debug-investigator/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-arch-explorer/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-code-review/SKILL.md`, `tests/test_skill_contracts.py`, `.imm/specs/pocock-advanced-integration.spec.md`
  - dependencies_known: true
  - verification_path:
      - target: Target skills contain the newly specified rules. Contract tests pass verifying the presence of these instructions.
      - method: `python3 -m unittest tests.test_skill_contracts` and `python3 .imm/imm-plan.py docs/plans/2026-05-15-008-feat-pocock-advanced-integration-plan.md --json`
  - blockers: none
  - replan_condition: if skill text becomes too large or contradictory with existing baseline rules, requiring a split into separate traits.

## Steps

### Step 1
- Step ID: U1
- Result: Strict diagnostic loops with TDD sequencing are enforced.
- Verification: `skills/imm-executor/SKILL.md` contains Red-Green-Refactor sequence rules. `skills/debug-investigator/SKILL.md` and `imm-executor` contain feedback-loop-first and falsifiable hypothesis rules. `python3 -m unittest tests.test_skill_contracts` exits zero.
- Test scenarios: Covers executor TDD text; Covers diagnostic loop text; Covers no regression on existing contract tests.
- Depends on: none
- Scope: `skills/imm-executor/SKILL.md`, `skills/debug-investigator/SKILL.md`, `tests/test_skill_contracts.py`

### Step 2
- Step ID: U2
- Result: A new dedicated skill imm-arch-explorer actively identifies architectural deepening opportunities.
- Verification: `skills/imm-arch-explorer/SKILL.md` is created with rules for active architecture deepening, finding shallow modules, and proposing seams based on `CONTEXT.md`. `python3 -m unittest tests.test_skill_contracts` exits zero.
- Test scenarios: Covers imm-arch-explorer architecture deepening text; Covers no regression on existing contract tests.
- Depends on: none
- Scope: `skills/imm-arch-explorer/SKILL.md`, `tests/test_skill_contracts.py`

### Step 3
- Step ID: U3
- Result: Preplan-review enforces relentless grilling for high-risk tasks.
- Verification: `skills/imm-preplan-review/SKILL.md` contains rules for relentless decision tree expansion and interactive `CONTEXT.md`/ADR updates. `python3 -m unittest tests.test_skill_contracts` exits zero.
- Test scenarios: Covers preplan-review relentless grilling text; Covers no regression on existing contract tests.
- Depends on: none
- Scope: `skills/imm-preplan-review/SKILL.md`, `tests/test_skill_contracts.py`

### Step 4
- Step ID: U4
- Result: QA plus code-review enforce a global zoom-out perspective to prevent tunnel vision.
- Verification: `skills/imm-qa/SKILL.md` and `skills/imm-code-review/SKILL.md` contain rules for mandatory zoom-out checks against the global architecture and domain model. `python3 -m unittest tests.test_skill_contracts` exits zero.
- Test scenarios: Covers QA zoom-out text; Covers code-review zoom-out text; Covers no regression on existing contract tests.
- Depends on: 1, 2, 3
- Scope: `skills/imm-qa/SKILL.md`, `skills/imm-code-review/SKILL.md`, `tests/test_skill_contracts.py`

iew/SKILL.md`, `tests/test_skill_contracts.py`

contracts.py`

