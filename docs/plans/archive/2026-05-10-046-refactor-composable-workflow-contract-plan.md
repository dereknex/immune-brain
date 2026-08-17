---
title: refactor: define composable workflow contract
type: refactor
status: planned
date: 2026-05-10
origin: user requested a planner slice to reframe the upstream strong-process workflow into a composable workflow contract while preserving execution boundaries
---

# Iteration Plan

## Task
- Summary: Reframe the repo-facing workflow contract from strong stage-chain language into a composable trigger-based model without weakening authority, evidence, or active-step boundaries
- Origin: The user asked to analyze upstream workflow approaches, focus on execution boundaries, and improve the process model into composition rather than strong process. `imm-brainstorm` concluded the repo should preserve hard boundaries but demote soft stages into attachable capabilities, and `imm-preplan-review` locked the slice to contract-only changes rather than runtime orchestration work.
- Research: Checked `IMMUNE.md`, `README.md`, `skills/BASELINE.md`, `skills/imm-work/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `docs/solutions/single-step-orchestration-entry.md`, `docs/solutions/opt-in-bounded-autowork-entry.md`, `docs/solutions/advisory-roundtable-layer.md`, `docs/solutions/workflow-skill-orchestration-contract.md`, and representative upstream materials under `upstreams/BMAD-METHOD` and `upstreams/get-shit-done`. Conclusion: the repo already has most of the right boundaries, but the repo-facing contract still mixes fixed-stage workflow language with newer trigger-based orchestration truths.
- Decisions: D1 choose `Hold Scope` and keep this slice on contract alignment only, not runtime dispatcher or state-machine changes; D2 preserve hard boundaries around advisory roles, active-step execution, QA evidence, and opt-in autowork; D3 rewrite stage language so `brainstorm`, `preplan`, `planner`, `party`, and reviewer skills are state-triggered capabilities rather than default ceremony; D4 keep `imm-work` as the validated-plan default continue entry and preserve `imm-executor` / `imm-qa` as authority roles; D5 require focused contract verification instead of pretending to prove new runtime behavior that this slice does not implement.
- Assumptions: Existing repo-facing docs and skill contracts are the correct first source of truth to repair; the current runtime behavior is close enough that contract tightening can precede implementation follow-up; if contract truth exposes runtime mismatch, that mismatch should be handled by a later implementation slice rather than folded into this one.
- Review follow-up:
  - origin_review: `imm-code-review`
  - recommended_route: `direct_fix` as a same-boundary follow-up candidate; planner-owned append eligibility is proven because this plan remains the current runtime plan, the findings stay inside the same repo-facing contract goal, and the verification surface remains doc/skill/test alignment.
  - follow_up_summary: align canonical mainline wording so `imm-party` and sidecar review paths are no longer represented as default stages, then add a focused cross-document regression that guards the composable contract against this drift.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/composable-workflow-contract.spec.md`, `IMMUNE.md`, `README.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-party/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: repo-facing workflow artifacts clearly distinguish hard boundaries from soft trigger-based stages, keep `imm-work` as the post-plan continue entry, and keep advisory/reviewer layers bounded and non-default
      - method: spec + doc + skill contract alignment, focused regression in `tests/test_skill_contracts.py`, and truthful manual inspection where runtime behavior is outside this slice
  - blockers: none, as long as the slice does not expand into runtime dispatcher, shared registry, or state-schema changes
  - replan_condition: if truthful alignment requires `.imm` runtime behavior changes, new state fields, or default multi-step automation semantics, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: The repo has one dedicated spec for the composable workflow contract
- Verification: `.imm/specs/composable-workflow-contract.spec.md` exists and defines hard-boundary preservation, trigger-based stage composition, attachable advisory layers, stop conditions, and non-goals that exclude runtime orchestration work.
- Test scenarios: Covers hard-boundary preservation; Covers trigger-based stage composition; Covers runtime-orchestration non-goals
- Depends on: none
- Scope: `.imm/specs/composable-workflow-contract.spec.md`
- Replan condition: If the contract cannot be stated without changing authority roles or inventing a runtime dispatcher, stop and return to preplan.

### Step 2
- Step ID: U2
- Result: Repo-facing workflow docs describe a composable mainline instead of default stage ceremony
- Verification: `IMMUNE.md` and `README.md` explain that hard boundaries remain fixed while soft stages are triggered by state, and they preserve `imm-work` as the validated-plan default continue entry plus `imm-autowork` as explicit opt-in.
- Test scenarios: Covers hard-vs-soft workflow distinction; Covers `imm-work` continue-entry preservation; Covers `imm-autowork` opt-in preservation
- Depends on: 1
- Scope: `IMMUNE.md`, `README.md`
- Replan condition: If doc alignment requires broader product positioning or runtime promises beyond current verified behavior, keep this slice narrow and replan the broader rewrite separately.

### Step 3
- Step ID: U3
- Result: Mainline workflow skill contracts align to the composable model
- Verification: `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, and `skills/imm-work/SKILL.md` consistently describe trigger conditions, current-step orchestration, and routing without implying ceremonial default stages.
- Test scenarios: Covers framing trigger conditions; Covers preplan conditionality; Covers post-plan current-step driver contract
- Depends on: 2
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`
- Replan condition: If mainline alignment requires merging coordinator/executor/qa roles or altering active-step semantics, stop and return to preplan.

### Step 4
- Step ID: U4
- Result: `imm-party` is documented as an attachable advisory layer rather than a default workflow stage
- Verification: `skills/imm-party/SKILL.md` clearly describes bounded, non-default, trigger-based participation that supplements but does not replace planner/work authority.
- Test scenarios: Covers advisory-only party posture; Covers non-default attachable-layer wording
- Depends on: 3
- Scope: `skills/imm-party/SKILL.md`
- Replan condition: If party alignment requires durable advisory state, shared delegation infrastructure, or authority expansion, stop and return to preplan.

### Step 5
- Step ID: U5
- Result: Reviewer family contracts share one bounded non-default posture
- Verification: `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, and `skills/api-contract-reviewer/SKILL.md` clearly describe bounded, non-default, trigger-based participation that supplements but does not replace planner/work authority.
- Test scenarios: Covers broad-vs-conditional reviewer distinction; Covers non-default reviewer posture; Covers trigger-based reviewer wording
- Depends on: 4
- Scope: `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`
- Replan condition: If alignment requires a shared reviewer platform, automatic fan-out, or new delegation infrastructure, stop and return to preplan.

