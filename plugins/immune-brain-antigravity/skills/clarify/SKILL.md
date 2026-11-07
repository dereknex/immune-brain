---
name: clarify
description: Use when the user asks to clarify or explore requirements before Immune-Brain planning.
---

# Immune-Brain: Clarify

Use [`../../dist/clarify.md`](../../dist/clarify.md) as the
canonical contract index, not a whole-document read. Starts on the user's request
to clarify or explore requirements, by slash command or in natural language;
ordinary host questions do not start this workflow.

Mandatory constraints before any action: Brainstorm is read-only — no code,
test, or runtime edits; no Spec, Plan, or workflow-state writes. All modes
produce a `brainstorm_framing` result with goal, constraints, unknowns,
readiness, and Next Action.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: all modes read [Shared Guards](../../dist/BASELINE.md#shared-guards), [Workflow Activation](../../dist/BASELINE.md#workflow-activation), [Host Confirmation Boundary](../../dist/BASELINE.md#host-confirmation-boundary), [Boundary](../../dist/clarify.md#boundary), [Invocation modes](../../dist/clarify.md#invocation-modes), [Default clarification](../../dist/clarify.md#default-clarification), [Workflow Rules](../../dist/clarify.md#workflow-rules), [Output artifact](../../dist/clarify.md#output-artifact), [Output style](../../dist/clarify.md#output-style), [Next Action](../../dist/clarify.md#next-action)
- explicit thorough interrogation: [Explicit exhaustive interrogation](../../dist/clarify.md#explicit-exhaustive-interrogation)
- optional research, including explicitly selected `roundtable` or `adversarial` advisory: [Research Dispatch](../../dist/clarify.md#research-dispatch), [Brainstorm Ensemble Advisory](../../dist/clarify.md#brainstorm-ensemble-advisory)
- requested framing document: [Output Language Policy](../../dist/BASELINE.md#output-language-policy)

When framing discusses later execution, describe Enrollment only as the
current Host's native gate, opened as the first step of a user-launched
`drive`. Brainstorm stops after framing; the user launches `draw-up`. A failed Managed authority interaction stays
fail-closed: report one same-Host recovery action, never another Host,
worktree, or unmanaged implementation.

Every sourced branch closes as resolved, explicitly excluded, explicitly
deferred, or dependent-blocked with its blocking node named, including for a
clear zero-question request; a confirmed outcome is never conserved as a
smaller deliverable, and a confirmed user scenario is a `BR-SCN-*` item with Actor, Given, When, Then, written in English, whose Then is a result the actor observes directly; framing without a user-observable change gets no invented scenario.
