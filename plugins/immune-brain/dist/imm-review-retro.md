---
name: imm-review-retro
description: Use when the user explicitly requests Immune-Brain ranking of models by cross-model review load or a project usage retro.
---

# Immune-Brain: Review Retro

Rank models by how much code review their own edits triggered, and report
basic project usage over a look-back window the user supplies in days. This
is a standalone host-native analysis entry, not a Managed Path continuation
and not an `imm-loop` internal-role dispatch. It reviews no diff — a diff
review is `code-review`.

## Boundary

Allowed: read pi session JSONL under `~/.pi/agent/sessions` (or `--root`),
run the bundled analyzer, and write a stdout report.

Blocked: code, test, Spec, Plan, or `.imm/` edits; session-log writes;
Kernel, TaskIntent, or TaskRecord mutation; Compounder or scheduled runs;
`.imm/audit/` lifecycle statistics.

An already active Managed task remains owned by `imm-loop`. This Skill does
not create or resume Managed authority.

## Invocation

Requires explicit invocation: `imm-review-retro` or `/imm-review-retro`.
Ordinary questions such as "which model is worse" stay host-native and do
not enter this Skill.

The look-back window in days is required input. If the user named one, use
it. If not, ask before running, because the ranking moves with the window.

Default scan is the user's full session-log tree. Pass `--project <substr>`
when the user wants one repo or worktree. Do not invent a project filter.

No daemon, no cron, no CI, no automatic commit.

## Counting rules

These rules keep numbers comparable across runs. Read the analyzer header
aloud in the report so the 口径 stays visible.

- `review` = an `Agent` tool call with `subagent_type` equal to `Review`.
- Attribution = the model behind the most recent `edit`, `write`, or
  `multiedit` in that session. If none, the row is `no-edit (review-only)`.
- `uniq` counts distinct (session, description+prompt prefix) pairs. A wide
  gap versus `reviews` is the same review re-run on the same code.
- `rev/100ed` is `100 * reviews / devEdits`. Rank on both absolute `reviews`
  and this intensity. A model can lead one axis and sit mid-pack on the
  other.
- `avgSc` / `pass%` parse `[SCORE: …]` and `[VERDICT: …]` tags from the
  matching Review `toolResult`. Untagged reviews show `-`.
- `registr` counts `imm_kernel_canary` `submit_review`. It is the
  registration of the same review and is never added into `reviews`.
- `rounds/task` is registrations per distinct `(cwd, task_id)`. High values
  can be canary/QA harness re-registration, not human-visible rework.
- Findings are `record_finding` calls, deduped per session. Summaries that
  match `recorded cleanly`, `receipt recorded`, `round recorded`, or
  `no finding(s)` are `bookkeep` / `noisy`, excluded from `block`/`advis`.

Usage counters on the same pass: sessions with activity, assistant turns,
edit counts, a tool-call name histogram, and the project × author table.

## CLI

Run the bundled analyzer. Prefer `bun`; `node` (≥23.6, type stripping) is
an allowed equivalent. The script is erasable TypeScript with `node:` APIs
only.

```
bun "<path-to-skill>/scripts/review_retro.ts" <days> [--root <sessions-dir>] [--project <substr>] [--top N]
```

- `<days>` must be `> 0`.
- `--root` defaults to `~/.pi/agent/sessions`.
- `--project` keeps sessions whose `cwd` contains the substring.
- `--top` is the project-table row cap (default 15).
- Malformed JSONL lines are skipped. `days <= 0` is a hard error.

Do not scan live `.imm/` directories. Tests use committed fixtures under
`tests/fixtures/review-retro/`.

## Report

Write-up order:

1. Window and 口径 in one line (copy the analyzer header).
2. Ranked model table, including scores.
3. Usage section: sessions, turns, edits, tool mix.
4. Quality and score findings.
5. Three to five bullets of what the table means (volume versus intensity,
   quality versus rework, where it concentrated).
6. Caveats last.

Rank on both axes, never one. Name the axis you are ranking by, and call
out models that flip order between `reviews` and `rev/100ed`.

Separate one-pass from rework: compare `uniq` to `reviews`, and read
`rounds/task` on the kernel path.

Evaluate quality: high intensity plus high score is frequent review of
mostly minor issues; low intensity plus low score is rare review of severe
defects. Call out REJECT or highRisk ratings.

Ground each model in its projects. Cite the two or three worktrees where
that model's reviews concentrated.

## Caveats

Anything the script splits out as `bookkeep` stays visible next to the
column it contaminates. Flag any finding count you cannot trace to a real
defect.

High `rounds/task` can be canary/QA harness re-registration, not
human-visible rework.

This Skill does not persist snapshots or compute week-over-week diffs.
Re-run with a new window when the user wants a later period.

The personal python prototype under `~/.pi/agent/skills/review-retro/` is
not this Skill and is not modified by it.
