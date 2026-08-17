---
title: "feat: add imm-loop review lifecycle runtime"
type: feat
status: proposed
date: 2026-07-02
origin: imm-brainstorm analysis plus direct user confirmation
---

# Iteration Plan

## Task

- Summary: Make `imm-loop` an independent post-Plan completion Skill that automatically invokes `imm-code-review` and `imm-ui-review`, persists review pass decisions by changed-files signature, repeats same-boundary follow-up repair, and blocks compounder handoff until the review lifecycle is closed.
- Spec: docs/specs/imm-loop-review-lifecycle-runtime.spec.md
- Origin: User reported that the current loop frequently stops for manual intervention despite the intended validated-Spec/Plan auto-completion flow. Follow-up confirmation: `imm-loop` remains an independent Skill, code/UI reviews should be invoked automatically, and review pass decisions must be persisted.
- Research: `README.md` says validated Plan continuation should not require the user to manually invoke executor or QA again, and `imm-loop` should coordinate autowork, code/UI review, same-boundary follow-up, and compounder. `docs/specs/autowork-runtime-host.spec.md` identifies the missing runtime host behavior across QA boundaries. `docs/specs/run-review-closure-runtime-gate.spec.md` requires material/UI review gates before compounder, but the current Bun runtime returns `complete` with `review_status: not_required` after material changed files. `plugins/immune-brain/runtime/immune_brain_runtime.ts` currently builds an autowork snapshot that always reports `awaiting_execution_input` for any active Step and never reports `awaiting_qa_decision`, `review_required`, budget state, or persisted review closure. `CONTEXT.md` defines `State Ledger`, `Skill`, `QA`, and `Compounder`; `IMMUNE.md` preserves authority separation and forbids default QA pass or generic dispatchers.
- Decisions: D1 Keep `imm-loop` as the independent user-facing Skill for the completion loop. D2 Add runtime support for a persisted review lifecycle rather than relying only on changed-file inference. D3 Persist review pass by deterministic changed-files signature so follow-up changes can reopen stale gates. D4 Let `imm-loop` automatically invoke `imm-code-review` and `imm-ui-review`; reviewers remain read-only and same-boundary fixes return through `imm-autowork` / `imm-work`. D5 Repair ordinary autowork continuation across execution and QA boundaries as part of the same executable slice because review automation depends on reliable Plan progression. D6 Block `imm-compounder` until Plan work, QA, follow-up, and required review passes are all closed.
- Assumptions: A backwards-compatible optional `review_state` field under the State Ledger or an adjacent `.imm/memory/` loop state is acceptable if tests preserve existing State Ledger readability. New runtime helper tools may be added only when they are explicitly scoped to `imm-loop` status and review-pass recording, not as a generic dispatcher. Review evidence stored in state should be compact references, not raw transcripts.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; the failure surface is already identified from local specs, runtime code, and black-box probes, and no additional readonly domain split is needed before execution planning.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Plan`, `Step`, `Skill`, `QA`, `State Ledger`, and `Compounder`.

## Devil's Advocate Audit

1. **Rollback Resilience**: The slice must be rollback-safe by reverting the new Spec, this Plan, runtime review lifecycle helpers, `imm-loop` / `imm-autowork` contract text, focused Bun tests, and any MCP/package metadata for new helper tools. Persisted state changes must be optional and backwards compatible so rollback does not require destructive `.imm/memory/` cleanup.
2. **Verification Vanity**: Text-only assertions would miss the reported failure. Verification must construct runtime states that prove `ready_for_review` becomes a QA boundary, material/UI changes become review gates, review pass is persisted by changed-files signature, stale passes reopen after follow-up changes, and compounder stays blocked until all required review gates pass.
3. **Spec Dilution Detection**: The confirmed requirements are automatic code/UI review invocation, independent `imm-loop`, and durable review pass. A plan that only adds `review_required` snapshot fields or asks users to manually run reviewers would silently dilute the requirement. The current slice therefore includes reviewer invocation contract plus persisted review lifecycle state, while still rejecting default QA pass, reviewer edits, and generic dispatch.

## Planning Quality Gate

- **contract surface**: `docs/specs/imm-loop-review-lifecycle-runtime.spec.md`, this Plan, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/dist/imm-loop.md`, `plugins/immune-brain/skills/imm-loop/SKILL.md`, `plugins/immune-brain/dist/imm-autowork.md`, `plugins/immune-brain/dist/imm-code-review.md`, `plugins/immune-brain/dist/imm-ui-review.md`, MCP tool metadata, package plugin adapters, and focused tests under `tests/`.
- **compatibility**: Existing State Ledger files must remain readable. Any new `review_state` data must be optional, deterministic, and safely ignored by older readers. No production path may reintroduce Python runtime dependency.
- **interruption recovery**: If execution stops after a reviewer pass is recorded, the next `imm-loop` status must resume from persisted review state. If execution stops after a follow-up repair changes files, the next status must reopen only the affected stale gate.
- **rollback path**: Revert the new Spec/Plan, runtime helper changes, skill contract changes, package metadata changes, and focused tests together. Because state additions are optional, no migration rollback should be required beyond deleting test fixture state.
- **verification strength**: Use Bun runtime tests, MCP/package tool surface tests, contract tests for Skill wording, and black-box temp workspace tests. Avoid accepting file-existence checks as proof of loop behavior.
- **Brainstorm traceability**: No persisted `Brainstorm manifest` exists. The user-confirmed requirements are captured in Origin, Decisions D1-D4, and Spec Requirements R1-R4.

