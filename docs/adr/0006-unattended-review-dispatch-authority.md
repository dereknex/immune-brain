---
status: proposed
---

# Unattended Review Dispatch Authority

## Context

A child settled by an unattended batch run reaches its Review obligation and
stops there: `runtime/assurance/coordinator.ts` returns `review_ready` with an
`agent_params` payload, and the child is parked as `needs_human` until a
foreground Host turn dispatches a reviewer and submits the verdict. Every other
Assurance step runs to completion inside one Tool execution, so Review is the
single point where a batch run cannot continue on its own.

Two facts constrain the options. First, the Kernel already requires the reviewer
identity to come from the Host: `runtime/claude/review_host.ts` and the Pi
Review reservation bind a verdict to an observed Host execution event, and
`runtime/assurance/coordinator.ts` rejects a verdict whose identity it cannot
attribute. Second, an extension Tool callback cannot drive the Parent to invoke
another Agent in the same turn, so a runtime that wanted to dispatch a reviewer
would have to own model invocation itself.

## Decision

Not settled. The options are:

1. **Keep the foreground handoff (shipped).** The Kernel reserves the Review,
   returns `agent_params`, and the Parent dispatches the reviewer in a later
   foreground turn; `submit_review` consumes the verdict against the frozen
   snapshot. Review remains a foreground obligation of the literal user's Host
   session.
2. **Runtime-invoked reviewer.** The runtime would call a model with the bundled
   review prompt and submit the verdict itself. This moves review independence
   inside the same process that produced the work: the Kernel could no longer
   distinguish a Host-attested reviewer from a self-review, which is the
   property `runtime/assurance/coordinator.ts` and the Review reservation exist
   to protect.
3. **Out-of-process reviewer service.** A separate process would own reviewer
   invocation and return a signed verdict. It introduces a second authority path
   the Kernel cannot verify from Host events, and would need its own identity,
   transport, and failure contract.

Recommendation: keep option 1, and treat a batch pause at Review as the designed
cost of keeping review independence a Host fact rather than a runtime claim.
Options 2 and 3 would each have to answer how reviewer independence stays
auditable before they can be reconsidered.

## Rejected Alternatives

- Treating the existing `needs_human` park as a temporary gap to be closed by
  making the runtime dispatch reviewers: that would trade an auditable
  independence boundary for unattended throughput.
- Letting the runtime synthesize a reviewer receipt for a review it performed
  itself, in any form.

## Consequences

- A batch run remains non-autonomous across Review: it parks the child with the
  reason and the reserved `agent_params`, and continues only after a foreground
  verdict.
- Any future change here must preserve the property that `submit_review`
  attributes the verdict to an observed Host execution.
