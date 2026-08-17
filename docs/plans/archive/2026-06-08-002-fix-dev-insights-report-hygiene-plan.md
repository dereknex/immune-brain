---
title: "fix(dev-insights): tighten report hygiene"
type: fix
status: proposed
date: 2026-06-08
origin: imm-brainstorm framing - recurring automation reports exposed CLI and signal-quality gaps
---

# Iteration Plan

## Task

- Summary: Make dev insights and telemetry summaries safe to run in recurring automation and clearer to interpret.
- Spec: docs/specs/dev-insights-report-hygiene.spec.md
- Origin: Brainstorm manifest from 2026-06-08 dev insights / telemetry report hygiene analysis.
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-REQ-3; BR-OUT-1; BR-OUT-2; BR-DEFER-1; BR-Q-1
- Research: `CONTEXT.md` defines Brainstorm, Plan, Step, Spec, State Ledger, Skill, and Learning boundaries. `.imm/imm_core/telemetry.py` currently makes `summarize --out` required and groups telemetry by project fingerprint plus skill while preserving per-group `exact_source_rate`. The active trace has only `source=estimated` events, so `exact_source_rate=0.0` is an input-state fact rather than a summary calculation bug. `.imm/imm-dev-insights.py` groups raw `Suggested improvement` or `Friction` text directly; the live inbox contains placeholder records such as `Suggested improvement: 1` and `Suggested improvement: None.` that become noisy candidates. `tests/test_dev_insights_review.py` and `tests/test_telemetry_trace.py` already cover the focused report surfaces. `docs/solutions/manual-dev-insights-review-loop.md` keeps dev insights manual and read-only; `docs/solutions/workflow-entrypoint-telemetry-bridging.md` says exact usage capture requires explicit runtime metadata and should not be guessed.
- Decisions: D1 create a new slice because the active stale-wrapper Plan is closed and this is a separate report-hygiene goal. D2 keep the implementation local to the existing report scripts and focused tests. D3 make `summarize` no-arg compatible while preserving explicit `--out`. D4 filter low-signal theme values deterministically before grouping. D5 expose source-quality clarity from existing telemetry fields only. D6 defer actual exact usage capture to a separate runtime handoff plan.
- Assumptions: A deterministic default summary path is acceptable for manual automation compatibility. Placeholder theme filtering can start from an explicit denylist plus numeric-only detection without adding embeddings or LLM clustering. Existing tests can be extended without touching real user-global state.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; this is a small two-script report hygiene slice and local evidence is sufficient.

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-1 | covered_by_step | U1 | The step makes the current `summarize` automation command succeed without explicit `--out`. |
| BR-REQ-2 | covered_by_step | U1 | The step filters placeholder dev-insights themes and preserves meaningful fallback grouping. |
| BR-REQ-3 | covered_by_step | U1 | The step adds summary-level clarity for estimated-only telemetry while keeping per-group exact rates. |
| BR-OUT-1 | captured_as_decision | D2 | The plan stays within existing report scripts and does not add shared registry or dispatcher machinery. |
| BR-OUT-2 | captured_as_decision | D1 | The planner writes the Plan and Spec; the prior Brainstorm remained read-only. |
| BR-DEFER-1 | deferred | D6 | Exact usage capture depends on provider/runtime metadata and is intentionally left for a separate plan. |
| BR-Q-1 | resolved_as_assumption | D1 | The brainstorm stated there are no blocking questions, so this is ready for a new executable slice. |

## Devil's Advocate Audit

1. **Rollback Resilience**: The slice should touch only the telemetry summary entrypoint, dev-insights grouping hygiene, focused tests, this Spec, and this Plan. If the behavior is too broad, revert those files; no State Ledger migration, inbox migration, or user-home cleanup is required.
2. **Verification Vanity**: Verification must run behavior-level tests that call the parser and summary paths with fixtures. Grepping for new denylist strings or checking that a file exists would not prove the current automation command works or that placeholder themes stop polluting candidates.
3. **Spec Dilution Detection**: The accepted requirements are not just "make the command pass." The plan also covers dev-insights theme hygiene and estimated-only telemetry clarity. Exact usage capture is explicitly deferred, not silently omitted.

## Planning Quality Gate

- contract surface: `.imm/imm-telemetry.py`, `.imm/imm_core/telemetry.py`, `.imm/imm-dev-insights.py`, `tests/test_telemetry_trace.py`, `tests/test_dev_insights_review.py`, and the packaged plugin copy only if parity tests reveal this script surface is packaged.
- compatibility: Existing explicit `summarize --out` callers must keep working. Existing dev-insights inbox records stay readable. Existing telemetry trace schema remains valid and no migration is needed.
- interruption recovery: If execution stops after one script change, rerunning focused tests should show which report surface is incomplete; no persistent runtime state should be half-written beyond temporary summary files used by tests.
- rollback path: Revert the Spec, Plan, script changes, and focused tests together.
- verification strength: Use focused unittest fixtures plus manual smoke commands for the exact automation paths.
- Brainstorm traceability: Every `BR-*` item from the brainstorm manifest is mapped above.

## Steps

### Step 1

- Step ID: U1
- Result: Report hygiene regressions are prevented
- Verification: `python3 -m unittest tests.test_dev_insights_review tests.test_telemetry_trace && python3 .imm/imm-telemetry.py summarize && python3 .imm/imm-dev-insights.py --json`
- Verification type: automated
- Execution note: characterization-first
- Test scenarios: `summarize` succeeds without `--out`; explicit `--out` and `--json` remain compatible; estimated-only trace reports a summary-level source-quality signal; placeholder suggested improvements do not create distinct candidate themes; useful friction is used when suggested improvement is placeholder; no formal Plan, Spec, State Ledger, or solution files are auto-created by report generation.
- Discovery cache: .imm/imm_core/telemetry.py (summary command parser and payload); .imm/imm-telemetry.py (CLI wrapper); .imm/imm-dev-insights.py (inbox parser and grouping); tests/test_telemetry_trace.py (telemetry summary regression); tests/test_dev_insights_review.py (dev-insights report regression); docs/specs/dev-insights-report-hygiene.spec.md (accepted behavior)
- Depends on: none
- failure_behavior: If default output path compatibility risks writing unexpected user-global files, keep explicit `--out` as the only writing mode and return to planner to change the automation contract instead.
- security_considerations: Report hygiene must not expose raw prompts, conversations, diffs, or provider metadata beyond existing structured telemetry and dev-insights fields.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-08-002-fix-dev-insights-report-hygiene-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-08-002-fix-dev-insights-report-hygiene-plan.md --sync`

## Notes

- This Plan intentionally does not implement exact provider usage capture.
- After validation and runtime sync, continue through `imm-work` for Step 1.
