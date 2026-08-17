---
title: "fix: BASELINE.md install coverage"
type: fix
status: active
date: 2026-05-12
origin: imm-brainstorm framing — BASELINE.md missing from deployed skill root
---

# Iteration Plan

## Task
- Summary: Make legacy-installer.sh copy, check, and uninstall skills/BASELINE.md so the shared skill baseline is reachable at runtime
- Origin: Post-closure brainstorm — agents on target projects report `../BASELINE.md` not found at `plugin skill registry/BASELINE.md`
- Research: `legacy-installer.sh` copies each `skills/<name>/` directory individually (line 771: `cp -R "${skill_dir}" "${target_link}"`). `skills/BASELINE.md` is a sibling file in `skills/`, not a subdirectory, so the loop never reaches it. The `check_install` function verifies only the per-skill directories. `uninstall_skills` removes only the per-skill directories. The fix is localized to `scripts/legacy-installer.sh` and `tests/test_install_local.py`.
- Decisions: D1 copy unconditionally (no separate managed-copy marker file for a standalone target — the path is exclusively script-owned); D2 check via a dedicated `check_baseline_file` call inside the check action; D3 uninstall removes the file only when it exists as a regular file; D4 test asserts presence post-install and absence post-uninstall
- Assumptions: No other tooling places a file at `plugin skill registry/BASELINE.md`; symlink mode is not in active use (copy mode is the default and only tested mode)
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `scripts/legacy-installer.sh`, `tests/test_install_local.py`
  - dependencies_known: true
  - verification_path:
      - target: `plugin skill registry/BASELINE.md` exists after install; check passes; absent after uninstall; tests pass
      - method: `python3 -m unittest tests.test_install_local`
  - blockers: none
  - replan_condition: if another tool is found to own `plugin skill registry/BASELINE.md` and conflicts with unconditional copy/delete

## Steps

### Step 1
- Step ID: U1
- Result: The install script manages `plugin skill registry/BASELINE.md` as a copy-installed artifact with --check verification plus --uninstall removal covered by automated tests
- Verification: `python3 -m unittest tests.test_install_local` exits zero; new test assertions for `BASELINE.md` presence post-install plus absence post-uninstall are included in the passing run
- Test scenarios: baseline file present after default copy install; baseline file present after --copy install; --check reports success with baseline present; --check reports failure when baseline absent; baseline file absent after --uninstall
- Depends on: none
- Scope: `scripts/legacy-installer.sh`, `tests/test_install_local.py`
