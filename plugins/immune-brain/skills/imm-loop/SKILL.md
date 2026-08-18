---
name: imm-loop
description: Use to run a validated Plan to completion in the current conversation through checkpoints and isolated QA/review authorities.
---

# Immune-Brain: Loop

Load [`../../dist/imm-loop.md`](../../dist/imm-loop.md), then run the checkpoint loop in the current Pi conversation. Keep active Step implementation in this conversation; use Pi native `Agent` subagents only when the runtime reports `awaiting_qa_decision` or a required review gate. Standard Plan Steps close from passing evidence without per-Step QA; Strict Plan Steps retain isolated QA. Return visible checkpoint progress and a final stop summary.
At runtime role boundaries, build the `buildLoopRoleDispatch` envelope from the
runtime bridge for `qa`, `code-review`, or `ui-review` and pass its foreground
`call` to Agent. Do not discover or load a Pi Skill for those roles. The public
Skills remain available as rollback shims during this additive migration. The
Immune-Brain maintainer removes these public shims in the next minor release
after Issue #9's three-entry public surface contract and the Issue #6/#7 Loop
parity tests pass; until then they are the documented rollback path.

At `terminal_plan_complete`, stop with no next skill, authority, or action. At `awaiting_user_successor_decision`, stop with `recommended_authority: user`. This boundary follows the explicit Compounder handoff and `imm-finish`; it must not dispatch Planner, Compounder, transition, or a new Pi session/subagent. Only a literal user may invoke `--approve-successor`.


When the Kernel projection reports an active/draining backend claim, route the owned task through `imm-canary-work` (Pi lifecycle extension) instead of v3 mutation. After fresh evidence, use `advance_assurance`; visible background state and push follow-up replace manual QA/Review sequencing and polling. A terminal tombstone alone never blocks unrelated v3 routing.
