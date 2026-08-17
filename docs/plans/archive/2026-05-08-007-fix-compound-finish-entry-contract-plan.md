---
title: fix: align compound finish entry contract
type: fix
status: planned
date: 2026-05-08
origin: user brainstorm and preplan handoff on 2026-05-08
---

# Iteration Plan

## Task
- Summary: Repair the `imm-compounder` finish entry contract so it defaults to `imm-finish` and keeps project-local script usage as explicit fallback only
- Origin: User reported the `imm-brainstorm` flow surfacing “`.imm/imm-finish.py` 当前不存在，所以这轮没有额外的 finish/dehydrate 记录。” and asked for analysis plus a fix.
- Research: Checked `IMMUNE.md`, brainstorm output, preplan handoff, `skills/imm-compounder/SKILL.md`, `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`, `README.md`, `docs/solutions/imm-workspace-pollution-migration-path.md`, and `docs/solutions/workflow-trigger-contracts.md`. Conclusion: the breakage is contract drift between the migrated CLI-first workflow entry model and one leftover skill/test pair that still treats `python3 .imm/imm-finish.py` as the default path.
- Decisions: D1 keep the fix narrow to skill contract, focused regression, and directly conflicting solution wording; D2 make `imm-finish` the only default happy path for compound closure; D3 preserve `.imm/imm-finish.py` only as documented compatibility fallback when `imm-finish` is unavailable; D4 do not modify runtime finish/dehydrate code or installer behavior in this slice.
- Assumptions: Target environments are expected to use the repository's installed `imm-finish` CLI by default; the current user-visible error stems from contract wording and fallback handling rather than from canonical runtime state corruption; historical plans and unrelated skills do not need rewriting in this slice.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-compounder` contract defaults to `imm-finish`
- Verification: `skills/imm-compounder/SKILL.md` instructs compound closure to run `imm-finish` by default instead of `python3 .imm/imm-finish.py`.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-OPS-002 R1; Covers IMM-WORKFLOW-OPS-002 acceptance criteria 1
- Depends on: none

### Step 2
- Step ID: U2
- Result: Project-local finish script is documented as fallback-only
- Verification: `skills/imm-compounder/SKILL.md` and `docs/solutions/workflow-trigger-contracts.md` describe `.imm/imm-finish.py` only as a compatibility fallback when `imm-finish` is unavailable, not as the recommended compound closure path.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-OPS-002 R2; Covers IMM-WORKFLOW-OPS-002 acceptance criteria 2; Covers IMM-WORKFLOW-OPS-002 acceptance criteria 4
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Focused regression guards the repaired entry contract
- Verification: `tests/test_skill_contracts.py` or equivalent focused contract checks fail if `imm-compounder` stops naming `imm-finish` as default or stops marking `.imm/imm-finish.py` as fallback-only.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-OPS-002 R3; Covers IMM-WORKFLOW-OPS-002 acceptance criteria 3; Covers IMM-WORKFLOW-OPS-002 acceptance criteria 5
- Depends on: 1, 2

## Notes
- Keep the slice contract-first: if implementation reveals that `imm-finish` is not reliably available in the intended environments, stop and replan around installer/runtime guarantees rather than silently broadening this fix.
- This plan intentionally excludes `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, `scripts/legacy-cli-launcher`, and global PATH/bootstrap behavior.
