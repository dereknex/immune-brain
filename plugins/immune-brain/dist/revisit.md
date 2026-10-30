---
name: revisit
description: Use when the user explicitly requests an Immune-Brain workflow-health retro over recent pi session logs.
---

# Immune-Brain: Revisit

Report workflow health — usage, review rework signal and finding totals — over
a look-back window the user supplies in days. It ranks no models. This
is a standalone host-native analysis entry, not a Managed Path continuation
and not an `drive` internal-role dispatch. It reviews no diff — a diff
review is `code-review`.

## Boundary

Allowed: read pi session JSONL under `~/.pi/agent/sessions` (or `--root`),
run the bundled analyzer, and write a stdout report.

Blocked: code, test, Spec, Plan, or `.imm/` edits; session-log writes;
Kernel, TaskIntent, or TaskRecord mutation; Compounder or scheduled runs;
`.imm/audit/` lifecycle statistics.

An already active Managed task remains owned by `drive`. This Skill does
not create or resume Managed authority.

## Invocation

Requires explicit invocation: `revisit` or `/revisit`.
Ordinary questions such as "which model is worse" stay host-native and do
not enter this Skill.

The look-back window in days is required input. If the user named one, use
it. If not, ask before running, because every count moves with the window.

Default scan is the user's full session-log tree. Pass `--project <substr>`
when the user wants one repo or worktree, and `--exclude <substr>` (repeatable)
to drop sessions, for example a Lane worktree tree. Do not invent a filter.

No daemon, no cron, no CI, no automatic commit.

## Counting rules

These rules keep numbers comparable across runs. Read the analyzer header
aloud in the report so the 口径 stays visible.

- One session file is one session; its header `cwd` drives `--project` and
  `--exclude`.
- Timestamps are parsed to epoch milliseconds (ISO strings with any offset, or
  numeric milliseconds) and compared with the window. A line with a missing or
  unparsable timestamp is skipped and counted in the header
  (`skipped lines (no usable timestamp)`); report that count.
- `registr` counts the Kernel `submit_review` registration in the session log.
  `rounds/task` is registrations per distinct `(cwd, task_id)` over all kept
  sessions. Registrations without a `task_id` are counted separately and are
  not a task. High values can be canary/QA harness re-registration, not
  human-visible rework.
- Findings are the `verdict.findings` entries of `submit_review` calls plus
  legacy `record_finding` calls, deduped per session by summary, so a finding
  re-submitted across rounds counts once. The Review `toolResult` copy of the
  same verdict is not counted. Summaries that match `recorded cleanly`,
  `receipt recorded`, `round recorded`, or `no finding(s)` are `bookkeeping`,
  excluded from `blocking` / `advisory`.
- The analyzer still records the last editor model (`edit`, `write`,
  `multiedit`, `apply_patch`) as an `author` field on each review and finding
  event for downstream readers. The report prints no per-author or per-model
  table; do not rank models from it.

Usage counters on the same pass: sessions with activity, assistant turns,
edit counts, and a tool-call name histogram.

## CLI

Run the bundled analyzer with `bun`. The script imports only `node:` APIs.

```
bun "<path-to-skill>/scripts/review_retro.ts" <days> [--root <sessions-dir>] [--project <substr>] [--exclude <substr>]...
```

- `<days>` must be `> 0`.
- `--root` defaults to `~/.pi/agent/sessions`.
- `--project` keeps sessions whose `cwd` contains the substring.
- `--exclude` drops sessions whose `cwd` contains the substring; repeat it for
  several. Combined with `--project`, a session must match the project and none
  of the exclusions. The header names the active filters.
- Malformed JSONL lines are skipped. `days <= 0` is a hard error.

Do not scan live `.imm/` directories. Tests use committed fixtures under
`tests/fixtures/review-retro/`.

## Report

Write-up order:

1. Window, filters and 口径 in one line (copy the analyzer header, including
   the skipped-line count).
2. Usage section: sessions, turns, edits, tool mix.
3. Rework signal: `rounds/task` and the separate task_id-less registrations.
4. Finding totals: blocking, advisory, bookkeeping, and the dedupe line.
5. Three to five bullets of what the numbers mean (where the work
   concentrated, how much rework the kernel path shows).
6. Caveats last.

Separate one-pass from rework by reading `rounds/task` on the kernel path.
Call out a nonzero skipped count: the window is then a lower bound.

## Caveats

Anything the script splits out as `bookkeeping` stays visible next to the
totals it would contaminate. Flag any finding count you cannot trace to a
real defect.

High `rounds/task` can be canary/QA harness re-registration, not
human-visible rework.

This Skill does not persist snapshots or compute week-over-week diffs.
Re-run with a new window when the user wants a later period.

The personal python prototype under `~/.pi/agent/skills/review-retro/` is
not this Skill and is not modified by it.
