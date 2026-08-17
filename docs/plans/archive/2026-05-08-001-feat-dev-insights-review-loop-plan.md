---
title: feat: add dev insights review loop
type: feat
status: planned
date: 2026-05-08
origin: imm-preplan-review handoff on 2026-05-08
---

# Iteration Plan

## Task
- Summary: Add a manual Dev Insights Review Loop for Immune-Brain workflow improvement notes
- Origin: User continued from `imm-compounder` into `imm-preplan-review`, which selected `Scope Reduction` for a manual dev insights review/report slice after the workflow health gate repair closure.
- Research: Checked `IMMUNE.md`, `.imm/specs/dev-insights-global-inbox.spec.md`, `docs/solutions/opt-in-global-developer-insights-inbox.md`, `docs/solutions/workflow-trigger-contracts.md`, `README.md`, and the prior global inbox plan. Conclusion: the existing inbox captures opt-in workflow improvement records, but analysis is explicitly deferred; the next safe slice is a local manual report that does not schedule work, auto-create plans, or treat inbox records as verified solutions.
- Decisions: D1 keep the first review loop manual and local; D2 use the existing `~/.immune-brain/insights/workflow-improvement-inbox.md` format as input; D3 allow an override inbox path for tests and manual review; D4 produce candidate themes and recommended next skills only, not automatic plans; D5 prove privacy and write-boundary behavior with fixture-based tests.
- Assumptions: Existing dev insights Markdown records are structured enough for a lightweight parser; first-version grouping can use deterministic text normalization instead of embeddings or LLM clustering; a report command is more valuable than background scheduling until real review usage proves otherwise.

## Steps

### Step 1
- Step ID: U1
- Result: Dev insights review loop contract exists
- Verification: `.imm/specs/dev-insights-review-loop.spec.md` defines the manual review loop, input/output contract, privacy boundary, non-goals, acceptance criteria, and focused validation path.
- Test scenarios: Covers IMM-DEV-INSIGHTS-002 R1; Covers IMM-DEV-INSIGHTS-002 R3; Covers IMM-DEV-INSIGHTS-002 R5
- Depends on: none

### Step 2
- Step ID: U2
- Result: Local review report entry exists
- Verification: A local command or workflow entry can read the default inbox or an explicitly provided inbox path and emit a report with empty-state handling, candidate themes, counts, projects, highest severity, representative evidence, and recommended next skill without writing formal workflow artifacts.
- Test scenarios: Covers IMM-DEV-INSIGHTS-002 R1; Covers IMM-DEV-INSIGHTS-002 R2; Covers IMM-DEV-INSIGHTS-002 R4
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Required report edge cases are handled
- Verification: Local tests use temporary inbox fixtures to prove missing inbox, empty inbox, single record, duplicate-theme grouping, severity aggregation, and no writes to `.imm/specs/`, `docs/plans/`, or active workflow state.
- Test scenarios: Covers IMM-DEV-INSIGHTS-002 acceptance criteria 2; Covers IMM-DEV-INSIGHTS-002 acceptance criteria 3; Covers IMM-DEV-INSIGHTS-002 acceptance criteria 4; Covers IMM-DEV-INSIGHTS-002 acceptance criteria 6
- Depends on: 2

### Step 4
- Step ID: U4
- Result: Developer guidance explains the review loop
- Verification: README or relevant skill documentation explains how to run the manual review loop, what it reads, what it reports, which privacy boundaries it preserves, and which follow-up skill should consume the report.
- Test scenarios: Covers IMM-DEV-INSIGHTS-002 acceptance criteria 5; Covers IMM-DEV-INSIGHTS-002 acceptance criteria 7
- Depends on: 3

## Notes
- Keep this plan out of scheduler, automatic planning, telemetry, LLM clustering, and runtime dispatcher work.
- Do not change the existing dev insights capture format unless implementation proves the current structured fields cannot be parsed.
- If report persistence becomes necessary, route that through a replan decision before adding new durable output paths.
