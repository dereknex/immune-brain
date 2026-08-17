# Spec: Provider Runtime Token Telemetry Bridge

## Summary

Make `mise r benchmark-eval` record scenario token totals from Pi's structured
foreground `Agent` result boundary. The bridge must classify those totals as
`host_runtime`, preserve fail-closed treatment for background text headers and
outer-session usage, and leave provider token-reduction claims unavailable
until a later Plan supplies a valid paired cohort.

## Origin

The previous auto-advisory Plan deliberately deferred provider telemetry and a
reproducible legacy-auto cohort. The user authorized that continuation and then
selected the minimal telemetry-only option. Repository and host probes found:

- `mise r benchmark-eval` runs `bun scripts/benchmark_eval.ts`, which starts
  `pi --mode json --no-session` and collects scenario Agent results.
- Pi 0.83.0 records provider usage in assistant messages and exposes aggregate
  `SessionStats`, but outer `message_end` usage belongs to the parent benchmark
  orchestration session and cannot be attributed to one scenario.
- `@tintinweb/pi-subagents` 0.14.3 returns foreground `Agent` results with
  structured `details.tokens`, `details.toolUses`, `details.durationMs`,
  `details.status`, and `details.description`.
- The same package returns background `get_subagent_result` metrics only in a
  formatted text header. Current artifacts therefore classify those tokens as
  `child_footer`, which is supplementary and cannot support provider evidence.
- `BenchmarkCollector.consumeAgent` already recognizes numeric or formatted
  `details.tokens` as `host_runtime`; the current benchmark prompt prevents that
  path by requiring background collection.

## Goal

For every benchmark scenario executed by `mise r benchmark-eval`:

- request a foreground `Agent` result in one host-managed Agent batch;
- correlate the scenario through the exact `Benchmark: <scenario-id>`
  description;
- accept token totals only from structured `Agent` result `details.tokens`;
- persist `reported_tokens_source = "host_runtime"` with a positive finite
  integer token total; and
- fail closed when the structured source is absent, malformed, background-only,
  duplicated, or cannot be correlated.

This slice establishes telemetry transport only. It does not establish a
baseline, paired comparability, or lower-token claim.

## Design risk

**Design risk**: Medium

The implementation changes benchmark execution topology and evidence
provenance. Incorrect attribution could turn parent-session usage or
child-controlled text into trusted scenario evidence. The change does not alter
workflow authority, activation policy, State Ledger schema, or provider-claim
acceptance rules.

## Diagram decision

**Diagram decision**: not required

**Diagram reason**: The accepted path is one linear transport boundary:
fixture-declared foreground Agent execution, structured tool result,
scenario correlation, runtime validation, and persisted run evidence. A table
captures the trust distinction without adding diagram maintenance.

## Scope

### In scope

- The benchmark fixture's Agent result transport declaration.
- `benchmarkPrompt` instructions for a foreground, non-background Agent batch.
- Structured `details.tokens` scenario attribution in `BenchmarkCollector`.
- Fail-closed tests for malformed, missing, text-only, and outer-session token
  data.
- A dedicated U5 telemetry artifact namespace used by
  `mise r benchmark-eval`.
- Focused runtime, fixture, task, and artifact contract tests.

### Out of scope

- A legacy-auto, pre-change, baseline-auto, or bounded-auto cohort.
- Ten paired runs, median comparison, or `accepted = true` provider claims.
- Runtime advisory metric acquisition, provider cost estimation, billing data,
  or provider-native output-token ceilings.
- Patching Pi core or `@tintinweb/pi-subagents` in a global installation.
- Treating outer `message_end` usage as scenario usage.
- Promoting `get_subagent_result` text, child prose, or a synthetic harness to
  `host_runtime`.
- Changing Brainstorm/Planner activation, advisory budgets, parent authority,
  QA authority, workflow state, or successor authority.

## Technical Design

### Transport contract

The schema-v2 benchmark fixture declares
`runner.resultTransport = "foreground_agent_details"`. The benchmark prompt
must translate that declaration into all of the following instructions:

