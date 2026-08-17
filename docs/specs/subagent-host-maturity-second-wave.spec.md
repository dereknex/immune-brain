# Spec: subagent host maturity second wave

**Task ID**: IMM-SUBAGENT-HOST-MATURITY-002
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Close the next highest-value subagent host maturity gaps after the first host
maturity slice. This wave keeps the same host-bound posture and focuses on
planner/preplan result loops plus scorecard consumption. It must not introduce a
shared registry, generic dispatcher, background scheduler, agent-to-agent
communication, or broader child authority.

The target maturity bar remains: deterministic eligibility, bounded
provider-facing envelopes where applicable, normalized child outcomes, visible
fallback reasons, parent-owned synthesis, focused tests, and local scorecard
evidence for downstream decisions.

## 2. Scope

In scope:

- `imm-planner` readonly research helper for evidence-only planning inputs.
- `imm-preplan-review` adversarial voice helper for scope posture evidence.
- `imm-compounder` consumption of local subagent scorecard summaries.
- Explicit deferral records for higher-risk or lower-evidence hosts.

Out of scope:

- Shared subagent registry or generic dispatcher.
- `imm-pr-fix` parallel write-worker dispatch or branch-workspace merging.
- Broad rollout across all thin reviewer hosts in one slice.
- Child subagents writing Specs, Plans, implementation, workflow state, or QA
  closure.
- Cross-session queueing, webhooks, or background scheduling.

## 3. Requirements

### R1. `imm-planner` research helper

`imm-planner` must gain a host-bound helper for optional readonly research
dispatch. The helper must support:

- eligibility based on multi-domain planning or explicit parallel research
- `explicit_required`, `config_disabled`, `unavailable_environment`, and
  `cost_scope_mismatch` fallback reasons
- provider-facing envelopes for Codex and Cursor
- normalized child evidence containing constraints, risks, unknowns, file
  pointers, and verification implications
- parent synthesis that can feed the Plan Research section without writing the
  final Spec or Plan

### R2. `imm-preplan-review` adversarial helper

`imm-preplan-review` must gain a host-bound adversarial helper. The helper must
support:

- deterministic eligibility for major architecture, cross-module, high-risk, or
  explicitly requested challenge scenarios
- advisory-only envelopes with no plan writes, no code edits, no workflow-state
  mutation, and no QA closure
- normalized findings with risk, disputed assumption, verification concern,
  recommendation, confidence, and adopt/defer/dismiss disposition
- parent synthesis into scope posture evidence without making the final scope
  decision automatically

### R3. Scorecard consumption by `imm-compounder`

`imm-compounder` must be able to summarize local subagent scorecard entries
after completed work. The summary must show:

- result value by host
- degraded dispatch reasons
- adopted, rejected, deferred, and duplicate findings
- downstream routing effects
- whether shared infrastructure review is evidence-backed or still premature

The scorecard summary is evidence for future planning only; it must not trigger
automatic shared registry work.

### R4. Deferred host register

The plan must preserve explicit deferrals for hosts that should not be matured in
this wave:

- `imm-pr-fix` parallel worker dispatch is deferred because it requires write
  isolation, branch merge handling, and push safety.
- Thin reviewer hosts (`prompt-contract-reviewer`, `ai-eval-planner`,
  `docs-verifier`, `release-readiness-checker`, `debug-investigator`) are
  deferred for per-host usage-frequency evidence before adding runtime helpers.
- `test-fixer` remains a child worker path until a parent-owned dispatch/result
  loop is needed.

## 4. Acceptance Criteria

- `imm-planner` has focused helper tests proving evidence-only research output.
- `imm-preplan-review` has focused helper tests proving adversarial output stays
  advisory and non-gating.
- `imm-compounder` has contract and helper coverage for scorecard summary
  consumption.
- Deferred hosts are named with concrete reasons so the next planner does not
  expand scope silently.
- Existing rejected decisions remain honored:
  `rejected-shared-registry-generic-dispatcher` and
  `rejected-rigid-patch-generation-in-reviewer-subagents`.

## 5. Verification

The implementation must include focused unit and contract tests for each matured
path plus `imm-plan <plan> --json` validation. Full regression should include
planner research, preplan adversarial synthesis, scorecard summary, telemetry,
State Ledger, and skill contract tests affected by the changed hosts.
