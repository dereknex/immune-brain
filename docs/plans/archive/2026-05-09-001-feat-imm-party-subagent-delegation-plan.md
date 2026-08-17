---
title: feat: enable imm-party subagent delegation
type: feat
status: completed
date: 2026-05-09
origin: user request to continue subagents implementation, narrowed by brainstorm and preplan review
---

# Iteration Plan

## Task
- Summary: Implement the first runtime-level subagent slice by making `imm-party` explicit delegation executable and verifiable
- Origin: User asked to continue subagents implementation. `imm-brainstorm` narrowed the work to an `imm-party` first runtime slice, and `imm-preplan-review` chose `Scope Reduction` so the next step is planning a bounded delegation path rather than broad subagent infrastructure.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/imm-brainstorm-subagents-runtime-slice-2026-05-09.md`, `skills/imm-party/SKILL.md`, `.imm/specs/party-mode-advisory.spec.md`, `.imm/specs/workflow-trigger-repair.spec.md`, `docs/solutions/advisory-roundtable-layer.md`, and `docs/solutions/tested-skill-contracts.md`. Conclusion: the repo already has advisory-layer governance and a broad trigger-repair plan, but still lacks an execution-ready `imm-party` delegation contract with a clear bounded packet, explicit fallback reasons, and a two-layer verification path.
- Decisions: D1 keep `Scope Reduction` and implement only the `imm-party` explicit delegation slice; D2 keep the implementation repo-local to skill/spec/test surfaces instead of inventing a generic runtime registry; D3 treat real sub-agent spawning as a Codex runtime capability that may require manual validation, while local automated checks guard the routing contract; D4 require named fallback reasons and advisory-only prompt bounds so the runtime path cannot silently impersonate scope or execution authority.
- Assumptions: Codex runtime can expose a usable sub-agent delegation mechanism for manual verification; focused text-based regression is sufficient to guard the local contract; current work does not require README-wide rewrites unless contract drift is discovered.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `skills/imm-party/SKILL.md`, `tests/test_skill_contracts.py`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `.imm/specs/workflow-trigger-repair.spec.md`, `docs/plans/2026-05-09-001-feat-imm-party-subagent-delegation-plan.md`
  - dependencies_known: true
  - verification_path:
      - target: explicit multi-agent requests use a bounded delegation path when available and an explicit solo fallback when unavailable
      - method: focused local contract regression plus Codex runtime manual check
  - blockers: real delegation may not be fully unit-testable outside Codex runtime, so the plan must preserve a manual validation step instead of pretending full local automation
  - replan_condition: if execution requires a generic subagent registry, shared capability detector, non-advisory runtime integration, or cross-agent communication, stop and return to preplan instead of widening this slice

## Steps

### Step 1
- Step ID: U1
- Result: `imm-party` exposes an execution-ready delegation contract for explicit independent-agent requests
- Verification: `skills/imm-party/SKILL.md` and supporting spec text define the explicit trigger boundary, `2-4` role cap, bounded delegation packet fields, advisory-only prompt constraints, and named solo fallback reasons.
- Status: completed
- Test scenarios: Covers IMM-PARTY-002 R1; Covers IMM-PARTY-002 R2; Covers IMM-PARTY-002 R3; Covers IMM-PARTY-002 acceptance criteria 1; Covers IMM-PARTY-002 acceptance criteria 2; Covers IMM-PARTY-002 acceptance criteria 3
- Depends on: none
- Scope: `skills/imm-party/SKILL.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, and only supporting workflow docs if contract wording must be aligned
- Replan condition: If making the contract execution-ready requires a shared runtime registry, cross-skill capability layer, or broader authority changes, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: focused regression guards the explicit delegation contract
- Verification: `tests/test_skill_contracts.py` or an equivalent focused regression asserts the explicit-request trigger, bounded delegation packet fields, named fallback reasons, and no authority escalation rules.
- Status: completed
- Depends on: 1
- Scope: `tests/test_skill_contracts.py`, `skills/imm-party/SKILL.md`, and only supporting spec wording needed for traceability
- Replan condition: If regression coverage needs a new workflow harness or external orchestrator edits to stay truthful, keep tests contract-only and replan broader runtime integration separately.

### Step 3
- Step ID: U3
- Result: Codex runtime manual validation path is documented for real sub-agent spawning versus solo fallback
- Verification: The spec or plan records a concrete manual check for a real explicit multi-agent request, including what should happen when sub-agents are available and what fallback wording should appear when they are not.
- Status: completed
- Test scenarios: Covers IMM-PARTY-002 R4; Covers IMM-PARTY-002 acceptance criteria 5; Covers IMM-PARTY-002 acceptance criteria 6
- Depends on: 1
- Scope: `.imm/specs/imm-party-subagent-delegation.spec.md` and `docs/plans/2026-05-09-001-feat-imm-party-subagent-delegation-plan.md` only
- Replan condition: If truthful runtime validation requires persistent fixtures, a provider-specific harness, or non-repo platform automation, document the manual path and stop expanding the slice.

## Notes
- Keep this slice surgical: it is the first runtime-level subagent path, not the start of a generic subagent platform.
- Prefer reusing existing contract-test entry points over inventing a new validator.
- Manual Codex runtime validation is acceptable when the repo cannot truthfully simulate delegation end to end.
