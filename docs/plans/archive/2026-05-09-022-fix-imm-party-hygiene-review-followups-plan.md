---
title: fix: imm-party hygiene review follow-ups
type: fix
status: planned
date: 2026-05-09
origin: user invoked imm-code-review after the imm-party hygiene rollout, then requested a new planner follow-up because the completed slice still had contract-level gaps
---

# Iteration Plan

## Task
- Summary: Fix the remaining `imm-party` runtime-contract gaps left after the first hygiene slice so the handoff, delegation wording, and guard baseline all match the intended lower-bloat contract.
- Origin: After `2026-05-09-021-refactor-imm-party-contract-and-context-hygiene-plan.md` completed, `imm-code-review` found that the runtime schema still carried guard fields inside `party_packet`, the delegation wording still mixed old per-role context-summary language with the new shared-context contract, and the shared guard baseline was not actually implemented as a reference-plus-delta pattern.
- Research: Re-read `IMMUNE.md`, `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-contract-and-context-hygiene.spec.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `README.md`, and `tests/test_skill_contracts.py`. Conclusion: the previous slice landed most of the shape changes, but left one stale schema layer, one stale wording path, and one incomplete guard-baseline contraction.
- Decisions: D1 keep this as a bounded review-follow-up slice instead of reopening the broader hygiene initiative; D2 preserve all advisory-only and delegation authority boundaries; D3 treat shared guard baseline as a local reference pattern for `imm-party`, not a repo-wide rewrite; D4 keep the fix surface limited to the runtime skill, paired specs, and focused tests.
- Assumptions: `imm-party` can finish the intended prompt-bulk reduction without changing any workflow authority; the repo-wide guard baseline can be referenced succinctly enough to lower duplication while still keeping Codex-facing fields explicit; the stale per-role context wording is accidental and can be removed without affecting delegation semantics.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/imm-party-hygiene-review-followups.spec.md`, `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `.imm/specs/imm-party-contract-and-context-hygiene.spec.md`, `README.md`, `docs/solutions/advisory-roundtable-layer.md`, and `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: `imm-party` runtime contract no longer leaks guard fields into `party_packet`, no longer carries stale per-role context wording, and references shared guard baseline with only party-specific delta left inline
      - method: focused unittest coverage plus targeted text checks on the runtime skill and paired specs
  - blockers: none
  - replan_condition: if the fixes start requiring repo-wide skill rewrites, a new metadata engine, or a generalized guard registry, stop and return to planner as a broader contract-governance initiative

## Steps

### Step 1
- Step ID: U1
- Result: `imm-party` advisory handoff becomes a true single-layer `party_packet` payload.
- Verification: focused checks confirm `party_packet` only carries advisory payload fields and keeps `allowed / blocked / workflow_guard` outside the payload layer.
- Test scenarios: Covers no guard fields inside `party_packet`; Covers no regression to core advisory handoff fields; Covers no reintroduction of planner-mapping payload fields
- Depends on: none
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-contract-and-context-hygiene.spec.md`, and directly related advisory wording only
- Replan condition: If the slimmer payload breaks downstream workflow expectations in a way that requires a broader handoff redesign, stop and return to planner.

### Step 2
- Step ID: U2
- Result: `imm-party` delegation wording fully aligns to `shared_context_summary + focus_delta`.
- Verification: focused checks confirm runtime skill and paired spec no longer describe per-role full context summaries and now describe one shared context plus per-role delta only.
- Test scenarios: Covers removal of stale per-role summary wording; Covers shared-context contract wording in runtime skill; Covers paired-spec alignment
- Depends on: 1
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, and `docs/solutions/bounded-advisory-delegation-packets.md` only if wording sync is needed
- Replan condition: If this wording cleanup exposes a deeper delegation-runtime mismatch that cannot be fixed without redesigning sub-agent packet flow, stop and return to planner.

### Step 3
- Step ID: U3
- Result: `imm-party` Codex-facing guard contract becomes shared-baseline reference plus party-specific delta.
- Verification: focused checks confirm the runtime skill references the shared baseline, keeps only party-specific delta inline, and the updated tests guard this narrower contract instead of requiring duplicated narrative.
- Test scenarios: Covers baseline-reference presence; Covers party-specific delta remains explicit; Covers no full duplicate guard narration in the `imm-party` slice
- Depends on: 2
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-hygiene-review-followups.spec.md`, `README.md`, and `tests/test_skill_contracts.py`
- Replan condition: If implementing the reference-plus-delta pattern starts forcing a repo-wide contract migration, stop and return to planner.

## Notes
- This follow-up intentionally does not reopen repo-wide guard deduplication, anchor-format redesign, or broader retrieval-policy work.
- The slice order is deliberate: first fix the payload boundary, then remove stale delegation wording, then tighten the guard reference pattern and its focused tests.
