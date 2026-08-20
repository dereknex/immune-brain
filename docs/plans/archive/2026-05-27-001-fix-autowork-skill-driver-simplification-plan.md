---
title: "fix: simplify autowork host loop"
type: fix
status: proposed
date: 2026-05-27
origin: BR-REQ-1, BR-REQ-2, BR-REQ-3, BR-REQ-4, BR-REQ-5, BR-DEC-1, BR-DEC-2, BR-DEC-3, BR-OUT-1, BR-Q-1, BR-Q-2
---

# Iteration Plan

## Task
- Summary: Clarify the existing `imm-autowork` entrypoint so it can continue through executor and QA boundaries without adding a new skill or driver surface.
- Origin: Brainstorm concluded that the runtime is a deterministic checkpoint consumer, while the missing piece is host-side orchestration. User then narrowed the direction: avoid complexity and avoid adding a new skill.
- Spec: docs/specs/archive/autowork-skill-driver-simplification.spec.md
- Research: `CONTEXT.md` identifies `.imm/imm-autowork.py`, `.imm/imm-work.py`, `.imm/imm-review.py`, plugin-local runtime, skills, and tests as the workflow contract surface. `docs/specs/archive/autowork-runtime-host.spec.md` and `docs/solutions/workflow.md` describe the prior runtime-host slice. `docs/solutions/machine-readable-autowork-advance-gate.md` says richer stop reasons should stay structured rather than prose-parsed. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` confirms that a generic dispatcher is a rejected expansion. Existing `tests/test_imm_autowork.py` already covers queue-driven pass, rework, replan, budget, and follow-up paths, but ordinary queue-missing boundaries still collapse to `blocked`.
- Decisions:
    - D1: Keep `imm-autowork` as the single user-facing entrypoint.
    - D2: Do not create `imm-autowork-driver` or another MCP tool.
    - D3: Treat `imm-autowork.py` as a deterministic checkpoint runtime.
    - D4: Put host-side executor and QA loop rules in the existing `imm-autowork` skill contract.
    - D5: Preserve `imm-qa` authority by forbidding runtime default-pass behavior.
- Assumptions:
    - Existing queue-based callers should keep working if new stop reasons are additive and hard blockers still use `blocked`.
    - The host can execute existing `imm-executor` and `imm-qa` semantics from the current skill system without a new skill.
- Scope Mode: One-step simplification slice.
- Engineering Closure Check:
  - architecture_surface: `.imm/imm-autowork.py`, `plugins/immune-brain/dist/.imm/imm-autowork.py`, `skills/imm-autowork/SKILL.md`, `plugins/immune-brain/skills/imm-autowork/SKILL.md`, `plugins/immune-brain/dist/imm-autowork.md`, `tests/test_imm_autowork.py`, `tests/test_skill_contracts.py`
  - compatibility: existing queue-based `run_autowork` callers remain supported; new stop reasons are additive for ordinary awaiting states
  - interruption_recovery: if execution stops after runtime changes but before skill text changes, existing queue-driven behavior still works and missing queues report more specific machine-readable boundaries
  - rollback_path: revert the runtime snapshot changes, skill contract wording, and focused tests as one coherent slice
  - verification_path: `python3 -m unittest tests.test_imm_autowork tests.test_skill_contracts` plus `python3 .imm/imm-plan.py docs/plans/2026-05-27-001-fix-autowork-skill-driver-simplification-plan.md --json`
  - blockers: none
  - replan_condition: if the host loop cannot be expressed through existing `imm-autowork`, `imm-executor`, `imm-qa`, and `imm-review` contracts
- Brainstorm manifest: BR-REQ-1, BR-REQ-2, BR-REQ-3, BR-REQ-4, BR-REQ-5, BR-DEC-1, BR-DEC-2, BR-DEC-3, BR-OUT-1, BR-Q-1, BR-Q-2

## Brainstorm Manifest
| ID | Item |
| ---- | ---- |
| BR-REQ-1 | Keep the Python runtime deterministic and outside LLM judgment. |
| BR-REQ-2 | Preserve independent QA authority. |
| BR-REQ-3 | Replace ambiguous ordinary `blocked` stops with explicit awaiting states. |
| BR-REQ-4 | Return the minimum host handoff context in the runtime snapshot. |
| BR-REQ-5 | Add focused regression coverage for pass, rework, replan, done, and follow-up handoff behavior. |
| BR-DEC-1 | The root issue is missing host-side orchestration clarity. |
| BR-DEC-2 | Do not use default QA pass as the fix. |
| BR-DEC-3 | Documentation must distinguish checkpoint runtime from host loop behavior. |
| BR-OUT-1 | Do not change the `imm-qa` review standard. |
| BR-Q-1 | User resolved this by choosing no new skill or extra driver surface. |
| BR-Q-2 | User resolved this by keeping the host loop in the existing `imm-autowork` entrypoint. |

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-1 | covered_by_step | U1 | Runtime changes are limited to deterministic checkpoint output. |
| BR-REQ-2 | covered_by_step | U1 | QA decisions still flow through `imm-qa` and `imm-review`. |
| BR-REQ-3 | covered_by_step | U1 | Focused tests cover explicit execution and QA awaiting states. |
| BR-REQ-4 | covered_by_step | U1 | Snapshot context is part of the planned runtime contract. |
| BR-REQ-5 | covered_by_step | U1 | Regression command covers pass, rework, replan, done, and follow-up paths. |
| BR-DEC-1 | captured_as_decision | U1 | The plan targets orchestration clarity rather than Plan content. |
| BR-DEC-2 | covered_by_step | U1 | Tests must reject runtime default-pass behavior. |
| BR-DEC-3 | covered_by_step | U1 | Skill contract wording is part of the same outcome. |
| BR-OUT-1 | out_of_scope | BR-OUT-1 | This slice preserves the current QA standard. |
| BR-Q-1 | resolved_as_assumption | U1 | User asked to avoid new skills. |
| BR-Q-2 | resolved_as_assumption | U1 | User asked for the simplified existing-entrypoint approach. |

## Devil's Advocate Audit
- rollback_resilience: The slice is rollbackable by reverting the runtime snapshot changes, skill contract wording, and focused tests together. It does not require migration of existing plans or State Ledger files.
- verification_vanity: Testing only string presence would be weak. The main verification must run `tests.test_imm_autowork` to prove the new awaiting stop reasons and continued queue-driven QA behavior.
- spec_dilution_detection: The plan keeps the user-requested simplification explicit: no new skill, no new tool, no default QA pass, and no dispatcher expansion.

## Steps

### Step 1
- Step ID: U1
- Result: Simplified autowork contract is validated
- Verification type: automated
- Execution note: test-first
- Verification: `python3 -m unittest tests.test_imm_autowork tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-05-27-001-fix-autowork-skill-driver-simplification-plan.md --json`
- Test scenarios: Covers missing execution input returning `awaiting_execution_input`; Covers missing QA input returning `awaiting_qa_decision`; Covers snapshot handoff context for active Step verification evidence and recommended authority; Covers QA pass continuing through `imm-review`; Covers rework replan budget done and follow-up stop behavior; Covers skill contract rejecting a new driver skill or default QA pass.
- Discovery cache: .imm/imm-autowork.py (checkpoint runtime); plugins/immune-brain/dist/.imm/imm-autowork.py (packaged checkpoint runtime); skills/imm-autowork/SKILL.md (host loop contract); plugins/immune-brain/dist/imm-autowork.md (packaged skill contract); tests/test_imm_autowork.py (autowork regression surface); tests/test_skill_contracts.py (skill boundary assertions)
- Agent Hint: imm-executor
- failure_behavior: If preserving the existing entrypoint cannot support the host loop clearly, stop and return to planner with the specific contract gap.
- security_considerations: The runtime must not turn executor verification into QA approval or create hidden state mutation paths.
- Depends on: none

## Notes
- This plan intentionally supersedes the earlier instinct to add a separate `imm_autowork_driver` surface.
- Validate and sync this plan before implementation handoff.
