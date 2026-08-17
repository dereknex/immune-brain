---
title: "feat: add autowork runtime host"
type: feat
status: proposed
date: 2026-05-25
---

# Iteration Plan

## Task
- Summary: Turn `imm-autowork` into a real host-bound runtime surface that keeps the autowork loop moving through `activate`, `executor`, and `qa` phases instead of stopping at the QA boundary reminder.
- Origin: User reported that autowork stopped with “进入 `imm-qa` 权限边界，imm-autowork 到这里应停”, while the intended contract is to keep driving QA and continue to the next Step.
- Spec: docs/specs/autowork-runtime-host.spec.md
- Research: `CONTEXT.md` defines Step, Plan, QA, State Ledger, and plugin-local runtime vocabulary. `docs/specs/bounded-autowork-skill.spec.md` and `docs/specs/autowork-workflow-refinement.spec.md` already define explicit opt-in autowork plus `can_auto_advance`, but `docs/specs/autowork-runtime-host.spec.md` identifies the remaining gap: no real runtime host consumes the signal across the QA boundary. `docs/solutions/opt-in-bounded-autowork-entry.md` explicitly warns that contract prose is not execution truth. `docs/solutions/shared-runtime-host-before-platform.md` and `docs/solutions/rejected-shared-registry-generic-dispatcher.md` together constrain this slice to a single host-bound runtime path instead of platform expansion.
- Decisions:
    - D1: Promote only `imm-autowork` to a real shared workflow host; do not broaden `imm-work` or introduce a shared dispatcher.
    - D2: Treat `next_action.action == "qa"` with `can_auto_advance: true` as same-run continuation, not as a stop condition.
    - D3: Keep QA closure on the existing `imm-review` / `imm-qa` authority path; runtime hosting must not fabricate pass decisions.
    - D4: Require focused regression for ordinary Step loops, pending `follow_up`, plugin runtime exposure, and no-platform-expansion boundaries before calling this slice done.
- Assumptions:
    - Existing `.imm/imm-work.py` and `.imm/imm-review.py` already contain enough state and authority primitives to host a bounded autowork runtime without inventing a new workflow state store.
    - The plugin runtime surface can expose autowork without breaking the current plugin packaging contract.
- Scope Mode: Three-step shared runtime host upgrade, single host only
- Engineering Closure Check:
  - architecture_surface: `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm_core/current_iteration_state.py`, new `.imm/imm-autowork.py`, `plugins/immune-brain/dist/immune_brain_runtime.py`, `plugins/immune-brain/skills/imm-autowork/SKILL.md`, `tests/test_workflow_loop.py`, new `tests/test_imm_autowork.py`, `tests/test_immune_brain_mcp_runtime.py`, `tests/test_skill_contracts.py`
  - dependencies_known: yes
  - verification_path: focused unit and contract regressions plus Codex manual validation path documented in the Spec
  - blockers: previous completed plan in `HANDOFF.md` still has pending `imm-compounder`, so this new plan should be validated first and synced only when execution is explicitly chosen
  - replan_condition: If making autowork host-bound requires a shared registry, background scheduler, multi-active-step model, or QA authority expansion
- Devil's Advocate Audit:
- rollback_resilience: The runtime-host slice can be rolled back by removing the new autowork helper/tool surface and restoring skill-only orchestration, leaving `imm-work` and `imm-review` as the unchanged authority primitives.
  - verification_vanity: Passing only `imm-work status` tests would be vanity; the regression must show that autowork does not stop at `qa`, that QA `pass` advances to the next Step, and that no-platform-expansion guards remain explicit.
  - spec_dilution_detection: The plan addresses the real gap of missing runtime truth, not just a wording tweak in `imm-autowork` prose; it explicitly includes plugin exposure and regression guards so “long-term solution” does not silently collapse back into prompt editing.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-autowork` has a real runtime host for ordinary validated Step loops
- Verification type: automated
- Execution note: test-first
- Verification: `python3 -m unittest tests.test_imm_autowork tests.test_workflow_loop`
- Test scenarios: Covers no-plan routing back to `imm-planner`; Covers an ordinary activate to executor to qa loop staying in one run; Covers `qa` with `can_auto_advance: true` continuing instead of stopping; Covers QA `pass` unlocking and entering the next Step; Covers `rework`, `replan`, and `budget_reached` as distinct stop reasons.
- Discovery cache: .imm/imm-work.py (`next_action`, `can_auto_advance`, `continue_current_step`); .imm/imm-review.py (QA closure primitive); .imm/imm_core/current_iteration_state.py (State Ledger transitions); tests/test_workflow_loop.py (existing loop assertions); docs/specs/autowork-runtime-host.spec.md (runtime host acceptance)
- Agent Hint: imm-executor
- failure_behavior: If the new host cannot cross QA without inventing new hidden state, stop and keep the helper read-only rather than merging authority or bypassing evidence.
- security_considerations: The runtime host must not create hidden pass paths or activate work from an unsynced or invalid plan.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Plugin runtime exposes the autowork runtime host
- Verification type: automated
- Execution note: test-first
- Verification: `python3 -m unittest tests.test_imm_autowork tests.test_immune_brain_mcp_runtime tests.test_skill_contracts`
- Test scenarios: Covers plugin runtime exposing the new autowork surface; Covers skill/runtime docs stating single-host truth; Covers runtime entry remaining host-bound instead of becoming a generic workflow dispatcher.
- Discovery cache: plugins/immune-brain/dist/immune_brain_runtime.py (tool exposure); plugins/immune-brain/skills/imm-autowork/SKILL.md (host contract wording); tests/test_immune_brain_mcp_runtime.py (runtime tool mapping); tests/test_skill_contracts.py (boundary drift guard); docs/solutions/shared-runtime-host-before-platform.md (host-before-platform constraint)
- Agent Hint: imm-executor
- failure_behavior: If plugin exposure requires changing unrelated host runtimes or introducing a generic dispatcher, stop and return to planner with the scope expansion evidence.
- security_considerations: Host exposure must not let autowork mutate workflow state outside the existing validated-plan and QA authority boundaries.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Autowork follow-up completion remains bounded
- Verification type: automated
- Execution note: test-first
- Verification: `python3 -m unittest tests.test_imm_autowork tests.test_skill_contracts`
- Test scenarios: Covers completed Plan plus pending reviewer `follow_up` continuing through autowork until QA or safe stop; Covers explicit absence of shared registry, generic dispatcher, background scheduler, and multi-active-step semantics; Covers completed follow-up not being reported as finished before QA closure.
- Discovery cache: docs/specs/autowork-followup-completion.spec.md (follow-up target contract); docs/solutions/rejected-shared-registry-generic-dispatcher.md (rejected platform boundary); plugins/immune-brain/skills/imm-autowork/SKILL.md (follow-up workflow guard); tests/test_skill_contracts.py (no-platform-expansion drift guard)
- Agent Hint: imm-executor
- failure_behavior: If follow-up completion requires a new queue, persistent background state, or multi-host runtime abstraction, stop and replan instead of widening the host.
- security_considerations: Pending `follow_up` must remain a bounded execution artifact and must not become a hidden route for scope expansion or bypassed QA.
- Depends on: 2

## Notes
- Validate this plan before any execution handoff.
- Do not sync this plan into `.imm/memory/current_iteration.json` until the pending previous-plan `imm-compounder` decision is consciously superseded.
