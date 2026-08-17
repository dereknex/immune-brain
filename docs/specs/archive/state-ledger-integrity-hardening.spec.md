# State Ledger Integrity Hardening

## Origin

`imm-code-review` on State Ledger v2 implementation (plans 068 + 069).
Findings routed as `direct_fix` from unified review synthesis.

## Problem

1. **heal_current_iteration reopens closed steps**: When `recovered_different_plan=True` or a dependency appears unmet due to plan renumbering, the v2 heal path resets already-closed steps to `pending` and discards their evidence. Closed steps represent verified completed work and must not be reopened by the healer.

2. **Migration gate too strict**: `can_migrate_v1` requires `validated_plan_snapshot.steps` to be non-empty. States with real completed work but a stale/empty snapshot are permanently blocked from v2 migration, even though `migrate_v1_to_v2` can load the plan from disk.

3. **Force-activate discards evidence silently**: `v2_force_activate_step` resets the previously active step to `pending` and drops its `execution_evidence` and `activated_at` without recording a history entry for what was lost.

4. **Redundant v1/v2 dispatch conditionals**: `derive_active_step` and `derive_completed_steps` already handle v1 internally, but 14 call sites in `imm-work.py` redundantly wrap them with `if iter_mod.is_v2(state)` checks.

## Accepted Behavior

- `heal_current_iteration` v2 path must skip steps whose state is `"closed"` when applying the `recovered_different_plan` or `missing_dependencies` reset logic.
- The migration guard must also attempt migration when a loadable plan file exists on disk (matching `state["plan_path"]`), not only when the snapshot contains steps.
- `v2_force_activate_step` must append a history entry recording the deactivated step number and that evidence was discarded.
- All redundant `if iter_mod.is_v2(state)` wrappers around `derive_active_step` / `derive_completed_steps` must be removed, using the functions directly.

## Non-Goals

- Atomic file writes (separate `new_slice` — requires broader design)
- Corrupt JSON graceful fallback (deferred — low severity)
- Sync cleanup for removed plan steps (low severity, deferred)
