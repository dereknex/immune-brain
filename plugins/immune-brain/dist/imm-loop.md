---
name: imm-loop
description: Use to run an enrolled TaskIntent to completion through Kernel-governed execution, QA, and Review.
---

# Immune-Brain: Loop

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Kernel Canary Routing and Authority

Only explicit `imm-loop` entry starts or resumes this loop. Ordinary host input
stays host-native; it never resumes a Managed owner implicitly. Read the current
Host's `imm_kernel_canary` `status` first and verify the exact active backend
claim, TaskIntent, and TaskRecord. Invalid or contradictory projections fail
closed. A candidate TaskIntent is not Enrollment authority.

TaskIntent defines the goal, acceptance, and `scope_hint`; TaskRecord and the
Kernel projection own lifecycle, artifact state, freshness, and next obligation.
Conversation memory, GitHub Issues, and `CONTEXT.md` never override them.
Historical prose Plans and State Ledgers are read-only history, not execution
instructions. Do not create Steps, workflow profiles, follow-up ledgers, or
successor Plans to drive a Kernel task.

At every internal role boundary call the read-only `imm_loop_action` Tool. Use
`route` for current-context Executor work, bounded repair, architecture
exploration, advisory review, Compounder, Kernel ownership, or scope expansion.
Use Kernel ownership for an enrolled task. This Tool projects authority; it does
not record execution evidence, mutate task state, or replace Kernel operations.
Follow the [Subagent Dispatch Protocol](docs/reference/subagent-dispatch-protocol.md#authorization-authority).
Never load an internal role as a public Skill or spawn another loop process.
The standalone `imm-pr-fix`, `imm-doc-prune`, and `imm-agent-doc-maintain` are host-native
maintenance entries, never dispatched as the Loop role. Internal `test-fixer`
and `pr-fix` repairs remain bounded by the enrolled TaskIntent.

## Execution Loop

Continue while the current projection has a valid action:

1. For active artifacts, implement only the enrolled acceptance within
   `scope_hint` in the current conversation. Run focused checks. Executor checks
   are diagnostic evidence, not a QA or Review approval.
2. Before Assurance, call `freeze_artifacts` while TaskRecord is `active:active`.
   A bound active Spec and its archive path must both be inside `scope_hint`.
   The Kernel owns byte-preserving archival and the frozen snapshot.
3. Call `advance_assurance` in the foreground and consume its direct terminal
   result. Deterministic QA runs fixed acceptance descriptors atomically inside
   the Host integration. Do not dispatch a separate per-Step QA Agent.
4. On `review_ready`, invoke the returned `agent_params` as one exact foreground
   Agent call, then pass its structured verdict to `submit_review`. Do not
   replace this snapshot-bound reviewer with a generic role dispatch. The Parent
   cannot issue its own QA or Review pass.
5. Follow the returned Kernel obligation. Fresh QA suffices for routine work;
   material and critical work additionally require fresh independent Review.
   Normal completion does not require a second user confirmation.
6. For rework, follow the projected artifact state before editing. Resolve
   findings only after fixing and verifying their cause. Changed snapshots
   invalidate old evidence; freeze and run the newly required obligations.
7. Stop on terminal `done` or `stopped`, unresolved user decisions, explicit
   cancellation, or a failure without a safe projected action.

Use the fresh projection returned by a successful operation when supplied. Read
`status` after interruption, ambiguous mutation results, absent projections, or
suspected external changes. Never repeat a mutation merely to obtain its result.
Kernel CAS and freshness checks remain mandatory; reducing Parent reads does
not bypass them. Do not poll or create detached jobs.

## Decisions and Recovery

- Scope expansion always returns to `imm-planner`. Collect all currently known missing
  paths, caller/test/generated mirrors, and verification reasons in one request.
  Do not edit outside scope while waiting or widen it piecemeal without new
  evidence. Bounded test or PR repair stays inside the same TaskIntent.
- Invoke `approve_breaking_intent_revision` with the complete next intent
  directly; the native Host gate is the single user decision. Do not overwrite
  enrolled intent sidecars or ask for chat pre-confirmation.
- On `awaiting_user`, invoke `request_authorization` directly. It is reserved
  for a concrete unresolved decision or explicit stop, not risk tier alone.
- Invoke `repair_authority_state` directly for a proven stale claim. Kernel
  revalidation removes only the redundant claim without user interaction.
- A Managed native authority failure stays fail-closed. Report its stable reason
  and exactly one same-Host recovery action. Never recommend another Host,
  worktree, Direct Path, unmanaged implementation, or automatic retry.
- After interruption, read a fresh projection and run only the pending obligation.
  A committed QA result is honored; an interrupted precommit QA run produces no
  approval. Do not rerun fresh QA simply because Review was interrupted.
- Malformed or stale reviewer output is not a verdict. Keep the existing
  reservation only if the Host reports it valid; use its exact recovery action.
  Do not fabricate a pass or blindly redispatch Review.
- Missing tools, credentials, invalid projections, or repeated unchanged failures
  stop with a concrete cause. Cancellation performs no decision write and is not
  task termination. Explicit task stop uses its native authority gate.

## Review and Learning

Reviewers are read-only and bound to the frozen snapshot. They cannot edit files,
write planning artifacts, mutate Kernel state, or settle decisions. Report all
substantiated blockers in one round, tied to acceptance or a concrete regression;
separate optional advice from blockers. Suggestions alone do not justify rework.
Use the returned verdict schema exactly, including omission of unsupported fields.

`dispatch_role` for `qa`, `code-review`, or `ui-review` is used only when an
explicit runtime-supported role boundary requests it, followed by the returned
foreground Agent envelope exactly. It is not an extra gate on Kernel Assurance.
All internal Agent envelopes use `run_in_background: false`.

The internal Compounder is optional: only closed work with structured evidence
of a reusable Learning may route to it. Routine completion creates no Learning.
It cannot approve successors or delay terminal settlement. A projection with
`recommended_authority: user` must not dispatch successor work automatically.
Do not create, switch,
or delete Git worktrees; operate only in the Host launch directory.

The Host may attach an opted-in GitHub projection after settlement. Only a fresh claimless
`done`/`stopped` projection plus its exact terminal tombstone projects
`completed`/`not planned`; Enrollment performs no GitHub projection. Report a
tracker failure separately; never use it as evidence, a Loop blocker, or a reason to
repeat a Kernel mutation.

## Observable Output

Emit progress at execution start, QA/Review phase changes, failures, and terminal
stop. Every Agent round has one dispatch line and one result line; never claim a
successful collection on timeout, cancellation, malformed output, or stale identity.
Normal conversation and visible Tool calls are the observation surface. Do not
narrate routine projection reads or add Footer status content.

Every exit includes a concise summary:

```text
Task:
Completed work:
QA:
Review:
Stop reason:
Next action:
```

For `settlement_unknown`, call `advance_assurance` once to reconcile the Kernel
projection before resuming; never replay the uncertain write directly. The runtime
retries only explicit `EINTR`/`EAGAIN` failures of its initial projection read, once,
with cancellation checks. Semantic authority errors and mutation failures are not
retryable reads. For `review_preparation_failed`, repair the reported transport or
environment cause before advancing; committed QA remains valid. For
`verdict_invalid`, correct the existing payload once and resubmit without another
reviewer dispatch. If correction fails, report the schema failure and stop the
correction loop.

For failures, name the cause, stages already committed, the safe retry boundary,
and exactly one next action. Distinguish user approval from environment repair
and runtime failure. Do not ask the user to manually switch internal roles.
