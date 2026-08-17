# Spec: Project Audit Fixes

## Status: Resolved

All four findings are closed as of 2026-08-01. The legacy reviewer directories
are deleted, and the plan file carries `title`, `status`, and `date`. Findings 2
and 4 named `.imm/imm_core/` and `.imm/imm-compound-debt.py`, which no longer
exist — see `docs/solutions/python-reference-retirement-exception-inventory.md`.
The compound-debt analysis they describe was never ported; `imm-compounder` now
reads `.imm/memory/current_iteration_history.jsonl` for historical evidence.

## Problem Statement
The recent project implementation audit revealed four logical contradictions and missing pieces between the documentation and the current code reality:
1. Legacy reviewer directories (`api-contract-reviewer`, `data-integrity-reviewer`, `reliability-reviewer`, `security-reviewer`) were marked as deprecated and replaced by `imm-advisory-reviewer` in `registry.yaml` and plans, but the directories still exist.
2. The initial state ledger creation (`default_current_iteration()`) in `.imm/imm_core/current_iteration_state.py` returns a v1 schema instead of the v2 per-step ledger schema, causing initial writes to be outdated until auto-migrated.
3. The plan file `docs/plans/architecture-deepening-wave-1.plan.md` lacks the required YAML frontmatter (title, status, date), which breaks parsing for chore scripts.
4. The `.imm/imm-compound-debt.py` script is implemented but not integrated into the `imm-compounder` skill workflow.

## Goal
Fix these inconsistencies to align the codebase strictly with the latest architecture decisions and documentation.

## Requirements
- **Req 1: Remove legacy reviewers.** The directories `skills/api-contract-reviewer/`, `skills/data-integrity-reviewer/`, `skills/reliability-reviewer/`, and `skills/security-reviewer/` must be deleted from the repository.
- **Req 2: Fix state ledger initialization.** Update `.imm/imm_core/current_iteration_state.py` so that `default_current_iteration()` returns `{"schema_version": 2, "steps": {}, "last_review": None, "validated_plan_snapshot": None, "history": [], "requires_replan": False}`.
- **Req 3: Fix plan frontmatter.** Add valid YAML frontmatter (with title, type, status, date) to `docs/plans/architecture-deepening-wave-1.plan.md`.
- **Req 4: Integrate compound debt script.** Update `skills/imm-compounder/SKILL.md` to reference the use of `.imm/imm-compound-debt.py` for backfilling compound debt when running the skill.