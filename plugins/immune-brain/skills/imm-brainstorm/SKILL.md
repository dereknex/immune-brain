---
name: imm-brainstorm
description: Use to frame and clarify an ambiguous problem and its open questions before planning; framing only, no implementation or plan writing.
---

# Immune-Brain: Brainstorm

Load [`../../dist/imm-brainstorm.md`](../../dist/imm-brainstorm.md), then frame the
task before planning. Do not edit project files. Return goal, constraints,
unknowns, readiness, and Next Action.

## Default exhaustive decision tree

Exhaustive clarification is the default protocol, not a separate mode. Resolve
repository facts through read-only investigation, then exhaust every real
product-framing decision that can change Result, Scope, behavior, Verification,
or risk treatment. At every round, classify each newly surfaced uncertainty as
either a repository fact or a user-owned decision. Resolve repository facts
with bounded read-only evidence; place only decisions that can change Result,
Scope, behavior, Verification, or risk treatment on the user frontier. Scan
goal, beneficiary and scenario, current state, scope, non-goals, behavior
boundaries, constraints, trade-offs, success criteria, and deferred items.

Ask the complete currently unblocked frontier in dependency-aware rounds. Number
each question, include a recommended answer, and accept bulk approval of all
recommendations with explicit exceptions. A zero-question fast path is valid
when the frontier is already empty. Then present a result-only summary for
explicit confirmation and retain final decisions in the `BR-*` manifest rather
than copying the question transcript.

Brainstorm supports `default`, `roundtable`, and `adversarial` modes. The
exhaustive decision tree remains the default clarification protocol in every
mode; `roundtable` and `adversarial` are orthogonal analysis lenses.
Architecture mapping is a bounded, read-only `arch-explorer` role selected
through the internal Loop bridge; it cannot write a Spec, Plan, or workflow
state. Brainstorm ensemble is advisory-only and derives candidates from
`workflow_models.brainstorm_ensemble`; Final Spec and Plan authority stays with `imm-planner`.
Pi's adapter may consume `brainstorm_ensemble` dispatch JSON to prepare
advisory Pi subagent envelopes, but envelope construction is not child execution
and does not transfer framing authority. Pi itself may launch those subagents,
collect completed child outputs, and feed them to
`normalizePiBrainstormAgentResults`; runtime does not call any agent, poll
background work, mutate state, or own final Spec/Plan authority.
Agreement becomes framing evidence, Disagreement becomes decision criteria or
`BR-Q-*`, and strong-model blockers become risks or verification requirements.
