# A15 first real-provider offline eval

**Status**: Candidate; no execution authority.
**Task ID**: `a15-real-eval` (carrier issue #204, owned child #379; follows the decision-model Initiative #349, delivered by #341 and #358, and layered config #368).
**Design risk**: Medium — the slice makes the project's first real call to a hosted decision model and commits its input corpus and output report, and it extends the shared decision-eval report shape that the A4, A14 and A16 runners also produce. No Kernel, Assurance, record, store, authority or `plugins/immune-brain/runtime/` path changes.
**Design views**: data flow (issue listing → corpus → `decide()` → report → recorded-report check), service/component interfaces (report fields added by the harness, the recorded-report check).
**Document language**: English, following Planner's default document policy; the user's reply-language preference does not change document language.

## Outcome

A maintainer can open a committed, dated A15 issue-triage report produced by a real Clef call over this repository's own issues, see per-issue option probabilities with model, version and threshold-set metadata, and compare the model with the `majority_class` baseline. Because the repository's labels are heavily imbalanced (179 `ready_for_agent`, 2 `needs_spec`, 0 `duplicate` among 279 issues on 2026-11-03), the report states the gold distribution and flags that the baseline comparison is not conclusive. Any later reader can check, offline, that the committed report came from a real provider run over the committed corpus.

| Slice | Observable when it has landed | Remaining gap |
|---|---|---|
| `a15-real-eval` | committed corpus `tests/fixtures/decision-eval/a15/corpus.jsonl`; committed `docs/reports/decision-eval/a15-<date>.{json,md}` from a real Clef run; reports carry `counts.gold` and a `class_imbalance` caveat; `checkRecordedReport()` accepts the committed report and rejects fake, mismatched and empty ones | #204 result comment and child-issue closure (Parent step after settlement, BR-REQ-2); thresholds stay unset (BR-OUT-3); every other application point (Brainstorm Trace) |

## Sources

- `BR-*`: the Brainstorm manifest of 2026-11-03 for #204, plus two Planner decision deltas the user confirmed on 2026-11-03: **PD-1** (run A15 as confirmed and state the class imbalance in the report and the #204 comment; no extra human labelling) and **PD-2** (the user exports `CLOUDFLARE_ACCOUNT_ID` and adds a `clef` profile to `~/.config/immune-brain/config.json` before `drive`).
- Repository evidence: `scripts/decision-eval/a15/run.ts`, `scripts/decision-eval/a15/extract.ts`, `scripts/decision-eval/harness.ts:96-260`, `plugins/immune-brain/runtime/decision_model/providers/clef.ts:30-40`, `plugins/immune-brain/runtime/decision_model/contract.ts:10-12`, `tests/fixtures/decision-eval/a15/README.md`, `tests/fixtures/decision-eval/a14/README.md:42-49`, corpus precedent `tests/fixtures/review-eval/corpus.jsonl` (`docs/specs/review-verifier-eval.spec.md:217`).

## Discovery evidence

- Entry points: `scripts/decision-eval/a15/extract.ts` (saved `gh issue list` JSON → JSONL rows, gold pre-filled by `prefillGold`), `scripts/decision-eval/a15/run.ts` (`main()` → `runEval()` → `buildReport()`/`renderMarkdown()` in `scripts/decision-eval/harness.ts`).
- Report consumers: `tests/decision-eval-harness.test.ts:148`, `tests/decision-eval-a4.test.ts:211`, `tests/decision-eval-a14.test.ts:114,162`, `tests/decision-eval-a16.test.ts:128`, `tests/decision-eval-a15.test.ts` — all use `toMatchObject`, so added fields do not break them. Nothing under `plugins/` imports `scripts/decision-eval/`, so no Claude bundle or changeset is affected.
- Credentials: `clef.ts:33-36` reads `account_id_env` and `token_env` from the profile; a missing value yields `credential_missing` per case. Profile resolution is the layered user config (`~/.config/immune-brain/config.json`, `$XDG_CONFIG_HOME` honoured).
- Size: issue bodies total 963,612 characters, largest 49,240 (2026-11-03 listing); the Clef default context window is 65,536 (`clef.ts:13`), and `decide()` already reports truncation per case.

## Threat model and supported environment

Input is the public issue text of `dereknex/immune-brain` (title and body only), authored by repository users and already public; no adversary beyond ordinary repository contributors is modelled. Provider responses are untrusted and are validated by the existing Clef adapter and `decide()` envelope checks. Only `issue_text`, a non-sensitive category (`contract.ts:10`), leaves the machine, only to Clef. Credentials come from environment variables named in the user-local profile and never enter the corpus, report or comment. Supported environment: macOS and Linux with Bun, UTF-8 JSON/JSONL, SHA-1 or SHA-256 Git repositories; the recorded-report check runs fully offline.

## Brainstorm Trace

| Item | Disposition |
|---|---|
| BR-REQ-1 | Covered: D1, D2, D4; AC1, AC3 |
| BR-REQ-2 | Covered as a post-settlement Parent step (D5); scenario BR-SCN-2 (manual) |
| BR-REQ-3 | Covered by the Planner carrier update of #204 before handoff (D5); scenario BR-SCN-2 (manual) |
| BR-DEC-1 | Decisioned: recorded in the #204 body (D5); no implementation authority follows from it |
| BR-DEC-2 | Decisioned: recorded in the #204 body as already implemented by `contract.ts:10-12`; this slice adds no egress category (D2) |
| BR-DEC-3 | Decisioned: #204 stays the carrier; body rewritten (D5) |
| BR-DEC-4 | Covered: D3 key-set check; AC2 |
| BR-OUT-1 | Out: no live use; nothing outside `scripts/decision-eval/`, tests, fixtures and reports changes |
| BR-OUT-2 | Out: no runtime, TaskRecord, batch record or digest path in scope |
| BR-OUT-3 | Out: `A15_ISSUE_TRIAGE` threshold set stays `a15/v0`, `values: null`; AC3 asserts `threshold_set_version: "a15/v0"` |
| BR-OUT-4 | Out: no `egress` entry is added; the user profile carries none |
| BR-DEFER-1 | Deferred (C3): A9 bidirectional risk-tier eval |
| BR-DEFER-2 | Deferred (C4): A5 sampling to Phase 2 |
| BR-DEFER-3 | Deferred: A14, A4, A16 human labelling and real runs |
| BR-DEFER-4 | Deferred per #349: A13, A8, A11, A10, A12, A6, A7, A1–A3 migration, A17, rework budget unit |
| BR-Q-1 | Resolved by PD-2; the real call is confirmed at `drive` (D4) |
| BR-SCN-1 | Automated: AC3, AC4 |
| BR-SCN-2 | Manual (see User scenarios) |
| PD-1 | Covered: D3 caveat; AC4; #204 comment wording (D5) |
| PD-2 | Covered: D4 preconditions |

## Decisions and technical design

### D1 — Corpus (source: BR-REQ-1; corpus precedent `tests/fixtures/review-eval/corpus.jsonl`)

The Executor saves `gh issue list --repo dereknex/immune-brain --state all --limit 1000 --json number,title,body,labels,state,stateReason` to a temporary file outside the repository, runs `extract.ts --repository dereknex/immune-brain --corpus tests/fixtures/decision-eval/a15/corpus.jsonl`, and commits the result unedited: every labelled row keeps `labeler: "repo-labels"` and the gold `prefillGold()` derives. The raw listing is not committed. The fixture README gains one line naming the committed corpus and its source. The committed corpus, not a fresh listing, is the eval input.

### D2 — Run (source: BR-REQ-1, BR-OUT-4; `run.ts` usage line)

`bun scripts/decision-eval/a15/run.ts --corpus tests/fixtures/decision-eval/a15/corpus.jsonl --out docs/reports/decision-eval`, with the default profile from the user config. The runner, `decide()` and the Clef adapter are unchanged; only `issue_text` (title and body) is sent.

### D3 — Report additions and the recorded-report check (source: PD-1 and BR-DEC-4 for content; delegated technical choice for names and the 0.9 threshold)

In `scripts/decision-eval/harness.ts`:

- `buildReport()` adds `counts.gold`: the number of labelled cases per option, every option present (zero included), in option order.
- `buildReport()` adds `caveats: string[]`. It contains `"class_imbalance"` when the most frequent gold option holds at least 0.9 of the labelled cases; otherwise it is empty.
- `renderMarkdown()` adds a `Gold distribution:` line after the `Cases:` line and, when `class_imbalance` is present, a line starting `Class imbalance:` that names the majority option and its share and states that the baseline comparison is not conclusive.
- New exported `checkRecordedReport(report: unknown, corpusBytes: Buffer, point: ApplicationPoint): string[]` returns problem codes, empty when the report is acceptable:
  - `contract_mismatch` — `contract` is not `REPORT_CONTRACT` or `application_point` is not `point.id`;
  - `unknown_field` — a top-level key outside the report shape `buildReport()` produces;
  - `corpus_mismatch` — `corpus_sha256` differs from the SHA-256 of `corpusBytes`;
  - `not_real_provider` — `provider_kind` is not `clef` or `jev`, or `model` is null or `"fake"`;
  - `nothing_decided` — `counts.decided` is 0;
  - `credential_missing` — `counts.unavailable` has a `credential_missing` entry;
  - `labelled_mismatch` — `counts.labelled` or `cases.length` differs from the corpus's labelled row count, or `counts.gold` differs from the corpus's gold distribution.

`REPORT_CONTRACT` stays `immune_brain/decision_eval_report/v1`: the change only adds fields.

### D4 — Real call preconditions and authority (source: BR-Q-1, PD-2; Host Confirmation Boundary)

Before `drive`, the user exports `CLOUDFLARE_ACCOUNT_ID` and adds `{ "kind": "clef", "model": "clef", "account_id_env": "CLOUDFLARE_ACCOUNT_ID", "token_env": "CLOUDFLARE_API_TOKEN" }` as the default profile in `~/.config/immune-brain/config.json`. The Executor does not write that file. The real Clef run is a new outbound data call and is confirmed once inside `drive` before it runs, covering Clef as the only provider and this repository's issue title and body as the only data. A run that ends in `credential_missing`, `config_invalid` or `nothing_decided` is not a deliverable: the task stays incomplete until a run passes AC3. A token without Workers AI permission surfaces as `provider_error` cases.

### D5 — GitHub carrier (source: BR-REQ-2, BR-REQ-3, BR-DEC-1..3)

Before handoff the Planner rewrites the top section of #204 to the current state (delivered #341, #358, #368; stale queue and "#284 not implemented" wording removed; C1–C5 dispositions; remaining live slice and deferred points) and creates one owned child issue for `a15-real-eval` (#379, created 2026-11-03), attached as a native sub-issue of #204. The historical proposal text below the top section is kept. After the task settles, the Parent posts one #204 comment with model and baseline metrics, the gold distribution and imbalance caveat, unavailable counts, the report path and the commit hash, and closes #379. The comment carries no credential.

## User scenarios

- **BR-SCN-1** (automated: AC3, AC4) — Actor: maintainer. Given a local Clef profile bound to A15 and a committed A15 corpus extracted from the repository's issues, When they run the A15 offline eval, Then they see a dated A15 report listing per-issue option probabilities, model id and version, threshold-set version, and the model's metrics beside the `majority_class` baseline.
- **BR-SCN-2** (manual: the result lives in remote GitHub state, which deterministic QA over the frozen snapshot cannot read) — Actor: maintainer. Given the A15 eval has run, When they open issue #204, Then its body describes the current delivered and remaining state with the C1–C5 dispositions, and a comment records the A15 result with the report path.

## Verification and acceptance mapping

| AC | Seam | Positive | Negative / bound controls |
|---|---|---|---|
| AC1 | `tests/decision-eval-a15.test.ts` reading the committed corpus through `parseCorpus` | corpus parses; every row's `repository` is `dereknex/immune-brain`; ≥ 1 labelled row; each row's `gold` equals `prefillGold(row)` and labelled rows carry `labeler: "repo-labels"` | a missing corpus file fails; a row whose gold differs from its labels fails (no hand edits in this run) |
| AC2 | `tests/decision-eval-harness.test.ts` calling `checkRecordedReport()` on reports built by `buildReport()` | a report with `provider_kind: "clef"`, a real model name and the matching corpus returns `[]` | each of: fake provider, `model: "fake"`, altered corpus bytes, `decided: 0`, a `credential_missing` entry, an extra top-level key, a labelled count that disagrees with the corpus returns its own code |
| AC3 | `tests/decision-eval-a15.test.ts` reading every committed `docs/reports/decision-eval/a15-*.json` | ≥ 1 report exists; each passes `checkRecordedReport()` against the committed corpus; `threshold_set_version` is `a15/v0`; every decided case carries `probabilities` over all three options, `model`, `model_version` and `threshold_set_version`; the sibling `.md` exists and contains `| Baseline (majority_class) |` | zero matched report files fails the test rather than passing |
| AC4 | `tests/decision-eval-harness.test.ts` on `buildReport()`/`renderMarkdown()` | `counts.gold` lists every option in order; a 9-of-10 majority yields `caveats: ["class_imbalance"]` and a `Class imbalance:` Markdown line | an 8-of-10 majority yields `caveats: []` and no such line; an option with no labelled case appears with 0 |

AC1 and AC3 catch a fabricated, stale or fake-provider report because the corpus hash, provider kind, model and counts must agree with committed data; AC2 pins each rejection on synthetic input so the check cannot pass vacuously.

## Devil's Advocate Audit

- **Rollback resilience**: everything is additive files plus two optional report fields; reverting the commit removes them. No persisted runtime state, and older reports remain valid v1 reports.
- **Verification vanity**: QA cannot prove the network call happened; it proves the committed report is consistent with the committed corpus and names a real provider and model. A hand-written report could still forge those fields — the residual risk is accepted because the run is confirmed in `drive` and reviewed in the diff, and the report's per-case envelopes would have to be fabricated wholesale.
- **Spec dilution**: the imbalance means the model-versus-baseline numbers carry little signal; the Spec does not claim otherwise and keeps thresholds unset (BR-OUT-3). The confirmed deliverable — a first real-provider run with its report and #204 record — is delivered in full, not narrowed.

## Remaining gap after this slice

Thresholds for A15; balanced labelling for `needs_spec` and `duplicate`; real runs for A4, A14, A16; every deferred point listed in the Brainstorm Trace; any live use.
