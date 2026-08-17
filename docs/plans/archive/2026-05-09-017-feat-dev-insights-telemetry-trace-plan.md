---
title: feat: plan dev insights telemetry trace
type: feat
status: planned
date: 2026-05-09
origin: user asked to fold token telemetry into global developer insights without polluting target projects, mainly to improve Immune-Brain itself
---

# Iteration Plan

## Task
- Summary: Define a minimal global telemetry trace design for Immune-Brain and route only aggregated cost signals into the existing dev insights inbox.
- Origin: The user first asked whether token consumption could be traced, then narrowed the design to “do not pollute target projects; put it in user-global analysis; use it mainly for Immune-Brain improvement iteration.” `imm-brainstorm` further narrowed the framing to global raw trace plus derived dev insights, rather than a standalone telemetry system.
- Research: Reviewed `IMMUNE.md`, `README.md`, `.imm/imm-dev-insights.py`, `.imm/memory/current_iteration.json`, `.imm/specs/dev-insights-global-inbox.spec.md`, `.imm/specs/dev-insights-review-loop.spec.md`, `docs/solutions/opt-in-global-developer-insights-inbox.md`, and `docs/solutions/manual-dev-insights-review-loop.md`. Conclusion: the repo already treats dev insights as opt-in global workflow-improvement material, explicitly not full telemetry, so the narrow path is to keep raw trace separate from inbox records and preserve inbox as the only review-loop input.
- Decisions: D1 choose Scope Reduction and exclude full analytics / observability expansion; D2 keep raw telemetry in `~/.immune-brain/telemetry/usage_events.jsonl` instead of any target-project `.imm/memory/` path; D3 keep the existing inbox as the only manual-review input and admit telemetry only through derived insights; D4 define privacy around token counts and hashed project identity, not prompt/code/path capture; D5 plan only schema, aggregation rules, and retention/privacy contracts before any implementation work.
- Assumptions: Runtime usage metadata may sometimes be unavailable, so the contract must allow `estimated` alongside `exact`; the existing Markdown inbox can absorb a few additional structured fields without forcing a new parser surface; a threshold-based first slice is more valuable than a broad telemetry platform; planner-level design work is enough for this turn and no runtime state activation is needed.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/dev-insights-telemetry-trace.spec.md`, `docs/plans/2026-05-09-017-feat-dev-insights-telemetry-trace-plan.md`, `.imm/memory/MEMORY.md`, and later implementation surfaces under `.imm/` plus any dev-insights docs/tests
  - dependencies_known: true
  - verification_path:
      - target: the repo has a validated design boundary for global raw trace, derived insight routing, and privacy/retention rules that fit the existing dev insights architecture
      - method: inspect the new spec and plan, then run `python3 .imm/imm-plan.py docs/plans/2026-05-09-017-feat-dev-insights-telemetry-trace-plan.md --json`
  - blockers: none
  - replan_condition: if the design starts requiring target-project runtime-state writes, full telemetry browsing/reporting infrastructure, remote services, automatic planning authority, or review-loop replacement, stop and replan as a broader dev-insights platform slice

## Steps

### Step 1
- Step ID: U1
- Result: A stable global raw-trace contract exists for token/latency telemetry that does not write into target-project runtime state.
- Verification: `.imm/specs/dev-insights-telemetry-trace.spec.md` defines the global path, append-only event schema, `exact|estimated` source semantics, and explicit prohibition on target-project `.imm/memory/` writes.
- Test scenarios: Covers user-global storage instead of project pollution; Covers `exact` versus `estimated` usage provenance; Covers privacy-safe raw event shape without prompt/code/path capture
- Depends on: none
- Scope: `.imm/specs/dev-insights-telemetry-trace.spec.md`
- Replan condition: If the raw trace contract cannot stay outside target-project state, or if the event schema needs prompt/raw-conversation capture to be useful, stop and return to `imm-preplan-review` or a broader planner pass.

### Step 2
- Step ID: U2
- Result: A derived-insight routing contract exists that keeps the existing dev insights inbox as the sole review-loop input.
- Verification: `.imm/specs/dev-insights-telemetry-trace.spec.md` states that only threshold-hit signals create inbox entries, lists the first derived signal types, and preserves `.imm/imm-dev-insights.py` / inbox architecture as the manual review surface.
- Test scenarios: Covers threshold hit producing one telemetry-derived inbox record; Covers threshold miss producing no inbox append; Covers review loop continuing to consume inbox rather than raw telemetry
- Depends on: 1
- Scope: `.imm/specs/dev-insights-telemetry-trace.spec.md`, related dev-insights plan/task framing only
- Replan condition: If derived signal routing needs a new analysis datastore, a separate review UI, or automatic workflow execution, stop and replan as a larger telemetry product slice.

### Step 3
- Step ID: U3
- Result: A first-slice governance boundary exists for later telemetry implementation.
- Verification: `.imm/specs/dev-insights-telemetry-trace.spec.md` and `.imm/memory/MEMORY.md` state the no-prompt/no-code/no-diff/no-absolute-path boundary, clarify that retention is a documented contract before automation, and describe the slice as Immune-Brain improvement telemetry rather than a complete observability platform.
- Test scenarios: Covers no raw prompt/path leakage in stored records; Covers retention posture documented before implementation; Covers non-goals blocking platform expansion
- Depends on: 1
- Scope: `.imm/specs/dev-insights-telemetry-trace.spec.md`, `.imm/memory/MEMORY.md`
- Replan condition: If privacy or retention decisions require org-wide policy, cross-device sync, or production cost accounting semantics, stop and replan with a narrower governance input.

## Notes
- This plan intentionally stops at a validated design boundary; it does not yet add collectors, aggregators, or tests.
- Step 2 depends on Step 1 because derived insights only make sense once raw trace ownership and schema are fixed.
- Step 3 depends on Step 1 because privacy/retention posture must anchor to the raw-trace location and schema, but it remains independent from the specific threshold rules in Step 2.
