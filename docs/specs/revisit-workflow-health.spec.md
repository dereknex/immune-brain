# Workflow-health retro (`revisit`)

**Status**: Candidate; no execution authority.
**Initiative**: `revisit-workflow-health` (source issue #322, decisions 1–11).
**Task IDs**: `revisit-s1-workflow-health-report`, `revisit-s2-committed-audit-reader`, `revisit-s3-candidate-improvements`.
**Design risk**: High — S2 widens a Skill boundary (D2-partial, ADR 0032) and makes a host-native Skill script import the Kernel's audit reader, so a read-only analysis now depends on the persisted TaskRecord v2/v3/v4 and terminal-proof formats; no Kernel, record, or writer behavior changes.
**Design views**: architecture layers (reader → normalized events/rows → counter → report; the Kernel owns audit parsing), data flow (HEAD git tree → temporary export → `readAuditTaskPair` → per-run rows → report).
**Document language**: English, following Planner's default document policy.

## Outcome

`revisit` becomes the workflow-health retro. It no longer ranks models by review load. Its primary input is the committed audit evidence of one project, read from that project's HEAD Git tree; Pi session logs become an optional supplement. The report counts lifecycle and raw review facts per terminal run, names its sample bias, and adds a candidate-improvements section. The project-local `workflow-evidence-retro` Skill is absorbed and deleted. `revisit` stays report-only.

Slice results:

| Slice | Observable when it alone has landed | Remaining gap after it |
|---|---|---|
| S1 | The session report has no model ranking; it shows usage, rounds/task with `--exclude`, finding totals, and a skipped-line count; the Skill description names workflow health | no audit input, no follow-through |
| S2 | `--audit <root>` reports lifecycle and raw review counts per committed terminal run from HEAD, with a sample-bias header; ADR 0032 records D2-partial | no candidate-improvements section; WER still exists |
| S3 | The report adds candidate improvements from audit findings; the contract carries WER §3–4 and the fix ladder; WER is deleted | S4 (snapshot/diff) is follow-up work, out of this Initiative |

## Sources

- **#322** — Initiative body and "Decisions (Derek, 2026-10-30)" 1–11 (https://github.com/dereknex/immune-brain/issues/322). Decision IDs below are `#322-Dn`.
- Grilling session 2026-10-30 (Q1–Q24), recorded in #322 decisions 1–11. No upstream `clarify` manifest; scenarios are Spec-local `SCN-*` confirmed in that session (Q21 table).
- Repository evidence:
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:184` — window filter compares raw timestamp strings (`String(o.timestamp ?? "") < cut`); a missing or offset-form timestamp is dropped or kept silently.
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts` — ranking table, quality table and project × author table key every counter by the last editor model.
  - `plugins/immune-brain/dist/revisit.md:19-21` — Boundary blocks `.imm/audit/` lifecycle statistics.
  - `.agents/skills/workflow-evidence-retro/SKILL.md:10,18,33,55` — WER §1 sampling, §2 counts, §3 explanation, §4 one improvement; last changed `62a451b`.
  - `tests/rework-root-cause-contract.test.ts:79-85` — locks three WER §3 sentences.
  - `docs/reports/workflow-evidence-baseline.md:97` — links WER as the reuse entry.
  - `plugins/immune-brain/runtime/kernel/storage.ts:1083-1146` — `readAuditTaskPair(root, taskId, runId?)` reads through filesystem paths under `root`, checks `final_record_hash`, task identity and terminal lifecycle, and parses v2/v3/v4; an incomplete pair or mismatch throws `KernelStoreSecurityError`.
  - `docs/specs/review-verifier-eval.spec.md:476` — D2 (adopted 2026-10-20) keeps record-based metrics out of the retro.
  - `docs/plans/review-verifier-eval-s1-metrics.intent.json` — RVE-S1 asks the analyzer for a per-author-model blocking split and owns rounds-to-pass median/p95 and the per-acceptance series.
  - `tests/skill-dist-consistency.test.ts:82` — trigger tuple for `revisit` names "cross-model review load".
  - `tests/pi-canary-packed-loader.test.ts:58-64` — packed-file list for the `revisit` Skill.
  - `README.md:127,427,484`, `CONTEXT.md:250` — public descriptions of `revisit` as a review-load ranking.
  - Audit survey at `bc06d53` (read-only): 287 committed task records (v4 208, v3 9, v2 70); 284 tracked paths use the run-scoped layout `<task>/run-<id>/`; v4 review findings carry `acceptance_id`, `kind`, `review_round`, `source`, `status`, `summary` and, in 295 of 585, `anchor`/`evidence`/`counterevidence`; none carries `violated`. Terminal proofs carry `terminalized_at`.
  - Session-unit check (read-only, 2026-10-30): all 417 Pi session files under `~/.pi/agent/sessions/*immune-brain*` start with a header whose keys are exactly `cwd,id,timestamp,type,version`; none carries a parent or fork link. #322-D4's check is therefore closed in planning: one file is one session and no stitching is built.

## Threat model and supported environment

Inputs are the user's own Pi session JSONL files and the committed `.imm/audit/**` of a repository the user names. There is no hostile adversary; the cases handled are malformed or truncated lines, missing timestamps, and corrupted or incomplete committed audit pairs. Supported: Bun as the analyzer runtime (the Node type-stripping equivalence claim is dropped because the analyzer now imports Kernel runtime modules); macOS and Linux; Git SHA-1 repositories with a HEAD commit; TaskRecord v2/v3/v4 as `readAuditTaskPair` parses them today.

## Decisions and technical design

### D1 — Ranking retires; author attribution stays an event field (source: #322-D3, #322-D10)

S1 deletes the model-ranking table, the review quality-and-score table, the project × author table, `pass%`, `avgSc`, `rev/100ed`, and their tests. The retirement is stated in the changeset and in the tests' commit. The session reader still records the last editor model as an `author` field on each review and finding event, because RVE-S1 consumes it; that field is reachable through an exported reader function, not through the report.

### D2 — Session reader fixes (source: #322-D4, #322 S1 row, delegated technical choice)

- One file stays one session (Sources: session-unit check).
- Timestamps are parsed to epoch milliseconds (ISO strings with any offset, or numeric milliseconds). A line with a missing or unparsable timestamp is skipped and counted; the header prints that count.
- `--exclude <substr>` (repeatable) drops sessions whose `cwd` contains the substring, symmetric with `--project`; the header lists active filters.
- rounds/task is computed over all kept `(cwd, task_id)` pairs, not per author; registrations without a `task_id` are counted separately, not as a task.
- Finding totals (blocking, advisory, bookkeeping) and the dedupe line stay, without a model key.

### D3 — Input selection (source: #322-D8, delegated technical choice)

- No `--audit`: the session report runs as in S1 (backward compatible).
- `--audit <project-root>`: the audit report runs; sessions are read only when `--sessions` is also given (`--root` still names the session tree).
- `--audit` names exactly one project; there is no default audit scan and no multi-project scan.

### D4 — Audit reader over the HEAD tree (source: #322-D2, #322-D9)

- `<project-root>` must be a Git work tree with a HEAD commit; otherwise the analyzer exits non-zero with a usage error.
- The reader resolves HEAD, exports `.imm/audit/**` from that commit (`git archive`) into a fresh temporary directory, and enumerates flat (`<task>/`) and run-scoped (`<task>/run-<id>/`) pairs. Each pair goes through `readAuditTaskPair(<tmpdir>, taskId, runId?)` imported from `plugins/immune-brain/runtime/kernel/storage.ts`. The reader never opens working-tree audit files, `.imm/state/`, SQLite or the authority store. The temporary directory is removed on success and on failure.
- A pair that is incomplete, fails the proof check, is non-terminal, or does not parse is skipped and counted by reason (`incomplete`, `proof_mismatch`, `invalid`).
- The `<days>` window applies to the proof's `terminalized_at`; a pair without it is skipped as `no_terminal_time`.
- The header prints the project root, the HEAD commit, schema counts, skipped counts by reason, and this bias line: only merged terminal runs are present; unmerged Lane branches, non-terminal runs and stopped runs whose pair was never committed are absent.
- A `--audit-ref` multi-ref mode is out of scope (follow-up).

### D5 — Raw counts only (source: #322-D2, #322-D11)

Per run (one row per pair, newest `terminalized_at` first, path as tie-breaker; `--sample N` caps rows, default 10) and in window totals:

- lifecycle (`done`/`stopped`) and schema version;
- QA pass attestations and QA execution failures (`findings[source=execution]`);
- review rework events (`request_rework` with review authority) and review pass attestations;
- findings by `source` × `status`;
- compatible revisions (`revise_intent`), breaking revisions (`approve_breaking_intent_revision`), user-authorized rework (`authorize_rework`), stop events;
- distinct evidence bindings (distinct `intent_content_hash` and distinct `diff_hash` over attestations).

A field a schema version lacks prints `-`, never `0`. `revisit` computes no median, p95, share, rounds-to-pass, or per-acceptance series; those stay with RVE-S1. The audit report has no model column (audit `actor_id` is role-level).

### D6 — Candidate improvements (source: #322-D1, #322 S3 row)

The analyzer adds a "Candidate improvements" evidence section over in-window audit review findings:

- **Repeat groups**: findings grouped by a normalized summary key (lowercased, whitespace collapsed, hex digests, digits and backtick-quoted paths replaced by placeholders). A group is shown when it spans at least two distinct runs, with its run count, finding count, and up to three example `run path#finding id` pointers.
- **Infrastructure jitter**: findings whose summary records a missing or cleaned-up reviewer agent, or an empty verdict, are listed separately and kept out of the content-rework count.
- **High-round tasks**: for every run with three or more review rework events, one line per round lists that round's finding acceptance ids and marks ids that repeat. This is a per-run evidence listing, not a cross-run series (D5).

The analyzer suggests no improvement level and no disposition. The `dist/revisit.md` follow-through section carries the judgment method: WER §3 (read all findings, the cross-boundary trace, rejection-test questions, historical resolved ≠ current bug, counterchecks), WER §4 (one smallest improvement), pstack `correct`'s fix ladder (architecture > types > lint > test > docs), and the report-only rule: each candidate ends with a copy-ready TaskIntent or issue draft, and `revisit` creates no issue, TaskIntent, branch or commit.

### D7 — WER retirement (source: #322-D1)

S3 deletes `.agents/skills/workflow-evidence-retro/`. The three sentences locked at `tests/rework-root-cause-contract.test.ts:79-85` move into `dist/revisit.md`, and the test reads them there. `docs/reports/workflow-evidence-baseline.md:97` points to `revisit` instead; the report stays as a historical worked example.

### D8 — Boundary record (source: #322-D2, #322-D7)

S2 adds `docs/adr/0032-revisit-reads-committed-audit.md` (status accepted): `revisit` may read committed `.imm/audit/**` of one named project at HEAD, computes lifecycle and raw review counts only, and references RVE-S1 for derived review metrics. `docs/specs/review-verifier-eval.spec.md` D2 already carries a "Superseded in part" note, written in planning on 2026-10-30 rather than by S2: an intent binds at most one Spec, and editing that Spec after RVE-S1 enrolls would break its frozen Spec binding. ADR 0032 links back to that note. `dist/revisit.md` Boundary moves `.imm/audit/` from Blocked to Allowed (committed, HEAD, `--audit` only) and keeps live `.imm/`, SQLite and the authority store blocked. Snapshot writes get their own ADR with S4.

### D9 — Description and routing (source: #322-D6)

The name stays `revisit`. The description in `SKILL.md` and `dist/revisit.md` becomes a workflow-health retro over committed audit records and session logs; model-ranking triggers are removed. `README.md` and `CONTEXT.md` descriptions follow. `tests/skill-dist-consistency.test.ts` gets a new trigger tuple.

### D10 — Release notes (source: delegated technical choice)

Each Slice adds one changeset for `immune-brain`, `minor`, because each changes the public `revisit` report.

## Follow-up (not in this Initiative)

- **S4 — snapshot and diff**: `--out <dir>` writes `snapshot-<date>.json` plus `decisions-<date>.tsv`; a diff mode compares snapshots; its own ADR (#322-D5, #322-D7).
- `--audit-ref <ref>` multi-ref reads during a batch (#322-D9).
- Claude Code session reader (#322-D5).
- Known gap owned by Kernel/batch, not `revisit`: whether every stopped run's audit pair is committed is unverified (#322-D9).

## User scenarios

- **SCN-1** (S1, automated → S1 AC1, AC2, AC3) — Actor: maintainer. Given Pi session logs, when they run `/revisit 30`, then the report shows usage, rounds/task over kept tasks, finding totals and a skipped-line count, and no model ranking.
- **SCN-2** (S2, automated → S2 AC1, AC2) — Actor: maintainer. Given a repository with committed audit pairs, when they run `/revisit 30 --audit .`, then the report shows per-run lifecycle and raw review counts from HEAD, with the HEAD commit and the sample-bias line in its header.
- **SCN-3** (S3, automated → S3 AC1, AC2, AC3) — Actor: maintainer. Given committed audit findings that repeat across runs, when they run `/revisit 30 --audit .`, then the report lists repeat groups with run pointers, jitter separately, and per-round acceptance ids for high-round runs.
- **SCN-4** (S3, manual) — Actor: maintainer with an agent. Given the S3 evidence section, when the agent follows the `revisit` follow-through method, then the write-up names at most three opportunities with evidence and counterchecks and one smallest improvement with a copy-ready draft. Manual reason: the agent's judgment over evidence cannot be asserted by a deterministic test; only the contract text is tested (S3 AC4).

## Verification and acceptance mapping

| Slice | AC | Seam (test file → observable boundary) |
|---|---|---|
| S1 | AC1 | `tests/review-retro-analyzer.test.ts` → `run()` report text: no ranking columns, usage and rounds/task present |
| S1 | AC2 | `tests/review-retro-analyzer.test.ts` → `run()` over a fixture with missing/offset/numeric timestamps: skipped count and window membership |
| S1 | AC3 | `tests/review-retro-analyzer.test.ts` → `run()` with `--exclude`, and with `--project` + `--exclude` |
| S1 | AC4 | `tests/review-retro-analyzer.test.ts` → exported session reader: review/finding events carry `author` |
| S1 | AC5 | `tests/skill-dist-consistency.test.ts` → description trigger tuple; `tests/direct-first-routing-contract.test.ts` stays green for the README list |
| S1 | AC6 | changeset grep |
| S2 | AC1–AC4 | `tests/review-retro-audit.test.ts` (new) → `run()` against temporary Git repositories built from committed fixture pairs |
| S2 | AC5 | `tests/review-retro-audit.test.ts` → contract text of ADR 0032, the RVE D2 note and the `dist/revisit.md` Boundary |
| S2 | AC6 | `tests/pi-canary-packed-loader.test.ts` → the packed tarball ships the audit reader; changeset grep |
| S3 | AC1–AC3 | `tests/review-retro-audit.test.ts` → `run()` "Candidate improvements" section over fixture findings |
| S3 | AC4 | `tests/rework-root-cause-contract.test.ts` → `dist/revisit.md` follow-through sentences |
| S3 | AC5 | shell check that WER is gone and the baseline report no longer links it; changeset grep |

Prior art: `tests/review-retro-analyzer.test.ts` already drives `run()` over committed JSONL fixtures; temporary Git repositories are built in tests such as `tests/batch-parent-branch.test.ts`. Committed audit fixtures are copies of real pairs from `.imm/audit/`, so their proof hashes are genuine; the mismatch case edits one copied record.

## Devil's Advocate Audit

- **Rollback resilience**: each Slice is one PR touching the Skill, its contract and its tests; reverting a Slice restores the previous report. S2's ADR and the RVE D2 note revert with it. S3 deletes WER only in the same change that moves its method and its locked sentences, so no state exists where the method lives nowhere.
- **Verification vanity**: S2 tests fail if the reader reads the working tree (a modified working-tree record and an untracked pair must not appear), if proof checking is bypassed (the mismatch fixture must be skipped as `proof_mismatch`), or if absent fields read as `0` (a v2 fixture must print `-`). S1 tests fail if ranking columns return or if a missing timestamp is silently kept.
- **Spec dilution**: #322 decisions 1–11 each map to a decision above (D1–D10) or to Follow-up; the session-unit check (#322-D4) is closed with evidence, not dropped. RVE-S1's per-author split stays possible (D1). Raw counts vs derived metrics (D5) keeps RVE-S1's scope unchanged.
- **Cross-initiative ordering**: RVE-S1 and every Slice here edit `review_retro.ts` and its tests; they run serially, never in one batch.
