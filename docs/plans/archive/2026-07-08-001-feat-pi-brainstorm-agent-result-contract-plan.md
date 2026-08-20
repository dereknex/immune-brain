---
title: feat: pi brainstorm subagent result contract
type: feat
status: draft
date: 2026-07-08
origin: user said continue after Pi Brainstorm envelope adapter closure; next slice is host-owned result collection
---

# Iteration Plan

## Task
- Summary: Add a pure runtime result contract for Pi Brainstorm subagent outputs without runtime agent invocation or polling
- Origin: Previous Pi adapter plan closed with `buildBrainstormEnsembleDispatchEnvelopes`; user said continue
- Spec: docs/specs/archive/pi-brainstorm-agent-result-contract.spec.md
- Research: `buildBrainstormEnsembleDispatchEnvelopes("pi")` already preserves `candidate_id` and emits Pi subagent envelopes; `normalizeBrainstormEnsemblePacket` already performs parent-owned Brainstorm synthesis from child arrays; runtime policy forbids provider SDK calls and real agent/tool invocation
- Decisions: D1 add a Brainstorm-specific result helper rather than a generic host result framework; D2 helper consumes completed host outputs only; D3 unknown, duplicate, or missing candidate results fail closed; D4 errored child results become blockers so parent Brainstorm keeps failure evidence; D5 docs describe host-owned launch/collect loop without transferring authority
- Assumptions: Pi can retain `candidate_id` from each subagent envelope and pass final child output text or objects back to the helper; child outputs follow the prompt schema from the previous slice; partial failure should not erase other child evidence
- Scope Mode: New Slice
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/runtime/imm_core.ts`, `tests/planner-ensemble-contract.test.ts`, `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `docs/specs/archive/pi-brainstorm-agent-result-contract.spec.md`, `docs/plans/2026-07-08-001-feat-pi-brainstorm-agent-result-contract-plan.md`
  - dependencies_known: true
  - verification_path:
      - target: Pi Brainstorm subagent child outputs normalize into parent-owned Brainstorm packet without live agent calls
      - method: `bun test tests/planner-ensemble-contract.test.ts` and `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-08-001-feat-pi-brainstorm-agent-result-contract-plan.md --json`
  - blockers: implementation should not start if `buildBrainstormEnsembleDispatchEnvelopes` or `normalizeBrainstormEnsemblePacket` baseline is absent
  - replan_condition: if runtime agent invocation, polling, or persisted session state is required, stop and create a separate plan; Pi may call its own subagents in the Pi host layer

## Output Language

Spec and Plan prose language: English for durable planning artifacts; preserve exact English literals for file paths, CLI flags, function names, enum values, stage keys, tool names, and model IDs.

## Devil's Advocate Audit

- Rollback resilience: This slice is additive. Remove one helper, related tests, and docs wording if wrong.
- Verification vanity: Tests must feed representative child outputs and assert normalized packet fields, not only helper existence.
- Spec dilution detection: The accepted scope is completed result normalization. Runtime launch, polling, provider calls, and workflow-state mutation are explicitly out of scope.

## Steps

### Step 1
- Step ID: U1
- Result: Pi Brainstorm subagent outputs normalize into an `imm-brainstorm` packet
- Verification: `tests/planner-ensemble-contract.test.ts` asserts `normalizePiBrainstormAgentResults` accepts completed Pi subagent JSON outputs keyed by `candidate_id`, preserves candidate tiers, and returns `owner: "imm-brainstorm"`, `children_advisory_only: true`, `framing_evidence`, `decision_criteria`, `open_questions`, and strong-tier `risk_verification_requirements`; `bun test tests/planner-ensemble-contract.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers JSON string output; Covers object output; Covers parent-owned synthesis; Covers strong-model blocker promotion
- Depends on: none
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `tests/planner-ensemble-contract.test.ts`
- Replan condition: If result parsing needs actual Pi host APIs stop and return to planner

### Step 2
- Step ID: U2
- Result: Result collection rejects incomplete child sets
- Verification: `tests/planner-ensemble-contract.test.ts` asserts unknown `candidate_id` returns `ok: false` with `fallback_reason: "unknown_candidate"`; duplicate candidate output returns `fallback_reason: "duplicate_candidate_result"`; missing candidate output returns `fallback_reason: "missing_candidate_result"`; child `error` without output becomes a blocker in the normalized packet instead of throwing; `bun test tests/planner-ensemble-contract.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers unknown candidate rejection; Covers duplicate result rejection; Covers missing result rejection; Covers child error blocker; Covers no synthetic success from incomplete children
- Depends on: 1
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `tests/planner-ensemble-contract.test.ts`
- Replan condition: If partial result synthesis is required by users, stop and create an explicit policy decision plan

### Step 3
- Step ID: U3
- Result: Brainstorm docs describe Pi-owned result collection boundaries
- Verification: `plugins/immune-brain/dist/imm-brainstorm.md` and `plugins/immune-brain/skills/imm-brainstorm/SKILL.md` state that Pi may launch subagents and feed completed outputs to `normalizePiBrainstormAgentResults`, while runtime does not call any agent, poll, mutate state, or own final Spec/Plan authority; contract tests assert the wording; `bun test tests/planner-ensemble-contract.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers Pi-owned loop; Covers no runtime polling/agent calls; Covers source plus dist prompt parity; Covers authority boundary
- Depends on: 2
- Scope: `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `tests/planner-ensemble-contract.test.ts`
- Replan condition: If generated dist files require a build step update source generation path instead of hand-editing only dist

### Step 4
- Step ID: U4
- Result: Pi Brainstorm subagent result contract is validated against runtime boundaries
- Verification: `bun test tests/planner-ensemble-contract.test.ts tests/advisory-dispatch-core.test.ts tests/activation-plan-runtime-surface.test.ts` exits zero; `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-08-001-feat-pi-brainstorm-agent-result-contract-plan.md --json` exits zero; `git diff -- plugins/immune-brain/runtime plugins/immune-brain/dist/imm-brainstorm.md plugins/immune-brain/skills/imm-brainstorm/SKILL.md tests docs/specs/archive/pi-brainstorm-agent-result-contract.spec.md docs/plans/2026-07-08-001-feat-pi-brainstorm-agent-result-contract-plan.md` shows no provider SDK calls, no runtime agent invocation, no polling loop, and no workflow-state mutation
- Agent Hint: imm-qa
- Test scenarios: Covers full focused runtime suite; Covers plan validation; Covers scope guard; Covers no runtime agent invocation
- Depends on: 3
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `tests/planner-ensemble-contract.test.ts`, `tests/advisory-dispatch-core.test.ts`, `tests/activation-plan-runtime-surface.test.ts`, `docs/specs/archive/pi-brainstorm-agent-result-contract.spec.md`, `docs/plans/2026-07-08-001-feat-pi-brainstorm-agent-result-contract-plan.md`
- Replan condition: If validation needs runtime agent access stop and route to a manual Pi host-subagent plan

## Notes

- This plan intentionally treats Pi subagent execution as Pi-owned. Runtime helpers only build contracts and normalize completed evidence.
- Do not append this slice to the closed `2026-07-07-002` plan.
