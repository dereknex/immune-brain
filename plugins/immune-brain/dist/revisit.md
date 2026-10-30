---
name: revisit
description: Use when the user explicitly requests an Immune-Brain workflow-health retro over recent pi session logs.
---

# Immune-Brain: Revisit

Report workflow health — usage, review rework signal and finding totals from
Pi session logs, or lifecycle and raw review counts per committed terminal run
with `--audit` — over a look-back window the user supplies in days. It ranks no
models. This
is a standalone host-native analysis entry, not a Managed Path continuation
and not an `drive` internal-role dispatch. It reviews no diff — a diff
review is `code-review`.

## Boundary

Allowed: read pi session JSONL under `~/.pi/agent/sessions` (or `--root`),
read the committed `.imm/audit/` of one named project at HEAD through
`--audit <project-root>` ([ADR 0032](../../../docs/adr/0032-revisit-reads-committed-audit.md)),
run the bundled analyzer, and write a stdout report.

Blocked: code, test, Spec, Plan, or `.imm/` edits; session-log writes;
Kernel, TaskIntent, or TaskRecord mutation; Compounder or scheduled runs;
reading live `.imm/` state, SQLite or the authority store; working-tree audit
files; derived review metrics (rounds-to-pass median or p95, shares, per-model
breakdowns).

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

Pass `--audit <project-root>` to report the project's committed terminal runs
instead of session logs; the root must be the top level of a Git work tree with
a HEAD commit. Add `--sessions` to also read session logs. One project per
call: there is no default audit scan and no multi-project scan.

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
  re-submitted across rounds counts once. A `submit_review` without a verdict
  takes the observed receipt, as the Kernel does (ADR 0017): the assurance
  verdict JSON in the latest Review `Agent` toolResult of that session. Each
  `submit_review` consumes the receipt, so a bare resubmit counts nothing and
  the Review `toolResult` copy is never counted on its own. Summaries that match `recorded cleanly`,
  `receipt recorded`, `round recorded`, or `no finding(s)` are `bookkeeping`,
  excluded from `blocking` / `advisory`.
- The analyzer still records the last editor model (`edit`, `write`,
  `multiedit`, `apply_patch`) as an `author` field on each review and finding
  event for downstream readers. The report prints no per-author or per-model
  table; do not rank models from it.

Committed audit (`--audit`):

- The reader exports `.imm/audit/**` from the project's HEAD commit into a
  temporary directory (`git archive`) and parses each pair, flat `<task>/` or
  run-scoped `<task>/run-<id>/`, with the Kernel's `readAuditTaskPair`. It never
  opens working-tree audit files; uncommitted edits and untracked pairs do not
  appear. The temporary directory is removed afterwards.
- A pair that is incomplete, fails the proof check (`final_record_hash`) or does
  not parse is skipped and counted by reason (`incomplete`, `proof_mismatch`,
  `invalid`, `no_terminal_time`). The window applies to the proof's
  `terminalized_at`; pairs outside it are not counted.
- Per run: lifecycle and schema version; QA pass attestations; QA execution
  failures (`findings[source=execution]`); review rework events (`request_rework`
  with review authority); review pass attestations; findings by source and
  status; compatible revisions, breaking revisions, user-authorized rework and
  stop events; distinct evidence bindings (`<n>i/<n>d` = distinct
  `intent_content_hash` / `diff_hash` over attestations). A field the record's
  schema cannot carry prints `-`, never `0`.
- Rows are ordered newest `terminalized_at` first, path as tie-breaker, and
  `--sample` caps them; the totals cover every in-window run.
- The header names the project root, the HEAD commit, schema counts, skipped
  counts and the sample-bias line. Copy it into the write-up: only merged
  terminal runs are present.
- Counts are raw. `revisit` computes no median, p95, share, rounds-to-pass,
  per-acceptance series or model column from audit records.

- Candidate improvements section (evidence only, `--audit`): over in-window
  review findings, repeat groups (same normalized summary in at least two
  distinct runs, with run count, finding count and up to three
  `run-path#finding-id` pointers), infrastructure jitter (a missing or
  cleaned-up reviewer agent, or an empty verdict, kept out of the content
  rework count) and, for every run with three or more review rework events,
  one line per round with that round's finding acceptance ids, repeats marked
  `*`. The analyzer suggests no improvement level and no disposition.

