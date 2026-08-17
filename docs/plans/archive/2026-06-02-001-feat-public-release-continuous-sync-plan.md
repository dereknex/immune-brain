---
title: "feat: public release continuous sync and Git preservation"
type: feat
status: proposed
date: 2026-06-02
origin: BR-REQ-1, BR-REQ-2, BR-DEC-1, BR-OUT-1, BR-Q-1
---

# Iteration Plan

## Task
- Summary: Refactor `scripts/sync-to-public.sh` to support incremental continuous sync by default, and update `--force` logic to clean target directory while safely preserving its `.git/` folder and metadata.
- Origin: User requested public release repository sync to support continuous synchronization without resetting the directory every time.
- Spec: docs/specs/public-release-continuous-sync.spec.md
- Research: Checked `scripts/sync-to-public.sh`. It enforces a non-optional exit and requires `--force` when output directory already exists, and `--force` literally does `rm -rf "$OUTPUT_DIR"`, which wipes out `.git/` version control tracking and configs.
- Decisions:
    - D1: Allow incremental overwrite synchronization by default if `$OUTPUT_DIR` exists and contains `$MARKER_FILE` (`.public-release-artifact`).
    - D2: Implement safe `--force` cleanup using macOS/Linux-compatible `find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +` instead of entire directory wipeout.
    - D3: Keep security check invariants: verify `$MARKER_FILE` presence for existing directory before writing any files.
- Assumptions:
    - Retaining only the `.git/` directory is sufficient for continuous Git history tracking. Non-whitelisted config files can be recreated from template files.
- Scope Mode: One-step outcome unit
- Engineering Closure Check:
  - architecture_surface: `scripts/sync-to-public.sh`
  - dependencies_known: yes
  - verification_path: automated shell verification of safe cleanup, incremental writes, and security guardrails.
  - blockers: none
  - replan_condition: If directory layout permissions block BSD/GNU find cleanup.

### Devil's Advocate Audit
1. **Rollback Resilience**: If mid-step synchronization fails, the shell script halts with `set -euo pipefail`. Because we keep `.git/` intact, restoring the previous commit using standard Git tools (`git checkout .` / `git clean -fd`) is instantly available.
2. **Verification Vanity**: The step verification is designed to run actual target folder sync simulations: checks that a dummy untracked file is preserved during incremental sync, deleted during `--force` sync, and `.git/` survives both runs, guaranteeing they are not vanity assertions.
3. **Spec Dilution Detection**: All brainstorm requirements (`BR-REQ-1`, `BR-REQ-2`, `BR-DEC-1`) are fully implemented and checked in the single outcome unit. No compromises on robustness.

### Brainstorm manifest
| ID | Type | Description |
|:---|:---|:---|
| **BR-REQ-1** | Requirement | Support default incremental sync without `--force` when target directory exists and contains `$MARKER_FILE`. |
| **BR-REQ-2** | Requirement | Redefine `--force` behavior to do a clean reset preserving `.git/` directory and its versioning histories. |
| **BR-DEC-1** | Decision | Preserve all safety guardrails (directory checks and `$MARKER_FILE` verification) to avoid pollution. |
| **BR-OUT-1** | Out of Scope | No git commits or pushes are automated within the synchronization shell engine. |
| **BR-Q-1** | Open Question | Confirming only `.git/` is exempted from force deletion. Yes, confirmed. |

### Brainstorm Trace
| ID | Status | Description |
|:---|:---|:---|
| **BR-REQ-1** | covered_by_step | Addressed in Step 1 (U1). |
| **BR-REQ-2** | covered_by_step | Addressed in Step 1 (U1). |
| **BR-DEC-1** | captured_as_decision | Mapped to Decision D3 and verified in Step 1 (U1). |
| **BR-OUT-1** | out_of_scope | Retained as pure file sync with no Git commands automated. |
| **BR-Q-1** | resolved_as_assumption | Exempting only `.git/` is sufficient for repository continuity. |

## Steps

### Step 1
- Step ID: U1
- Result: Sync script supports Git-preserving continuous sync
- Verification type: automated
- Verification: `rm -rf /tmp/test-pub-sync && mkdir -p /tmp/test-pub-sync/.git && touch /tmp/test-pub-sync/.git/HEAD && touch /tmp/test-pub-sync/.public-release-artifact && touch /tmp/test-pub-sync/user_mod.txt && bash scripts/sync-to-public.sh --output-dir /tmp/test-pub-sync && test -f /tmp/test-pub-sync/README.md && test -f /tmp/test-pub-sync/user_mod.txt && test -f /tmp/test-pub-sync/.git/HEAD && bash scripts/sync-to-public.sh --output-dir /tmp/test-pub-sync --force && test -f /tmp/test-pub-sync/README.md && test -f /tmp/test-pub-sync/.git/HEAD && ! test -f /tmp/test-pub-sync/user_mod.txt && python3 -m unittest tests.test_immune_brain_plugin_package`
- Test scenarios: 
    - Incremental Sync Check: sync without `--force` on an existing safe target. Verify new files (e.g. `README.md`) are synced, existing untracked file (`user_mod.txt`) is preserved, and `.git/` is intact.
    - Clean Force Sync Check: sync with `--force`. Verify new files are synced, `.git/` is preserved, and untracked file (`user_mod.txt`) is deleted.
    - Regression Check: run all packaged plugin suite unit tests.
- Discovery cache: scripts/sync-to-public.sh (Sync Script)
- Agent Hint: imm-executor
- failure_behavior: Rollback via `git checkout scripts/sync-to-public.sh`.
- security_considerations: Ensure no cleanup commands run on directory paths matching `/` or `$REPO_ROOT` inside the safety checker.
- Depends on: none

## Notes
- Execute via `imm-work` to activate Step 1 after plan validation.
