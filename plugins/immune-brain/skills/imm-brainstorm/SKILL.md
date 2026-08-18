---
name: imm-brainstorm
description: Use to frame and clarify an ambiguous problem and its open questions before planning; framing only, no implementation or plan writing.
---

# Immune-Brain: Brainstorm

Load [`../../dist/imm-brainstorm.md`](../../dist/imm-brainstorm.md), then frame the
task before planning. Do not edit project files. Return goal, constraints,
unknowns, readiness, and Next Action.

Brainstorm supports `default`, `roundtable`, and `adversarial` modes.
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
