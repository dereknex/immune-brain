# Spec: Host-Native Assurance UX Completion

**Task ID**: `2026-08-17-001-host-native-assurance-ux`
**Owner**: user
**Status**: Proposed; presentation portions partially superseded by
`unified-immune-brain-interaction-ui.spec.md`
**Design risk**: Medium

**Successor note (2026-08-21)**: The successor replaces the absolute no-Widget
presentation rule with one bounded task-level Rail and replaces duplicate
success/cancel/stage notifications with the shared `State / Result / Next`
hierarchy. This Spec's native Review, authoritative scope evidence,
non-persistence, no-Footer, and no timer/polling requirements remain active.

This change completes the user-facing Assurance path after the Host-native UI
cutover. It adds no Kernel authority, persistence, or freshness semantics. It
does change the Pi adapter's presentation contract, the background QA
observability policy, and the shared routing instructions that decide when an
Agent may claim a scope or breaking-intent boundary.

**Diagram decision**: required
**Diagram reason**: The difference between non-authoritative progress,
terminal Agent continuation, and literal-user authority is a sequence boundary
that must remain explicit.

## Problem

The current implementation has the correct authority primitives but leaves four
experience gaps:

1. `request_authorization` exists, yet the normal-path contract is not tested
   end to end against regressions that tell the user to type a slash command or
   reply that confirmation completed.
2. `imm_kernel_canary` returns structured state only for assurance-control
   operations. Status and ordinary executor mutations fall back to rendering
   raw JSON containing revisions and hashes.
3. Deterministic QA publishes detailed `current`/`total`/`stage` facts into a
   presenter whose `publish` method intentionally does nothing. The completed
   Host-native UI spec assumed QA would finish in a few seconds; recent session
   evidence disproves that assumption.
4. Shared routing guidance says scope changes return to planning but does not
   require an authoritative Intent/snapshot/diff comparison before the Agent
   reports a breaking revision. This permits memory-based false alarms.

## Intended Behavior

```mermaid
sequenceDiagram
    participant A as Parent Agent
    participant P as Pi Assurance Adapter
    participant U as Literal User
    participant K as Assurance Kernel

    A->>P: advance_assurance(task_id)
    P-->>A: started + hard deadline
    loop deterministic acceptance verification
        P-->>U: native notify(current/total, acceptance, phase, elapsed, ceiling)
    end
    P-->>A: one correlated terminal followUp
    A->>P: request_authorization(task_id)
    P->>U: ctx.ui.confirm(host-derived exact operation)
    U-->>P: confirm or reject
    P->>K: existing shared authority path after confirm
    P-->>A: compact structured result; continuation stays in the same turn
```

### Authorization continuation

- A Review-ready follow-up and any `awaiting_user` result instruct the Agent to
  call `request_authorization(task_id)` immediately.
- The normal path never asks the user to type `/imm-canary-authorize`, copy a
  command, report a terminal operation result, or reply "confirmed".
- `/imm-canary-authorize` remains documented only as manual diagnosis and
  recovery.
- Literal-user `ctx.ui.confirm`, host-derived operation selection, snapshot
  revalidation, capability binding, and zero-write cancellation remain
  unchanged.

### Compact information hierarchy

`renderCanaryResult` and the Assurance follow-up renderer present:

1. current state;
2. business-relevant result (phase, pass/block/warning counts, actionable
   failure reason);
3. next action.

Status and ordinary mutation results carry bounded presentation details so the
default renderer does not print raw JSON, revisions, content hashes, CAS
digests, or capabilities. The complete machine-readable payload remains in the
tool result for the Agent. Expanded follow-up rendering may show acceptance IDs
and advisory findings, but never capabilities or unbounded stdout/stderr.

Recovered retries remain hidden. An unresolved failure, blocker, cancellation,
timeout, stale snapshot, or required user decision remains visible and
actionable.

### Deterministic QA visibility

- The background QA job continues returning immediately, keeping user input
  available.
- The adapter emits bounded Host-native `ctx.ui.notify` updates for QA start,
  verifier transitions, first `stalled` transition, and terminal outcome.
- Verifier updates include `current/total`, a bounded acceptance ID, phase,
  elapsed seconds when known, and the deterministic hard ceiling. They do not
  claim an estimated completion time or percentage.
- Repeated one-second heartbeats and identical stage updates are deduplicated.
- Progress is ephemeral session telemetry only. It is not written to the Pi
  session tree, TaskRecord, State Ledger, or any file.
