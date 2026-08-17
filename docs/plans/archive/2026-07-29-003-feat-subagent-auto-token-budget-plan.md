# Iteration Plan

## Task

- Summary: Enable bounded automatic advisory dispatch for Brainstorm and Planner token control
- Origin: User-requested evaluation of Brainstorm and Planner token consumption with subagent authorization defaulting to `auto`; see `docs/specs/subagent-auto-token-budget.spec.md`.
- Research: Runtime probing showed that generic `token`, `schema`, `database`, and `migration` wording entered `high_risk`, while implementation-plus-test-plus-doc paths entered `multi_domain`. U1/U2 corrected routing and advisory budgets. U3 added benchmark instrumentation, but independent QA and adversarial preplan review found that its historical Result overstated token reduction: the current Pi host has no valid legacy-auto provider baseline, and a deterministic harness proves comparator behavior only. U4 implemented schema-v2 evidence and claim suppression with 98 focused tests and a valid current-host unavailable probe. The next QA pass nevertheless read `benchmark-results/immune-brain-focused/latest.json`, the schema-v1 U3 artifact, instead of the U4 `/tmp` artifact recorded in execution evidence. This replan makes the U4 artifact workspace-local, canonical, fresh, and unambiguous to QA.
- Decisions: D1. Make repository defaults for `imm-brainstorm` and `imm-planner` resolve to `auto`, while preserving explicit solo, host, lens, subagent, and disabled overrides. D2. Replace keyword-only high-risk and file-count domain classification with contextual risk phrases and ownership-domain grouping. D3. Use one bounded advisory budget with one candidate for normal auto activation, two for elevated risk, and three only for explicit ensemble requests. D4. Enforce portable prompt and normalization limits rather than assuming a provider-level `max_tokens` parameter. D5. Collect advisory metrics from runtime activation/packet JSON, not child prose. D6. Separate run-level `evidence_status` from comparison-level `measurement_status`. D7. Mark deterministic evidence `contract_only`; only complete provider-runtime evidence may accept a provider token-reduction claim. D8. Use schema v2 with metric provenance, stable reason codes, full paired identity, required quality fields, and duplicate-index rejection while retaining schema-v1 read compatibility. D9. Preserve provider telemetry and a reproducible legacy/pre-change cohort as the immediate successor boundary. D10. Reserve `benchmark-results/immune-brain-u4-provider/latest.json` as the sole QA-authoritative U4 probe artifact; keep `benchmark-results/immune-brain-focused/latest.json` as read-only U3 history.
- Assumptions: The current Pi host continues to lack a trustworthy provider baseline. Existing packet consumers accept additive budget metadata. The QA host can read the parent workspace path named in structured execution evidence. The provider token-reduction question remains unresolved until a successor Plan has runtime telemetry and a reproducible legacy/pre-change baseline.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Plan Boundary

This Plan owns the executable activation and advisory-budget slice plus a benchmark evidence-classification contract. U1/U2 runtime behavior remains closed. U3's historical closure text is retained because completed Step facts are not rewritten, but independent QA invalidated its provider token-reduction implication; U4 must supersede that implication before terminal completion while reusing the valid instrumentation evidence. Provider telemetry integration and a reproducible legacy/pre-change cohort form the immediate successor boundary. This Plan does not promise a new context service or persisted handoff format.

## Steps

### Step 1

- Step ID: U1
- Result: `imm-brainstorm`/`imm-planner` auto activation selects only semantically justified routes while preserving explicit override precedence.
- Verification: `bun test tests/activation-plan-runtime-surface.test.ts tests/advisory-dispatch-core.test.ts tests/planner-ensemble-contract.test.ts tests/auto-advisory-route-contract.test.ts && git diff --check`; run `plugins/immune-brain/bin/imm-activation-plan` fixtures for generic token/schema/database/migration tasks, companion code-test-docs paths, real security paths, explicit solo, explicit subagents, and disabled mode; confirm route class, gate reason, and candidate count.
- Agent Hint: imm-executor
- Test scenarios: Covers generic token wording staying solo under auto; Covers code-plus-test-plus-doc paths staying one ownership domain; Covers real auth/permission and cross-host contract changes entering bounded advisory dispatch; Covers explicit solo overriding auto; Covers explicit subagents overriding a non-eligible route; Covers disabled mode suppressing dispatch.
- Depends on: none

