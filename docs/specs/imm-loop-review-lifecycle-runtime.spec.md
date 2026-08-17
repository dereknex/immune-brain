# Spec: Imm Loop Review Lifecycle Runtime

**Task ID**: IMM-LOOP-REVIEW-LIFECYCLE-001
**Owner**: Planner
**Status**: Proposed
**Date**: 2026-07-02

## 1. Goal

Make `imm-loop` the independent post-Plan execution Skill that automatically runs code and UI review gates, persists review pass decisions, and repeats same-boundary review/follow-up repair until all required review gates are closed or a safe stop condition is reached.

A validated Plan should not require the user to manually chain `imm-autowork`, `imm-code-review`, `imm-ui-review`, same-boundary `follow_up`, and review-pass recording. Human intervention should be reserved for blockers, cross-boundary scope changes, credentials, unclear verification targets, review or follow-up budget decisions, and replan choices.

## 2. Background

Current documentation already describes `imm-loop` as the L2S-WF completion loop:

`imm-autowork -> review -> same-boundary follow_up -> imm-autowork -> review`

However, the current Bun/TypeScript runtime does not yet implement the promised lifecycle:

- `imm-autowork` acts as a checkpoint snapshot and does not progress an ordinary ready-for-review Step into QA.
- `imm-work status --json` does not expose the required `can_auto_advance` or equivalent continuation signal.
- `imm-autowork` can report `complete` and recommend `imm-compounder` after material file changes without surfacing a required code or UI review gate.
- Review pass is not persisted, so the runtime cannot distinguish an unreviewed changed surface from a reviewed changed surface, or reopen review after a same-boundary repair changes files.
- `imm-loop` is a Skill, not a shell command. It should remain the independent user-facing Skill, but it needs runtime state and recording helpers to make the loop recoverable and non-manual.

## 3. Requirements

### R1. `imm-loop` remains an independent Skill

- `imm-loop` is the user-facing post-Plan completion Skill.
- Do not collapse `imm-loop` into `imm-autowork` or rename it to a generic dispatcher.
- Do not add a generic background scheduler or platform-wide workflow registry.
- Runtime helpers may be added only to support `imm-loop` state, review pass persistence, and recoverable reviewer routing.

### R2. Ordinary Plan progression crosses execution and QA boundaries automatically

- After a validated Plan is synced, `imm-autowork` must activate the next eligible Step and surface the correct next boundary.
- A Step with recorded execution evidence and state `ready_for_review` must produce a QA boundary, not another execution-input boundary.
- QA `pass` must unlock the next eligible Step in the same explicit autowork or loop run.
- QA `rework` and QA `replan` remain safe stops and must not be bypassed.
- Step budget, rework budget, no-progress, tool-failure, missing-input, and unclear-verification stops remain explicit.

### R3. Review gates are selected and invoked by `imm-loop`

- Material code, behavior, contract, runtime, or test changes require `imm-code-review` before final completion.
- UI, visual, interaction, accessibility, responsive layout, localization, or design-contract changes require `imm-ui-review` before final completion.
- Mixed changes require both gates, with the pending sequence exposed to the loop.
- `imm-loop` must automatically invoke the pending reviewer Skill when a review gate is required, rather than returning a user-facing instruction to manually invoke it.
- Review Skills remain read-only reviewers. They produce pass, findings, blocker, or same-boundary `follow_up`; they do not implement fixes.

### R4. Review pass is persisted against the reviewed changed surface

- A review pass must be stored durably in the State Ledger or an adjacent loop state under `.imm/memory/`.
- The persisted review record must include the review gate, decision, reviewed changed files, a deterministic changed-files signature, evidence, reviewer Skill, and timestamp.
- A review pass only closes the matching changed-files signature.
- If same-boundary `follow_up` execution changes files, the affected gate must reopen for the new signature.
- Persisted review state must distinguish at least: not reviewed, pending, pass, follow-up required, blocked, and replan required.

### R5. Same-boundary follow-up repeats the review lifecycle