Usage counters on the same pass: sessions with activity, assistant turns,
edit counts, and a tool-call name histogram.

## CLI

Run the bundled analyzer with `bun`. The session reader imports only `node:` APIs; the audit reader imports the
Kernel's `readAuditTaskPair`, so Bun is the supported runtime.

```
bun "<path-to-skill>/scripts/review_retro.ts" <days> [--root <sessions-dir>] [--project <substr>] [--exclude <substr>]... [--audit <project-root> [--sessions] [--sample <n>]]
```

- `<days>` must be `> 0`.
- `--root` defaults to `~/.pi/agent/sessions`.
- `--project` keeps sessions whose `cwd` contains the substring.
- `--exclude` drops sessions whose `cwd` contains the substring; repeat it for
  several. Combined with `--project`, a session must match the project and none
  of the exclusions. The header names the active filters.
- `--audit` names one project root and switches to the committed-audit report;
  session logs are read only when `--sessions` is also given (`--root`,
  `--project` and `--exclude` then apply to them). A root that is not a Git work
  tree with a HEAD commit is a usage error. `--sample` caps the per-run rows
  (default 10).
- Malformed JSONL lines are skipped. `days <= 0` is a hard error.

Do not scan live `.imm/` directories. Tests use committed fixtures under
`tests/fixtures/review-retro/` and `tests/fixtures/review-retro-audit/`.

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

For an audit report, lead with the header (project root, HEAD commit, skipped
counts and the sample-bias line), then the totals and the per-run rows.

Separate one-pass from rework by reading `rounds/task` on the kernel path.
Call out a nonzero skipped count: the window is then a lower bound.

## Follow-through

Apply this method to the Candidate improvements section and the per-run rows.
It is judgment over evidence, not analyzer output.

1. Read all findings and the relevant event sequences for the sample, not only
   keyword matches. For each proposed pattern, cite exact record paths and
   finding or event IDs; separate observed facts, plausible explanations and
   unknowns. Classify useful quality catches separately from process faults and
   literal user decisions. Check counterexamples before ranking.
2. Aggregate per task before proposing any pattern: group rounds by task identity
   (working directory plus task id), report rounds per task, and for every task
   at three or more rounds list each round's finding acceptance ids and mark
   which ids repeat. Label a round whose recorded cause is a missing or cleaned-up
   reviewer agent, or an empty verdict, as infrastructure jitter and keep it out
   of the content-rework count. Zero-valued block or advisory columns in an
   aggregate table do not describe a clean run; read the per-round findings for
   any task with a high rounds-per-task value.
3. For repeated cross-boundary findings, trace the evidence through the real
   public/host entry, authorization and preconditions, changed behavior and state
   owner, serialization or durable write, and reload and downstream consumer. For
   rejection tests, ask whether the original state could succeed, whether only the
   target condition changed, and whether the asserted rejection reason proves the
   intended invariant. A test that fails because another prerequisite is missing
   does not prove the claimed protection.
4. Historical resolved findings show past rework, not current bugs. Before
   proposing a current fix, inspect the named current paths or explicitly mark the
   proposal as requiring reproduction. Repeated rework alone does not establish
   that a task was too large or an authorization gate was unnecessary.
5. Name up to three distinct opportunities, each with evidence, practical
   consequence, uncertainty and a countercheck; return fewer if the evidence does
   not support three.
6. Choose one next improvement: the smallest change that addresses the
   best-supported recurring pattern, with target behavior, likely files, focused
   verification and a bounded follow-up sample. Prefer existing prompts, tests and
   recovery mechanisms, and check that existing instructions do not already cover
   it before adding text. Preserve authority and assurance boundaries; reduced
   friction is not permission to bypass them.
7. Fix ladder: place the fix at the strongest level that can hold it, in the order
   architecture > types > lint > test > docs. A docs-only fix is justified only
   when no higher level can express the rule.
8. Report-only: each candidate ends with a copy-ready TaskIntent or issue draft.
   `revisit` creates no issue, TaskIntent, branch or commit, and never resumes a
   stopped managed run.

Keep unavailable cost, escaped-defect and post-delivery outcome metrics unknown,
and do not copy local metrics into standing rules.

[The ten-task baseline](../../docs/reports/workflow-evidence-baseline.md) is a
fixed historical worked example of this method, not a threshold for future tasks.

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
