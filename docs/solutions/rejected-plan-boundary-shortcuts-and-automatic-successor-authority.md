---
rejected: true
rejection_reason: >
  Documentation-only guidance, fixed size thresholds, a Phase 1 Plan queue, and
  automatic successor activation either leave malformed boundaries undetected or
  convert advisory metadata into workflow authority before identity, approval,
  recovery, and atomic transition semantics exist.
reusability: medium
key_files:
  - docs/specs/2026-07-28-roadmap-plan-boundary-successor.spec.md
  - docs/plans/2026-07-28-002-feat-roadmap-plan-boundary-successor-phase1-plan.md
  - plugins/immune-brain/runtime/plan_core.ts
  - tests/plan-validation.test.ts
next_reuse_scenarios:
  - A planning change proposes documentation without executable contract checks.
  - File count, tokens, compactions, Steps, or review rounds are proposed as Plan gates.
  - Static successor metadata is proposed as a queue or automatic activation signal.
  - A first planning-contract phase is being expanded into State Ledger transition behavior.
---

# Rejected: Plan Boundary Shortcuts and Automatic Successor Authority

## Rejected approaches

1. Document Plan-boundary guidance without validating the declared metadata.
2. Define universal Plan limits from file count, token count, compactions, Step count, elapsed time, domain count, or review rounds.
3. Add a State Ledger Plan queue while successor identity, approval, recovery, and atomic transition semantics remain deferred.
4. Treat a declared or parser-valid successor as permission to create, approve, queue, or activate another Plan.

## Rejection reason

Documentation alone cannot expose missing or malformed successor fields. Fixed thresholds confuse workload symptoms with semantic cohesion: a broad but cohesive migration may be valid, while a small change may still cross an independent security or rollback boundary. A queue or automatic activation goes further by turning planning metadata into execution authority and bypassing Planner validation, explicit user approval, stale-writer checks, and recovery guarantees.

These approaches also create false session coupling. Plan size and progression must not force the user to create, close, or switch sessions.

## Preferred approach

Keep full initiative scope and Phase identity in the Roadmap. Give each executable Plan one outcome-cohesive boundary and record quantitative signals only as advisory `Scope pressure`. Use an opt-in, pure validator for static local metadata. Add persisted approval and atomic transition behavior only in separately planned runtime phases, with the State Ledger remaining the execution authority and the user retaining activation and session-lifecycle authority.

## Evidence

- `docs/specs/2026-07-28-roadmap-plan-boundary-successor.spec.md` explicitly rejects documentation-only guidance, a Phase 1 queue, fixed Plan thresholds, and automatic successor activation.
- `docs/plans/2026-07-28-002-feat-roadmap-plan-boundary-successor-phase1-plan.md` limits P1 to authoring guidance and pure validation, while deferring State Ledger, approval, routing, and activation behavior.
- `tests/plan-validation.test.ts` proves deterministic opt-in validation, legacy compatibility, and validate-only execution without State Ledger creation.
- The completed P1 verification passed 37 tests, both independent QA gates, and final exact-signature code review with zero findings.

## reusability_critique_notes

- Falsifiability: Documentation-only may be sufficient for non-executable prose with no machine-readable contract. Quantitative thresholds may be legitimate operational limits for a specific tool, but they remain unsuitable as universal semantic Plan boundaries. Automatic activation would require an explicit product-authority change plus separately verified approval, atomicity, recovery, and rollback semantics.
- Evidence trail audit: Closure evidence strongly supports rejecting these shortcuts for P1 and validates the preferred static boundary. It does not prove that all future queues, schedulers, or DAG designs are invalid; those remain deferred design topics rather than permanently rejected architecture.
- Architecture entropy resistance: This standalone rejected Learning prevents future Plans from re-litigating the same authority shortcuts while the positive reusable pattern stays in `docs/solutions/contracts.md`. No `reconsider_if` is recorded because current evidence does not establish a single safe trigger for revisiting the combined shortcuts.
