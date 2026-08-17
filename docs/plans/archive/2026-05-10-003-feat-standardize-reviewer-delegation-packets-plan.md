---
title: "feat: standardize reviewer delegation packets"
type: feat
status: completed
date: 2026-05-10
origin: "docs/brainstorms/imm-brainstorm-reviewer-delegation-standardization-2026-05-10.md"
---

# Iteration Plan

- Summary: Standardize subagent delegation packets across all Reviewers and their orchestrators to improve context efficiency and coherence.

## Task
- Summary: Implement the `shared_context_summary + focus_delta` pattern for all Reviewer delegations.
- Origin: Brainstorm identified missing standardization in Reviewer orchestrators like `imm-code-review`.
- Research: Checked `BASELINE.md` (already contains the pattern). Checked `imm-party` (already uses it).
- Decisions: D1 Update orchestrators to produce the packet; D2 Update Reviewers to expect the packet; D3 Add regression tests.
- Assumptions: Reviewers can easily adapt to the layered input.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/imm-code-review/SKILL.md`, `skills/*-reviewer/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path: contract tests for delegation packet fields.
  - blockers: none.
  - replan_condition: if layered packets cause loss of critical context for specialized auditors.

## Steps

### Step 1
- Step ID: U1
- Result: Orchestrator delegation packet standardization
- Verification: `imm-code-review` and `imm-ui-review` explicitly mention producing `shared_context_summary + focus_delta` when delegating.
- Status: completed
- Depends on: none
- Scope: `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`
- Replan condition: none

### Step 2
- Step ID: U2
- Result: Reviewer delegation expectation refactor
- Verification: 9 target Reviewers mention receiving `shared_context_summary + focus_delta` in their required inputs.
- Status: completed
- Depends on: 1
- Scope: `skills/*-reviewer/SKILL.md`, `skills/ai-eval-planner/SKILL.md`, `skills/docs-verifier/SKILL.md`, `skills/debug-investigator/SKILL.md`, `skills/release-readiness-checker/SKILL.md`
- Replan condition: none

### Step 3
- Step ID: U3
- Result: `tests/test_skill_contracts.py` delegation regression pass
- Verification: `python3 -m unittest tests/test_skill_contracts`
- Status: completed
- Depends on: 2
- Scope: `tests/test_skill_contracts.py`
- Replan condition: none

