---
title: "feat: eliminate knowledge debt and tune scanner"
type: feat
status: completed
date: 2026-05-10
origin: "docs/brainstorms/imm-brainstorm-knowledge-debt-elimination-preplan-2026-05-10.md"
---

# Iteration Plan

- Summary: Eliminate knowledge debt by compounding missed iterations and improving the debt scanner logic.

## Task
- Summary: Eliminate knowledge debt by compounding missed iterations and improving the debt scanner logic.
- Origin: Brainstorm and pre-plan identified missed compounding opportunities and scanner logic gaps.
- Research: Scanner current classified 001-003 as insufficient due to "规划并启动" prefix. 7 other candidates ready for auto-backfill.
- Decisions: D1 Adjust keyword weights in scanner; D2 Batch backfill high-confidence; D3 Manual review for ambiguous.
- Assumptions: Refined scanner logic correctly captures recent work.
- Scope Mode: Selective Expansion
- Engineering Closure Check:
  - architecture_surface: `.imm/imm-compound-debt.py`, `docs/solutions/`, `MEMORY.md`
  - dependencies_known: true
  - verification_path: `python3 .imm/imm-compound-debt.py` shows 001-003 as candidates; all backfilled items have solutions.
  - blockers: none.
  - replan_condition: if backfill process reveals systemic duplicate solution issues.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-compound-debt.py` logic refinement
- Verification: Script correctly identifies "规划并启动" entries followed by completion as Candidates. 001-003 status becomes `candidate_backfill`.
- Status: completed
- Depends on: none
- Scope: `.imm/imm-compound-debt.py`
- Replan condition: none

### Step 2
- Step ID: U2
- Result: High-confidence Batch backfill completion
- Verification: 7+ high-confidence items (including 001-003) processed; corresponding solution docs exist in `docs/solutions/`.
- Status: completed
- Depends on: 1
- Scope: `docs/solutions/`, `.imm/memory/MEMORY.md`
- Replan condition: none

### Step 3
- Step ID: U3
- Result: Ambiguous items manual triage report
- Verification: A summary note for each of the 10 ambiguous items deciding whether to compound or skip.
- Status: completed
- Depends on: 2
- Scope: `docs/brainstorms/imm-brainstorm-ambiguous-debt-triage.md`
- Replan condition: none

### Step 4
- Step ID: U4
- Result: Final knowledge index regression pass
- Verification: `MEMORY.md` Knowledge Index is up-to-date and contains no dead links.
- Status: completed
- Depends on: 3
- Scope: `.imm/memory/MEMORY.md`
- Replan condition: none
