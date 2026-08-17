# Spec: Dev insights report hygiene

**Task ID**: IMM-DEV-INSIGHTS-REPORT-HYGIENE-001
**Owner**: Planner
**Status**: Withdrawn — the requirements below constrain
`python3 .imm/imm-telemetry.py summarize` and `.imm/imm-dev-insights.py`, both
retired with the Python reference runtime
(`docs/solutions/python-reference-retirement-exception-inventory.md`). Nothing
implements these entry points today, so the requirements are void rather than
outstanding. Reviving the reporting hygiene means a new Bun/TypeScript runtime
command and a fresh spec.

## Goal

Make the manual dev insights and telemetry reports reliable enough for recurring
automation review. The slice fixes report-facing hygiene only: the current
automation command should run, low-value dev-insights themes should not crowd
out useful candidates, and estimated-only telemetry should be named plainly.

## Background

The 2026-06-08 automation run showed three recurring issues:

- `python3 .imm/imm-telemetry.py summarize` exits with an argparse error because
  `--out` is still required.
- `python3 .imm/imm-dev-insights.py --json` includes low-quality themes such as
  `1, 2, 3`, `1`, and `none` because the report groups raw
  `Suggested improvement` / `Friction` text without filtering placeholder values.
- The telemetry summary reports `exact_source_rate: 0.0` because the current
  trace is estimated-only. That is useful operational information, but the
  report does not make the estimated-only state obvious.

Existing guidance still applies: dev insights remains a local, opt-in, manual
review input; telemetry summary must only use fields present in the current raw
trace schema; exact provider usage capture is a separate runtime handoff
question.

## Requirements

### R1. Summarize command compatibility

- `python3 .imm/imm-telemetry.py summarize` must succeed without requiring
  callers to pass `--out`.
- The command must still support explicit `--out <path>` and write the same JSON
  schema there.
- The default output path must be deterministic and user-global or temporary in
  the same spirit as existing dev-insights paths; it must not write Plan, Spec,
  State Ledger, or solution files.
- JSON mode must continue to print the result payload, including `out_path`.

### R2. Dev-insights theme hygiene

- `imm-dev-insights.py` must treat placeholder or low-signal improvement text as
  non-thematic. Examples include empty strings, `Not specified`, `None`,
  `None.`, pure numbers, comma-separated pure numbers, and single-word
  equivalents such as `无`.
- When `Suggested improvement` is non-thematic but `Friction` is useful, the
  report should group by the useful friction text.
- When both fields are non-thematic, the entry should be grouped under a stable
  fallback theme such as `unspecified workflow improvement`.
- Useful Chinese or English sentences that contain real follow-up guidance must
  remain eligible themes.
- Repeated closure reminders such as commit/open-PR/review-diff follow-ups
  should collapse into a stable closure theme instead of crowding out active
  improvement candidates.
- Completed, optional, monitor-only, or no-follow-up entries should be marked as
  likely stale and should not determine the report-level next skill.
- Candidate records should expose a deterministic action, triage status, and
  priority so automation can distinguish review, planning, classification, and
  archival work without parsing prose.

### R3. Estimated-only telemetry clarity

- Telemetry summary output must include an explicit summary-level signal for
  source quality, so a reader can distinguish "all events estimated" from an
  unexpected metric bug.
- Existing per-group `exact_source_rate` must remain available.
- The new signal must be derivable from the existing raw trace schema only. Do
  not add success, ROI, acceptance, or progress metrics.
- Estimated-only summaries must include a reader-facing recommendation that
  explains whether to wire exact runtime metadata or treat the current metrics
  as directional.

## Acceptance Criteria

- Running `python3 .imm/imm-telemetry.py summarize` exits zero and writes a
  deterministic summary file.
- Running `python3 .imm/imm-telemetry.py summarize --out <tmp> --json` still
  exits zero, writes `<tmp>`, and prints a payload containing `out_path`.
- Fixture inbox entries with `Suggested improvement: 1`, `1, 2, 3`, `None.`,
  `Not specified`, and `无` do not create distinct top-level candidate themes.
- If placeholder suggested improvement has meaningful friction, the meaningful
  friction becomes the candidate theme.
- A trace containing only `source: estimated` events produces a summary-level
  source-quality signal that clearly says no exact events are present.
- Estimated-only source quality includes a recommendation mentioning exact
  `IMM_TELEMETRY_*` metadata and directional metrics.
- Repeated commit/open-PR/review-diff inbox records group into a closure action
  instead of separate active candidates.
- No-follow-up or completed entries are marked likely stale with low priority
  and do not select the top-level next skill.
- Focused verification uses isolated temporary paths and does not write formal
  workflow artifacts.

## Non-goals

- Do not implement exact provider usage capture in this slice.
- Do not add scheduler behavior, background reports, remote telemetry backends,
  dashboards, LLM clustering, embeddings, or automatic planning.
- Do not change the dev-insights inbox capture format unless compatibility
  requires a narrow parser adjustment.
- Do not introduce a shared registry, generic dispatcher, or new system-facing
  analysis role.
- Do not rename machine-facing enum or source values globally.

## Verification

Use the existing focused tests as the main feedback loop:

- `python3 -m unittest tests.test_dev_insights_review tests.test_telemetry_trace`

Manual smoke after implementation:

- `python3 .imm/imm-telemetry.py summarize`
- `python3 .imm/imm-dev-insights.py --json`
