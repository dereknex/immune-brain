# Iteration Plan: Review Follow-up Dual-Track Closure Contracts

## Task

- Summary: Align QA, work routing, and code review contracts so reviewer `follow_up` artifacts can execute and close through the Dual-Track loop
- Origin: imm-code-review
- Spec: `.imm/specs/review-followup-dual-track-closure-contracts.spec.md`

## Research

- `imm-code-review` found that `skills/imm-qa/SKILL.md` still only describes active Plan step closure.
- `imm-code-review` found that `skills/imm-work/SKILL.md` Next Action still gates on validated Plan plus active step.
- `imm-code-review` found that `skills/imm-code-review/SKILL.md` still contains stale `append_to_plan` wording.
- The prior Dual-Track plan is already closed, so this is a new same-boundary follow-up slice rather than a rewrite of closed history.

## Decisions

- D1: Treat the three findings as one outcome because they describe one broken closure contract.
- D2: Keep the slice documentation-only and avoid runtime Python changes.
- D3: Preserve planner routing for broader or cross-boundary review findings.

## Assumptions

- The `follow_up` handoff remains a lightweight session artifact rather than persistent state.
- Existing `imm-work record-execution` and `imm-review` commands remain the evidence recording path.

---

### Step 1

- Step ID: U1
- Result: Reviewer follow-up closure contract is documented end-to-end
- Verification: `rg -n "follow_up" skills/imm-qa/SKILL.md skills/imm-work/SKILL.md skills/imm-code-review/SKILL.md` returns matches and `rg -n "append_to_plan" skills/imm-code-review/SKILL.md` returns no matches
- Depends on: None
