# Iteration Plan: Install Script Refactoring

## Task

- Summary: Refactor `scripts/legacy-installer.sh` — remove dead symlink code, `--copy` flag, and `trim` helper; fix tab indentation; consolidate duplicated prepare and marker ownership functions
- Origin: imm-brainstorm
- Spec: `.imm/specs/legacy-installer-script-refactor.spec.md`

## Research

- `legacy-installer.sh` is 1007 lines; `INSTALL_MODE` is always `"copy"`, making the entire symlink install branch dead code
- `--copy` flag is a documented no-op (sets `INSTALL_MODE` to its default value)
- `trim()` helper is only used in `check_dev_insights_status` (one call site)
- The `--claude` check block (recently added, lines 837-848) uses tab indentation vs. the file's space convention
- `prepare_skill_target_for_install` (directory target) and `prepare_cli_target_for_install` (file target) are structurally identical except for cleanup (`rm -rf` vs `rm`) and the owner check function called
- `is_managed_skill_copy` and `is_owned_cli_runtime_copy` share the same marker-parsing pattern: dir-not-symlink, marker exists, `mode=copy`, parse family/kind fields
- `test_copy_mode_installs_checkable_and_uninstallable_copies` (line 212) passes `--copy` explicitly — must be updated to reflect removal
- Existing `--check` and `--uninstall` symlink detection paths must be preserved for legacy migration

## Decisions

- D1: Remove `INSTALL_MODE` variable entirely — no more dead symlink path
- D2: Remove `--copy` flag from CLI interface (no-op removal)
- D3: Keep symlink detection in `--check` and `--uninstall` intact; only remove the install-time symlink branch
- D4: Consolidate prepare functions with a `target_type` parameter
- D5: Extract a shared `read_install_marker` helper for marker parsing; keep caller-specific validation
- D6: Inline `trim()` into its single call site rather than extracting a shared utility

## Assumptions

- All existing install, check, and uninstall behavior is preserved exactly
- Tests provide adequate regression coverage
- Symlink paths in `--check`/`--uninstall` only apply to legacy installations, which are expected to be rare

## Brainstorm Manifest

| ID | Item | Status |
|---|---|---|
| BR-REQ-1 | Remove dead symlink install branch | covered_by_step |
| BR-REQ-2 | Remove `--copy` flag from arg parsing, usage, and test | covered_by_step |
| BR-REQ-3 | Consolidate is_managed_skill_copy / is_owned_cli_runtime_copy | covered_by_step |
| BR-REQ-4 | Consolidate prepare_skill_target_for_install / prepare_cli_target_for_install | covered_by_step |
| BR-REQ-5 | Fix tab indentation in claude check block | covered_by_step |
| BR-REQ-6 | Remove single-use trim helper | covered_by_step |
| BR-REQ-7 | Preserve legacy symlink detection in check/uninstall | covered_by_step |
| BR-REQ-8 | All existing tests pass after refactoring | covered_by_step |
| BR-DEC-1 | Symlink install mode removed entirely | captured_as_decision |
| BR-DEC-2 | --copy flag removed; copy is the only mode | captured_as_decision |
| BR-OUT-1 | No functional changes or new features | out_of_scope |
| BR-OUT-2 | No architecture change (stays monolithic zsh script) | out_of_scope |
| BR-DEFER-1 | Action dispatch if→case conversion (cosmetic, low value) | deferred |
| BR-DEFER-2 | REFERENCE_FILES relocation to top of file (cosmetic) | deferred |

---

### Step 1

- Step ID: U1
- Result: A clean refactored legacy-installer.sh — dead symlink code removed — `--copy` flag removed — `trim` helper removed — indentation fixed — prepare functions consolidated — marker functions consolidated — all tests pass with no behavior change
- Verification: `python3 -m unittest discover -s tests` passes; no `INSTALL_MODE` or `trim()` in the script; no tab indentation; `--copy` exits non-zero
- Verification type: automated
- Depends on: None

#### U1 Details

Implementation tasks within U1:

1. **Remove dead symlink install code:**
   - Delete `INSTALL_MODE="copy"` declaration (line 37)
   - Delete `--copy)` case from argument parsing loop (lines 812-814)
   - Remove `--copy` description from `usage()` (line 77)
   - Remove the `else` branch (symlink `ln -sfn`) from the install loop (lines 940-943)
   - Remove `if [[ "${INSTALL_MODE}" == "copy" ]]; then` guard (line 936), keep the copy-install path unconditional
   - Remove the same guard from the CLI wrapper install block (line 975)

2. **Fix tab indentation:** Replace tabs with spaces in the `--claude` check block (lines 837-848)

3. **Remove `trim` helper:** Delete the `trim()` function definition (lines 98-103); replace the call site in `check_dev_insights_status` (line 559) with an inline expression

4. **Consolidate prepare functions:** Create `prepare_target_for_install(target_path, source_path, target_type)` that dispatches based on `target_type` (`"skill"`→directory+`is_managed_skill_copy`, `"cli"`→file+`is_managed_cli_copy`), using `rm -rf` for directories and `rm` for files. Update both call sites.

5. **Consolidate marker parsing:** Extract `read_install_marker(target_path, marker_filename)` helper that returns the marker's `mode`, `family`, `kind`. Update `is_managed_skill_copy` and `is_owned_cli_runtime_copy` to use it, keeping their caller-specific name/source validation.

6. **Update test:** Remove `"--copy"` argument from `test_copy_mode_installs_checkable_and_uninstallable_copies` call (line 212)

7. **Run tests:** `python3 -m unittest discover -s tests` — all pass

#### U1 Evidence

- `git diff --stat` confirms expected deletions in `scripts/legacy-installer.sh`
- `grep -n 'INSTALL_MODE' scripts/legacy-installer.sh` returns empty
- `grep -n 'trim()' scripts/legacy-installer.sh` returns empty
- `grep -cn $'\t' scripts/legacy-installer.sh` returns 0
- `scripts/legacy-installer.sh --copy` exits non-zero with usage
- Test suite passes
