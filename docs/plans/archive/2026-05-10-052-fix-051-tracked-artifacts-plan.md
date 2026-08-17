---
title: fix: track 051 durable artifacts for merge hygiene
type: fix
status: planned
date: 2026-05-10
origin_review: imm-code-review direct_fix after 051 completion — untracked spec plan reference docs
---

# Iteration Plan

## Task

- Summary: Close the **merge hygiene gap** for Epic **051** by tracking previously **untracked** spec plan and reference files plus aligning the **051 spec** acceptance checklist with repository truth.
- Origin: `imm-code-review` flagged `??` paths for `.imm/specs/addy-agent-skills-upstream-and-skill-anatomy.spec.md`, `docs/plans/2026-05-10-051-feat-addy-upstream-skill-anatomy-plan.md`, `docs/reference/addy-agent-skills-contrast.md`, `docs/reference/agent-quality-checklists.md`, and optionally `docs/solutions/iteration-plan-result-markers-and-repo-hygiene.md`.
- Research: `git status` confirms those paths were unstaged/untracked while submodule and skill edits already partially staged; tests passed after implementation.
- Decisions: D1 single outcome step bundling `git add` for required paths plus spec checkbox sync; D2 optional solution doc follows executor judgment against `.imm/specs/post-051-tracked-artifacts.spec.md` §2.2; D3 do not mandate `.imm/memory/` commits in this slice.
- Assumptions: Executor has rights to update the git index; no submodule URL changes.

## Steps

### Step 1

- Step ID: U1
- Result: **051 spec plan plus reference markdown paths become tracked index entries**
- Verification: `git status` shows no `??` for `.imm/specs/addy-agent-skills-upstream-and-skill-anatomy.spec.md` `docs/plans/2026-05-10-051-feat-addy-upstream-skill-anatomy-plan.md` `docs/reference/addy-agent-skills-contrast.md` `docs/reference/agent-quality-checklists.md`; `.imm/specs/addy-agent-skills-upstream-and-skill-anatomy.spec.md` §3 checklist matches delivered state; `python3 -m unittest tests.test_skill_contracts` passes.
- Agent Hint: imm-executor
- Test scenarios: Covers post-051-tracked-artifacts §3
- Depends on: none

## Notes

- If `docs/solutions/iteration-plan-result-markers-and-repo-hygiene.md` is unrelated noise defer it and note in executor notes rather than blocking the step.
- After this plan validates sync runtime via `imm-plan` before `imm-work activate` per repo convention.

## Next Action

Run `python3 .imm/imm-plan.py docs/plans/2026-05-10-052-fix-051-tracked-artifacts-plan.md --json` then `imm-work activate` this plan at Step **1**.
