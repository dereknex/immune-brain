---
title: "fix: recover empty current_iteration from durable state"
type: fix
status: proposed
date: 2026-05-23
origin: i18n plan follow-up validation finding
---

# Iteration Plan

## Task
- Summary: Recover `.imm/memory/current_iteration.json` from durable `state.json` when it is accidentally emptied.
- Origin: Runtime continuity gap observed after `current_iteration` reset while `state.json` still contains valid plan evidence.
- Spec: docs/specs/archive/current-iteration-empty-state-recovery.spec.md
- Research: CONTEXT.md defines `State Ledger` and `plan_path` contract.
  Current state runtime surfaces include `.imm/imm_core/current_iteration_state.py`.

## Decisions
- D1: Do not redesign workflow persistence; keep runtime format and healing model, only add a fallback recovery branch.
- D2: Recovery must remain in-project only; never load plan paths outside current project.

## Assumptions
- `.imm/memory/state.json` is writable and trustworthy enough as a recovery seed for this local continuity slice.
- `state.json.current_iteration` contains at least `plan_path` and enough step state to reconstruct non-destructively.

## Steps

### Step 1
- Step ID: U1
- Result: V2 `current_iteration` state is restored from `state.json.current_iteration` when canonical runtime state is empty.
- Verification Type: automated
- Verification: `python3 -m unittest tests/test_current_iteration_state.py -v`
- Test scenarios: empty canonical current_iteration should restore `plan_path`, `plan_signature`, and closed steps from `state.json`; out-of-project or invalid state.json should not auto-recover.
- Discovery cache: .imm/imm_core/current_iteration_state.py (loader + load_current_iteration_state recovery path); .imm/memory/state.json (durable current_iteration seed used by fallback path)
- Failure behavior: If out-of-project recovery is still required for another workflow, raise and log a blocker for a follow-up plan rather than broadening fallback scope.
- Security considerations: Recovery should not load paths outside repository root; reject absolute paths outside project via `resolve_plan_path(...).relative_to(project_root)` checks.
- Depends on: none

## Next Action

After plan validation pass, run `imm-plan` to sync runtime state and execute
the verification command for this step.
