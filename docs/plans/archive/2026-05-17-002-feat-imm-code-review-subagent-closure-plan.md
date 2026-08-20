---
title: "feat: finish imm-code-review subagents"
type: feat
status: planned
date: 2026-05-17
origin: user request under imm-planner
---

# Iteration Plan

## Task
- Summary: Finish the imm-code-review subagent path with host-facing invocation envelopes, child outcome collection, and contract regression coverage.
- Origin: User requested a plan to push imm-code-review subagents to completion after brainstorm discussion of shared registry constraints.
- Spec: docs/specs/archive/imm-code-review-subagent-closure.spec.md
- Research: CONTEXT.md defines Activation Plan, Delegation Packet, and State Ledger child_evidence as the relevant vocabulary. `.imm/imm_core/activation_plan.py` already builds host-bound activation output. `.imm/imm_core/delegation_packet.py` already shards packets per lens. `skills/imm-code-review/SKILL.md` requires activation before packet construction but still leaves actual child invocation and collection as host behavior. `docs/solutions/subagent-execution-truth-protocol.md` records the current gap as refining actual execution and output collection. `docs/reference/subagent-remaining-work.md` keeps shared registry and scheduler deferred.
- Decisions: D1 keep this slice host-bound to imm-code-review. D2 allow host-facing helpers for invocation envelopes and result collection. D3 do not implement shared runtime registry or generic dispatcher. D4 keep advisory child authority unchanged. D5 use tested fake runtime callables for automated verification because provider tools cannot be invoked from repo unit tests. D6 U1 uses default pragmatic execution after QA found missing test-first evidence; do not backfill fake RED evidence after implementation.
- Assumptions: A pure helper can compile runtime invocation envelopes while the Codex or Cursor host still owns the actual tool call. `imm-ui-review` parity is deferred until the code-review path is complete.
- Brainstorm manifest: BR-REQ-001, BR-REQ-002, BR-REQ-003, BR-DEC-001, BR-DEC-002, BR-DEC-003, BR-OUT-001, BR-DEFER-001, BR-Q-001

## Brainstorm Trace
| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | The plan targets imm-code-review subagent completion. |
| BR-REQ-002 | covered_by_step | U2 | Child outcome collection is the core completion gap after invocation envelopes. |
| BR-REQ-003 | covered_by_step | U3 | The plan records adjusted constraints through contract coverage. |
| BR-DEC-001 | captured_as_decision | D1 D3 | The slice stays host-bound and excludes shared platform work. |
| BR-DEC-002 | captured_as_decision | D1 | imm-code-review is the first completion target. |
| BR-DEC-003 | captured_as_decision | D2 | Host-facing helpers are allowed without creating a registry. |
| BR-OUT-001 | out_of_scope | Non-goals | No scheduler, queue, agent communication, or default fan-out in this slice. |
| BR-DEFER-001 | deferred | Future plan | Shared registry requires readiness evidence from three or more hosts. |
| BR-Q-001 | resolved_as_assumption | Assumptions | imm-ui-review parity is deferred until code-review closes. |

## Steps

### Step 1
- Step ID: U1
- Result: Code-review subagent invocation uses a host-facing execution adapter
- Verification: `python3 -m unittest tests.test_activation_plan tests.test_imm_review` exits zero
- Test scenarios: split dispatch envelope creation; no-trigger solo fallback; model inherit behavior; advisory boundary preserved
- Discovery cache: .imm/imm_core/activation_plan.py (activation output contract); .imm/imm_core/delegation_packet.py (packet sharding helper); tests/test_imm_review.py (host helper regression surface)
- failure_behavior: If runtime invocation cannot be represented without provider tool calls, stop at an envelope compiler and record a follow-up for manual runtime validation.
- security_considerations: Child messages must preserve tool_policy no tools and advisory-only boundaries.
- Depends on: None

### Step 2
- Step ID: U2
- Result: Child reviewer outcomes are normalized for code-review synthesis
- Verification: `python3 -m unittest tests.test_imm_review tests.test_telemetry_trace` exits zero
- Test scenarios: retry success; retry failure; timeout fallback; partial lens success; actionable child findings force needs-fix synthesis
- Discovery cache: tests/test_imm_review.py (review synthesis coverage); tests/test_telemetry_trace.py (dispatch telemetry coverage); .imm/imm_core/state_machine.py (child_evidence persistence rules)
- Execution note: test-first
- failure_behavior: If normalized output cannot safely map to parent synthesis, route back to planner before changing reviewer authority.
- security_considerations: Child findings remain advisory and must not gain execution or QA authority.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Code-review contract reflects the finished host path
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan tests.test_imm_review tests.test_telemetry_trace` exits zero
- Test scenarios: exact host sequence is documented; no shared registry wording is preserved; dispatch summary fields are required; degraded dispatch is visible
- Discovery cache: skills/imm-code-review/SKILL.md (host contract); docs/reference/subagent-dispatch-protocol.md (shared dispatch lifecycle); docs/reference/automatic-subagent-activation-policy.md (host-bound policy)
- failure_behavior: If contract tests expose broader host drift, keep this plan scoped to imm-code-review and open a separate readiness-gate planning slice.
- security_considerations: Contract must preserve advisory-only child reviewers and explicit fallback reasons.
- Depends on: 2
