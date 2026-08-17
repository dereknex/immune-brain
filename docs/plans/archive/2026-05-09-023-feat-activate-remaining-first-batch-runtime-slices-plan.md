---
title: feat: activate remaining first-batch runtime slices
type: feat
status: planned
date: 2026-05-09
origin: user asked to write a plan so the existing subagents can be normally enabled
---

# Iteration Plan

## Task
- Summary: Activate the remaining first-batch subagent runtime slices by adding dedicated hosts for `security-reviewer` and `api-contract-reviewer`
- Origin: User first asked which subagents still could not be activated, then explicitly requested an `imm-planner` plan to ensure the existing subagents can be normally enabled. The latest brainstorm had already narrowed the next runtime gap to `security-reviewer`, and current repo inspection confirmed that `prompt-contract-reviewer`, `ai-eval-planner`, and `docs-verifier` already have runtime hosts while the two conditional-risk reviewers do not.
- Research: Checked `IMMUNE.md`, `README.md`, `docs/brainstorms/imm-brainstorm-subagents-post-docs-next-runtime-slice-2026-05-09.md`, `.imm/specs/first-subagent-batch.spec.md`, `.imm/specs/security-reviewer.spec.md`, `.imm/specs/api-contract-reviewer.spec.md`, `docs/solutions/dedicated-reviewer-activation-hosts.md`, `docs/solutions/first-subagent-batch-rollout.md`, `tests/test_skill_contracts.py`, and the current `skills/` inventory. Conclusion: the truthful remaining activation gap is not “all named subagents”, but the last two runtime hosts inside the already-committed first batch.
- Decisions: D1 choose `Scope Reduction` and limit the task to `security-reviewer` plus `api-contract-reviewer`; D2 treat `data-integrity-reviewer`, `reliability-reviewer`, `release-readiness-checker`, and `debug-investigator` as out of scope because they do not yet have the same planning maturity; D3 preserve the existing runtime-host pattern of standalone local skill surface + trigger-only routing + focused regression + manual runtime validation; D4 require the batch-level truth after execution to be “all four first-batch slices are activatable”, not “the entire README roster is complete”; D5 keep registry, shared dispatch, and multi-reviewer orchestration out of scope.
- Assumptions: Adding two dedicated local skill hosts is still the smallest truthful path to “existing subagents can be normally enabled” within the already-promised first batch; current focused contract tests can be extended without inventing a provider-specific harness; README and repo-contract wording may need narrow synchronization so activation claims remain truthful after the two hosts land.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`, `.imm/specs/remaining-first-batch-runtime-activation.spec.md`, possible dedicated runtime specs for both reviewers, `README.md`, `tests/test_skill_contracts.py`, and only minimal supporting contract wording if drift is discovered
  - dependencies_known: true
  - verification_path:
      - target: the remaining two first-batch reviewers become explicitly activatable through dedicated local skill hosts, and the repo truthfully reflects that all four first-batch slices are now activatable
      - method: `imm-plan <plan-path> --json` plus focused textual regression and Codex runtime manual validation for reviewer available / unavailable cases
  - blockers: broadening the task to the full README roster would mix runtime-host work with earlier docs-first slice planning; introducing shared runtime infrastructure would break the narrow activation-host boundary
  - replan_condition: if execution starts requiring registry work, shared capability detection, additional reviewer families, or cross-slice orchestration beyond the two named reviewers, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: `security-reviewer` has a dedicated runtime activation host with a bounded conditional-risk contract
- Verification: `skills/security-reviewer/SKILL.md` and its supporting runtime contract define the explicit trigger surface, advisory-only / read-only boundary, required review inputs, output focus, non-default posture, fallback wording, and manual validation path without escalating into a security platform.
- Test scenarios: Covers IMM-BATCH-002 R1; Covers IMM-BATCH-002 R2; Covers IMM-BATCH-002 acceptance criteria 1; Covers IMM-BATCH-002 acceptance criteria 3; Covers IMM-BATCH-002 acceptance criteria 4
- Depends on: none
- Scope: `skills/security-reviewer/SKILL.md`, runtime-spec support for `security-reviewer`, `README.md`, `tests/test_skill_contracts.py`, and only supporting wording in `.imm/specs/security-reviewer.spec.md` if drift is discovered
- Replan condition: If `security-reviewer` cannot be expressed as a dedicated activation host without automatic scanning, threat-model tooling, registry behavior, or non-advisory authority, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: `api-contract-reviewer` has a dedicated runtime activation host with a bounded conditional-risk contract
- Verification: `skills/api-contract-reviewer/SKILL.md` and its supporting runtime contract define the explicit trigger surface, advisory-only / read-only boundary, required review inputs, output focus, non-default posture, fallback wording, and manual validation path without escalating into an API governance platform.
- Test scenarios: Covers IMM-BATCH-002 R1; Covers IMM-BATCH-002 R3; Covers IMM-BATCH-002 acceptance criteria 2; Covers IMM-BATCH-002 acceptance criteria 3; Covers IMM-BATCH-002 acceptance criteria 5
- Depends on: none
- Scope: `skills/api-contract-reviewer/SKILL.md`, runtime-spec support for `api-contract-reviewer`, `README.md`, `tests/test_skill_contracts.py`, and only supporting wording in `.imm/specs/api-contract-reviewer.spec.md` if drift is discovered
- Replan condition: If `api-contract-reviewer` cannot be expressed as a dedicated activation host without diff engines, compatibility tooling, registry behavior, or non-advisory authority, stop and return to `imm-preplan-review`.

### Step 3
- Step ID: U3
- Result: the repo truthfully verifies that all four first-batch slices are activatable while broader roster items remain explicitly out of scope
- Verification: `README.md`, focused regression in `tests/test_skill_contracts.py`, and the runtime specs together prove that `prompt-contract-reviewer`, `ai-eval-planner`, `docs-verifier`, `security-reviewer`, and `api-contract-reviewer` all have dedicated activation-host paths, while no broader claim is made about `data-integrity-reviewer`, `reliability-reviewer`, `release-readiness-checker`, or `debug-investigator`.
- Test scenarios: Covers IMM-BATCH-002 R4; Covers IMM-BATCH-002 acceptance criteria 6; Covers IMM-BATCH-002 acceptance criteria 7
- Depends on: 1, 2
- Scope: `README.md`, `tests/test_skill_contracts.py`, new runtime specs for the two conditional-risk reviewers, and only minimal batch-boundary wording if activation truth drifts
- Replan condition: If proving truthful activation requires reworking the entire roster model, install pipeline, or shared runtime platform, keep the proof boundary on the first batch only and replan the broader inventory separately.

## Notes
- This plan intentionally does not promise that every named README subagent will become activatable in the same round; it closes the remaining gap inside the already-committed first batch.
- Reuse the existing runtime-host pattern from `prompt-contract-reviewer`, `ai-eval-planner`, and `docs-verifier` instead of inventing a second activation model for conditional-risk reviewers.
- If execution later proves the remaining roster members need docs-first slices first, plan them separately rather than widening this batch-closure task.
