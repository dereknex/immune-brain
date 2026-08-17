---
date: 2026-07-03
topic: autorun-boundary-simplification
status: planned
---

# Autorun Boundary Simplification Spec

## 1. Goal

Make the post-Plan autorun model unambiguous: `imm-loop` is the sole user-facing strong autorun Skill, while `imm-autowork` remains a backwards-compatible deterministic checkpoint runtime that reports workflow state for `imm-loop` and host adapters.

The improvement should reduce repeated stops at `awaiting_execution_input`, remove stale `can_auto_advance` guidance from active contracts, and prevent `imm-loop` and `imm-autowork` from both claiming host-loop authority.

## 2. Current Problem

The current contract surface creates two competing interpretations:

1. `imm-loop` says it owns the outer completion loop after a validated Plan.
2. `imm-autowork` still describes itself as a user-facing host loop and mentions `can_auto_advance` even though the current TypeScript runtime primarily exposes `stop_reason` snapshots.
3. The registry presents `imm-autowork` as an execute coordinator instead of a checkpoint helper.
4. Users can reasonably expect `imm-loop` to continue through execution input, but the system can still stop and ask for manual `imm-work` continuation.

The desired model is a layered one:

- `imm-work`: one active Step driver and execution evidence recorder.
- `imm-autowork`: checkpoint/status runtime that returns the next boundary.
- `imm-loop`: user-facing coordinator that consumes checkpoints and invokes the correct authority path.

## 3. Requirements

### R1. `imm-loop` is the sole user-facing autorun entry

- `imm-loop` must be documented as the entry users invoke when they want the validated Plan to continue automatically through execution, QA, review gates, same-boundary follow-up, and compounder handoff.
- `imm-loop` must explicitly consume `imm-autowork` snapshots rather than duplicate State Ledger transition logic.
- `awaiting_execution_input` must be described as a continuation boundary for `imm-loop`, not as a user-facing blocker.

### R2. `imm-autowork` is checkpoint-only

- Active contracts must describe `imm-autowork` as a deterministic checkpoint runtime.
- `imm-autowork` may read State Ledger state, activate eligible Steps through existing runtime primitives, consume explicit queues, and report `run_snapshot` fields.
- `imm-autowork` must not claim executor, QA, review, compounder, or user-facing autorun authority.
- Existing CLI and MCP surfaces remain for compatibility.

### R3. Stale active contract language is removed

- Active user-facing docs and skill contracts must stop relying on `can_auto_advance` unless the runtime exposes and tests that field.
- This slice should use `stop_reason`, `next_recommended_skill`, `recommended_authority`, `required_input`, and review gate fields as the active contract.
- Historical solution notes may retain old terminology when they are clearly archival, but current contracts must not instruct new behavior from stale fields.

### R4. Authority boundaries remain intact

- No `imm-autowork-driver` Skill or generic dispatcher is introduced.
- Executor verification is never converted into QA `pass`.
- Reviewers remain read-only.
- Compounder remains a terminal handoff after Plan work, QA, follow-up, and required review gates are closed.

### R5. Tests lock the simplified model

Focused tests must prove:

- `imm-autowork` still returns deterministic checkpoint snapshots.
- `imm-loop` contract says it automatically consumes execution and review boundaries instead of asking users to run manual commands.
- Active registry and documentation no longer position `imm-autowork` as the competing user-facing autorun loop.
- Package and plugin surfaces still expose the compatible checkpoint command.

## 4. Non-goals

- Do not remove the `imm-autowork` CLI or MCP surface in this slice.
- Do not add a new `imm-loop` shell command in this slice.
- Do not redesign the whole Skill registry.
- Do not add a background daemon, scheduler, hidden queue, shared registry, or generic workflow dispatcher.
- Do not rewrite historical plans or archival solution notes solely to remove old terminology.

## 5. Acceptance Criteria

- Active skill contracts, registry entries, README or user manual guidance, and tests present one clear layering: `imm-loop` is user-facing autorun and `imm-autowork` is checkpoint-only.
- `plugins/immune-brain/dist/imm-autowork.md` no longer describes `imm-autowork` as a user-facing host loop or relies on `can_auto_advance` as the active runtime signal.
- `plugins/immune-brain/dist/imm-loop.md` explicitly says it consumes `imm-autowork` snapshots and treats `awaiting_execution_input` as a continuation boundary.
- `plugins/immune-brain/dist/registry.yaml` and `plugins/immune-brain/skills/registry.yaml` no longer market `imm-autowork` as an execute coordinator that competes with `imm-loop`.
- Runtime behavior remains compatible: existing focused Bun tests for autowork continuation, review lifecycle gates, package runtime parity, and loop orchestration pass.
- Plan validation passes for the implementation Plan.
