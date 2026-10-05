# Clockless Authority and Automatic Closeout

## Status, ownership, and outcome

This is the shared candidate Spec for Initiative `clockless-authority-closeout`, a three-Slice plan. The user approved the Brainstorm manifest, the Initiative name and slug, and the three-Slice serial decomposition. Approval covers local candidate authoring/staging and one GitHub publication of the approved Parent and Children. It does not authorize implementation, Git commits/pushes, or deployment. Each Child requires its own native Enrollment before execution. Persisted documents use English; user-facing interaction remains Chinese.

Outcome: no Immune-Brain authority is bound to a wall clock. A confirmed batch stays authorized until its plan, branch, lineage, child limit or QA-failure limit says otherwise; a native gate waits until the user answers or the caller cancels; a single-step Kernel or Enrollment capability is consumed once and never lapses by time. A batch whose child finishes in the foreground, and whose branch the user fast-forwarded out of band, commits that child and settles its own record without a new gate. When the last Child of a GitHub Initiative reaches `done`, the tracker closes the Parent.

Carrier: one GitHub Parent with three native Sub-issues (repository default `Initiative carrier default: github`). Execution is serial S1 -> S2 -> S3.

**Design risk**: High. The work removes fail-closed checks from Kernel authority (`authority_port`, `enrollment_authority`, `batch_authority`), changes the shape of the batch authorization binding and of two persisted records, relaxes one lineage refusal, lets a batch commit with no fresh confirmation, and adds one class of remote write. It reverses ADR-0005 decisions 3 and 5 and ADR-0008 decision 3.

**Design views**: state transitions (batch run state, capability lifecycle, HEAD lineage), service interfaces (capability bindings, batch tool input, persisted record shapes, tracker `mark-terminal` result) and temporal sequence (terminal settlement -> batch commit -> batch terminal -> Parent close). Architecture layers and data flow are omitted: module ownership stays as ADR-0005 decision 4 defines it and no new data path is introduced.

**Diagram decision**: not_required

**Diagram reason**: each view is a short list of states or ordered steps given in prose below; no branching structure needs a picture.

**Execution posture**: test-first. Every Slice removes or relaxes a guard, so the tests that pin the new boundary (what still refuses) are written before the runtime change.

## Evidence and discovery closure

