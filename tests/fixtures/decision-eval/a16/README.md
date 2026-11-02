# A16 revisit chain class corpus

Labelling protocol for the corpus that `scripts/decision-eval/a16/run.ts` reads
(decision-models S6; BR-DEC-6).

## Building the corpus

1. Save the revisit output: `revisit --json > evidence-<window>.json`
   (contract `immune_brain/revisit_evidence/v2`; a `v1` file is refused).
2. Extract rows: `bun scripts/decision-eval/a16/extract.ts --evidence evidence-*.json --corpus <corpus.jsonl>`.
   One row per `user_resume` chain; other candidate kinds are skipped. Re-running
   on the same corpus keeps every label by row `id`, keeps rows no longer in the
   evidence, and adds new rows as `unlabeled`.
3. Label rows by editing `gold`, `labeler` and `labelled_at` (ISO 8601) in place,
   after reading the chain's `pointers` in the session files.
4. Commit the labelled corpus. The committed copy, not fresh extractor output, is
   the eval input.

`revisit-evidence-sample.json` in this directory is a synthetic test fixture, not
corpus data.

## Classes

The four classes come from the #336 sample (`docs/specs/revisit-candidate-triage.spec.md:30`:
10 `user_resume` chains, one per distinct key, classified as 2 avoidable friction,
4 necessary decisions, 3 error recovery, 1 unknown). That sample committed only
those aggregate counts, not per-chain labels, so this corpus is labelled afresh.

| `gold` | Meaning |
|---|---|
| `avoidable_friction` | The user stepped in only because the workflow stalled or asked something it could have resolved itself. |
| `necessary_decision` | The user stepped in to make a decision only they could make. |
| `error_recovery` | The user stepped in to recover from a failed or errored step. |
| `unknown` | The pointers do not support any other class. |
| `unlabeled` | Not labelled yet; the eval skips it and never counts it. |

`error_resume` chains (stop reason `error` or `aborted`) are not rows: that
class is decided by stop reason alone.

## Running the eval

Configure a profile in `.imm/decision-models.local.json` (gitignored); see
`tests/fixtures/decision-eval/a14/README.md` for the `clef` and `jev` shapes. Then:

`bun scripts/decision-eval/a16/run.ts --corpus <corpus.jsonl> --out <dir>`

`session_event` is a non-sensitive input category, so no `egress` entry is needed.
The model sees only the located fields (key, occurrences, pointers, last result
fields, reply length), never session content. The baseline is `majority_class`,
always `necessary_decision`.
