# Iteration Plan: Post-Closure Evidence Correction Policy

## Task

- Summary: Repair the current State Ledger evidence mismatch by representing post-closure evidence correction as a fresh Step.
- Origin: `imm-code-review` found that `.imm/memory/current_iteration.json` records evidence after `closed_at` while history still places the evidence event before QA.
- Spec: `.imm/specs/post-closure-evidence-correction-policy.spec.md`

## Research

- `imm-work status --json` shows `docs/plans/2026-05-15-004-fix-autowork-followup-completion-plan.md` completed, but U1 has `execution_evidence.recorded_at` later than `closed_at`.
- The history array still has `record_execution_evidence` before `review_step`, so the top-level evidence timestamp and event timeline disagree.
- The previous `imm-code-review` classified this as a State Ledger strategy issue and explicitly routed it to `imm-planner`.
- `CONTEXT.md` defines State Ledger as the source that tracks Step lifecycle via explicit state transitions; this repair must preserve lifecycle chronology rather than patching closed facts in place.

## Decisions

- Use `new_slice`; the current issue is about post-closure evidence representation, not another direct same-boundary autowork contract edit.
- Do not mutate the closed U1 evidence from plan `004` to pretend later docs were reviewed before closure.
- Represent the correction as a fresh Step with its own activation, execution evidence, verification, and QA closure.
- Keep this slice narrow: repair the current ledger inconsistency and add a focused guard if needed; do not redesign the State Ledger schema.

## Assumptions

- The final autowork contract/docs changes from plan `004` are intended to stay.
- It is acceptable for the correction Step to document that plan `004` had a post-closure evidence representation error.
- `python3 -m unittest tests.test_skill_contracts` remains the primary verification for the user-facing contract surface.

---

### Step 1

- Step ID: U1
- Result: Post-closure evidence correction uses a fresh State Ledger Step
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero, and `imm-work status --json` shows the correction Step follows normal evidence-before-closure chronology
- Depends on: None
- failure_behavior: If chronology is still inconsistent, `imm-compounder` must not run because closure evidence remains unreliable.
- security_considerations: None; this changes workflow state evidence and contract docs only.

## Test scenarios

- A closed Step is not manually rewritten to claim later evidence happened before closure.
- The correction Step carries its own recorded evidence before QA pass.
- `imm-work status --json` exposes a coherent current Plan after the correction.

