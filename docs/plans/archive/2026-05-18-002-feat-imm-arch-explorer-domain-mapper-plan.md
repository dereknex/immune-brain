---
title: "feat: add arch-explorer domain mapper mode"
type: feat
status: planned
date: 2026-05-18
origin: user request under imm-planner
---

# Iteration Plan

## Task
- Summary: Add Domain Mapper mode to imm-arch-explorer across contract, execution truth, and durability phases.
- Origin: User asked planner to define phases 1-3 after brainstorm concluded the best design is Domain Mapper mode under the existing Parallel Domain Survey.
- Spec: docs/specs/imm-arch-explorer-domain-mapper.spec.md
- Research: CONTEXT.md defines Domain Mapper, Delegation Packet, State Ledger, and Activation Plan vocabulary. The current runtime plan for `docs/plans/2026-05-18-001-feat-imm-arch-explorer-domain-survey-plan.md` is closed with U1 pass. `docs/specs/imm-arch-explorer-domain-survey.spec.md` already accepted a prompt-only Parallel Domain Survey first slice. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects generic dispatcher work without readiness evidence from three or more hosts. `docs/plans/2026-05-17-002-feat-imm-code-review-subagent-closure-plan.md` provides the closest execution-truth pattern while keeping work host-bound.
- Decisions: D1 treat Domain Mapper as a concrete mode under Parallel Domain Survey. D2 keep Phase 1 contract-first and independently shippable. D3 keep later execution truth host-bound to imm-arch-explorer. D4 preserve `generalPurpose`, `readonly: true`, and `tool_policy: no tools` child boundaries. D5 defer shared registry or generic dispatcher until separate readiness evidence exists.
- Assumptions: Provider-native subagent calls cannot be unit-tested directly, so execution-truth tests can use deterministic envelope builders or fake runtime callables. `generalPurpose` remains sufficient for Domain Mapper prompts unless later evidence proves otherwise.
- Brainstorm manifest: BR-REQ-1, BR-REQ-2, BR-REQ-3, BR-REQ-4, BR-DEC-1, BR-OUT-1, BR-DEFER-1

## Brainstorm Trace
| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-1 | covered_by_step | U1 | Domain Mapper mode is added to the arch-explorer contract. |
| BR-REQ-2 | covered_by_step | U1 | Scope confirmation and shard dispatch rules belong to the contract phase. |
| BR-REQ-3 | covered_by_step | U1 | Child boundaries are contract-critical before runtime work starts. |
| BR-REQ-4 | covered_by_step | U2 | Host synthesis depends on normalized mapper output. |
| BR-DEC-1 | captured_as_decision | D1 | Domain Mapper stays under Parallel Domain Survey. |
| BR-OUT-1 | out_of_scope | Non-goals | Generic dispatcher and shared registry work are excluded by this plan. |
| BR-DEFER-1 | deferred | Future plan | Shared registry readiness requires separate evidence from three or more hosts. |

## Steps

### Step 1
- Step ID: U1
- Result: Domain Mapper mode is locked in the arch-explorer contract
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: contract asserts Domain Mapper mode; contract asserts shard strategy; contract asserts mapper output schema; contract preserves `generalPurpose`, `readonly: true`, and `tool_policy: no tools`
- Discovery cache: skills/imm-arch-explorer/SKILL.md (Domain Mapper prompt contract); tests/test_skill_contracts.py (contract regression surface); docs/specs/imm-arch-explorer-domain-mapper.spec.md (phase boundary)
- Execution note: test-first
- failure_behavior: If the contract starts duplicating the shared dispatch protocol, narrow it back to a role-specific Domain Mapper delta.
- security_considerations: Mapper subagents stay read-only and advisory-only.
- Depends on: None

### Step 2
- Step ID: U2
- Result: Domain Mapper runtime path has deterministic host evidence
- Verification: `python3 -m unittest tests.test_domain_mapper_dispatch tests.test_skill_contracts` exits zero
- Test scenarios: mapper shard envelopes are deterministic; mapper output schema is normalized; solo fallback reason is explicit; provider runtime calls are represented by fake callables
- Discovery cache: docs/reference/subagent-dispatch-protocol.md (dispatch lifecycle); .imm/imm_core/delegation_packet.py (packet sharding pattern); tests/test_imm_review.py (fake runtime callable precedent); tests/test_domain_mapper_dispatch.py (new mapper runtime evidence)
- Execution note: test-first
- failure_behavior: If host-facing execution needs shared dispatch infrastructure, stop and replan instead of building a generic dispatcher.
- security_considerations: Envelope construction must preserve `tool_policy: no tools` and advisory-only boundaries.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Domain Mapper evidence becomes durable telemetry
- Verification: `python3 -m unittest tests.test_domain_mapper_dispatch tests.test_telemetry_trace tests.test_skill_contracts` exits zero
- Test scenarios: mapper child evidence records shard coverage; fallback reasons are visible; telemetry can summarize mapper count and coverage; compounder-facing learning input remains host-bound
- Discovery cache: .imm/imm_core/state_machine.py (child_evidence lifecycle); tests/test_telemetry_trace.py (telemetry regression surface); skills/imm-compounder/SKILL.md (learning extraction contract); docs/solutions/subagent-execution-truth-protocol.md (telemetry precedent)
- Execution note: test-first
- failure_behavior: If durability requires State Ledger schema expansion beyond mapper evidence, route back to planner with a smaller compatibility slice.
- security_considerations: Persisted mapper output must not include secrets or grant mapper findings execution authority.
- Depends on: 2
