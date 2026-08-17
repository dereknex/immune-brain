# Spec: Pi Brainstorm Agent Result Contract

## 1. Goal

Add a pure runtime contract that lets Pi feed completed Brainstorm ensemble subagent outputs back into Immune-Brain for parent-owned synthesis.

## 2. Background

The prior Pi Brainstorm host adapter slice builds Pi subagent envelopes from already-gated `brainstorm_ensemble` candidates. That slice intentionally does not call real host tools. The next safe boundary is result normalization: Pi may execute those subagents, keep `candidate_id` correlation, and pass finished child outputs back to runtime helpers.

## 3. Requirements

### R1. Result normalization helper

Add a Brainstorm-specific helper, `normalizePiBrainstormAgentResults`, that consumes:

- the original gated Brainstorm ensemble request candidates
- host-returned Pi child results keyed by `candidate_id`
- each child output as either JSON text or a plain object containing `recommendations`, `disagreements`, `open_questions`, and `blockers`

The helper returns a `normalizeBrainstormEnsemblePacket` result owned by `imm-brainstorm`.

### R2. Correlation safety

The helper must reject unknown `candidate_id` values, duplicate candidate results, and missing candidate results with stable fallback reasons. It must not silently synthesize from unrelated, duplicated, or incomplete children.

### R3. Failed child handling

A child result with `error` and no usable output should become a child blocker instead of crashing synthesis. This preserves failure evidence for the parent Brainstorm handoff.

### R4. Host boundary preservation

Runtime remains pure. It must not call any agent, provider SDKs, timers, sleeps, or polling loops. Pi owns subagent execution and only passes completed outputs into the helper.

### R5. Documentation

Brainstorm docs should explain the host-owned loop:

1. build `brainstorm_ensemble` request
2. build Pi `Agent` envelopes
3. Pi launches subagents and collects child outputs
4. runtime normalizes completed outputs into parent Brainstorm evidence

Final framing remains with `imm-brainstorm`; final Spec and Plan authority remains with `imm-planner`.

## 4. Acceptance Criteria

- Tests prove JSON string child outputs normalize into `framing_evidence`, `decision_criteria`, `open_questions`, and strong-tier `risk_verification_requirements`.
- Tests prove unknown, duplicate, or missing candidate results do not synthesize a packet.
- Tests prove errored child results are preserved as blockers.
- Docs state Pi-owned subagent execution and no runtime agent calls or polling.
- Focused validation passes and scope guard shows no provider SDK calls, no runtime agent invocation, no polling, and no workflow-state mutation.

## 5. Non-goals

- Do not call any agent from runtime.
- Do not poll background agents.
- Do not add provider SDK integrations.
- Do not mutate workflow state from the result helper.
- Do not create non-Pi host result adapters in this slice.
