# Spec: Host-Default Subagent Execution Configuration

**Task ID**: `2026-08-26-001-host-default-subagent-execution-config`
**Owner**: user
**Status**: Candidate
**Design risk**: High
**Design risk rationale**: The change narrows which native `Agent` arguments are part of Kernel Review receipt identity. It crosses the Pi host boundary and Review authority state machine, while leaving TaskIntent, verdict, and Kernel mutation semantics unchanged.

**Diagram decision**: required
**Diagram reason**: A sequence view distinguishes Host-resolved execution configuration from the reserved fields that bind one foreground Review receipt.

## Summary

Immune-Brain defines Subagent Role contracts, evidence, authority, tool policy,
and output shape. The external Pi Host owns model, provider, and thinking
configuration. Ordinary internal Role dispatch already follows this boundary.
Kernel authority Review must stop emitting or matching `model` and `thinking`
as reserved authority fields while retaining foreground execution, isolation,
bounded turns, immutable prompt identity, and native receipt correlation.

## Origin

Confirmed Brainstorm decisions:

- `BR-DEC-001`: Advisory Subagents use Host-default execution configuration.
- `BR-DEC-002`: Immune-Brain owns only the Subagent Role contract.
- `BR-DEC-003`: Kernel authority Review retains attestation-required reservation, foreground, receipt-matching, and turn-budget constraints.
- `BR-OUT-001`: Immune-Brain does not implement model tiers, provider mapping, cost routing, or provider fallback.

## Research

- `plugins/immune-brain/runtime/role_prompt_bridge.ts` and `runtime/loop_contract.ts` already define ordinary internal Roles without model, provider, or thinking policy.
- `plugins/immune-brain/.pi-extension/pi-canary-native-review.ts` currently emits empty `model` and `thinking` values and compares them as exact receipt identity fields.
- `plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts` owns reservation lifecycle, workload-derived `max_turns`, tool-call correlation, terminal event ordering, snapshot revalidation, and Review settlement.
- `plugins/immune-brain/.pi-extension/imm-canary-work.ts` forwards Pi `tool_call`, `tool_result`, and `tool_execution_end` events into that owner.
- `docs/reference/subagent-dispatch-protocol.md` already says model selection is Host-native, but its exact-parameter wording does not distinguish Host-owned fields from reserved authority fields.
- ADR 0003 keeps Subagent Roles behind the Parent/Loop bridge. The rejected shared-registry Learning rules out adding a generic model or provider dispatcher without multi-host evidence.

## Technical Design

### Ownership boundary

Immune-Brain owns and reserves these Kernel Review arguments:

- `subagent_type`, reserved `description`, immutable `prompt`;
- `inherit_context: false`;
- resource and filesystem isolation;
- `run_in_background: false`;
- workload-derived `max_turns`;
- empty `resume` and `schedule`, which prohibit continuation or deferred execution.

Pi owns `model`, provider resolution, and `thinking`. `reservedAgentParams` omits
`model` and `thinking`; no Immune-Brain input may override them. Receipt matching
normalizes away only the optional Host-reported `model` and `thinking` keys,
then requires the exact reserved field set and values. Unknown extra keys still
fail closed. This is a fixed two-field boundary, not a generic configuration
allowlist or extension point.

### Review sequence

```mermaid
sequenceDiagram
    participant K as Kernel Assurance
    participant P as Parent
    participant H as Pi Host
    participant R as Review Role

    K-->>P: review_ready + reserved authority params
    P->>H: Agent(reserved params; Host resolves model/provider/thinking)
    H->>K: tool_call(call_id, effective args)
    K->>K: Ignore model/thinking; match all reserved fields
    H->>R: Run one foreground isolated Review
    H->>K: tool_result + tool_execution_end
    K->>K: Correlate call_id, receipt order, snapshot, and verdict
    K->>K: Apply Review authority or fail closed
```

### Compatibility and migration

No persisted schema or TaskRecord migration is required. Review reservations
are session-local. Existing ordinary Role envelopes remain unchanged. Existing
Hosts that omit `model`/`thinking`, serialize them as empty strings, or report
Host-selected values all match the same reservation; changes to any reserved
authority field continue to fail.

