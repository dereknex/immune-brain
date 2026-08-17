---
title: "Origin Coverage Closure"
status: draft
date: 2026-05-15
origin: brainstorm - preserve confirmed brainstorm scope through planner and QA
---

# Spec: Origin Coverage Closure

## Problem

Brainstorm can reach a real consensus, but planner can still produce a valid
looking Plan that covers only part of that consensus. The gap is not Step
granularity. A single Step may cover multiple brainstorm items. The gap is
traceability: confirmed origin items need closed-world handling from handoff to
closure.

The repo already has partial support:

- `imm-brainstorm` defines a compact `Brainstorm manifest` with `BR-*` IDs.
- `imm-planner` defines `Brainstorm Trace` mapping rules.
- `imm-plan` rejects declared manifest items that are not mapped.

This slice tightens the remaining contract so coverage status is visible and QA
cannot close a Plan while origin coverage is unresolved.

## Desired Behavior

### R1. Brainstorm emits a minimal handoff manifest

When brainstorm framing is stable and routes to planner, the handoff manifest
must list planner-relevant items under stable IDs:

- `BR-REQ-*` for confirmed requirements
- `BR-DEC-*` for confirmed decisions
- `BR-OUT-*` for non-goals
- `BR-DEFER-*` for deferred items
- `BR-Q-*` for open questions

The manifest is the closed-world origin for the next Plan. Prose can explain
the rationale, but prose alone is not the coverage source of truth.

### R2. Planner maps every origin item

If a Plan has a `Brainstorm manifest`, planner must include `Brainstorm Trace`
for every declared `BR-*` item. Legal trace statuses are:

- `covered_by_step`
- `partially_covered`
- `captured_as_decision`
- `out_of_scope`
- `deferred`
- `resolved_as_assumption`

There is no silent omitted state. Reason-required trace statuses, including
`partially_covered`, `out_of_scope`, and `deferred`, require a reason. If partial
coverage, exclusion, or deferral changes goal completeness, planner must return
to the user before treating the Plan as execution-ready.

### R3. Coverage validation is visible

Planning validation must let the user or agent answer:

- total declared brainstorm items
- total mapped items
- total unmapped items
- whether every reason-required trace row, including `partially_covered`,
  `out_of_scope`, and `deferred`, has a reason

The first implementation can keep the existing Markdown `Brainstorm Trace`
format and extend `imm-plan` output instead of introducing a new schema store.

### R4. QA checks origin coverage before final closure

QA should still judge the active Step from recorded evidence, but final closure
must also confirm that origin coverage is resolved. A Plan cannot be treated as
complete when any declared `BR-*` item remains unmapped or any reason-required
trace row lacks a reason.

QA does not gain planner authority. If coverage is unresolved, QA returns
`replan` with the missing origin coverage evidence.

## Non-Goals

- Do not make `imm-brainstorm` write Plans or Specs.
- Do not require one Step per `BR-*` item.
- Do not introduce a database or external state store for origin coverage.
- Do not change implementation authority boundaries for planner, executor, or QA.
- Do not force QA to re-decide product scope; unresolved coverage returns to planner.

## Acceptance Criteria

- [ ] `imm-brainstorm` documents the required manifest categories.
- [ ] `imm-planner` documents closed-world `Brainstorm Trace` mapping.
- [ ] `imm-plan` reports origin coverage totals and rejects unmapped items.
- [ ] `imm-plan` rejects reason-required trace rows without reasons, including `partially_covered`, `out_of_scope`, and `deferred`.
- [ ] `imm-qa` treats unresolved origin coverage as a `replan` condition at closure.
- [ ] Contract tests cover the shared brainstorm planner QA contract.
- [ ] Plan validation for this slice passes via `python3 .imm/imm-plan.py docs/plans/2026-05-15-002-feat-origin-coverage-closure-plan.md --json`.

## Dependencies

- `skills/imm-brainstorm/SKILL.md`
- `skills/imm-planner/SKILL.md`
- `skills/imm-qa/SKILL.md`
- `.imm/imm-plan.py`
- `tests/test_imm_plan.py`
- `tests/test_skill_contracts.py`
