---
title: imm-work parallel probes runtime
type: feat
status: planned
date: 2026-05-22
---

# Spec: imm-work parallel probes runtime

## Objective

Complete the `imm-work` runtime path for planner-defined `parallel_probes`.
The goal is to move this capability from skill contract text into
host-bound execution truth: an active Step can carry read-only probe
annotations, `imm-work` can build deterministic child envelopes, probe
outcomes can be normalized, and the resulting evidence can reach the
executor and State Ledger without changing authority boundaries.

## Background

`imm-planner`, `imm-work`, and `imm-executor` already describe the intended
flow:

1. Planner marks a Step with optional `parallel_probes` when the Step spans
   three or more non-overlapping file areas.
2. `imm-work` dispatches read-only probes before executor semantics.
3. The executor consumes probe results as input context and does not spawn
   probes itself.
4. Probe evidence is persisted as `child_evidence` for QA visibility.

The current implementation has supporting pieces but not the connected path.
The State Ledger supports `probing` and `child_evidence`; `imm-code-review`
and `imm-arch-explorer` provide host-facing envelope patterns. `imm-work.py`
does not yet parse or act on Step-level `parallel_probes`.

## Requirements

- **R1. Plan annotation preservation**: Plan parsing and runtime sync preserve
  optional `parallel_probes` annotations on normalized Steps and active ledger
  entries.
- **R2. Work probe helper**: A host-bound helper builds deterministic probe
  invocation envelopes from the active Step without calling provider tools.
- **R3. Read-only boundary**: Probe packets use `generalPurpose`, read-only
  instructions, `tool_policy: no tools`, and an advisory-only boundary.
- **R4. Outcome normalization**: Probe attempts are normalized into success,
  dispatch failure, or timeout outcomes with explicit fallback reasons.
- **R5. State transition**: `imm-work continue` moves an active Step with
  probes through `probing` before executor routing.
- **R6. Evidence handoff**: Probe results are persisted as `child_evidence`
  and exposed in the active Step context for the executor.
- **R7. Solo fallback**: If dispatch is unavailable or a probe fails, the
  executor continues with sequential inline investigation and the fallback
  reason is recorded.
- **R8. Contract truth**: Skill docs describe the exact runtime sequence and
  keep executor and QA authority unchanged.

## Non-goals

- No shared subagent registry or generic dispatcher.
- No parallel execution of multiple plan Steps.
- No background queue or cross-session scheduler.
- No agent-to-agent communication.
- No probe authority to edit code, mutate plans, update `.imm/memory/`
  directly, or close QA.
- No end-to-end unit test that invokes Codex `spawn_agent` or Cursor `Task`;
  provider calls stay represented by deterministic envelopes and fake
  outcomes.

## Acceptance

- Plan validation and runtime sync preserve `parallel_probes`.
- `imm-work` can expose deterministic probe envelopes for an active Step.
- Probe outcomes can be normalized and stored as `child_evidence`.
- `imm-work continue` routes probe-ready Steps through the intended state
  boundary before executor work.
- Contract tests prove that `imm-work`, `imm-planner`, and `imm-executor`
  describe runtime truth rather than prompt-only intent.
- Focused tests pass without introducing shared dispatcher behavior.
