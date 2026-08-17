---
title: Rejected Untrusted Provider Token Attribution
rejected: true
reusability: medium
next_reuse_scenarios:
  - a benchmark proposal allocates one parent-session total across multiple child scenarios
  - a background subagent footer or text header is proposed as authoritative host telemetry
  - a repository-local benchmark change proposes patching Pi core or an installed external package
  - a reviewer must separate supplementary child evidence from scenario-level host provenance
key_files:
  - scripts/benchmark_eval.ts
  - tests/benchmark-eval-runner.test.ts
  - docs/specs/provider-runtime-token-telemetry.spec.md
  - docs/plans/2026-07-30-001-feat-provider-runtime-token-telemetry-plan.md
  - benchmark-results/immune-brain-u5-telemetry/latest.json
---

# Rejected: Untrusted Provider Token Attribution

## Rejected approaches

1. Divide the parent benchmark session's `message_end.message.usage` total across scenarios and label the portions `host_runtime`.
2. Promote background `get_subagent_result` text headers or `child_footer` values to authoritative scenario telemetry.
3. Modify Pi core or the globally installed `@tintinweb/pi-subagents` package to work around a repository-local benchmark contract.

## Rejection reason

These approaches collapse independent authority and provenance boundaries:

- Parent `message_end` usage belongs to the benchmark orchestration session and has no reliable one-to-one scenario attribution. Allocation would manufacture evidence rather than observe it.
- Background result text is supplementary child output, not a structured foreground runtime result. Renaming its header cannot improve its provenance.
- Pi core and the external package are outside the current repository runner boundary. Changing them would expand Scope B, add installation/version coupling, and obscure whether the benchmark contract itself is correct.

The accepted boundary is narrower: use the fixture-declared `foreground_agent_details` transport, exact scenario descriptions, and structured foreground `details.tokens`; otherwise preserve `child_footer`, `unavailable`, or incomplete classifications. This rejects the approaches for the current scenario-level provider-runtime contract, not for every future platform design.

## Evidence

- `docs/specs/provider-runtime-token-telemetry.spec.md` records that parent usage cannot be assigned to an individual scenario and that background formatted headers are supplementary.
- `docs/plans/2026-07-30-001-feat-provider-runtime-token-telemetry-plan.md` explicitly excludes parent-total division, background-header promotion, Pi core changes, external package changes, legacy-auto pairing, and reduction claims.
- `scripts/benchmark_eval.ts` and `tests/benchmark-eval-runner.test.ts` enforce structured foreground provenance, event identity, status/scenario validation, malformed-token rejection, and background/parent-usage isolation.
- `benchmark-results/immune-brain-u5-telemetry/latest.json` proves the repository runner can produce four positive `host_runtime` scenario totals without those rejected changes while keeping advisory evidence unavailable and comparison absent.

### reusability_critique_notes

- **Falsifiability**: The rejection is false if a future supported host API supplies stable per-invocation usage with exact scenario correlation, or if a separately authorized Plan changes the package boundary. Until then, the rejected inputs remain untrusted for this contract.
- **Evidence trail audit**: The host probes, Plan/Spec constraints, negative tests, U5 artifact, independent QA, and exact code review support the rejection. They do not prove that all future Pi versions or provider APIs lack a safe per-invocation path.
- **Architecture entropy resistance**: Keep this as a small standalone rejected decision because it records recurring false-evidence temptations without adding runtime code, a registry, a new schema, or an ADR. It complements the positive contract in `docs/solutions/contracts.md` rather than duplicating it.

---
Captured: 2026-07-30 | Source: Provider Runtime Token Telemetry Plan U1
