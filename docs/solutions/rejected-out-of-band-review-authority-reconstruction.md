---
title: Rejected Out-of-Band Review Authority Reconstruction
rejected: true
reusability: medium
next_reuse_scenarios:
  - a reviewer finding exists only in conversation output
  - all review gates passed before a same-boundary defect was discovered
  - an agent proposes using git status or hand-editing State Ledger state to recover workflow authority
key_files:
  - plugins/immune-brain/runtime/state_ledger.ts
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - plugins/immune-brain/dist/imm-loop.md
  - tests/imm-follow-up-runtime.test.ts
  - docs/specs/2026-07-14-passed-review-followup-reopen.spec.md
---

# Rejected: Reconstruct Review Authority Outside the State Ledger

## Rejected approaches

1. Treat `git status`, `git diff`, or reviewer-provided scope as the authoritative changed-file set when the State Ledger has no pending review gate.
2. Let `imm-code-review` or `imm-ui-review` directly mutate the Ledger to create an execution target.
3. Rewrite closed Step evidence or prior QA timestamps so later findings appear to have been part of the original closure.

## Rejection reason

These approaches collapse distinct authority boundaries:

- Git state may contain unrelated user work and cannot prove which Step or follow-up owns a file.
- Reviewer scope describes a proposed repair boundary, not recorded execution evidence.
- Reviewers are read-only authorities; allowing them to write workflow state makes review output both judgment and execution authorization.
- Rewriting closed evidence destroys chronology and implies QA reviewed evidence that did not exist at closure.

## Preferred approach

Keep the State Ledger authoritative. A runtime checkpoint emits the authoritative changed-files signature; the reviewer echoes it in a bounded handoff; `imm-work` validates it and atomically reopens only the origin gate while creating `pending_follow_up`. Preserve prior pass evidence in append-only history and leave closed Step evidence unchanged.

If the finding cannot be tied to the current authoritative checkpoint or crosses the existing repair boundary, create a new correction Plan instead of reconstructing authority from workspace state.

## Evidence

- `docs/specs/2026-07-14-passed-review-followup-reopen.spec.md`
- `docs/plans/2026-07-14-002-fix-passed-review-followup-reopen-plan.md`
- `tests/imm-follow-up-runtime.test.ts`
- `tests/imm-loop-review-orchestration-contract.test.ts`
- Independent QA first rejected asymmetric Code/UI reviewer contracts, then passed after both carried `changed_files_signature`; final exact-signature code review passed.

## reusability_critique_notes

- Falsifiability: Git may be a valid authority in a workflow explicitly designed around Git commits as immutable execution targets. This rejection applies to Immune-Brain's Ledger-owned Step and follow-up lifecycle.
- Evidence trail audit: the original blocked session demonstrated that conversational handoff text was insufficient; Plan 002 tests prove a Ledger-native signature transition resolves the case without importing Git state or rewriting history.
- Architecture entropy resistance: keep this rejected decision separate because future debugging is likely to re-propose Git inference or direct reviewer writes as a quick recovery path. The positive implementation pattern remains in `docs/solutions/workflow.md`.
