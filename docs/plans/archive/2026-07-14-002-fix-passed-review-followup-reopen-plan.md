# Iteration Plan

- Summary: Let `imm-work` atomically reopen an already-passed review gate only when a same-boundary finding carries the exact runtime checkpoint signature, without rewriting closed evidence or trusting Git state.
- Spec: `docs/specs/2026-07-14-passed-review-followup-reopen.spec.md`
- Origin: The user confirmed the analysis of Pi session `019f60a0-ab05-7df8-922f-5c089c2c1832` and invoked `imm-planner` to plan the workflow repair.
- Scope Mode: New one-Step correction Plan. It does not append to or rewrite the unrelated currently synced Plan.
- Planner research dispatch: solo; this is one State Ledger transition with direct runtime and regression-test evidence.

## Research

- `plugins/immune-brain/runtime/state_ledger.ts` rejects `openFollowUp` unless `origin_gate` equals the first required gate without an exact-signature pass. When every required gate has passed, the computed pending gate is `undefined`.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` already commits `follow-up-open` through the optimistic State Ledger mutation path, and Follow-up 7 now exposes `review_changed_files_signature` in review checkpoints, so no new command or persistence layer is required.
- `tests/imm-follow-up-runtime.test.ts` covers ordinary pending-gate follow-ups, concurrency rejection, repeated rounds, execution evidence, and QA closure, but not a reviewer finding after all required gates pass.
- `docs/solutions/rejected-post-closure-ledger-rewrite.md` forbids rewriting closed Step evidence. This Plan preserves that decision and changes only current review-gate state plus append-only history.
- `docs/solutions/state-ledger-heal-and-migration-safety.md` requires closed facts to remain immutable and destructive state transitions to remain auditable.
- `docs/specs/completed-plan-followup-append.spec.md` concerns Planner-owned Step append after replan. It does not replace the lightweight same-boundary follow-up track addressed here.
- The currently synced Plan is `docs/plans/2026-07-14-001-refactor-plan-core-idle-export-pruning-plan.md`, with U1 still pending. This new Plan may be validated now but must not be synced until the user explicitly chooses to switch or first completes the current Plan.

## Decisions

- D1: Keep `imm-code-review` and `imm-ui-review` advisory-only; `imm-work follow-up-open` remains the durable handoff consumer.
- D2: Reuse the existing `openFollowUp` transition and optimistic commit, adding only optional `--changed-files-signature` input instead of a command, queue, schema, or state store.
- D3: Require the exact runtime checkpoint signature before reopening an already-passed origin gate; keep ordinary pending-gate calls backwards compatible when the option is omitted.
- D4: In the all-required-gates-passed case, invalidate only the origin gate's current pass and preserve the prior pass through append-only history.
- D5: Continue using Ledger-recorded execution evidence as the authoritative changed-file set; Git and handoff scope remain validation context only.
- D6: The user explicitly authorized organizing and executing this Plan after Plan 001 completed.

## Assumptions

- The reviewer handoff carries `changed_files_signature` copied from the current runtime checkpoint.
- Existing consumers correctly treat a missing exact-signature pass as a pending gate.
- The current compare-before-commit path is sufficient to make pass invalidation and follow-up creation atomic without a schema migration.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `tests/imm-follow-up-runtime.test.ts`, `tests/imm-loop-review-lifecycle-state.test.ts`, `tests/imm-loop-review-orchestration-contract.test.ts`, `plugins/immune-brain/dist/imm-code-review.md`, `plugins/immune-brain/dist/imm-work.md`, `plugins/immune-brain/dist/imm-loop.md`, this Spec, and this Plan.
- compatibility: the State Ledger schema, pending-gate behavior, and ordinary signature-omitting follow-up lifecycle remain unchanged; the new option is mandatory only for all-passed reopen.
- interruption recovery: optimistic commit rejection leaves both gate state and `pending_follow_up` unchanged; rerunning `imm-work follow-up-open` is safe after refreshing state.
- rollback path: revert the runtime predicate/history change and distributed contract wording; no persisted schema rollback is required.
- verification strength: isolated runtime fixtures assert exact Ledger state, history, unchanged closed evidence, gate isolation, invalid-origin rejection, and concurrent mutation rejection.
- design-depth classification: Medium because the change modifies persisted workflow transition semantics and reviewer/work authority coordination.
- Design Conformance: QA must compare implementation behavior against the Spec transition rules; changing reviewer ownership, Git authority, or closed evidence requires replan.
- Mermaid intent: the Spec diagram clarifies the post-closure review transition without becoming a second authority.

## Non-goals

- No Git-based discovery of authoritative changed files.
- No reviewer-owned State Ledger mutation.
- No closed Step evidence correction.
- No `imm-heal` inference from conversation history.
- No unrelated Plan switching, append, or completion-state rewrite.

### Step 1

- Step ID: U1
- Result: Exact-signature reviewer findings become auditable pending follow-ups through legal passed-gate reopening
- Verification type: automated
- Verification: `bun test tests/imm-follow-up-runtime.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-14-002-fix-passed-review-followup-reopen-plan.md --json && git diff --check`
- Test scenarios: All required gates passed then exact-signature origin gate opens a follow-up; Missing and stale reopen signatures leave the Ledger byte-identical; Only the origin gate pass is invalidated; Prior pass and finding evidence plus follow-up ID are retained in history; Closed Step evidence remains unchanged; Non-required origin gate is rejected; Existing pending-gate calls remain compatible without a signature; Existing pending-gate mismatch is rejected; Concurrent Ledger mutation aborts without partial state change; Ordinary follow-up execution and QA closure still pass.
- Files: `plugins/immune-brain/runtime/state_ledger.ts` (follow-up eligibility, signature validation, gate invalidation, and history); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (CLI option and handoff wiring); `tests/imm-follow-up-runtime.test.ts` (end-to-end runtime regressions); `tests/imm-loop-review-lifecycle-state.test.ts` (review pass lookup regression if needed); `tests/imm-loop-review-orchestration-contract.test.ts` (host signature handoff contract); `plugins/immune-brain/dist/imm-code-review.md` (reviewer handoff contract); `plugins/immune-brain/dist/imm-work.md` (durable consumption contract); `plugins/immune-brain/dist/imm-loop.md` (checkpoint consumer contract); `docs/specs/2026-07-14-passed-review-followup-reopen.spec.md` (design authority)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If reopening cannot preserve closed evidence, gate isolation, or compare-before-commit atomicity within the existing State Ledger shape, stop and return to Planner rather than adding Git authority or a migration.
- security_considerations: Treat origin gate, scope, and evidence reference as untrusted CLI input; retain existing bounded-string and project-relative scope validation, and do not read arbitrary workspace files during eligibility checks.

## Devil's Advocate Audit

1. **Rollback Resilience**: The transition changes no schema and does not rewrite closed evidence. Runtime and contract changes can be reverted together; an already-created pending follow-up remains valid under the old ordinary lifecycle.
2. **Verification Vanity**: A test that only observes command exit code could miss partial gate corruption. U1 must assert the exact remaining gate map, appended history, unchanged closed evidence, pending follow-up payload, and no mutation on rejected/concurrent paths.
3. **Spec Dilution Detection**: The Plan explicitly retains advisory reviewer ownership, Ledger authority, atomicity, gate isolation, and closed-history immutability. Git inference, reviewer mutation, `imm-heal` expansion, and unrelated Plan switching are explicitly excluded rather than silently deferred.

## Plan Switch Gate

Plan 001 is complete and the user explicitly authorized execution of this Plan. Finish the completed runtime checkpoint, sync this Plan, and begin through `imm-work`.
