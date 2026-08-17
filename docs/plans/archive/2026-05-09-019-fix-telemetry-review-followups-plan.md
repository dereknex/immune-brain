---
title: fix: telemetry review followups
type: fix
status: planned
date: 2026-05-09
origin: user asked to continue from imm-code-review findings and requested a new executable plan instead of patching a completed telemetry plan out of band
---

# Iteration Plan

## Task
- Summary: Repair the first telemetry implementation so project-level signal baselines stay isolated, telemetry failures degrade without uncaught exceptions, and repeated analysis does not duplicate the same derived inbox entry.
- Origin: After the initial telemetry implementation plan completed, `imm-code-review` identified three concrete follow-up defects: cross-project baseline mixing, write-path exceptions that can block workflow execution, and duplicate derived inbox entries on repeated `analyze` runs. The user then invoked `imm-planner` because the completed plan no longer had an active executable step.
- Research: Reviewed `IMMUNE.md`, `.imm/specs/dev-insights-telemetry-trace.spec.md`, `docs/plans/2026-05-09-018-feat-implement-dev-insights-telemetry-trace-plan.md`, `.imm/imm-telemetry.py`, `.imm/imm-dev-insights.py`, and the focused review evidence. Reproduced three behaviors with read-only inspection and small local probes: `detect_signals()` currently groups only by `skill`, repeated `analyze` appends duplicate derived entries for the same unchanged trace window, and telemetry path permission failures currently raise `PermissionError` instead of degrading.
- Decisions: D1 use Scope Reduction and treat this as a bounded follow-up fix slice instead of reopening the broader telemetry design; D2 keep the raw-trace plus derived-inbox two-layer architecture unchanged; D3 require project-scoped signal windows keyed at least by `project_fingerprint + skill`; D4 require explicit degraded results for trace or inbox write failures rather than uncaught exceptions; D5 require idempotent `analyze` behavior on unchanged trace input without introducing a new review surface or automatic planning behavior.
- Assumptions: The existing telemetry schema is sufficient to isolate project-level baselines without adding route/progress fields; idempotence can be achieved with a stable dedupe key or equivalent local rule without redesigning the inbox format; degraded telemetry writes can be surfaced through existing CLI output or return statuses without broader workflow-tool changes.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/dev-insights-telemetry-trace.spec.md`, `docs/plans/2026-05-09-019-fix-telemetry-review-followups-plan.md`, `.imm/imm-telemetry.py`, `tests/test_telemetry_trace.py`, and `README.md` only if CLI-facing degraded behavior needs wording alignment
  - dependencies_known: true
  - verification_path:
      - target: focused tests prove project-level signal isolation, graceful degradation on telemetry write failure, and idempotent derived inbox emission on repeated analyze
      - method: `python3 -m unittest tests.test_telemetry_trace tests.test_dev_insights_review`
  - blockers: none
  - replan_condition: if idempotent analyze requires replacing the existing inbox format, introducing a new persistent analyzer state store outside the current telemetry/inbox paths, or changing workflow-tool contracts beyond telemetry's explicit CLI, stop and replan as a broader telemetry follow-up

## Steps

### Step 1
- Step ID: U1
- Result: Telemetry write-path failures degrade safely instead of raising uncaught exceptions.
- Verification: `python3 -m unittest tests.test_telemetry_trace` passes with added coverage showing `record` and `analyze` return degraded/error status on trace or inbox write failure instead of aborting the workflow.
- Test scenarios: Covers raw trace append failure; Covers derived inbox append failure; Covers existing happy-path telemetry tests still passing
- Depends on: none
- Scope: `.imm/imm-telemetry.py`, `tests/test_telemetry_trace.py`, the telemetry spec, and README only if degraded CLI output wording changes
- Replan condition: If safe degradation requires broader workflow-tool error-channel changes outside telemetry's explicit CLI, stop and return to planner.

### Step 2
- Step ID: U2
- Result: Project-level telemetry signals are computed from project-scoped baselines rather than cross-project mixed samples.
- Verification: `python3 -m unittest tests.test_telemetry_trace` passes with added coverage proving same-skill events from different `project_fingerprint` values do not share one derived signal baseline.
- Test scenarios: Covers `token_spike_by_skill` isolation by `project_fingerprint + skill`; Covers `context_bloat_regression` isolation by `project_fingerprint + skill`; Covers existing single-project signal detection remaining intact
- Depends on: 1
- Scope: `.imm/imm-telemetry.py`, `tests/test_telemetry_trace.py`, and the telemetry spec only
- Replan condition: If project-scoped isolation requires expanding the event schema or introducing a new aggregation store, stop and return to planner.

### Step 3
- Step ID: U3
- Result: Re-running telemetry analysis on unchanged raw trace does not duplicate the same derived inbox entry.
- Verification: `python3 -m unittest tests.test_telemetry_trace tests.test_dev_insights_review` passes with added coverage proving repeated `analyze` emits a single derived insight for unchanged trace input while `imm-dev-insights.py` still reads the resulting inbox normally.
- Test scenarios: Covers repeated `analyze` idempotence for unchanged trace; Covers derived inbox compatibility with `imm-dev-insights.py`; Covers no extra workflow-state writes
- Depends on: 2
- Scope: `.imm/imm-telemetry.py`, `tests/test_telemetry_trace.py`, and README only if analyze behavior documentation changes
- Replan condition: If idempotence requires replacing the inbox format or introducing persistent analyzer state beyond the current telemetry/inbox paths, stop and return to planner.

## Notes
- This plan stays narrow even though it uses three steps: each step now closes one review finding with its own direct verification path.
- The follow-up stays inside telemetry's existing explicit-entrypoint architecture; it does not add background collection, new analytics surfaces, or broader Dev Insights redesign.
