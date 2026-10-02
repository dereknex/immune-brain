# Batch execution and recovery

**Status**: candidate; planning and GitHub projection only, not execution authority.
**Initiative**: 批次执行与恢复闭环
**Immutable slug**: `batch-execution-recovery`
**Carrier**: GitHub, from the repository root `AGENTS.md`.
**Document language**: English; user-facing discussion remains Chinese.
**Design risk**: High — this changes a cross-host orchestration boundary and recovery of persisted Batch Authorization, while preserving Kernel authority.
**Execution posture**: characterization-first — extend existing behavioral tests with the observed failure before changing the runner or host adapters.
**Design views**: architecture layers, component interfaces, data flow, state transitions, and temporal sequence; all affect authority or interrupted execution here.
**Diagram decision**: required
**Diagram reason**: the Parent/Tool handoff and the distinction between a normal return and a parked batch materially clarify when implementation, QA, confirmation, and commit may occur.

## Outcome and approved boundaries

A serial batch must implement each enrolled child before requesting deterministic QA; a parked batch with expired authorization and budget can resume after one fresh native confirmation; a failure returns its actual obligation and one legal recovery action rather than a generic human-decision message.

The user approved the complete Initiative and S0 → S1 → S2 dependency chain. These are independently verifiable outcomes, not separate read/edit/test authority Steps. Every slice is `material` and requires the existing deterministic QA and foreground Review path. Planner produces candidates and the complete GitHub projection only. Starting execution still requires an explicit execution request and the current Host's native authority boundary.

| Slice | Task ID | Independently verifiable result | Prerequisite |
| --- | --- | --- | --- |
| S0 | `batch-execution-recovery-s0-renewal` | A parked batch with both deadlines expired receives a genuinely usable, freshly confirmed authorization without weakening rejection or drift checks. | None |
| S1 | `batch-execution-recovery-s1-executor-handoff` | Enrollment returns a foreground Executor obligation, not immediate QA; Parent implementation and Assurance precede settlement, one scope-bound commit, and the next child. | S0 |
| S2 | `batch-execution-recovery-s2-failure-recovery` | Failure presentation follows fresh Kernel obligations and finding identities, exposes safe check diagnostics, and enables repair without confusing it with user authorization. | S1 |

### Out of scope

- Welltold implementation, its existing S0, or any state changes in that workspace.
- Kernel core/reducer/storage/schema rewrites, manual authority writes, new execution authority, or replacement of the existing Assurance state machine.
- Generic scheduling frameworks, runtime-owned model invocation, reviewer receipt synthesis, detached/background execution, polling, or default parallel Managed tasks.
- Automatic native-gate retries, automatic deadline renewal, push/PR/release/deploy, installed-plugin edits, dependency/lockfile changes, or persistent raw verifier stdout/stderr.
- A second planning carrier, speculative configuration, permanent compatibility adapters, or general documentation cleanup.

## Discovery evidence and reference closure

The initiating observation is Pi session `01a0f7a6-e2d2-71c3-91e9-948e2aa2d204`: QA ran without implementation; a resume reused an expired budget deadline; local green did not resolve the two open QA findings. This is failure evidence, not authority over that project's task. The local analysis is recorded as `docs/reports/pi-session-home-card-visual-alignment.md` and is not a runtime dependency.

