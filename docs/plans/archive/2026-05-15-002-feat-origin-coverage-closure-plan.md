---
title: "feat: add origin coverage closure"
type: feat
status: planned
date: 2026-05-15
origin: brainstorm - preserve confirmed brainstorm scope through planner and QA
---

# Iteration Plan: Origin Coverage Closure

## Task

- Summary: Make brainstorm origin coverage explicit from handoff through planner validation to QA closure
- Origin: User confirmed that brainstorm must output a structured handoff manifest, planner must exhaustively map it, and QA must treat mapping completeness as a closure condition.
- Spec: `.imm/specs/origin-coverage-closure.spec.md`
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-REQ-3; BR-REQ-4; BR-REQ-5; BR-DEC-1; BR-OUT-1; BR-DEFER-1

## Research

- `skills/imm-brainstorm/SKILL.md` already defines `Brainstorm manifest` with `BR-REQ-*`, `BR-DEC-*`, `BR-OUT-*`, `BR-DEFER-*`, and `BR-Q-*` categories.
- `skills/imm-planner/SKILL.md` already defines closed-world `Brainstorm Trace` mapping and warns against silently omitted confirmed items.
- `.imm/imm-plan.py` already parses `Brainstorm manifest` and rejects missing trace rows, invalid IDs, missing targets, and missing reasons for deferred or out-of-scope rows.
- `skills/imm-qa/SKILL.md` currently says full upstream brainstorm coverage belongs to planner and `imm-plan`, so QA needs a narrower final-closure check instead of a full product-scope re-audit.

## Decisions

- D1: Keep `Brainstorm manifest` and `Brainstorm Trace` as Markdown plan fields for the first implementation.
- D2: Use `imm-plan` as the coverage validation authority.
- D3: QA checks unresolved origin coverage as closure evidence, but does not gain planner authority.
- D4: Multiple `BR-*` items may map to one Step when the Step remains one independently closable outcome.

## Assumptions

- Existing `BR-*` ID conventions are sufficient and do not need a new schema file.
- Existing validator parsing can be extended without changing historical plans that lack a manifest.
- QA can rely on `imm-plan` validation output or runtime plan sync evidence for final origin coverage status.

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-1 | covered_by_step | U1 | Brainstorm handoff manifest categories are part of the role contract. |
| BR-REQ-2 | covered_by_step | U2 | Planner closed-world mapping is enforced by validation. |
| BR-REQ-3 | covered_by_step | U2 | Coverage totals belong in planner validation output. |
| BR-REQ-4 | captured_as_decision | D3 | Planner cannot shrink consensus without explicit deferred or out-of-scope handling. |
| BR-REQ-5 | covered_by_step | U3 | QA closure must account for unresolved origin coverage. |
| BR-DEC-1 | captured_as_decision | D1 | Stable `BR-*` IDs remain the trace mechanism. |
| BR-OUT-1 | out_of_scope | Non-Goals | Brainstorm still cannot write Plans and QA still cannot decide planner scope. |
| BR-DEFER-1 | deferred | Future slice | A richer schema store is unnecessary until Markdown trace validation proves insufficient. |

## Steps

### Step 1

- Step ID: U1
- Result: Brainstorm handoff contract is explicit
- Verification: `skills/imm-brainstorm/SKILL.md` and `.imm/specs/origin-coverage-closure.spec.md` both name the required manifest categories `confirmed requirements`, `confirmed decisions`, `non-goals`, `deferred items`, and `open questions`; `python3 -m unittest tests.test_skill_contracts` exits zero.
- Execution note: test-first
- Test scenarios: Covers manifest category contract; Covers stable `BR-*` ID guidance; Covers brainstorm remaining read-only
- Depends on: none
- Scope: `skills/imm-brainstorm/SKILL.md`, `.imm/specs/origin-coverage-closure.spec.md`, `tests/test_skill_contracts.py`
- Replan condition: If brainstorm needs to write Plans or Specs to preserve coverage, stop and replan because that violates role authority.

### Step 2

- Step ID: U2
- Result: Planner coverage validation reports totals
- Verification: `python3 -m unittest tests.test_imm_plan` exits zero and `python3 .imm/imm-plan.py docs/plans/2026-05-15-002-feat-origin-coverage-closure-plan.md --json` reports a complete origin coverage summary with zero unmapped items.
- Execution note: test-first
- Test scenarios: Covers total declared item count; Covers mapped item count; Covers unmapped item count zero; Covers required reasons for deferred or out-of-scope rows
- Depends on: 1
- Scope: `.imm/imm-plan.py`, `tests/test_imm_plan.py`, `skills/imm-planner/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If coverage reporting requires a persistent schema store or runtime state redesign, defer that store and keep this slice on Markdown validation.

### Step 3

- Step ID: U3
- Result: QA closure contract includes origin coverage
- Verification: `skills/imm-qa/SKILL.md` states that unresolved origin coverage is a final closure `replan` condition and `python3 -m unittest tests.test_skill_contracts` exits zero.
- Test scenarios: Covers QA not passing a completed Plan with unmapped origin items; Covers QA returning replan rather than deciding product scope; Covers step evidence still being required
- Depends on: 2
- Scope: `skills/imm-qa/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If QA needs to mutate Plan text or decide whether a `BR-*` item should be excluded, stop and return to planner authority.

## Notes

- The current repo already contains some origin coverage mechanics. This Plan closes the remaining visibility and QA-closure gaps instead of duplicating implemented behavior.
- `BR-Q-*` items should not appear in an execution-ready Plan unless they are resolved as assumptions or explicitly deferred with a reason.
