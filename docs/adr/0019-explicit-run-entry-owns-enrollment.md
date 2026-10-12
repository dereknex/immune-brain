---
status: accepted
---

# Explicit Run Entry Owns Enrollment

Accepted on 2026-10-11 by the repository owner, for Initiative
`explicit-phase-entry` (#206). It retires the Planner's "execution-bearing
request" route. Enrollment validation, the native dialog and its hash binding
are unchanged.

## Context

The Planner contract let a request that "already includes execution" open the
native Enrollment gate as soon as the candidate validated, and BASELINE said the
task then proceeds "without a second human stop". In recorded Claude Code and Pi
sessions between 2026-10-04 and 2026-10-10 the model read a confirmation of a
design ("confirm", "agreed", "continue") as such a request: it wrote the intent,
opened Enrollment and started implementing, with no `imm-run` entry and in some
sessions no Planner entry either. The one dialog carried two meanings at once,
"this plan is right" and "start implementing now".

## Decision

Planning and implementation are two phases and the literal user launches each.

- `imm-planner` and `imm-brainstorm` stop after candidate validation and
  publication. They never invoke the native Enrollment gate, whether or not the
  request also asks for execution.
- Enrollment is the first step of an explicit `imm-run` entry. With no active
  claim, `imm-run` resolves the validated candidate and invokes the gate once,
  without chat pre-confirmation.
- A confirmation given inside Brainstorm or the Planner is not an `imm-run`
  entry.

Once the user has entered `imm-run`, the single native confirmation still
carries a routine task through enrollment, execution and QA.

## Consequences

- A "plan and execute" request now needs one more user entry. This is the
  intended outcome.
- This ADR changes contract text only. Refusing Enrollment at the Host tool
  boundary when no run entry exists is delivered by the later Slices of the
  same Initiative; until then the rule is an instruction contract.

## Rejected

- Keep Enrollment in the Planner and force a stop after it: leaves an active
  task with no runner, and the plan approval and the start of implementation
  stay one act.
