---
title: "feat: Subagent Execution Truth MVP"
type: feat
status: planned
date: 2026-05-17
origin: user request under imm-planner
---

# Iteration Plan

## Task
- Summary: Harden the imm-code-review runtime path to establish execution truth for subagent dispatch by utilizing CLI helpers for planning, packet building, and local model resolution.
- Origin: User request via imm-brainstorm to imm-planner handoff.
- Research: 
  - skills/imm-code-review/SKILL.md currently documents subagent dispatch in prose but needs strict tool sequencing.
  - activation_plan.py emits model_tier but no mechanism enforces concrete ID resolution.
  - skills/imm-compounder/SKILL.md does not read .imm/memory/dispatch_telemetry.jsonl.
- Decisions: D1 keep dispatch host-driven; D2 use imm-advisory-reviewer for review lenses; D3 resolve model tiers locally with a fallback map in SKILL.md; D4 handle partial failures gracefully by merging successes.
- Assumptions: The execution environment supports explicit model ID specification if provided.
- Brainstorm manifest:
  - BR-REQ-1: imm-code-review must use the activation/packet helpers.
  - BR-REQ-2: Model tiers must resolve to concrete IDs.
  - BR-REQ-3: imm-compounder must consume subagent telemetry.
  - BR-DEC-1: Keep dispatch host-driven.
  - BR-DEC-2: Use imm-advisory-reviewer as primary target.
  - BR-Q-1: Model resolution mapping lives in config with local fallback.
  - BR-Q-2: Partial failures merge successful lenses.
- Brainstorm Trace:
  - BR-REQ-1: covered_by_step
  - BR-REQ-2: covered_by_step
  - BR-REQ-3: covered_by_step
  - BR-DEC-1: captured_as_decision
  - BR-DEC-2: captured_as_decision
  - BR-Q-1: resolved_as_assumption
  - BR-Q-2: resolved_as_assumption
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: skills/imm-code-review/SKILL.md, skills/imm-compounder/SKILL.md, tests/test_skill_contracts.py
  - dependencies_known: true
  - verification_path:
      - target: Execution sequence is defined and verified.
      - method: Contract assertions in pytest.
  - blockers: none
  - replan_condition: if execution truth sequencing proves impossible without a custom runtime engine, stop and replan.

## Steps

### Step 1
- Step ID: U1
- Result: Execution truth sequencing is explicitly defined in the imm-code-review contract.
- Verification: skills/imm-code-review/SKILL.md requires the tool call sequence for imm-activation-plan followed by delegation_packet preparation.
- Test scenarios: Covers exact tool call sequence.
- Depends on: none

### Step 2
- Step ID: U2
- Result: imm-compounder contract is updated to consume the dispatch telemetry.
- Verification: skills/imm-compounder/SKILL.md instructs reading the telemetry jsonl file for dispatch_efficiency reporting.
- Test scenarios: Covers telemetry reading requirement.
- Depends on: none

### Step 3
- Step ID: U3
- Result: Contract regression tests are updated for execution truth.
- Verification: pytest tests/test_skill_contracts.py passes with new execution truth assertions.
- Test scenarios: Covers imm-code-review execution truth clauses.
- Depends on: 1, 2
