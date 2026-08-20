---
title: "feat: public release preparation and sync script"
type: feat
status: proposed
date: 2026-05-18
origin: "docs/specs/archive/public-release-engine-sync.spec.md"
---

# Iteration Plan

## Task
- Summary: Prepare Immune-Brain for public release by decoupling the core engine from private project data and providing a synchronization script.
- Origin: docs/brainstorms/2026-05-18-public-release-brainstorm.md
- Brainstorm manifest: BR-REQ-1, BR-REQ-3, BR-DEC-1, BR-DEC-2, BR-OUT-1
- Research: Audited `.imm/*.py` and `scripts/*.sh`. `imm-heal.py` currently has hard requirements for `docs/solutions` and runtime state files. `imm-upstream-sync.py` is submodule-centric but degrades gracefully if `.gitmodules` is missing.
- Decisions: 
    - D1: Refactor `imm-heal.py` to distinguish between "Structural Requirements" (directories) and "Runtime Artifacts" (json files).
    - D2: Use `git-filter-repo` for the sync script to preserve history for the engine.
    - D3: Exclude `upstreams/` and private `docs/` paths.
- Assumptions: Users will have `git-filter-repo` installed if they want to run the sync script; the public repo starts from a filtered clone of the internal repo.
- Scope Mode: Selective Expansion
- Engineering Closure Check:
  - architecture_surface: `.imm/imm-heal.py`, `scripts/sync-to-public.sh`, `public-release/templates/`
  - dependencies_known: true (git-filter-repo)
  - verification_path: successful sync and validation of the scrubbed repository.
  - blockers: none.
  - replan_condition: if `git-filter-repo` is too complex for simple sync, fall back to `git format-patch`.

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-1 | covered_by_step | U3 | Implement path filtering in sync script |
| BR-REQ-3 | covered_by_step | U3 | Exclude upstreams |
| BR-DEC-1 | covered_by_step | U3 | Use git-filter-repo for sync |
| BR-DEC-2 | covered_by_step | U1 | Patch engine scripts for missing dependencies |
| BR-OUT-1 | out_of_scope | out_of_scope | No auto-pull tools provided |

## Steps

### Step 1
- Step ID: U1
- Result: Engine robustness refactor for `imm-heal.py`
- Verification Type: automated
- Execution note: pragmatic
- Verification: `python3 .imm/imm-heal.py` shows high health after deleting `.imm/memory/state.json`.
- Depends on: none
- Scope: `.imm/imm-heal.py`

### Step 2
- Step ID: U2
- Result: Generic public documentation templates
- Verification Type: automated
- Verification: `ls public-release/templates`
- Depends on: none
- Scope: `public-release/templates/`

### Step 3
- Step ID: U3
- Result: `scripts/sync-to-public.sh` implementation
- Verification Type: automated
- Execution note: pragmatic
- Verification: Script exists and has a `--dry-run` mode to list filtered files.
- Depends on: none
- Scope: `scripts/sync-to-public.sh`

### Step 4
- Step ID: U4
- Result: Validated public-release repository artifact
- Verification Type: automated
- Verification: Run sync script; verify output repo passes `python3 .imm/imm-heal.py` and `mise run legacy-installer --check`.
- Depends on: 1, 3
- Scope: `scripts/sync-to-public.sh`, `.imm/`
