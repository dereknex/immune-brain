---
title: feat: require remote PR context in imm-pr-fix
type: feat
status: planned
date: 2026-05-07
origin: user clarified the request targets the imm-pr-fix skill implementation
---

# Iteration Plan

## Task
- Summary: Require `imm-pr-fix` to read remote GitHub PR context before repairing blockers
- Origin: User clarified that "读取 GitHub PR 页面和远端 check 结果，并进行修复，修复完成推送代码并解决feedback" refers to the implementation of the `imm-pr-fix` skill itself, not a specific PR.
- Research: Checked `IMMUNE.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-pr-fix/SKILL.md`, README, and `docs/brainstorms/immune-brain-requirements.md`. Conclusion: `imm-pr-fix` already owns PR blocker repair, but its current contract relies on provided summaries instead of requiring remote PR/check/review collection and post-fix PR feedback closure.
- Decisions: D1 update only `imm-pr-fix` because the requested behavior belongs to that skill's repair contract; D2 require explicit PR target discovery instead of assuming the current branch; D3 keep tool choice flexible while requiring source/evidence reporting; D4 include push and review-thread reply/resolve in the repair loop.
- Assumptions: This task is a skill documentation/contract implementation, not a runtime GitHub client implementation; future agents can use available GitHub tools (`gh`, connector, or browser) according to their environment.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-pr-fix` owns the remote PR repair loop
- Verification: `skills/imm-pr-fix/SKILL.md` requires reading PR page metadata, remote checks, review feedback, and failure logs before repair; requires stopping when no PR target is available; requires push plus PR feedback reply/resolve after validation; and its report template includes source evidence, push result, handled feedback, validation, and remaining risks.
- Test scenarios: Covers IMM-PR-FIX-001 AC1; Covers IMM-PR-FIX-001 AC2; Covers IMM-PR-FIX-001 AC3; Covers IMM-PR-FIX-001 AC4
- Depends on: none

## Notes
- Do not add scripts or broaden this into a GitHub automation framework.
- Do not change unrelated skill boundaries.
- If a future implementation needs a concrete tool integration, create a separate plan because that changes runtime behavior rather than the skill contract.