- A same-boundary `follow_up` from `imm-code-review` or `imm-ui-review` must be consumed as an execution target by `imm-autowork` and `imm-work`.
- After follow-up QA closure, `imm-loop` must re-enter the relevant review gate before final handoff.
- Multiple review/follow-up rounds are expected and must remain bounded by review-round and follow-up-round budgets.
- A cross-boundary finding, malformed follow-up, or unprovable repair boundary must stop and route back to planning.

### R6. Compounder handoff requires review lifecycle closure

- `imm-loop` must not hand off to `imm-compounder` while any required review gate is pending, failed, blocked, or stale against the current changed-files signature.
- Only after Plan work, QA closure, same-boundary follow-ups, and all required code/UI review passes are closed may `imm-loop` recommend compounder handoff.
- `imm-compounder` remains a terminal handoff; it does not repair or review.

### R7. Runtime and host contracts stay bounded

- Do not create `imm-autowork-driver`.
- Do not turn executor verification into QA `pass`.
- Do not make advisory review pass/fail a QA decision.
- Do not add a generic dispatcher, shared registry, background scheduler, or cross-session hidden repair queue.
- Preserve existing Plans and State Ledger files through backwards-compatible optional fields or a deterministic migration with tests.

## 4. Acceptance Criteria

- [ ] `imm-work status` or equivalent runtime status exposes a machine-readable continuation signal for activation, execution, QA, completion, and stop states.
- [ ] `imm-autowork` returns the correct QA boundary for `ready_for_review` Steps and can continue after QA `pass` to the next eligible Step during an explicit run.
- [ ] `imm-autowork` / loop status derives required `imm-code-review` and `imm-ui-review` gates from changed files and does not recommend compounder before those gates pass.
- [ ] A review pass can be recorded durably with a deterministic changed-files signature and later retrieved by loop status.
- [ ] A same-boundary `follow_up` repair invalidates or reopens the affected gate when its changed-files signature differs from the persisted pass.
- [ ] `imm-loop` Skill contract says it automatically invokes `imm-code-review` / `imm-ui-review` and records review closure, while preserving reviewer read-only authority.
- [ ] Focused tests cover ordinary Step progression, QA boundary continuation, review pass persistence, stale-pass reopening, mixed code/UI gates, follow-up resurfacing, budget stops, and compounder blocking.
- [ ] MCP and package tests expose any new runtime helper tools or status fields consistently across plugin-local runtime surfaces.
- [ ] No new generic dispatcher, background scheduler, `imm-autowork-driver`, runtime default QA pass, or reviewer implementation authority is introduced.

## 5. Non-goals

- Do not build a fully unattended background daemon.
- Do not make `imm-code-review` or `imm-ui-review` edit files.
- Do not persist raw review transcripts or large logs in the State Ledger.
- Do not solve every future reviewer type; this slice covers code review and UI review only.
- Do not reintroduce Python runtime as production fallback.
- Do not redesign the whole Skill registry or subagent activation catalog.

## 6. Dependencies

- `CONTEXT.md` canonical terms: Plan, Step, Skill, Executor, QA, State Ledger, Compounder.
- `IMMUNE.md` authority boundaries and L2S-WF guidance.
- `docs/specs/autowork-runtime-host.spec.md`.
- `docs/specs/run-completion-loop.spec.md`.
- `docs/specs/run-review-closure-runtime-gate.spec.md`.
- `docs/solutions/workflow.md` runtime host and run review gate learnings.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` and `plugins/immune-brain/runtime/imm_core.ts`.
- `plugins/immune-brain/dist/imm-loop.md`, `plugins/immune-brain/dist/imm-autowork.md`, `plugins/immune-brain/dist/imm-code-review.md`, and `plugins/immune-brain/dist/imm-ui-review.md`.
- `tests/runtime-state.test.ts`, `tests/autowork-false-completion.test.ts`, `tests/plugin-package-runtime.test.ts`, and new focused Bun runtime tests.
