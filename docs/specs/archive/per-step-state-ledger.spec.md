# Spec: Per-Step State Ledger

## Summary

Replace the single-slot `active_step` + flat `completed_steps` list in `current_iteration.json` with a per-step state ledger that tracks each step's lifecycle independently, enabling future parallel step execution while maintaining backward compatibility with existing state files.

## Accepted behaviors

1. **Per-step state map**: `current_iteration.json` carries a `steps` object keyed by step number, where each entry holds the step's current state, evidence, and timestamps.

2. **State enum**: Each step transitions through a defined set of states with validated transitions:
   - `pending` → `active` (activation)
   - `active` → `probing` (parallel_probes dispatched)
   - `probing` → `executing` (probes complete, executor begins)
   - `active` → `executing` (no probes, direct execution)
   - `executing` → `ready_for_review` (evidence recorded)
   - `ready_for_review` → `closed` (QA pass)
   - `ready_for_review` → `rework_needed` (QA rework)
   - `rework_needed` → `executing` (rework begins)
   - `active` | `executing` | `ready_for_review` → `replanning` (QA replan)

3. **Transition enforcement**: `current_iteration_state.py` exposes a `transition_step(step_number, target_state)` function that rejects illegal transitions with a clear error.

4. **Backward compatibility**: The loader detects old-format files (containing `active_step` key without `steps` map) and silently migrates them to the new schema on first load. The migrated state preserves all information: `completed_steps` become entries with state `closed`, `active_step` becomes the entry at its current status.

5. **Derived convenience fields**: `active_step` and `completed_steps` remain computable from the ledger for backward-compatible tool output (e.g. `status --json`), but are no longer the source of truth for writes.

6. **Multiple active steps (future-ready)**: The schema allows more than one step to be in `active`/`probing`/`executing` simultaneously when their `depends_on` sets are satisfied. Current tooling still enforces single-active for now, but the constraint lives in policy code, not in schema shape.

7. **Probing sub-state**: When `imm-work` dispatches parallel_probes, the step transitions to `probing`. Probe results are stored on the step entry. When all probes complete (or fallback is recorded), the step transitions to `executing`.

## Non-goals

- File-level locking or CAS for concurrent write protection (deferred)
- Append-only event log as canonical state (deferred; `history` array remains supplementary)
- Actual parallel step dispatch by `imm-autowork` (deferred; schema supports it but tooling won't activate it)

## Schema shape (target)

```json
{
  "plan_path": "docs/plans/...",
  "plan_summary": "...",
  "plan_signature": "...",
  "plan_last_validated_at": "...",
  "steps": {
    "1": {
      "step_id": "U1",
      "state": "closed",
      "result": "...",
      "verification": "...",
      "depends_on": [],
      "activated_at": "...",
      "closed_at": "...",
      "execution_evidence": { ... }
    },
    "2": {
      "step_id": "U2",
      "state": "executing",
      "result": "...",
      "verification": "...",
      "depends_on": [1],
      "activated_at": "...",
      "probe_results": null,
      "execution_evidence": null
    }
  },
  "last_review": { ... },
  "history": [ ... ],
  "requires_replan": false,
  "schema_version": 2
}
```

## Migration contract

- Old format detected by: presence of `active_step` key AND absence of `steps` key AND absence of `schema_version` key.
- Migration is lossless: all old fields map to new fields.
- After migration, old `active_step` and `completed_steps` keys are removed from the persisted file.
- If migration fails (corrupt data), fall back to `default_current_iteration()` with a history record explaining the reset.

## Test scenarios

- Load an old-format `current_iteration.json` → produces valid new-format state with correct step states.
- Attempt illegal transition (e.g. `pending` → `ready_for_review`) → raises ValueError.
- Activate two independent steps (depends_on satisfied) → both reach `active` (future-ready, currently gated by policy).
- `status --json` output still contains `active_step` and `completed_steps` for backward-compatible consumers.
- Record execution evidence → step transitions from `executing` to `ready_for_review`.
- QA pass → step transitions from `ready_for_review` to `closed`.
