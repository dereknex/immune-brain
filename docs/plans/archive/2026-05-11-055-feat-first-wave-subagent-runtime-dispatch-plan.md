---
title: feat: first-wave subagent runtime dispatch
type: feat
status: closed
date: 2026-05-11
origin: `/imm-brainstorm` gap analysis → `/imm-planner` plan creation; brainstorm identified runtime dispatch as the core gap between governance contracts and usable subagent delegation
---

# Iteration Plan

## Task
- Summary: Enable first-wave subagent hosts (imm-code-review, imm-party, imm-ui-review) to autonomously detect environment capabilities, decide which child subagents to invoke based on task triggers, dispatch via platform-native tools, collect and synthesize results, and handle exceptions with standardized retry and solo fallback.
- Origin: Brainstorm confirmed all 9 reviewers have standalone SKILL.md and delegation packet contracts, but no host skill contains executable dispatch instructions — dispatch stays at principle-level prose with no environment detection, no invocation templates, no result parsing, and no exception handling logic.
- Research: imm-code-review is first shared runtime host (children: security-reviewer, api-contract-reviewer); imm-party validated shared_context_summary + focus_delta packet; imm-ui-review has delegation packet wording; all 9 reviewers define Required inputs; BASELINE.md defines Subagent Delegation Packet structure; Cursor runtime offers Task tool (subagent_type: generalPurpose); Codex offers spawn_agent; 56 contract tests pass; subagent-runtime-mvp.spec.md Accepted but §7 manual validation never executed.
- Decisions: D1 shared dispatch protocol lives as reference doc not code library; D2 host skills reference protocol not inline full logic; D3 environment detection is runtime-agnostic (Cursor Task / Codex spawn_agent); D4 exception standard is retry-1x then solo-fallback with reason code; D5 conflict resolution keeps security > performance > compatibility > readability; D6 no changes to .imm/*.py CLI tools.
- Assumptions: Cursor Task tool is stable enough for bounded subagent dispatch; child reviewer Required inputs contracts need no changes; contract tests can verify dispatch wording in host skills.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: docs/reference/subagent-dispatch-protocol.md, skills/imm-code-review/SKILL.md, skills/imm-party/SKILL.md, skills/imm-ui-review/SKILL.md, tests/test_skill_contracts.py
  - dependencies_known: true
  - verification_path:
      - target: 3 hosts contain dispatch instructions referencing shared protocol; contract tests pass; at least one real dispatch or documented solo fallback
      - method: python3 -m unittest tests.test_skill_contracts and manual Cursor dispatch attempt
  - blockers: none
  - replan_condition: if Cursor Task tool cannot reliably dispatch subagents or child reviewer contracts need structural redesign, stop and return to imm-preplan-review

## Steps

### Step 1
- Step ID: U1
- Result: imm-code-review contains executable dispatch instructions — referencing a new shared protocol doc — that cover the full dispatch lifecycle from environment detection through exception handling.
- Verification: `docs/reference/subagent-dispatch-protocol.md` exists and contains sections for all 6 dispatch phases (environment detection, trigger matching, delegation prompt construction, platform dispatch invocation, result collection and synthesis, exception handling); `skills/imm-code-review/SKILL.md` contains a Dispatch Protocol section that explicitly references the shared protocol; `python3 -m unittest tests.test_skill_contracts` passes with new assertions verifying dispatch protocol presence in imm-code-review.
- Agent Hint: imm-executor
- Test scenarios: Covers protocol doc creation with 6 phases; Covers imm-code-review dispatch integration; Covers contract regression with new dispatch assertions
- Depends on: none
- Scope: docs/reference/subagent-dispatch-protocol.md, skills/imm-code-review/SKILL.md, tests/test_skill_contracts.py
- Replan condition: If dispatch protocol requires changes to child reviewer Required inputs contracts or BASELINE.md Delegation Packet structure, stop and reassess scope.

### Step 2
- Step ID: U2
- Result: imm-party plus imm-ui-review each contain executable dispatch instructions referencing the shared protocol — completing dispatch coverage across all three hosts.
- Verification: `skills/imm-party/SKILL.md` contains updated dispatch instructions referencing `docs/reference/subagent-dispatch-protocol.md`; `skills/imm-ui-review/SKILL.md` contains dispatch instructions referencing the same protocol; `python3 -m unittest tests.test_skill_contracts` passes with dispatch assertions covering all three hosts; exception handling standards (retry, solo fallback, reason code, conflict resolution) appear in the shared protocol and are referenced by all three hosts.
- Agent Hint: imm-executor
- Test scenarios: Covers imm-party dispatch integration; Covers imm-ui-review dispatch integration; Covers exception standard consistency across hosts; Covers full contract regression
- Depends on: 1
- Scope: skills/imm-party/SKILL.md, skills/imm-ui-review/SKILL.md, docs/reference/subagent-dispatch-protocol.md, tests/test_skill_contracts.py
- Replan condition: If imm-party delegation_mode or imm-ui-review preflight checks conflict with dispatch protocol, stop and reconcile before proceeding.

### Step 3
- Step ID: U3
- Result: Spec §4 acceptance criteria are closed with documented evidence of real subagent dispatch or correct solo fallback from at least one host in Cursor runtime.
- Verification: Documented evidence exists showing either (a) a successful Task tool dispatch where child reviewer returned findings that were synthesized into host output, or (b) a solo fallback with standard reason code when dispatch was unavailable; `.imm/specs/first-wave-subagent-runtime-dispatch.spec.md` section 4 acceptance criteria are all marked `[x]` with evidence pointers; `python3 -m unittest tests.test_skill_contracts` still passes.
- Agent Hint: imm-qa
- Test scenarios: Covers real runtime dispatch or documented solo fallback; Covers spec acceptance closure; Covers contract test stability
- Depends on: 2
- Scope: .imm/specs/first-wave-subagent-runtime-dispatch.spec.md, runtime evidence (Cursor session or documented fallback)
- Replan condition: If Cursor Task tool dispatch fails structurally (not just environment-specific), return to imm-preplan-review to reassess dispatch approach.

## Notes
- This plan does not introduce a generic subagent registry, automatic dispatcher, agent-to-agent communication, or changes to .imm/*.py CLI tools.
- Second-wave reviewers (data-integrity, reliability, release-readiness, debug-investigator) are explicitly out of scope.
- The dispatch protocol is designed to be provider-agnostic: same skill text works across Cursor (Task tool) and Codex (spawn_agent).
