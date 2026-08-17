---
title: "Gated Handoff Discipline"
status: draft
date: 2026-05-11
origin: brainstorm — user principle that Next Action prompts should only appear when all gate conditions are met
---

# Spec: Gated Handoff Discipline

## Problem

Each workflow skill (`imm-brainstorm`, `imm-planner`, `imm-work`, `imm-executor`, `imm-qa`) currently ends with a generic `Next Action: specify next skill, reason, and user confirmation needs.` instruction. This tells the agent to produce a next-step recommendation but does not gate it on readiness. The result: agents sometimes suggest "proceed to imm-planner" before open questions are answered, or "proceed to imm-work" before the plan is validated.

## Desired Behavior

Each skill's **Next Action** section must encode explicit readiness gates:

1. **Gate conditions** — what must be true before suggesting the next skill.
2. **If gates pass** — name the next skill and the evidence that unlocked it.
3. **If gates fail** — name what is missing or which boundary the conversation is at; do NOT name a next skill.

## Skill-Specific Gates

| Skill | Gate conditions (all must hold) | Handoff target |
|-------|-------------------------------|----------------|
| `imm-brainstorm` | Framing is stable; no open narrowing questions remain unanswered | `imm-planner` |
| `imm-planner` | Plan passes `imm-plan.py --json`; no hypothetical-only verification paths remain | `imm-work` |
| `imm-work` | Validated plan exists AND next step is identified/activated | `imm-executor` (or `imm-qa` if evidence exists) |
| `imm-executor` | Execution evidence is recorded via `imm-work record-execution`; step verification passes | `imm-qa` |
| `imm-qa` | Decision is recorded (`pass`/`rework`/`replan`); evidence justifies the decision | `imm-work` (pass), `imm-executor` (rework), `imm-planner` (replan) |

## Non-Goals

- No tooling changes to `imm-plan.py` or `imm-work.py`.
- No new runtime JSON fields.
- Does not change what each skill is allowed to do (boundaries unchanged).

## Acceptance Criteria

- Each of the 5 workflow skills contains a `Next Action` section with explicit `Gate` conditions and a fail-path instruction.
- Contract test confirms the pattern exists.
- Existing tests still pass (`python3 -m unittest tests.test_skill_contracts`).