| Surface | Concrete source and consumer paths | Why they matter |
| --- | --- | --- |
| Batch plan, renewal, and continuation | [batch_plan.ts](../../plugins/immune-brain/runtime/unattended/batch_plan.ts), [batch_preflight.ts](../../plugins/immune-brain/runtime/unattended/batch_preflight.ts), [batch_runner.ts](../../plugins/immune-brain/runtime/unattended/batch_runner.ts), [batch_state.ts](../../plugins/immune-brain/runtime/unattended/batch_state.ts), [types.ts](../../plugins/immune-brain/runtime/unattended/types.ts), [batch_reasons.ts](../../plugins/immune-brain/runtime/unattended/batch_reasons.ts) | Preflight currently projects a persisted budget; shared authorization decides reuse/confirmation; both normal and interrupted runner paths can immediately advance QA. These owners must agree on normal handoff versus a genuine park. |
| Confirmation and Git effects | [confirmation_deadline.ts](../../plugins/immune-brain/runtime/unattended/confirmation_deadline.ts), [batch_git.ts](../../plugins/immune-brain/runtime/unattended/batch_git.ts), [batch_authority.ts](../../plugins/immune-brain/runtime/kernel/batch_authority.ts) | Bounded gate behavior, confirmed identity and deadline, child consumption, lineage, crash recovery, and scope-bound commits must stay fail-closed and idempotent. The Kernel file is an invariant/test reference, not permission to rewrite Kernel core. |
| Pi entry and presentation | [imm-unattended-batch.ts](../../plugins/immune-brain/.pi-extension/imm-unattended-batch.ts), [runtime-stub.ts](../../plugins/immune-brain/.pi-extension/runtime-stub.ts), [imm-canary-work.ts](../../plugins/immune-brain/.pi-extension/imm-canary-work.ts), [pi-canary-assurance-progression.ts](../../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts) | The registered foreground tool exposes the shared result; the Parent, not the callback, executes Agent work and handles Review. The runtime stub carries shared report values. |
| Claude entry and presentation | [kernel_ports.ts](../../plugins/immune-brain/runtime/claude/kernel_ports.ts), [mcp_server.ts](../../plugins/immune-brain/runtime/claude/mcp_server.ts), [review_host.ts](../../plugins/immune-brain/runtime/claude/review_host.ts) | Claude must expose the same shared obligation and gate facts, while retaining Host-attested Review identity. Its generated bundle inlines runtime changes. |
| Assurance and safe diagnostics | [qa.ts](../../plugins/immune-brain/runtime/assurance/qa.ts), [coordinator.ts](../../plugins/immune-brain/runtime/assurance/coordinator.ts), [host_port.ts](../../plugins/immune-brain/runtime/assurance/host_port.ts), [verification.ts](../../plugins/immune-brain/runtime/assurance/verification.ts) | QA already distinguishes preparation errors and publishes ordered progress without raw output. The coordinator owns fresh projections and structured Review reservations; lower-level verification owns execution/cleanup and remains unchanged unless tracing proves a need. |
| Report consumers and replay | [unattended-batch-run.test.ts](../../tests/unattended-batch-run.test.ts), [unattended-batch-commit.test.ts](../../tests/unattended-batch-commit.test.ts), [unattended-contracts.test.ts](../../tests/unattended-contracts.test.ts), [pi-batch-authority.test.ts](../../tests/pi-batch-authority.test.ts), [claude-batch-authority.test.ts](../../tests/claude-batch-authority.test.ts), [dual-host-assurance-conformance.test.ts](../../tests/dual-host-assurance-conformance.test.ts) | These exercise every identified shared report consumer, both host entries, persisted recovery, and commit ordering. Update assertions that currently protect immediate-QA behavior rather than keeping contradictory tests. |
| Packaged contracts | [imm-loop.md](../../plugins/immune-brain/dist/imm-loop.md), [executor.md](../../plugins/immune-brain/runtime/prompts/executor.md), [packaged executor.md](../../plugins/immune-brain/dist/role-prompts/executor.md), [README.md](../../plugins/immune-brain/README.md), [dist-sync-manifest.ts](../../scripts/dist-sync-manifest.ts) | `dist/imm-loop.md` is its own contract source; the role prompt has a generated mirror. Describe foreground continuity accurately rather than promising runtime-autonomous implementation. |
| Architectural constraints | [CONTEXT.md](../../CONTEXT.md), [ADR-0006](../adr/0006-unattended-review-dispatch-authority.md) | Shared unattended runtime owns transitions; hosts are callers. ADR-0006 forbids runtime reviewer invocation or synthesized receipts. Its description of every Review return as a park is older than the current runner's running `review_ready` return; S1 updates that description without changing the independence decision. The unrelated CONTEXT artifact-relocation wording is not authority and is not corrected in this work. |

