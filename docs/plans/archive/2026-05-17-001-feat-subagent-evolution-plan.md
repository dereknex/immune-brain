---
title: feat: subagent evolution - durable evidence and specialized execution
type: feat
status: planned
date: 2026-05-17
origin: 2026-05-17 brainstorm analysis of subagent status
---

# Iteration Plan

## Task
- Summary: Extend the subagent architecture to support durable evidence persistence in the state ledger, introduce the first execution-bound subagent (test-fixer), and optimize dispatch efficiency via context sharding.
- Origin: Brainstorm framing (2026-05-17) identified capability silos and evidence volatility as the primary bottlenecks for the current subagent implementation.
- Spec: docs/specs/archive/subagent-evolution.spec.md
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-REQ-3; BR-DEC-1; BR-OUT-1
- Research: Checked `imm_core/current_iteration_state.py` for v2 schema extensibility, `subagent-dispatch-protocol.md` for sharding hooks, and `skills/registry.yaml` for authority classes.
- Decisions: D1 Extend v2 ledger schema to include `child_evidence`; D2 Introduce `test-fixer` as the first `active-step-bounded-executor`; D3 Implement context sharding in the delegation packet layer to minimize token waste.
- Assumptions: The existing host-driven dispatch primitive (Cursor Task / Codex spawn_agent) is sufficient for bounded execution; child evidence is useful for QA closure even if not merged into the host's summary.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/memory/current_iteration.json`, `imm_core/current_iteration_state.py`, `skills/test-fixer/SKILL.md`, `docs/reference/subagent-dispatch-protocol.md`
  - dependencies_known: true
  - verification_path:
      - target: Subagents can persist durable evidence and perform bounded file edits within an active step.
      - method: Unit tests for state persistence, contract tests for the new executor skill, and trace assertions for packet sharding.
  - blockers: none
  - replan_condition: If subagent execution requires bypassing `imm-work` or modifying the plan directly, stop and replan.

## Brainstorm Trace
| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-1 | covered_by_step | U1 | Ledger update for durable child evidence. |
| BR-REQ-2 | covered_by_step | U3 | New test-fixer skill for bounded execution. |
| BR-REQ-3 | covered_by_step | U2 | Context sharding in dispatch protocol. |
| BR-DEC-1 | captured_as_decision | D1 | Schema v2 remains the authority. |
| BR-OUT-1 | out_of_scope | Non-Goals | No cross-session private subagent memory. |

## Steps

### Step 1
- Step ID: U1
- Result: The state ledger supports durable `child_evidence` persistence.
- Verification: `python3 -m unittest tests.test_current_iteration_state` asserts that `child_evidence` is correctly saved, loaded, and preserved during step transitions.
- Discovery cache: .imm/imm_core/current_iteration_state.py (Schema update); .imm/imm_core/state_machine.py (Transition logic)
- Test scenarios: Persistence of child evidence; Schema v2 backward compatibility

### Step 2
- Step ID: U2
- Result: Dispatch hosts implement context sharding in delegation packets.
- Verification: `python3 -m unittest tests.test_imm_review` (or host-specific tests) verifies that the generated `focus_delta` contains only relevant file fragments instead of full context.
- Discovery cache: docs/reference/subagent-dispatch-protocol.md (Protocol definition); skills/imm-code-review/SKILL.md (Host implementation)
- Test scenarios: Token-optimized delegation packet; Precise file-level sharding

### Step 3
- Step ID: U3
- Result: A new `test-fixer` skill provides bounded execution capabilities.
- Verification: `python3 -m unittest tests.test_skill_contracts` confirms the `test-fixer` skill exists, has `active-step-bounded-executor` authority, and respects its write boundary.
- Discovery cache: skills/registry.yaml (Registration); tests/test_skill_contracts.py (Contract verification)
- Test scenarios: Bounded executor authority validation; Write boundary enforcement
- Depends on: 1
