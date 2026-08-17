# Spec: heal skill inventory parity

## Objective

Keep `imm-heal` aligned with the real installable Skill surface in this repo so
workflow health checks do not drift when Skills are added or removed.

## Requirements

### R1. Heal checks the live repo Skill inventory

`imm-heal` must validate the same `skills/*/SKILL.md` inventory that the repo
actually ships.

Accepted behavior:

- Health checks cover every installable Skill under `skills/`.
- Removed Skills disappear from the health contract automatically.
- The repo test comparing the required inventory with live `skills/*/SKILL.md`
  passes.

### R2. Registry and filesystem stay aligned

Accepted behavior:

- Every registry entry points to an existing Skill.
- Every shipped Skill has a registry entry and matching dist prompt.
- Adding or removing a Skill does not require updating a hidden hard-coded list.

## Non-goals

- No redesign of the broader heal scoring or output format.
- No installer behavior changes.
- No workflow authority changes.

## Verification scenarios

- Scenario A: `python3 -m unittest tests.test_workflow_loop.WorkflowLoopTests.test_heal_required_skills_match_repo_skills` passes.
- Scenario B: Registry consistency tests pass after a Skill is removed.
- Scenario C: Focused installer and contract regressions still pass.
