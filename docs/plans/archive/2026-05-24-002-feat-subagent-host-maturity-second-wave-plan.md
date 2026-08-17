---
title: "feat: mature second-wave subagent hosts"
type: feat
status: proposed
date: 2026-05-24
origin: "User asked imm-planner to plan the next host maturity wave after imm-brainstorm identified remaining gaps."
---

# Iteration Plan

## Task
- Summary: Mature the next host-bound subagent result loops by adding planner research synthesis, preplan adversarial synthesis, and compounder scorecard consumption while explicitly deferring high-risk write-worker and thin reviewer rollouts.
- Origin: imm-brainstorm analysis found that first-wave hosts now have result loops, while `imm-planner`, `imm-preplan-review`, and `imm-compounder` still lack runtime-grade result synthesis. It also recommended deferring `imm-pr-fix`, thin reviewer hosts, and `test-fixer` until there is clearer evidence or safer write-boundary infrastructure.
- Spec: docs/specs/subagent-host-maturity-second-wave.spec.md
- Brainstorm manifest: BR-REQ-001, BR-REQ-002, BR-REQ-003, BR-DEC-001, BR-OUT-001, BR-DEFER-001
- Research: `CONTEXT.md` defines Activation Plan, Delegation Packet, State Ledger, and Domain Mapper. `plugins/immune-brain/dist/imm-planner.md` already defines Research Dispatch and evidence-only planner authority but lacks a helper. `plugins/immune-brain/dist/imm-preplan-review.md` defines adversarial dispatch but lacks normalized outcome synthesis. `plugins/immune-brain/dist/imm-compounder.md` reads dispatch telemetry but does not yet consume the local subagent scorecard. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects generic dispatcher work until scorecard-like evidence proves repeated host drift. The first wave added `brainstorm_research`, `party_dispatch`, `domain_mapper_dispatch`, `work_probes`, and `subagent_scorecard` patterns to reuse.
- Decisions:
  - D1: Keep this wave host-bound and reject shared registry or generic dispatcher work.
  - D2: Preserve parent authority: planner writes the final Spec/Plan; preplan decides scope posture; compounder records learnings; children only provide evidence.
  - D3: Implement `imm-planner` and `imm-preplan-review` helpers before expanding thin reviewer hosts.
  - D4: Defer `imm-pr-fix` parallel worker dispatch because write isolation, branch merge, and push safety require a separate high-risk plan.
  - D5: Use scorecard consumption to decide future reviewer/runtime tuning instead of guessing from prose contracts.
- Assumptions: Existing first-wave helper style is the local implementation pattern. Unit tests can use fake child outcomes rather than real subagent dispatch. Current host authorization policy still applies before any real Codex `spawn_agent` or Cursor Task call.
- Scope Mode: Four-step feature slice
- Engineering Closure Check:
  - architecture_surface: `.imm/imm_core/`, `plugins/immune-brain/dist/.imm/imm_core/`, `plugins/immune-brain/dist/imm-planner.md`, `plugins/immune-brain/dist/imm-preplan-review.md`, `plugins/immune-brain/dist/imm-compounder.md`, `tests/`
  - dependencies_known: yes; Python standard library and existing unittest patterns are sufficient
  - verification_path: focused helper tests, skill contract tests, compounder/scorecard tests, and plan validation
  - blockers: none
  - replan_condition: if implementation requires write-worker dispatch, shared registry, plan-writing child agents, or PR branch merge automation

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-001 | captured_as_decision | D1 | Keep all work host-bound; no shared registry. |
| BR-REQ-002 | covered_by_step | U1 | Prioritize `imm-planner` first, then `imm-preplan-review` in U2. |
| BR-REQ-003 | captured_as_decision | D4 | Treat `imm-pr-fix` as high-risk and defer worker parallelism. |
| BR-DEC-001 | covered_by_step | U3 | Mature specialized reviewers only through scorecard evidence, not broad rollout. |
| BR-OUT-001 | captured_as_decision | D2 | Child agents must not write plans, close QA, change scope, or gain extra authority. |
| BR-DEFER-001 | covered_by_step | U3 | Shared dispatcher stays deferred until scorecard evidence justifies it. |

## Steps

