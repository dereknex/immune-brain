# Spec: Per-Step State Ledger Review Fixes

## Summary

Fix the code-review blockers found after the first State Ledger implementation so v1-to-v2 migration, v2 plan sync, v2 status output, v2 CLI output, and v2 self-healing all behave consistently.

## Origin

`imm-code-review` after `docs/plans/2026-05-12-068-feat-per-step-state-ledger-plan.md` found that the State Ledger layer exists but is not fully active or consistent across runtime paths.

## Accepted behaviors

1. Loading an old-format `current_iteration.json` migrates it to schema v2 and persists the migrated State Ledger at the canonical runtime path.
2. `status --json` and text status expose backward-compatible `active_step` / `completed_steps` values derived from the State Ledger when schema v2 is active.
3. `imm-work.py activate` and `imm-work.py record-execution` print from derived v2 active-step state after saving ledger mutations.
4. Same-plan append-safe sync preserves closed State Ledger entries instead of clearing `steps`.
5. Runtime self-healing validates v2 `steps` against the recovered plan and removes stale active / closed / pending entries that no longer match the plan boundary.
6. QA `rework` / `replan` behavior for v2 matches the v1 review contract where structurally valid decisions are accepted and recorded with clear state transitions.
7. `--force` activation continues to replace the current active step under the single-active policy for both v1 and v2 states.

## Non-goals

- Redesigning the State Ledger schema beyond fixing the review findings.
- Implementing true parallel step execution.
- Adding file locking or append-only event sourcing.

## Test scenarios

- v1 load path persists v2 state with `schema_version: 2` and `steps`.
- v2 status JSON contains derived `active_step` / `completed_steps` at the top level.
- v2 CLI activation and record-execution commands exit zero and print the expected step details.
- v2 append-safe plan sync preserves closed ledger entries for unchanged completed prefix steps.
- v2 healing removes stale ledger entries and clears invalid active ledger state when plan recovery changes boundaries.
- v2 rework / replan decisions behave consistently with the existing v1 review contract.
- v2 force activation replaces a different active step without leaving two active entries.
