# Spec: post-closure evidence correction policy

## 1. Goal

Define how Immune-Brain should repair a discovered closure-evidence problem
after a Step has already been closed, without rewriting that closed Step's
State Ledger facts into an impossible chronology.

## 2. Background

`docs/plans/2026-05-15-004-fix-autowork-followup-completion-plan.md` closed
U1, then a later review noticed that final documentation files were not present
in the recorded execution evidence. A direct follow-up manually expanded the
closed Step's evidence after closure. That made the State Ledger inconsistent:
the evidence `recorded_at` timestamp became later than `closed_at`, while the
history still claimed the evidence event happened before review.

That repair cannot be safely treated as another same-boundary `follow_up`.
The issue is no longer the autowork contract itself; it is the representation of
post-closure correction in the State Ledger.

## 3. Requirements

### R1. Closed Step facts are immutable for chronology

- Do not mutate a closed Step's original execution evidence to include events
  that happened after its `closed_at` timestamp.
- Do not backdate `recorded_at`, `history[].at`, or review timestamps to make a
  later correction appear earlier.
- Do not claim QA reviewed files that were only added to evidence after QA pass.

### R2. Post-closure correction uses a fresh Step

- If a review finds missing closure evidence after a Step is already closed,
  create a new Plan/Step that explicitly repairs the evidence representation.
- The new Step may touch `.imm/memory/current_iteration.json`, `HANDOFF.md`, and
  tests or docs needed to make the correction verifiable.
- The new Step's own execution evidence must be recorded before its own QA
  closure.

### R3. Correction preserves useful evidence

- Preserve the fact that the original work passed its intended tests.
- Preserve the fact that a later review discovered an evidence representation
  problem.
- Make the correction legible to `imm-work status --json` and future
  `imm-compounder` runs without requiring readers to infer hidden manual edits.

### R4. Scope stays narrow

- Do not redesign the State Ledger schema in this slice.
- Do not add cross-session follow-up persistence.
- Do not rewrite unrelated historical Plan entries.

## 4. Acceptance Criteria

- [ ] The current State Ledger no longer reports execution evidence recorded
  after the same Step's `closed_at` timestamp.
- [ ] The correction is represented as a fresh Plan/Step with its own evidence
  and QA closure path.
- [ ] Focused tests or command evidence prove the workflow contract still
  passes after the correction.
- [ ] The next `imm-compounder` handoff can rely on coherent closure evidence.

