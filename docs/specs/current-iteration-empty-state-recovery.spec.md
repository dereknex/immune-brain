# Spec: Recover Current Iteration From Durable Memory

## Background

`current_iteration.json` and `state.json` diverged in the latest workspace state:
`state.json.current_iteration` still contains a closed i18n plan run, while
`current_iteration.json` is reset to an empty v2 skeleton. This breaks resume
continuity for `imm-work`/`imm-qa` and makes `imm-dehydrate`/`imm-finish`
handoff bookkeeping unreliable.

## Problem

A valid `state.json` is currently present but no runtime recovery path reads it
when `current_iteration.json` is reset to `{\"schema_version\": 2, \"steps\": {}...}`.
This allows a silent regression to zero active/closed steps, even though the
recent plan snapshot exists in durable memory.

## Requirements

### R1. Recovery fallback from durable memory

- `current_iteration.json` loader should recover a valid `current_iteration`
  object from `.imm/memory/state.json` when canonical current iteration state is
  empty or missing required `plan_path`/`validated_plan_snapshot`.
- Recovery must only accept in-project plan paths and keep existing
  `heal_current_iteration` normalization behavior.

### R2. Explicit recovery signal

- Recovery attempts and outcomes should be reflected in runtime `history`
  (`reason`: `recovered_from_state_json` and/or `recovered_plan_path`) so the
  user can trace why state changed.

### R3. Regression coverage

- Add focused tests proving that when `current_iteration.json` is empty but
  `state.json.current_iteration` contains a prior closed iteration, loader returns
  that recovered state instead of default.
- Add a test that confirms no recovery occurs when `state.json` is missing/invalid
  or plan path is out-of-project.

## Acceptance Criteria

- Loading iteration state in the above scenario returns non-empty `steps` and a
  matching `plan_path` in `current_iteration.json`.
- Recovery path appends a history record and does not drop closed step states.
- Tests in `.imm/imm_core/current_iteration_state.py` coverage verify both positive
  and negative recovery cases.
- Verification command:
  `python3 -m unittest tests/test_current_iteration_state.py -v` passes.

## Non-Goals

- Broad redesign of workflow persistence architecture.
- Cross-project current-iteration migration or history rewrite of past iterations.
- New serialization format for runtime state.
