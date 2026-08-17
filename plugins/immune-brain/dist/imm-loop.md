---
name: imm-loop
description: Use when running validated Plans to completion.
---

# Immune-Brain: Loop

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Workflow Profiles

- `direct` has no Plan or Ledger and never invokes this skill.
- `standard` keeps execution in the main context, closes a Plan Step when the
  runtime accepts passing evidence, and therefore does not dispatch per-Step
  `imm-qa`. It still dispatches every runtime-required final code/UI review gate.
  The last gate pass atomically runs `imm-finish` when
  `compounder_requirement.required` is false.
- `strict` preserves the legacy loop: each Step reaches isolated QA before final
  review, Compounder handoff, and explicit finish. A missing profile is strict.
- Reviewer `follow_up` targets always retain isolated QA. Standard Plans allow at
  most two completed/open rounds; `review_budget_state.budget_stop` is a hard
  stop. Never attempt a third `follow-up-open`.
- `workflow_profile`, `compounder_requirement`, and `review_budget_state` from
  `imm-autowork` are authoritative. Do not infer or override them in the host.

## Core Responsibilities

- **Main-context completion loop**: Consume `imm-autowork --json` checkpoints in the current Pi conversation until completion or a safe stop.
- **Context-preserving execution**: On `awaiting_execution_input` or `rework_needed`, enter the active Step's `imm-executor` boundary in the current conversation, then record evidence with `imm-work record-execution`.
- **Independent authority isolation**: Use the host `Agent` subagent primitive when the checkpoint reports `awaiting_qa_decision` and for the exact runtime-reported review gate. Standard Plan Steps close from accepted passing evidence before a QA boundary exists; Strict Steps and all follow-ups retain isolated QA. The parent records accepted child decisions through `imm-review`.
- **Observable progress**: Update only at major phase changes: Step start, execution evidence recorded, QA/review result, or terminal stop. Always emit a terminal summary.
- **State Ledger authority**: Re-read the checkpoint after every persisted action. Conversation memory never overrides State Ledger state.

## Checkpoint Loop

Repeat this sequence; do not silently stop while a valid action remains:

1. Run `imm-autowork --json` and validate `recommended_authority`, `required_input`, and `allowed_actions`.
2. Emit one progress line: `[target][phase] result | next: action`.
3. Execute exactly one allowed action:
   - `awaiting_execution_input` / `rework_needed`: implement only the active Step or pending same-boundary `follow_up` in the current conversation under `imm-executor`; verify and call `imm-work record-execution`.
   - `awaiting_qa_decision`: dispatch an isolated read-only `imm-qa` child with the checkpoint, Plan verification, recorded evidence, and current target identity (`active_step.number` or `execution_target.id`). Validate its raw output with `imm-check-child-output --kind qa --json '<child output>'`, then call `imm-review` from the parent using the validated decision. A `rework` or `replan` must carry the validated `notes` through as `--notes`; the runtime rejects either decision without it.
   - `review_required`: dispatch the exact `pending_review_gate` (`imm-code-review` or `imm-ui-review`) with `pending_review_gate`, `review_changed_files`, and `review_changed_files_signature` from the checkpoint. Validate its raw output with `imm-check-child-output --kind review --json '<child output>'`. Record a validated pass with `imm-review gate-pass --changed-files-signature <review_changed_files_signature>`, or open a same-boundary follow-up through `imm-work follow-up-open --changed-files-signature <review_changed_files_signature>`.
   - `awaiting_user_successor_decision`: stop immediately with `recommended_authority: user`, no next skill, and no runtime action. This boundary must not dispatch Planner, transition, Compounder, or a new Pi session/subagent. Only a literal user may supply a concrete validated successor Plan to `--approve-successor`.
4. `imm-check-child-output` owns the child decision schema: decision enum, required fields, decision-specific fields, unknown fields, and stale target, gate, or signature values. It derives the expected identity from the State Ledger, so never hand-build that expectation or re-derive the schema from this document. A non-zero exit means perform no runtime write and stop with the reported `qa_output_invalid` or `reviewer_output_invalid`.
5. After every accepted runtime write, discard the old snapshot and read a fresh checkpoint. Emit a result line only when the write completes a major phase or a subagent round.

Use Pi native `Agent` subagents. Do not spawn Pi child processes or invoke a separate `imm-loop` CLI.

## Authority and Failure Guards

