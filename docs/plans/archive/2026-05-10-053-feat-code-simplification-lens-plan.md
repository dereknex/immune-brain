---
title: "feat: code simplification lens for imm-code-review"
type: feat
status: planned
date: 2026-05-10
origin: "brainstorm + preplan-review analyzing addy code-simplification and CE ce-simplify-code for Immune-Brain adoption"
---

# Iteration Plan

## Task

- Summary: Add a **code simplification reference index** under `docs/reference/` and wire it into **imm-code-review** as a simplification lens via the existing Progressive checklists mechanism. No new skill; findings stay within `imm-code-review` authority.
- Origin: `/imm-brainstorm` compared addy `code-simplification` (principles, Chesterton's Fence, pattern tables) with CE `ce-simplify-code` (scope resolution, 3 parallel reviewers, verification contract). `/imm-preplan-review` confirmed Hold Scope: two-file change, no new authority role.
- Research: Reviewed `imm-code-review` (Progressive checklists pattern already links `agent-quality-checklists.md`), `imm-executor` Rationalizations (already covers adjacent cleanup), IMMUNE §3 write boundaries (simplify does not warrant independent authority), both upstream SKILL.md files for extractable structure.
- Decisions: D1 thin index at `docs/reference/code-simplification-checklist.md` linking submodule full texts; D2 trigger inside `imm-code-review` Progressive checklists bullet, not a separate workflow stage; D3 no change to `imm-executor` (existing rationalization suffices); D4 scope resolution priority order (user-specified → git diff base → git diff HEAD) documented in index, not in skill body.
- Assumptions: Both submodule paths are checked out and stable.

## Steps

### Step 1

- Step ID: U1
- Result: **Code simplification reference index** ships at `docs/reference/code-simplification-checklist.md` covering spec §2.1 requirements (scope resolution priority + three-lens dimensions + when-not-to-simplify boundary + submodule links + Immune-Brain authority declaration).
- Verification: File exists; contains all six content blocks from spec §2.1; `ls upstreams/addy-agent-skills/skills/code-simplification/SKILL.md upstreams/compound-engineering/plugins/compound-engineering/skills/ce-simplify-code/SKILL.md` confirms both submodule targets reachable; `python3 -m unittest tests.test_skill_contracts` passes.
- Agent Hint: imm-executor
- Test scenarios: Covers spec §2.1 + §3 bullets 1 + 3 + 4
- Depends on: none

### Step 2

- Step ID: U2
- Result: **imm-code-review** Progressive checklists references the new simplification lens index with trigger condition for branch-diff scope reviews.
- Verification: `skills/imm-code-review/SKILL.md` Progressive checklists section contains `code-simplification-checklist.md` path plus trigger condition text; `python3 -m unittest tests.test_skill_contracts` passes; `imm-code-review` Boundary section unchanged.
- Agent Hint: imm-executor
- Test scenarios: Covers spec §2.2 + §3 bullet 2
- Depends on: 1
