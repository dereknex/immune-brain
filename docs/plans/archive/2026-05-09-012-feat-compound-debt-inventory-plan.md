---
title: feat: add compound debt inventory
type: feat
status: planned
date: 2026-05-09
origin: imm-preplan-review handoff on 2026-05-09
---

# Iteration Plan

## Task
- Summary: Add a compound debt inventory and bounded backfill contract for historical missed compound rounds
- Origin: User asked for automatic identification and backfill of historical missed compound rounds after confirming that the current `imm-compounder` only handles the current closed work.
- Research: Checked `IMMUNE.md`, `skills/imm-compounder/SKILL.md`, `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, `.imm/current_iteration_state.py`, `.imm/specs/current-iteration-closure-contract.spec.md`, and `docs/solutions/manual-dev-insights-review-loop.md`. Conclusion: the current workflow has no canonical historical iteration ledger, so the safe first slice is repo-local candidate inventory plus bounded high-confidence backfill rather than a claim to automatically reconstruct all historical rounds.
- Decisions: D1 keep `Scope Reduction` from preplan and treat the problem as compound debt inventory first; D2 use only repo-local durable artifacts as evidence sources; D3 classify results as already compounded, candidate backfill, ambiguous, or insufficient evidence; D4 allow automatic backfill only for high-confidence single-outcome candidates; D5 keep ambiguous candidates as explicit debt rather than guessing.
- Assumptions: `docs/plans/`, `.imm/memory/MEMORY.md`, and `docs/solutions/` together provide enough repo-local evidence for a useful first inventory; historical gaps that cannot be proven from those artifacts are acceptable to leave unresolved in the first slice; a local inventory/report or command entry is more valuable now than introducing a new persistent history system.

## Steps

### Step 1
- Step ID: U1
- Result: Compound debt inventory contract exists
- Verification: `.imm/specs/compound-debt-inventory.spec.md` defines the inventory scope, candidate statuses, evidence-confidence model, bounded backfill rule, non-goals, and focused validation path.
- Test scenarios: Covers IMM-COMPOUND-001 R1; Covers IMM-COMPOUND-001 R2; Covers IMM-COMPOUND-001 R3
- Depends on: none

### Step 2
- Step ID: U2
- Result: Repo-local compound debt inventory entry exists
- Verification: A local command, workflow entry, or equivalent report path can scan `docs/plans/`, `.imm/memory/MEMORY.md`, and `docs/solutions/`, then emit candidate rows with status, evidence source, confidence, dedupe result, and recommended action.
- Test scenarios: Covers IMM-COMPOUND-001 R1; Covers IMM-COMPOUND-001 R2; Covers IMM-COMPOUND-001 acceptance criteria 2; Covers IMM-COMPOUND-001 acceptance criteria 3
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Bounded high-confidence backfill path exists
- Verification: The inventory flow can pass only `high` confidence, single-outcome, non-duplicate candidates into an `imm-compounder`-compatible backfill path while leaving `medium` / `low` confidence candidates in the inventory for manual follow-up.
- Test scenarios: Covers IMM-COMPOUND-001 R3; Covers IMM-COMPOUND-001 R4; Covers IMM-COMPOUND-001 acceptance criteria 5; Covers IMM-COMPOUND-001 acceptance criteria 6
- Depends on: 2

### Step 4
- Step ID: U4
- Result: Focused validation covers the bounded backfill contract
- Verification: Fixture-based tests cover already-compounded detection, high-confidence candidate discovery, insufficient-evidence fallback, duplicate-prevention, and bounded backfill behavior without depending on real session history.
- Test scenarios: Covers IMM-COMPOUND-001 R5; Covers IMM-COMPOUND-001 acceptance criteria 4; Covers IMM-COMPOUND-001 acceptance criteria 7
- Depends on: 3

## Notes
- Do not broaden this slice into a new historical state store, session replay engine, or broad compound refresh sweep.
- If implementation shows repo-local artifacts cannot provide stable candidate IDs or reliable dedupe signals, stop and replan around a durable compound ledger instead of silently increasing guesswork.
- After this plan is validated, implementation should continue through `imm-work`, not directly through ad hoc code edits.
