---
title: "fix(runtime): add stale global wrapper retirement path"
type: fix
status: proposed
date: 2026-06-08
origin: imm-arch-explorer candidate 2
---

# Iteration Plan

## Task

- Summary: Add a safe explicit retirement path for stale global imm-plan wrappers.
- Origin: User selected architecture exploration candidate 2 for stale global `imm-plan` wrapper cleanup.
- Spec: docs/specs/archive/stale-global-wrapper-retirement.spec.md
- Research: `imm-heal` currently reports PATH `/Users/derek/.local/bin/imm-plan` as stale because it does not expose `--sync`, while `plugins/immune-brain/bin/imm-plan --help` exposes `--sync`. The stale wrapper contains managed-copy markers including `imm-install-mode: copy`, `imm-install-family: agent-skills`, and `imm-install-runtime-root`. The prior `docs/specs/archive/stale-global-imm-plan-sync.spec.md` and `docs/plans/2026-05-27-002-fix-stale-global-imm-plan-sync-plan.md` completed warning and supported sync exposure, so this is a new follow-up slice rather than an append. `CONTEXT.md` defines Plan, Step, Spec, Skill, State Ledger, and plugin-local runtime vocabulary.
- Decisions: D1 use a new slice because the prior stale-wrapper plan is historically completed. D2 provide dry-run by default and require explicit apply for any user-file mutation. D3 only act on wrappers with known Immune-Brain managed-copy markers. D4 preserve plugin-local runtime and MCP as the supported source of truth. D5 keep health checks non-destructive.
- Assumptions: The current global wrapper shape is representative of the stale managed-copy install family. Tests can simulate eligible and ineligible wrappers in temporary directories. The implementation can choose a script or runtime helper as long as the user-facing path is deterministic.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; this is a small single-domain runtime maintenance slice and local evidence is sufficient.

## Devil's Advocate Audit

1. **Rollback Resilience**: The slice should add a bounded retirement helper plus tests and warning text. If the helper is too aggressive, revert the helper, the heal wording change, tests, this Plan, and the Spec. No State Ledger migration or user-home mutation is required during verification.
2. **Verification Vanity**: Tests must exercise dry-run and apply behavior against temp-directory wrappers. A text-only grep for warning wording is not enough. Verification should prove that unmarked user files are refused and plugin-local `imm-plan --help` still exposes `--sync`.
3. **Spec Dilution Detection**: The selected candidate was to clean or replace the stale global wrapper, not merely repeat the existing warning. The Plan keeps that outcome but narrows mutation to explicit apply mode and known managed-copy markers so user files are not silently changed.

## Planning Quality Gate

- contract surface: `.imm/imm-heal.py`, `plugins/immune-brain/dist/.imm/imm-heal.py`, `tests/test_immune_brain_plugin_package.py`, plugin-local `plugins/immune-brain/bin/imm-plan`, and the chosen retirement helper.
- compatibility: Existing Plans, Specs, State Ledger files, and plugin MCP tools need no migration. Legacy wrappers remain untouched unless apply mode is explicitly requested.
- interruption recovery: If execution stops after adding detection but before apply support, dry-run guidance remains safe and `imm-heal` can continue warning.
- rollback path: Revert the new Spec, this Plan, the retirement helper, heal warning changes, package parity copy, and focused tests.
- verification strength: Use temp-directory unit tests for wrapper eligibility and apply behavior, plus direct `imm-heal` and plugin-local help smoke checks.
- Brainstorm traceability: not applicable because origin is an architecture explorer candidate selection.

## Steps

### Step 1

- Step ID: U1
- Result: Stale global imm-plan wrapper retirement path is tested
- Verification: `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_immune_brain_mcp_runtime && python3 .imm/imm-heal.py`
- Verification type: automated
- Test scenarios: Dry-run reports an eligible managed-copy wrapper; Apply mode requires explicit opt-in; Unmarked user wrapper is refused; Heal warning names the retirement path; Plugin-local imm-plan help still exposes sync.
- Discovery cache: .imm/imm-heal.py (health warning surface); plugins/immune-brain/dist/.imm/imm-heal.py (packaged health warning surface); tests/test_immune_brain_plugin_package.py (wrapper and package contract tests); plugins/immune-brain/bin/imm-plan (supported CLI wrapper); docs/specs/archive/stale-global-wrapper-retirement.spec.md (accepted behavior)
- Depends on: none
- failure_behavior: If apply behavior cannot be made safe for user-owned files, keep only dry-run reporting and return to planner for a narrower non-mutating cleanup slice.
- security_considerations: The helper must avoid following unrelated user scripts or symlinks and must never mutate paths that lack Immune-Brain managed-copy markers.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-08-001-fix-stale-global-wrapper-retirement-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-08-001-fix-stale-global-wrapper-retirement-plan.md --sync`

## Notes

- This Plan intentionally does not implement the retirement helper.
- After validation and runtime sync, continue through `imm-work` for Step 1.
