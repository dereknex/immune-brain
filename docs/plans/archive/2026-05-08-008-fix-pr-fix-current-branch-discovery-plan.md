---
title: fix: default imm-pr-fix discovery to current branch
type: fix
status: planned
date: 2026-05-08
origin: user brainstorm handoff on 2026-05-08
---

# Iteration Plan

## Task
- Summary: Repair `imm-pr-fix` target discovery so omitted PR identifiers default to current-branch lookup while remote GitHub metadata remains the source of truth
- Origin: User asked to improve the `imm-pr-fix` skill so it defaults to finding the PR number from the current branch.
- Research: Checked `IMMUNE.md`, the brainstorm handoff, `skills/imm-pr-fix/SKILL.md`, `.imm/specs/pr-fix-remote-context.spec.md`, `docs/plans/2026-05-07-007-feat-pr-fix-remote-context-plan.md`, `docs/solutions/pr-fix-remote-context-contract.md`, `tests/test_skill_contracts.py`, and `skills/imm-work/SKILL.md`. Conclusion: the current contract already requires remote PR context, but it explicitly stops when the user omits a PR target instead of trying current-branch discovery first.
- Decisions: D1 reuse and extend the existing `pr-fix-remote-context` spec instead of creating a parallel PR-fix spec; D2 keep `Scope Mode` at `Hold Scope` and limit the change to skill contract wording plus focused regression, not GitHub runtime automation; D3 make current git branch the default lookup key only when the user omitted a PR identifier; D4 keep ambiguity strict by stopping on detached HEAD, zero PR match, multiple PR matches, or unavailable GitHub metadata.
- Assumptions: The intended execution environments can usually read the current git branch and query GitHub metadata through `gh`, a connector, or an authenticated browser; if those prerequisites are missing, `imm-pr-fix` should still stop and ask for an explicit PR target.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: [`skills/imm-pr-fix/SKILL.md`, `.imm/specs/pr-fix-remote-context.spec.md`, `tests/test_skill_contracts.py`]
  - dependencies_known: true
  - verification_path:
      - target: the `imm-pr-fix` contract defaults to current-branch PR discovery without weakening remote confirmation or ambiguity guards
      - method: validate this plan with `imm-plan`; during execution, confirm contract text and focused regression cover the new default path and stop conditions
  - blockers: []
  - replan_condition: If implementing the contract safely requires new GitHub helper scripts, non-unique PR selection rules, or routing changes in `imm-work` / `imm-code-review`

## Steps

### Step 1
- Step ID: U1
- Result: `imm-pr-fix` defaults omitted PR target discovery to the current branch
- Verification: `skills/imm-pr-fix/SKILL.md` says that when the user provides no PR URL, number, or branch, the skill first reads the current git branch and uses it as the lookup key for PR discovery.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-PR-FIX-001 target discovery default path; Covers IMM-PR-FIX-001 acceptance criteria 2
- Depends on: none
- Scope: `skills/imm-pr-fix/SKILL.md`
- Replan condition: If the skill contract cannot express current-branch lookup without implying local-only PR inference

### Step 2
- Step ID: U2
- Result: `imm-pr-fix` requires remote GitHub metadata to confirm the PR before repair starts
- Verification: `skills/imm-pr-fix/SKILL.md` and `.imm/specs/pr-fix-remote-context.spec.md` both state that current-branch discovery is incomplete until remote GitHub metadata confirms the PR target.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-PR-FIX-001 remote confirmation guard; Covers IMM-PR-FIX-001 acceptance criteria 2
- Depends on: 1
- Scope: `skills/imm-pr-fix/SKILL.md`, `.imm/specs/pr-fix-remote-context.spec.md`
- Replan condition: If the skill contract cannot express branch-based lookup without weakening the “PR as source of truth” rule

### Step 3
- Step ID: U3
- Result: `imm-pr-fix` stops on non-unique or unavailable branch-based PR discovery
- Verification: `skills/imm-pr-fix/SKILL.md` and `.imm/specs/pr-fix-remote-context.spec.md` both state that detached HEAD, zero-match, multi-match, or unavailable GitHub metadata must stop and ask for explicit user input.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-PR-FIX-001 ambiguity handling; Covers IMM-PR-FIX-001 acceptance criteria 3
- Depends on: 2
- Scope: `skills/imm-pr-fix/SKILL.md`, `.imm/specs/pr-fix-remote-context.spec.md`
- Replan condition: If repo policy requires automatic tie-breaking across multiple matching PRs

### Step 4
- Step ID: U4
- Result: Focused regression guards the new default-discovery contract
- Verification: `tests/test_skill_contracts.py` or equivalent focused contract checks fail if `imm-pr-fix` stops naming current-branch lookup as the default fallback or stops naming detached HEAD / zero-match / multi-match as blocking conditions.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-PR-FIX-001 regression guard; Covers IMM-PR-FIX-001 acceptance criteria 4
- Depends on: 1, 2, 3
- Scope: `tests/test_skill_contracts.py`
- Replan condition: If existing skill contract tests prove too coarse and require a dedicated PR-fix contract test helper

## Notes
- Keep the slice contract-first: do not add scripts, GitHub automation helpers, or branch-to-PR heuristics beyond unique remote identification.
- If execution finds contradictory long-term solution wording, decide in that turn whether it is blocker-level drift or better handled as a later compound step.
