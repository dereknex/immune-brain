---
title: fix: align default subagent-first activation contract
type: fix
status: planned
date: 2026-05-10
origin: replan from the audit-only subagent activation slice after autowork proved the current plan shape could not close through the executor and QA lifecycle
---

# Iteration Plan

## Task
- Summary: Align the shared workflow and reviewer contracts to a default subagent-first strategy with explicit solo fallback, while preserving the existing workflow chain and authority boundaries.
- Origin: The user asked to check skill subagent activation strategy and make subagents the default path, with solo used only as fallback. The prior audit-only plan (`032`) stopped on `replan` because the current runtime cannot close a pure read-only audit step through `imm-executor` / `imm-qa`.
- Research: Checked `IMMUNE.md`, `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, `.imm/specs/skill-trigger-template-routing.spec.md`, `.imm/specs/workflow-skill-orchestration-review-followup.spec.md`, `docs/plans/2026-05-09-029-feat-workflow-skill-subagent-orchestration-plan.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, and `skills/api-contract-reviewer/SKILL.md`. Conclusion: the repo currently encodes conditional trigger / solo-first behavior on the shared surfaces; this conflicts with the user's requested default strategy.
- Decisions: D1 choose `Scope Reduction` and limit this slice to shared workflow / reviewer contracts plus focused verification; D2 supersede the audit-only shape with writable contract-alignment outcomes instead of patching no-op audit execution into runtime; D3 preserve the existing `imm-brainstorm -> imm-preplan-review -> imm-planner -> imm-work -> imm-executor/imm-qa -> imm-finish` chain and existing authority boundaries; D4 define solo as explicit fallback for non-decomposable, coupled, unsupported, or user-solo cases rather than as the default.
- Assumptions: The user wants repo-local contract truth changed first, not a new runtime scheduler; project-specific skills can continue to follow later once the shared workflow default is corrected; focused contract verification is sufficient for this slice.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/default-subagent-first-activation.spec.md`, `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, `.imm/specs/skill-trigger-template-routing.spec.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`, `README.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: shared workflow and reviewer docs consistently say subagent-first with explicit solo fallback, while preserving workflow and authority guards
      - method: focused contract assertions plus manual inspection of the updated shared docs
  - blockers: none, as long as the slice stays on shared contract truth and does not expand into runtime orchestration machinery
  - replan_condition: if alignment requires changing runtime state behavior, adding a scheduler, or rewriting project-specific skill families beyond the shared workflow surfaces, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: The shared `subagent-first` activation policy is documented as the default.
- Verification: `.imm/specs/default-subagent-first-activation.spec.md`, `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, and `.imm/specs/skill-trigger-template-routing.spec.md` all state that clearly decomposable work defaults to bounded subagents, and they enumerate the allowed solo fallback conditions without weakening the workflow chain.
- Test scenarios: Covers default-subagent-first truth; Covers explicit solo fallback conditions; Covers workflow-chain preservation
- Depends on: none
- Scope: `.imm/specs/default-subagent-first-activation.spec.md`, `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, `.imm/specs/skill-trigger-template-routing.spec.md`
- Replan condition: If the shared policy cannot be restated without inventing new runtime orchestration machinery, stop and return to preplan.

### Step 2
- Step ID: U2
- Result: Core workflow skill contracts align to the `subagent-first` default.
- Verification: `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, and any needed README wording consistently describe subagent-first when work is clearly splittable, plus explicit solo fallback when it is not.
- Test scenarios: Covers workflow-skill default activation wording; Covers `imm-work` continue-entry preservation
- Depends on: 1
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `README.md`
- Replan condition: If the wording changes imply widened authority, default dedicated-reviewer gates, or broader repo-wide skill rewrites, stop and return to planner.

### Step 3
- Step ID: U3
- Result: Dedicated reviewer skill contracts align to the `subagent-first` default.
- Verification: `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, and `skills/api-contract-reviewer/SKILL.md` describe subagent-first when work is clearly splittable while keeping dedicated reviewers bounded rather than default gates.
- Test scenarios: Covers broad-review baseline positioning; Covers dedicated-reviewer boundedness; Covers non-default dedicated reviewers
- Depends on: 2
- Scope: `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`
- Replan condition: If reviewer alignment requires turning dedicated reviewers into unconditional gates or rewriting their authority model, stop and return to planner.

### Step 4
- Step ID: U4
- Result: Focused regression guards the shared activation policy against drifting back to solo-first wording.
- Verification: `tests/test_skill_contracts.py` proves that the shared docs express subagent-first by default, solo only as fallback, `imm-work` remains the post-plan continue entry, and dedicated reviewers stay bounded rather than default gates.
- Test scenarios: Covers shared-policy truth; Covers solo-fallback truth; Covers continue-entry preservation; Covers non-default dedicated reviewers
- Depends on: 3
- Scope: `tests/test_skill_contracts.py` and only supporting wording needed for traceability in shared docs
- Replan condition: If truthful verification requires runtime orchestration tests or new test harness machinery, keep this slice contract-level and replan broader execution support separately.

## Notes
- `032` remains the traceable failed audit-only slice; this plan is the executable follow-up that repairs the shared contract truth directly.
- The goal is not “always spawn subagents no matter what”; the goal is “prefer subagents when the work is clearly decomposable, otherwise fall back to solo explicitly and intentionally.”