The affected value is a non-authoritative batch report/handoff, not a new persisted child lifecycle. Producer and consumers are `batch_runner.ts` / `batch_state.ts`, both Host adapters and their presentation, the Pi runtime stub, and the six report/commit/contract/conformance test files above. Existing state parsing, terminal replay, and both normal/interrupted child paths must retain historical readability. Do not introduce a new persisted state or version gate for an ordinary foreground handoff.

## Technical Design

### Architecture and authority invariants

1. The shared unattended runtime owns the Batch Plan, budget, authorization reuse decision, persisted transitions, and Git commit orchestration. Both Hosts render its facts and return its result; neither reconstructs a second state machine.
2. The current Host Parent owns implementation and foreground role dispatch. A Tool callback cannot cause the Parent to call Agent inside that same callback. Runtime-owned models or an out-of-process executor/reviewer service are not substitutes.
3. The Kernel alone owns Enrollment, TaskRecord, finding disposition, deterministic QA attestations, Review attribution, terminal settlement, and release of the claim. A batch report is observation, never a readiness certificate.
4. Fresh projection, confirmed intent identities, plan digest, own-claim provenance, branch, and HEAD lineage stay authoritative. GitHub state, local green, an empty diff, a cached result, or a handoff acknowledgment cannot substitute for QA or completion.
5. A normal foreground return remains `running` with the same child `enrolled`; `needs_human` remains a genuine park. No new user gate is required merely because the Parent performs implementation or dispatches a reserved reviewer.
6. Expiry prevents new child Enrollment under the old grant. An already enrolled own child retains its Kernel-owned repair/Assurance/settlement obligations; expiry does not discard its claim or authorize another child.
7. Each completed child is committed exactly once through the existing scope-bound batch Git port. Adoption after a crash verifies commit identity and lineage. The runner never commits unassured work, stages user changes broadly, or pushes.
8. The Pi Footer stays empty. Present progress through existing Tool updates/Task Rail, not non-empty `setStatus` calls.

### S0: confirmed renewal

- Read the parked record and reconstruct its remaining ordered child identities using existing shared preflight. Keep `max_children`, `qa_failure_limit`, consumed child accounting, branch, batch ID, and plan identity; do not reset completed work or counters to manufacture a fresh batch.
- When a genuine parked resume needs fresh confirmation and the persisted execution deadline has expired, project a new future deadline using the existing default budget duration. Invalid timestamps fail loudly. A still-future deadline is not silently extended.
- The native gate displays the proposed deadline, authorization expiry, remaining children, exclusions, and reuse blockers before confirmation. This read-only projection makes no authorization, state, branch, or TaskRecord writes.
- Accept only a real current-Host confirmation. Re-read time after the gate and revalidate cancellation, own claim, plan/intent identity, HEAD, and branch before issuing authority or changing the persisted budget. If the displayed window expired while waiting, reject; never hide a further extension after the user's decision.
- Issue authority against the same facts the user saw. Persist the accepted budget with the existing authorized resume transition; an issuance or revalidation failure cannot leave a renewed persisted budget behind. Decline, cancel, timeout, malformed time, and identity drift preserve pre-existing bytes and authority.
- Cover both expired fields together, not merely an expired `authorization_expires_at` with a still-valid `budget.deadline_at`.

### S1: foreground execution and continuation