### Step 1
- Step ID: U1
- Result: `imm-planner` has an evidence-only research helper
- Verification: `python3 -m unittest tests.test_planner_research tests.test_skill_contracts` exits zero
- Test scenarios: planner research dispatch only triggers for multi-domain or explicit parallel research; fallback reasons stay visible; child outputs normalize to constraints, risks, unknowns, file pointers, and verification implications; synthesis feeds Research evidence without writing Specs or Plans
- Discovery cache: plugins/immune-brain/dist/imm-planner.md (planner research contract); .imm/imm_core/brainstorm_research.py (manifest-oriented helper pattern); .imm/imm_core/domain_mapper_dispatch.py (synthesis and telemetry pattern); tests/test_skill_contracts.py (contract regression surface)
- Execution note: test-first
- failure_behavior: If planner research starts implying child-written plan text, stop and narrow the helper to evidence-only normalized fields.
- security_considerations: Research evidence must not persist secrets, raw prompts, or child-authored plan authority.
- Depends on: None

### Step 2
- Step ID: U2
- Result: `imm-preplan-review` has a non-gating adversarial helper
- Verification: `python3 -m unittest tests.test_preplan_adversary tests.test_skill_contracts` exits zero
- Test scenarios: adversarial dispatch only triggers for high-risk, cross-module, major architecture, or explicit challenge scenarios; child findings normalize to risk, disputed assumption, verification concern, recommendation, confidence, and disposition; parent synthesis surfaces adopted/deferred/dismissed evidence without automatically changing scope posture; fallback reasons remain visible
- Discovery cache: plugins/immune-brain/dist/imm-preplan-review.md (adversarial dispatch contract); docs/reference/subagent-dispatch-protocol.md (shared lifecycle); .imm/imm_core/party_dispatch.py (advisory synthesis pattern); tests/test_skill_contracts.py (contract regression surface)
- Execution note: test-first
- failure_behavior: If adversarial evidence becomes a hard gate, keep the output advisory and route true blockers to parent preplan judgment.
- security_considerations: Adversarial child output stays readonly and cannot write plans, implementation, workflow state, or QA decisions.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: `imm-compounder` can summarize subagent scorecard evidence
- Verification: `python3 -m unittest tests.test_subagent_scorecard tests.test_skill_contracts` exits zero
- Test scenarios: scorecard summary reports host-level value, adopted/rejected/deferred/duplicate counts, degraded dispatch reasons, routing effects, and shared-registry readiness; compounder contract says missing scorecard data is not evidence for shared infrastructure; deferred host reasons remain explicit
- Discovery cache: plugins/immune-brain/dist/imm-compounder.md (learning and dispatch metrics contract); .imm/imm_core/subagent_scorecard.py (local scorecard helper); docs/solutions/rejected-shared-registry-generic-dispatcher.md (deferred shared infra decision); tests/test_subagent_scorecard.py (scorecard regression surface)
- Execution note: test-first
- failure_behavior: If scorecard data is absent or sparse, report `insufficient_evidence` rather than recommending shared registry work.
- security_considerations: Scorecard summaries must avoid raw child prompts and sensitive content.
- Depends on: 2

### Step 4
- Step ID: U4
- Result: Second-wave host maturity regression passes
- Verification: `python3 -m unittest tests.test_planner_research tests.test_preplan_adversary tests.test_subagent_scorecard tests.test_telemetry_trace tests.test_current_iteration_state tests.test_skill_contracts` exits zero
- Test scenarios: planner, preplan, compounder, first-wave scorecard, telemetry, and State Ledger paths preserve authority boundaries; deferred hosts remain out of scope; no shared registry, generic dispatcher, background scheduler, or child plan/QA authority is introduced
- Discovery cache: docs/specs/subagent-host-maturity-second-wave.spec.md (acceptance criteria); docs/plans/2026-05-24-002-feat-subagent-host-maturity-second-wave-plan.md (plan validation target); tests/test_skill_contracts.py (global contract regression)
- failure_behavior: If broad regression exposes unrelated failures, isolate them and close only after this wave's host-maturity regressions pass.
- security_considerations: Final evidence must confirm all new child paths remain bounded, readonly or evidence-only, and subject to host authorization.
- Depends on: 3