- launch every scenario in one Agent tool-call batch;
- use `run_in_background = false` for every Agent call;
- retain the exact description `Benchmark: <scenario-id>`; and
- do not collect scenarios through `get_subagent_result`.

An unknown or unsupported result transport is a configuration error. The
runner must not silently fall back to a text parser.

### Evidence attribution

| Input | Scenario attribution | Provenance | Decision |
| --- | --- | --- | --- |
| Foreground `Agent` tool result with terminal status, exact description, and valid `details.tokens` | Exact scenario ID | Host-owned structured result | `host_runtime` |
| Background `get_subagent_result` header | Agent-ID map or text description | Host-formatted text mixed with child output | Supplementary `child_footer` only |
| Parent `message_end.message.usage` | Parent session only | Host runtime but not scenario-specific | Ignore for scenario metrics |
| Child-authored prose/footer | Untrusted | Child output | Supplementary only |
| Deterministic harness | Synthetic scenario | Harness | `contract_only` only |

`details.tokens` may be a finite number or the host's formatted token string.
The existing `parseReportedTokens` normalization remains authoritative for the
formatted form. Missing, negative, fractional, non-finite, or malformed values
cannot produce complete telemetry evidence.

### Failure and recovery

The collector correlates a foreground result only through its structured
description. A background result, unknown scenario, duplicate scenario, missing
terminal status, or malformed token value leaves the run incomplete. It must
not borrow the outer session total or upgrade the background header.

`mise r benchmark-eval` writes the current telemetry probe to
`benchmark-results/immune-brain-u5-telemetry/latest.json` and appends the same
namespace's history. A successful probe must be fresh and must show
`reported_tokens_source = "host_runtime"` for every scenario. The historical U3
artifact and canonical U4 classification artifact remain unchanged.

Because runtime advisory metrics remain explicitly unavailable, a successful
U5 telemetry probe may still record `evidence_status = "unavailable"`,
`evidence_reason_code = "runtime_advisory_metrics_unavailable"`, and
`metrics_complete = false`. That tuple is expected and must not be rewritten as
a provider reduction claim.

## Compatibility

The schema-v2 run record and `ReportedTokensSource` enum remain unchanged.
Historical schema-v1 and U3/U4 artifacts remain readable and are never
rewritten. Direct callers of `bun scripts/benchmark_eval.ts` retain the existing
CLI arguments; the repository `mise` task selects the U5 namespace explicitly.
Fixtures that do not declare the foreground transport retain their existing
behavior unless they enter the provider-runtime telemetry path.

The implementation depends on a Pi host that returns structured foreground
Agent details. Hosts lacking that capability fail closed as incomplete rather
than falling back to text-derived provider evidence.

## Acceptance Criteria

- A live foreground Agent probe exposes structured `details.tokens` and the
  collector records it as `host_runtime` for the correlated scenario.
- The benchmark prompt requires one foreground Agent batch and forbids
  background collection for the provider telemetry fixture.
- Every scenario in a fresh `mise r benchmark-eval` artifact has terminal
  status, a positive finite integer `reported_tokens`, and
  `reported_tokens_source = "host_runtime"`.
- Missing or malformed structured token details produce incomplete evidence.
- Parent `message_end` usage is never assigned to a child scenario.
- Background `get_subagent_result` text remains `child_footer` and cannot be
  promoted to provider-runtime evidence.
- The U5 artifact remains explicitly unavailable for the separate advisory
  metric gap and contains no accepted provider reduction claim.
- `benchmark-results/immune-brain-u4-provider/latest.json` and
  `benchmark-results/immune-brain-focused/latest.json` remain unchanged.
- Focused tests, generated-doc sync, Plan validation, and `git diff --check`
  pass.

## Deferred Design

- Build a versioned executable legacy-auto or pre-change cohort.
- Collect at least ten unique same-scenario provider-runtime pairs.
- Decide whether rounded host totals need an exact-token transport before a
  reduction claim is accepted.
- Acquire trusted runtime advisory metrics and run the existing quality and
  authority parity gates.
- Produce a provider reduction claim only in a separately planned paired-cohort
  slice.
