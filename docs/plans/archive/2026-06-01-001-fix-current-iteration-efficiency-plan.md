---
title: "fix: bound current_iteration hot state and reset recovery"
type: fix
status: proposed
date: 2026-06-01
origin: imm-brainstorm analysis of current_iteration.json efficiency
---

# Iteration Plan

## Task
- Summary: Keep `current_iteration.json` lightweight while preserving accidental-empty recovery and auditability.
- Origin: User asked whether the current `current_iteration.json` design can be improved from an efficiency angle. Brainstorm analysis found that the current file is about 128KB, with about 121KB from `history`, and that `state.json.current_iteration` can restore a finished Plan after intentional reset.
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-REQ-3; BR-REQ-4; BR-DEC-1; BR-DEC-2; BR-OUT-1
- Spec: docs/specs/current-iteration-efficiency.spec.md
- Research: `CONTEXT.md` defines State Ledger as the active runtime source of truth. `docs/solutions/canonical-runtime-state-paths.md` says `current_iteration` represents current active work, while `state.json` and `MEMORY.md` are durable sinks. `docs/specs/current-iteration-empty-state-recovery.spec.md` added accidental-empty recovery from `state.json`. Current measurements show `history` dominates the file size. `docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md` rejects SQLite or a third storage layer.
- Decisions:
    - D1: Use a new slice rather than appending to the closed 2026-05-29 Plan because this changes runtime semantics.
    - D2: Keep filesystem-as-brain by using a bounded history tail plus JSONL archive rather than a database.
    - D3: Treat intentional `finish` reset as authoritative idle state while preserving accidental-empty recovery for unmarked empty state.
    - D4: Include packaged runtime parity because plugin users exercise the same runtime behavior.
- Assumptions:
    - A history tail of 50 entries is enough for hot runtime routing and recent debugging.
    - Full historical audit detail can move to `.imm/memory/current_iteration_history.jsonl` without changing user-facing workflow.
    - Existing recovery tests can be refined to distinguish marked idle reset from accidental empty state.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/imm_core/current_iteration_state.py`, `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, `plugins/immune-brain/dist/.imm/`, `tests/test_current_iteration_state.py`, `tests/test_workflow_loop.py`, `tests/test_immune_brain_plugin_package.py`
  - compatibility: existing v2 State Ledger files load normally; unmarked accidental empty state still recovers from valid in-project `state.json`; marked finish reset stays idle
  - interruption_recovery: if execution stops after runtime changes but before package parity, repo runtime tests still prove behavior and Step 3 closes packaging drift
  - rollback_path: revert the touched runtime files, packaged copies, and focused tests together
  - verification_strength: focused unittest coverage plus package parity tests, not file-size inspection alone
  - Brainstorm traceability: every declared `BR-*` item is mapped below
  - replan_condition: if bounded history requires a new storage authority or broad State Ledger schema migration, stop and replan

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-1 | covered_by_step | U1 | `current_iteration.json` remains the active runtime source while finish reset becomes explicit idle state. |
| BR-REQ-2 | covered_by_step | U1 | Accidental-empty recovery from valid `state.json.current_iteration` is preserved. |
| BR-REQ-3 | covered_by_step | U1 | Intentional finish reset is blocked from state_json recovery. |
| BR-REQ-4 | covered_by_step | U2 | The hot JSON file keeps a bounded history tail. |
| BR-DEC-1 | captured_as_decision | D2 | Filesystem-as-brain remains the storage model. |
| BR-DEC-2 | covered_by_step | U2 | History is compressed into a bounded tail plus archive. |
| BR-OUT-1 | captured_as_decision | D1 | Broad workflow persistence redesign is out of scope. |

## Devil's Advocate Audit

### 1. Rollback Resilience
- Risk: A partial runtime change could make `finish` reset unrecoverable or make accidental recovery too aggressive.
- Recovery: U1 is backed by focused loader and workflow-loop tests. Reverting `.imm/imm_core/current_iteration_state.py`, `.imm/imm-finish.py`, and the tests restores the previous recovery contract.
- Risk: History archiving could lose audit detail.
- Recovery: U2 must write archived entries before trimming the hot file and test the archive content. If archive verification fails, keep the existing unbounded history behavior rather than silently dropping records.

### 2. Verification Vanity
- Risk: Merely asserting a smaller JSON string would not prove recovery semantics.
- Mitigation: U1 verifies both branches: marked finish reset stays idle, while unmarked accidental empty state still recovers from a valid in-project snapshot.
- Risk: Archive tests could only prove file existence.
- Mitigation: U2 must assert retained tail length and archived action/details content.

### 3. Spec Dilution Detection
- Risk: The plan could shrink scope to trimming history and omit the reset/recovery bug.
- Mitigation: BR-REQ-2 and BR-REQ-3 map to U1, and U1 blocks U2.
- Risk: The plan could avoid package parity because it is inconvenient.
- Mitigation: D4 and U3 make packaged runtime parity explicit.

## Steps

### Step 1
- Step ID: U1
- Result: Intentional finish reset remains idle during State Ledger recovery
- Verification type: automated
- Verification: `python3 -m unittest tests.test_current_iteration_state tests.test_workflow_loop`
- Test scenarios: marked finish reset does not recover from `state.json.current_iteration`; unmarked accidental empty state still recovers; out-of-project and invalid snapshots remain rejected; finish closure still resets active runtime state
- Discovery cache: .imm/imm_core/current_iteration_state.py (loader recovery gate); .imm/imm-finish.py (finish reset caller); .imm/imm-dehydrate.py (state snapshot producer); tests/test_current_iteration_state.py (recovery regression); tests/test_workflow_loop.py (finish reset regression); docs/specs/current-iteration-empty-state-recovery.spec.md (previous recovery contract)
- Execution note: test-first
- Failure behavior: If accidental recovery cannot be preserved, stop before changing history compaction.
- Depends on: none

### Step 2
- Step ID: U2
- Result: State Ledger history stays bounded through JSONL audit archiving
- Verification type: automated
- Verification: `python3 -m unittest tests.test_current_iteration_state tests.test_workflow_loop`
- Test scenarios: a State Ledger with more than 50 history records persists only the newest 50 records; older records appear in `.imm/memory/current_iteration_history.jsonl`; archived entries retain action and details; `state.json.current_iteration` uses the bounded history snapshot
- Discovery cache: .imm/imm_core/current_iteration_state.py (history save/load path); .imm/imm-dehydrate.py (durable snapshot writer); tests/test_current_iteration_state.py (archive regression); tests/test_workflow_loop.py (dehydrate snapshot regression); docs/solutions/canonical-runtime-state-paths.md (runtime versus durable memory boundary)
- Execution note: test-first
- Failure behavior: If archive write cannot be proven, keep unbounded history and return to planner.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Packaged runtime mirrors the State Ledger efficiency repair
- Verification type: automated
- Verification: `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts`
- Test scenarios: packaged runtime copies for touched files match repo runtime; plugin runtime entrypoints still exist; skill contract tests still pass
- Discovery cache: plugins/immune-brain/dist/.imm/ (packaged runtime copy); tests/test_immune_brain_plugin_package.py (package parity surface); tests/test_skill_contracts.py (contract regression); .imm/imm_core/current_iteration_state.py (source runtime)
- Failure behavior: If package parity fails, do not hand off execution until the packaged copy and parity test agree.
- Depends on: 2

## Next Action

After this plan validates, run `python3 .imm/imm-plan.py docs/plans/2026-06-01-001-fix-current-iteration-efficiency-plan.md --sync` and continue through `imm-work` for Step 1.
