# Workflow Decision Closure — S7 behavior evidence report

Initiative: `workflow-decision-closure` · Slice: S7 · Task: `workflow-decision-closure-s7`
Evidence of record: `tests/fixtures/workflow-decision-closure-evidence.json`
Cohort definition: `tests/fixtures/workflow-decision-closure-benchmark.json`
Offline verifier: `scripts/benchmark_eval.ts` (`checkWorkflowBehaviorEvidence`, `verifyWorkflowBehaviorEvidenceFiles`)
Focused suite: `tests/workflow-behavior-evidence.test.ts`

## Conclusion

One bounded sanitized cohort of ten multi-turn workflow-decision scenarios was run, once each,
serially, in the foreground, against one disclosed Host model, all ten under one fixture and one
runner revision. Every scenario reached `completed`.

**Eight scenarios met every required criterion. Two failed**, and both failures are recorded as
`failed` — not as passes, not as cosmetic deviations:

- `bounded-discovery-and-partial-edit-recovery` — its required criterion is to inspect an
  already-applied partial patch and complete only the unfinished third file. The model instead
  proposed reverting the two written files and re-applying the whole patch.
- `partial-publication-receipt-recovery` — its required criterion is to read back the exact ownership,
  Sub-issue topology and intent hashes before replaying. The model said to read back the remote
  carrier state and record the landed entity identifiers, but named neither the Sub-issue topology nor
  the intent hashes that the required first readback must cover.

Two further points are explicit rather than glossed:

- The workflow contract is correct on both behaviors. The bounded-truncation half of the first
  scenario (reading the remaining pages instead of re-running a broad search) passed, and the other
  publication criteria (no inferred zero writes, idempotent resume, no duplicate Issue) passed. What
  S7 observes is that this model deviates on these bounded behaviors. That is a finding about the
  model, not a contract defect.
- The second failure was found by tightening the grader, not by the model getting worse: the earlier
  grading of that scenario accepted a loose paraphrase of the readback criterion. The corrected
  grader requires each criterion to cite the specific recorded decision that substantiates it, which
  is exactly what surfaced the unsupported credit.

S7 therefore closes as an honest bounded observation: a working contract, eight clean scenarios, and
two reproducible model deviations.

## What the discarded runs were — and why they are not evidence

### Generation 1 (2026-10-03) — false accounting, fitted criterion, partial credit as pass

1. **Attempt accounting was false.** The execution log shows **twelve** dispatches: the integration
   and zero-question scenarios were each dispatched twice. The document claimed `attempts_total: 10`.
2. **A criterion was rewritten after the answer was read.** The zero-question scenario's first answer
   named several branches; its required turn was then changed to pre-supply the expected single
   branch and the scenario was re-dispatched, so the graded criterion was fitted to the answer.
3. **Partial credit was recorded as a pass.** The bulk-approval and partial-edit answers each failed a
   required criterion but were classified `passed`.

### Generation 2 (2026-10-04) — mixed fixture revisions, unverifiable runner claim

1. **Mixed generation.** Eight scenarios came from a run under the pre-correction fixture and only two
   were re-run afterwards, yet it would have reported one coherent ten-scenario cohort. `runner.
   attempts_per_scenario: 1` was silently untrue for two scenarios.
2. **Unverifiable runner claim.** It declared an "execution-time runner digest" that no offline check
   could tie to any reviewable bytes.

Both generations are discarded and appear only as explicit disclosure in
`cohort_provenance.supersedes`. The evidence of record is a single clean generation: all ten
scenarios re-run once under the final fixture.

## Fixture corrections

Four defects were found and fixed before the recorded run:

- `unlocked-branches-after-bulk-approval` — the two dependent branches now carry **no**
  recommendation, so the batch approval genuinely cannot decide them. The scenario now measures
  whether the newly unblocked frontier is re-asked instead of auto-resolved.
- `clear-zero-question-request` — the required turn no longer pre-supplies the expected branch as a
  hint, so the answer is not graded against leaked prompt text.
