---
title: "fix: make plan validation non-mutating"
type: fix
status: proposed
date: 2026-05-25
---

# Iteration Plan

## Task
- Summary: Make ordinary `imm-plan` validation safe to run without mutating State Ledger runtime state.
- Origin: `imm-code-review` found that validating a historical plan with `imm-plan --json` switched `.imm/memory/current_iteration.json` back to that plan and cleared completed steps.
- Spec: docs/specs/archive/validate-only-plan-command.spec.md
- Research: `.imm/imm_core/plan_runtime.py` owns validation parsing and runtime synchronization. `.imm/imm-plan.py` is the CLI entrypoint. `tests/test_imm_plan.py` covers plan sync behavior, and `tests/test_imm_work.py` covers activation requirements after sync.
- Decisions:
    - D1: Make validate-only behavior the default for `imm-plan <plan> --json` so review and QA validation commands are safe against historical plans.
    - D2: Keep runtime synchronization available through an explicit CLI flag for workflow setup.
    - D3: Update workflow-facing tests and validation commands only where they intentionally depend on runtime sync.
- Assumptions:
    - Existing users expect `imm-plan --json` to mean validation output, not hidden State Ledger mutation.
    - `imm-work` remains the authority for refusing activation when the requested plan has not been explicitly synced.
- Scope Mode: One-step runtime CLI contract repair
- Engineering Closure Check:
  - architecture_surface: `.imm/imm_core/plan_runtime.py`, `.imm/imm-plan.py`, `tests/test_imm_plan.py`, `tests/test_imm_work.py`
  - dependencies_known: yes
  - verification_path: focused unit tests plus existing workflow contract tests
  - blockers: none
  - replan_condition: If explicit sync requires changing unrelated `imm-work` state-machine semantics.
- Devil's Advocate Audit:
  - rollback_resilience: The change is isolated to the plan CLI contract and tests; rollback restores the prior implicit sync behavior.
  - verification_vanity: The regression must demonstrate that validating a different historical plan leaves the current State Ledger plan path and closed steps unchanged.
  - spec_dilution_detection: The plan fixes the unsafe command contract instead of only avoiding historical plan validation during reviews.

## Steps

### Step 1
- Step ID: U1
- Result: Ordinary plan validation is non-mutating
- Verification type: automated
- Execution note: test-first
- Verification: `python3 -m unittest tests.test_imm_plan tests.test_imm_work tests.test_skill_contracts`
- Test scenarios: Cover `imm-plan docs/plans/sample-plan.md --json` leaving an existing State Ledger unchanged when validating a different plan; cover explicit sync still updates runtime state for execution; keep activation guards passing for unsynced plans.
- Discovery cache: .imm/imm_core/plan_runtime.py (plan CLI and runtime sync logic); .imm/imm-plan.py (CLI wrapper); tests/test_imm_plan.py (plan validation and sync tests); tests/test_imm_work.py (activation guard coverage)
- Agent Hint: imm-executor
- failure_behavior: If default non-mutating validation breaks an execution entrypoint, keep the entrypoint working by moving only that path to explicit sync and record the affected command.
- security_considerations: The change must not let stale or unvalidated plan state activate work.
- Depends on: none

## Notes
- Validate this plan with explicit sync before execution, then continue through `imm-work`.
