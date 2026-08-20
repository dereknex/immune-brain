# Spec: Run Completion Loop

**Task ID**: IMM-RUN-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Make `run` the outer completion loop that can repeatedly drive:

`imm-autowork -> review -> same-boundary follow_up -> imm-autowork -> review`

until the work is complete, blocked, requires replan, or reaches an explicit
budget stop.

This must automate the current manual pattern without adding a new post-planner
Skill, `imm-autowork-driver`, background scheduler, generic dispatcher, or
runtime default QA pass.

## 2. Background

Immune-Brain already has the building blocks:

- `imm-autowork` can advance validated Plan Steps and pending reviewer
  `follow_up` targets through `imm-work`, Executor, and QA boundaries.
- `imm-code-review` and `imm-ui-review` can produce same-boundary `follow_up`
  handoffs with `scope`, `change_goal`, `verification_hint`, and
  `origin_review`.
- `run` already names the user-facing L2S-WF execution entry and describes
  autowork, review, follow-up return, and compounder handoff.

The missing contract is not another execution Skill. The missing contract is
that `run` owns the outer completion loop: after material work, it invokes the
right review, consumes bounded follow-up through `imm-autowork`, and repeats the
review boundary until the review passes or a safe stop condition is reached.

## 3. Requirements

### R1. `run` is the outer completion loop

- `run` must be the single user-facing outer coordinator for validated Plan
  completion.
- It may coordinate `imm-autowork`, `imm-code-review`, `imm-ui-review`, and
  `imm-compounder` handoff.
- It must not implement code, issue QA decisions, mutate Plans, or replace
  reviewer authority.
- It must not create a new post-planner Skill such as `imm-run-loop` or
  `imm-autowork-driver`.

### R2. Review selection is explicit and scoped

- Material code, behavior, contract, runtime, or test changes require
  `imm-code-review` before final completion.
- UI, visual, interaction, accessibility, responsive layout, or design-contract
  changes require `imm-ui-review` before final completion (determined dynamically
  by changeset files matching `.css`, `.scss`, `.html`, `.tsx`, `.jsx`, path
  containing `view`, `component`, `layout`, `style`, `theme`, `locale`, `i18n`,
  or `DESIGN.md`).
- When invoking `imm-code-review` or `imm-ui-review`, `run` must pass explicit
  subagent activation intent so the review host may attempt bounded subagents
  through its own activation plan when trigger, authorization, environment, and
  cost gates allow it.
- When both surfaces are present, `run` may sequence both review gates or run
  bounded advisory review where the host supports it.
- Review remains read-only and produces findings or `follow_up`; it does not
  repair.

### R3. Same-boundary follow-up loops through autowork

- If review emits a same-boundary `follow_up`, `run` feeds that target back to
  `imm-autowork`.
- `imm-autowork` remains responsible only for driving the bounded execution
  target through `imm-work`, Executor evidence, and QA closure.
- After the follow-up closes, `run` returns to the relevant review gate.
- `run` repeats this loop until review passes, the next issue crosses scope, or
  a stop condition fires.

### R4. Stop conditions are first-class

`run` must stop and report the next boundary when any of these occurs:

- review passes and no required follow-up remains;
- review finding crosses the current boundary and requires `imm-planner`;
- QA returns `rework` or `replan`;
- a blocker, missing credentials, unclear verification target, or tool failure
  prevents progress;
- max review rounds, max follow-up rounds, max Step budget, or max rework
  budget is reached;
- repeated same error appears without a strategy change.

Budget stops are not failures and not passes. They are safe boundaries that
report what remains and which Skill should continue.

### R5. Completion hands off to compounder only after review closure

- `run` may report `imm-compounder` only when Plan work, required review gates,
  and same-boundary follow-up loops are closed.
- `run` must treat `imm-compounder` as a terminal handoff requiring explicit
  user intent when the underlying runtime marks it `handoff_only`.
- `run` must not invoke compounder automatically from the same loop when a
  review gate is still pending.

### R6. Machine-readable status stays bounded

- `run_status` should expose enough information for the host to resume the
  loop: active Plan, autowork progress, review status, follow-up status, budget
  state, stop reason, and next recommended entry.
- This status must not become a new State Ledger authority or background queue.
- Existing `.imm/memory/current_iteration.json` and `imm-work` state remain the
  runtime source of truth.

### R7. Runtime follow-up classification

- This slice is contract-only after adoption: `run` guidance, README guidance,
  and focused contract tests are the executable boundary.
- No State Ledger schema change belongs to this Plan.
- If later work needs a host runtime wrapper for `run`, it must be promoted
  through a future Plan with its own compatibility and authority review.

## 4. Acceptance Criteria

- [ ] `plugins/immune-brain/dist/run.md` documents `Run Completion Loop`,
      review selection, repeated same-boundary follow-up, explicit stop
      conditions, explicit subagent activation intent, and compounder
      handoff only after review closure.
- [ ] `README.md` documents that `run` is the L2S-WF completion loop after a
      validated Plan, including code review, UI review, follow-up return, and
      stop conditions.
- [ ] Focused tests prove the run contract carries explicit subagent
      activation intent across the skill contract, user-facing docs, and Spec
      without promising unconditional subagent dispatch.
- [ ] Focused contract tests prove the run contract rejects a new
      post-planner Skill, `imm-autowork-driver`, generic dispatcher, background
      scheduler, and runtime default QA pass.
- [ ] Focused tests prove `run_status` includes review status, follow-up
      status, budget state, stop reason, and next recommended entry.
- [ ] Focused tests prove the current slice is contract-only, with no State
      Ledger schema change and any host runtime wrapper deferred to a future
      Plan.
- [ ] The current Plan validates with `imm-plan --json`.

## 5. Non-goals

- Do not add a new Skill after `imm-planner`.
- Do not add `imm-autowork-driver`.
- Do not make `imm-autowork` the final completion owner.
- Do not let executor verification become QA `pass`.
- Do not build a generic workflow dispatcher, shared registry, background
  repair queue, or cross-session review scheduler.
- Do not change the State Ledger schema in this slice.
- Do not automatically run `imm-compounder` without a terminal handoff and user
  intent.

## 6. Dependencies

- `CONTEXT.md` canonical terms: `Plan`, `Step`, `Executor`, `QA`, `State Ledger`,
  `Fast-Track`, and `HANDOFF.md`.
- `IMMUNE.md` L2S-WF and authority-boundary guidance.
- `plugins/immune-brain/dist/run.md` current `run` contract.
- `plugins/immune-brain/dist/imm-autowork.md` deterministic checkpoint runtime
  contract.
- `plugins/immune-brain/dist/imm-code-review.md` and
  `plugins/immune-brain/dist/imm-ui-review.md` `follow_up` contracts.
- `docs/specs/autowork-followup-completion.spec.md`.
- `docs/specs/review-followup-work-entry-dual-track.spec.md`.
- `docs/solutions/rejected-autowork-driver-default-pass.md`.
- `docs/solutions/rejected-shared-registry-generic-dispatcher.md`.