- Implementation requires a validated Plan and active Step or accepted pending `follow_up`.
- The parent may implement but must not issue its own QA or review pass.
- QA and reviewer children must not edit files, write Plans, mutate State Ledger state, or close decisions directly.
- Missing `Agent` support, failed or malformed child output, stale child target, runtime write failure, invalid checkpoint contract, missing credentials, unclear verification, repeated unchanged failure, or user cancellation stops fail-closed with an explicit reason and no decision write.
- `replan_needed` stops at `imm-planner`; do not widen scope or rewrite the active Plan. A replacement must use a new sequential Plan path after the current Plan reaches `completed`, or after a literal user explicitly marks it `cancelled` or `superseded`.
- Plans never suspend, resume, queue, or execute in parallel. Do not insert a repair Plan ahead of the current Plan.
- Same-boundary review `follow_up` repeats execution, independent QA, and the originating review gate.
- Runtime `review_required` is the single review-gate authority. Do not invent hidden gates.
- `imm-compounder` is never invoked automatically. A `complete` checkpoint carries an explicit Compounder handoff because the runtime determined it is required. A Standard Plan with optional Compounder is atomically finished by the last review gate and does not emit that handoff. Strict Plans preserve the successful order: current Steps and QA, required reviews, explicit Compounder handoff, `imm-finish`, then `awaiting_user_successor_decision` for a non-terminal Roadmap slice.
- Successor approval is non-delegable. QA, review, Planner, Compounder, and the loop cannot approve or activate a successor, and the loop must not turn a command template into an executable `--approve-successor` invocation.

## Stop Conditions

Stop only for:

- `complete` with explicit `imm-compounder` handoff before `imm-finish`
- `terminal_plan_complete` after a contracted terminal Plan or a legacy Plan without successor metadata has passed Compounder handoff and `imm-finish`; stop with no next skill, authority, or action
- `awaiting_user_successor_decision` after finish, with literal user authority and no automatic action
- `replan_needed`
- blocker or required user input
- runtime, tool, subagent, or output-contract failure
- user cancellation (no decision write; Plan termination is a separate explicit user-confirmed runtime action)
- repeated unchanged failure
- explicit Step, rework, review, follow-up, or elapsed-time budget exhaustion

Session-local budgets are advisory. Persisted Step, QA, review, and follow-up state controls recovery. After interruption, re-enter only by reading a fresh checkpoint: a completed runtime write is honored once; an interrupted pre-write action is not claimed; cancellation performs no decision write; repeated unchanged failure stops unless the next attempt names a strategy change; explicit budgets stop before another action.

## Observable Output Contract

Do not narrate checkpoint reads or routine runtime writes. Emit compact progress only for Step start, completed execution evidence, QA/review decisions, failures that change the plan, and terminal stop. Every subagent round still emits exactly one dispatch line and exactly one collection/result line:

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

- **Allowed**: Coordinate checkpoints, current-conversation Executor work, isolated QA/review children, runtime decision recording, same-boundary follow-up, and terminal handoff reporting.
- **Blocked**: Plan edits, parent-owned QA/review pass, hidden review gates, direct State Ledger edits, child-owned state mutation, automatic Compounder execution, and external loop runners.
- **Workflow guard**: State Ledger snapshots choose the next authority; each authority keeps its existing Skill contract.

## Output artifact

A visible completion trace plus terminal summary containing Plan, completed Steps, QA state, review state, stop reason, and next action.

## Next Action

- If no validated Plan exists: stop and route to `imm-planner`.
- If an allowed checkpoint action exists: continue the loop without another user command.
- If work is fully closed but not finished: report the explicit `imm-compounder` handoff and wait for Compounder plus `imm-finish`.
- If the checkpoint is `awaiting_user_successor_decision`: report the candidate and preconditions, ask for the user's decision, and stop without dispatch.

## Output style

Default user-facing shape: checkpoint progress lines, then `Conclusion -> Evidence -> Next action` at the terminal boundary.

## Kernel Canary Routing

When the runtime Kernel projection reports an active or draining backend claim,
the owned task is a Kernel canary. Route it through `imm-canary-work` (the Pi
lifecycle extension) for ordinary facts, QA/review authority, and literal-user
actions. The loop must never mutate or mirror a Kernel-owned task through v3
Plan/Step state, and the canonical v3 call site fails closed while a
workspace-active claim exists. After fresh executor evidence, call
`imm_kernel_canary` `advance_assurance`; visible background Footer/Widget state
and push follow-up replace manual QA/Review sequencing and result polling. A
terminal task leaves only an immutable task
tombstone: it is never reactivated and never blocks unrelated v3 routing. The
Kernel projection is advisory; every Kernel mutation re-enters Kernel
store-lock validation.