```mermaid
sequenceDiagram
    participant User
    participant Parent as Host Parent
    participant Batch as Shared batch runtime
    participant Kernel
    User->>Parent: Native batch confirmation
    Parent->>Batch: Start with confirmed identities and budget
    Batch->>Kernel: Enroll next unblocked child
    Kernel-->>Batch: Own enrolled child
    Batch-->>Parent: running + Executor handoff (no QA yet)
    Parent->>Parent: Route Executor; implement and focused checks
    Parent->>Kernel: Advance Assurance (freezes internally; deterministic QA)
    alt QA rework
        Kernel-->>Parent: Fresh findings and next obligation
        Parent->>Parent: Repair and disposition verified findings
        Parent->>Kernel: Fresh Assurance
    end
    opt Material/critical Review obligation
        Kernel-->>Parent: Foreground Review reservation
        Parent->>Parent: Dispatch independent reviewer
        Parent->>Kernel: Submit exact structured verdict
    end
    Kernel-->>Parent: Kernel terminal settlement
    Parent->>Batch: Continue same batch after fresh binding checks
    Batch->>Batch: Verify settlement; scope-bound commit exactly once
    Batch-->>Parent: Next child handoff or terminal report
```

- On successful fresh Enrollment, return the exact child ID/run identity and a structured, non-authoritative Executor handoff in the foreground report. Do not call `advanceTask` first. Parent executes the existing Loop `step` route, in the current context or the returned allowed role envelope; it is not a new durable Plan/Step.
- Reuse the current `reportFor`-style nonterminal return. Do not persist a terminal report for a normal handoff, introduce an executor-completed Boolean into authority, or require an extra acknowledgment parameter to manufacture readiness.
- Parent performs implementation, scoped staging and local checks, then the existing Kernel Assurance path. Automatic freeze remains inside `advance_assurance`. Material/critical Review still uses a Host-attested foreground reservation, one reviewer call, and explicit verdict submission. Rework verdict submission precedes edits to a frozen delivery.
- Both normal and interrupted-child paths project current Kernel state before advancing. An active child still needing implementation or QA repair returns to Parent rather than blindly rerunning the same unchanged descriptor. An open Review reservation is preserved and returned, never recreated merely on a retry.
- On continuation, a proven own running batch with valid authorization and unchanged bindings reuses the grant, without converting the handoff into `needs_human` or opening a redundant gate. A real park, expiry, lost binding, foreign claim, or lineage change uses the existing rejection/confirmation rule, never silent renewal.
- Only fresh terminal settlement permits commit and the next child. A local test pass or a Parent return is not sufficient. A crash after Enrollment recovers the same child; after settlement it resumes the commit obligation; after commit it adopts the verified existing commit rather than duplicating it.
- Host input remains the existing Initiative entry unless implementation tracing proves a schema change necessary. Extend shared report output additively with optional, derived handoff information; missing data in older reports is not execution readiness. Preserve existing terminal report replay and readable historical batch state without a compatibility bridge or migration.
- Update the Loop contract, Executor prompt and its generated mirror, the plugin's batch capability description, and ADR-0006's obsolete park-only narrative. Do not change its foreground independent Review decision.

### S2: precise recovery and safe diagnostics

- Derive recovery from the fresh Kernel `next_obligation`, blocking finding IDs, unresolved user decisions, preparation failure classification, and authorization/binding checks. Return one next action plus the concrete task/acceptance/finding identities it requires. Shared runtime determines classification; Hosts must render the same result.
- Technical rework returns a foreground repair obligation under the existing child claim, not a claim that the user must approve the repair. A genuine user decision, broken authority binding, stop, or expired parked grant remains a native-gated exception. Environment failures identify the failed phase and affected checks; do not relabel them as assertion failures.
- After repair, Parent resolves only findings whose actual cause was fixed and verified, or uses the existing counterevidence-bound refutation path when appropriate. Never mass-resolve on local green, suppress a failing check, change the accepted Spec to fit output, or infer all findings are closed from one passing descriptor. Run fresh Kernel QA and any required Review before settlement.
- QA Tool results/updates expose bounded allowlisted metadata: acceptance identity, descriptor reference/digest, stage (`resolution`, `prepare`, `check`, or `integrity`), outcome (exit/timeout/output-limit/launch/cleanup/integrity), elapsed time and byte counts when available. Reuse `QaPreparationError` and existing QA progress seams. Do not expose raw command arguments/environment values or arbitrary error text that could carry credentials.
- The descriptor reference identifies the canonical check in the TaskIntent so the Parent can inspect that check directly, without searching unrelated sessions or filesystem logs. A local diagnostic rerun is explicitly non-attesting; only deterministic QA against the bound delivery can produce acceptance evidence.
- Never put verifier stdout/stderr in findings, TaskRecord, audit evidence, or tracker projection, even after redaction. No new raw-output cache, persistent diagnostic directory, or log-retention mechanism is introduced.