### Step 2

- Step ID: U2
- Result: `imm-brainstorm`/`imm-planner` advisory packets enforce bounded candidate fan-out with deterministic degraded-result metadata.
- Verification: `bun test tests/advisory-dispatch-core.test.ts tests/planner-ensemble-contract.test.ts tests/pi-brainstorm-agent-result-contract.test.ts tests/advisory-budget-contract.test.ts && git diff --check`; inspect generated Pi envelopes to prove every child remains no-tools and advisory-only, then feed oversized and legacy child outputs through both normalizers and assert bounded arrays, entry lengths, `truncated`, `degraded`, owner, fallback, and authority fields.
- Agent Hint: imm-executor
- Test scenarios: Covers one fast candidate for normal auto activation; Covers at most two candidates for elevated risk; Covers at most three candidates only for explicit ensemble requests; Covers oversized child output being marked degraded and truncated; Covers legacy bounded child output remaining valid; Covers failed optional dispatch falling back without retry; Covers no child packet gains tools, write authority, workflow-state mutation, or QA closure.
- Depends on: 1

### Step 3

- Step ID: U3
- Result: Auto-mode benchmark evidence proves lower token use without weakening Brainstorm or Planner behavior contracts.
- Verification: `bun test tests/immune-brain-behavior-eval-contract.test.ts tests/brainstorm-decision-probing-contract.test.ts tests/auto-advisory-benchmark-contract.test.ts && git diff --check`; run the focused Brainstorm behavior fixture and representative planner scenarios through the configured Pi runner, record `reported_tokens`, `tool_uses`, `question_count`, `child_count`, `packet_bytes`, `truncation_count`, and `duration_ms`, and compare against the stored baseline with completion and verifier checks unchanged.
- Agent Hint: imm-executor
- Test scenarios: Covers focused Brainstorm narrowing and confirmation behavior; Covers `BR-Q-*` items blocking planner handoff; Covers Brainstorm manifest and Planner Trace preservation; Covers auto-mode child count and token metrics; Covers explicit-only baseline compatibility; Covers benchmark output using `unavailable_by_host` when provider billing is unavailable rather than inventing cost.
- Depends on: 2

### Step 4

