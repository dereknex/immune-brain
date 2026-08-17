---
name: imm-canary-work
description: Use when the runtime projection reports an active Kernel backend claim for the current task; routes Kernel-owned canary work to the Pi lifecycle extension instead of v3 imm-work.
---

# Immune-Brain: Canary Work (Pi-only Kernel routing)

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Purpose

One explicitly enrolled Kernel canary task is owned by the Assurance Kernel
backend. Its lifecycle mutations (ordinary executor facts, QA/review authority,
literal-user authority, drain, terminalization) are executed exclusively through
the Pi lifecycle extension: the `imm_kernel_canary` tool and the
`/imm-canary-assure` and `/imm-canary-authorize` TUI commands. This Skill is the
Pi host route that selects that extension for the matching task and keeps v3
routing unchanged for everything else.

## Activation Gate

Deterministic, read-only, re-evaluated on every continuation from the Kernel
projection:

- **No active Kernel claim**: preserve the existing BASELINE/v3 route unchanged. Kernel is the default route for newly created managed tasks on this host — direct new-task creation to the TUI command `/imm-canary-new <task-id>` (candidate readiness, no waiver); existing Plans keep the v3 route unchanged.
  Do not invoke any canary command.
- **One valid active/draining claim**: route only the matching task to
  `imm_kernel_canary` plus the two TUI commands; report its read-only projection
  (phase, next action, evidence/approval counts).
- **Malformed or contradictory claim/TaskRecord/workspace/tombstone state**:
  fail closed and report recovery evidence. Never normalize malformed owners to
  absence and never guess the intended task.
- **Terminal tombstone only**: never reactivate the historical task and never
  block ordinary v3 routing for a different task.

## Routing Contract

- `imm_kernel_canary` is LLM-callable and closed to ordinary executor
  operations: read-only `status`, `record_evidence`, `record_finding`,
  `resolve_finding`, `submit_review`, compatible `revise_intent`, `complete`,
  plus session-local orchestration operations `advance_assurance`,
  `cancel_assurance`, and `request_authorization`. The Agent calls `advance_assurance` after fresh acceptance
  evidence is complete. It returns structured `started`, `blocked`, `awaiting_user`,
  or `completed` state without waiting for QA or Review terminal. Duplicate advances reuse the active operation ID. After `awaiting_user` or a Review-ready follow-up, the Agent calls `request_authorization`; the host derives the unique next confirmation and opens the existing `ctx.ui.confirm`. The caller cannot supply operation, finding, approval, or capability fields. It has no privileged action
  schema; `record_approval`, `record_user_approval`,
  `approve_breaking_intent_revision`, `stop`, `resolve_user_decision`,
  `begin_drain`, and capability minting are structurally absent.
- Assurance dispatch publishes `starting` before projection, runner resolution,
  snapshot capture, or native spawn. `imm_kernel_canary` renders a compact
  Status / Result / Next hierarchy through native `renderCall`/`renderResult`;
  hash and raw JSON metadata stay out of the default result. Review progress
  belongs to the standard `Agent` Widget/Fleet. Deterministic QA has no custom
  Footer or Widget: low-frequency `ctx.ui.notify` transitions expose
  `current/total`, acceptance ID, elapsed time, and the deterministic hard limit,
  without a predicted ETA or LLM-waking progress message. One correlated
  terminal follow-up remains. Native Review has
  independent 30-second preparation, 120-second standard `Agent` receipt, and
  30-second verdict-validation budgets. Execution profiles derive only from the
  frozen intent and immutable bundle: Quick is 5m soft/15m stop, Standard is
  10m/30m, and Heavy is 20m/60m. Soft expiry is nonterminal and never claims a
  missing native event means `stalled`; stop thresholds retain ownership until a
  reserved `get_subagent_result` matches the agent and operation and its status is
  validated as terminal. Standard Agent and injected adapter results use separate
  host-created terminal deferreds: `handle.result` is advisory-only and is never
  used for verdict parsing or assigned as terminal authority; local resolution or
  rejection cannot settle the host receipt. A validated native failure status
  resolves the branded host receipt with a failure payload; it never rejects the
  deferred. Host receipt rejection remains nonterminal: the helper rejects,
  retains settlement ownership and immutable evidence, and emits no terminal
  follow-up. Stop acknowledgement and nonterminal or unknown status never settle Review; late injected handles never fall back to
  local result. Before dispatch, preparation failure or cancellation remains local
  and emits no correlated native terminal follow-up. Dispatch failure without a
  handle enters `dispatch_unknown`, retains immutable evidence, and emits no
  terminal follow-up. The stop helper returns branded `native_terminal` only after
  that receipt; callers publish terminal and release settlement only
  from that outcome, retain ownership on helper rejection, and treat cleanup
  failure as post-receipt telemetry. QA derives `max(15m, sum(descriptor timeout)+2m)`
  with a 60-minute maximum. Unknown-duration work never blocks parent
  input and is never polled for completion.
