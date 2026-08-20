# Iteration Plan

## Task

- Summary: Connect `mise r benchmark-eval` to structured foreground Agent token telemetry.
- Spec: `docs/specs/archive/provider-runtime-token-telemetry.spec.md`
- Origin: The user authorized the provider-evidence continuation from `docs/plans/2026-07-29-003-feat-subagent-auto-token-budget-plan.md`, selected the minimal telemetry-only option, and explicitly deferred the executable legacy-auto paired cohort.
- Research: Pi 0.83.0 exposes provider usage on assistant messages and through `getSessionStats()`, but outer `message_end` usage belongs to the parent orchestration session. `@tintinweb/pi-subagents` 0.14.3 returns foreground Agent results with structured `details.tokens`; a live no-session probe returned terminal status plus `tokens = "1.4k token"`. Background `get_subagent_result` returns the same host-derived total only in a text header, so current U4 artifacts correctly classify it as supplementary `child_footer`. `BenchmarkCollector.consumeAgent` already maps structured token details to `host_runtime`; the existing benchmark prompt selects the wrong background transport. With all changed paths supplied correctly, `imm-activation-plan` classified this as `multi_domain` and made the cost gate eligible, but returned no candidates and safely continued solo with `single_model_fallback`.
- Decisions: D1. Use a fixture-declared `foreground_agent_details` transport and one foreground Agent tool-call batch. D2. Trust only scenario-correlated structured `Agent` details for `host_runtime`; ignore outer-session totals and keep background text supplementary. D3. Keep Pi core and `@tintinweb/pi-subagents` outside repository edits. D4. Give `mise r benchmark-eval` a dedicated `benchmark-results/immune-brain-u5-telemetry/` namespace. D5. Preserve schema-v2 evidence and provider-claim suppression without running a paired cohort. D6. Fail closed if the host cannot provide structured foreground details or the model uses a background path.
- Assumptions: The supported benchmark host remains compatible with Pi 0.83.0 and `@tintinweb/pi-subagents` 0.14.3 foreground result details. Formatted host totals remain acceptable telemetry inputs under the existing `parseReportedTokens` contract; exact-token transport adequacy is deferred to paired-cohort planning. Runtime advisory metrics remain explicitly unavailable.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-DEC-001; BR-DEC-002; BR-OUT-001; BR-OUT-002; BR-DEFER-001; BR-Q-001; BR-Q-002
- Scope Mode: Hold Scope
- Plan boundary: Trusted scenario-level token transport for the current benchmark task only.
- Boundary rationale: Runner topology, structured token attribution, task artifact routing, and fail-closed verification jointly establish one independently closable telemetry invariant. Baseline execution and reduction claims have separate evidence, cost, and promotion boundaries.
- Scope pressure: One runtime script, one fixture, the `mise` task, focused tests, and one generated artifact namespace. No workflow runtime, State Ledger, Pi core, or external package implementation changes.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Plan`, `Step`, `Spec`, `Verification`, `State Ledger`, and `Compounder`.

## Brainstorm manifest

| Item | Statement |
| --- | --- |
| BR-REQ-001 | `mise r benchmark-eval` records every scenario token total from a trusted host-runtime source. |
| BR-REQ-002 | Missing, malformed, background-only, outer-session, or uncorrelated token data fails closed. |
| BR-DEC-001 | Use the minimal telemetry-only Scope B selected by the user. |
| BR-DEC-002 | Use foreground Agent structured details instead of modifying Pi or the external subagent package. |
| BR-OUT-001 | Do not run a legacy-auto or paired provider cohort in this Plan. |
| BR-OUT-002 | Do not claim token reduction or solve runtime advisory metrics and provider cost in this Plan. |
| BR-DEFER-001 | Preserve the executable legacy-auto paired cohort as the candidate next Plan. |
| BR-Q-001 | Whether Pi exposes provider usage is resolved: Pi records usage, but only foreground Agent details provide scenario-level structured attribution in the current command path. |
| BR-Q-002 | Whether current `mise r benchmark-eval` already satisfies the requirement is resolved: no, its U4 artifact uses `child_footer`. |

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | U1 changes the runner transport and verifies a fresh all-scenario `host_runtime` artifact. |
| BR-REQ-002 | covered_by_step | U1 | U1 adds negative provenance, attribution, and malformed-input tests. |
| BR-DEC-001 | captured_as_decision | D1 | The Plan contains one telemetry outcome and no paired execution. |
| BR-DEC-002 | captured_as_decision | D2-D3 | Structured foreground details close the gap without external package edits. |
| BR-OUT-001 | out_of_scope | Roadmap Continuation | A later Plan owns source revision identity and ten paired runs. |
| BR-OUT-002 | out_of_scope | D5 | The existing unavailable classification and claim gate remain authoritative. |
| BR-DEFER-001 | deferred | Roadmap Continuation | Promotion requires closed telemetry evidence from U1. |
| BR-Q-001 | resolved_as_research | Research | Live Pi probes and installed host source establish the available attribution boundaries. |
| BR-Q-002 | resolved_as_research | Research | The canonical U4 artifact records every scenario as `child_footer`. |

## Plan Boundary

This Plan owns only the provider-derived token transport used by the current
repository benchmark task. It changes the benchmark runner contract so every
scenario returns through a structured foreground Agent result and writes a
fresh U5 telemetry artifact. It does not acquire runtime advisory metrics,
execute a legacy source revision, compare cohorts, or accept a provider token
reduction claim.

## Devil's Advocate Audit

1. **Rollback Resilience**: Revert the fixture transport declaration, benchmark prompt/collector changes, `mise.toml` result path, focused tests, and U5 artifact namespace as one set. U3/U4 artifacts, schema-v2 comparison behavior, activation policy, and State Ledger state remain untouched. If the supported host stops exposing structured details, rollback restores the prior explicitly supplementary background path without inventing provider evidence.
2. **Verification Vanity**: Unit tests alone are insufficient. Closure requires a real `mise r benchmark-eval` run, a pre-run timestamp, every scenario marked `host_runtime` with positive finite integer tokens, the expected separate advisory-metric unavailable status, and byte-identical U3/U4 authoritative artifacts. Merely changing prompt text or observing parent `message_end` usage cannot close U1.
3. **Spec Dilution Detection**: The Plan must not rename a background text header to `host_runtime`, divide an outer-session total among scenarios, or present telemetry transport as token reduction. If foreground execution cannot preserve exact scenario correlation, stop for replan instead of weakening provenance.

## Planning Quality Gate

- **contract surface**: `scripts/benchmark_eval.ts`, `tests/fixtures/immune-brain-benchmark.json`, `mise.toml`, `tests/benchmark-eval-runner.test.ts`, `tests/auto-advisory-benchmark-contract.test.ts`, `tests/immune-brain-behavior-eval-contract.test.ts`, and `benchmark-results/immune-brain-u5-telemetry/`.
- **compatibility**: `ReportedTokensSource`, schema-v2 records, CLI flags, comparator behavior, and unavailable advisory-metric semantics remain unchanged. U3/U4 artifacts are read-only controls.
- **interruption recovery**: A failed or interrupted probe may leave an older U5 artifact but cannot satisfy the timestamp gate. Rerun the focused tests and `mise r benchmark-eval`; no workflow state is mutated by a probe.
- **rollback path**: Revert only the U5 transport slice and remove its generated artifact. Do not rewrite historical benchmark namespaces or State Ledger history.
- **verification strength**: Focused parser/runner/task tests plus one real Pi-hosted benchmark run, canonical artifact assertions, historical artifact hashes, generated-doc sync, diagnostics, and `git diff --check`.
- **Brainstorm traceability**: Every confirmed `BR-*` item is mapped above; no open `BR-Q-*` remains. Direct parser inspection maps all 9 declared IDs to 9 trace rows. The current TypeScript CLI still projects `origin_coverage.applicable = false` for compatibility, so that projection is not treated as the coverage proof and is not expanded in this Plan.
- **replan condition**: Replan if foreground Agent results lack structured tokens, cannot be correlated per scenario, require Pi/external package edits, or cannot preserve the fixture's one-batch execution contract.

## Steps

### Step 1

- Step ID: U1
- Result: `mise r benchmark-eval` records provider-derived scenario token totals through the structured foreground Agent result boundary.
- Verification: `bun test tests/benchmark-eval-runner.test.ts tests/auto-advisory-benchmark-contract.test.ts tests/immune-brain-behavior-eval-contract.test.ts && u3_hash=$(shasum -a 256 benchmark-results/immune-brain-focused/latest.json | cut -d' ' -f1) && u4_hash=$(shasum -a 256 benchmark-results/immune-brain-u4-provider/latest.json | cut -d' ' -f1) && probe_started_at=$(bun -e 'process.stdout.write(String(Date.now()))') && mise r benchmark-eval && bun -e 'const r=await Bun.file(Bun.argv[1]).json();const started=Number(Bun.argv[2]);if(r.schema_version!==2||r.benchmark!=="immune-brain"||r.evidence_status!=="unavailable"||r.evidence_reason_code!=="runtime_advisory_metrics_unavailable"||r.claim_scope!=="provider_runtime"||r.metrics_complete!==false||!Number.isFinite(started)||Math.min(Date.parse(r.recorded_at),started)!==started||!Array.isArray(r.scenarios)||r.scenarios.length===0||r.scenarios.some(function(s){return s.scenario_status!=="completed"||s.reported_tokens_source!=="host_runtime"||!Number.isFinite(s.reported_tokens)||!Number.isInteger(s.reported_tokens)||Math.max(s.reported_tokens,0)!==s.reported_tokens||s.reported_tokens===0}))process.exit(1)' benchmark-results/immune-brain-u5-telemetry/latest.json "$probe_started_at" && test "$u3_hash" = "$(shasum -a 256 benchmark-results/immune-brain-focused/latest.json | cut -d' ' -f1)" && test "$u4_hash" = "$(shasum -a 256 benchmark-results/immune-brain-u4-provider/latest.json | cut -d' ' -f1)" && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-30-001-feat-provider-runtime-token-telemetry-plan.md --json && git diff --check`
- Verification type: automated plus live host probe
- Agent Hint: imm-executor
- Test scenarios: Covers fixture-declared foreground result transport; Covers one non-background Agent batch with exact scenario descriptions; Covers structured numeric and formatted token details becoming `host_runtime`; Covers missing, malformed, duplicate, unknown-scenario, background, and outer-session token inputs failing closed; Covers background result text remaining `child_footer`; Covers a fresh all-scenario U5 artifact; Covers advisory-metric unavailability remaining explicit; Covers U3/U4 artifacts remaining byte-identical; Covers no provider reduction claim.
- Discovery cache: scripts/benchmark_eval.ts (benchmark prompt, structured Agent collector, execution, and persistence); tests/benchmark-eval-runner.test.ts (source provenance and run evidence); tests/auto-advisory-benchmark-contract.test.ts (fixture and task contract); tests/immune-brain-behavior-eval-contract.test.ts (runner shape); tests/fixtures/immune-brain-benchmark.json (schema-v2 host capability); mise.toml (benchmark-eval task); benchmark-results/immune-brain-u4-provider/latest.json (read-only U4 classification control); docs/specs/archive/provider-runtime-token-telemetry.spec.md (Technical Design authority)
- Depends on: none
- failure_behavior: If a supported foreground result lacks terminal status, exact scenario correlation, or valid structured tokens, leave the run incomplete and stop for replan. Never substitute parent-session usage, background text, child prose, or deterministic data. A failed probe cannot close U1 through a stale U5 artifact.
- security_considerations: Persist only scenario IDs, aggregate token counts, status, tool-use counts, and durations. Do not persist prompts, credentials, provider responses, session messages, or child conversation text in the telemetry artifact.

## Roadmap Continuation

- Preserved deferred content: Versioned legacy-auto/pre-change source identity, at least ten unique paired provider-runtime runs, runtime advisory metrics, exact quality/authority parity, and provider claim acceptance remain deferred.
- Coverage matrix: U1 owns only trusted scenario token transport and canonical task output. The next Plan owns executable baseline/current cohorts and comparison evidence.
- Open questions: Whether rounded host totals are sufficiently precise for a provider reduction claim; which executable revision is the valid legacy-auto baseline; how runtime advisory metrics become available without child prose.
- Promotion criteria: U1 closes with a fresh all-scenario `host_runtime` U5 artifact, explicit continued advisory-metric unavailability, unchanged U3/U4 artifacts, independent QA, and code review. Only then may the user authorize paired-cohort planning.
- Candidate next Plan: A separately named legacy-auto paired provider benchmark Plan; this line does not create, approve, queue, or activate it.
- Explicit non-goals: No paired cohort, no accepted reduction claim, no Pi core patch, no external package patch, no billing data, no provider cost estimation, no activation-policy change, and no workflow-state mutation by benchmark execution.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-30-001-feat-provider-runtime-token-telemetry-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-30-001-feat-provider-runtime-token-telemetry-plan.md --sync`
