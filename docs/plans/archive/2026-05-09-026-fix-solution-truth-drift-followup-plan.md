---
title: fix: repair solution truth drift after subagent rollout
type: fix
status: planned
date: 2026-05-09
origin: code-review finding identified that solution docs still describe pre-rollout reviewer activation truth after the remaining-subagents batch finished
---

> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Iteration Plan

## Task
- Summary: Repair stale rollout truth in `docs/solutions/` so solution docs no longer contradict the now-complete reviewer activation state.
- Origin: `imm-code-review` found that [conditional-risk-reviewer-activation-hosts.md](docs/solutions/conditional-risk-reviewer-activation-hosts.md) still says `reliability-reviewer` / `release-readiness-checker` / `debug-investigator` remain unactivated, while `README.md` and `tests/test_skill_contracts.py` now assert the opposite.
- Research: Checked `IMMUNE.md`, the completed [2026-05-09-025-feat-advance-remaining-subagents-plan.md](docs/plans/2026-05-09-025-feat-advance-remaining-subagents-plan.md), [README.md](README.md), `tests/test_skill_contracts.py`, [conditional-risk-reviewer-activation-hosts.md](docs/solutions/conditional-risk-reviewer-activation-hosts.md), and [project-specific-reviewer-contract-slices.md](docs/solutions/project-specific-reviewer-contract-slices.md). Conclusion: the fix surface is narrow and documentary; the stale truth is local to solution-layer evidence, not reviewer runtime behavior.
- Decisions: D1 choose `Scope Reduction` and keep the repair on solution-truth synchronization only; D2 treat reviewer implementation/runtime hosts as already complete and out of scope; D3 allow touching adjacent solution docs only if they directly restate the stale activation truth; D4 keep the fix as a validated one-step loop because one independently closable result is enough.
- Assumptions: The identified drift can be closed without touching runtime contracts or workflow state; existing regression remains the authoritative proof source for current reviewer activation truth.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/solution-truth-drift-followup.spec.md`, `docs/plans/2026-05-09-026-fix-solution-truth-drift-followup-plan.md`, `docs/solutions/conditional-risk-reviewer-activation-hosts.md`, optional adjacent solution docs if direct truth drift is confirmed, and `.imm/memory/MEMORY.md`
  - dependencies_known: true
  - verification_path:
      - target: solution-layer documentation no longer contradicts the completed reviewer activation rollout
      - method: `imm-plan docs/plans/2026-05-09-026-fix-solution-truth-drift-followup-plan.md --json`, focused doc diff review, and `python3 -m unittest tests.test_skill_contracts`
  - blockers: if stale truth is spread across multiple pattern docs in incompatible ways, or if fixing it requires redefining the reviewer-layer taxonomy rather than syncing facts, stop and return to `imm-preplan-review`
  - replan_condition: if execution discovers that the stale statements are symptoms of a broader documentation architecture conflict rather than a bounded fact drift, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: stale reviewer-activation claims are removed from the affected solution docs
- Verification: `docs/solutions/conditional-risk-reviewer-activation-hosts.md` and any directly affected adjacent solution doc stop claiming that `reliability-reviewer`, `release-readiness-checker`, or `debug-investigator` are still out of scope or unactivated; `.imm/memory/MEMORY.md` top summary reflects the new follow-up; `python3 -m unittest tests.test_skill_contracts` still passes.
- Test scenarios: Removes stale activation claims; Preserves current repo truth from `README.md` and `tests/test_skill_contracts.py`; Does not widen into runtime or taxonomy redesign
- Depends on: none
- Scope: `docs/solutions/conditional-risk-reviewer-activation-hosts.md`, optional adjacent `docs/solutions/*.md` only when they directly restate stale reviewer activation truth, and `.imm/memory/MEMORY.md`
- Replan condition: If the fix requires redefining the whole solution taxonomy or reviewer-layer split instead of correcting stale factual statements, stop and route back to `imm-preplan-review`.

## Notes
- This is a one-step follow-up because the remaining work is a documentary truth sync, not a new reviewer rollout.
- Keep the repair factual: update stale statements, counts, and coverage boundaries; do not opportunistically rewrite the whole pattern doc.
