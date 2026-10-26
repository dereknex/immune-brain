---
status: accepted
---

# Marker-Keyed Review Dispatch

## Context

A reserved prompt dispatched under the wrong reviewer type could run without
binding a reviewer. Submission then retained the reservation indefinitely. Pi
also used `description` as identity, although the operation already has an id.

## Decision

The prompt begins with `<!-- immune-brain:operation_id=<op> task_id=<task> -->`.
The marker identifies the targeted reservation, not permission to accept a changed
prompt. Both Hosts still require the exact reserved prompt for binding.

- Pi checks marker-bearing `Agent` dispatches before binding: `subagent_type`
  must be `Review`, `prompt` must be exact, `run_in_background` must be explicitly
  `false`, `isolated` explicitly `true`, and `max_turns` the reserved value.
  `inherit_context` may be absent or `false`. A refusal names every differing
  field. `description` is presentation only. Unknown or released operation ids
  require `advance_assurance`. Marker-less `Review` calls are blocked while a
  reservation is pending; unrelated marker-less agents remain unaffected.
- A second Pi dispatch is blocked without changing the first binding or receipt.
- Claude's `PreToolUse` hook denies a marker-bearing `Agent` dispatch unless
  `subagent_type` is `immune-brain:immune-brain-reviewer` or
  `immune-brain-reviewer`. This stateless hook is fail-fast, not authority:
  exact-prompt binding remains in the MCP observer's `PostToolUse` and
  reviewer `SubagentStart` correlation. Claude has no Pi parameter checks.
- On submission, no bound reviewer means release: Pi has no tool call id;
  Claude has no reservation state, no bound reviewer start, or no task
  reservation. The coordinator remains the single release owner and returns
  `RELEASED_REVIEW_RECOVERY`, requesting `advance_assurance` for a fresh Review.
  Release records no incomplete round and leaves the turn budget unchanged.
- A bound reviewer awaiting its result keeps `RETAINED_REVIEW_RECOVERY`.
  Conflicting Pi result bytes release the unusable receipt rather than wait.

This supersedes [ADR 0017](0017-receipt-bound-review-verdict-submission.md)'s
reserved-prompt observation/recovery rule and
[Spec branch-boundary-r2-followups](../specs/branch-boundary-r2-followups.spec.md)
D2/T2 description binding. ADR 0017 is partially superseded; its receipt-bound
verdict source and settlement authority are unchanged. Dispatch still uses the
returned envelope verbatim; a blocked attempt binds nothing and can be corrected.

## Consequences

No persisted authority shape changes. Both Hosts change together and retain the
existing mediation and coordinator release path. Tests cover wrong types and Pi
parameters, stale operations, duplicate dispatch, and release versus bound-wait
recovery. Packet handles and packet integrity belong to later TaskIntents; this
Slice does not introduce either or a fallback channel.
