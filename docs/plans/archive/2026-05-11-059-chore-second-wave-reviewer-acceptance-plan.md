---
title: "chore: accept second-wave reviewer runtime specs"
type: chore
status: closed
date: 2026-05-11
origin: plan 058 remaining-work doc identified P1-P3 reviewers; audit found all four SKILL.md and contract tests already satisfy runtime spec acceptance criteria
---

# Iteration Plan

## Task
- Summary: Accept the four second-wave reviewer runtime specs whose implementations already exist and update the remaining-work reference document to reflect closure
- Origin: Plan 058 U2 created `docs/reference/subagent-remaining-work.md` listing P1-P3 reviewer runtime slices as next work; subsequent audit found all four SKILL.md already satisfy their runtime spec acceptance criteria with passing contract tests
- Research: Checked `skills/data-integrity-reviewer/SKILL.md` (delegation packet + trigger-only + advisory-only + fallback_path to imm-code-review); checked `skills/reliability-reviewer/SKILL.md` (same pattern); confirmed `skills/release-readiness-checker/SKILL.md` plus `skills/debug-investigator/SKILL.md` exist with matching contracts; confirmed `tests/test_skill_contracts.py` has activation-path assertions for all four; confirmed all four runtime specs under `.imm/specs/` are Proposed with acceptance criteria that match existing artifacts
- Decisions: D1 treat this as metadata acceptance not new implementation; D2 batch all four into one step since verification pattern is identical; D3 update remaining-work doc inline
- Assumptions: SKILL.md content plus passing contract tests constitute sufficient acceptance evidence for the runtime spec criteria
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/data-integrity-reviewer-runtime.spec.md` `.imm/specs/reliability-reviewer-runtime.spec.md` `.imm/specs/release-readiness-checker-runtime.spec.md` `.imm/specs/debug-investigator-runtime.spec.md` `docs/reference/subagent-remaining-work.md`
  - dependencies_known: true
  - verification_path:
      - target: four runtime specs show Accepted plus remaining-work doc updated
      - method: `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` plus status field cross-check
  - blockers: none
  - replan_condition: if any spec acceptance criterion reveals genuinely missing implementation stop and file a targeted fix plan

## Steps

### Step 1
- Step ID: U1
- Result: Four second-wave reviewer runtime specs are Accepted with evidence pointers plus remaining-work doc reflects closure
- Verification: `.imm/specs/data-integrity-reviewer-runtime.spec.md` plus `.imm/specs/reliability-reviewer-runtime.spec.md` plus `.imm/specs/release-readiness-checker-runtime.spec.md` plus `.imm/specs/debug-investigator-runtime.spec.md` each show `Accepted` with evidence pointers; `docs/reference/subagent-remaining-work.md` §1 reflects updated status; `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` still passes
- Agent Hint: imm-executor
- Test scenarios: Covers four spec acceptance; Covers remaining-work doc sync; Covers test regression
- Depends on: none
- Scope: `.imm/specs/data-integrity-reviewer-runtime.spec.md` `.imm/specs/reliability-reviewer-runtime.spec.md` `.imm/specs/release-readiness-checker-runtime.spec.md` `.imm/specs/debug-investigator-runtime.spec.md` `docs/reference/subagent-remaining-work.md`
- Replan condition: If verifying a spec reveals genuinely missing artifacts do not force-accept; file a targeted fix plan.

## Notes
- This plan does not introduce new reviewer implementations or expand the trigger catalog.
- After this plan closes all 9 named reviewers will have Accepted runtime specs.
- Catalog expansion (wiring second-wave reviewers into imm-code-review dispatch) remains a separate future slice.
