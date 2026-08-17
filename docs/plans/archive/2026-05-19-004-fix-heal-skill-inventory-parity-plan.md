---
title: "fix: heal skill inventory parity"
type: fix
status: planned
date: 2026-05-19
origin: repo evaluation after user requested current-project assessment and planning
---

# Iteration Plan

## Task

- Summary: Repair `imm-heal` so its required Skill inventory matches the real repo `skills/*/SKILL.md` surface, including `prep` and `run`.
- Origin: Current-project evaluation on 2026-05-19.
- Spec: docs/specs/heal-skill-inventory-parity.spec.md
- Research: `python3 -m unittest discover -s tests` fails only at `tests.test_workflow_loop.WorkflowLoopTests.test_heal_required_skills_match_repo_skills`; `.imm/imm-heal.py` still hardcodes `REQUIRED_SKILLS` and omits `prep/SKILL.md` plus `run/SKILL.md`; `docs/plans/2026-05-18-002-feat-l2s-installable-alias-skills-plan.md` already established those alias skills as installable repo surface.
- Decisions:
  - D1: Prioritize this repo-health drift before opening a broader new feature slice, because the current test suite already marks it as broken truth.
  - D2: Keep the slice to one outcome unit: align the heal truth source with live repo Skills and prove it with focused regressions.
  - D3: Prefer a drift-resistant truth source over extending the stale manual subset again.
- Assumptions: `skills/` remains the authoritative installable Skill surface for both repo tests and the installed runtime copy.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-heal` validates the live repo Skill inventory.
- Verification: `python3 -m unittest tests.test_workflow_loop.WorkflowLoopTests.test_heal_required_skills_match_repo_skills tests.test_install_local tests.test_skill_contracts`
- Verification type: automated
- Discovery cache: `.imm/imm-heal.py` (stale required-skill truth source); `tests/test_workflow_loop.py` (parity regression); `docs/plans/2026-05-18-002-feat-l2s-installable-alias-skills-plan.md` (alias-skill contract source)
- Test scenarios: Heal parity covers all shipped repo Skills; alias-skill additions do not require hidden manual list sync.
- Depends on: none
- Scope: `.imm/imm-heal.py`, `tests/test_workflow_loop.py`, and only minimal related contract coverage if needed
- Replan condition: If `imm-heal` cannot read a stable local truth source without widening into installer or runtime-path redesign, stop and replan the authority boundary.

## Next Action

Use `imm-work` with this plan path and close U1 as a focused repo-health fix.
