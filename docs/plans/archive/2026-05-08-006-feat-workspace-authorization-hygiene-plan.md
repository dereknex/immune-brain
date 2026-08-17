---
title: feat: Plan workspace authorization hygiene
type: feat
status: planned
date: 2026-05-08
origin: User asked to generalize from one authorization prompt and check other similar trigger paths after choosing to start future sessions from the target project root
---

# Iteration Plan

## Task
- Summary: Document the minimal session-start rule and adjacent authorization trigger checklist so future Immune-Brain usage can avoid the most common out-of-workspace permission prompts without changing runtime behavior.
- Origin: User analysis request about `cd /Users/derek/.codex/worktrees/... && imm-dehydrate ...`, followed by the decision to default to launching Codex in the target project directory and then asking to check analogous cases.
- Research: Checked `IMMUNE.md`, `README.md`, `scripts/legacy-installer.sh`, `.imm/imm-dehydrate.py`, `.imm/imm-finish.py`, `docs/solutions/imm-workspace-pollution-control-pattern.md`, `docs/solutions/imm-workspace-pollution-migration-path.md`, and current brainstorm/preplan handoff context. Conclusion: the main issue is workspace boundary and external path context, and the nearest adjacent trigger surfaces are global install paths and opt-in global inbox writes under `~`.
- Decisions: Apply `Selective Expansion`; D1 keep the main rule on launching from the target project root; D2 add only one adjacent outcome slice, a checklist of similar authorization trigger categories; D3 defer any script, sandbox, or worktree automation changes; D4 treat global write paths (`plugin skill registry`, `~/.local/bin`, `~/.immune-brain`) as documented expected-prompt surfaces rather than bugs.
- Assumptions: Current repo-facing docs are the right place to lock the rule before any deeper runtime redesign; the user wants reusable workflow guidance, not a one-off explanation for a single command; manual doc inspection plus focused `rg` checks are sufficient verification for this slice.
- Scope Mode: Selective Expansion

## Steps

### Step 1
- Step ID: U1
- Result: Authorization-hygiene spec exists.
- Verification: `.imm/specs/workspace-authorization-hygiene.spec.md` exists and defines the scope, acceptance criteria, and non-goals for this slice.
- Depends on: none
- Scope: `.imm/specs/workspace-authorization-hygiene.spec.md`
- Replan_condition: If the spec cannot stay limited to workflow guidance and instead requires runtime behavior changes to be coherent, return to planner and reduce or split scope again.

### Step 2
- Step ID: U2
- Result: Repo-facing guidance documents the default session-start rule.
- Verification: Target docs state that Codex sessions should start from the target project root instead of relying on a later `cd` into an external worktree or project path.
- Depends on: 1
- Scope: `README.md`, relevant workflow/solution docs, and installer/help text only if needed for user-facing clarity
- Replan_condition: If documenting the rule requires touching runtime scripts or test fixtures to stay truthful, stop and replan instead of silently expanding.

### Step 3
- Step ID: U3
- Result: Repo-facing guidance includes a minimal checklist of adjacent authorization-trigger paths.
- Verification: Target docs enumerate at least the external-workspace category and the global-user-path category (`plugin skill registry`, `~/.local/bin`, `~/.immune-brain`) as expected prompt surfaces when applicable.
- Depends on: 2
- Scope: `README.md`, relevant workflow/solution docs, and installer/help text only if needed for user-facing clarity
- Replan_condition: If the wording cannot be made consistent across entry docs without broad repo-wide doc churn, pause and split the documentation surface into a narrower follow-up plan.

### Step 4
- Step ID: U4
- Result: Documentation wording passes a focused consistency check.
- Verification: `rg -n "target project root|项目根目录|workspace|plugin skill registry|~/.local/bin|~/.immune-brain|授权|permission"` against the edited docs shows the new rule and checklist, and manual review confirms the wording distinguishes “reduce prompts” from “eliminate prompts”.
- Depends on: 2, 3
- Scope: verification commands and the touched planning/documentation surfaces
- Replan_condition: If the wording cannot be made consistent across entry docs without broad repo-wide doc churn, pause and split the documentation surface into a narrower follow-up plan.

## Notes
- This plan deliberately does not modify `imm-dehydrate.py`, `imm-finish.py`, sandbox settings, or worktree discovery logic.
- The intended user-visible outcome is operational clarity: fewer surprising prompts and better expectation-setting, not a hard technical guarantee.
