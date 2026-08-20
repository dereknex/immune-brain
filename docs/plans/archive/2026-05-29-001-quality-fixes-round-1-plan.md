---
title: "fix: quality fixes round 1 - test regression, missing mise task, stale IMMUNE.md"
type: fix
status: active
date: 2026-05-29
origin: Project usage analysis (2026-05-29) — 10 improvement areas identified, top 3 actionable items selected
---

# Iteration Plan

## Task
- Summary: Fix test_imm_init.py AttributeError, add missing `check-install` mise task, and update IMMUNE.md to reflect workflow evolution since v1.0.0
- Spec: docs/specs/archive/quality-fixes-round-1.spec.md
- Origin: Project usage analysis — test suite shows 1 ERROR (523/1), README.md references undefined mise task, IMMUNE.md unchanged since 2026-05-05 despite six weeks of workflow additions
- Research: `tests/test_imm_init.py:52` references `self.module.AGENTS_SECTION_START`; `skills/imm-init/scripts/init_project.py:10` exports `START`. `mise.toml` defines five tasks but lacks `check-install` which README.md:154 references. `IMMUNE.md` is at v1.0.0 (2026-05-05); post-v1.0.0 additions include autowork checkpoint boundaries (2026-05-27), parallel probes runtime (2026-05-22), validate-only plan command + --sync (2026-05-25), gstack quality ceiling protocol (2026-05-24), and host-bound evidence loops (2026-05-24). BASELINE.md dual-copy concern was checked — files are identical (md5 c7b36cf0).
- Decisions: D1 fix test to use `START` rather than renaming the constant (START/END pair is the established pattern). D2 `check-install` task checks skill symlink + plugin manifests, not duplicating `check-plugin`. D3 IMMUNE.md update is additive — preserves all existing role boundaries while documenting new workflow states that already exist in runtime.
- Assumptions: No active plan blocks this work (State Ledger: all steps closed). The `check-install` task does not need to replicate `check-plugin`. IMMUNE.md update does not change role authority boundaries.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `tests/test_imm_init.py`, `skills/imm-init/scripts/init_project.py`, `mise.toml`, `IMMUNE.md`, `tests/test_skill_contracts.py`
  - compatibility: no migration needed; existing tests, tasks, and contract assertions remain valid
  - interruption_recovery: each Step touches isolated files; partial execution leaves valid repo state
  - rollback_path: revert the touched files per Step
  - verification_strength: unittest for Steps 1 and 3; `mise run` exit code for Step 2; contract test guard for Step 3
  - blockers: none
  - replan_condition: if contract tests reveal IMMUNE.md phrasing constraints tighter than anticipated, split Step 3 into smaller updates
- Devil's Advocate Audit:
  - rollback_resilience: Each Step touches isolated files with no cross-dependencies. Step 1 is a one-line fix (revert trivial). Step 2 adds a task definition — no existing tasks depend on it. Step 3 is documentation — revert is a git revert.
  - verification_vanity: Step 1 test currently fails (AttributeError) — passing proves the fix. Step 2 either runs or mise reports "no task" — binary signal. Step 3 contract tests assert specific phrases in IMMUNE.md — can fail if required phrases are missing.
  - spec_dilution_detection: R1 and R2 are exact matches to spec requirements. R3 is constrained to five specific workflow additions; broader IMMUNE.md restructuring is deferred. No requirement was silently narrowed.

## Steps

### Step 1
- Step ID: U1
- Result: `test_existing_claude_file_gets_one_bounded_section` passes because the test references `self.module.START` instead of the non-existent `self.module.AGENTS_SECTION_START`
- Verification: `python3 -m unittest tests.test_imm_init` exits zero with 2 tests OK
- Test scenarios: test_bootstrap_creates_discovery_navigation_templates still passes; test_existing_claude_file_gets_one_bounded_section passes (was ERROR)
- Discovery cache: tests/test_imm_init.py (test assertion to fix); skills/imm-init/scripts/init_project.py (source of truth for exported constants)
- Depends on: none

### Step 2
- Step ID: U2
- Result: `mise.toml` gains a `check-install` task aligned with the README.md description of skill installation verification
- Verification: `mise run check-install` exits zero; `mise tasks ls` includes `check-install`
- Test scenarios: mise run check-install exits zero; mise tasks ls output includes check-install; task description mentions skill installation status
- Discovery cache: mise.toml (existing tasks for pattern reference); README.md:154 (documents expected behavior)
- Depends on: none

### Step 3
- Step ID: U3
- Result: IMMUNE.md reflects the five workflow additions since v1.0.0 while preserving all existing role boundaries
- Verification: `python3 -m unittest tests.test_skill_contracts` passes; manual review confirms the five new workflow concepts are present in IMMUNE.md
- Test scenarios: tests.test_skill_contracts passes (no regression on existing contract guards); IMMUNE.md contains references to imm-autowork, parallel probes, validate-only, --sync, gstack quality ceiling, host-bound evidence loop; all existing role boundaries preserved; IMMUNE.md version bumped to v1.1.0
- Discovery cache: IMMUNE.md (current v1.0.0 content); tests/test_skill_contracts.py (existing contract assertions on IMMUNE.md); docs/reference/gstack-quality-ceiling-protocol.md (quality ceiling protocol reference); plugins/immune-brain/dist/imm-autowork.md (autowork contract); docs/specs/archive/imm-work-parallel-probes-runtime.spec.md (parallel probes spec)
- Depends on: none