### Alternatives and compatibility

- Reject a runtime-invoked Agent/model: it changes the Host authority boundary and requires a second execution framework.
- Reject immediate QA plus a retry loop: it does no implementation and repeats unchanged failures.
- Reject re-confirming every ordinary handoff: a still-valid bound Batch Authorization already covers serial continuation; genuine parks retain their gate.
- Reject automatic expiry renewal: it authorizes time/budget the user did not see.
- Prefer derived report metadata and existing persisted states over new lifecycle versions or an executor acknowledgment field. Historical records remain readable; no migration, dual writer, or permanent compatibility layer is needed.

## Verification and acceptance mapping

Each slice has one coherent acceptance assertion and one focused v2 descriptor. All described checks are post-implementation obligations, not claims that Planner ran or passed acceptance. Reuse the highest existing behavioral seams and add regression cases there; do not replace behavioral coverage with text presence or a mock that only returns `completed`.

| Acceptance | Focused existing seams | Required regression evidence |
| --- | --- | --- |
| S0 / `BER-S0-A1` | `tests/pi-batch-authority.test.ts`, `tests/claude-batch-authority.test.ts` | Start from a real persisted `needs_human` record with both deadline fields expired; both Hosts display future gate facts and resume the same batch/remaining child chain after confirmation. Decline/cancel/timeout/drift/malformed time remain zero-write. Test the shared path rather than patching only one adapter. |
| S1 / `BER-S1-A1` | `tests/unattended-batch-run.test.ts`, `tests/pi-batch-authority.test.ts`, `tests/claude-batch-authority.test.ts` | A two-child fixture starts without implementation. Verify no QA before the first handoff; the test drives a real minimal tracked implementation and deterministic QA/Kernel settlement before each child commit. A mock `advanceTask=completed` alone is insufficient. Assert both Host-visible handoffs, own-grant reuse, foreign/expired binding refusal, and crash/commit recovery. Preserve required Review attribution with the existing Host-attested test seam. |
| S2 / `BER-S2-A1` | `tests/shared-deterministic-qa.test.ts`, `tests/host-neutral-assurance-coordinator.test.ts`, `tests/unattended-batch-run.test.ts`, `tests/pi-batch-authority.test.ts`, `tests/claude-batch-authority.test.ts` | Inject QA rework and an environment failure. Assert exact obligation/finding identities, no unchanged QA spin, no native gate for ordinary own-claim repair, no completion while findings remain open, repair → disposition → fresh QA/Review → settlement, and matching safe output on both Hosts. Inject secret-looking stdout/stderr and ensure report/finding/audit metadata never contains them. |

### Descriptor execution provenance