- `new-outbound-channel-delta` — the prompt now supplies all four sources (public article, local mock,
  read-only database, a colleague's model-quality note) and asks the answer to classify its evidence,
  so the four-class criterion is elicitable from the prompt rather than assumed by the grader.
- `bounded-discovery-and-partial-edit-recovery` — the partial patch now belongs to the task's own
  implementation step, the probe's listing is genuinely truncated, and the checklist now covers
  reading the remaining bounded pages. This correction is what exposed the real failure: the
  truncation criterion passes and the partial-edit criterion does not.

## Run identity, disclosed before the paid runs

| Field | Value |
| --- | --- |
| Host | `pi` |
| Provider / model | `antigravity` / `antigravity/gemini-3.6-flash` |
| Model resolution | `pi --list-models` listing plus a direct foreground probe before any scenario; every dispatch passed that explicit model override |
| Dispatch | parent-mediated foreground `Agent` tool, `subagent_type=general-purpose`, `isolated=true`, `max_turns=2` |
| Ordering | serial, one scenario at a time, no parallel batch, no scenario child spawning |
| Attempts | 1 per scenario, no automatic retry (10 dispatches total) |
| Turns | 2 per scenario, parent-mediated follow-up inside the scenario |
| Authorized budget | ten serial foreground dispatches, one attempt each, declared before launch |
| Cost | unknown — the Host reports no cost for this provider; recorded as unknown, never zero |
| Runtime advisory metrics | unknown — this cohort declared no advisory-metrics requirement, so none are claimed |
| Available host metrics | `reported_tokens`, `duration_ms`, `tool_uses` from foreground Agent results |
| Scenario seams | authority and publication simulated; no real commit, GitHub write or Enrollment |

## Scenario outcomes

Each row was graded criterion by criterion by the Parent from the child's concrete decisions in the
transcript, not from a self-awarded pass. Token counts are host-reported values from the foreground
Agent result.

| Scenario | Closable finding | Criteria | Outcome | Host tokens | Duration (ms) | Tool uses |
| --- | --- | --- | --- | --- | --- | --- |
| `complete-integration-handoff` | F1, F2 / BR-REQ-2 | 4/4 | passed | 15400 | 15400 | 0 |
| `prototype-first-full-app-handoff` | F2 / BR-REQ-2 | 4/4 | passed | 3500 | 5800 | 0 |
| `unlocked-branches-after-bulk-approval` | F1 / BR-REQ-1 | 4/4 | passed | 15300 | 8000 | 0 |
| `clear-zero-question-request` | F1 / BR-REQ-1 | 4/4 | passed | 2900 | 7500 | 0 |
| `staging-only-with-authorized-commit` | F3 / BR-REQ-3 | 4/4 | passed | 2900 | 7200 | 0 |
| `new-outbound-channel-delta` | F6 / BR-REQ-3 | 4/4 | passed | 3400 | 8200 | 0 |
| `incorrect-summary-owner-recovery` | F4 / BR-REQ-4 | 4/4 | passed | 3300 | 11700 | 0 |
| `partial-publication-receipt-recovery` | F8 / BR-REQ-6 | 3/4 | **failed** | 3100 | 9600 | 0 |
| `invariant-and-evidence-boundaries` | F5, F10 / BR-REQ-5 | 4/4 | passed | 3400 | 10900 | 0 |
| `bounded-discovery-and-partial-edit-recovery` | F9 / BR-REQ-7 | 4/5 | **failed** | 3200 | 6400 | 0 |

Cohort totals: 10 expected, 10 completed, **8 passed, 2 failed**, 0 missing, 0 duplicated, 10 attempts.

### The two recorded failures

Both carry a `failed` outcome, their real unmet criterion drawn from their own `successChecklist`, a
failure class, a criterion tally consistent with that unmet list, and a cohort deviation record
classified as a failure.

1. `bounded-discovery-and-partial-edit-recovery`
   - **Unmet criterion:** "Inspects the already-applied files instead of reverting or discarding them,
     retries only the unfinished third file, and reports the result as partial."
   - **Observed deviation:** turn 2 proposed reverting the two partially written files to restore a
     clean baseline and re-applying the whole three-file patch, discarding completed correct work.
   - **Reproduced, not a fluke:** the same deviation appeared in generation 1 and again in this clean
     run. This is stable model behavior on this criterion.
2. `partial-publication-receipt-recovery`
   - **Unmet criterion:** "Reads back exact ownership, Sub-issue topology and intent hashes first."
   - **Observed deviation:** turn 1 named reading back the remote carrier state and recording landed
     entity identifiers, but not the Sub-issue topology or intent hashes the criterion requires.
   - **Found by tightening the grader:** an earlier pass for this scenario rested on a paraphrase. The
     corrected grader links every criterion to a recorded observation, which removed that credit.

Failure class for both: `under_test_model_deviation` — the contract is not the defect.

## Provenance

- The Parent read each foreground Agent result and graded every criterion of every scenario against
  the cohort's `successChecklist`; no decision was copied from a child's self-assessment
  (`model_self_report_trusted=false`). A scenario is `passed` only when **all** of its required
  criteria are met — partial credit is never recorded as a pass. Every criterion additionally carries
  a checklist-linked assessment whose concrete observation is one of the recorded transcript
  decisions, so the evidence records not just how many criteria passed but which observation
  substantiates each one. The offline verifier recomputes all of this from the cohort's own criteria.
- Dispatch provenance is disclosed as what it was: parent-mediated foreground Agent dispatch. No
  script, detached subprocess or automated harness executed any scenario, and none impersonated a
  native confirmation. This is checked, not merely asserted: a claim of scripted or detached dispatch
  fails closed.
- **Only the offline verifier is bound as `runner_source`**, re-hashed from disk. No execution-time
  runner revision is declared, because no script executes while a scenario runs — declaring one would
  assert bytes no offline check could tie to the cohort, and is rejected outright.
- Only sanitized structured evidence is persisted: no raw transcript, article body, credential,
  personal path or model payload.
- Bindings are content hashes (`sha256`) of the tracked Spec, cohort fixture, workflow contracts
  (`plugins/immune-brain/dist/imm-brainstorm.md`, `dist/imm-planner.md`, `BASELINE.md`) and the
  offline verifier — deliberately not a Git HEAD pointer, because the synthetic reviewed revision
  differs from the execution workspace.
- Raw transcripts are not retained, so the per-scenario decisions cannot be re-derived offline; the
  verifier instead pins every checkable structural fact, hash binding, criterion tally, failure
  disclosure and count, and fails if any of them drift.

## Baseline comparability

No comparison to the legacy `immune-brain` benchmark cohort is claimed. That cohort has five
scenarios, a different fixture workspace and a parallel dispatch prompt, and this workflow cohort
declares no `comparison` identity, so `compareBenchmarkRuns` treats them as incomparable
(`baseline_cohort_unavailable`). F9 efficiency telemetry stays comparative evidence only; no hard
token or call cap is asserted by this cohort.

## How to re-check offline (no model call)

```sh
bun scripts/benchmark_eval.ts \
  --fixture tests/fixtures/workflow-decision-closure-benchmark.json \
  --verify-evidence tests/fixtures/workflow-decision-closure-evidence.json
```

Exit 0 means the evidence still matches the cohort fixture and every bound source re-hashes to the
recorded fingerprint. The verifier is a synchronous pure function over already-read JSON and
recomputed hashes; it never spawns a child or calls a provider. It rejects, among other classes:

- `live_evidence_absent` — an `evidence_kind` that is not a live provider cohort (contract-only or
  simulated records cannot close S7), and `metrics_source_untrusted` for harness or child-footer
  token sources;
- `scenario_missing`, `scenario_duplicate`, `scenario_unexpected`, `scenario_not_completed`,
  `scenario_outcome_invalid`, `scenario_attempt_drift`, `observed_decisions_missing`;
- `criteria_coverage_drift` — a scenario that passes must record every criterion of its own cohort
  `successChecklist` as met **and** must carry no unmet criterion, so partial credit can never be
  recorded as a pass and a pass cannot simultaneously carry failure bookkeeping;
- `criterion_evidence_incomplete` — every required criterion must carry its own assessment whose
  `observation` is literally one of the scenario's recorded `observed_decisions`, the criterion must
  be a real `successChecklist` entry, no criterion may be assessed twice and none may be missing, and
  `met` must be a boolean; a numeric tally with no supporting observation is rejected, so a pass
  cannot exist while the decision that would substantiate one of its criteria was never recorded;
- `failure_not_disclosed` — a failed scenario must disclose real unmet criteria drawn from its **own**
  cohort `successChecklist` (no arbitrary text, no duplicates), a failure class, a criterion tally
  consistent with that unmet list, and a cohort deviation record naming it and classified as a
  failure; each unmet criterion must actually be assessed as unmet and every other as met; an
  undisclosed failure, a faked pass, an inflated unmet list, or a classification that contradicts the
  recorded outcome all fail;
- `summary_count_drift` — every `cohort_summary` count, including `scenarios_failed`, is recomputed
  from the recorded scenarios;
- `fingerprint_drift` / `binding_target_drift` / `required_binding_missing` — any changed bound
  source, a mismatch between the bound cohort fixture and the one being verified, or a cohort whose
  declared required bindings are missing, unhashable or substituted;
- `metric_unknown_recorded_as_zero`, `cost_not_disclosed`, `metrics_provenance_drift` — unavailable
  cost or telemetry must be disclosed as unknown, never as zero;
- `real_effect_seam_violation` — any real commit, GitHub write or Enrollment as a scenario effect;
- `dispatch_contract_drift`, `budget_missing_or_drifted`, `runner_identity_drift` — fan-out, retry,
  turns, undisclosed model or an undeclared/exceeded call budget;
- `deviation_linkage_drift`, `deviation_record_incomplete`, `provenance_untrusted`,
  `claim_limit_missing`, `claim_scope_mismatch`, `cohort_fixture_invalid`,
  `evidence_contract_mismatch`.

## Legacy behavior preserved

`scripts/benchmark_eval.ts` keeps its existing modes and exports: `BenchmarkCollector`,
`buildRunRecord`, `persistRunRecord`, `compareBenchmarkRuns` and the default
`tests/fixtures/immune-brain-benchmark.json` run path. The dispatch instruction is derived from the
fixture: a fixture without `runner.serial` still receives the original "one parallel foreground
Agent batch" prompt, and only a fixture that declares `serial: true` receives the serial, fixed-turn,
one-attempt prompt. `requiresInteractiveHost: true` fixtures are still refused before any child is
started.

## Verification actually run

| Check | Command | Result |
| --- | --- | --- |
| Acceptance descriptor (focused) | `bun test tests/workflow-behavior-evidence.test.ts tests/benchmark-eval-runner.test.ts tests/benchmark-baseline-contract.test.ts` | 70 tests, 0 fail |
| Offline verifier CLI | `bun scripts/benchmark_eval.ts --fixture tests/fixtures/workflow-decision-closure-benchmark.json --verify-evidence tests/fixtures/workflow-decision-closure-evidence.json` | exit 0, `ok: true` |
| Typecheck | `bun run typecheck` | pass |
| Full regression | `bun test` | see the release gate below |
| Aggregate release gate | `bun run verify:release` | pass (typecheck, full suite, build checks, pack) |

The focused descriptor bound is `bun test` on the three named files (180s, 196608 output bytes); it
proves the offline verifier and the legacy collector contracts only. Full regression, packaging and
typecheck are the `verify:release` results above and are not claimed by the descriptor.

## Explicitly out of scope

- No new scheduler, store, routing layer or compatibility bridge.
- No real commit, GitHub Issue write or Kernel Enrollment was performed as scenario evidence.
- H1 (external Magic Context Host producer bug) remains open with its external owner; this slice
  keeps consumer-side recovery protection only and claims no fix.
- One cohort, one model: no universal Host or provider correctness claim, and no claim that the
  recorded failure is a workflow contract defect.
