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

Configure a profile and default binding in `~/.config/immune-brain/config.json` (or `$XDG_CONFIG_HOME/immune-brain/config.json`), for example:

```json
{ "contract": "immune_brain/user_config/v1", "decision_models": { "default_profile": "default", "profiles": { "default": { "kind": "clef", "model": "clef", "account_id_env": "CLOUDFLARE_ACCOUNT_ID", "token_env": "CLOUDFLARE_AUTH_TOKEN" } } } }
```

Then run `bun scripts/decision-eval/a14/run.ts --corpus <corpus.jsonl> --out <dir>`.
PR comments are a non-sensitive input category, so no `egress` entry is needed.

### Jev (TypeSafe System One) profile

```json
{ "contract": "immune_brain/user_config/v1", "decision_models": { "default_profile": "default", "profiles": { "default": { "kind": "jev", "api_key_env": "TYPESAFE_API_KEY" } } } }
```

Optional fields: `base_url` (default `https://api.typesafe.ai`), `timeout_ms` (1000-120000,
default 30000) and `context_window` (positive integer; without it `truncation` reports
`unknown`). The adapter POSTs the Clef choice request body to `<base_url>/v1/systemone`
with `Authorization: Bearer <value of api_key_env>` and parses the Clef choice result
shape (bare, or wrapped in `result`).

**Unverified.** These facts come from third-party pages, not TypeSafe's reference, and
were last checked on 2026-11-02:

- LangChain docs, TypeSafe provider page
  (`https://docs.langchain.com/oss/javascript/integrations/providers/typesafe.md`):
  default base URL `https://api.typesafe.ai`, overridable.
- typia.io Jev page (`https://typia.io/docs/utilization/jev/`): request is a `model`, a
  `state` and a `questions` map; the key comes from `TYPESAFE_API_KEY`.
- A launch article (`https://letsdatascience.com/news/typesafe-ai-launches-jev-decision-model-889a38c0`):
  the choice primitive returns a `choice`, a `probabilities` map and a `confidence`.

Not confirmed by any of them: the `/v1/systemone` route, the Bearer header, the result
shape, and the request `model` value (the adapter sends `"clef"` so that the body equals
the Clef body; the typia.io example uses a `jev-<version>` model id). A mismatch with the
real API surfaces as `unavailable` (`provider_error` or `invalid_response`), never as a
decision. Replace this section with the reference once it is checked.
