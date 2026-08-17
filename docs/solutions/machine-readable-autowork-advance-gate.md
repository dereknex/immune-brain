---
title: Machine-readable autowork advance gates keep wrappers out of workflow authority
reusability: high
next_reuse_scenarios:
  - refining an opt-in workflow wrapper after the single-step driver already exists
  - adding machine-readable status fields for agent orchestration decisions
  - preventing natural-language status parsing from becoming workflow authority
  - testing stop conditions for rework, replan, completion, and planner handoff states
---

# Pattern: Machine-readable Autowork Advance Gate

## Reusable premise

When an opt-in workflow wrapper needs to advance through several already
validated steps, keep the workflow driver as the only authority and expose a
small machine-readable safety flag for the wrapper to consume.

Do not make the wrapper infer legality from natural-language status text. The
driver should publish whether automatic advancement is currently allowed, and
the wrapper should stop whenever that flag is false.

## Context

Use this pattern when all of the following are true:

- a single-step workflow driver already owns activation, execution, QA, rework,
  replan, and completion routing;
- a separate opt-in wrapper exists to reduce repeated user handoffs across a
  validated plan;
- the wrapper should never bypass evidence, QA, or planner-owned decisions;
- the system already has status output that can be extended without adding a
  second state machine.

## Pattern

1. Add one explicit status field to the driver.

Use a boolean such as `can_auto_advance` that is derived from the same
`next_action` and active-step state the driver already trusts.

2. Keep the positive set narrow.

Treat only ordinary driver-owned progress states as advanceable. In this
iteration, the true states are `activate`, `executor`, and `qa`.

3. Make all boundary states stop the wrapper.

Return false for completion, planner handoff, replan-required states, and
rework states. A wrapper that sees false should report the boundary instead of
trying to reinterpret it.

4. Rewrite the wrapper prompt around the flag.

The wrapper's job is scheduling: call the driver, record a compact
`run_snapshot`, and stop when the driver says it cannot safely continue. The
wrapper should not duplicate state-transition rules from the driver.

5. Test both advance and stop paths.

Positive coverage is not enough. Add a regression where a step is marked for
replan and prove `can_auto_advance` is false, with the driver routing to the
planner state.

6. Keep contract repairs inside the evidence surface.

If full verification exposes stale skill-contract text that blocks the wrapper
change, repair only the tested contract surface. Do not use wrapper work as a
reason to expand review, planner, or QA authority.

## Evidence

- `.imm/specs/autowork-workflow-refinement.spec.md` defines the driver-wrapper
  split, the `can_auto_advance` flag, and the required stop states.
- `.imm/imm-work.py` now includes `can_auto_advance` in the Codex status payload.
- `skills/imm-autowork/SKILL.md` now treats autowork as a light scheduler that
  consumes `can_auto_advance` and emits a `run_snapshot`.
- `tests/test_workflow_loop.py` covers ordinary advance states, completion
  stop, rework stop, and replan-required stop.
- `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`,
  `skills/imm-qa/SKILL.md`, `skills/imm-planner/SKILL.md`, and `README.md`
  were aligned only where full verification exposed blocking contract drift.
- `mise run test` passed after the refinement, with 296 tests passing.

## Constraints

- This pattern does not make autowork a second workflow engine.
- This pattern does not let a wrapper decide whether a plan append, replan, or
  same-boundary follow-up is legal.
- If a future wrapper needs richer stop reasons, add structured driver-owned
  fields rather than teaching the wrapper to parse prose.

## ADR note

No ADR is recommended for this iteration. The reusable decision is important
and test-backed, but it is a narrow workflow contract extension rather than a
hard-to-reverse architectural fork with a surprising trade-off.
