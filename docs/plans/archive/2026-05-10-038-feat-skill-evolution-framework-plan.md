---
title: "feat: implement skill evolution evidence packet foundation"
type: feat
status: planning
date: 2026-05-10
origin: "imm-brainstorm session plus user clarification that Evolution-Analyst does not belong under imm-brainstorm"
---

# Iteration Plan

## Task
- Summary: Implement the evidence-packet foundation for system-facing skill evolution by adding telemetry dehydration, upstream diff summarization, and a unified packet contract while explicitly deferring any analyst role.
- Origin: Initial brainstorm framed the need to improve skills and subagent usage from daily records, upstream changes, and cost signals; preplan reduced scope to evidence generation first; user then clarified that `Evolution-Analyst` should not live under `imm-brainstorm` because `imm-brainstorm` serves target-project work.
- Research: Existing `imm-dev-insights.py` already supports manual review of opt-in workflow feedback. Existing `imm-telemetry.py` records and analyzes raw events but lacks a trend-summary layer. `upstreams/` submodules exist as methodology sources but do not yet have a local summary entrypoint. The prior draft overreached by combining evidence generation with a future analysis role and by implying a home under `imm-brainstorm`.
- Decisions: D1 keep this slice on evidence generation only; D2 add an explicit telemetry `summarize` path grounded only in current raw schema; D3 add a deterministic `imm-upstream-sync` command with degraded behavior for missing or uninitialized submodules; D4 define a stable `evolution packet` contract for later consumers; D5 explicitly defer any system-facing analyst role and state that it must not be hosted by `imm-brainstorm`.
- Assumptions: Current raw telemetry schema is sufficient for token/latency trend summaries but not success/ROI metrics; submodule history is accessible when initialized and should degrade cleanly when it is not; a contract-first packet is more valuable now than an automated analyst.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/imm-telemetry.py`, new `.imm/imm-upstream-sync.py`, `.imm/specs/skill-evolution-framework.spec.md`, relevant README/docs references, and focused tests for telemetry summary and upstream sync behavior
  - dependencies_known: true
  - verification_path: fixture-based `summarize` output checks, deterministic upstream sync command checks, and contract/doc assertions that the slice stops at evidence packet generation and does not route through `imm-brainstorm`
  - blockers: none identified for evidence generation; future analyst placement is intentionally deferred
  - replan_condition: if implementation reveals the packet contract cannot stay stable without adding outcome/progress fields or a new system-facing orchestration layer, stop and return to planner rather than silently expanding scope

## Steps

### Step 1
- Step ID: U1
- Result: `imm-telemetry.py` gains an explicit `summarize` path for stable schema-supported trend summaries.
- Verification: `python3 .imm/imm-telemetry.py summarize --trace-path /tmp/imm-trace-fixture.jsonl --out /tmp/imm-telemetry-summary.json` produces deterministic JSON and returns a stable empty/degraded result when the trace path has no events.
- Status: execution-ready
- Scope: `.imm/imm-telemetry.py`, focused telemetry summary tests
- Replan condition: if summary output requires unsupported metrics such as success rate or ROI to be useful, stop and split schema expansion into a separate plan.

### Step 2
- Step ID: U2
- Result: A new `.imm/imm-upstream-sync.py` command summarizes `upstreams/` submodule changes into a deterministic local report with clear empty/degraded handling.
- Verification: `python3 .imm/imm-upstream-sync.py --since HEAD~1 --out /tmp/imm-upstream-summary.md` returns deterministic output for changed, unchanged, missing, and uninitialized submodule states without uncaught exceptions.
- Status: execution-ready
- Depends on: 1
- Scope: `.imm/imm-upstream-sync.py`, focused upstream sync tests
- Replan condition: if a useful summary cannot be produced deterministically from local git/submodule state alone, stop and re-scope instead of introducing LLM summarization or remote dependencies.

### Step 3
- Step ID: U3
- Result: README documents the `evolution packet` contract as a system-facing boundary instead of an `imm-brainstorm` feature.
- Verification: `rg -n "evolution packet|system-facing|imm-brainstorm" README.md` shows the packet contract, degraded-input boundary, and explicit statement that any future analyst is not part of `imm-brainstorm`.
- Status: execution-ready
- Depends on: 2
- Scope: `README.md` and focused contract coverage for packet shape and analyst boundary
- Replan condition: if the packet contract starts to imply automatic planning, automatic skill mutation, or a new always-on workflow stage, stop and reduce scope before execution.

## Test Scenarios
1. **Telemetry Summary Empty Path**: Missing or disabled trace input yields a stable empty/degraded summary instead of a crash.
2. **Telemetry Summary Determinism**: Fixture events produce repeatable per-skill token/latency aggregates and do not invent unsupported efficiency/success metrics.
3. **Upstream Sync Reliability**: Changed, unchanged, missing, and uninitialized submodule states each produce explicit deterministic results.
4. **Packet Contract Boundary**: Docs/tests prove the first slice stops at evidence packet generation and explicitly excludes `imm-brainstorm` as a home for any future analyst role.
