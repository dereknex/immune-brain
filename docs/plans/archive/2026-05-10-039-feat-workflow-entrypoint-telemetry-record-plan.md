---
title: "feat: integrate telemetry record into workflow entrypoints"
type: feat
status: planning
date: 2026-05-10
origin: "user asked to connect telemetry record to actual skills after confirming usage_events.jsonl stays empty"
---

# Iteration Plan

## Task
- Summary: Integrate telemetry record into repo-local workflow entrypoints so `usage_events.jsonl` is populated by real `imm-*` lifecycle transitions instead of depending on manual `record` calls.
- Origin: User asked why `usage_events.jsonl` stays empty, then requested that record be connected to actual skills.
- Research: The repo currently exposes `.imm/imm-telemetry.py record` only as a manual command. README and the telemetry spec both confirm there is no hidden auto-capture path today. The actual executable surfaces are `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-finish.py`, plus the CLI launcher; `SKILL.md` files are prompt contracts, not local execution hooks. The core engineering gap is not “record is broken” but “no workflow entrypoint ever calls it.”
- Decisions: D1 interpret “actual skills” as repo-local workflow entrypoints, not prompt text; D2 keep the first slice on `imm-work`, `imm-review`, and `imm-finish`; D3 require an explicit exact-metadata contract and a documented estimated/no-op fallback when metadata is unavailable; D4 preserve best-effort semantics so telemetry failures never block workflow closure.
- Assumptions: Adding hooks to the workflow entrypoints is sufficient to make the trace non-empty in normal use; exact usage metadata may still be absent in some runtimes, so the first slice must choose and document a controlled fallback; existing telemetry schema and tests are the right base instead of inventing a second event format.
- Scope Mode: Selective Expansion
- Engineering Closure Check:
  - architecture_surface: `.imm/imm-telemetry.py`, `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-finish.py`, `README.md`, `.imm/specs/workflow-entrypoint-telemetry-record.spec.md`, and focused workflow/telemetry tests
  - dependencies_known: true
  - verification_path: workflow-triggered trace creation checks, exact-vs-fallback contract checks, and degraded-path regressions that prove workflow functionality is preserved when telemetry write fails
  - blockers: the repo does not inherently know true model usage, so fallback behavior must be explicitly chosen rather than guessed implicitly
  - replan_condition: if useful workflow-triggered events require a broader runtime integration than repo-local entrypoints can provide, stop and split provider/runtime capture into a separate plan instead of silently widening scope

## Steps

### Step 1
- Step ID: U1
- Result: The repo defines a workflow-entrypoint telemetry hook contract that distinguishes exact metadata from estimated/no-op fallback.
- Verification: `.imm/specs/workflow-entrypoint-telemetry-record.spec.md` and README together define the entrypoint surfaces, metadata contract, fallback rule, and the explanation for why `usage_events.jsonl` was previously empty.
- Status: execution-ready
- Scope: `.imm/specs/workflow-entrypoint-telemetry-record.spec.md`, `README.md`
- Replan condition: if the contract cannot stay clear without inventing multiple competing fallback modes, stop and reduce to a narrower single-entrypoint slice.

### Step 2
- Step ID: U2
- Result: `imm-work` invokes telemetry record on a real workflow transition.
- Verification: focused tests show that invoking `imm-work` with telemetry enabled creates a user-global trace event without requiring a manual `imm-telemetry.py record` call.
- Status: execution-ready
- Depends on: 1
- Scope: `.imm/imm-telemetry.py`, `.imm/imm-work.py`, focused tests
- Replan condition: if `imm-work` cannot emit a telemetry event without distorting current-step authority boundaries, stop and reduce to a status-only or activation-only hook instead of widening the slice.

### Step 3
- Step ID: U3
- Result: `imm-review` invokes telemetry record on QA closure transitions.
- Verification: focused tests show that invoking `imm-review` with telemetry enabled creates a user-global trace event without requiring a manual `imm-telemetry.py record` call.
- Status: execution-ready
- Depends on: 2
- Scope: `.imm/imm-review.py`, focused tests
- Replan condition: if review instrumentation requires invasive authority or state changes, stop and split the remaining entrypoints into follow-up work.

### Step 4
- Step ID: U4
- Result: `imm-finish` invokes telemetry record on closure transitions.
- Verification: focused tests show that invoking `imm-finish` with telemetry enabled creates a user-global trace event without requiring a manual `imm-telemetry.py record` call.
- Status: execution-ready
- Depends on: 3
- Scope: `.imm/imm-finish.py`, focused tests
- Replan condition: if finish instrumentation requires invasive closure-state or dev-insights changes, stop and keep telemetry out of compound closure for the first slice.

### Step 5
- Step ID: U5
- Result: Workflow-triggered telemetry preserves best-effort behavior when exact metadata is missing or trace writes fail.
- Verification: focused regressions prove exact metadata yields `source=exact`, fallback behavior matches the chosen contract, and telemetry failures do not block step activation, QA closure, or finish closure.
- Status: execution-ready
- Depends on: 4
- Scope: focused workflow/telemetry regressions and any minimal doc wording needed to explain degraded behavior
- Replan condition: if preserving best-effort behavior requires invasive state changes or extra runtime state files, stop and return to planner.

## Test Scenarios
1. **Workflow Hook Creation**: Running real workflow entrypoints with telemetry enabled produces `usage_events.jsonl` without a separate manual `record` command.
2. **Exact Metadata Path**: When exact metadata is supplied, recorded events retain `source=exact` and reuse the existing raw schema.
3. **Fallback Path**: When exact metadata is absent, the chosen estimated/no-op behavior is explicit, stable, and documented.
4. **Failure Isolation**: Telemetry write failures degrade cleanly and do not block `imm-work`, `imm-review`, or `imm-finish`.