- Step ID: U4
- Result: Benchmark evidence classification suppresses unsupported provider token-reduction claims.
- Verification: `bun test tests/benchmark-eval-runner.test.ts tests/auto-advisory-benchmark-contract.test.ts tests/benchmark-baseline-contract.test.ts && probe_started_at=$(bun -e 'process.stdout.write(String(Date.now()))') && bun scripts/benchmark_eval.ts --fixture tests/fixtures/immune-brain-benchmark.json --results-dir benchmark-results/immune-brain-u4-provider && bun -e 'const r = await Bun.file(Bun.argv[1]).json(); const started = Number(Bun.argv[2]); if (r.schema_version !== 2 || r.benchmark !== "immune-brain" || r.evidence_status !== "unavailable" || r.evidence_reason_code !== "runtime_advisory_metrics_unavailable" || r.claim_scope !== "provider_runtime" || r.metrics_complete !== false || !Number.isFinite(started) || Math.min(Date.parse(r.recorded_at), started) !== started) process.exit(1)' benchmark-results/immune-brain-u4-provider/latest.json "$probe_started_at" && bun scripts/sync-dist-docs.ts --check && git diff --check`; record `benchmark-results/immune-brain-u4-provider/latest.json` as the execution artifact and assert the ten-pair synthetic fixture is `comparable` but `contract_only` and `accepted = false`.
- Agent Hint: imm-executor
- Discovery cache: scripts/benchmark_eval.ts (run/comparison schema, collector, comparator, persistence, CLI exit behavior); tests/benchmark-eval-runner.test.ts (run evidence and schema compatibility); tests/benchmark-baseline-contract.test.ts (paired identity, claim scope, quality, and duplicate-index gates); tests/fixtures/immune-brain-benchmark.json (current-host capability declaration); benchmark-results/immune-brain-u4-provider/latest.json (sole U4 QA artifact); benchmark-results/immune-brain-focused/latest.json (read-only U3 historical artifact)
- Failure behavior: Do not record passing execution evidence unless the canonical U4 artifact is fresh and matches every asserted schema-v2 field. A failed or interrupted probe may leave an older U4 artifact but cannot satisfy the timestamp gate. Never overwrite or cite the U3 historical artifact as U4 evidence; reject malformed evidence or duplicate pair keys without producing a provider claim.
- Test scenarios: Covers current-host explicit advisory-metric unavailability with a stable reason; Covers a fresh schema-v2 canonical U4 artifact visible to QA; Covers the U3 schema-v1 artifact remaining isolated and ineligible; Covers unexplained missing or child-footer-only metrics as incomplete; Covers schema-v1 read compatibility without provider-claim eligibility; Covers ten unique contiguous pairs with fixture, prompt, workspace, verifier, model, and source identities; Covers duplicate indexes and identity mismatches failing closed; Covers required completion, verifier, and parent-authority values; Covers deterministic lower-median results remaining contract-only and unaccepted; Covers complete provider-runtime lower medians being accepted only with all parity checks; Covers quality regressions and explicit-only controls never producing a provider claim.
- Depends on: 3

## Notes

- Scope pressure: U4 touches the benchmark collector, schema, fixture capability declaration, comparison identity, comparator, persistence behavior, and focused tests because those surfaces jointly decide whether a provider claim is supportable. It does not change U1/U2 activation behavior, introduce provider telemetry, execute a legacy provider revision, or create child-owned workflow paths. Provider telemetry and the real paired cohort are a separate authority and verification boundary; context projection and persisted handoff remain later slices.
- Contract surface: `scripts/benchmark_eval.ts`, `tests/benchmark-eval-runner.test.ts`, `tests/benchmark-baseline-contract.test.ts`, `tests/auto-advisory-benchmark-contract.test.ts`, `tests/fixtures/immune-brain-benchmark.json`, and the generated U4 artifact namespace `benchmark-results/immune-brain-u4-provider/`; packaged documentation changes only when `sync-dist-docs.ts --check` identifies a generated contract surface.
- Compatibility: schema-v1 history remains readable and is never rewritten; it is ineligible for provider claims when v2 evidence fields are absent. `benchmark-results/immune-brain-focused/latest.json` remains U3-only. Existing non-advisory fixtures retain their prior completion semantics. Public `accepted` behavior becomes stricter only for provider claims.
- Interruption recovery: each successful U4 probe atomically refreshes `benchmark-results/immune-brain-u4-provider/latest.json` and appends its U4 history. Verification captures a pre-run timestamp, so stale output cannot close U4 after an interrupted probe. A resumed paired collection uses cohort, policy, source revision, and unique `run_index` to collect only absent keys; duplicate keys or mixed fingerprints stop as incomplete. No probe updates workflow state, and the next `imm-work` resumes U4 from recorded execution evidence.
- QA artifact authority: U4 execution evidence and QA must reference `benchmark-results/immune-brain-u4-provider/latest.json` exactly. `/tmp` artifacts and `benchmark-results/immune-brain-focused/latest.json` are non-authoritative for U4.
- Design risk: High. U4 changes benchmark evidence and claim semantics while preserving parent authority and explicit operator overrides.
- Diagram decision: required. The Spec separately diagrams activation and benchmark evidence-to-claim flow.
- Historical closure: U3 remains closed in the Ledger with its original Result and evidence at `benchmark-results/immune-brain-focused/latest.json`. U4 explicitly supersedes only the unsupported provider token-reduction implication, uses a different artifact namespace, and does not erase U3 instrumentation history.
- Design Conformance: the implementation must match `docs/specs/subagent-auto-token-budget.spec.md`; a local mismatch is rework, while changing default authorization, budget semantics, persistence boundary, claim scope, or evidence-status meaning is replan.

