# Plan: Fix Plan Status Display Disconnect

- Summary: Fix plan status display disconnect by making build_codex_plan read V2 ledger state and adding healed_at timestamps to ghost closed steps.

## Origin

Analysis of `imm-work.py:build_codex_plan` revealed it derives step display status from a simple `active_step_number == step_number` comparison, ignoring the actual V2 ledger state (`pending`, `active`, `probing`, `executing`, `ready_for_review`, `closed`, `rework_needed`, `replanning`). This causes steps in `replanning`, `rework_needed`, or `ready_for_review` to display as "in_progress" when they require different user action.

## Research

- `build_codex_plan`: `imm-work.py:681-722` — uses `active_step_number == step_number` for "in_progress"
- `derive_active_step`: `current_iteration_state.py:237-272` — maps V2 ledger states to V1 status strings, but `replanning` is not in `ACTIVE_STATES` and thus invisible
- `build_next_action`: `imm-work.py:355-444` — checks `requires_replan` flag first, then `derive_active_step` status for routing
- Heal ghost steps: `heal.py:107-122` — creates `"state": "closed"` entries without evidence or timestamps

## Decisions

1. **Make `build_codex_plan` v2-ledger-aware**: Directly read `state["steps"]` for each plan step's real state, bypassing `derive_active_step` for status determination
2. **Status mapping**: `closed` → `"completed"`, `ready_for_review` → `"in_review"`, `rework_needed` → `"needs_rework"`, `replanning` → `"needs_replan"`, active/probing/executing → `"in_progress"`, pending → `"pending"`
3. **Heal ghost timestamps**: Add `healed_at` timestamp when heal creates closed step entries without evidence
4. **Minimal scope**: Only fix the display disconnect and ghost step timestamp; defer aggregate plan_status field and follow_up dual-track refactor

## Assumptions

- No existing consumers parse `build_codex_plan` output and depend on the current "in_progress" string for replanning/rework states
- The status strings in the plan output are informational/display-only and do not feed back into state transitions

## Devil's Advocate Audit

- **Rollback resilience**: Changes are additive (new status strings, new timestamp field). Rolling back would revert display to old behavior but not corrupt state. The state machine itself is untouched.
- **Verification vanity**: Verification commands actually parse the JSON output and assert specific status strings exist for each state. A step manually set to `replanning` in a test fixture will verify the display shows `"needs_replan"`.
- **Spec dilution detection**: The spec does not include the aggregate `plan_status` field or `pending_follow_up` refactor — these are explicitly deferred as non-goals.

### Step 1

- Result: `build_codex_plan` displays per-step status strings from V2 ledger state for all 6 non-pending states
- Verification: python3 -c "import json, sys; sys.path.insert(0, '.imm'); from imm_core.current_iteration_state import default_current_iteration; from imm_work import build_codex_plan; state = default_current_iteration(); state['plan_path'] = 'docs/plans/_test_fixture_plan.md'; state['validated_plan_snapshot'] = {'summary': 'test', 'steps': [{'number': i, 'step_id': f'U{i}', 'result': f'step {i}', 'verification': 'echo ok', 'depends_on': []} for i in range(1,7)]}; state['steps'] = {'1': {'state': 'closed', 'result': 'closed', 'verification': 'echo ok', 'depends_on': [], 'step_id': 'U1', 'discovery_cache': []}, '2': {'state': 'replanning', 'result': 'replan', 'verification': 'echo ok', 'depends_on': [], 'step_id': 'U2', 'discovery_cache': []}, '3': {'state': 'rework_needed', 'result': 'rework', 'verification': 'echo ok', 'depends_on': [], 'step_id': 'U3', 'discovery_cache': []}, '4': {'state': 'ready_for_review', 'result': 'review', 'verification': 'echo ok', 'depends_on': [], 'step_id': 'U4', 'discovery_cache': []}, '5': {'state': 'executing', 'result': 'active', 'verification': 'echo ok', 'depends_on': [], 'step_id': 'U5', 'discovery_cache': []}, '6': {'state': 'pending', 'result': 'pending', 'verification': 'echo ok', 'depends_on': [], 'step_id': 'U6', 'discovery_cache': []}}; plan = build_codex_plan(state); statuses = {t['step_id']: t['status'] for t in plan['tasks']}; assert statuses['U1'] == 'completed', f'U1: {statuses[\"U1\"]}'; assert statuses['U2'] == 'needs_replan', f'U2: {statuses[\"U2\"]}'; assert statuses['U3'] == 'needs_rework', f'U3: {statuses[\"U3\"]}'; assert statuses['U4'] == 'in_review', f'U4: {statuses[\"U4\"]}'; assert statuses['U5'] == 'in_progress', f'U5: {statuses[\"U5\"]}'; assert statuses['U6'] == 'pending', f'U6: {statuses[\"U6\"]}'; print('All 6 status assertions passed')"
- Step ID: U1
- Depends on: None

### Step 2

- Result: Heal creates ghost closed steps with `healed_at` timestamp to distinguish recovered closures from properly evidenced ones
- Verification: grep -q 'healed_at' .imm/imm_core/heal.py && echo "healed_at field present in heal.py"
- Step ID: U2
- Depends on: None

## Test scenarios

- U1: `build_codex_plan` returns correct display status for all 6 ledger states (closed, replanning, rework_needed, ready_for_review, executing/active/probing, pending)
- U2: Ghost closed step entries created by heal include `healed_at` timestamp
