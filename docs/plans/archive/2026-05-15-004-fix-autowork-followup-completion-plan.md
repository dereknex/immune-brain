# Iteration Plan: Autowork Follow-up Completion

## Task

- Summary: Let explicit `imm-autowork` runs advance both validated Plan Steps and pending reviewer `follow_up` execution targets to completion.
- Origin: Direct user decision after `imm-brainstorm`: "autowork修改为推进plan和follow up完成".
- Spec: `.imm/specs/autowork-followup-completion.spec.md`

## Research

- `skills/imm-autowork/SKILL.md` currently says autowork stops at `can_auto_advance: false`, budget exhaustion, or plan completion.
- `skills/imm-work/SKILL.md` already supports a dual-track target: an active Plan Step or a pending reviewer `follow_up` handoff.
- `skills/imm-qa/SKILL.md` already supports evidence verification for either an active Plan Step or a reviewer `follow_up` execution target.
- `docs/solutions/reviewer-followup-closure-contract.md` says `follow_up` is an execution artifact consumed by `imm-work`, not a Plan mutation.
- Runtime `can_auto_advance` is still Plan-state-based; pending `follow_up` is a conversation artifact, so this slice should update the autowork skill contract and focused tests rather than invent persistence.

## Decisions

- Use `new_slice`; this changes autowork orchestration semantics after an already completed plan.
- Keep `imm-work` as the authority driver. Autowork schedules through it; it does not execute or QA directly.
- Preserve `can_auto_advance` for Plan Step progression and add only one exception: completed Plan plus pending reviewer `follow_up` in current context.
- Do not add a background repair queue, cross-session follow-up store, or default autowork continuation.

## Assumptions

- Pending reviewer `follow_up` remains a lightweight session/context artifact.
- The absence of a pending `follow_up` still means a completed Plan should route to `imm-compounder`.
- Existing `imm-work` and `imm-qa` contracts are sufficient for follow-up execution and closure.

---

### Step 1

- Step ID: U1
- Result: `imm-autowork` includes pending reviewer `follow_up` completion in its target policy
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero
- Depends on: None
- Execution note: test-first
- failure_behavior: If this contract is wrong, autowork may still stop at plan completion while a known same-boundary follow-up remains unresolved.
- security_considerations: None; this changes local workflow guidance and contract tests only.

## Test scenarios

- `imm-autowork` names both validated Plan Steps and pending reviewer `follow_up` execution targets.
- `imm-autowork` preserves `can_auto_advance` for ordinary Plan Step progression.
- `imm-autowork` documents that completed Plan plus pending `follow_up` continues through `imm-work`, not `imm-compounder`.
