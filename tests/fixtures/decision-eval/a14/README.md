# A14 PR comment triage corpus

Labelling protocol for the corpus that `scripts/decision-eval/a14/run.ts` reads
(Spec `docs/specs/decision-model-core.spec.md` D7, D8).

## Building the corpus

1. Save one diagnostic per pull request: `imm-pr-diag <PR> > diag-<PR>.json`.
2. Extract rows: `bun scripts/decision-eval/a14/extract.ts --diag diag-*.json --corpus <corpus.jsonl>`.
   Re-running it on the same corpus keeps every existing label by row `id`, keeps
   rows that are no longer in the diagnostics, and adds new rows as `unlabeled`.
3. Label rows by editing `gold`, `labeler` and `labelled_at` (ISO 8601) in place.
4. Commit the labelled corpus. The committed copy, not fresh extractor output, is
   the eval input.

`pr-diag-sample.json` in this directory is a synthetic test fixture, not corpus
data.

## Labels

Label the target item (`body`), reading its thread `discussion` and the earlier
items of the same pull request.

| `gold` | Meaning |
|---|---|
| `blocking` | Must change before merge. |
| `nit` | Optional polish; merging without it is acceptable. |
| `out_of_scope` | Valid, but belongs to another change (follow-up, separate issue). |
| `duplicate` | Restates an earlier item in the same pull request. |
| `unlabeled` | Not labelled yet; the eval skips it. |

Rules:

- `resolved` and `outdated` are hints, not labels. A resolved thread may still have
  been blocking; label what the comment asked for, not what happened to it.
- Label from the reviewer's request, not from the author's reply.
- When a comment mixes a blocking request and a nit, label `blocking`.
- When unsure, leave the row `unlabeled` rather than guessing.

## Running the eval

Configure a profile in `.imm/decision-models.local.json` (gitignored), for example:

```json
{ "profiles": { "default": { "kind": "clef", "model": "clef", "account_id_env": "CLOUDFLARE_ACCOUNT_ID", "token_env": "CLOUDFLARE_AUTH_TOKEN" } } }
```

Then run `bun scripts/decision-eval/a14/run.ts --corpus <corpus.jsonl> --out <dir>`.
PR comments are a non-sensitive input category, so no `egress` entry is needed.
