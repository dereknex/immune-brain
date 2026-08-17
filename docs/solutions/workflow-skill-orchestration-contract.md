---
title: Workflow skill orchestration should stay contract-first, split-gated, and subagent-first when bounded
reusability: high
next_reuse_scenarios:
  - adding new workflow-skill trigger templates
  - introducing conditional reviewer roles into the main workflow
  - tightening workflow contracts after review follow-up
---

# Workflow skill orchestration should stay contract-first, split-gated, and subagent-first when bounded

## Reusable premise

When a workflow needs "automatic planning" or "subagent activation", do not start by building a generic dispatcher or runtime classifier. First lock a repo-local orchestration contract that defines:

- when work is allowed to split versus stay solo;
- when clearly decomposable work must default to bounded subagents;
- the default main-flow skill sequence;
- which reviewer roles are advisory-only and trigger-only;
- how retry, fallback, and conflict arbitration work;
- which tests must fail if that contract drifts.

## Preconditions

Use this pattern when all of the following are true:

- the workflow already has named skills or entrypoints;
- the desired behavior is routing and orchestration, not a new execution engine;
- reviewer or subagent participation must stay bounded and non-authoritative;
- the team needs a reusable rule that survives future README and skill-contract edits.

## Pattern

1. Add a split gate before any parallelization.

If the request can be cleanly decomposed into bounded, non-blocking subtasks, default to splitting and activate the smallest useful set of subagents. Fall back to solo only when the work is tightly coupled, the boundaries are unclear, the environment cannot support reliable subagents, or the user explicitly wants solo.

Useful split pressure signals include:

- `multi_domain >= 2`
- `risk_high`
- `verification_needed`
- `artifact_count >= 3`

2. Keep the default workflow sequence fixed.

Use one main path:

`imm-brainstorm -> imm-preplan-review -> imm-planner -> imm-work -> imm-executor/imm-qa -> imm-finish`

3. Keep reviewer participation conditional and advisory-only.

- `imm-code-review` is the broad technical baseline when parallel review is warranted.
- `security-reviewer` and `api-contract-reviewer` remain explicit trigger-only roles.
- Reviewer output supplements planning or execution; it does not replace the main flow.

4. Encode fallback and arbitration up front.

- Retry a failed subtask once.
- If it still fails, return control to the main flow.
- If reviewer opinions conflict, arbitrate with `security > performance > compatibility > readability`.

5. Verify the contract in documentation and tests, then patch drift with a narrow follow-up slice.

The durable rule should live in:

- the orchestration spec;
- the validated plan;
- README trigger guidance, including the top-level direct-trigger summary;
- the relevant skill contracts;
- focused contract tests, including direct assertions on shared spec sources of truth.

If review finds the contract is correct but the documentation or assertions are too weak, fix that with a direct follow-up slice instead of reopening the architecture.

## Evidence basis

This pattern is backed by the completed orchestration and review-follow-up slices:

- `docs/plans/2026-05-09-029-feat-workflow-skill-subagent-orchestration-plan.md`
- `.imm/specs/workflow-skill-subagent-orchestration.spec.md`
- `docs/plans/2026-05-09-030-fix-orchestration-review-followup-plan.md`
- `.imm/specs/workflow-skill-orchestration-review-followup.spec.md`
- `docs/plans/2026-05-10-033-fix-default-subagent-first-activation-plan.md`
- `.imm/specs/default-subagent-first-activation.spec.md`
- `docs/plans/2026-05-10-036-fix-subagent-first-followup-alignment-plan.md`
- `.imm/specs/subagent-first-followup-alignment.spec.md`

The rule was propagated into:

- `README.md`
- `skills/imm-brainstorm/SKILL.md`
- `skills/imm-preplan-review/SKILL.md`
- `skills/imm-planner/SKILL.md`
- `skills/imm-work/SKILL.md`
- `skills/imm-code-review/SKILL.md`
- `skills/security-reviewer/SKILL.md`
- `skills/api-contract-reviewer/SKILL.md`

Focused verification then passed in:

- `tests/test_skill_contracts.py`
- `python3 -m unittest tests.test_skill_contracts` (`44` tests, `OK`)

## What future work should reuse

Reuse this pattern whenever someone asks for:

- automatic workflow skill routing;
- default reviewer activation rules;
- bounded subagent participation inside the Immune-Brain workflow;
- post-review tightening of orchestration truths without expanding scope.

The reusable lesson is simple: make orchestration truth explicit, bounded, subagent-first when clearly decomposable, and directly testable before building anything more dynamic.
