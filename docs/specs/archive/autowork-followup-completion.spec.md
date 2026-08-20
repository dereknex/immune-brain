# Spec: autowork follow-up completion

## 1. Goal

Update `imm-autowork` so an explicit autowork run can advance both ordinary
validated Plan Steps and pending reviewer `follow_up` execution targets to their
safe completion boundary.

## 2. Background

`imm-autowork` is a scheduler wrapper around `imm-work`, `imm-executor`, and
`imm-qa`. It currently stops whenever `imm-work status --json` reports
`can_auto_advance: false`, including when the current Plan is complete.

That is correct for normal Plan completion, but it creates a misleading route
when a reviewer has already produced a pending same-boundary `follow_up`.
`imm-work` can consume that `follow_up` as a lightweight execution target, so
autowork should keep driving through `imm-work` until that follow-up also
reaches QA closure or a safe blocker.

## 3. Requirements

### R1. Autowork accepts two bounded execution targets

- `imm-autowork` must still require an explicit user opt-in.
- It may start from either:
  - a validated Plan with an executable Step, or
  - a pending reviewer `follow_up` handoff with `scope`, `change_goal`,
    `verification_hint`, and `origin_review`.
- Without either target, it must route to `imm-planner` instead of editing.

### R2. Plan advancement still obeys `can_auto_advance`

- For ordinary Plan Step progression, `imm-autowork` must continue to use
  `can_auto_advance` from `imm-work status --json`.
- `can_auto_advance: false` still stops autowork for rework, replan, blocker,
  budget exhaustion, or true completion.
- The wrapper must not reinterpret rework or replan states as follow-up work.

### R3. Pending follow-up can extend a completed-plan run

- If `can_auto_advance: false` only because the Plan is complete, but the
  current context includes a pending reviewer `follow_up`, autowork should
  continue by invoking `imm-work` to consume that follow-up.
- Follow-up execution still flows through `imm-work -> imm-executor -> imm-qa`.
- After the follow-up closes, autowork may proceed to compounder; before that,
  it must not report the run as complete.

### R4. Scope remains narrow

- Do not add a background queue, cross-session follow-up persistence, or new
  runtime state store.
- Do not make `imm-autowork` the default continuation path.
- Do not let autowork bypass executor edits, QA closure, or planner replan.

## 4. Acceptance Criteria

- [ ] `skills/imm-autowork/SKILL.md` says autowork advances Plan Steps and
  pending reviewer `follow_up` execution targets.
- [ ] The skill contract preserves `can_auto_advance` for Plan Step progression
  while documenting the completed-plan-plus-follow-up exception.
- [ ] The workflow guard allows a validated Plan or pending `follow_up`, not
  only a validated Plan with `can_auto_advance: true`.
- [ ] Focused contract tests cover the new autowork follow-up behavior.