No compatibility layer is introduced. A future Host that adds another
execution-config argument remains rejected until a separate, evidence-backed
contract change names it explicitly.

## Settlement-Design Contract

### Trigger sources

- `advance_assurance` creates one Review reservation after deterministic QA.
- Matching `Agent` `tool_call` binds one native tool-call ID.
- Matching `tool_result` supplies inert Review output.
- Matching `tool_execution_end` proves terminal event ordering.
- Host cancellation, provider failure, session shutdown, duplicate events,
  malformed output, snapshot drift, and stale or unmatched calls interrupt or
  reject settlement.

### State inventory

The existing state machine remains: no reservation -> reserved -> tool call
observed -> result observed -> terminal event observed -> settling -> completed,
rework, awaiting user, blocked, or settlement unknown. Cancellation or shutdown
before authority settlement releases session-local reservation evidence. No new
state or persisted field is added.

### Terminal ownership

- Pi host events prove the one foreground invocation and terminal ordering.
- `AssuranceProgression` owns reservation correlation and snapshot revalidation.
- Kernel capability application owns Review verdict mutation and completion.
- Literal-user confirmation remains the owner only for the existing critical-risk final authorization.

Resolved model identity, provider identity, thinking level, local Promise
resolution, elapsed time, child prose, and unmatched events are
non-authoritative. They cannot mint or settle Review authority.

### Same-state-machine coverage

Review must inspect `imm-canary-work.ts`, `pi-canary-assurance-progression.ts`,
and `pi-canary-native-review.ts` together. Scope also includes the focused
continuation, dispatch resilience, native matcher, and packaged protocol tests.

## Failure Behavior

| Event | Result |
| --- | --- |
| Host omits or supplies `model`/`thinking` | Match using reserved authority fields only |
| Host changes prompt, role, isolation, foreground mode, turn budget, resume, or schedule | Reject; zero Review authority writes |
| Host supplies an unknown extra Agent argument | Reject; zero Review authority writes |
| Duplicate or stale tool call/result/end | Existing reservation guards reject or ignore it |
| Provider failure or malformed Review output | Existing fail-closed Review settlement remains authoritative |
| Snapshot drift before submission | Release reservation and reject the verdict |
| Session shutdown | Release session-local reservations and immutable evidence |

## Verification

1. `bun test tests/pi-canary-native-review.test.ts` proves generated reservation parameters omit `model`/`thinking`, Host-reported values are non-authoritative, and protected or unknown fields still fail.
2. `bun test tests/pi-canary-assurance-continuation.test.ts tests/pi-canary-review-dispatch-resilience.test.ts` proves foreground, isolation, turn budget, tool receipt, and terminal result constraints remain intact.
3. `bun test tests/pi-subagent-dispatch-observability-contract.test.ts` proves source and packaged protocols stay synchronized and describe Role-only configuration ownership plus exact reserved authority matching.

## Rollback and interruption recovery

The implementation is one coherent source, test, and synchronized-doc change.
If interrupted before completion, no persisted runtime state changes; revert the
task-owned files together. If loaded code fails focused verification, do not
advance Assurance. Existing active sessions keep their loaded extension bytes
until normal reload or restart and retain their existing session-local
reservations.

## Devil's Advocate Audit

- **Rollback resilience**: No migration or durable state write exists; the matcher, tests, and synchronized protocol can be reverted as one unit.
- **Verification vanity**: The matcher test exercises both accepted Host-owned deltas and rejected protected/unknown deltas, so text-only documentation cannot pass it.
- **Spec dilution detection**: Host ownership applies only to model/provider/thinking. Foreground, isolation, bounded turns, one-call correlation, terminal ordering, snapshot freshness, and Kernel settlement remain explicit acceptance conditions.

## Brainstorm Trace

| ID | Status | Coverage |
| --- | --- | --- |
| `BR-DEC-001` | `covered_by_step` | Host supplies model/provider/thinking defaults |
| `BR-DEC-002` | `captured_as_decision` | Existing Role contracts remain the Immune-Brain-owned boundary |
| `BR-DEC-003` | `covered_by_step` | Reserved foreground, receipt, isolation, and turn-budget fields remain exact |
| `BR-OUT-001` | `out_of_scope` | No model tier, provider map, cost router, or fallback is introduced |
