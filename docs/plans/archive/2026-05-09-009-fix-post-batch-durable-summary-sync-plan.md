---
title: fix: sync post-batch durable summary
type: fix
status: planned
date: 2026-05-09
origin: imm-code-review found that MEMORY.md still points to executing the batch even though the batch already completed and imm-work now routes to imm-compounder
---

# Iteration Plan

## Task
- Summary: Sync `MEMORY.md` durable summary with the completed first-subagent-batch state
- Origin: `imm-code-review` flagged that `.imm/memory/MEMORY.md` still says “Validate and execute the first subagent batch” even though `.imm/memory/current_iteration.json` shows all four batch steps passed and the next workflow entry is `imm-compounder`.
- Research: Checked `IMMUNE.md`, `.imm/memory/MEMORY.md`, `.imm/memory/current_iteration.json`, and repo docs describing `.imm/memory/current_iteration.json` as runtime source of truth. Conclusion: the highest-signal issue is stale durable summary wording in `MEMORY.md`; the runtime-state commit strategy is real but should stay out of this hotfix because `imm-planner` must not edit `.imm/memory/current_iteration.json`.
- Decisions: D1 reduce scope to the durable summary mismatch only; D2 treat `current_iteration.json` handling as explicitly out of scope for this plan; D3 keep the fix to `MEMORY.md` top-of-file status and a minimal history note only; D4 verify by comparing the updated `MEMORY.md` summary against `imm-work status` completion state.
- Assumptions: `current_iteration.json` is the authoritative runtime completion signal for this review; updating `MEMORY.md` is within `imm-planner` write boundaries; no additional spec or runtime-rule changes are required to close the user-visible mismatch.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/post-batch-durable-summary-sync.spec.md`, `docs/plans/2026-05-09-009-fix-post-batch-durable-summary-sync-plan.md`, `.imm/memory/MEMORY.md`
  - dependencies_known: true
  - verification_path:
      - target: `MEMORY.md` top summary reflects completed batch status and routes to `imm-compounder`
      - method: `sed -n '1,8p' .imm/memory/MEMORY.md` plus `imm-work status`
  - blockers: none
  - replan_condition: if fixing the mismatch starts requiring runtime-state resets, finish-flow changes, or commit-policy decisions for `.imm/memory/current_iteration.json`, stop and replan that broader work separately

## Steps

### Step 1
- Step ID: U1
- Result: `MEMORY.md` top summary matches the completed first-subagent-batch state
- Verification: `sed -n '1,8p' .imm/memory/MEMORY.md` and `imm-work status` both show the batch is complete and the next workflow entry is `imm-compounder`, without stale “Validate and execute ...” wording.
- Test scenarios: Covers IMM-MEM-001 R1; Covers IMM-MEM-001 R2; Covers IMM-MEM-001 R3; Covers IMM-MEM-001 acceptance criteria 1; Covers IMM-MEM-001 acceptance criteria 2; Covers IMM-MEM-001 acceptance criteria 3; Covers IMM-MEM-001 acceptance criteria 4
- Depends on: none
- Scope: `.imm/memory/MEMORY.md` only
- Replan condition: If closure requires editing `.imm/memory/current_iteration.json`, runtime reset logic, or compound workflow behavior, stop and return to `imm-preplan-review` or a broader planner pass.

## Notes
- This is a one-step hotfix plan by design; the broader runtime-state commit question remains deferred.
- Keep the change durable and user-facing: update the summary language, not the workflow engine.
