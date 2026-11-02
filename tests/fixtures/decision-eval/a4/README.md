# A4 finding equivalence corpus

Labelling protocol for the corpus that `scripts/decision-eval/a4/run.ts` reads
(decision-models S5; BR-DEC-4, BR-DEC-6). Point `a4_finding_equivalence`, input
category `finding` (sensitive).

## Building the corpus

1. Extract rows from the audit pairs committed at HEAD:
   `bun scripts/decision-eval/a4/extract.ts --corpus <corpus.jsonl> [--root <project-root>]`.
   One row per review finding at round >= 2 of every run with at least 5 review
   rework rounds; `earlier` carries the same run's findings of earlier rounds.
   Re-running it keeps every existing label by row `id`, keeps rows no longer in
   the audit, and adds new rows as `unlabeled`. An invalid existing label exits 1
   with `invalid_gold_label: <id>` and writes nothing.
2. Label rows by editing `gold`, `labeler` and `labelled_at` (ISO 8601) in place.
3. Commit the labelled corpus. The committed copy, not fresh extractor output, is
   the eval input.

## Labels

Label the target finding (`summary`), reading `earlier`.

| `gold` | Meaning |
|---|---|
| `same_invariant` | Violates the same invariant class as an earlier finding, even under another acceptance ID. |
| `new_defect` | A distinct defect that no earlier finding covers. |
| `out_of_contract` | Outside the task's accepted contract. |
| `unlabeled` | Not labelled yet; the eval skips it. |

When unsure, leave the row `unlabeled` rather than guessing.

## Running the eval

Finding text is a sensitive category. Enable it per provider kind in
`.imm/decision-bindings.json`, for example `"egress": { "clef": ["finding"] }`.
Without that entry every case is `unavailable` with `egress_denied`, nothing is
sent, and the run exits 2 (`no_cases_decided`) after writing the report.

`bun scripts/decision-eval/a4/run.ts --corpus <corpus.jsonl> --out <dir>` writes
`a4-<date>.json` and `.md`. Beside the shared harness sections (accuracy, per-option
precision and recall, macro F1, calibration) it reports:

- baseline `same_acceptance`: a finding is `same_invariant` when an earlier finding
  of the run names the same acceptance, otherwise `new_defect`;
- per task (`per_task`): `repeat_trigger_round` (first round where a non-null
  acceptance has findings in two consecutive rounds, the `acceptanceRepeatSeries`
  `current_streak >= 2` rule), `first_correct_grouping_round` (first round of a
  finding the model correctly labelled `same_invariant`) and `rounds_saved` (their
  difference, when both exist).

`per_task` rounds are reconstructed from the corpus rows, so they cover the runs the
corpus holds.
