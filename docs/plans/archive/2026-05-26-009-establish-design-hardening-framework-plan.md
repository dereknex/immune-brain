---
title: "feat: establish planning quality gate"
type: feat
status: proposed
date: 2026-05-26
origin: BR-REQ-1, BR-REQ-2
---

# Iteration Plan

## Task
- Summary: Establish a repository-compatible Planning Quality Gate for elevated-risk Immune-Brain work.
- Origin: User requested a better design-hardening approach after review showed the previous Master-Phase proposal conflicted with `IMMUNE.md` and failed the existing plan validator.
- Spec: docs/specs/detailed-design-hardening-phase1.spec.md
- Research: `IMMUNE.md` keeps `imm-preplan-review` optional and defines `.imm/memory/current_iteration.json` as the runtime continuity surface; `CONTEXT.md` defines Plan, Spec, Step, and HANDOFF.md vocabulary; `.imm/imm_core/plan_runtime.py` requires `Discovery cache` entries in `path (reason)` format.
- Decisions:
    - D1: Treat detailed-design hardening as a Planning Quality Gate, not a replacement workflow.
    - D2: Keep Phase 1 documentation-only and compatible with the current plan validator.
    - D3: Require future enforcement work to update validator or contract tests in the same plan.
- Assumptions:
    - Guidance-level hardening is useful immediately, while stronger enforcement should wait until parser or skill contract changes are intentionally planned.
- Scope Mode: Documentation-only planning quality gate.
- Engineering Closure Check:
  - architecture_surface: `docs/specs/detailed-design-hardening-master.spec.md`, `docs/specs/detailed-design-hardening-phase1.spec.md`, `docs/plans/2026-05-26-009-establish-design-hardening-framework-plan.md`
  - dependencies_known: yes; validation uses the existing `.imm/imm-plan.py` parser
  - verification_path: `python3 .imm/imm-plan.py docs/plans/2026-05-26-009-establish-design-hardening-framework-plan.md --json`
  - blockers: none
  - replan_condition: if documentation-only guidance proves insufficient and runtime enforcement is required
- Brainstorm manifest: BR-REQ-1, BR-REQ-2, BR-DEC-1, BR-DEC-2, BR-OUT-1, BR-Q-1

## Brainstorm Manifest
| ID | Item |
| ---- | ---- |
| BR-REQ-1 | Align terminology and design guidance with `IMMUNE.md` and `CONTEXT.md`. |
| BR-REQ-2 | Establish a durable planning quality reference for elevated-risk work. |
| BR-DEC-1 | Use Planning Quality Gate language instead of mandatory Master-Phase workflow language. |
| BR-DEC-2 | Keep Phase 1 compatible with the existing plan validator. |
| BR-OUT-1 | Do not change runtime parser or compiled skill contracts in this documentation-only phase. |
| BR-Q-1 | Future strict enforcement requires validator or contract-test changes in the same plan. |

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-1 | covered_by_step | U1 | Specs must preserve repository vocabulary and workflow boundaries. |
| BR-REQ-2 | covered_by_step | U1 | The Master spec defines the reusable quality gate reference. |
| BR-DEC-1 | captured_as_decision | U1 | The updated specs remove mandatory Master-Phase workflow requirements. |
| BR-DEC-2 | covered_by_step | U2 | Plan validation proves compatibility with the existing parser. |
| BR-OUT-1 | out_of_scope | BR-OUT-1 | This phase deliberately avoids runtime and compiled contract edits. |
| BR-Q-1 | resolved_as_assumption | U1 | Enforcement is deferred until a future plan includes parser or contract-test changes. |

## Risk Review

### Workflow Drift
- Risk: A design hardening document could silently override `IMMUNE.md`.
- Mitigation: The Master spec explicitly keeps `IMMUNE.md` and `CONTEXT.md` terminology authoritative.

### Validation Vanity
- Risk: Checking only that files exist would not prove the plan can run through Immune-Brain.
- Mitigation: Step 2 runs the existing plan validator and checks for the quality-gate wording that corrected the earlier conflict.

### Enforcement Gap
- Risk: Documentation guidance may be mistaken for automatic enforcement.
- Mitigation: Phase 1 states that future enforcement must update validator or contract-test surfaces in the same plan.

## Steps

### Step 1
- Step ID: U1
- Result: Planning Quality Gate reference established
- Verification type: automated
- Verification: `test -f docs/specs/detailed-design-hardening-master.spec.md && test -f docs/specs/detailed-design-hardening-phase1.spec.md && rg -q "Planning Quality Gate" docs/specs/detailed-design-hardening-master.spec.md && rg -q "does not introduce a new global workflow" docs/specs/detailed-design-hardening-master.spec.md && rg -q "documentation-only" docs/specs/detailed-design-hardening-phase1.spec.md && rg -q "existing plan validator" docs/specs/detailed-design-hardening-phase1.spec.md`
- Test scenarios: Confirm the specs describe guidance compatible with `IMMUNE.md`, avoid a mandatory Master-Phase workflow, and name existing validator-compatible fields.
- Discovery cache: docs/specs/detailed-design-hardening-master.spec.md (quality gate reference); docs/specs/detailed-design-hardening-phase1.spec.md (phase contract); IMMUNE.md (workflow authority); CONTEXT.md (terminology authority)
- Agent Hint: imm-executor
- failure_behavior: Rework the specs until they describe guidance rather than runtime enforcement.
- security_considerations: None; this step changes documentation only.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Plan validator evidence recorded
- Verification type: automated
- Verification: `python3 .imm/imm-plan.py docs/plans/2026-05-26-009-establish-design-hardening-framework-plan.md --json`
- Test scenarios: Confirm the 009 plan parses successfully, covers every Brainstorm manifest item, and uses valid `Discovery cache` syntax.
- Discovery cache: docs/plans/2026-05-26-009-establish-design-hardening-framework-plan.md (plan under validation); .imm/imm_core/plan_runtime.py (validator behavior)
- Agent Hint: imm-executor
- failure_behavior: Fix the plan syntax or Brainstorm Trace mapping before execution.
- security_considerations: None; this step validates documentation only.
- Depends on: 1

## Notes
- After validation, continue through `imm-work` if this plan should be executed.
- A later enforcement phase should explicitly include parser or skill contract changes plus regression tests.
