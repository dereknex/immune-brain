---
title: "fix: Per-step state ledger review fixes"
type: fix
status: active
date: 2026-05-12
origin: imm-code-review findings after per-step state ledger implementation
---

# Iteration Plan

## Task
- Summary: Fix State Ledger review blockers so schema v2 is actually migrated, preserved, visible, and safe across runtime tools
- Origin: origin_review from imm-code-review after `docs/plans/2026-05-12-068-feat-per-step-state-ledger-plan.md`
- Research: Review found v1 state never migrates to v2; append-safe sync reads `completed_steps` instead of closed ledger entries; v2 CLI output still dereferences legacy `active_step`; status output spreads raw v2 state without derived top-level fields; healing ignores v2 `steps`; v2 rework/replan transitions are stricter than the v1 review contract; v2 `--force` activation still rejects replacement in the helper layer
- Decisions: D1 create a new follow-up slice instead of appending to the completed plan; D2 keep State Ledger schema v2 but repair all runtime read/write adapters; D3 keep single-active policy while preserving future parallel-ready schema shape; D4 verify through targeted v2 regressions plus existing workflow tests
- Assumptions: Existing v1 behavior remains the compatibility baseline; no true parallel execution is introduced in this repair
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/current_iteration_state.py`, `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-plan.py`, `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, `tests/`
  - dependencies_known: true
  - verification_path:
      - target: v1 state migrates to v2; v2 append-safe sync preserves closed entries; v2 CLI/status outputs are backward-compatible; v2 healing validates ledger entries; v2 rework/replan/force paths match intended contracts
      - method: `python3 -m unittest tests.test_state_ledger tests.test_imm_work tests.test_imm_review tests.test_skill_contracts`
  - blockers: none
  - replan_condition: if fixing these findings requires redesigning schema v2 rather than repairing adapters

## Steps

### Step 1
- Step ID: U1
- Result: State Ledger runtime contract is coherent across migration / sync / status / CLI / healing / review paths
- Verification: `python3 -m unittest tests.test_state_ledger tests.test_imm_work tests.test_imm_review tests.test_skill_contracts` exits zero; `python3 .imm/imm-plan.py docs/plans/2026-05-12-069-fix-per-step-state-ledger-review-fixes-plan.md --json` exits zero; targeted tests cover v1 load persistence to v2, v2 top-level status derivation, v2 append-safe preservation, v2 CLI print path, v2 self-healing, v2 rework/replan, and v2 force activation
- Test scenarios: v1 load persists schema v2; v2 status JSON derives legacy fields; v2 activation CLI prints from derived active step; v2 record-execution CLI prints from derived evidence; v2 append-safe sync preserves closed entries; v2 healing removes stale ledger entries; v2 review rework/replan follows review contract; v2 force activation replaces the active entry
- Depends on: none
- Scope: `.imm/current_iteration_state.py`, `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-plan.py`, `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, `tests/test_state_ledger.py`, `tests/test_imm_work.py`, `tests/test_imm_review.py`, `tests/test_skill_contracts.py`
- Execution note: characterization-first
