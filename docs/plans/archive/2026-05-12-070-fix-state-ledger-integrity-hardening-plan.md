# Iteration Plan: State Ledger Integrity Hardening

## Task

- Summary: Harden State Ledger v2 against data-integrity issues found in code review
- Origin: imm-code-review direct_fix findings on plans 068+069
- Scope: .imm/current_iteration_state.py, .imm/imm-work.py, tests/

## Steps

### Step 1

- Step ID: U1
- Result: State Ledger passes data-integrity regression suite covering all four review findings
- Verification: `python3 -m unittest discover -s tests -p "test_state_ledger.py" -v && python3 -m unittest discover -s tests -p "test_imm_*.py" && python3 -m unittest discover -s tests -p "test_skill_contracts.py"` exits zero; new test cases cover: (a) heal does not reopen closed steps when recovered_different_plan=True, (b) migration proceeds when snapshot is empty but plan file is loadable, (c) force-activate appends a history entry for the deactivated step, (d) derive functions are called without redundant is_v2 guards
- Depends on: none
- Execution note: test-first
- Test scenarios: heal_preserves_closed_on_plan_recovery; migration_without_snapshot_uses_disk_plan; force_activate_records_deactivation_history; derive_calls_without_is_v2_guard