- `advance_assurance` moves a fully evidenced working task to review, starts
  deterministic QA, and on fresh QA pass automatically starts exactly one
  Pi-native `general-purpose` reviewer for the immutable snapshot. A validated
  Review native terminal, QA rework, failure, timeout, or cancellation emits one
  correlation-bound
  `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })` so the parent
  Agent continues without user text. The follow-up binds task ID, operation ID,
  record revision, Intent content hash, diff hash, and a typed `next_action`. It
  is advisory and cannot apply authority. A Review `verdict_ready` follow-up sets
  `next_action=request_authorization`; the Agent immediately calls that tool and
  never asks the user to type a recovery command. `/imm-canary-assure <task-id> qa` and
  `/imm-canary-assure <task-id> review [model]` remain TUI-only manual
  diagnostic/recovery entries to the same reserved jobs.
  Native chat rendering and notify keep the derived QA deadline visible
  without a custom Footer or Widget, and the main input remains available.
  Current fresh executor evidence is required for every acceptance item
  (historical stale entries remain diagnostic only), and the host revalidates
  the locked TaskRecord/workspace/Intent/diff snapshot before atomically
  recording QA approval or `request_rework` findings. Each runner has a
  descriptor timeout, one shared stdout/stderr output budget, and POSIX
  process-group termination. The aggregate QA job deadline is the greater of
  15 minutes and the sequential descriptor timeout sum plus 2 minutes; a
  declared aggregate above 60 minutes fails before any verifier starts.
  Cancellation, timeout, session shutdown, snapshot
  drift, or execution failure that wins before authority commit performs zero
  Kernel writes. After commit wins, cancellation is explicitly rejected. If the
  committed Kernel apply has not settled by the host job ceiling, the extension
  stops its heartbeat, releases session job ownership, and reports settlement
  unknown; the next operation reprojects Kernel state, while any late apply
  remains guarded by expected-record-hash CAS. It accepts no model argument and
  makes no LLM call.
