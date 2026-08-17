---
title: feat: implement dev insights telemetry trace
type: feat
status: planned
date: 2026-05-09
origin: user asked to rewrite the telemetry plan so it can close through real implementation rather than stopping at design-only artifacts
---

# Iteration Plan

## Task
- Summary: Implement a minimal end-to-end telemetry trace loop for Immune-Brain that records user-global raw usage events, derives a narrow set of telemetry-backed dev insights, and keeps the existing inbox/review-loop architecture intact.
- Origin: The user first narrowed telemetry into the dev insights design, then explicitly noted that there is no telemetry implementation yet and asked for the plan to be rewritten so it can close through implementation. The prior design-only telemetry slice established boundaries but stopped before code changes. This plan supersedes that execution boundary and carries forward only the implementation-ready subset.
- Research: Reviewed `IMMUNE.md`, `.imm/imm-finish.py`, `.imm/imm-dev-insights.py`, `scripts/legacy-installer.sh`, `tests/test_workflow_loop.py`, `tests/test_dev_insights_review.py`, the current telemetry spec, and the code-review findings on missing enablement contract and unsupported first-slice signal rules. Conclusion: the repo already has a stable global dev-insights config/inbox pattern, but it does not own any LLM invocation path, so a minimal implementation must use an explicit telemetry entrypoint plus deterministic aggregation instead of hidden runtime hooks.
- Decisions: D1 use Scope Reduction and implement only the smallest end-to-end telemetry loop; D2 reuse the existing `IMM_DEV_INSIGHTS` / `[dev_insights]` config contract rather than adding a second top-level feature switch; D3 add an explicit `.imm/imm-telemetry.py` entrypoint with `record` and `analyze` commands because the repo cannot auto-discover token usage on its own; D4 narrow first-slice derived signals to `token_spike_by_skill` and `context_bloat_regression`, deferring unsupported route/progress-based rules; D5 preserve the existing inbox as the sole review-loop input and keep raw trace outside target-project runtime state; D6 require focused tests and a temporary-`HOME` end-to-end verification path before closure.
- Assumptions: The existing `config.toml` and inbox patterns are stable enough to extend with an optional telemetry trace path; deterministic threshold rules are sufficient for a first implementation slice; `imm-dev-insights.py` can keep parsing Markdown entries as long as telemetry-derived records preserve the base dev-insights fields; adding one new `.imm` script and targeted tests is a smaller change than refactoring the workflow runtime or installer wrappers.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/dev-insights-telemetry-trace.spec.md`, `docs/plans/2026-05-09-018-feat-implement-dev-insights-telemetry-trace-plan.md`, `.imm/imm-telemetry.py`, `.imm/imm-dev-insights.py`, `.imm/imm-finish.py`, `README.md`, `tests/test_telemetry_trace.py`, and any touched dev-insights tests
  - dependencies_known: true
  - verification_path:
      - target: a temporary-home run can record exact/estimated events, derive inbox entries only when narrow thresholds hit, and feed the resulting inbox through `imm-dev-insights.py` without writing target-project runtime state
      - method: focused unittest coverage plus a temp-`HOME` command path using `python3 .imm/imm-telemetry.py record ...`, `python3 .imm/imm-telemetry.py analyze ...`, and `python3 .imm/imm-dev-insights.py --inbox <path> --json`
  - blockers: none
  - replan_condition: if implementation starts requiring hidden model hooks, automatic background collection, target-project `.imm/memory/` writes, route/progress-aware signal rules, or a replacement review surface beyond the existing inbox/report loop, stop and replan as a broader telemetry platform slice

## Steps

### Step 1
- Step ID: U1
- Result: A user-global raw telemetry writer exists.
- Verification: With temporary `HOME` or path overrides, `python3 .imm/imm-telemetry.py record ... --source exact` and `--source estimated` append privacy-safe JSONL events to the configured trace path; with dev insights disabled, the same command does not create the trace file.
- Test scenarios: Covers `IMM_DEV_INSIGHTS` and config-based enablement; Covers exact versus estimated raw events; Covers no target-project `.imm/memory/` writes; Covers no raw prompt or absolute path leakage
- Depends on: none
- Scope: `.imm/imm-telemetry.py`, `.imm/specs/dev-insights-telemetry-trace.spec.md`, targeted tests, and only the minimum config/doc touch needed to explain the new entrypoint
- Replan condition: If a usable writer cannot be built without hooking into hidden model runtimes or changing project-local workflow state ownership, stop and return to planner with a narrower ingestion design.

### Step 2
- Step ID: U2
- Result: A deterministic telemetry analyzer exists that emits schema-compatible telemetry-derived inbox entries for the supported first-slice signals only.
- Verification: `python3 .imm/imm-telemetry.py analyze ...` reads fixture events, appends one inbox record when `token_spike_by_skill` or `context_bloat_regression` thresholds are hit, appends nothing on threshold miss, and every derived entry preserves the base dev-insights fields plus `Source` and `Signal type`.
- Test scenarios: Covers token spike hit; Covers context bloat hit; Covers threshold miss; Covers derived entry retaining `Workflow`, `Context`, `Friction`, `Evidence`, `Suggested improvement`, `Severity`, and `Status`
- Depends on: 1
- Scope: `.imm/imm-telemetry.py`, `.imm/specs/dev-insights-telemetry-trace.spec.md`, targeted tests, and any minimal helper reuse required for inbox path/config lookup
- Replan condition: If supported signal detection needs additional route/progress fields, embedding/LLM clustering, or a new storage layer before a useful first analyzer can exist, stop and replan with a smaller supported-rule set.

### Step 3
- Step ID: U3
- Result: The existing dev-insights review path can consume telemetry-derived records end-to-end without widening the workflow boundary.
- Verification: A temp-`HOME` flow that records raw events, runs `analyze`, and then runs `python3 .imm/imm-dev-insights.py --inbox "$TMP_INBOX" --json` yields a normal candidate report from the derived inbox entries, while no `.imm/specs/`, `docs/plans/`, or target-project `.imm/memory/` files are auto-created by the analysis path.
- Test scenarios: Covers telemetry-derived inbox compatibility with `imm-dev-insights.py`; Covers review-loop output remaining local/manual; Covers no extra workflow-state writes; Covers README or command docs matching the implemented entrypoint
- Depends on: 2
- Scope: `.imm/imm-dev-insights.py` only if compatibility adjustments are truly needed, `README.md`, targeted tests, and the telemetry spec/docs for end-to-end usage
- Replan condition: If end-to-end compatibility requires replacing the inbox format, creating a second review surface, or mutating workflow state automatically, stop and replan as a broader dev-insights redesign.

## Notes
- This implementation plan intentionally supersedes the earlier design-only telemetry plan for execution purposes while reusing its boundary decisions.
- The first closure target is a manually triggered telemetry loop, not a hidden runtime collector or a production analytics system.
- If Step 2 completes with a narrower supported signal set than originally brainstormed, that is acceptable so long as the implemented set is explicit, deterministic, and end-to-end verified.
