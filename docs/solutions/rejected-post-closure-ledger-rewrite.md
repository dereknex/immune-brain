---
title: Rejected Post-Closure Ledger Rewrite
rejected: true
reusability: medium
key_files:
  - .imm/memory/current_iteration.json
  - docs/specs/post-closure-evidence-correction-policy.spec.md
  - docs/plans/2026-05-15-005-fix-post-closure-evidence-correction-policy-plan.md
  - tests/test_skill_contracts.py
next_reuse_scenarios:
  - closed Step evidence is missing final files
  - a reviewer asks to fix State Ledger evidence after QA pass
  - recorded_at would become later than closed_at
  - an imm-code-review finding asks to add post-QA verification details
---

# Rejected: Rewrite Closed Step Evidence After Closure

## Rejected approach

When a review finds missing evidence after QA pass, directly edit the closed
Step's `execution_evidence`, `recorded_at`, history entry, or review artifacts
to include the later files.

## Rejection reason

This makes the State Ledger chronology untrustworthy. Either the evidence
timestamp becomes later than `closed_at`, or the repair has to backdate history
to pretend QA reviewed evidence that did not exist at the time.

## Preferred approach

Create a fresh correction Plan/Step. Record the correction Step's own evidence,
then close that Step through QA. Preserve the original closed Step as historical
context rather than rewriting it.

## Evidence

- `.imm/specs/post-closure-evidence-correction-policy.spec.md`
- `docs/plans/2026-05-15-005-fix-post-closure-evidence-correction-policy-plan.md`
- `tests/test_skill_contracts.py`

## Recurrence evidence

On 2026-06-09, an `imm-code-review` follow-up found that a closed Step's
`execution_evidence` omitted the packaged UX heuristic checklist and source/dist
parity verification. A direct `imm-work` bookkeeping pass then edited the closed
Step evidence and added a later `recorded_at` timestamp after `closed_at`,
recreating the chronology problem this rejected decision was meant to prevent.

This recurrence strengthens the preferred approach: post-closure evidence fixes
need a fresh correction Plan/Step, even when the missing item is "just"
bookkeeping.
