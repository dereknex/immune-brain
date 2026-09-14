# Spec: Workflow Consolidation Remediation

**Task ID**: `workflow-consolidation-remediation`
**Owner**: user
**Status**: Proposed
**Design risk**: High
**Design views**: state transitions, service/component interfaces, temporal sequence
**Diagram decision**: not_required
**Diagram reason**: Each Slice touches one existing state machine or interface boundary already diagrammed in `docs/specs/archive/workflow-consolidation.spec.md`; this Spec corrects specific transitions and interfaces rather than introducing new topology, so prose per-Slice suffices.

## 1. Problem Frame

This Initiative implemented S1–S14 of `workflow-consolidation` (17 commits,
`db044fb6d3c660bb6f01b65fb2eae2d0fcd465cc..HEAD` at review time). A two-axis
code review (Standards + Spec, both verified against the live diff and the
canonical archived TaskIntents at `docs/plans/archive/wc-*.intent.json`)
found 19 findings. This Spec fixes them.

- **F1 (authority correctness)**: `projectPlanSurface` and `projectBatchDrift`
  in `plugins/immune-brain/runtime/unattended/batch_preflight.ts` compute
  `is_resuming` two different ways in the same call (`existingBatch !== null`
  passed in at `:517`/`:567`, vs `isResuming` = `activeRecord !== null`
  reported back at `:530`/`:583`). A **settled** record (`activeRecord ===
  null`, `existingBatch !== null` via `findSettledBatchRecord`) makes the
  plan surface take the resume branch: it inherits the settled record's
  stale `budget.deadline_at` (`:320-322`) and reconstructs every child as
  `already_settled` (`:324-377`) instead of issuing the 8h default budget. The
  gate then sets `expiresAt = budget.deadline_at`, a past timestamp
  `batch_authority.ts:160,224` refuses — a second batch on a settled
  Initiative can never be authorized.
- **F2 (ownership violation)**: `CONTEXT.md:215` states
  `runtime/unattended/` alone owns Batch Authorization and both Host adapters
  are callers only. S9 (`059786f`) did not fully deliver this: three decision
  blocks are still duplicated verbatim in
  `plugins/immune-brain/runtime/claude/kernel_ports.ts` and
  `plugins/immune-brain/.pi-extension/imm-unattended-batch.ts` — the
  reuse/expiry decision (`kernel_ports.ts:989-1007` ≡
  `imm-unattended-batch.ts:158-175`), the binding construction
  (`kernel_ports.ts:1109-1129` ≡ `imm-unattended-batch.ts:269-289`), and the
  post-gate claim/drift cascade (`kernel_ports.ts:1078-1103` ≡
  `imm-unattended-batch.ts:220-260`, each recomputing the claim a second
  time). `docs/adr/0008-batch-capability-rehydration.md:27-30` asserts the
  shared file already owns the reuse decision; it does not.
- **F3 (mutation-replay risk)**: `kernel_ports.ts:604,608` run the terminal
  tracker projection outside any catch, and `:791` runs it inside the
  authorize `try` whose `catch` (`:792`) rolls back the staged intent and
  rethrows **after** the Kernel mutation already committed — a caller retry
  on that rethrow can replay an already-applied mutation.
- **F4 (test validity — false negative)**:
  `tests/packaged-contract-tool-surface.test.ts:83` only reports a token when
  it is present on **at least one** Host tool surface, so a token on **zero**
  surfaces — the exact regression `HTN-2` names — passes silently. Its
  pre-change comparison (`:118-131`) hardcodes paraphrases instead of reading
  the actual pre-change file content.
- **F5 (guard not replaced, not extended)**: S2's acceptance said the old
  regex/spelling guards would stop being required; `d80837b` added new
  behavioral guards **alongside** the old ones rather than instead of them.
  `tests/unattended-contracts.test.ts:333-344` and
  `tests/v3-island-deletion.test.ts:84-99` still assert on source text.
  Neither the old nor the new guards read `.pi-extension/` or
  `runtime/claude/`.
