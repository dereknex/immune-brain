---
status: accepted
---

# Unattended Review Dispatch Authority

## Context

A child settled by an unattended batch run reaches its Review obligation and
stops there: `runtime/assurance/coordinator.ts` returns `review_ready` with an
`agent_params` payload, and the child is parked as `needs_human` until a
foreground Host turn dispatches a reviewer and submits the verdict. Every other
Assurance step runs to completion inside one Tool execution, so Review is the
single point where a batch run cannot continue on its own.

Two facts constrain the decision. First, the Kernel already requires the reviewer
identity to come from the Host: `runtime/claude/review_host.ts` and the Pi
Review reservation bind a verdict to an observed Host execution event, and
`runtime/assurance/coordinator.ts` rejects a verdict whose identity it cannot
attribute. Second, an extension Tool callback cannot drive the Parent to invoke
another Agent in the same turn, so a runtime that wanted to dispatch a reviewer
would have to own model invocation itself.

## Decision

1. **Review stays a foreground obligation of the literal user's Host session.**
   The Kernel reserves the Review, returns `agent_params`, and the Parent
   dispatches the reviewer in a later foreground turn; `submit_review` consumes
   the verdict against the frozen snapshot. A batch run parks the child as
   `needs_human` at that point with the reason and the reserved `agent_params`,
   and continues only after a foreground verdict.
2. **The runtime never dispatches a reviewer and never synthesizes a receipt for
   one.** Reviewer identity remains a Host-attested fact — the property
   `runtime/assurance/coordinator.ts` and the Review reservation exist to
   protect — so a batch pause at Review is the designed cost of that
   independence rather than a gap to be closed.

## Rejected Alternatives

- **Runtime-invoked reviewer.** Calling a model with the bundled review prompt
  from the runtime, and submitting the verdict in the same process that produced
  the work, would leave the Kernel unable to distinguish a Host-attested
  reviewer from a self-review.
- **Out-of-process reviewer service.** A separate process owning reviewer
  invocation and returning a signed verdict introduces a second authority path
  the Kernel cannot verify from Host events, and would need its own identity,
  transport, and failure contract.
- Making the runtime dispatch reviewers to remove the `needs_human` park: that
  would trade an auditable independence boundary for unattended throughput.
- Letting the runtime synthesize a reviewer receipt for a review it performed
  itself, in any form.

## Consequences

- A batch run remains non-autonomous across Review: it parks the child with the
  reason and the reserved `agent_params`, and continues only after a foreground
  verdict.
- Any future change here must preserve the property that `submit_review`
  attributes the verdict to an observed Host execution.
