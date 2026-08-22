---
name: imm-loop
description: Use to run a validated Plan to completion in the current conversation through checkpoints and isolated QA/review authorities.
---

# Immune-Brain: Loop

Load [`../../dist/imm-loop.md`](../../dist/imm-loop.md), then run the checkpoint loop in the current Pi conversation. Keep active Step implementation in this conversation; use Pi native `Agent` subagents only when the runtime reports `awaiting_qa_decision` or a required review gate. Standard Plan Steps close from passing evidence without per-Step QA; Strict Plan Steps retain isolated QA. Return visible checkpoint progress and a final stop summary.
At every runtime role boundary, call the read-only `imm_loop_action` Tool. Use
`route` for active Steps, bounded repair, architecture exploration, advisory
review, Compounder, Kernel ownership, or scope expansion. Use `dispatch_role`
for `qa`, `code-review`, and `ui-review`, then invoke the returned foreground
Agent envelope exactly. Brainstorm and Planner use the same Tool for bounded
`arch-explorer` and explicit-lens `advisory-reviewer` dispatches. Loop may
dispatch `compounder` only when a closed Step supplies structured evidence for
a reusable Learning; routine work without that evidence returns `next: none`
and creates no Learning. Do not discover or load a Pi Skill for these roles. The three-entry public Skill surface is exactly `imm-brainstorm`, `imm-planner`, and `imm-loop`. Dispatch authorization follows the [shared
Subagent Dispatch Protocol](../../dist/docs/reference/subagent-dispatch-protocol.md#authorization-authority).
All internal Agent dispatch envelopes use `run_in_background: false` and
return `tool_call`, `tool_result`, and `tool_execution_end` evidence to the
Parent before any workflow mutation.

At `terminal_plan_complete`, stop with no next skill, authority, or action. At `awaiting_user_successor_decision`, stop with `recommended_authority: user`. This boundary follows the explicit internal Compounder handoff and runtime terminal settlement; it must not dispatch Planner, Compounder, transition, or a new Pi session/subagent. Only a literal user may approve a successor through the native authority gate; the internal runtime token is `--approve-successor`, never a public Skill or user-facing entry.

Scope expansion always returns to `imm-planner`; Executor and repair roles must stop with the concrete missing scope and verification reason instead of widening execution.

The loop always enters through `imm_loop_action`: the projected action's `next`
authority is `executor`, `test-fixer`, `pr-fix`, `arch-explorer`,
`advisory-reviewer`, `compounder`, `imm_kernel_canary`, `imm-planner`, or
`none`.

When the Kernel projection reports an active/draining backend claim, keep
`imm-loop` as the user-facing entry and call the `imm_kernel_canary` Tool for
that owned task. Enrollment uses the `imm_canary_enrollment` Tool and Review
authorization remains a native TUI gate. When the projection calls for
`request_authorization`, `approve_breaking_intent_revision`, or
`repair_authority_state`, invoke the exact Tool operation directly without
asking the user for chat pre-confirmation; the native host interaction is the
single authority decision. Do not invoke the removed `imm-canary-work` Skill as
a separate entry point. Invalid or contradictory projections fail closed. After
fresh evidence, use `advance_assurance` and `submit_review`;
`request_authorization` remains the user authorization boundary; visible
background state and push follow-up replace internal QA/Review sequencing and
polling. The host performs any opted-in GitHub
Issue projection only after the corresponding authority mutation: Enrollment
projects `active`, while a fresh claimless `done`/`stopped` projection with its
exact terminal tombstone projects `completed`/`not planned`. Treat the attached
tracker result as non-authoritative observation. Report its failure separately,
but never use it as evidence, a stop condition, or a reason to repeat a Kernel
mutation. A terminal tombstone alone never blocks unrelated v3 routing.
