---
title: "fix: activation plan cli health check"
type: fix
status: active
date: 2026-05-12
origin: imm-code-review direct_fix finding — legacy-installer check can pass when imm-activation-plan runtime script is missing
---

# Iteration Plan

## Task
- Summary: Make managed install health checks cover the Activation Plan CLI runtime script
- Origin: origin_review from `imm-code-review` after `docs/plans/2026-05-12-074-fix-subagent-activation-install-runtime-plan.md`; finding P2 reported that `imm-activation-plan` executes runtime `.imm/activation_plan.py` while the managed runtime check does not verify that file
- Research: `scripts/legacy-installer.sh` now lists `imm-activation-plan` as a CLI command and its wrapper execs `$RUNTIME_ROOT/.imm/activation_plan.py`; `is_managed_cli_runtime_copy` still checks marker plus `imm-plan.py` / `imm-work.py` / `imm-review.py`, so a partial runtime copy can pass `--check` while the Activation Plan CLI is unusable; `tests/test_install_local.py` verifies the installed command works but does not yet corrupt that runtime dependency before `--check`
- Decisions: D1 use `new_slice` instead of appending to plan 074 because the prior Plan is already completed; D2 keep this as a same-boundary repair over installer health checks and tests only; D3 preserve `Activation Plan` candidate semantics unchanged
- Assumptions: The missing-file regression can be reproduced inside the existing temporary HOME install tests without touching the user's real installed runtime; a single Step is sufficient because the result and verification surface are both localized to install health checks
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `scripts/legacy-installer.sh`, `tests/test_install_local.py`
  - dependencies_known: true
  - verification_path:
      - target: managed install health checks fail when the Activation Plan runtime script is missing
      - method: `python3 -m unittest tests.test_install_local`
  - blockers: none
  - replan_condition: if the fix requires changing activation candidate selection, CLI wrapper shape, or reference artifact ownership

## Steps

### Step 1
- Step ID: U1
- Result: Managed CLI health checks fail when the Activation Plan runtime script is missing
- Verification type: automated
- Verification: `python3 -m unittest tests.test_install_local` exits zero with a regression that removes or omits runtime `.imm/activation_plan.py` and confirms `legacy-installer.sh --check` fails
- Agent Hint: imm-executor
- Test scenarios: complete temporary install still passes `--check`; temporary install with missing runtime `.imm/activation_plan.py` fails `--check`; `imm-activation-plan` remains listed as a managed CLI command
- Depends on: none
- Scope: `scripts/legacy-installer.sh`, `tests/test_install_local.py`
- Replan condition: If detecting the missing script requires broad runtime manifest work or changes outside the installer test surface, stop and return to planner.

## Notes
- This repair intentionally leaves `docs/reference/subagent-dispatch-protocol.md`, `skills/imm-code-review/SKILL.md`, and `.imm/activation_plan.py` out of scope unless the executor discovers a direct dependency during implementation.
