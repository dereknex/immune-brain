---
title: refactor: imm-party contract and context hygiene
type: refactor
status: planned
date: 2026-05-09
origin: user asked whether the previously suggested imm-party context and token optimizations had actually been implemented, then requested a concrete plan for the missing work
---

# Iteration Plan

## Task
- Summary: Reduce `imm-party` runtime prompt bulk and repeated context by splitting design from runtime contract, compressing delegation/handoff structures, and replacing long-string skill tests with structured anchors.
- Origin: After reviewing `imm-party`, the user asked whether eight specific improvements had landed: runtime/design split, canonical guards, simpler `party_packet`, shared context plus role deltas, default-2 role escalation, delta-only role output, repo inspection boundaries, and structured contract tests. The repo check showed these items are mostly still open.
- Research: Reviewed `IMMUNE.md`, `skills/imm-party/SKILL.md`, `.imm/specs/party-mode-advisory.spec.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `README.md`, `tests/test_skill_contracts.py`, and the existing advisory / tested-contract solution docs. Conclusion: `imm-party` still duplicates runtime and design material, still uses per-role `context_summary`, still carries double-layer handoff fields, and still relies on long-string assertions that incentivize prompt bloat.
- Decisions: D1 use Scope Reduction and limit the slice to `imm-party` plus directly coupled docs/tests; D2 preserve the existing advisory-only and delegation authority boundaries; D3 treat repo inspection guidance as a minimal contract rule, not a new search subsystem; D4 only convert the contract tests touched by this slice to structured anchors instead of rewriting the full test file.
- Assumptions: `imm-party` can shrink its runtime surface without losing the key advisory/delegation contract; downstream planning roles can derive `Origin / Research / Decisions / Assumptions` from party output instead of requiring them in the runtime packet; a shared guard baseline can be referenced without rewriting every skill in the repo; short anchor-style assertions are sufficient to keep `imm-party` contracts stable.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/imm-party-contract-and-context-hygiene.spec.md`, `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `README.md`, `docs/solutions/advisory-roundtable-layer.md`, `docs/solutions/tested-skill-contracts.md`, and `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: `imm-party` runtime skill becomes shorter and less duplicative while preserving advisory boundaries, and focused tests verify anchors instead of long prose
      - method: focused unittest coverage plus targeted text checks for runtime/design layering, packet fields, role-selection rules, and shared guard references
  - blockers: none
  - replan_condition: if the slice starts requiring a repo-wide guard-contract rewrite, a generic retrieval framework, or a full test-harness redesign, stop and return to planner as a broader prompt-governance initiative

## Steps

### Step 1
- Step ID: U1
- Result: `imm-party` runtime skill keeps only the execution-facing contract.
- Verification: focused contract checks confirm the runtime skill keeps trigger/fallback/boundary/output anchors, while extended design and downstream mapping live outside the runtime path.
- Test scenarios: Covers runtime-vs-design layering anchors; Covers no regression to advisory/delegation boundary; Covers no removal of explicit fallback reasons
- Depends on: none
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `.imm/specs/imm-party-contract-and-context-hygiene.spec.md`, and a directly related solution doc if needed
- Replan condition: If runtime/design split cannot be expressed without inventing a new prompt registry or cross-skill config layer, stop and return to planner.

### Step 2
- Step ID: U2
- Result: `imm-party` delegation packet uses `shared_context_summary` plus per-role `focus_delta`.
- Verification: focused checks confirm `shared_context_summary` and per-role `focus_delta` replace repeated per-role context blocks in the runtime and paired spec contracts.
- Test scenarios: Covers shared context packet anchors; Covers no repeated per-role full-context requirement; Covers no loss of read-only delegation boundary
- Depends on: 1
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, and related advisory solution wording only
- Replan condition: If shared context compression requires a broader sub-agent runtime redesign, stop and return to planner.

### Step 3
- Step ID: U3
- Result: `imm-party` final `party_packet` becomes a single-layer advisory handoff without duplicated downstream planning fields.
- Verification: focused checks confirm `party_packet` keeps core advisory fields and no longer requires duplicated `Origin / Research / Decisions / Assumptions` runtime output.
- Test scenarios: Covers single-layer handoff anchors; Covers removal of duplicated downstream planning fields; Covers no loss of core advisory packet fields
- Depends on: 2
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-contract-and-context-hygiene.spec.md`, and related advisory solution wording only
- Replan condition: If downstream planning cannot consume the slimmer advisory handoff without a broader workflow packet redesign, stop and return to planner.

### Step 4
- Step ID: U4
- Result: `imm-party` role selection defaults to `2` voices with explicit escalation triggers to `3` or `4`.
- Verification: focused checks confirm the default role count and the exact conditions that justify escalation beyond `2`.
- Test scenarios: Covers default-2 role policy; Covers escalation-to-3 trigger; Covers escalation-to-4 trigger
- Depends on: 3
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-contract-and-context-hygiene.spec.md`, and minimal README wording only if needed
- Replan condition: If role selection rules start requiring dynamic scoring, automatic retrieval, or general orchestration policy changes, stop and return to planner.

### Step 5
- Step ID: U5
- Result: `imm-party` role-output contract becomes delta-only.
- Verification: focused checks confirm agreements are aggregated once and per-role outputs do not repeat shared background or shared conclusions by default.
- Test scenarios: Covers delta-only output anchors; Covers single agreement aggregation; Covers no repeated background requirement
- Depends on: 4
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-contract-and-context-hygiene.spec.md`, and directly related advisory solution wording only
- Replan condition: If delta-only output cannot be expressed without redesigning the entire party response format, stop and return to planner.

### Step 6
- Step ID: U6
- Result: `imm-party` analysis guidance defaults to a narrow repo-inspection boundary.
- Verification: focused checks confirm the read path is limited to the skill, the paired spec, and at most one related solution doc before any broader repo scan.
- Test scenarios: Covers minimal read-path guidance; Covers `upstreams/` off by default; Covers no introduction of a new retrieval engine
- Depends on: 5
- Scope: `skills/imm-party/SKILL.md`, `README.md`, and `.imm/specs/imm-party-contract-and-context-hygiene.spec.md` only
- Replan condition: If inspection-boundary guidance starts requiring automated tooling or repo-wide retrieval policy changes, stop and return to planner.

### Step 7
- Step ID: U7
- Result: `imm-party` contract tests use structured anchors for this slice instead of long prose locks.
- Verification: focused tests pass while `imm-party` assertions no longer depend on long sentence fragments for the newly refactored contract surfaces.
- Test scenarios: Covers anchor-based `imm-party` contract assertions; Covers shared guard baseline references; Covers no repo-wide mandatory migration of all skill tests in the same slice
- Depends on: 6
- Scope: `tests/test_skill_contracts.py` plus any tiny doc anchors needed to support the new assertions; no wider test-harness rewrite
- Replan condition: If structured contract verification requires reworking the whole skill-test strategy or every skill file in the repo, stop and return to planner.

## Notes
- This plan intentionally leaves full repo-wide canonical guard deduplication, generic retrieval policy infrastructure, and wholesale conversion of every skill contract test out of scope.
- The order is deliberate: first shrink runtime-vs-design overlap, then remove duplicated context/packet fields, then tighten role/output behavior and inspection boundary, and only then convert the tests that would otherwise pin the old wording in place.
