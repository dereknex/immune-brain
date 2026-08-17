---
title: fix: clarify role-entrypoint contract
type: fix
status: planned
date: 2026-05-08
origin: user brainstorm and preplan handoff on 2026-05-08
---

# Iteration Plan

## Task
- Summary: Repair the role versus CLI entrypoint contract around `imm-work`, `imm-executor`, and `imm-qa`
- Origin: User request on 2026-05-08 to analyze the current project implementation and produce the best solution for the misleading `imm-executor` / `imm-qa` not installed blockage.
- Research: Checked `IMMUNE.md`, brainstorm output, preplan handoff, `.imm/imm-work.py`, `scripts/legacy-installer.sh`, `scripts/legacy-cli-launcher`, `README.md`, and prior plans/specs for single-step orchestration and workflow entry hygiene. Conclusion: the current issue is contract drift between role names, skill names, and actual CLI entrypoints, not a failed installation.
- Decisions: D1 keep `imm-work` as the default CLI continue entry; D2 treat `imm-executor` and `imm-qa` as authority roles and skills rather than default shell commands; D3 repair machine-readable status and user-facing docs together so automation and humans stop inferring missing commands; D4 avoid adding new default CLI wrappers in this slice.
- Assumptions: Existing workflow callers can consume one extra machine-readable entrypoint field without needing a repository-wide runtime migration; current tests/docs are the main affected surfaces; historical plans do not need rewriting.

## Steps

### Step 1
- Step ID: U1
- Result: 状态输出区分角色入口
- Verification: `.imm/imm-work.py` reports role ownership separately from the concrete continue entry so executor and QA states no longer rely on `next_skill` alone to imply a shell command.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-008 R1; Covers IMM-WORKFLOW-008 acceptance criteria 1
- Depends on: none

### Step 2
- Step ID: U2
- Result: CLI文档收口到单入口
- Verification: `README.md`, `scripts/legacy-installer.sh`, and related workflow help text advertise only supported CLI commands and explain that `imm-executor` / `imm-qa` are entered through `imm-work` role semantics.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-008 R2; Covers IMM-WORKFLOW-008 acceptance criteria 2; Covers IMM-WORKFLOW-008 acceptance criteria 3
- Depends on: 1

### Step 3
- Step ID: U3
- Result: 契约回归具备守卫
- Verification: tests or contract checks cover the repaired role-entrypoint distinction and confirm this slice does not require new default CLI wrappers to pass.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-008 R3; Covers IMM-WORKFLOW-008 acceptance criteria 4
- Depends on: 1, 2

## Notes
- Keep the fix narrow: repair the contract, not the whole workflow architecture.
- Replan if implementation shows a real external dependency on `imm-executor` or `imm-qa` existing as shell commands for current production flows.