- No progress path uses `setStatus`, `setWidget`, `appendEntry`, `sendMessage`,
  or `triggerTurn`. Review remains visible through the standard Agent surface.

### Evidence before scope decisions

Before reporting that current work exceeds scope or requires a breaking Intent
revision, the Agent must inspect all of:

- the authoritative TaskIntent `scope_hint` and revision;
- the current Kernel projection and enrolled task identity;
- the task-scoped staged snapshot/diff, excluding unrelated out-of-scope dirty
  paths;
- the exact proposed path or verification-descriptor change.

Without concrete mismatch evidence, the Agent continues in the existing
boundary and does not expose a speculative authorization warning. A confirmed
scope expansion or verification-descriptor change still follows the existing
breaking-revision authority path.

## Invariants

1. Native Review output remains advisory until literal-user confirmation.
2. `request_authorization` accepts only `task_id`; the model cannot choose an
   authority operation or supply authority fields.
3. QA progress cannot mutate authority, wake the parent Agent, or survive a
   session restart.
4. Custom Assurance Footer/Widget publication stays deleted.
5. Workflow state is never stored in Pi session entries.
6. Failure and blocking information is compacted, not suppressed.
7. Scope expansion and verification-descriptor changes remain breaking once
   proven from current authoritative inputs.

## Failure Behavior

- UI notification failure is contained and cannot fail or settle QA.
- Malformed renderer details fall back to a bounded actionable message without
  throwing.
- Duplicate progress events are ignored by operation-scoped in-memory keys.
- Session reset clears all progress-deduplication state.
- A stale or missing TaskIntent/projection blocks a scope decision; it never
  becomes evidence for either in-scope continuation or breaking revision.
- Authority cancellation, timeout, race, and snapshot drift keep their existing
  zero-write behavior.

## Compatibility And Rollback

The tool schema, Kernel action vocabulary, TaskIntent/TaskRecord schemas,
follow-up contract version, and persisted bytes remain unchanged. Presentation
details are additive and consumed only by renderers.

Rollback reverts the adapter rendering/progress changes, shared prompt wording,
Skill/Dist wording, tests, and this Spec as one unit. No migration or authority
repair is required. Existing recorded evidence and approvals remain valid.

## Scope

- `docs/specs/host-native-assurance-ui.spec.md`
- `docs/specs/host-native-assurance-ux.spec.md`
- `plugins/immune-brain/.pi-extension/imm-canary-work.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-assurance.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts`
- `plugins/immune-brain/BASELINE.md`
- `plugins/immune-brain/dist/BASELINE.md`
- `plugins/immune-brain/skills/imm-canary-work/SKILL.md`
- `plugins/immune-brain/dist/imm-canary-work.md`
- focused Assurance, routing-contract, and package regression tests

## Acceptance

1. Normal Review continuation opens Host confirmation through
   `request_authorization` without asking the user for a slash command, copied
   output, or a confirmation reply.
2. Default tool/follow-up rendering shows state, key result, and next action
   without raw hashes or JSON; actionable failures remain visible.
3. QA start, acceptance progress, first stall, and terminal state are visible
   through bounded, deduplicated `ctx.ui.notify` messages containing a hard
   ceiling but no ETA or invented percentage.
4. Tests prove no Assurance path publishes Footer/Widget, appends session
   entries, sends progress messages, or wakes an Agent for progress.
5. Shared source and packaged routing guidance requires authoritative
   Intent/projection/task-diff evidence before reporting a scope or breaking
   revision mismatch.
6. Focused tests, source/Dist consistency, `git diff --check`, and the full
   repository suite pass.

## Devil's Advocate Audit

**Rollback resilience**: All changes are presentation and prompt-contract
changes over existing facts. Revert restores the prior UX without rewriting
Kernel state.

**Verification vanity**: Tests must execute renderers and a deterministic QA
progress fixture, inspect exact UI calls, and reject forbidden Host APIs. Text
presence alone cannot close the QA visibility acceptance.

**Spec dilution detection**: This slice does not call a transient start notice
"real-time progress". Acceptance requires per-verifier transitions and stall
visibility. It also does not claim to eliminate literal-user confirmation;
only command copying and the extra acknowledgement turn are removed.

## Non-Goals

- Per-Acceptance freshness hashes or batch evidence mutation.
- Automatic Review authority or removal of literal-user confirmation.
- A custom Footer, Widget, overlay, progress bar, percentage, or predictive ETA.
- Durable QA telemetry, progress replay, or cross-session job recovery.
- Changes to Review Bundle outcomes, semantic neighborhoods, or workload turn
  budgets.
