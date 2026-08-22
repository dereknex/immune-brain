---
name: imm-loop
description: Use when running validated Plans to completion.
---

# Immune-Brain: Loop

This skill adheres to the **[BASELINE.md](BASELINE.md)**.
At every runtime role boundary, call the read-only `imm_loop_action` Tool. Use
`route` for active Steps, bounded repair, architecture exploration, advisory
review, Compounder, Kernel ownership, or scope expansion. Use `dispatch_role`
for `qa`, `code-review`, and `ui-review`, then invoke the returned foreground
Agent envelope exactly. Brainstorm and Planner use the same Tool for bounded
`arch-explorer` and explicit-lens `advisory-reviewer` dispatches. Loop may
dispatch `compounder` only when a closed Step supplies structured evidence for
a reusable Learning; routine work without that evidence returns `next: none`
and creates no Learning. Do not discover or load a Pi Skill for these roles. The three-entry public Skill surface is exactly `imm-brainstorm`, `imm-planner`, and `imm-loop`.
Dispatch authorization follows the [shared Subagent Dispatch
Protocol](docs/reference/subagent-dispatch-protocol.md#authorization-authority).
Same-boundary `follow_up` is not a Plan mutation; it repeats the current
execution, QA, and originating review gate. All internal Agent dispatch
envelopes use `run_in_background: false` and return `tool_call`, `tool_result`,
and `tool_execution_end` evidence to the Parent before any workflow mutation.

## Workflow Profiles

- `direct` has no Plan or Ledger and never invokes this skill.
- `standard` keeps execution in the main context, closes a Plan Step when the runtime accepts passing evidence, and therefore does not dispatch the internal QA role per Step. It still dispatches every runtime-required final code/UI review gate. The last gate pass atomically performs internal terminal settlement when `compounder_requirement.required` is false.
- `strict` preserves the full internal loop: each Step reaches isolated QA before final review, internal Compounder handoff, and terminal settlement. A missing profile is strict.
- Reviewer `follow_up` targets always retain isolated QA. Standard Plans allow at
  most two completed/open rounds; `review_budget_state.budget_stop` is a hard
  stop. Never attempt a third Loop runtime action.
- `workflow_profile`, `compounder_requirement`, and `review_budget_state` from
  the live Kernel / Loop projection are authoritative. Do not infer or override
  them in the host.

## Core Responsibilities

- **Main-context completion loop**: Drive the enrolled Kernel task in the current Pi conversation until completion or a safe stop.
- **Context-preserving execution**: Call `imm_loop_action` with `op: route`, then follow the returned `executor` context in the current Parent conversation. Implement only the active Step or pending same-boundary `follow_up`, then record structured execution evidence through the Loop runtime action. A bounded test failure uses the returned internal `test-fixer` dispatch with its explicit delegated test-file list; PR feedback or CI repair uses the returned internal `pr-fix` dispatch inside the current Plan boundary.
- **Independent authority isolation**: Use the host `Agent` subagent primitive for `awaiting_qa_decision` and for the exact runtime-reported review gate. Standard Plan Steps close from accepted passing evidence before an internal QA boundary exists; Strict Steps and all follow-ups retain isolated QA. The parent records accepted child decisions through the Loop runtime action.
- **Observable progress**: Update only at major phase changes: Step start, execution evidence recorded, QA/review result, or terminal stop. Always emit a terminal summary.
- **Kernel projection authority**: Re-read `imm_kernel_canary` `status` after every persisted action. Conversation memory never overrides the Kernel projection.
- **External tracker boundary**: The host may attach one opted-in GitHub Issue projection after Enrollment or terminal settlement. Enrollment projects `active`; only a fresh claimless `done`/`stopped` projection plus its exact terminal tombstone projects `completed`/`not planned`. Report tracker failures separately, but never treat them as evidence, stop the Loop, repeat a Kernel mutation, or import Issue state.
- **Scope boundary**: Scope expansion always returns to `imm-planner`; Executor, test repair, and PR/CI repair stop with the concrete missing scope and verification reason instead of widening execution.
- **Action authority**: The loop always enters through `imm_loop_action`; its projected `next` authority is `executor`, `test-fixer`, `pr-fix`, `arch-explorer`, `advisory-reviewer`, `compounder`, `imm_kernel_canary`, `imm-planner`, or `none`.

## Kernel Loop

Repeat this sequence; do not silently stop while a valid action remains:

1. Call `imm_loop_action` with `op: route` (or `dispatch_role` at a QA/review boundary) and follow the projected `next` authority.
2. Emit one progress line: `[target][phase] result | next: action`.
3. Execute exactly one allowed action:
   - Kernel ownership: call `imm_kernel_canary` for that owned task. After fresh executor evidence, call `advance_assurance` and `submit_review`; when the projection calls for `request_authorization`, `approve_breaking_intent_revision`, or `repair_authority_state`, invoke the exact Tool operation directly without asking the user for chat pre-confirmation. The native host interaction is the single authority decision.
   - Active Step / `rework_needed`: follow the returned `executor` context in the current conversation, implement only the active Step or pending same-boundary `follow_up`, verify, record structured execution evidence through the Loop runtime action, and continue. A bounded test-only repair may request internal `test-fixer` with `focus_delta.specific_changes`; PR review or CI repair may request internal `pr-fix` with the current `plan_id`, changed-file boundary, and verification. Both return child evidence to the Parent and cannot widen scope.
   - `awaiting_qa_decision`: call `imm_loop_action` with `op: dispatch_role`, role `qa`, the current projection, Plan verification, recorded evidence, and current target identity. Invoke the returned foreground Agent envelope exactly. A `rework` or `replan` must carry validated `notes`.
   - `review_required`: map the exact `pending_review_gate` (`imm-code-review` or `imm-ui-review`) to the internal `code-review` or `ui-review` role and call `imm_loop_action` with `op: dispatch_role`, passing `pending_review_gate`, `review_changed_files`, and `review_changed_files_signature`. Invoke the returned foreground Agent envelope exactly. Record a validated pass, or open a same-boundary follow-up through the Loop runtime action.
   - `awaiting_user_successor_decision`: stop immediately with `recommended_authority: user`, no next skill, and no runtime action. This boundary must not dispatch Planner, transition, Compounder, or a new Pi session/subagent. Only a literal user may supply a concrete validated successor Plan through the native authority gate; the internal runtime token is `--approve-successor`, never a public Skill or user-facing entry.
4. After every accepted runtime write, discard the old snapshot and read a fresh Kernel / Loop projection. Emit a result line only when the write completes a major phase or a subagent round.

Use Pi native `Agent` subagents. Do not spawn Pi child processes or invoke a separate `imm-loop` CLI.

## Authority and Failure Guards

- Implementation requires a validated Plan and active Step or accepted pending `follow_up`.
- The parent may implement but must not issue its own QA or review pass.
- QA and reviewer children must not edit files, write Plans, mutate Kernel state, or close decisions directly.
- Missing `Agent` support, failed or malformed child output, stale child target, runtime write failure, invalid projection, missing credentials, unclear verification, repeated unchanged failure, or user cancellation stops fail-closed with an explicit reason and no decision write.
- `replan_needed` stops at `imm-planner`; do not widen scope or rewrite the active Plan. A replacement must use a new sequential Plan path after the current Plan reaches `completed`, or after a literal user explicitly marks it `cancelled` or `superseded`.
- Plans never suspend, resume, queue, or execute in parallel. Do not insert a repair Plan ahead of the current Plan.
- Same-boundary review `follow_up` repeats execution, independent QA, and the originating review gate.
- Runtime `review_required` is the single review-gate authority. Do not invent hidden gates.
- `imm-compounder` is an internal role and is never invoked as a public Skill. A `complete` projection carries an explicit internal Compounder handoff because the runtime determined it is required. A Standard Plan with optional Compounder is atomically finished by the last review gate and does not emit that handoff. Strict Plans preserve the successful order: current Steps and QA, required reviews, internal Compounder handoff, terminal settlement, then `awaiting_user_successor_decision` for a non-terminal Roadmap slice.
- Successor approval is non-delegable. QA, review, Planner, Compounder, and the loop cannot approve or activate a successor, and the loop must not turn a command template into an executable successor invocation.

## Stop Conditions

Stop only for:

- `complete` with an explicit internal Compounder handoff before terminal settlement
- `terminal_plan_complete` after a contracted terminal Plan or a legacy Plan without successor metadata has passed internal Compounder handoff and terminal settlement; stop with no next skill, authority, or action
- `awaiting_user_successor_decision` after finish, with literal user authority and no automatic action
- `replan_needed`
- blocker or required user input
- runtime, tool, subagent, or output-contract failure
- user cancellation (no decision write; Plan termination is a separate explicit user-confirmed runtime action)
- repeated unchanged failure
- explicit Step, rework, review, follow-up, or elapsed-time budget exhaustion

Session-local budgets are advisory. Persisted Step, QA, review, and follow-up state controls recovery. After interruption, re-enter only by reading a fresh projection: a completed runtime write is honored once; an interrupted pre-write action is not claimed; cancellation performs no decision write; repeated unchanged failure stops unless the next attempt names a strategy change; explicit budgets stop before another action.

## Observable Output Contract

Do not narrate projection reads or routine runtime writes. Emit compact progress only for Step start, completed execution evidence, QA/review decisions, failures that change the plan, and terminal stop. Every subagent round still emits exactly one dispatch line and exactly one collection/result line:

```text
[Step 1/3][Executor] evidence recorded | next: QA
[Step 1/3][QA] Agent dispatched
[Step 1/3][QA] Agent collected: pass | next: imm-code-review
```

Do not emit a successful collection line for timeout, cancellation, malformed output, or stale identity; emit the explicit failure stop instead.

Every exit, including failure, must include:

```text
Plan:
Completed Steps:
QA:
Review:
Stop reason:
Next action:
```

Normal conversation text and visible tool calls are the correctness-level observation surface. Extension widgets are optional decoration only.

## Boundary

- **Allowed**: Coordinate Kernel / Loop projections, current-conversation Executor work, isolated QA/review children, runtime decision recording, same-boundary follow-up, and terminal handoff reporting.
- **Blocked**: Plan edits, parent-owned QA/review pass, hidden review gates, direct Kernel-store edits, child-owned state mutation, automatic Compounder execution, and external loop runners.
- **Workflow guard**: Kernel and Loop projections choose the next authority; each authority keeps its existing Skill contract.

## Output artifact

A visible completion trace plus terminal summary containing Plan, completed Steps, QA state, review state, stop reason, and next action.

## Next Action

- If no validated Plan exists: stop and route to `imm-planner`.
- If an allowed Loop action exists: continue the loop without another user command.
- If work is fully closed but not finished: report the explicit internal Compounder handoff and wait for terminal settlement.
- If the projection is `awaiting_user_successor_decision`: report the candidate and preconditions, ask for the user's decision, and stop without dispatch.

## Output style

Default user-facing shape: checkpoint progress lines, then `Conclusion -> Evidence -> Next action` at the terminal boundary.

## Kernel Canary Routing

When the Kernel projection reports an active/draining backend claim, keep
`imm-loop` as the user-facing entry and call the `imm_kernel_canary` Tool for
that owned task. Enrollment uses the `imm_canary_enrollment` Tool and Review
authorization remains a native TUI gate using the internal user-kind approval
action `record-user-approval`. When the projection calls for
`request_authorization`, `approve_breaking_intent_revision`, or
`repair_authority_state`, invoke the exact Tool operation directly without
asking the user for chat pre-confirmation; the native host interaction is the
single authority decision. This action is not a public Skill or CLI route. Do
not invoke the removed `imm-canary-work` Skill as a separate entry point.
Invalid or contradictory projections fail closed. After fresh executor
evidence, call `imm_kernel_canary` `advance_assurance` and `submit_review`;
`request_authorization` remains the user authorization boundary. Visible
background state and push follow-up replace manual QA/Review sequencing and
result polling. A terminal task leaves only an immutable task tombstone: it is
never reactivated and never blocks unrelated v3 routing. The Kernel projection
is advisory; every Kernel mutation re-enters Kernel store-lock validation.
