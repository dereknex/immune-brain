---
title: "Architecture Deepening Wave 1"
type: refactor
status: completed
date: 2026-05-16
---

# Plan: Architecture Deepening Wave 1

Consolidate the reviewer framework, decouple the state engine, and introduce a skill registry to improve system maintainability and scalability.

- Summary: Consolidate the reviewer framework, decouple the state engine, and introduce a skill registry to improve system maintainability and scalability.

## Origin
- **Source**: `imm-arch-explorer` candidates
- **Spec**: `docs/specs/architecture-deepening-wave-1.spec.md`

## Research
- `skills/*/SKILL.md` analyzed for metadata.
- `.imm/current_iteration_state.py` analyzed for state transition logic.
- `docs/reference/subagent-trigger-catalog.yaml` analyzed for reviewer mappings.

## Decisions
- Use `skills/registry.yaml` for machine-readable skill metadata.
- Unified skill name will be `imm-advisory-reviewer`.
- Existing shallow reviewer directories will be removed after migration.

## Steps

### Step 1
- Result: Unified Skill Registry created as `skills/registry.yaml` with metadata for all existing skills.
- Verification: `ls skills/registry.yaml` exists and `cat skills/registry.yaml` shows a valid YAML structure containing skill names and roles.
- Discovery cache: skills/ai-eval-planner/SKILL.md (metadata source); skills/api-contract-reviewer/SKILL.md (metadata source)

### Step 2
- Result: State engine extraction complete with `.imm/state_machine.py` as the new transition authority.
- Verification: `pytest tests/test_current_iteration_state.py` passes with no regressions in state transition behavior.
- Discovery cache: .imm/current_iteration_state.py (source for extraction)

### Step 3
- Result: Unified `imm-advisory-reviewer` skill implemented with support for dynamic lenses.
- Verification: `skills/imm-advisory-reviewer/SKILL.md` exists and defines the `lens` field in its Required inputs section.
- Discovery cache: skills/imm-advisory-reviewer/SKILL.md (target)

### Step 4
- Result: Reviewer consolidation complete with unified framework support for all advisory/UI lenses.
- Verification: `pytest tests/test_activation_plan.py` passes; `docs/reference/subagent-trigger-catalog.yaml` updated to use `imm-advisory-reviewer` with lenses.
- Discovery cache: activation_plan.py (dispatch logic); docs/reference/subagent-trigger-catalog.yaml (trigger mapping)
