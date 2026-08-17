# Spec: autowork skill driver simplification

**Task ID**: IMM-WORKFLOW-007
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Reduce the current `imm-autowork` friction without adding another skill, MCP
tool, generic dispatcher, or authority layer.

The intended shape is:

- `imm-autowork.py` remains a deterministic checkpoint runtime.
- The existing `imm-autowork` skill acts as the host-side loop contract.
- `imm-executor` remains the execution authority.
- `imm-qa` remains the review authority.
- `imm-review` remains the state mutation primitive for QA closure.

## 2. Problem

The current runtime can consume `execution_queue` and `qa_queue` packets, but it
cannot itself perform executor or QA semantics. When those queues are absent it
returns the broad stop reason `blocked`, which makes a normal host-side
handoff look like an unresolved workflow failure.

The earlier runtime-host upgrade already created a useful deterministic
surface. The remaining issue is narrower: the checkpoint response and the
skill contract do not make the host boundary clear enough for a one-call
`imm-autowork` experience.

## 3. Requirements

### R1. No new skill surface

- Do not add an `imm-autowork-driver` skill.
- Do not add a second MCP tool for driver behavior.
- Keep the user entrypoint as the existing `imm-autowork` skill.

### R2. Checkpoint stop reasons are explicit

`imm-autowork.py` should distinguish at least these boundaries:

- `awaiting_execution_input`
- `awaiting_qa_decision`
- `rework_needed`
- `replan_needed`
- `finished`
- `budget_reached`

Existing broad `blocked` behavior may remain for true planner, malformed, or
non-auto-advance states, but ordinary missing executor or QA input should no
longer be indistinguishable from a hard blocker.

### R3. Snapshot carries host handoff context

The runtime snapshot should include the minimum context a host needs to resume
through existing roles:

- active Step identity and status
- verification requirement
- recorded execution evidence when present
- recommended authority such as `imm-executor` or `imm-qa`
- next recommended skill

### R4. Existing skill owns the host loop instructions

`skills/imm-autowork/SKILL.md` should define how Codex host behavior interprets
the checkpoint result:

- `awaiting_execution_input` means run the existing `imm-executor` semantics,
  then record evidence through `imm-work record-execution`.
- `awaiting_qa_decision` means run the existing `imm-qa` semantics, then record
  `pass`, `rework`, or `replan` through `imm-review`.
- `pass` may continue the loop.
- `rework`, `replan`, malformed state, budget stop, or completion stops the
  loop.

### R5. QA authority is preserved

The runtime must not convert executor-reported `verification_result` into a QA
`pass`. A successful executor verification remains evidence for `imm-qa`, not
the review decision itself.

## 4. Acceptance Criteria

- [ ] The existing `imm-autowork` skill remains the only user-facing autowork
      entrypoint for this behavior.
- [ ] Missing execution evidence returns an explicit execution-awaiting stop.
- [ ] Missing QA decision returns an explicit QA-awaiting stop.
- [ ] The snapshot contains enough active Step, verification, evidence, and
      authority context for the host to continue through existing roles.
- [ ] QA `pass` still flows through `imm-review`; no runtime default-pass path
      exists.
- [ ] Focused regressions cover the execution-awaiting path, QA-awaiting path,
      QA pass continuation, rework stop, replan stop, and full-plan handoff.

## 5. Non-goals

- No new skill.
- No new MCP tool.
- No shared registry.
- No generic dispatcher.
- No background scheduler.
- No automatic QA pass.
- No rewrite of `imm-work` as the full-plan driver.

## 6. Compatibility

Existing callers that provide `execution_queue` and `qa_queue` should continue
to work. The primary compatibility change is additive: callers receive more
specific stop reasons and richer snapshot context.

If strict backwards compatibility with `blocked` is needed by a caller, keep
`blocked` only for true hard boundaries while documenting the new ordinary
awaiting states.
