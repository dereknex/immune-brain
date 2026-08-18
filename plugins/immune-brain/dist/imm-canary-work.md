---
name: imm-canary-work
description: Use when the runtime projection reports an active Kernel backend claim for the current task; routes Kernel-owned canary work to the Pi lifecycle extension instead of v3 imm-work.
---

# Immune-Brain: Canary Work (Pi-only Kernel routing)

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Routing Contract

Route exactly one enrolled Kernel task through the `imm_kernel_canary` Tool. It
records ordinary executor facts, runs deterministic QA in the foreground, and
returns a direct structured result to the Parent turn. The Tool surface contains
`status`, `record_evidence`, `record_finding`, `resolve_finding`,
`advance_assurance`, `submit_review`, compatible `revise_intent`,
`request_authorization`, and `complete`.

After fresh acceptance evidence, call `advance_assurance`. The Tool emits
bounded native progress updates and awaits QA. A successful result is
`review_ready` and contains immutable snapshot metadata plus exact foreground
`Agent` parameters. Invoke that Agent once with `run_in_background: false`, then
call `submit_review`. The bridge accepts only the matching `tool_call`,
`tool_result`, and `tool_execution_end` events and returns `awaiting_user` only
after a valid receipt. Call `request_authorization` for literal-user
confirmation through `/imm-canary-authorize`; never ask the user to type an
authorization command.

The Tool accepts `status`, `record_evidence`, `record_finding`,
`resolve_finding`, `advance_assurance`, `submit_review`, compatible
`revise_intent`, `request_authorization`, and `complete`. Pre-commit
cancellation is handled by the host signal; no command-owned assurance
coordinator exists. Host `AbortSignal` cancellation is honored through
pre-commit QA and Review preparation; the authority commit boundary is
non-cancellable and retains the existing Kernel snapshot/CAS guards.
Confirmation rejection, cancellation, malformed receipts, provider failure,
and snapshot drift fail closed with zero authority writes. Native Agent output is advisory until literal-user
authorization is applied. User approval remains TUI-only through
`/imm-canary-authorize` and `record-user-approval`.

The extension does not create detached jobs, progress Widgets, Footer status,
transcript follow-ups, result polling, or a second authority store. Lifecycle
state remains in the Kernel projection and current foreground Tool call. Review
receipts bind the task, Intent, diff, record revision, bundle digest, agent
identity, and strict verdict; stale or out-of-order events are rejected.

## Activation Gate

- No active Kernel claim: preserve the existing BASELINE/v3 route unchanged.
- One valid active/draining claim: route only the matching task to this Tool.
- Malformed or contradictory claim, TaskRecord, workspace, or tombstone: fail
  closed and report recovery evidence.
- Terminal tombstone only: never reactivate the historical task.

Never mutate or mirror a Kernel-owned task through v3 `imm-work`/`imm-loop`,
never enroll a task, and never activate a Plan. `/imm-canary-new` and
`/imm-canary-enroll` are the explicit Enrollment launchers; they do not perform
assurance work. Before claiming scope drift, a Breaking Revision, or out-of-scope work, inspect the authoritative TaskIntent, the current Kernel projection, the staged task snapshot, and the scoped Git diff. Do not infer authority drift from prose, stale Specs, conversation memory, file count, or unrelated dirty paths.