### Step 6
- Step ID: U6
- Result: Focused verification guards the composable workflow contract against drift
- Verification: `tests/test_skill_contracts.py` or equivalent focused checks prove that hard boundaries remain explicit, `imm-preplan-review` remains conditional, `imm-work` remains the post-plan default continue entry, advisory/reviewer layers remain bounded and non-default, and `imm-autowork` remains opt-in.
- Test scenarios: Covers no-default-preplan ceremony; Covers `imm-work` default continue entry; Covers advisory/reviewer non-default posture; Covers `imm-autowork` explicit opt-in
- Depends on: 5
- Scope: `tests/test_skill_contracts.py` and only supporting contract wording needed for traceability
- Replan condition: If truthful verification requires new runtime harness behavior or provider-specific orchestration support, keep this slice contract-level and replan broader execution verification separately.

### Step 7
- Step ID: U7
- Result: Canonical composable mainline wording is consistent across repo-facing workflow contracts
- Verification: `IMMUNE.md`, `README.md`, and the affected skill contracts no longer describe `imm-party` or sidecar review paths as default stages inside the canonical mainline, while preserving `imm-work` as the validated-plan default continue entry and keeping attachable layers trigger-based.
- Test scenarios: Covers `imm-party` staying outside the default mainline; Covers sidecar review paths staying non-default; Covers `imm-work` continue-entry preservation after wording repair
- Depends on: 6
- Scope: `IMMUNE.md`, `README.md`, `skills/imm-party/SKILL.md`, `skills/imm-code-review/SKILL.md`
- Replan condition: If fixing the wording exposes a need to change runtime orchestration behavior or widen the contract beyond repo-facing truth, stop and return to preplan.

### Step 8
- Step ID: U8
- Result: Focused regression guards the canonical-mainline-versus-attachable-layer distinction
- Verification: `tests/test_skill_contracts.py` asserts cross-document consistency for the canonical composable mainline and verifies that `imm-party` plus sidecar reviewer paths stay attachable and non-default instead of reappearing as default stages.
- Test scenarios: Covers IMMUNE-vs-README mainline consistency; Covers `imm-party` non-default posture; Covers sidecar review paths staying outside the canonical mainline
- Depends on: 7
- Scope: `tests/test_skill_contracts.py`
- Replan condition: If guarding the new distinction requires runtime harness behavior or state-machine checks beyond focused contract assertions, keep the fix contract-level and replan broader execution verification separately.

## Notes
- This slice changes repo-facing contract truth, not the execution engine.
- The intended end state is composition-first but boundary-hard: fewer ceremonial stages, no weaker authority separation.
- If contract alignment surfaces runtime mismatch, capture that as a separate follow-up rather than folding implementation work into this plan.
- This plan was append-extended after `imm-code-review` findings because it is still the current runtime plan and the follow-up remains inside the same repo-facing contract boundary. Existing completed-step history must stay intact.
