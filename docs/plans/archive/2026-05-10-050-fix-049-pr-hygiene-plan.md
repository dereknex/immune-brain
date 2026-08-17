---
title: fix: track 049 artifacts and normalize current_iteration newline
type: fix
status: planned
date: 2026-05-10
origin: imm-code-review follow-up after completed plan 049 (direct_fix)
---

# Iteration Plan

## Task
- Summary: Land missing 049 planning artifacts in git and fix EOF newline on runtime iteration snapshot file.
- Origin: `imm-code-review` flagged untracked `.imm/specs/planning-granularity-preplan-routing.spec.md` and `docs/plans/2026-05-10-049-feat-planning-granularity-preplan-routing-plan.md`, plus missing newline at end of `.imm/memory/current_iteration.json`.
- Research: `git status` showed `??` for both artifacts while SKILL/README/IMMUNE/tests were modified; diff on `current_iteration.json` ended without `\n`.
- Decisions: D1 treat as **new_slice** plan because runtime treats `049` as completed—no `append_to_plan`; D2 keep runtime JSON payload unchanged aside from trailing newline; D3 defer optional contract-test brittleness edits to a future slice unless user asks.
- Assumptions: Team intends these paths tracked with the same PR as workflow-doc changes; no policy forbids committing `current_iteration.json` in this repo.

## Steps

### Step 1
- Step ID: U1
- Result: Repository records the 049 spec file plus the 049 plan file as tracked paths.
- Verification: `git status` shows neither `?? .imm/specs/planning-granularity-preplan-routing.spec.md` nor `?? docs/plans/2026-05-10-049-feat-planning-granularity-preplan-routing-plan.md` (paths may appear as `A`/`M` instead).
- Agent Hint: imm-executor
- Test scenarios: Covers PH1
- Depends on: none

### Step 2
- Step ID: U2
- Result: File `.imm/memory/current_iteration.json` ends with a newline character after UTF-8 content.
- Verification: `tail -c1 .imm/memory/current_iteration.json | od -An -tx1` shows `0a` or equivalent newline proof; no semantic fields intentionally deleted for this step.
- Agent Hint: imm-executor
- Test scenarios: Covers PH2
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Skill contract tests stay green after hygiene edits.
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero.
- Agent Hint: imm-executor
- Test scenarios: Covers PH3
- Depends on: 2

## Notes
- If project policy later forbids committing `current_iteration.json`, replace U2 with a reset/minimal snapshot via a dedicated replan—out of scope here.
