# Spec: Plan Status Update Disconnect

## Behavior

The display layer (`build_codex_plan`) and the execution routing layer (`build_next_action`) derive plan/step status independently, causing user-visible status to diverge from actual runtime state.

## Accepted behaviors

1. `build_codex_plan` MUST read each step's actual V2 ledger state (`state["steps"][key]["state"]`) instead of comparing `active_step_number == step_number`.
2. When `requires_replan` is True, `build_codex_plan` MUST reflect this — steps in `replanning` state display as `"needs_replan"` rather than `"in_progress"`.
3. Steps in `rework_needed` state display as `"needs_rework"` rather than `"in_progress"`.
4. Steps in `ready_for_review` state display as `"in_review"` rather than `"in_progress"`.
5. The `derive_active_step` v1 compatibility function MUST include `replanning` in its status map if a replanning step is considered active, OR `build_codex_plan` MUST bypass `derive_active_step` entirely and read ledger state directly.
6. Ghost closed steps created by `heal.py` (line 111) MUST include a `healed_at` timestamp to distinguish recovered closures from properly evidenced ones.
7. `build_next_action` MUST check the V2 ledger state directly for `replanning` instead of relying solely on the `requires_replan` flag, since a step can be in `replanning` without `requires_replan` having been persisted yet.

## Non-goals

- Adding a top-level `plan_status` aggregate field (deferred to a follow-up)
- Refactoring the `pending_follow_up` dual-track state (separate concern)
- Changing the state machine transitions themselves

## Verification

- `build_codex_plan` output shows correct status per step for: closed, in_progress (executing/active/probing), in_review (ready_for_review), needs_rework, needs_replan, pending
- Ghost closed steps from heal include `healed_at` timestamp
- `imm-work status --json` output reflects actual ledger state for all steps
