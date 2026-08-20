# Spec: Review Follow-up Dual-Track Closure Contracts

**Task ID**: IMM-WORK-002
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Close the contract gaps found by `imm-code-review` after the Dual-Track work entry slice.
The prior slice established `follow_up` as an execution artifact, but the closure path still
needs to say how QA validates follow-up evidence, how `imm-work` routes follow-up targets, and
how `imm-code-review` avoids stale `append_to_plan` wording for direct same-boundary fixes.

## 2. Origin

`imm-code-review` reviewed the current working-tree diff and reported three same-boundary
follow-up issues:

- `imm-qa` still describes closure in active Plan step terms only.
- `imm-work` Next Action gate still requires a validated Plan plus active step.
- `imm-code-review` still has stale planner append wording that conflicts with direct
  `follow_up -> imm-work` routing.

## 3. Requirements

### R1. QA can close follow-up evidence

`skills/imm-qa/SKILL.md` must explicitly allow QA to validate recorded evidence for either an
active Plan step or a pending reviewer `follow_up` execution target. It must preserve the same
evidence-first standard and continue to reject optimistic pass decisions.

### R2. Work routing gate accepts follow-up targets

`skills/imm-work/SKILL.md` must align its Next Action gate with the Dual-Track decision tree:
a validated Plan active step or pending `follow_up` can route into executor or QA semantics.

### R3. Code review handoff text no longer advertises append for direct fixes

`skills/imm-code-review/SKILL.md` must remove stale `append_to_plan` guidance from direct
same-boundary follow-up routing. Broader or cross-boundary issues may still route to a new
follow-up plan.

## 4. Non-goals

- Do not change runtime Python behavior in this slice.
- Do not rewrite the completed Dual-Track plan or its closed step history.
- Do not add persistent `follow_up` storage.
- Do not expand into README or UI review wording unless needed to keep the three contracts
  consistent.

## 5. Acceptance

- `skills/imm-qa/SKILL.md` mentions `follow_up` in its evidence and verification rules.
- `skills/imm-work/SKILL.md` Next Action gate accepts `follow_up`.
- `skills/imm-code-review/SKILL.md` no longer mentions `append_to_plan`.

