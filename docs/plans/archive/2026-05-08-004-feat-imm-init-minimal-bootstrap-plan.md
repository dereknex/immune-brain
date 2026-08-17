---
title: feat: Plan minimal imm init bootstrap
type: feat
status: planned
date: 2026-05-08
origin: User asked for an `init` skill that bootstraps other projects into the Immune-Brain workflow, then explicitly reduced scope to only the minimum required directories and files
---

# Iteration Plan

## Task
- Summary: Plan a minimal `imm-init` bootstrap so external projects can enter the Immune-Brain workflow with only the required directories and files, without copying local runtime engine files.
- Origin: User brainstorm handoff plus follow-up scope reductions: `init` is for other projects, and it must keep only the smallest required initialization set.
- Research: Checked `IMMUNE.md`, `skills/imm-planner/SKILL.md`, `.imm/templates/iteration-plan-template.md`, `docs/brainstorms/imm-brainstorm-output-2026-05-07.md`, current `MEMORY.md`, and `docs/solutions/imm-workspace-pollution-control-pattern.md`. Conclusion: the minimal reusable bootstrap is project-level entry docs plus durable workflow artifact directories, while `.imm/imm-*.py` and runtime state files should stay out of the target repo.
- Decisions: 1) Scope Reduction: only bootstrap the minimum required directories and files; defer templates, examples, runtime state, and solutions docs. 2) Preserve project hygiene: target projects keep workflow artifacts, not local execution engines. 3) Prefer non-destructive init: reruns create missing artifacts and only add one bounded Immune-Brain section to `AGENTS.md` when absent.
- Assumptions: User-level `imm-*` commands are already installable outside the target repo; runtime state files can be created lazily by later workflow steps; a minimal `IMMUNE.md` is required because planner roles must read it before planning.

## Steps

### Step 1
- Step ID: U1
- Result: 空白外部项目获得最小必需的 Immune-Brain 初始化工件集合。
- Verification: In a blank fixture repo, running the init path creates only `IMMUNE.md`, `AGENTS.md`, `.imm/memory/MEMORY.md`, `.imm/specs/`, `docs/brainstorms/`, and `docs/plans/`; no `.imm/imm-*.py`, `.imm/templates/`, runtime state files, or extra docs are introduced.
- Scope: `skills/imm-init/SKILL.md` and any bootstrap helper/template files strictly required to materialize the minimal artifact set.
- Depends on: none
- Replan_condition: If the bootstrap cannot work without copying this repository's `.imm` execution engine or broader documentation tree into target projects, return to planner and reduce or redesign the contract.

### Step 2
- Step ID: U2
- Result: `imm-init` 的重复执行保持幂等。
- Verification: Running the init path twice, or against a fixture repo that already contains `AGENTS.md`, `IMMUNE.md`, or `.imm/memory/MEMORY.md`, does not overwrite user content, does not duplicate the Immune-Brain entry section, and reports created versus skipped artifacts clearly.
- Scope: `skills/imm-init/SKILL.md`, the bootstrap helper, and focused tests or fixtures covering blank-repo and existing-file cases.
- Depends on: 1
- Replan_condition: If safe handling of existing project docs requires a generalized merge engine or project-type matrix, narrow the contract to create-missing-only behavior and replan before implementation.

## Notes
- 本轮只规划“最小 bootstrap 合同”，不把范围扩张到安装器、语言模板或完整项目脚手架。
- 若执行阶段发现 `IMMUNE.md` 可完全由 `AGENTS.md` 替代，应先回到 planner 重新裁剪初始化集合，而不是在实现阶段临时删改边界。