- Executables: `bun` and the fixture's `git` are provided by the QA host; test and runtime code come from the tracked delivery. No network or dependency installation is part of a descriptor.
- Dependencies: the shared runtime uses Bun/Node built-ins. Existing Pi host-entry tests import host-provided peer packages; make their delivery seam conditional on a real import failing, following `tests/pi-canary-work-extension.test.ts`, and restore mocks with `afterAll`. Never unconditionally mock a real Host package or rely on the live worktree's `node_modules`/absolute host installation paths. The existing authority test files themselves own this adjustment.
- Setup: none (`environment.prepare` absent). Repository writable paths: none. Test fixtures create and clean their own temporary repositories outside the tracked delivery. No generated repository output or declared writable directory is needed for QA.
- Limits: S0 uses a 120-second / 128-KiB command budget; S1 and S2 use 180-second / 192-KiB budgets over explicit file arguments. If measured post-implementation output/time exceeds those budgets, adjust through the accepted Intent revision path, not by weakening coverage or silently running an unbounded suite.
- Regenerate `plugins/immune-brain/dist/claude/mcp-server.mjs` after inlined runtime changes; regenerate the Executor prompt mirror for S1. Bundles and affected contract mirrors are in the relevant mutation envelopes. Build/mirror checks and `bun run typecheck` are Executor/CI regression work, not acceptance descriptors.
- Additional impacted regression tests are named in `scope_hint`: batch plan/authority/commit/contracts, dual-host conformance, foreground Assurance observability and descriptor privacy, plus packaged Loop/prompt contracts. Update or retire only assertions protecting the replaced behavior; retain their continuing boundary coverage.

## Interruption recovery and rollback

No slice writes a TaskRecord by hand, discards an active claim, resets a parked batch as a new batch, or rewrites audit history. Partial implementation remains in the accepted TaskIntent; fresh projection controls recovery. Bound Spec bytes remain in place and must not change between child settlements without the proper revision/replan decision.

S0 is independently reversible by reverting its local source/test/bundle changes; accepted authority keeps the recorded user-confirmed deadline and is never retroactively rewritten. S1 rollback removes the new foreground handoff behavior only after any active child is settled/stopped through its original Kernel path; persisted batch states stay the existing shape, so no data downgrade is required. S2 rollback removes derived presentation metadata without altering findings, attestations, or settlement evidence. Never restore old unsafe behavior while silently advancing an active child.

Temporary fixtures/probes are test-owned and cleaned at test completion. Owner of implementation/mirror cleanup is the Executor for the relevant slice. No compatibility adapter or deferred cleanup TODO is a completion deliverable.

## Devil's Advocate Audit

- **Rollback resilience**: a return from a Tool is not a lost claim. Recovery tests cover Enrollment, settlement-before-commit, and commit-before-state-write boundaries. State owner and commit identity checks remain intact across all slices.
- **Verification vanity**: new tests must fail on stale-deadline reuse and immediate-QA behavior. S1's core fixture performs an actual implementation and QA transition; mocked terminal reports or documentation assertions alone cannot satisfy it. Host presentation tests supplement, not replace, that fixture.
- **Spec dilution detection**: retain every approved slice, refusal path, independent Review, exact finding disposition and safe-output constraint. Do not replace a required assertion with a looser visual/text test, automatic finding closure, or broad user-approved scope. Kernel/core rewrites and runtime-owned Agents remain excluded even if they would make a happy-path demo shorter.

## Brainstorm Trace and planning handoff

Direct Planner entry; no upstream Brainstorm manifest exists for this proposal, so there are no unresolved `BR-Q-*` items. The complete Initiative name, slug, S0/S1/S2 results, material risks, dependencies and serial order were presented and explicitly confirmed by the user. Foreground Parent handoff, no Kernel core rewrite and no persistent raw-output storage preserve that approved framing.

Canonical candidates:

- [S0 TaskIntent](../plans/batch-execution-recovery-s0-renewal.intent.json)
- [S1 TaskIntent](../plans/batch-execution-recovery-s1-executor-handoff.intent.json)
- [S2 TaskIntent](../plans/batch-execution-recovery-s2-failure-recovery.intent.json)

All three bind this single active Spec. Author through the canonical `imm-kernel intent author` wrapper, stage only these four Planner-owned files, and require structural `valid: true` / `enrollment_ready: true` for every candidate before publishing the entire approved GitHub set once. GitHub is the Initiative carrier, not authority. Report its complete topology and stable order; stop before Enrollment for this plan-only request.