Motivating run, read from Pi session `01a104f3-3aec-72e1-875c-d1b229186c78` (Initiative Parent #126, PR #134):

- The batch was confirmed on 2026-10-03 11:55 with the default eight-hour budget. Slice S7 parked on a foreground Review rework decision; `authorization_expires_at` and `budget.deadline_at` lapsed at 19:54, so resume could only open a new native gate.
- The reopened gate was not answered inside the confirmation window and returned `confirmation_timed_out`.
- An out-of-band user commit (`ee2a016`) had advanced the batch branch past the recorded head `24c0b66`; the runner classified it as fatal `batch_head_lineage_broken`.
- S7 was committed by hand, the batch record was left `failed` / `needs_human`, and the Parent was closed by hand after the PR merged.

Current behavior, read from source:

- Single-step capabilities: `plugins/immune-brain/runtime/kernel/authority_port.ts` and `enrollment_authority.ts` require `expires_at` later than `issued_at` and refuse a capability whose `expires_at` has passed. Hosts issue them with a ten-minute expiry in `runtime/claude/kernel_ports.ts`, `.pi-extension/imm-canary-enroll.ts` and `.pi-extension/imm-canary-work.ts`. `AuthorityAuditDescriptor.expires_at` (`runtime/kernel/types.ts`) is written into TaskRecord history and required by `runtime/kernel/validation.ts`; `runtime/kernel/legacy_task_record.ts` is the frozen pre-v4 reader. `runtime/kernel/canary_eligibility.ts` carries the field.
- Confirmation window: `runtime/unattended/confirmation_deadline.ts` (`IMMUNE_BRAIN_BATCH_TIMEOUT_MS`), used by both batch gates (`runtime/claude/kernel_ports.ts`, `.pi-extension/imm-unattended-batch.ts`) and reported through `confirmation_timed_out` in `runtime/unattended/batch_reasons.ts`.
- Batch authorization: `budget.deadline_at` and the binding `expires_at` are produced in `runtime/unattended/batch_plan.ts` and `batch_preflight.ts`, validated in `runtime/kernel/batch_authority.ts`, persisted by `runtime/unattended/batch_state.ts` (`authorization_expires_at`, `budget.deadline_at`), enforced in `runtime/unattended/batch_runner.ts` (`budgetStopReason`, expiry renewal, the per-child clock check) and rendered by `runtime/claude/interaction.ts`, `runtime/claude/mcp_server.ts` and the Pi gate summary. Preflight blockers `batch_authorization_expired` and `batch_budget_expired` force a new gate.
- Lineage: `batch_runner.ts` (`externalHeadDriftMessage`, `validatePersistedRun`), `batch_git.ts`, `batch_preflight.ts` (`batch_head_lineage_moved`), `runtime/kernel/batch_authority.ts` and `runtime/kernel/enrollment.ts` require HEAD to equal the recorded head exactly. `scripts/verify-batch-completion.ts` reports `lineage_mismatch`.
- Closeout: after a foreground child reaches a terminal state the runner returns a handoff telling the caller to invoke `start_unattended_batch` again. `resumeBatch` / `driveInterruptedChild` already settle and commit that child through the batch's own commit path once called. Terminal tracker projection is wired in `runtime/assurance/coordinator.ts`, `runtime/claude/kernel_ports.ts` and `.pi-extension/runtime-stub.ts`.
- Parent: `runtime/github_issue_tracker.ts` renders "the tracker never changes or closes it automatically" into the Parent body and `markTerminal` closes only the Child. `plugins/immune-brain/dist/imm-planner.md` and `docs/agents/issue-tracker.md` state the same contract.

Mirrors and consumers: `plugins/immune-brain/dist/claude/mcp-server.mjs` inlines the runtime (`bun scripts/build-claude-plugin.ts`); `tests/fixtures/workflow-decision-closure-evidence.json` hash-binds the Planner contract; `README.md`, `CONTEXT.md` (HEAD Lineage) and `docs/agents/pi-batch-acceptance.md` describe the retired behavior. Archived Specs, frozen audit records and existing TaskIntents are bound by content identity and are not edited.

## Brainstorm Trace

| ID | Approved requirement/decision | Coverage |
| --- | --- | --- |
| BR-REQ-1 | Remove every clock check on batch authorization and budget deadline | S1 (CAC-S1-A3) |
| BR-REQ-2 | Remove the native confirmation window and its environment variable, identically on both Hosts | S1 (CAC-S1-A2) |
| BR-REQ-3 | Remove the ten-minute expiry of single-step Kernel and Enrollment capabilities | S1 (CAC-S1-A1) |
| BR-REQ-4 | A batch child completed in the foreground is committed automatically; the batch record settles and reports | S2 (CAC-S2-A2) |
| BR-REQ-5 | Close the Parent as Completed when every Child is `done` with no claim; otherwise keep it Open | S3 (CAC-S3-A1) |
| BR-DEC-1 | Lineage tolerates only fast-forward out-of-band commits; divergence, rewritten history and a branch switch stay fatal | S2 (CAC-S2-A1) |
| BR-DEC-2 | New writes omit expiry fields; old records and frozen audit stay readable; no migration | S1 (CAC-S1-A1 for TaskRecord, CAC-S1-A3 for batch state) |
| BR-DEC-3 | Rewrite ADR-0005 D3/D5, ADR-0008 D3 and its rejected alternative, and the Parent template text | S1 (ADR-0005 D3, ADR-0008 D3), S2 (ADR-0005 D5), S3 (Parent text) |
| BR-OUT-1 | No automatic push, pull request or merge | Out of scope; ADR-0005 D6 unchanged |
| BR-OUT-2 | No automatic changeset generation | Out of scope |
| BR-OUT-3 | No schema migration and no rewrite of historical audit or Git history | Out of scope |

Remaining gap after all three Slices: none against the manifest.

## Technical design

### Common invariants

- Removing a clock never widens what a confirmation covers. A batch authorization still binds `plan_digest`, branch, HEAD lineage, `max_children` and `qa_failure_limit`; a single-step capability still binds its task, operation, record hash and nonce and is still single-use.
- Authority stays process-local and is rebuilt from durable facts on resume (ADR-0008 decision 1). Nothing durable gains authority in this Initiative.
- This is retirement-class work: the clock source and its contract text are deleted. No retirement wall, no absence assertion standing in for a deletion.
- Readers stay tolerant, writers become strict: a persisted record that still carries an expiry field loads and behaves as if the field were absent; nothing written after S1 carries one. `legacy_task_record.ts` and frozen audit are untouched.

### S1: authority clocks

Capability lifecycle after S1: `issued -> consumed` (single use) or `issued -> discarded` (process exit, caller cancellation, or binding mismatch). There is no `expired` state.

- Kernel: `expires_at` leaves the capability binding types and the issue/validate paths in `authority_port.ts`, `enrollment_authority.ts`, `batch_authority.ts` and `canary_eligibility.ts`. `AuthorityAuditDescriptor.expires_at` becomes optional on read and is never written; `validation.ts` accepts its absence and still rejects unknown fields.
- Gates: `confirmation_deadline.ts`, `IMMUNE_BRAIN_BATCH_TIMEOUT_MS` and the `confirmation_timed_out` reason are deleted. A gate settles only on the literal user's answer or on the caller's cancellation signal; cancellation is a refusal that leaves batch state, commits, index and any enrolled child unchanged.
- Batch: `deadline_at` leaves `BatchBudget` and the tool input, `expires_at` leaves the batch binding, and `authorization_expires_at` leaves the state written by `batch_state.ts`. `budgetStopReason` keeps only the child and QA-failure limits. The blockers `batch_authorization_expired` and `batch_budget_expired`, the expiry renewal comparison and the default eight-hour deadline are deleted. A persisted batch record carrying the old fields validates and resumes; the fields are ignored and dropped on the next write. A reconfirmation is still required to be newer than the confirmation it replaces, compared by confirmation time, not by expiry.
- Gate rendering on both Hosts shows the remaining bounds only.
- ADR-0005 decision 3 no longer lists an authorization expiry in the batch record. ADR-0008 decision 3 is replaced: a parked batch keeps its authorization for as long as plan, branch and lineage hold; the rejected alternative about widening the window is removed as moot. The reason recorded is the user's decision that a time bound only converts a slow human decision into a second confirmation without protecting anything the other bindings do not.

### S2: batch closeout

HEAD lineage after S2, evaluated wherever the recorded head is compared today:

- `equal`: HEAD is the recorded head. Proceed.
- `fast_forward`: same batch branch, recorded head is an ancestor of HEAD, and every recorded child commit is still reachable. Adopt HEAD as the new expected head, record the adoption in the batch run state, proceed without a gate.
- anything else (different branch, recorded head not an ancestor, a recorded child commit unreachable, detached HEAD): fatal `batch_head_lineage_broken`, as today.

An adopted commit is the user's own work: the runner never attributes it to a child, never inspects it against a child's scope, and never rewrites it. A commit the batch produces still parents on the then-current expected head. The dirty-scope refusal for Enrollment and the commit-scope check for the batch's own commits are unchanged; they are what stops an out-of-band change from leaking into a child commit.

Closeout sequence when a batch child reaches Kernel `done` in the foreground:

1. The Kernel terminal mutation commits and its tracker projection runs, as today.
2. The Host, in the same tool call, re-enters the shared `startBatch` with a capability rehydrated from durable facts under ADR-0008 decision 1. No gate opens when the reuse blockers are clear.
3. The runner commits the child through its existing commit path, writes production evidence, and continues: it enrolls the next child, or, when none remains, moves the record to `completed` and returns the report.
4. A foreground Review reservation, a parked child or a stopped child ends the sequence where it does today.

Settlement enumeration for S1 and S2:

- Trigger sources: child terminal mutation (`done`, stopped, parked), user answer at a gate, caller cancellation, process crash/restart, plan drift, branch change, lineage break, child limit reached, QA-failure limit reached, commit failure. Removed: authorization expiry, budget deadline, confirmation timeout.
- State inventory: batch run `running -> completed | failed | stopped` with `needs_human` as today; child run `pending -> enrolled -> committed`, or `skipped` / `stopped`. No state is added. The lineage classification above is a guard, not a state.
- Terminal ownership: a child is terminal only by its Kernel TaskRecord and tombstone. The batch record is settled only by `runtime/unattended/batch_runner.ts` under the state lock. A Host re-entering `startBatch`, a resolved promise, elapsed time and tracker output are not authoritative.
- Same-state-machine coverage: `batch_runner.ts`, `batch_git.ts`, `batch_preflight.ts`, `batch_state.ts`, `batch_plan.ts`, `runtime/kernel/batch_authority.ts`, `runtime/kernel/enrollment.ts`, both Host batch adapters and `scripts/verify-batch-completion.ts`.

Idempotency: step 2 after a crash at any point is the existing resume; an existing own commit is adopted rather than replayed. A failure in steps 2-3 never alters the Kernel result of step 1; it is reported beside it with one retry action (`start_unattended_batch`).

ADR-0005 decision 5 is rewritten: a plan that drifts is refused; a HEAD that fast-forwards on the batch branch is adopted; any other HEAD movement is refused.

### S3: Parent close

`mark-terminal` gains one step after it closes a Child as completed: from Issue-scoped reads (the Parent and its Sub-issue list, no repository listing) decide whether every Sub-issue carrying a Slice marker of this Initiative is closed as completed. If so, close the Parent as completed. Otherwise leave it open.

- A Child closed as stopped or not planned, an open Child, or a parked Child keeps the Parent open.
- A Parent that is already closed is a no-op. A rerun of the same `mark-terminal` performs no second write.
- A failed Parent read or close is reported as tracker observation beside the Kernel result and never changes it; the retry is the same `mark-terminal`.
- The Parent body sentence becomes a statement that the tracker closes the Parent when every Slice Child is completed. `dist/imm-planner.md` keeps "the Planner never closes the Parent" and states that terminal projection does. `docs/agents/issue-tracker.md` matches.
- The tracker result contract identifier and Kernel authority are unchanged: Issue state is still observation, never authority.

## Compatibility and rollback

- Each Slice is one batch commit and reverts independently in reverse order. Reverting S1 after new records were written requires the old reader to accept a missing `expires_at`; this is why S1 makes readers tolerant in both directions inside the Slice rather than relying on revert.
- A batch record written before S1 resumes after S1. A batch record written after S1 is not expected to resume on a pre-S1 runtime.
- A caller that still sends `budget.deadline_at` gets the input parser's existing unknown-field behavior.
- No TaskIntent schema, TaskRecord schema version or tracker marker format changes.

## Devil's Advocate Audit

- Rollback resilience: a partial S1 that removes Host issuance but not Kernel validation fails every Enrollment immediately and visibly, not silently; the acceptance runs Kernel and both Host suites together for that reason. A partial S2 that adopts fast-forward heads but does not wire the Host re-entry degrades to today's manual `start_unattended_batch`. A partial S3 leaves the Parent open, which is today's behavior.
- Verification vanity: deleting clock tests would make any suite pass. Each acceptance therefore names the surviving negative controls: a consumed or mismatched capability still refuses; plan drift, branch change and the two remaining limits still stop a batch; divergence, rewrite and branch switch still break lineage; a stopped or open Child still keeps the Parent open. The Claude bundle check proves the shipped artifact matches source.
- Spec dilution: the three clocks, both Hosts, legacy readability, the ADR rewrites, lineage adoption, gate-free closeout and Parent close each map to exactly one acceptance in the trace above. BR-OUT items stay out; ADR-0005 decision 6 is not touched.

## Acceptance and test mapping

| Acceptance | Seam | Positive / negative / bound controls |
| --- | --- | --- |
| CAC-S1-A1 | `tests/kernel-enrollment-authority.test.ts`, `tests/kernel-canary-authority.test.ts`, `tests/kernel-record-v4.test.ts`, `tests/claude-host-authority.test.ts`, `tests/pi-canary-user-authority.test.ts` | capability usable long after issue / second use and binding mismatch refuse / record with and without `expires_at` both load, new record has none |
| CAC-S1-A2 | `tests/claude-batch-authority.test.ts`, `tests/pi-batch-authority.test.ts`, `tests/unattended-contracts.test.ts` | late answer accepted / cancellation refuses with state unchanged / no timeout reason or environment variable remains |
| CAC-S1-A3 | `tests/kernel-batch-authority.test.ts`, `tests/unattended-batch-run.test.ts`, `tests/unattended-batch-plan.test.ts`, `tests/batch-plan-reconfirmation.test.ts`, `tests/claude-host-package.test.ts` | parked batch resumes with no gate after any delay / plan drift, branch change, child limit and QA-failure limit still stop / old-shape record resumes and is rewritten without expiry fields |
| CAC-S2-A1 | `tests/unattended-batch-commit.test.ts`, `tests/kernel-batch-authority.test.ts`, `tests/batch-completion-verifier.test.ts` | fast-forward adopted / divergence, rewrite, branch switch, unreachable child commit refuse / adopted commit never attributed to a child |
| CAC-S2-A2 | `tests/unattended-batch-run.test.ts`, `tests/claude-batch-authority.test.ts`, `tests/pi-batch-authority.test.ts`, `tests/dual-host-assurance-conformance.test.ts`, `tests/claude-host-package.test.ts` | last child done -> commit and `completed` with no gate / Review reservation, parked and stopped child do not close out / re-entry after crash creates no second commit |
| CAC-S3-A1 | `tests/plugin-package-runtime.test.ts`, `tests/github-issue-projection-contract.test.ts`, `tests/github-initiative-recovery.test.ts`, `tests/workflow-behavior-evidence.test.ts`, `tests/carrier-enrollment-gate-contract.test.ts`, `tests/skill-dist-consistency.test.ts`, `tests/claude-host-package.test.ts` | all Children completed -> Parent closed once / open, stopped or parked Child keeps Parent open / rerun and already-closed Parent write nothing |

Every descriptor runs `bun test` on tracked test files with the repository's installed dependencies; no descriptor installs packages, uses the network or performs a real remote write (the tracker tests use the fake `gh` transport).

## Out of scope

Automatic push, pull request or merge; automatic changeset generation; schema migration; edits to frozen audit, archived Specs or Git history; the per-call `gh` timeout; QA descriptor `timeout_ms`; Review soft deadlines in `runtime/assurance/coordinator.ts`.
