---
title: "feat: finish imm-work parallel probes runtime"
type: feat
status: planned
date: 2026-05-22
origin: imm-brainstorm analysis of imm-work subagent concurrency
---

# Iteration Plan

## Task
- Summary: Complete the imm-work parallel_probes runtime path with plan annotation preservation, deterministic probe envelopes, State Ledger evidence, and contract regression coverage.
- Origin: imm-brainstorm concluded that imm-work has a documented parallel_probes contract and State Ledger support but lacks runtime code that reads probes, dispatches child envelopes, collects outcomes, and passes evidence to the executor.
- Spec: docs/specs/archive/imm-work-parallel-probes-runtime.spec.md
- Brainstorm manifest: BR-REQ-001, BR-REQ-002, BR-DEC-001, BR-DEC-002, BR-OUT-001, BR-OUT-002, BR-Q-001
- Research: CONTEXT.md defines Step, State Ledger, Delegation Packet, and Domain Mapper as the relevant vocabulary. `plugins/immune-brain/dist/imm-work.md` documents Probe Dispatch. `.imm/imm-work.py` activates one Step and records execution evidence but does not inspect `parallel_probes`. `.imm/imm_core/state_machine.py` already has the `probing` state and `child_evidence` persistence. `.imm/imm_core/code_review_subagents.py` and `.imm/imm_core/domain_mapper_dispatch.py` provide host-bound envelope and outcome normalization precedents. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects shared registry or generic dispatcher work without readiness evidence from three or more hosts.
- Decisions: D1 keep the slice host-bound to imm-work. D2 preserve the current single-active-Step policy. D3 represent provider calls with deterministic envelopes and fake outcomes in tests. D4 persist probe output as child_evidence rather than granting probe authority. D5 keep dispatch failure non-blocking by routing the executor to sequential inline investigation. D6 do not add a shared registry or generic dispatcher.
- Assumptions: `parallel_probes` can be stored as advisory raw Step metadata without breaking existing plan validation. Provider-native subagent calls remain outside unit tests. Runtime environment detection may resolve to unavailable and still produce explicit fallback evidence.

## Brainstorm Trace
| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U3 | The runtime gap is closed by connecting preserved annotations and probe envelopes to imm-work continue. |
| BR-REQ-002 | covered_by_step | U3 | The remaining work focuses on the imm-work parallel_probes runtime path. |
| BR-DEC-001 | captured_as_decision | D1 D6 | Dispatch remains host-bound and excludes shared registry or generic dispatcher work. |
| BR-DEC-002 | captured_as_decision | D4 D5 | Probes stay read-only and produce executor input plus child_evidence. |
| BR-OUT-001 | out_of_scope | Non-goals | Multi-Step parallel execution is explicitly excluded. |
| BR-OUT-002 | out_of_scope | Non-goals | Cross-session queues, agent memory, and agent-to-agent communication are excluded. |
| BR-Q-001 | resolved_as_assumption | Assumptions | Environment support is handled by detection and explicit fallback rather than blocking planning. |

## Steps

### Step 1
- Step ID: U1
- Result: Plan runtime preserves parallel_probes on active Steps
- Verification: `python3 -m unittest tests.test_imm_plan tests.test_current_iteration_state` exits zero
- Test scenarios: normalized plan keeps probe annotations; runtime sync stores probe annotations; activation copies probe annotations; State Ledger supports active to probing to executing transitions
- Discovery cache: .imm/imm_core/plan_runtime.py (plan parsing and normalization); .imm/imm_core/current_iteration_state.py (runtime sync and active Step data); .imm/imm_core/state_machine.py (probing transition); tests/test_imm_plan.py (plan parser coverage); tests/test_current_iteration_state.py (ledger coverage)
- Execution note: test-first
- failure_behavior: If parser support requires a broader schema migration, keep annotations raw and defer strict schema validation.
- security_considerations: Probe annotations must not include secrets or grant write authority.
- Depends on: None

### Step 2
- Step ID: U2
- Result: Work probe helper builds deterministic envelopes
- Verification: `python3 -m unittest tests.test_work_probes` exits zero
- Test scenarios: envelope construction from active Step probes; Codex call shape uses message and fork_context; Cursor call shape uses readonly and run_in_background; unavailable dispatch returns explicit fallback; probe messages preserve tool_policy no tools
- Discovery cache: docs/reference/subagent-dispatch-protocol.md (dispatch lifecycle); .imm/imm_core/code_review_subagents.py (review envelope precedent); .imm/imm_core/domain_mapper_dispatch.py (mapper envelope precedent); tests/test_domain_mapper_dispatch.py (fake runtime precedent)
- Execution note: test-first
- failure_behavior: If provider call shapes diverge, keep the helper provider-neutral and document the unsupported runtime as unavailable_environment.
- security_considerations: Envelopes must preserve read-only advisory boundaries and must not request edits.
- Depends on: None

### Step 3
- Step ID: U3
- Result: imm-work continue records probe evidence
- Verification: `python3 -m unittest tests.test_workflow_loop tests.test_current_iteration_state tests.test_work_probes` exits zero
- Test scenarios: active Step with probes transitions to probing; successful probe outcomes become child_evidence; failed probe records fallback reason; next action remains executor after probe handling; execution evidence can still move the Step to ready_for_review
- Discovery cache: .imm/imm-work.py (continue driver); .imm/imm_core/current_iteration_state.py (child_evidence persistence); .imm/imm_core/state_machine.py (transition enforcement); tests/test_workflow_loop.py (imm-work flow coverage); tests/test_work_probes.py (probe helper coverage)
- Execution note: test-first
- failure_behavior: If real provider dispatch cannot be represented in CLI flow, stop at envelope generation plus fake outcome ingestion and record manual runtime validation as follow-up.
- security_considerations: Probe child_evidence must be treated as advisory input and cannot close QA.
- Depends on: 1, 2

### Step 4
- Step ID: U4
- Result: Skill contracts document probe runtime truth
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_work_probes tests.test_workflow_loop` exits zero
- Test scenarios: imm-work documents deterministic probe sequence; imm-planner documents annotation preservation; imm-executor documents consuming existing probe results; contracts preserve no shared registry wording; fallback reason visibility is required
- Discovery cache: plugins/immune-brain/dist/imm-work.md (probe host contract); plugins/immune-brain/dist/imm-planner.md (probe annotation contract); plugins/immune-brain/dist/imm-executor.md (probe result consumption); tests/test_skill_contracts.py (contract regression surface)
- failure_behavior: If contract tests expose broader drift, limit this slice to probe runtime truth and open a separate wording alignment plan.
- security_considerations: Contract text must not imply probe write authority or QA authority.
- Depends on: 3

### Step 5
- Step ID: U5
- Result: Full probe runtime regression passes
- Verification: `python3 -m unittest tests.test_imm_plan tests.test_current_iteration_state tests.test_work_probes tests.test_workflow_loop tests.test_skill_contracts` exits zero
- Test scenarios: end-to-end parser to ledger to helper to imm-work flow; degraded dispatch remains visible; existing review and mapper dispatch behavior remains unchanged
- Discovery cache: docs/specs/archive/imm-work-parallel-probes-runtime.spec.md (acceptance criteria); docs/plans/2026-05-22-001-feat-imm-work-parallel-probes-runtime-plan.md (plan validation target)
- failure_behavior: If broad regression fails outside the probe surface, isolate unrelated failures and close only after probe-owned regressions are fixed.
- security_considerations: Final evidence must confirm no shared dispatcher or write-capable probe path was introduced.
- Depends on: 4
