---
name: imm-brainstorm
description: Use to frame and clarify an ambiguous problem and its open questions before planning; framing only, no implementation or plan writing.
---

# Immune-Brain: Brainstorm

Load [`../../dist/imm-brainstorm.md`](../../dist/imm-brainstorm.md), then frame the
task before planning. Do not edit project files. Return goal, constraints,
unknowns, readiness, and Next Action.

## Default exhaustive decision tree

Exhaustive clarification traverses every current-goal branch grounded in the
user request, repository evidence, or a settled parent decision. Do not use a
materiality or task-type judgment to decide whether a sourced user decision is
worth asking. Seed the fixed framing roots: goal, beneficiary and scenario,
current state, desired behavior, scope and non-goals, constraints, failure and
edge behavior, compatibility and migration, success and Verification, and
deferred items; then expand branches from each answer.

Classify each unresolved node only as a repository fact or a user-owned decision.
Resolve repository facts with bounded, on-demand read-only evidence. A blocked
fact blocks only its dependent subtree and remains explicit; never convert it
into a user preference. Place every sourced user decision on the complete
currently unblocked frontier. Hold dependent questions until their parents are
settled, but ask all independent questions together. Number each question,
include grounded options and a recommended answer with a short reason, and
accept bulk approval of all recommendations with explicit exceptions.

Direct requirements and adopted recommendations settle only the current nodes;
they never complete the Brainstorm session by themselves. Recompute the tree
after every response and continue through newly unlocked downstream branches.
Minimally clarify an ambiguous answer. If later evidence invalidates a settled
choice, reopen only that decision delta. An explicit defer stops its subtree and
becomes `BR-DEFER-*`, unless it still changes the current Result, interface, or
compatibility and therefore cannot be deferred.

Brainstorm is complete only when the frontier is empty and no blocked fact
prevents traversal. A zero-question fast path is valid only when the complete
seeded and dynamically expanded tree contains no unresolved user decision. If
the user stops early, emit every open node as `BR-Q-*` and do not mark the frame
planning-ready. Otherwise present a result-only summary as a non-blocking
correction window and retain final decisions in the `BR-*` manifest rather than
copying the question transcript. Do not ask the user to reconfirm decisions
reflected without change. If the summary introduces or changes a decision, ask
for explicit confirmation of only that decision delta and block Planner handoff
until it is answered. Agent judgment alone never confirms a proposed direction
or scope.

Brainstorm supports `default`, `roundtable`, and `adversarial` modes. All use the
same exhaustive frontier protocol; `roundtable` and `adversarial` add analysis
lenses only when explicitly selected by the user. Required failure, rollback,
compatibility, migration, and risk branches remain part of default traversal.
Consult ADRs and on-demand rejected-decision evidence only when a live branch
reaches that topic.
Architecture mapping is a bounded, read-only `arch-explorer` role selected
through the internal Loop bridge; it cannot write a Spec, Plan, or workflow
state. Pi's adapter may consume `brainstorm_ensemble` dispatch JSON to prepare
advisory Pi subagent envelopes, but envelope construction is not child execution
and does not transfer framing authority. Pi itself may launch those subagents,
collect completed child outputs, and feed them to
`normalizePiBrainstormAgentResults`; runtime does not call any agent, poll
background work, mutate state, or own final Spec/Plan authority.
Agreement becomes framing evidence, Disagreement becomes decision criteria or
`BR-Q-*`, and strong-model blockers become risks or verification requirements.

When framing discusses later execution, describe Enrollment only as the current
Host's native gate. Never recommend another Host, worktree, or unmanaged
implementation as a fallback for a failed Managed authority interaction.
