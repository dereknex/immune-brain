---
title: "feat: wire planning quality gate into planner"
type: feat
status: proposed
date: 2026-05-26
origin: user requested implementation path for the completed planning quality gate
---

# Iteration Plan

## Task
- Summary: Wire the Planning Quality Gate into the planner contract so elevated-risk plans consistently check design readiness.
- Origin: User asked how to push the Planning Quality Gate from documentation into implementation, then invoked `imm-planner`.
- Spec: docs/specs/planning-quality-gate-planner-contract.spec.md
- Research: `docs/specs/detailed-design-hardening-master.spec.md` defines the guidance-level Planning Quality Gate; `docs/specs/detailed-design-hardening-phase1.spec.md` keeps Phase 1 documentation-only; `plugins/immune-brain/dist/imm-planner.md` is the compiled planner contract; `tests/test_skill_contracts.py` is the focused contract regression surface.
- Decisions:
    - D1: Implement planner-contract adoption before validator enforcement.
    - D2: Extract a reusable checklist under `docs/reference/` so planner wording can stay concise.
    - D3: Add contract tests that require risk-triggered gate use without making it global ceremony.
- Assumptions:
    - Updating the compiled planner contract and tests is sufficient for this slice; source packaging drift can be handled by existing skill packaging workflows if needed.
- Scope Mode: Planner contract wiring slice.
- Engineering Closure Check:
  - architecture_surface: `docs/reference/planning-quality-gate.md`, `plugins/immune-brain/dist/imm-planner.md`, `tests/test_skill_contracts.py`
  - dependencies_known: yes; focused unittest coverage already exists
  - verification_path: `python3 -m unittest tests.test_skill_contracts` plus plan validation
  - blockers: none
  - replan_condition: if implementation requires runtime parser enforcement or a packaging generation step outside this contract slice

## Devil's Advocate Audit

### 1. Rollback Resilience
- Risk: Tightening planner wording could make ordinary small plans feel heavier.
- Recovery: The change is isolated to a reference checklist, planner contract text, and contract tests. Reverting those files restores the prior planner behavior without runtime migration.

### 2. Verification Vanity
- Risk: A test that only checks for the phrase "Planning Quality Gate" would not prove the planner keeps the gate risk-triggered and non-global.
- Mitigation: Contract tests must assert both sides: the planner references elevated-risk triggers and also says the gate is not mandatory ceremony for every plan.

### 3. Spec Dilution Detection
- Risk: The implementation could narrow the gate to only "better verification" and omit compatibility, rollback, or interruption recovery.
- Mitigation: The checklist and contract tests must include all six accepted checks from the spec.

## Steps

### Step 1
- Step ID: U1
- Result: Planning quality gate checklist exists
- Verification type: automated
- Verification: `python3 -c "from pathlib import Path; text = Path('docs/reference/planning-quality-gate.md').read_text(); required = ['contract surface', 'compatibility', 'interruption recovery', 'rollback path', 'verification strength', 'Brainstorm traceability']; missing = [item for item in required if item not in text]; assert not missing, missing; assert 'not mandatory ceremony' in text"`
- Test scenarios: Confirm the reusable checklist captures the accepted gate checks and explicitly prevents mandatory planning ceremony.
- Discovery cache: docs/specs/planning-quality-gate-planner-contract.spec.md (accepted contract); docs/specs/detailed-design-hardening-master.spec.md (quality gate source); docs/reference/ (reference docs location)
- Agent Hint: imm-executor
- failure_behavior: Keep planner contract unchanged until the checklist has the complete gate surface.
- security_considerations: None; this step adds planning guidance documentation only.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Planner contract references quality gate
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-05-26-010-feat-planning-quality-gate-planner-contract-plan.md --json`
- Test scenarios: Confirm `imm-planner` references the checklist for elevated-risk plans, preserves small-plan flow, and tests prevent omission of compatibility, rollback, interruption recovery, verification strength, and Brainstorm traceability.
- Discovery cache: plugins/immune-brain/dist/imm-planner.md (compiled planner contract); tests/test_skill_contracts.py (contract regression surface); docs/reference/planning-quality-gate.md (planner checklist)
- Agent Hint: imm-executor
- failure_behavior: Revert planner contract and test changes together if the contract becomes globally mandatory or tests are too shallow.
- security_considerations: None; this step changes planning contract text and tests only.
- Depends on: 1

## Notes
- This plan intentionally does not enforce the gate in `.imm/imm_core/plan_runtime.py`.
- A later enforcement slice can add validator rules after planner adoption proves the gate language is stable.
