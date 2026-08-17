---
title: "fix: managed cli runtime ownership health"
type: fix
status: active
date: 2026-05-12
origin: imm-code-review direct_fix finding — health checks and ownership checks are conflated for managed CLI runtime
---

# Iteration Plan

## Task
- Summary: Separate managed CLI runtime ownership from health so damaged runtime installs can self-repair
- Origin: origin_review from `imm-code-review` after `docs/plans/2026-05-12-075-fix-activation-plan-cli-health-check-plan.md`; finding P2 reported that adding `.imm/activation_plan.py` to `is_managed_cli_runtime_copy` makes `--check` strict but also causes reinstall and uninstall to reject an owned runtime that is missing the script
- Research: `is_managed_cli_runtime_copy` is called by `check_cli_install` as a health gate, but also by `prepare_cli_runtime_for_install` and `uninstall_cli_runtime` as an ownership gate; the new `.imm/activation_plan.py` file check is correct for health but too strict for ownership; existing tests cover `--check` failure only and do not cover reinstall or uninstall repair paths for a damaged managed runtime
- Decisions: D1 use `new_slice` because Plan 075 is completed; D2 keep the repair within `scripts/legacy-installer.sh` and `tests/test_install_local.py`; D3 preserve strict `--check` behavior while making install and uninstall marker-based for ownership; D4 avoid changing `Activation Plan` CLI contract or dispatch docs
- Assumptions: The managed runtime marker plus family/kind/source metadata is sufficient to identify installer ownership; repair-path regressions can use the existing temporary HOME install tests without touching the user's real runtime
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `scripts/legacy-installer.sh`, `tests/test_install_local.py`
  - dependencies_known: true
  - verification_path:
      - target: damaged managed CLI runtime can be repaired or uninstalled without manual cleanup while `--check` remains strict
      - method: `python3 -m unittest tests.test_install_local`
  - blockers: none
  - replan_condition: if ownership detection requires a broader runtime manifest migration or changes to CLI wrapper metadata

## Steps

### Step 1
- Step ID: U1
- Result: Damaged managed CLI runtime remains owned by the installer for repair operations
- Verification type: automated
- Verification: `python3 -m unittest tests.test_install_local` exits zero with regressions showing missing runtime `.imm/activation_plan.py` makes `--check` fail but allows reinstall to restore the script and uninstall to remove the runtime
- Agent Hint: imm-executor
- Test scenarios: missing runtime `.imm/activation_plan.py` fails `--check`; reinstall after that damage restores `.imm/activation_plan.py`; uninstall after that damage removes managed wrappers and runtime
- Depends on: none
- Scope: `scripts/legacy-installer.sh`, `tests/test_install_local.py`
- Replan condition: If the repair needs to change `imm-activation-plan` CLI arguments, activation candidate semantics, or reference artifact ownership, stop and return to planner.

## Notes
- This Plan intentionally treats ownership and health as separate installer concepts. `--check` reports health; install and uninstall decide whether the runtime belongs to this installer.
