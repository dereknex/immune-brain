# Pi Native Task Stop

**Issue:** https://github.com/dereknex/immune-brain/issues/50
**Status:** Candidate, plan-only; not execution authority.
**Design risk**: High. A small public API addition crosses literal-user authority, cancellation, and terminal settlement boundaries.
**Output language:** English.
**Execution posture:** test-first, using the existing Pi Tool harness and real Kernel storage.
**Diagram decision**: not_required
**Diagram reason**: One existing linear authorization chain is reused; the ordered sequence and transition table below make its race boundaries explicit without a second representation.

## Outcome and Boundary

Expose `imm_kernel_canary({ task_id, action: { op: "request_stop" } })` in Pi. A literal user's affirmative native confirmation stops exactly the enrolled task through existing Kernel authority, preserves implementation files, archives bound planning artifacts, and releases its workspace claim through terminal settlement.

One TaskIntent owns this outcome. Schema, dispatch, native confirmation and observable terminal evidence are one atomic user-authority invariant, not independently deliverable slices. No new Initiative is needed. Issue #50 is context, never an authority input.

This request does not add a slash command, force-kill control, generic cancellation API, new capability kind, batch-wide stop policy, Claude API, or new persisted state. It does not implement Review convergence (#51), change QA/Review requirements, rewrite Kernel core, or manually clear claims. Cancelling a dialog or interrupting a Tool is not task stop. A busy assurance invocation must finish or be cancelled by existing Host controls before a new stop request can be admitted.

## Discovery Evidence

- `plugins/immune-brain/.pi-extension/imm-canary-work.ts`: public action schema omits stop; `authorizeExactOperation` already accepts internal `stop`, opens the native dialog, creates exact user authority and applies it. `requestAuthorization` intentionally derives only user-decision/rework operations; it must not be overloaded. Existing stop reason incorrectly assumes a task parked for replan.
- `plugins/immune-brain/.pi-extension/pi-canary-interaction.ts`: native dialog transport, abort handling, attention events and Task Rail presentation. Reuse these UI boundaries rather than calling Host internals or writing footer text.
- `plugins/immune-brain/runtime/assurance/coordinator.ts` and `invocations.ts`: invocation admission, open/committed/cancelled linearization, session generation, QA activity, Review reservation and release ownership. These are the in-memory siblings of stop authority and must be audited together.
- `plugins/immune-brain/runtime/kernel/canary_application.ts`, `authority_port.ts`, `application.ts`, `reducer.ts`, `storage.ts`, and `backend_claim.ts`: exact capability consumption, locked CAS application, stop transition, recoverable terminal transaction, claim and tombstone evidence. Reuse unchanged semantic operations; these exact paths remain in scope for same-state-machine inspection and any proven integration defect, not a Kernel redesign.
- `tests/pi-canary-user-authority.test.ts`: registered Tool invocation, real TaskRecord/claim byte assertions, native confirmation, revision races and cancellation prior art. This is the primary acceptance seam; direct helper tests alone would miss the absent public entry.
- `tests/pi-canary-work-extension.test.ts`: registered schema and Rail/notification contract. `tests/kernel-canary-terminal-transaction.test.ts`: authorized stop and transaction recovery. `tests/pi-canary-invocation-registry.test.ts`: one-winner invocation behavior. `tests/pi-canary-assurance-continuation.test.ts`: late Review/session behavior.
- `tests/pi-canary-package-boundary.test.ts`, `tests/pi-canary-packed-loader.test.ts`, root `package.json`, and `.pi-extension/runtime-stub.ts`: the extension source is shipped directly, not a second generated implementation. No manifest, generated runtime or version change is required. Existing packed-loader checks are supplemental release verification, not an acceptance descriptor because they run `npm pack`.
- `plugins/immune-brain/dist/imm-loop.md` is the canonical Loop contract; `plugins/immune-brain/skills/imm-loop/SKILL.md` forwards to it. Update the canonical contract and `plugins/immune-brain/README.md`, not the forwarding Skill or global agent files. `tests/imm-canary-work-contract.test.ts` covers exposed contracts.

### Decision History

ADR `docs/adr/0004-dual-host-assurance-adapters.md` requires one Kernel authority and host-native interaction, not another workflow machine. Its schema-preservation decision describes the prior extraction; this issue deliberately adds one Pi operation without changing existing operation semantics.

`docs/solutions/rejected-shared-registry-generic-dispatcher.md` rules out platformizing this Host-bound fix. `docs/solutions/rejected-out-of-band-review-authority-reconstruction.md` contributes the durable prohibition on reconstructing authority from conversation or Git; its legacy State Ledger mechanism is not revived.

**Brainstorm Trace:** Direct Planner entry. The previously accepted issue recommendation fixes `request_stop`, reuse of native confirmation, cancellation safety and claim release. No upstream Brainstorm manifest or unresolved product decision exists.

## Technical Design

**Design views:** Interfaces, authority data flow, state transitions and temporal sequence are material. Architecture ownership is captured in the existing Host-to-Kernel dependency direction below; there is no new service or deployment layer.

### Interface and Authority

1. Add only `{ op: "request_stop" }` to the Pi action union and dispatch it to the existing exact-operation authorizer with `stop`. Public input contains no reason, actor, capability, record hash, timestamp, confirmation flag, or arbitrary operation. Keep `request_authorization` unchanged. Runtime forged fields must never influence privileged input; use existing validation conventions rather than widening the API.
2. Use a truthful host-owned reason such as `literal user requested task stop`, independent of replan status. The digest issuer and application must receive the same exact reason and operation.
3. Require TUI capability and an exact live task owner before showing a single native confirmation. Active artifacts, frozen artifacts, unresolved findings and waiting-for-Review/replan states do not themselves disqualify stop. Existing ownership, snapshot and concurrency preconditions remain in force; do not loosen diff or CAS validation to make stop succeed.
4. Reuse native attention wrapping and cancellation signals. Show a task-specific stop decision, never a generic rework approval. Cancelling, aborting or timing out the dialog performs no stop, finding mutation, or artifact staging attributable to the request. Ready-layout test baselines exclude pre-existing transaction recovery performed by the common mutation entry.
5. After confirmation, preserve session-generation and invocation linearization, then let the Kernel revalidate record/intent/diff and consume exact user authority. Host code never directly edits TaskRecord, claim, tombstone or audit files.
6. Report success only from committed Kernel terminal evidence. Stage only the existing planning-artifact transition; never reset, delete, commit or discard implementation changes. A post-commit staging or tracker failure must be reported as such, not as proof that stop did not occur.
7. Release or invalidate any pending in-memory Review reservation after a successful terminal operation through coordinator-owned cleanup. A stale reviewer result cannot revive the task or mutate terminal evidence. Do not cancel a reservation on a rejected or cancelled stop request.

### Ordered Sequence

`public request -> exact task/admission checks -> snapshot capture -> native confirmation -> session/invocation recheck -> exact user capability -> Kernel locked CAS and terminal transaction -> planning staging and coordinator cleanup -> Tool/Rail result`.

Before commit, interruption wins without stop authority. At or after commit, durable Kernel evidence wins regardless of promise outcome. A subsequent status/recovery reads the existing terminal transaction; it never guesses settlement from elapsed time, a child acknowledgement or a rejected promise. A repeated public request against a terminal/claimless task is non-mutating and reports that there is no eligible live owner; it does not mint another capability or invent a second terminal event.

### Settlement Enumeration

| Source or state | Behavior and owner |
| --- | --- |
| Active task, active or frozen artifacts | One explicit request may enter pending confirmation; the Host only owns the pending UI. |
| Open QA/authorization invocation | Reject a competing stop before confirmation; preserve existing invocation. No queued or automatic stop. |
| Review reserved, no conflicting invocation | Stop may be confirmed; Kernel commits terminal state, coordinator invalidates its reservation afterward. |
| Confirmed, still fresh | Host wins invocation open-to-committed; Kernel alone owns active-to-stopped and claim cleanup. |
| Cancel, Escape, timeout, abort, session shutdown before commit | Invocation becomes cancelled; task and planning bytes remain unchanged by stop. Late affirmative responses are discarded. |
| Record/intent/diff/owner change during confirmation | Exact authority/CAS check rejects; preserve the competing writer's result and report one same-Host recovery action. |
| Dialog/provider/dispatch failure | No affirmative authority, hence no stop. Release only local resources owned by this invocation. |
| QA/Review completion races with stop | Existing invocation and locked record CAS select the winner. Terminal done and stopped cannot both commit. Losing continuation cannot rewrite evidence. |
| Terminal transaction interrupted | Existing recoverable transaction converges record, proof, archived artifacts and claim cleanup; do not implement another recovery protocol. |
| Post-commit UI/staging/tracker failure | Terminal record remains authoritative; report the separate delivery failure and reconcile through current status, never roll back terminal evidence. |
| Already done/stopped or foreign/missing claim | Reject the live-stop request without new authority writes; preserve owner and evidence. |

Persistent states remain TaskRecord `active|done|stopped`, artifact `active|frozen`, existing claim/workspace and terminal audit records. Local states remain invocation `open|committed|cancelled`, QA running, and Review reserved/released. No new job state or timeout policy is introduced.

### UI, Compatibility and Rollback

Use native overlay plus `immune-brain:user-attention.v1` in `try/finally`; no direct bell/Herdr invocation. Approval uses Rail `Approval required` without toast; success uses `Stopped`; ordinary cancellation has no error toast; actual failures use existing correlated errors. Footer remains empty. Existing authorization and breaking-revision APIs remain unchanged.

Rollback removes the new public branch and its contract text/tests; no data migration or compatibility bridge is needed. Already stopped tasks remain stopped under the existing Kernel schema. Partial implementation is not delivered until schema and end-to-end authorization tests pass. No package release or installed-extension reload is performed by this plan-only task.

## Acceptance and Verification

- **acc-stop-native-authority:** Registered Tool exposes the minimal action and a confirmed eligible request stops exactly its task through native user authority. Verify active and frozen/waiting variants, one overlay, host-owned reason, unchanged unrelated work, terminal proof, archived planning and released claim. Use `tests/pi-canary-user-authority.test.ts`; exercise the registered handler and real temporary repository, not a mocked successful stop return.
- **acc-stop-interruption-safety:** Cancellation, timeout, abort, session change, missing/foreign/terminal owner, concurrent operation and snapshot drift cannot create stop authority or overwrite competing state. Successful stop invalidates Review reservation; late verdict and repeat stop cannot change terminal evidence. Use the same harness file with parameterized boundary cases, preserving existing invocation and transaction tests as supporting regression evidence.
- **acc-stop-public-contract:** Schema rejects or ignores forged authority fields without trusting them, ordinary `request_authorization` remains unchanged, Loop/docs describe explicit stop separately from Host cancellation, and UI attention/notification/footer behavior stays consistent. Use `tests/imm-canary-work-contract.test.ts` and `tests/pi-canary-work-extension.test.ts`.

Descriptors use repository Bun with explicit test files, bounded output and timeouts. The existing harnesses are runnable now; implementation adds assertions that fail with the current missing entry. No acceptance suite runs during Planner validation. Executor additionally runs `bun run typecheck` and `bun test`, then Kernel freeze, deterministic QA and Review. Packed-loader/release checks remain supplemental and must not add network/package work to deterministic descriptors.

## Devil's Advocate Audit

- **Rollback resilience:** Reuse the existing stop transaction; never undo a committed stop because UI cleanup failed. Cancel and failure paths retain user work and release local invocation tokens. A partial public-only implementation is caught by actual dispatch tests.
- **Verification vanity:** Schema grep or a direct privileged helper call cannot prove reachability or consent. Require a registered Tool call, literal UI selection and real stored terminal bytes; compare before/after state for negative cases and preserve races' legitimate external writes.
- **Spec dilution detection:** Do not narrow support to parked replan tasks, substitute a chat confirmation, silently convert cancel into stop, or bypass a busy operation. Do not expand into force-kill, Review policy (#51), multi-host scheduler or Kernel redesign. Record new evidence before any scope change.
