---
title: fix: follow up workflow friction review
type: fix
status: planned
date: 2026-05-09
origin: imm-code-review found a routing contradiction in the workflow-friction contracts and a closure-side durable summary mismatch after the completed workflow-friction reduction plan
---

# Iteration Plan

## Task
- Summary: Repair the post-review gaps from the workflow-friction reduction slice by aligning the `imm-preplan-review` trigger contract and syncing the durable summary with the completed runtime state.
- Origin: `imm-code-review` on the completed workflow-friction reduction slice reported two issues: one README/preplan routing contradiction and one `MEMORY.md` top-summary mismatch against the completed runtime state.
- Research: Reviewed `IMMUNE.md`, `README.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`, `.imm/memory/MEMORY.md`, `.imm/memory/current_iteration.json`, the completed workflow-friction plan, and the prior durable-summary sync pattern. Conclusion: the two issues are independent and both can be closed without changing runtime behavior or commit policy.
- Decisions: D1 reduce scope to two outcomes only: contract routing alignment and durable summary sync; D2 treat `current_iteration.json` policy as explicitly out of scope; D3 keep the routing fix inside docs/skill/test contracts only; D4 keep the durable-summary fix inside `MEMORY.md` only.
- Assumptions: The hotfix/small-task rule can be rewritten to preserve the new trigger-only preplan posture without changing planner/work behavior; `current_iteration.json` remains sufficient as durable evidence that the prior plan is complete; focused regression can stay at the contract-test level for this slice.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/workflow-friction-review-followup.spec.md`, `README.md`, `IMMUNE.md`, `skills/imm-preplan-review/SKILL.md`, `tests/test_skill_contracts.py`, `.imm/memory/MEMORY.md`
  - dependencies_known: true
  - verification_path:
      - target: preplan routing language is internally consistent and `MEMORY.md` top summary matches the completed workflow-friction state
      - method: focused contract review, `python3 -m unittest tests.test_skill_contracts`, `sed -n '1,8p' .imm/memory/MEMORY.md`, and inspection of `.imm/memory/current_iteration.json`
  - blockers: none
  - replan_condition: if fixing either issue starts requiring runtime state-model changes, `current_iteration.json` policy decisions, finish/reset logic changes, or a broader rewrite of the workflow-friction plan, stop and replan as a larger workflow slice

## Steps

### Step 1
- Step ID: U1
- Result: `imm-preplan-review` routing language is internally consistent across the repo-facing workflow contracts.
- Verification: `README.md`, `IMMUNE.md`, and `skills/imm-preplan-review/SKILL.md` all express the same rule: preplan is a trigger-only gate, and light bugfix/hotfix work enters it only when the trigger conditions actually apply.
- Test scenarios: Covers IMM-WORKFLOW-004 acceptance criteria 1; Covers hotfix routing consistency; Covers stable small-task direct planning path surviving the repair
- Depends on: none
- Scope: `README.md`, `IMMUNE.md`, `skills/imm-preplan-review/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If contract alignment requires changing actual runtime routing or adding a new workflow mode, stop and return to `imm-preplan-review` or a broader planner pass.

### Step 2
- Step ID: U2
- Result: `MEMORY.md` top summary matches the completed workflow-friction runtime state.
- Verification: `sed -n '1,8p' .imm/memory/MEMORY.md` no longer describes workflow-friction work as planned/executing, and `.imm/memory/current_iteration.json` still shows the completed plan evidence that supports the updated durable summary.
- Test scenarios: Covers IMM-WORKFLOW-004 acceptance criteria 3; Covers durable summary no longer pointing at a stale execution path; Covers `current_iteration.json` policy remaining untouched
- Depends on: none
- Scope: `.imm/memory/MEMORY.md` only
- Replan condition: If syncing the summary starts requiring edits to `.imm/memory/current_iteration.json`, runtime reset logic, or commit-policy changes, stop and replan that larger state-management work separately.

## Notes
- This follow-up intentionally repairs review gaps from the completed plan instead of reopening the original slice.
- The two steps are independent; do not bundle the routing fix and memory sync into one mixed-outcome execution pass.