## Devil's Advocate Audit

- Rollback resilience: revert only the U4 schema-v2 evidence fields, fixture capability declaration, comparison-status and claim-scope logic, persistence guards, U4 artifact namespace, and U4-focused tests as one coherent set. Preserve closed U1/U2 behavior, U3 history, and `benchmark-results/immune-brain-focused/`. The generated U4 artifact can be discarded without State Ledger edits; `explicit_only` remains available to suppress automatic dispatch independently.
- Verification vanity: tests must assert exact evidence status, reason code, metric provenance, claim scope, accepted decision, all-record identity, unique indexes, mandatory quality, medians, and parity. The real Pi command must refresh the fixed U4 artifact, prove its freshness and schema-v2 identity, and name it in execution evidence. File existence, an arbitrary legal status, `/tmp` output, the U3 `latest.json`, child-authored footer, or synthetic lower median alone cannot close U4.
- Baseline validity: `explicit_only` cannot stand in for legacy auto. `deterministic_harness` proves comparator behavior only and must remain `contract_only`; schema-v1, unavailable, incomplete, identity-mismatched, child-footer-only, or quality-regressed evidence cannot support a provider claim.
- Spec dilution detection: U4 must correct the historical overclaim without silently redefining synthetic evidence as provider evidence. The accepted current-slice result is claim suppression plus explicit evidence classification. Actual provider reduction remains an unresolved successor outcome, not an implied success. Provider telemetry integration, context projection, protocol modularization, and persisted handoff remain outside U4.

## Roadmap Continuation

- Preserved deferred content: The immediate successor must retain provider runtime advisory-metric acquisition, versioned legacy-auto source identity, ten-pair cohort requirements, and the provider-claim gate. A later context-efficiency slice retains cache-first projection for `current_iteration.json`, `docs/solutions/` frontmatter, modular dispatch protocol loading, and a session-neutral `brainstorm_packet/v1` handoff.
- Coverage matrix: U1/U2 cover activation and advisory packet boundaries; U3 preserves historical instrumentation evidence; U4 owns evidence classification, comparison validity, and provider-claim suppression; the immediate successor owns real provider telemetry and baseline acquisition; later context work owns discovery retrieval and cross-session persistence.
- Open questions: Which Pi host API can expose runtime activation/packet metrics outside child prose? Which repository revision can be executed as a trustworthy legacy-auto provider baseline? Which provider adapters can enforce output-token ceilings natively?
- Promotion criteria: this Plan may close only after U4 refreshes the canonical workspace artifact, records that exact path in execution evidence, proves its schema-v2 unavailable identity and freshness, prevents synthetic and legacy-schema provider claims, validates all paired identities and quality fields, preserves the named U3 artifact, and passes independent QA plus code review. The provider-evidence successor may start only when a runtime telemetry source and executable legacy-auto revision are named; it may claim lower median only after ten comparable provider-runtime pairs.
- Candidate next Plan: `docs/plans/2026-08-001-feat-provider-runtime-token-baseline-plan.md`
- Explicit non-goals: No context CLI, no automatic session lifecycle, no child tools, no child-owned Spec/Plan, no new scheduler, no provider cost estimation when billing is unavailable, no provider telemetry integration or legacy provider execution in U4, and no treating synthetic or `explicit_only` evidence as provider reduction.
