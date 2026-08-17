---
name: imm-canary-work
description: Use when the runtime projection reports an active Kernel backend claim for the current task; routes Kernel-owned canary work to the Pi lifecycle extension instead of v3 imm-work.
---

# Immune-Brain: Canary Work (Pi-only Kernel routing)

Load [`../../dist/imm-canary-work.md`](../../dist/imm-canary-work.md), then continue one
enrolled Kernel canary task through the Pi TUI lifecycle extension. This Skill is
Pi-only: it routes exactly one Kernel-owned task to `imm_kernel_canary`. The
Agent records ordinary executor facts, then calls `advance_assurance`; that
operation returns immediately after reserving a session-local job and drives
deterministic QA -> one Pi-native Review automatically. Low-frequency Host-native
QA notifications expose each acceptance transition with `current/total`,
acceptance ID, elapsed time, and the deterministic hard limit; they never claim
a predicted ETA and never restore a private Footer or Widget. Terminal background
events resume the parent through one correlated `followUp` with a typed
`next_action`, and the parent never polls. After `awaiting_user` or a
Review-ready follow-up whose `next_action` is `request_authorization`, the Agent
immediately calls `request_authorization` so the host opens the exact
confirmation; it does not ask the user to type `/imm-canary-authorize`. Tool
results render a compact Status / Result / Next hierarchy while retaining
failures and blockers in the visible result. `/imm-canary-assure` is a
manual diagnostic/recovery surface, while `/imm-canary-authorize` remains the
manual recovery authority surface (including `record-review-verdict` for the
session-bound advisory Review result and `record-user-approval` for critical
risk). Native Review uses independent 30-second preparation, 120-second standard
`Agent` receipt, and 30-second verdict-validation budgets. Execution is classified
only from frozen intent risk and immutable bundle metrics: Quick is 5m soft/15m
stop, Standard is 10m/30m, and Heavy is 20m/60m. Soft expiry is nonterminal; a
stop threshold requests stop and retains snapshot ownership until a reserved
`get_subagent_result` matches the agent and operation and its status is validated
as terminal. Standard Agent and injected adapter results use separate host-created
terminal deferreds: `handle.result` is advisory-only and is never used for verdict
parsing or assigned as terminal authority; local resolution or rejection cannot
settle the host receipt. A validated native failure status resolves the branded
host receipt with a failure payload; it never rejects the deferred. Host receipt
rejection remains nonterminal: the helper rejects, retains settlement ownership
and immutable evidence, and emits no terminal follow-up. Stop acknowledgement and
nonterminal or unknown status
never settle Review; late injected handles never fall back to local result. Before
dispatch, preparation failure or cancellation remains local and emits no correlated
native terminal follow-up. Dispatch failure without a handle enters
`dispatch_unknown`, retains immutable evidence, and emits no terminal follow-up.
The stop helper returns branded `native_terminal` only after that receipt;
callers publish terminal and release settlement only from that outcome, retain
ownership on helper rejection, and treat cleanup failure as post-receipt telemetry.
Deterministic QA uses `max(15m, sum(descriptor timeout)+2m)`, rejects a
declared aggregate above 60 minutes before the first verifier, and preserves each
descriptor timeout. Review keeps the 12-turn cap and does not automatically retry.
An `awaiting_user` verdict has no wall-clock expiry and is revalidated before
authority; durable cross-session advisory/tombstone persistence remains a later
slice. A second Review rework
parks the task in review with `replan_required` and does not ask the user to
continue.
It never mutates or mirrors a Kernel-owned task through v3 `imm-work`/
`imm-loop`, never enrolls a task, and never activates a Plan.

Activation gate is deterministic and read-only:

- No active Kernel claim: preserve the existing BASELINE/v3 route unchanged. Kernel is the default route for newly created managed tasks on this host — direct new-task creation to the TUI command `/imm-canary-new <task-id>` (candidate readiness, no waiver); existing Plans keep the v3 route unchanged.
- One valid active/draining claim: route only the matching task to the canary
  extension; report its read-only projection.
- Malformed or contradictory claim/TaskRecord/workspace/tombstone state: fail
  closed and report recovery evidence; never normalize to absence.
- Terminal tombstone only: never reactivate the historical task and never block
  ordinary v3 routing for a different task.

Before claiming scope drift, a Breaking Revision, or out-of-scope work, inspect
the authoritative TaskIntent, the current Kernel projection,
the staged task snapshot, and the scoped Git diff. Do not infer authority drift from prose, a
stale Spec, conversation memory, file count, or unrelated dirty paths. Report a
breaking revision only when those current sources identify the exact path or
verification change.

The Kernel projection is advisory; every mutation is revalidated by the Kernel
store lock. No workflow state is stored in Pi sessions.
