# Spec: subagent host maturity roadmap

**Task ID**: IMM-SUBAGENT-HOST-MATURITY-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Raise the immature subagent-capable hosts from prose-level guidance to
result-oriented, verifiable host paths without introducing a shared registry,
generic dispatcher, background scheduler, or broader authority for child
subagents.

The mature baseline is the current `imm-code-review` and `imm-ui-review`
pattern: deterministic eligibility, bounded delegation packets, provider-facing
envelopes where applicable, normalized child outcomes, parent synthesis,
fallback reasons, telemetry, and contract tests.

## 2. Scope

In scope:

- `imm-party` advisory roundtable maturity.
- `imm-arch-explorer` Domain Mapper result evidence maturity.
- `imm-brainstorm` optional research probe maturity.
- `imm-work` bounded probe / child_evidence feedback maturity.
- `imm-planner` research-consumer boundary maturity.
- A result scorecard that records whether subagent output was adopted,
  rejected, deferred, duplicated, degraded, or routed to replan.

Out of scope:

- Shared subagent registry or generic dispatcher.
- Cross-session queues, webhooks, or background scheduling.
- Agent-to-agent communication.
- Long-term subagent memory outside existing State Ledger and solution
  learning surfaces.
- Child subagents gaining scope, plan, execution, or QA authority.
- Reviewer subagents generating rigid patches instead of verification criteria
  or bounded evidence.

## 3. Requirements

### R1. `imm-party` advisory roundtable host

`imm-party` must gain a deterministic role-selection contract for bounded
advisory rounds. The selected roles must produce normalized output with:

- position
- risk
- disagreement
- recommendation
- confidence
- verification or decision criteria

The parent `imm-party` host must synthesize the round into one advisory handoff
that can feed `imm-brainstorm` or `imm-planner`. It must not write plans, edit
code, or decide final scope posture.

### R2. `imm-arch-explorer` Domain Mapper host

`imm-arch-explorer` must make Domain Mapper output result-oriented. Each mapper
shard must report:

- domain map
- key files
- constraints
- risks
- unknowns
- planner impact

The parent host must synthesize mapper output into an Architecture Map-style
artifact and record which findings changed or supported downstream planning.

### R3. `imm-brainstorm` optional research probes

`imm-brainstorm` may dispatch readonly research probes only when the task spans
multiple domains or the user explicitly asks for parallel research. Probe output
must map into Brainstorm manifest items:

- `BR-REQ-*`
- `BR-DEC-*`
- `BR-OUT-*`
- `BR-DEFER-*`
- `BR-Q-*`

Open `BR-Q-*` items still block planner handoff. Research probes must not
replace the parent host's framing judgment.

### R4. `imm-work` bounded probes and child evidence

`imm-work` must remain the current-Step driver. Any child probe or worker path
must require an active Step and must persist advisory output under
`child_evidence`. Child output can inform execution and QA, but cannot close a
Step or bypass `imm-qa`.

### R5. `imm-planner` research-consumer boundary

`imm-planner` must primarily consume structured evidence from brainstorm,
architecture exploration, and review hosts. If planner research dispatch is
used, child output may only supply candidate constraints, risks, or unknowns.
The parent planner owns final Spec and Plan writing.

### R6. Result scorecard

Every matured host path must be able to feed a local result scorecard with:

- host
- child or lens
- triggered reason
- outcome status
- adopted findings
- rejected findings
- deferred findings
- duplicate findings
- degraded dispatch reason
- downstream routing effect

This scorecard is local evidence for future decisions about trigger tuning,
schema tightening, or shared infrastructure readiness.

## 4. Acceptance Criteria

- `imm-party` has deterministic advisory role selection and parent synthesis
  coverage.
- `imm-arch-explorer` Domain Mapper output records planner impact.
- `imm-brainstorm` research probe output maps into Brainstorm manifest IDs.
- `imm-work` preserves active-Step authority and persists child evidence.
- `imm-planner` documents and tests research-consumer boundaries.
- Scorecard telemetry can prove whether subagent output improved downstream
  results.
- Existing rejected decisions remain honored:
  `rejected-shared-registry-generic-dispatcher` and
  `rejected-rigid-patch-generation-in-reviewer-subagents`.

## 5. Verification

The implementation must include focused unit and contract tests for each host
path plus `imm-plan <plan> --json` validation. Full regression should include
activation, delegation packet, host synthesis, State Ledger, telemetry, and
skill contract tests affected by the changed hosts.
