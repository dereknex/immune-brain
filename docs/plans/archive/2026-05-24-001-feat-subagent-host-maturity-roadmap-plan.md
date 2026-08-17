---
title: "feat: mature subagent host result loops"
type: feat
status: proposed
date: 2026-05-24
origin: "User asked imm-planner for a complete plan after reviewing immature subagent hosts and their gaps."
---

# Iteration Plan

## Task
- Summary: Mature the currently immature subagent-capable hosts by adding result-oriented contracts, deterministic host paths, child evidence handling, and a local scorecard that proves whether subagent output improves downstream outcomes.
- Origin: imm-brainstorm analysis concluded that `imm-code-review` and `imm-ui-review` are the mature baseline, while `imm-party`, `imm-arch-explorer`, `imm-brainstorm`, `imm-work`, and `imm-planner` need host-specific maturity work.
- Spec: docs/specs/subagent-host-maturity-roadmap.spec.md
- Research: `CONTEXT.md` defines Activation Plan, Delegation Packet, Domain Mapper, State Ledger, and Brainstorm terminology. `docs/reference/subagent-dispatch-protocol.md` defines the dispatch lifecycle and fallback reasons. `docs/reference/automatic-subagent-activation-policy.md` keeps activation host-bound and advisory-only. `docs/reference/subagent-remaining-work.md` says `imm-party` catalog wiring is not started, while `imm-ui-review` and `imm-code-review` catalog paths are complete. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects generic dispatcher work until three or more hosts show real drift and maintenance evidence. `docs/solutions/rejected-rigid-patch-generation-in-reviewer-subagents.md` rejects exact patch output from restricted reviewers.
- Decisions:
  - D1: Keep every maturity slice host-bound; do not introduce a shared registry or generic dispatcher.
  - D2: Prioritize result quality over agent count; every host path must show how child output affects downstream decisions.
  - D3: Mature `imm-party` and `imm-arch-explorer` first because they already have dispatch concepts but lack complete result loops.
  - D4: Keep `imm-brainstorm` research dispatch optional and map every child result into Brainstorm manifest IDs.
  - D5: Keep `imm-work` and `imm-planner` as authority-preserving consumers rather than broad automatic fan-out hosts.
  - D6: Use a local scorecard to decide future trigger tuning or shared-infrastructure readiness.