- `/imm-canary-assure <task-id> review [model]` is TUI-only review orchestration.
  It asks the parent Agent to call the standard `Agent` tool once for a
  `general-purpose` reviewer in background worktree isolation, optionally with a
  configured model override. The standard `Agent` Widget/Fleet displays the
  reviewer. Before spawn, the
  host captures an immutable bounded review bundle containing every dirty file's
  current bytes, the locked `HEAD`, and each tracked path's base blob OID; the
  bundle digest is part of the assurance snapshot. The isolated reviewer verifies
  `HEAD` and each OID before analyzing findings, limits inspection to the declared
  acceptance assertions and immutable dirty-file contents, avoids unrelated
  repository exploration, and reserves its final turn for exactly one strict JSON
  verdict. It never reads the parent live worktree. The native result is advisory and
  performs zero Kernel writes. When it completes, the Agent calls `request_authorization`
  so the host opens the existing confirmation; `/imm-canary-authorize <task-id> record-review-verdict` remains the manual recovery surface. The confirmation shows
  agent ID, pass/rework decision, summary, duration, and token count when
  available. Only after literal-user confirmation does the host revalidate the
  locked TaskRecord/workspace/Intent/diff snapshot and atomically record review
  approval or `request_rework` findings. `awaiting_user` has no wall-clock expiry;
  authority always revalidates the locked snapshot. Durable cross-session
  advisory/tombstone persistence is explicitly deferred to a later slice.
  Missing standard Agent/model support, failed/stopped agents, malformed output,
  timeout, cancellation, confirmation rejection, or workspace drift performs zero
  Kernel writes.
  Before authority commit, `/imm-canary-assure <task-id> cancel` stops either an
  active QA job or an active native review. Cancellation invalidates the reserved Review observation; it does not call
  provider stop RPC. Cancellation, timeout, and session shutdown retain locked
  evidence until the reserved observation is invalidated or a matching
  `get_subagent_result` is discarded. Timeout,
  cancellation, failure, or partial output does not automatically retry; a later
  explicit advance is required after terminal settlement. Session
  shutdown waits at most 10 seconds and fails closed by retaining 0700 evidence if
  terminal settlement is still unconfirmed. After commit, the command rejects QA
  cancellation rather than reporting a false success.
- `/imm-canary-authorize <task-id> <operation>` is TUI-only and requires a fresh
  exact-action `ctx.ui.confirm`; cancellation, timeout, abort, late resolution,
  reentry, replay, or stale state performs zero writes. Supported operations:
  `begin-drain`, `record-review-verdict`, `record-user-approval`, `stop` (with
  `approve-breaking-intent-revision` reserved for its dedicated payload flow).
  `resolve-user-decision` remains only for historical or unrelated user-decision
  findings; a second Review rework writes `replan_required` and does not ask the
  user to continue. `advance_assurance` fails closed while that finding is open.
- `record-user-approval` records a user-kind approval on a review-phase task
  for critical-risk completion: the extension builds the approval payload
  (kind `user`, authority_role `user`) bound to the fresh projection's task
  revision, intent content hash, and diff hash, mints a user-authority
  capability for the canonical `record_user_approval` action, and applies it
  atomically; the reducer rejects non-user kinds, non-user authority, phase
  drift, hash mismatch, and duplicate approval ids.
- Non-TUI Pi may read `status` only. RPC, JSON, print, CLI flags, environment,
  session entries, callbacks, and serialized descriptors are never authority.

## Boundaries

- **Allowed**: Read the Kernel projection; invoke the canary tool for ordinary
  executor facts, `advance_assurance`/`cancel_assurance`, and host-derived
  `request_authorization`; use the two TUI commands only for manual diagnosis/recovery
  or literal-user authority; report projection and results.
- **Blocked**: v3 `imm-work`/`imm-loop` mutation or mirroring of a Kernel-owned
  task; real canary enrollment (separate `/imm-canary-enroll` literal-user
  operation); Plan activation or successor dispatch; P2C default routing;
  storing any workflow state in Pi sessions.

Before claiming scope drift, a Breaking Revision, or out-of-scope work, inspect
the authoritative TaskIntent, the current Kernel projection,
the staged task snapshot, and the scoped Git diff. Do not infer authority drift from prose, a
stale Spec, conversation memory, file count, or unrelated dirty paths. Report a
breaking revision only when those current sources identify the exact path or
verification change.
- **Workflow guard**: every mutation re-enters Kernel store-lock validation; the
  projection is advisory only.

## Output artifact

A routing decision plus the read-only projection (or the extension command
result), ending with the next literal action for the same task or the stop
condition (terminal tombstone / no claim).

## Output style

`Conclusion -> Evidence -> Next action`; do not mirror internal registry or
capability state.
