---
title: "feat: skills baselining batch 2 - reviewers and remaining orchestrators"
type: feat
status: completed
date: 2026-05-10
origin: "docs/brainstorms/imm-brainstorm-skills-baselining-batch-2-2026-05-10.md"
---

# Iteration Plan

- Summary: Baselining the remaining 15 skills to complete the system-wide context reduction.

## Task
- Summary: Refactor the remaining 15 skills to use `skills/BASELINE.md` and the "Role Delta" pattern.
- Origin: Batch 1 success confirmed the efficiency gains. Batch 2 targets high-token skills and the reviewer family.
- Research: Current skill sizes identified `imm-ui-review` (11KB) and `imm-code-review` (9.6KB) as the top targets.
- Decisions: D1 Individual steps for large orchestrators; D2 Singular wording for reviewer batches to satisfy validator; D3 Sequential refactor.
- Assumptions: Shared baseline is sufficient for specialized reviewers.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/*/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path: `wc -c` comparison + contract tests.
  - blockers: none.
  - replan_condition: if baselining breaks specialized reviewer logic.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-ui-review` skill prompt compression
- Verification: Byte-size reduction; contract tests pass.
- Status: completed
- Depends on: none
- Scope: `skills/imm-ui-review/SKILL.md`
- Replan condition: none

### Step 2
- Step ID: U2
- Result: `imm-code-review` skill prompt compression
- Verification: Byte-size reduction; contract tests pass.
- Status: completed
- Depends on: 1
- Scope: `skills/imm-code-review/SKILL.md`
- Replan condition: none

### Step 3
- Step ID: U3
- Result: `imm-pr-fix` skill prompt compression
- Verification: Byte-size reduction; contract tests pass.
- Status: completed
- Depends on: 2
- Scope: `skills/imm-pr-fix/SKILL.md`
- Replan condition: none

### Step 4
- Step ID: U4
- Result: `imm-autowork` skill prompt compression
- Verification: Byte-size reduction; contract tests pass.
- Status: completed
- Depends on: 3
- Scope: `skills/imm-autowork/SKILL.md`
- Replan condition: none

### Step 5
- Step ID: U5
- Result: Reviewer suite Batch A refactor
- Verification: All target skills reference `BASELINE.md`; contract tests pass.
- Status: completed
- Depends on: 4
- Scope: `skills/prompt-contract-reviewer/SKILL.md`, `skills/ai-eval-planner/SKILL.md`, `skills/docs-verifier/SKILL.md`, `skills/debug-investigator/SKILL.md`, `skills/release-readiness-checker/SKILL.md`
- Replan condition: none

### Step 6
- Step ID: U6
- Result: Specialized skill suite Batch B refactor
- Verification: Remaining target skills reference `BASELINE.md`; contract tests pass.
- Status: completed
- Depends on: 5
- Scope: `skills/reliability-reviewer/SKILL.md`, `skills/data-integrity-reviewer/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`, `skills/imm-compounder/SKILL.md`, `skills/imm-init/SKILL.md`
- Replan condition: none

### Step 7
- Step ID: U7
- Result: `tests/test_skill_contracts.py` batch 2 regression pass
- Verification: `python3 -m unittest tests/test_skill_contracts.py`
- Status: completed
- Depends on: 6
- Scope: `tests/test_skill_contracts.py`
- Replan condition: none