## Steps

### Step 1

- Step ID: U1
- Result: Persisted reviewer closure state
- Verification type: automated
- Verification: `bun test tests/imm-loop-review-lifecycle-state.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-02-001-feat-imm-loop-review-lifecycle-runtime-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers storing `review_state` with gate, decision, reviewed changed files, changed-files signature, evidence reference, reviewer Skill, and timestamp; Covers retrieving a pass for the same signature; Covers no pass for a different signature; Covers existing State Ledger files without `review_state` loading successfully.
- Discovery cache: plugins/immune-brain/runtime/imm_core.ts (State Ledger normalization and transition helpers); plugins/immune-brain/runtime/immune_brain_runtime.ts (runtime command surface); .imm/memory/current_iteration.json (current State Ledger shape); CONTEXT.md (State Ledger vocabulary)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If storing review state requires a breaking persisted schema migration, stop and route back to planning instead of modifying existing state in place.
- security_considerations: Persist compact evidence references and changed-file paths only; do not store raw review transcripts, secrets, or large tool output.

### Step 2

- Step ID: U2
- Result: Autowork continuation status
- Verification type: automated
- Verification: `bun test tests/imm-autowork-continuation-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-02-001-feat-imm-loop-review-lifecycle-runtime-plan.md --json`
- Execution note: characterization-first
- Test scenarios: Covers pending Step activation producing an execution boundary; Covers `ready_for_review` with execution evidence producing a QA boundary; Covers QA `pass` unlocking the next eligible Step; Covers QA `rework` and QA `replan` as stops; Covers step budget being honored; Covers no default QA pass from executor verification.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (`runAutoworkCommand`, `runWorkCommand`, `runReviewCommand`); plugins/immune-brain/runtime/imm_core.ts (`LedgerStateMachine`, `ACTIVE_STATES`); tests/autowork-false-completion.test.ts (existing autowork regression style); docs/specs/autowork-runtime-host.spec.md (accepted behavior)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If QA continuation cannot be implemented without fabricating QA decisions, keep the explicit QA boundary and return to planning; do not introduce runtime default pass.
- security_considerations: Runtime continuation may coordinate authority phases but must not execute arbitrary code beyond the active Step boundary or hide tool failures.

### Step 3

- Step ID: U3
- Result: Automatic reviewer orchestration
- Verification type: automated
- Verification: `bun test tests/imm-loop-review-orchestration-contract.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-02-001-feat-imm-loop-review-lifecycle-runtime-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers material changes selecting `imm-code-review`; Covers UI/design/i18n changes selecting `imm-ui-review`; Covers mixed changes requiring both gates; Covers `imm-loop` contract saying it automatically invokes pending reviewers instead of asking the user to do so manually; Covers review pass recording through runtime state; Covers same-boundary `follow_up` handoff returning to `imm-autowork` / `imm-work`.
- Discovery cache: plugins/immune-brain/dist/imm-loop.md (Skill contract); plugins/immune-brain/skills/imm-loop/SKILL.md (source loader); plugins/immune-brain/dist/imm-code-review.md (review output and follow_up contract); plugins/immune-brain/dist/imm-ui-review.md (UI review output and follow_up contract); plugins/immune-brain/dist/registry.yaml (Skill route visibility)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If automatic invocation would require a host capability unavailable in the current harness, preserve a recoverable runtime status plus explicit Skill contract and add the missing host adapter as a blocked follow-up rather than pretending automation is complete.
- security_considerations: Reviewers remain read-only. Automatic invocation must not grant reviewers implementation authority or bypass activation authorization for bounded advisory subagents.

### Step 4

- Step ID: U4
- Result: Compounder handoff waits for closed review lifecycle
- Verification type: automated
- Verification: `bun test tests/imm-loop-completion-gate.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-02-001-feat-imm-loop-review-lifecycle-runtime-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers material Plan completion blocking compounder until code review pass is persisted; Covers UI completion blocking compounder until UI review pass is persisted; Covers same-boundary follow-up changing files and reopening a stale gate; Covers all gates passed allowing compounder handoff; Covers MCP/package metadata exposing any new loop status or review-recording helper consistently; Covers rejection of `imm-autowork-driver`, generic dispatcher, background scheduler, and runtime default QA pass.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (MCP tool definitions and command mapping); plugins/immune-brain/.opencode-plugin/index.ts (package tool exposure if helpers are added); plugins/immune-brain/.opencode-plugin/runtime.ts (host command adapter); tests/plugin-package-runtime.test.ts (tool surface regression); docs/specs/run-review-closure-runtime-gate.spec.md (compounder gate acceptance)
- Agent Hint: imm-executor
- Depends on: 3
- failure_behavior: If package exposure drifts from MCP runtime behavior, stop before marking the plan complete and fix the host parity gap in the same Step.
- security_considerations: Compounder must receive only closed, evidence-backed work. Do not persist raw review output or sensitive logs in package-visible metadata.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-02-001-feat-imm-loop-review-lifecycle-runtime-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-02-001-feat-imm-loop-review-lifecycle-runtime-plan.md --sync`

## Notes

- This Plan intentionally promotes the previous contract-only run loop into a persisted review lifecycle runtime slice.
- The first execution target is Step U1. Do not begin implementation until the Plan validates and the user confirms scope.
