---
title: fix: close subagent runtime MVP acceptance
type: fix
status: planned
date: 2026-05-10
origin: `/imm-planner` handoff after subagent progress analysis; prose and `test_runtime_mvp_host_contracts_are_explicit_and_non_platform` already guard the MVP boundary
---

# Iteration Plan

## Task
- Summary: Formally close `.imm/specs/subagent-runtime-mvp.spec.md` acceptance by checking off §4 criteria with in-repo evidence pointers and marking the spec Accepted.
- Origin: Brainstorm noted MVP runtime behavior is documented and contract-tested while §4 checkboxes remained open.
- Research: Confirmed `skills/imm-code-review/SKILL.md` declares the first shared runtime host with two child paths; `skills/security-reviewer/SKILL.md` and `skills/api-contract-reviewer/SKILL.md` define layered packets and advisory posture; `README.md` documents MVP scope and fallback reasons; `tests/test_skill_contracts.py::SkillContractTests::test_runtime_mvp_host_contracts_are_explicit_and_non_platform` asserts host child set non-platform posture and manual scenario headings in the spec.
- Decisions: D1 hold scope to spec acceptance and evidence traceability only; D2 do not add registry dispatch tooling or expand child reviewers; D3 treat Codex Scenario A/B as the documented manual validation path named in the spec.
- Assumptions: No further skill wording changes are required for closure; any live Codex run remains operator-owned validation outside CI.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/subagent-runtime-mvp.spec.md`
  - dependencies_known: true
  - verification_path:
      - target: §4 criteria satisfied with explicit evidence subsection
      - method: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_runtime_mvp_host_contracts_are_explicit_and_non_platform` and `python3 .imm/imm-plan.py docs/plans/2026-05-10-054-close-subagent-runtime-mvp-acceptance-plan.md --json`
  - blockers: none
  - replan_condition: if closure requires new runtime harness code or additional reviewer roster expansion stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: Subagent runtime MVP spec §4 acceptance is closed with traceable evidence to focused tests plus §7 manual scenarios.
- Verification: `.imm/specs/subagent-runtime-mvp.spec.md` shows **状态** Accepted; §4 items are `[x]`; a short **验收证据** note under §4 lists `tests/test_skill_contracts.py` (`SkillContractTests.test_runtime_mvp_host_contracts_are_explicit_and_non_platform`) and references §7 Scenario A/B; `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_runtime_mvp_host_contracts_are_explicit_and_non_platform` passes; `python3 .imm/imm-plan.py docs/plans/2026-05-10-054-close-subagent-runtime-mvp-acceptance-plan.md --json` passes.
- Agent Hint: imm-qa
- Test scenarios: Covers spec acceptance closure; Covers evidence traceability; Covers contract test still green
- Depends on: none
- Scope: `.imm/specs/subagent-runtime-mvp.spec.md`, `docs/plans/2026-05-10-054-close-subagent-runtime-mvp-acceptance-plan.md`
- Replan condition: If validators or tests fail after spec edits revert wording drift and replan.

## Notes
- Keeps execution bounded to documentation truth already enforced by tests; does not claim automated end-to-end `spawn_agent` in-repo.