- Assumptions: Provider-native subagent execution can be represented in tests through deterministic envelope builders and fake outcomes. Current host authorization policy still applies before real subagent dispatch. Existing mature `imm-code-review` and `imm-ui-review` behavior should remain unchanged.
- Scope Mode: Five-step feature slice
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/dist/imm-party.md`, `plugins/immune-brain/dist/imm-arch-explorer.md`, `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/dist/imm-work.md`, `plugins/immune-brain/dist/imm-planner.md`, `.imm/imm_core/`, `docs/reference/`, `tests/`
  - dependencies_known: yes; Python standard library and existing unittest coverage are sufficient
  - verification_path: focused host helper tests, skill contract tests, telemetry tests, and plan validation
  - blockers: none
  - replan_condition: if implementation requires a shared dispatcher, child write authority, or cross-session scheduling

## Steps

### Step 1
- Step ID: U1
- Result: `imm-party` produces synthesized advisory decisions instead of loose multi-role notes
- Verification: `python3 -m unittest tests.test_party_dispatch tests.test_skill_contracts` exits zero
- Test scenarios: deterministic role catalog selects bounded advisory roles; role outputs normalize to position, risk, disagreement, recommendation, confidence, and decision criteria; parent synthesis emits one handoff for brainstorm or planner; fallback reasons remain explicit; no role gains plan, execution, or QA authority
- Discovery cache: plugins/immune-brain/dist/imm-party.md (advisory host contract); docs/reference/subagent-dispatch-protocol.md (shared lifecycle); docs/reference/workflow-and-subagents.md (authority boundary); tests/test_skill_contracts.py (contract regression surface)
- Execution note: test-first
- failure_behavior: If role selection starts resembling a generic dispatcher, narrow the slice to a party-only catalog and stop before adding shared infrastructure.
- security_considerations: Advisory roles remain read-only and cannot request edits, secrets, or direct workflow-state mutation.
- Depends on: None

### Step 2
- Step ID: U2
- Result: `imm-arch-explorer` Domain Mapper output records planner impact
- Verification: `python3 -m unittest tests.test_domain_mapper_dispatch tests.test_skill_contracts` exits zero
- Test scenarios: mapper shard output includes domain map, key files, constraints, risks, unknowns, and planner impact; parent synthesis records which mapper findings affected downstream planning; degraded mapper output remains visible; Domain Mapper stays `generalPurpose`, readonly, and advisory-only
- Discovery cache: plugins/immune-brain/dist/imm-arch-explorer.md (Domain Mapper host); .imm/imm_core/domain_mapper_dispatch.py (existing mapper helper); docs/plans/2026-05-18-002-feat-imm-arch-explorer-domain-mapper-plan.md (prior mapper plan); tests/test_domain_mapper_dispatch.py (mapper regression surface)
- Execution note: test-first
- failure_behavior: If planner impact cannot be inferred safely, require the parent host to mark impact as unknown rather than inventing a planning effect.
- security_considerations: Mapper evidence must not persist secrets and must not grant execution authority.
- Depends on: None

### Step 3
- Step ID: U3
- Result: `imm-brainstorm` research probes map into a closed Brainstorm manifest
- Verification: `python3 -m unittest tests.test_brainstorm_research tests.test_skill_contracts` exits zero
- Test scenarios: research probes only trigger for multi-domain tasks or explicit parallel research; child summaries map into `BR-REQ-*`, `BR-DEC-*`, `BR-OUT-*`, `BR-DEFER-*`, or `BR-Q-*`; unresolved `BR-Q-*` blocks planner handoff; solo fallback records `explicit_required`, `config_disabled`, `unavailable_environment`, or `cost_scope_mismatch` without hiding the reason
- Discovery cache: plugins/immune-brain/dist/imm-brainstorm.md (manifest and research dispatch contract); docs/reference/subagent-dispatch-protocol.md (fallback reasons); CONTEXT.md (Brainstorm and canonical terms); tests/test_skill_contracts.py (skill contract coverage)
- Execution note: test-first
- failure_behavior: If research output cannot be mapped to a manifest ID, keep it as an open `BR-Q-*` rather than passing vague prose to planner.
- security_considerations: Research probes stay readonly and must not write specs, plans, or runtime state.
- Depends on: None

### Step 4
- Step ID: U4
- Result: Host authority boundaries preserve child evidence consumption
- Verification: `python3 -m unittest tests.test_work_probes tests.test_current_iteration_state tests.test_skill_contracts` exits zero
- Test scenarios: `imm-work` requires an active Step before any bounded probe or worker child path; child output persists as `child_evidence`; QA remains the only closure judge; planner consumes structured evidence but owns final Spec and Plan writing; child research cannot directly edit final plans
- Discovery cache: plugins/immune-brain/dist/imm-work.md (current-Step driver and probe host); plugins/immune-brain/dist/imm-planner.md (research consumer boundary); .imm/imm_core/current_iteration_state.py (child_evidence persistence); .imm/imm_core/state_machine.py (State Ledger transitions); tests/test_current_iteration_state.py (ledger regression surface)
- Execution note: test-first
- failure_behavior: If a child path needs to edit implementation files, route it through an active-Step bounded executor plan instead of broadening planner or work authority.
- security_considerations: Child evidence is advisory until executor or QA records verified evidence; it must not close a Step.
- Depends on: 1, 2, 3

### Step 5
- Step ID: U5
- Result: Subagent host maturity is measurable through a local result scorecard
- Verification: `python3 -m unittest tests.test_subagent_scorecard tests.test_telemetry_trace tests.test_skill_contracts` exits zero
- Test scenarios: scorecard records host, child or lens, trigger reason, outcome status, adopted findings, rejected findings, deferred findings, duplicates, degraded dispatch reason, and downstream routing effect; scorecard can summarize result value by host; rejected decisions against shared registry and rigid patches remain asserted; existing code-review and UI-review activation behavior stays unchanged
- Discovery cache: .imm/imm_core/telemetry.py (local telemetry pattern); .imm/memory/dispatch_telemetry.jsonl (dispatch telemetry precedent); docs/solutions/host-facing-subagent-integration-adapters.md (host adapter pattern); docs/solutions/rejected-shared-registry-generic-dispatcher.md (non-goal evidence); docs/solutions/rejected-rigid-patch-generation-in-reviewer-subagents.md (reviewer output boundary); tests/test_telemetry_trace.py (telemetry regression surface)
- Execution note: test-first
- failure_behavior: If scorecard data cannot be derived for one host, mark that host `unknown` and keep the scorecard extensible instead of blocking all host maturity work.
- security_considerations: Scorecard entries must not store secrets, raw prompts with sensitive data, or child output that exceeds advisory evidence needs.
- Depends on: 4

### Step 6
- Step ID: U6
- Result: Full subagent host maturity regression passes
- Verification: `python3 -m unittest tests.test_party_dispatch tests.test_domain_mapper_dispatch tests.test_brainstorm_research tests.test_work_probes tests.test_current_iteration_state tests.test_subagent_scorecard tests.test_telemetry_trace tests.test_skill_contracts` exits zero
- Test scenarios: party, mapper, brainstorm, work, planner, and scorecard paths all preserve host-bound authority; mature `imm-code-review` and `imm-ui-review` contracts remain intact; fallback reasons are visible; no shared registry, generic dispatcher, background scheduler, or patch-generating advisory reviewer is introduced
- Discovery cache: docs/specs/subagent-host-maturity-roadmap.spec.md (acceptance criteria); docs/plans/2026-05-24-001-feat-subagent-host-maturity-roadmap-plan.md (plan validation target); tests/test_skill_contracts.py (global contract regression)
- failure_behavior: If broad regression exposes unrelated failures, isolate them and close only after this plan's host-maturity regressions pass.
- security_considerations: Final evidence must confirm all child paths remain bounded, advisory or active-Step constrained, and subject to host authorization.
- Depends on: 5
