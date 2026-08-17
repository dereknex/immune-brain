---
title: feat: advance remaining subagents
type: feat
status: completed
date: 2026-05-09
origin: user request to normally enable existing subagents, following the first-batch closure
---

# Iteration Plan

## Task
- Summary: Advance the remaining 3 specialized subagents to verifiable runtime hosts
- Origin: The first subagent batch (security, api, eval, docs) is closing. The user request to “normally enable existing subagents” still has a gap for the remaining roster: `reliability-reviewer`, `release-readiness-checker`, and `debug-investigator`.
- Research: Checked `IMMUNE.md`, `README.md`, `docs/solutions/first-subagent-batch-rollout.md`, `docs/solutions/dedicated-reviewer-activation-hosts.md`, and the finished first-batch slices. Conclusion: the repo has a proven pattern for adding conditional-risk and project-specific reviewers as standalone local skill hosts with trigger-only routing and focused regression.
- Decisions: D1 follow the existing runtime-host pattern for the remaining 3 subagents; D2 keep all 3 slices advisory, read-only, trigger-only, and non-default; D3 provide standalone contracts, activation hosts, and fallbacks for each; D4 require the total repo truth after execution to be “all 9 named subagents are now verifiable runtime hosts”; D5 keep shared reviewer platforms out of scope.
- Assumptions: Adding 3 more standalone hosts is still more truthful and closable than starting a generic reviewer registry; existing contract tests can be extended for all 3 without inventing new harnesses.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/reliability-reviewer/SKILL.md`, `skills/release-readiness-checker/SKILL.md`, `skills/debug-investigator/SKILL.md`, dedicated runtime specs for all 3, `README.md`, and `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: all 9 subagents listed in README are activatable or have explicit fallback paths, verified by focused regression and manual runtime validation
      - method: `imm-plan <plan-path> --json` plus focused textual regression and Codex runtime manual validation
  - blockers: none identified.
  - replan_condition: if execution starts requiring a shared dispatch engine, multi-reviewer composition, or cross-agent communication, stop and return to `imm-preplan-review`.

## Steps

### Step 1
- Step ID: U1
- Result: `reliability-reviewer` has a dedicated runtime activation host
- Verification: `skills/reliability-reviewer/SKILL.md` and its runtime contract define trigger surface, advisory boundary, required inputs, fallback wording, and manual validation path.
- Status: completed
- Depends on: none
- Scope: `skills/reliability-reviewer/SKILL.md`, runtime spec, and supporting contract wording
- Replan condition: none

### Step 2
- Step ID: U2
- Result: `release-readiness-checker` has a dedicated runtime activation host
- Verification: `skills/release-readiness-checker/SKILL.md` and its runtime contract define trigger surface, advisory boundary, required inputs, fallback wording, and manual validation path.
- Status: completed
- Depends on: 1
- Scope: `skills/release-readiness-checker/SKILL.md`, runtime spec, and supporting contract wording
- Replan condition: none

### Step 3
- Step ID: U3
- Result: `debug-investigator` has a dedicated runtime activation host
- Verification: `skills/debug-investigator/SKILL.md` and its runtime contract define trigger surface, advisory boundary, required inputs, fallback wording, and manual validation path.
- Status: completed
- Depends on: 2
- Scope: `skills/debug-investigator/SKILL.md`, runtime spec, and supporting contract wording
- Replan condition: none

### Step 4
- Step ID: U4
- Result: the repo truthfully verifies that all 9 subagent slices are activatable hosts
- Verification: `README.md`, `tests/test_skill_contracts.py`, and the collected runtime specs together prove that all subagents have dedicated host paths with explicit fallback, and no broader platform claim is made.
- Status: completed
- Depends on: 1, 2, 3
- Scope: `README.md`, `tests/test_skill_contracts.py`, and batch-level closure wording
- Replan condition: none