- **F6 (refusal messages don't name the gap)**:
  `plugins/immune-brain/runtime/kernel/spec_binding.ts`'s `inspectSpecBinding`
  has two `binding_missing` returns (`:88-95` — truly nothing declared, and
  `:116-122` — the final fallback reached when non-empty `active`/`archived`
  paths exist but never pair into exactly one binding). Both are
  byte-identical and both return `missing: []`. The first case has nothing to
  name (no Spec paths of either kind exist in `scope_hint` at all) and its
  generic message is correct. The second case **does** have concrete
  unpaired paths available (the filtered `active`/`archived` arrays) but
  discards them, so `batch_plan.ts:36`'s
  `SPEC_BINDING_REASONS.binding_missing = "spec_binding_missing"` renders no
  path detail even when the binding exists but is mismatched — the opposite
  of what `SPB-4`/`BPP-1` asked for. Separately,
  `SPEC_BINDING_REASONS.binding_incomplete = "spec_binding_incomplete: "`
  (`batch_plan.ts:37`) is unreachable dead code: `specBindingReason` always
  intercepts a non-empty-`missing` `binding_incomplete` before falling
  through to that map entry, and `inspectSpecBinding` only ever returns
  `binding_incomplete` with a non-empty `missing` — so the dangling `": "`
  can never actually render today, but it is an unenforced invariant (no
  type prevents `missing` from being empty there) worth removing rather than
  leaving as a trap for a future edit.
- **F7 (tautological / source-text tests)**:
  `tests/unattended-batch-plan.test.ts:360` compares `batch_plan`'s output to
  `inspectSpecBinding`, the same function `batch_plan` calls internally —
  near-circular, and `enrollCanary` (the actual enrollment refusal path) is
  never driven. `tests/dual-host-assurance-conformance.test.ts:2113,:2175`
  prove adapter routing via source-text `includes()` rather than execution.
- **F8 (removed coverage, no named successor)**:
  `tests/kernel-r2a-boundary.test.ts:243-254` asserted
  `runKernelCommand(["readiness","--json"]) -> invalid_command`, zero writes.
  `runKernelCommand` survives S5/S6; no successor names or re-covers this.
- **F9 (stale/unsettled ADRs)**: `docs/adr/0006`, `0007`, `0008` are
  `status: proposed`, "Decision: Not settled. The options are:" — read as
  options papers, not the settled, hard-to-reverse decisions `CONTEXT.md`
  defines an ADR as recording.
- **F10 (orphaned imports)**: S9/S13 left unused imports behind —
  `kernel_ports.ts:2,3,30,47,48,74,80,84,85,89,90,91`
  (`readdirSync`, `spawnSync`, `pathMatchesScope`, `projectBatchPlan`,
  `computeBatchPlanDigest`, `runBatchGitPreflight`, `BatchPlan`, …);
  `imm-unattended-batch.ts:4,5,6,36,40,42,44`;
  `imm-canary-work.ts:84` (`deriveGithubTerminalProjectionInput`).
  `tsconfig.json` has no `noUnusedLocals`, so nothing catches recurrence.
- **F11 (same-file duplication)**: `imm-unattended-batch.ts:119-121` and
  `:442-443` repeat the TUI-refusal/recovery strings verbatim — the same
  defect `batch_reasons.ts` (S10) was built to cure across Hosts, left
  uncured within one file. `:60-71`'s comment documents `isOwnBatchClaim`,
  which now lives in `batch_preflight.ts:182`, in the wrong place.
- **F12 (unnecessary work)**: `kernel_ports.ts:610-625`'s
  `withTerminalTracker` runs a full `this.status()` on every
  advance/submitReview/authorize call regardless of whether the call is
  terminal.
- **F13 (frozen re-verification path broken)**: `52e0619` moved the host bun
  runtime to `1.4.2` (forced by Homebrew removing the `1.3.14` Cellar path
  the frozen QA runner resolved to) and updated every **still-candidate**
  TaskIntent's `runner_version` to match. S1/S2/S3 were already settled and
  still declare `1.3.14`. `runtime/assurance/verification.ts:92`
  (`assertRunnerCompatible`) hard-fails any reverification attempt against
  those frozen descriptors with "assurance unavailable". User decision
  (2026-09-14): accept this as a permanent loss for those three settled
  Slices; re-verification protection for settled Slices going forward is the
  responsibility of `main`'s standing test suite, not a re-openable frozen
  artifact. This Spec records that decision as an ADR; no code changes it.

## 2. Decisions

1. **F1 fix location**: unify `is_resuming` computation inside
   `projectPlanSurface`/`projectBatchDrift` themselves (derive from the same
   `activeRecord !== null` value already computed by each caller), rather
   than trusting a separately-passed `is_resuming` argument that can diverge
   from the `existing_batch` argument. Budget inheritance (`:320-322`) keys
   off the corrected `isResuming`, not off `existingBatch` presence — a
   settled record still supplies branch/lineage identity but never supplies
   budget.
2. **F2 fix location**: extract the three duplicated blocks into
   `runtime/unattended/batch_preflight.ts` (or a sibling module in the same
   directory) as one function per decision, consumed by both adapters. This
   Slice is ordered after the F1 fix lands, since both touch the same
   `projectPlanSurface`/`projectBatchDrift` surface and the reuse/expiry
   block reads `isResuming`.
3. **F3 fix**: move the terminal-tracker projection outside the authorize
   `try`/`catch` that owns the Kernel mutation rollback, and wrap it in its
   own bounded try/catch that never rethrows into the caller's retry path.
4. **F4 fix**: invert the reporting condition in
   `packaged-contract-tool-surface.test.ts` to flag a token present on zero
   surfaces, and replace the hardcoded pre-change paraphrase with
   `git show aecf5dd^:<path>` (the commit immediately before S1's first
   change) read at test time.
5. **F5 fix**: remove the superseded regex/spelling assertions from
   `tests/unattended-contracts.test.ts` and `tests/v3-island-deletion.test.ts`
   once the new behavioral guards demonstrably cover the same regression
   (extend their coverage to `.pi-extension/` and `runtime/claude/` first,
   verify the removed assertion's regression is still caught, then remove).
6. **F6 fix**: `inspectSpecBinding`'s final `binding_missing` fallback
   (`:116-122`, reached when unpaired `active`/`archived` paths exist)
   populates `missing` with those concrete unpaired paths instead of `[]`;
   the genuinely-empty case (`:88-95`) is unchanged, since it has nothing to
   name. `batch_plan.ts`'s `specBindingReason` renders the populated
   `missing` for both `binding_missing` and `binding_incomplete` through one
   shared branch instead of two separate code paths; the now-unreachable
   `SPEC_BINDING_REASONS.binding_incomplete` dead-code entry is removed.
7. **F7 fix**: `unattended-batch-plan.test.ts` drives `enrollCanary` directly
   for the refusal case instead of comparing `batch_plan`'s output to its own
   internal call; `dual-host-assurance-conformance.test.ts`'s two source-text
   scenarios are rewritten to assert on executed routing behavior (observed
   side effect or return value), not `includes()` on adapter source.
8. **F8 fix**: name an existing or new successor test asserting
   `runKernelCommand(["readiness","--json"])` still returns `invalid_command`
   with zero writes, or record in this Spec's Scope why that specific
   coverage is no longer needed (superseded by a stronger existing
   assertion) — Decision made at implementation time based on what
   `runKernelCommand`'s current call sites actually require.
9. **F9 fix**: for each of `0006`/`0007`/`0008`, either finalize its status
   (the decision the ADR already documents having been made, since S9–S13
   shipped on top of them) or move it out of `docs/adr/` into a design-note
   location if it is genuinely still open. Default: finalize, since the code
   implementing each decision has already merged.
10. **F10 fix**: delete the orphaned imports named in F1; enable
    `noUnusedLocals` in `tsconfig.json` so recurrence is caught by
    `bun run typecheck`, not by review.
11. **F11 fix**: extract the repeated TUI-refusal/recovery strings in
    `imm-unattended-batch.ts` into one local helper; move or delete the
    stale `isOwnBatchClaim` comment at `:60-71`.
12. **F12 fix**: gate `withTerminalTracker`'s `this.status()` call on the
    call actually being terminal (or make it lazy so a non-terminal call
    never pays for it).
13. **F13 fix**: no code change. Author ADR-000N recording the accepted loss
    of frozen re-verification for S1/S2/S3 and the standing-suite
    responsibility going forward.
14. **Batching discipline**: F1, F2, F3 stay `critical` (Batch Authorization
    and Kernel-mutation authority surfaces) and are never combined into one
    batch per `batch_plan.ts:158`. F4–F8 are `material` (test-validity and
    refusal-message correctness on Managed surfaces). F9–F13 are `routine`
    (docs/hygiene, no runtime behavior change).

## 3. Technical Design

### 3.1 State transitions (F1)

- **States**: `no_batch` → `running` → `settled` (existing
  `BatchRunStateRecord.batch_state`); `is_resuming` is a derived signal, not a
  stored state, and must agree everywhere it's read within one preflight
  call.
- **Legal transitions**: `no_batch` → `running` always issues a fresh
  8h-default budget. `running` → `running` (mid-batch resume) inherits the
  live budget. `settled` → `running` (a new batch on a previously-settled
  Initiative) is a fresh issuance, not a resume, and must not inherit the
  settled record's budget or reconstruct its children as `already_settled`.
- **Trigger**: `findExistingActiveBatch` returns `null` (no active record) but
  `findSettledBatchRecord` returns a prior settled record — this is exactly
  the case the current code mishandles.
- **Invariant**: `isResuming` (derived from `activeRecord !== null`) is the
  single source of truth for both the budget-inheritance branch and the
  reported `is_resuming` projection field; both `projectPlanSurface` and
  `projectBatchDrift` compute it once and pass the same value everywhere
  downstream.
- **Terminal ownership / recovery**: `runtime/unattended/batch_preflight.ts`
  owns this decision exclusively (unchanged from S9's stated intent); a
  caller never re-derives `isResuming` independently.

### 3.2 Service/component interfaces (F2)

- **Inputs**: `root`, `initiative_slug`, `activeRecord`/`existingBatch`,
  `batchBranch`, `baseHead`, `planDigest`, `budget` — already computed by
  `batch_preflight.ts` before either Host adapter is reached.
- **Outputs**: `reuseAuthorization: boolean`, `reuseBlockers: string[]`,
  `expiresAt: string`, and the constructed `BatchAuthorizationBinding` for
  `startBatch`.
- **Errors**: none new; the function surfaces the same blockers each adapter
  currently computes inline.
- **Compatibility/versioning**: pure internal refactor; no persisted-record
  shape change, no TaskIntent/TaskRecord contract change.
- **Caller/callee ownership**: `runtime/unattended/` owns the decision;
  `kernel_ports.ts` and `imm-unattended-batch.ts` become callers that render
  Host-specific prose/UI around the shared result, matching `CONTEXT.md:215`.

### 3.3 Temporal sequence (F3)

- **Ordered interactions**: authorize call → Kernel mutation (commit) →
  terminal-tracker projection (best-effort, outside the mutation's
  try/catch) → return to caller.
- **Authority at each point**: only the Kernel mutation carries authority;
  the terminal-tracker projection is an observational side effect and must
  never gate, roll back, or cause a retry of the mutation.
- **Interruption behavior**: if the projection throws, the mutation's result
  is still returned to the caller; the projection failure is logged/reported
  but does not rethrow into the mutation's error path.
- **Idempotency**: unaffected — this fix changes only error-handling
  boundaries, not what is written or when.

## 4. Scope

- `plugins/immune-brain/runtime/unattended/batch_preflight.ts`
- `plugins/immune-brain/runtime/claude/kernel_ports.ts`
- `plugins/immune-brain/.pi-extension/imm-unattended-batch.ts`
- `plugins/immune-brain/runtime/kernel/spec_binding.ts`
- `plugins/immune-brain/runtime/unattended/batch_plan.ts`
- `plugins/immune-brain/.pi-extension/imm-canary-work.ts` (import cleanup only)
- `tests/unattended-batch-run.test.ts`
- `tests/unattended-batch-plan.test.ts`
- `tests/packaged-contract-tool-surface.test.ts`
- `tests/unattended-contracts.test.ts`
- `tests/v3-island-deletion.test.ts`
- `tests/dual-host-assurance-conformance.test.ts`
- `tests/kernel-r2a-boundary.test.ts`
- `tsconfig.json`
- `docs/adr/0006-*.md`, `docs/adr/0007-*.md`, `docs/adr/0008-*.md`
- a new `docs/adr/000N-*.md` for F13
- `docs/specs/workflow-consolidation-remediation.spec.md` (this Spec)
- `docs/specs/archive/workflow-consolidation-remediation.spec.md` (post-freeze)

## 5. Out of Scope

- Re-opening or rewriting any settled TaskRecord from S1–S14.
- Any change to the `runner_version` of the already-frozen S1/S2/S3
  TaskIntents (F13 is ADR-only per user decision).
- Any bun/runner version change (F13's root cause is accepted, not reversed).
- New behavior beyond what F1–F13 name; no speculative generality.

## 6. Devil's Advocate Audit

- **Rollback resilience**: F1/F2/F3 each touch a narrow, already-tested
  surface (`batch_preflight.ts`'s two exported functions;
  `kernel_ports.ts`'s terminal-tracker wiring). A partial implementation of
  F1 without F2 leaves the duplication in place but does not reintroduce the
  budget-inheritance bug, since F1 is scoped to `batch_preflight.ts` alone. A
  partial F2 without F1 would propagate the F1 bug into the newly shared
  function — hence the enforced order (F1 slice completes and its own
  verification passes before F2's slice is enrolled).
- **Verification vanity**: F1's regression is currently masked because
  `tests/unattended-batch-run.test.ts:1812` pins a `FAR_FUTURE` deadline in
  every fixture. The F1 TaskIntent's acceptance requires a **new** fixture
  with a settled record carrying an **expired** `deadline_at`, asserting the
  new batch receives the 8h default and at least one child is enrollable —
  a descriptor that fails against the current code and passes only after the
  fix.
- **Spec dilution detection**: F4–F8 each cite the exact acceptance ID
  (`HTN-2`, `GRD-1`/`GRD-2`, `SPB-4`/`BPP-1`, `BPP-3`/`CVG-4`, `ISL-2`) the
  original S1–S14 TaskIntents already committed to; this Spec does not
  relax any of them — it closes the gap between the acceptance text and what
  the shipped test actually checks.

## 7. Slice Boundaries, Risk and Order

| Slice | Finding(s) | Risk | Depends on |
|---|---|---|---|
| RM1 | F1 | critical | — |
| RM2 | F2 | critical | RM1 |
| RM3 | F3 | critical | — |
| RM4 | F4 | material | — |
| RM5 | F5 | material | — |
| RM6 | F6 | material | — |
| RM7 | F7 | material | — |
| RM8 | F8 | routine | — |
| RM9 | F9 (ADR-0008) | routine | RM2 |
| RM10 | F9 (ADR-0006, 0007) | routine | — |
| RM11 | F10 | routine | RM2 |
| RM12 | F11 | routine | — |
| RM13 | F12 | routine | — |
| RM14 | F13 | routine | — |

Parallel groups: `[RM1]` → `[RM2, RM3, RM4, RM5, RM6, RM7, RM8, RM10, RM12,
RM13, RM14]` → `[RM9, RM11]`. RM3–RM8, RM10, RM12–RM14 have no dependency on
RM1/RM2 and may run alongside them from the start; they are grouped in the
second wave only for readability, not because they wait on RM1.

## 8. Acceptance Mapping

| Slice | Acceptance ID | Assertion source |
|---|---|---|
| RM1 | RB1-1 | new fixture: settled record + expired deadline → fresh 8h budget, ≥1 enrollable child |
| RM1 | RB1-2 | `is_resuming` reported identically by `projectPlanSurface` and `projectBatchDrift` for the same input |
| RM2 | RB2-1 | `kernel_ports.ts` and `imm-unattended-batch.ts` call one shared function for reuse/expiry, binding construction, and claim/drift; no duplicated decision logic remains |
| RM2 | RB2-2 | `batch_preflight.ts`'s zero-consumer fields (`active_claim_task_id`, `own_claim`, `plan_unavailable_reason`) are either consumed by both adapters or removed |
| RM3 | RB3-1 | a forced authorize-mutation-then-projection-throw scenario returns the mutation's result without rollback or rethrow |
| RM4 | RB4-1 | a token present on zero Host tool surfaces is reported as a failure |
| RM4 | RB4-2 | the pre-change comparison reads `git show aecf5dd^:<path>` rather than a hardcoded paraphrase |
| RM5 | RB5-1 | superseded regex/spelling assertions removed from both files; behavioral guards cover `.pi-extension/` and `runtime/claude/` |
| RM6 | RB6-1 | `inspectSpecBinding`'s unpaired-path `binding_missing` fallback names the concrete unpaired paths; `batch_plan.ts` renders them in the refusal reason through one shared branch |
| RM6 | RB6-2 | the unreachable `SPEC_BINDING_REASONS.binding_incomplete` dead-code entry is removed |
| RM7 | RB7-1 | `unattended-batch-plan.test.ts` drives `enrollCanary` for the refusal case |
| RM7 | RB7-2 | `dual-host-assurance-conformance.test.ts`'s two scenarios assert executed behavior, not source-text `includes()` |
| RM8 | RB8-1 | a named successor test covers `runKernelCommand(["readiness","--json"]) -> invalid_command` with zero writes, or this Spec's Scope records why none is needed |
| RM9 | RB9-1 | ADR-0008 correctly states where the reuse decision lives after RM2 |
| RM10 | RB10-1 | ADR-0006 and ADR-0007 status reflects their actual (already-shipped) decision state |
| RM11 | RB11-1 | `bun run typecheck` passes with `noUnusedLocals` enabled; the named orphaned imports are removed |
| RM12 | RB12-1 | the TUI-refusal/recovery strings exist once in `imm-unattended-batch.ts`; the stale comment is corrected or relocated |
| RM13 | RB13-1 | `withTerminalTracker` does not call `this.status()` for a non-terminal invocation |
| RM14 | RB14-1 | a new ADR records the F13 decision; no code file in Scope changes |

## 9. References

- Review baseline: `db044fb6d3c660bb6f01b65fb2eae2d0fcd465cc..HEAD`
  (17 commits, S1–S14 of `workflow-consolidation`).
- `docs/specs/archive/workflow-consolidation.spec.md`
- `docs/plans/archive/wc-*.intent.json`
- `CONTEXT.md:215` (`runtime/unattended/` ownership statement)
- `docs/adr/0005-*.md` (Batch Authorization lifetime decision, cited inline
  by both F2 duplicated comment blocks)
- `docs/adr/0008-batch-capability-rehydration.md:27-30`
