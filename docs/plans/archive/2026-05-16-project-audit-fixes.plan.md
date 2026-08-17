---
title: "fix: Project Audit Fixes"
type: fix
status: planned
date: 2026-05-16
origin: Project implementation audit
---

# Iteration Plan

## Task
- Summary: Remove deprecated reviewer skills, fix state ledger schema initialization, repair plan frontmatter, and document compound debt script integration.
- Origin: Project implementation audit on 2026-05-16
- Research: Reviewed `skills/registry.yaml` for deprecated skill mappings, analyzed `.imm/imm_core/current_iteration_state.py` for v1 vs v2 initialization logic, and verified missing frontmatter in `docs/plans/architecture-deepening-wave-1.plan.md`.
- Decisions: D1 Delete the four deprecated reviewer directories. D2 Change `default_current_iteration()` to return the v2 schema dictionary. D3 Add valid YAML frontmatter to the broken plan file. D4 Update `skills/imm-compounder/SKILL.md` to mention the compound debt script.
- Assumptions: Deleting the directories will not break existing tests as their dispatch logic was already migrated to `imm-advisory-reviewer`.

## Steps

### Step 1
- Step ID: U1
- Result: The four deprecated reviewer directories are deleted from `skills/`.
- Verification: `ls skills/` does not show the deleted directories and `pytest tests/` still passes.
- Depends on: none

### Step 2
- Step ID: U2
- Result: `default_current_iteration()` in `.imm/imm_core/current_iteration_state.py` returns the v2 schema object by default.
- Verification: `cat .imm/imm_core/current_iteration_state.py | grep '"schema_version": 2'` exists inside the `default_current_iteration` function, and `pytest tests/test_current_iteration_state.py tests/test_imm_plan.py tests/test_imm_work.py` passes.
- Depends on: none

### Step 3
- Step ID: U3
- Result: YAML frontmatter is added to `docs/plans/architecture-deepening-wave-1.plan.md`.
- Verification: `head -n 10 docs/plans/architecture-deepening-wave-1.plan.md` shows the `---` blocks with `title`, `status`, and `date` fields.
- Depends on: none

### Step 4
- Step ID: U4
- Result: `skills/imm-compounder/SKILL.md` is updated to include instructions on using `.imm/imm-compound-debt.py` for handling compound debt backfills.
- Verification: `grep 'imm-compound-debt.py' skills/imm-compounder/SKILL.md` returns matches showing the script is documented.
- Depends on: none