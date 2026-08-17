---
title: "feat: run completion loop changeset-based UI review trigger"
type: feat
status: proposed
date: 2026-06-25
origin: imm-brainstorm framing - user confirmed changeset-based filtering for UI review trigger
---

# Iteration Plan

## Task

- Summary: Refine `run` completion loop spec and skill contract to dynamically select `imm-ui-review` based on changeset paths and keywords.
- Spec: docs/specs/run-completion-loop.spec.md
- Origin: User requested that `imm-run` should decide whether to call `imm-ui-review` based on the current changeset. Brainstorm framed the specific path/extension rules to skip UI review for non-UI changesets.
- Research: `plugins/immune-brain/dist/run.md` currently coordinates `imm-ui-review` after any UI/visual/interaction changes. `docs/reference/subagent-trigger-catalog.yaml` defines the path globs for UI lenses (such as `.css`, `.scss`, `.tsx`, `.jsx`, component, view, layout, etc.). `tests/test_skill_contracts.py` validates the run completion loop documentation and bounds.
- Decisions: D1 Explicitly define changeset-based filtering for `imm-ui-review` in `run` coordinator. D2 Align UI change criteria with catalog path globs: `.css`, `.scss`, `.html`, `.tsx`, `.jsx`, component, view, layout, style, theme, locale, i18n, and `DESIGN.md`. D3 Require `tests/test_skill_contracts.py` to enforce this changeset-based trigger language in the contract documents.
- Assumptions: Skip UI review when changed files do not match any UI-related paths/extensions. Code review remains triggered by any material logic/test changes.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; this is a straightforward contract/documentation change with defined criteria.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Devil's Advocate Audit

1. **Rollback Resilience**: This change only modifies `docs/specs/run-completion-loop.spec.md`, `plugins/immune-brain/dist/run.md`, `tests/test_skill_contracts.py`, and this plan. Reverting these files returns the system to the previous state with zero side effects on runtime databases or ledgers.
2. **Verification Vanity**: Checking just the word "changeset" in the contract is not enough. The test contract must verify that the run skill contract documents dynamic selection based on changed files or changeset to avoid regression.
3. **Spec Dilution Detection**: We ensure that we do not alter or dilute the primary L2S outer coordination role of `run` or its integration with `imm-autowork` and `imm-code-review`. We only refine the selective trigger logic for UI review.

## Planning Quality Gate

- contract surface: `docs/specs/run-completion-loop.spec.md`, `plugins/immune-brain/dist/run.md`, `tests/test_skill_contracts.py`.
- compatibility: fully backward compatible. No state schema or runtime execution changes are introduced since the actual scheduler logic in `activation_plan.py` already matches these paths, and `run` is guidance-only.
- interruption recovery: if aborted, git checkout returns files to clean status.
- rollback path: git checkout the modified files.
- verification strength: automated unittest suite verification (`python3 -m unittest tests.test_skill_contracts`) and plan schema verification.
- Brainstorm traceability: maps to the brainstorm conclusions that changeset rules must be explicitly added to `run.md` and spec R2.

## Steps

### Step 1

- Step ID: U1
- Result: Changeset-based UI review trigger contract defined
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_contract_is_documented && python3 .imm/imm-plan.py docs/plans/2026-06-25-002-feat-run-ui-review-changeset-trigger-plan.md --json`
- Execution note: test-first
- Test scenarios: Verify that `run.md`, `run-completion-loop.spec.md`, and `tests/test_skill_contracts.py` align on changeset-based dynamic trigger selection.
- Discovery cache: docs/specs/run-completion-loop.spec.md (R2); plugins/immune-brain/dist/run.md (workflow rules); tests/test_skill_contracts.py (unittest)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If unittest fails, refine the phrasing in run.md or spec to match the exact contract regex.
- security_considerations: None
