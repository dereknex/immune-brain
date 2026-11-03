# A15 issue triage corpus

Labelling protocol for the corpus that `scripts/decision-eval/a15/run.ts` reads
(decision-models S7, BR-DEC-6).

## Building the corpus

1. Save the repository's issues:
   `gh issue list --state all --limit 1000 --json number,title,body,labels,state,stateReason > issues.json`.
2. Extract rows:
   `bun scripts/decision-eval/a15/extract.ts --issues issues.json --repository <owner/name> --corpus <corpus.jsonl>`.
3. Review the pre-filled `gold`; edit `gold`, `labeler` and `labelled_at` (ISO 8601) in place where a human knows better.
4. Commit the labelled corpus. The committed copy, not fresh extractor output, is the eval input.

`corpus.jsonl` is the unedited extraction of issues from `dereknex/immune-brain`.

`issue-list-sample.json` in this directory is a synthetic test fixture, not corpus data.

## Labels

| `gold` | Pre-filled from | Meaning |
|---|---|---|
| `ready_for_agent` | label `ready-for-agent` | Specified well enough to implement as written. |
| `needs_spec` | label `needs-spec` | Too under-specified; needs a spec first. |
| `duplicate` | `stateReason` `DUPLICATE` | Restates an issue that already exists. |
| `unlabeled` | none, or conflicting signals | Not labelled yet; the eval skips it. |

Rows are pre-filled with `labeler` `repo-labels`. An issue with no signal, or with
signals that disagree (for example both triage labels), stays `unlabeled`. Re-running
the extractor refreshes issue fields and re-derives machine labels, but keeps every
gold label a human set or changed (a `labeler` other than `repo-labels`, or a `gold`
that differs from what the row's labels imply) and every row no longer in the listing.

## Running the eval

Configure a profile in `~/.config/immune-brain/config.json` as for A14
(`tests/fixtures/decision-eval/a14/README.md`), then run
`bun scripts/decision-eval/a15/run.ts --corpus <corpus.jsonl> --out <dir>`.
`issue_text` is a non-sensitive category because the repository is public, so no
`egress` entry is needed (and listing it is `config_invalid`). Only the issue title and
body are sent; labels and `stateReason`, which produced the gold, are not. The report
compares the model with the `majority_class` baseline and carries a calibration section.
