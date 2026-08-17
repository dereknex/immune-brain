# Spec: Subagent telemetry and arbitration integration follow-up

**Task ID**: IMM-SUBAGENTS-003
**Owner**: Planner
**Status**: Draft

## 1. Goal

Close the implementation gap left after the subagent telemetry and arbitration slice: telemetry recording and arbitration behavior must be reachable through executable host-facing paths, not only standalone helpers or tests.

## 2. Context

The prior slice added:

- Optional dispatch telemetry helpers in `.imm/activation_plan.py`.
- A standalone `.imm/review_arbitration.py` helper with stress tests.

`imm-code-review` found two remaining gaps:

- Normal activation planning does not record dispatch telemetry unless a caller opts in manually.
- The arbitration helper is not consumed by any host synthesis path, so `imm-code-review` / `imm-ui-review` behavior can still drift from the tested helper.

## 3. Requirements

### R1. Activation-plan telemetry is wired into an actual execution path

- The activation planning path used by host skills must have a reproducible way to record dispatch attempts by default for review-host usage.
- Recorded events must keep the existing local JSONL shape: `timestamp`, `host_skill`, `split_decision`, `solo_fallback_reason`, `triggered_children`, and `execution_status`.
- Tests must prove both split and solo activation outcomes can be recorded without polluting the repository during tests.

### R2. Arbitration helper is consumed by a host-facing synthesis path

- Child-reviewer findings must flow through a reusable synthesis function or host-facing adapter that calls `.imm/review_arbitration.py`.
- Tests must prove the host-facing path preserves non-conflicting findings and reports unresolved grouped conflicts.
- The integration must not introduce real child dispatch, background scheduling, or a shared reviewer registry.

## 4. Non-Goals

- Do not build a dashboard, remote telemetry backend, or UI.
- Do not change trigger catalog rules or child reviewer trigger surfaces.
- Do not implement real `spawn_agent` / Task-tool dispatch in this slice.
- Do not rewrite the completed `080` plan history.
