---
title: "feat: add Pi imm-loop host autorun"
type: feat
status: planned
date: 2026-07-10
origin:
  - confirmed analysis of Pi session 019f4af3-ee4a-759e-9056-a2c96b83ecff
  - user request for the best comprehensive solution
  - docs/specs/2026-07-10-pi-imm-loop-host-autorun.spec.md
---

# Iteration Plan

## Task

- Summary: Add a real Pi-hosted `/imm-loop` that consumes existing deterministic checkpoints, preserves Executor/QA/reviewer authority, persists bounded reviewer follow-up, and stops safely on cancellation, replan, terminal handoff, budget exhaustion, or fail-closed State Ledger write recovery.
- Spec: docs/specs/2026-07-10-pi-imm-loop-host-autorun.spec.md
- Origin: The user asked why repeated `imm-loop` invocations did not automatically finish an Uptimer Plan. Session evidence showed that Pi expanded the Skill contract but had no executable host loop; execution then depended on manual main-Agent coordination and stopped when QA subagents reached turn limits. The user accepted the recommendation to plan a Pi-specific foreground adapter over the existing runtime rather than add a generic dispatcher or default QA pass.
- Research: `plugins/immune-brain/runtime/immune_brain_runtime.ts` implements deterministic execution, QA, replan, review, completion checkpoints, and bounded follow-up operations. `plugins/immune-brain/runtime/state_ledger.ts` now persists follow-up identity/CAS and atomic ledger bytes, but repeated code review exposed that automatic stale write-lock reclaim requires a second crash-recoverable transition lock and cannot provide a defensible user-space compare-and-swap guarantee. Root `package.json` loads the Pi extension and existing Skills. Pi documentation proves packages can load TypeScript extensions with commands, tools, cancellation-aware execution, session entries, and child `pi --mode json` runs. Existing Learnings reject `imm-autowork-driver`, runtime default QA pass, shared registry, generic dispatcher, and background scheduler, while preferring bounded host-facing adapters. U1-U4 are closed with recorded evidence, but the active `imm-code-review` gate remains open because round-four review found the Ledger write-lock recovery design structurally unsafe.
- Decisions: D1 Implement a Pi-specific package extension instead of a cross-host dispatcher or new Skill. D2 Register `/imm-loop` and `imm_loop_run` over one foreground runner. D3 Consume `imm-autowork` as the state-machine truth and never infer QA pass from executor evidence. D4 Use isolated Pi child processes with role-specific tools for Executor, QA, and reviewers. D5 Promote bounded reviewer `follow_up` into backwards-compatible State Ledger runtime operations so interruption recovery is honest. D6 Stop on `replan_needed`, terminal `handoff_only`, missing authority output, blockers, cancellation, repeated unchanged errors, or exhausted budgets. D7 Keep existing CLI commands and do not add a generic `imm-loop` CLI. D8 Keep Pi session entries non-authoritative and recompute every resume from the State Ledger. D9 Reject automatic State Ledger stale write-lock takeover: it recursively creates crash/replacement races. D10 Keep write recovery fail-closed, expose diagnostics through `imm-heal`, and require explicit operator removal only after independent writer-stop verification. D11 Treat successful revised-Plan sync as the atomic consumption boundary for a QA-replanned follow-up: archive it, clear it, and expose the replacement Step in the same Ledger commit.
- Assumptions: The installed Pi package provides its extension API and TypeBox imports through peer dependencies. Child Pi processes share configured credentials and model availability with the parent. Plugin-local runtime wrappers remain resolvable when a target repository does not vendor Immune-Brain. Existing State Ledger readers safely ignore additive optional fields. An operator can independently confirm that no Ledger writer remains before manually removing a reported stale write lock; this explicit recovery is safer than an unprovable automatic takeover.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; the local Pi API documentation, official extension examples, runtime source, focused tests, State Ledger shape, and rejected-decision Learnings provide sufficient evidence. The configured `imm-planner` activation mode is `explicit_only`, and the user did not request planner ensemble dispatch.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Plan`, `Step`, `Executor`, `QA`, `State Ledger`, and `Compounder`.

## Technical Design

- Design depth: High risk because the change spans Pi package loading, isolated Agent execution, runtime authority, persisted follow-up state, cancellation, concurrency, resume, and cross-version compatibility.
- Design authority: `docs/specs/2026-07-10-pi-imm-loop-host-autorun.spec.md` is the single Technical Design baseline. Steps below reference its authority, follow-up, stop, recovery, and rollback invariants rather than redefining them.
- Design Conformance: QA for every Step must compare implementation evidence with the Spec. A local implementation mismatch returns `rework`; a change to authority, persistence, child execution, or stop semantics returns `replan`.

## Devil's Advocate Audit

1. **Rollback Resilience**: The extension is additive and can be disabled by removing its `pi.extensions` manifest entry. Follow-up state remains optional and backwards compatible, so reverting runtime operations does not require destructive ledger migration. Every Step has a coherent file-group rollback, and an interrupted run resumes from the last atomically saved State Ledger transition rather than replaying guessed session state.
2. **Verification Vanity**: Command-registration or wording assertions alone would repeat the current failure. Verification must execute state transitions and injected child outcomes in temporary repositories, prove that executor success cannot close QA, prove reviewer follow-up survives restart, prove stale review signatures reopen, and prove cancellation/lock/package behavior. Existing 34 focused tests remain regression evidence but are not accepted as proof of the new host loop.
3. **Spec Dilution Detection**: The Plan does not reduce “automatic execution” to another Skill prompt. U2 delivers ordinary Step autorun, U3 delivers required review and follow-up closure, U4 delivers interruption-safe package behavior, and U5 makes State Ledger recovery fail closed rather than silently claiming unsafe automatic reclaim. It deliberately stops rather than silently narrowing Planner, QA, reviewer, Compounder, or operator authority.
4. **Crash-Reclaim Recursion**: A `*.write.lock.reclaiming` marker that survives its creator is itself a permanent availability failure; an automatic attempt to delete or replace that marker recreates the same crash/replacement race. U5 chooses an explicit operational stop over a false claim of autonomous recovery: diagnostics identify the lock, but only an operator who has independently stopped all writers can remove it.
5. **Escalation Integrity**: Planner sync cannot supersede an open `rework_needed` follow-up, and QA cannot decide `replan` until the target returns to `ready_for_review`. The existing failure-exit path closes this gap without a new command: Executor records the structural Plan-fit failure as execution evidence, then independent QA records `replan`. This is evidence of non-repairability, not fabricated success.
6. **Mixed-State Replan Recovery**: Clearing `requires_replan` without consuming `pending_follow_up.state=replanning` creates an unrecoverable routing loop. U5 requires one atomic Planner-sync commit that either leaves the old replan checkpoint intact or archives the superseded target and exposes U5; tests must fail if a mixed state is persisted.

## Planning Quality Gate

- **contract surface**: Root `package.json`; new `plugins/immune-brain/extensions/imm-loop/` files; `plugins/immune-brain/runtime/state_ledger.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/imm_core.ts` config/model helpers; `plugins/immune-brain/dist/imm-loop.md`; Pi and cross-host user docs; focused tests under `tests/`.
- **compatibility**: Preserve existing `imm-autowork`, `imm-work`, and `imm-review` behavior and command manifests. Existing State Ledger files with absent/null `pending_follow_up` must load. Other host manifests remain unchanged and are documented as coordination-only unless they gain their own executable adapter.
- **interruption recovery**: The Pi runner releases its owned lock and records no incomplete decision when aborted. Resume calls `imm-autowork` again and trusts the State Ledger over Pi session entries. A child that recorded valid evidence before interruption leaves that evidence available for the next checkpoint. U5 makes Ledger write-lock failure visible and fail-closed; no automatic reclaim can overwrite a replacement writer after a crash.
- **rollback path**: U1 can revert follow-up helpers and tests; U2 can remove the extension manifest entry and extension directory; U3 can revert review/follow-up host routing while retaining ordinary Step autorun; U4 can revert recovery/package/documentation hardening without rewriting closed workflow evidence. U5 can revert only its write-lock diagnostics and tests, returning to the prior implementation only if the whole release is withheld; it must not partially restore automatic reclaim.
- **verification strength**: Use runtime state-transition tests, fake-extension tests, fixture subprocess tests, temporary target repositories, installed-package resource loading, existing review/completion regression suites, Plan validation, and `git diff --check`.
- **Mermaid intent**: The Spec sequence diagram is required because authority handoff and persistence order are central to correctness; the Plan does not duplicate it.
- **roadmap information preservation**: This Plan is the complete Pi executable-adapter slice. Equivalent adapters for other hosts are deferred and require separate host-specific Plans after Pi behavior is proven; they are not implied by current acceptance.
- **acceptance scope discipline**: Current Steps prove Pi foreground autorun only. They do not claim background execution, cross-host parity, automatic Planner changes, or automatic Compounder execution.

## Steps

### Step 1

- Step ID: U1
- Result: Reviewer follow-up is a durable runtime execution target.
- Verification type: automated
- Verification: `bun test tests/imm-follow-up-runtime.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/imm-loop-review-lifecycle-state.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-003-feat-pi-imm-loop-host-autorun-plan.md --json && git diff --check`
- Execution note: test-first
- Test scenarios: Covers absent and null historical `pending_follow_up` loading unchanged; Covers opening only a validated same-boundary reviewer follow-up with scope, one change goal, verification hint, origin gate, and evidence reference; Covers rejecting cross-boundary, malformed, duplicate-active, or unbounded follow-up input; Covers follow-up execution evidence entering an independent QA boundary; Covers QA pass closing the target and QA replan stopping at Planner authority; Covers follow-up changed files joining the completion review signature and invalidating stale gate passes; Covers checkpoint fields reporting current target, accurate `follow_up_completed_in_run`, and round state.
- Discovery cache: plugins/immune-brain/runtime/state_ledger.ts (`pending_follow_up`, evidence normalization, review signatures); plugins/immune-brain/runtime/immune_brain_runtime.ts (`runWorkCommand`, `runReviewCommand`, `runAutoworkCommand`, snapshot fields); plugins/immune-brain/dist/imm-work.md (dual-track authority contract); plugins/immune-brain/dist/imm-qa.md (follow-up QA contract); docs/specs/review-followup-work-entry-dual-track.spec.md (accepted handoff fields); docs/specs/2026-07-10-pi-imm-loop-host-autorun.spec.md (Technical Design)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If durable follow-up requires a breaking schema migration or a second workflow store, stop and replan instead of coercing historical ledgers or writing session state as authority.
- security_considerations: Validate follow-up scope as bounded project-relative paths or symbols, reject secret-bearing/raw transcript payloads, and allow State Ledger mutation only through runtime commands.

### Step 2

- Step ID: U2
- Result: Pi `/imm-loop` advances ordinary Plan Steps through authority-separated execution.
- Verification type: automated
- Verification: `bun test tests/pi-imm-loop-step-autorun.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-003-feat-pi-imm-loop-host-autorun-plan.md --json && git diff --check`
- Execution note: test-first
- Test scenarios: Covers the Pi package loading the extension alongside existing Skills; Covers `/imm-loop` and `imm_loop_run` sharing one foreground runner; Covers pending Steps reaching Executor, recorded execution evidence, independent QA, and the next checkpoint without another user command; Covers QA pass as the only Step-closing decision; Covers explicit QA rework returning to Executor within budget; Covers malformed, timed-out, aborted, or failed Executor/QA children stopping without fabricated state; Covers child tool policy preventing QA edits; Covers plugin-local runtime discovery in a target repository that does not vendor Immune-Brain; Covers existing CLI and non-Pi package surfaces remaining unchanged.
- Discovery cache: package.json (`pi.skills` package manifest); plugins/immune-brain/extensions/imm-loop/ (new Pi host adapter); plugins/immune-brain/runtime/imm_core.ts (`readImmuneBrainConfig`, `resolveWorkflowStageModels`); plugins/immune-brain/runtime/immune_brain_runtime.ts (`imm-autowork` snapshot authority); tests/plugin-package-runtime.test.ts (package and wrapper parity); Pi docs `docs/extensions.md` and `examples/extensions/subagent/` from the installed `@earendil-works/pi-coding-agent` (command, tool, subprocess, progress, and abort contracts); docs/specs/2026-07-10-pi-imm-loop-host-autorun.spec.md (Technical Design)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If Pi cannot provide a cancellable foreground path without relying on an unverified model instruction to continue, stop and replan the host integration instead of claiming executable autorun from command registration alone.
- security_considerations: Project-local execution requires Pi project trust; Executor receives only the active target; QA has no edit/write tools; child prompts and results must not log credentials or raw environment values.

### Step 3

- Step ID: U3
- Result: Pi `/imm-loop` closes runtime-required review gates through bounded follow-up.
- Verification type: automated
- Verification: `bun test tests/pi-imm-loop-review-follow-up.test.ts tests/imm-follow-up-runtime.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-loop-review-lifecycle-state.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-003-feat-pi-imm-loop-host-autorun-plan.md --json && git diff --check`
- Execution note: test-first
- Test scenarios: Covers code-only, UI-only, and mixed changed files invoking exactly `pending_review_gate` in runtime order; Covers reviewer pass recording through `imm-review gate-pass` with the exact changed-files signature; Covers actionable findings never aggregating to pass; Covers same-boundary findings opening a persisted follow-up and returning through Executor and QA; Covers follow-up changes reopening stale review gates; Covers cross-boundary findings stopping at `replan_needed`; Covers review and follow-up round budgets; Covers no `imm-compounder` invocation while a gate or follow-up remains; Covers `complete` plus `handoff_only` reporting only the explicit Compounder handoff.
- Discovery cache: plugins/immune-brain/dist/imm-code-review.md (review output and activation contract); plugins/immune-brain/dist/imm-ui-review.md (UI review output and follow-up contract); plugins/immune-brain/runtime/state_ledger.ts (`determineRequiredReviewGates`, review signature state); plugins/immune-brain/runtime/immune_brain_runtime.ts (`pendingReviewContext`, `gate-pass`, completion snapshot); docs/solutions/host-facing-subagent-integration-adapters.md (host wrapper and non-pass findings); docs/solutions/rejected-shared-registry-generic-dispatcher.md (no platform expansion); docs/specs/2026-07-10-pi-imm-loop-host-autorun.spec.md (Technical Design)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If a reviewer output cannot be classified as pass, bounded follow-up, or replan with evidence, stop at `reviewer_output_invalid`; do not let the adapter repair, suppress findings, or infer pass.
- security_considerations: Review children remain read-only, honor activation policy for optional advisory subagents, and persist only compact evidence references plus normalized changed-file paths.

### Step 4

- Step ID: U4
- Result: Pi autorun has a verified recoverable package delivery.
- Verification type: automated
- Verification: `bun test tests/pi-imm-loop-recovery-package.test.ts tests/pi-imm-loop-step-autorun.test.ts tests/pi-imm-loop-review-follow-up.test.ts tests/imm-follow-up-runtime.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-003-feat-pi-imm-loop-host-autorun-plan.md --json && git diff --check`
- Execution note: test-first
- Test scenarios: Covers TUI/tool cancellation terminating the active child and releasing the owned lock without a false authority decision; Covers `session_shutdown` cleanup; Covers live lock contention and proven stale-lock recovery; Covers resume recomputing the checkpoint from the State Ledger while treating Pi custom entries as display/budget metadata only; Covers Step, rework, review, follow-up, repeated-error, and elapsed-time budget stops; Covers repeated-error fingerprints requiring an evidence, changed-files, or strategy change before continuation; Covers package installation exposing the extension and existing Skills; Covers active docs promising executable autorun only for Pi with the adapter and coordination-only fallback elsewhere; Covers the full temporary-repository ordinary-Step and reviewer-follow-up journeys.
- Discovery cache: plugins/immune-brain/extensions/imm-loop/ (runner cancellation, lock, status persistence, package registration); package.json (Pi resource manifest and peer dependencies); docs/user_manual.md and plugins/immune-brain/USER_GUIDE.md (host capability claims); plugins/immune-brain/dist/imm-loop.md (Skill fallback contract); tests/plugin-package-runtime.test.ts (installed package parity); docs/solutions/rejected-autowork-driver-default-pass.md (authority boundary); docs/specs/2026-07-10-pi-imm-loop-host-autorun.spec.md (recovery and rollback design)
- Agent Hint: imm-executor
- Depends on: 3
- failure_behavior: If cancellation, locking, or installed-package smoke behavior is nondeterministic, keep the extension disabled in the package manifest and stop before documenting Pi autorun as available.
- security_considerations: The lock contains no secrets, stale-lock reclamation proves owner death, session entries exclude credentials and raw child transcripts, and cancellation must terminate the full child process tree.

### Step 5

- Step ID: U5
- Result: State Ledger write recovery is safely operator-resolvable.
- Verification type: automated
- Verification: `bun test tests/imm-follow-up-runtime.test.ts tests/pi-imm-loop-recovery-package.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-003-feat-pi-imm-loop-host-autorun-plan.md --json && git diff --check`
- Execution note: test-first
- Test scenarios: Covers interrupted temp writes retaining the last valid Ledger; Covers every ordinary Step, follow-up, queued QA, and checkpoint-snapshot mutation retaining commit-time state-version protection; Covers live, fresh-dead, malformed, initializing, and apparently stale write locks failing closed without automatic takeover; Covers `imm-heal` reporting lock path and parsed diagnostic state without deleting a lock; Covers operator removal of a diagnosed stale lock followed by a fresh `imm-autowork` checkpoint that resumes from the durable active Step or pending follow-up; Covers replacement lock ownership surviving a failed write attempt; Covers an exhausted `rework_needed` follow-up recording a failure exit, reaching `ready_for_review`, and receiving an independent QA `replan`; Covers revised-Plan sync archiving that replanning follow-up, clearing `requires_replan`, and exposing U5 atomically; Covers an injected sync interruption retaining the complete old replan checkpoint rather than a mixed state; Covers existing Pi runner locks, child cancellation, and ordinary Plan queue behavior unchanged.
- Discovery cache: plugins/immune-brain/runtime/state_ledger.ts (atomic save, write-lock metadata, commit expectations); plugins/immune-brain/runtime/immune_brain_runtime.ts (`autoworkSnapshotResult`, queued QA, `imm-heal`); plugins/immune-brain/extensions/imm-loop/runner.ts (repository-run lock, distinct from Ledger write recovery); tests/imm-follow-up-runtime.test.ts (concurrent follow-up/checkpoint fixtures); tests/pi-imm-loop-recovery-package.test.ts (Pi recovery regression); docs/specs/2026-07-10-pi-imm-loop-host-autorun.spec.md (fail-closed recovery design); docs/solutions/rejected-autowork-driver-default-pass.md (authority boundary)
- Agent Hint: imm-executor
- Depends on: 4
- failure_behavior: If the supported runtime cannot expose a safe diagnostic/recovery path without automatic deletion, leave the write lock fail-closed, document the manual stop condition, and return `replan` rather than reintroducing a reclaim transition guard.
- security_considerations: Write-lock metadata contains no secrets. The runtime must never remove an existing Ledger write lock automatically, never trust Pi session metadata for recovery, and never turn an operator recovery diagnostic into a default pass or hidden background cleanup.

## Deferred Host Work

- Codex, Claude, Cursor, and OpenCode executable loop adapters remain deferred.
- Promotion criteria for a host-specific follow-up Plan: the host exposes cancellable authority invocation, package-install tests, and resume semantics comparable to the Pi adapter; the Pi Step and review journeys are already green; the new Plan keeps State Ledger authority and does not introduce a shared dispatcher merely for parity.
- Remote telemetry, background execution, automatic Planner changes, and automatic Compounder execution remain explicit non-goals unless separately framed and confirmed.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-003-feat-pi-imm-loop-host-autorun-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-003-feat-pi-imm-loop-host-autorun-plan.md --sync`

## Notes

- This is a new executable slice rather than an append to the completed 2026-07-02 and 2026-07-03 Plans; their closed evidence remains untouched.
- U1–U4 remain closed. Executor has recorded the failure exit on exhausted `follow-up-9ab6cf2f8469`, and independent QA has recorded `replan`. The next Planner sync must consume that target atomically as part of U5 bootstrap; because the current sync implementation cannot yet do so, U5 activation must occur only through an executor bootstrap authorized to implement and verify that sync transition before ordinary U5 work continues.
