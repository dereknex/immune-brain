---
title: feat: define subagent runtime MVP host
type: feat
status: planned
date: 2026-05-10
origin: user-requested `imm-brainstorm` analysis of current subagent implementation, followed by `imm-planner` handoff to plan the next narrow slice
---

# Iteration Plan

## Task
- Summary: Define a narrow subagent runtime MVP that makes `imm-code-review` the first real delegation host while preserving existing reviewer boundaries and avoiding shared-platform expansion.
- Origin: The user asked to analyze the current subagent implementation status and plan the next task. The review shows contracts, skill hosts, and regression guards are in place, but the repo still lacks a truthful, shared runtime delegation path.
- Research: Checked `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/imm-party/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`, `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, `.imm/specs/skill-trigger-template-routing.spec.md`, `.imm/specs/default-subagent-first-activation.spec.md`, `.imm/specs/security-reviewer-runtime.spec.md`, `.imm/specs/remaining-first-batch-runtime-activation.spec.md`, `.imm/imm-plan.py`, `.imm/imm-work.py`, and `tests/test_skill_contracts.py`. Conclusion: repo-local truth already supports `subagent-first`, but actual shared runtime delegation is still missing; the smallest next step is a single explicit host.
- Decisions: D1 keep scope narrow and define only one runtime host, `imm-code-review`; D2 reuse existing `security-reviewer` and `api-contract-reviewer` skill surfaces instead of adding new reviewer types; D3 treat `spawn_agent` activation as an execution-facing skill contract plus focused/manual validation, not as a new shared registry or dispatcher; D4 preserve advisory-only reviewer boundaries and explicit solo fallback.
- Assumptions: The next implementation slice should prioritize truthful runtime behavior over adding more named reviewers; Codex runtime can be manually validated even if the repo cannot automate end-to-end delegation; the user wants a plan for the next real capability step, not another docs-only inventory pass.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/subagent-runtime-mvp.spec.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`, `README.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: one shared host can explicitly activate bounded reviewer subagents with layered packets, retry/fallback discipline, and preserved reviewer boundaries
      - method: focused contract assertions plus Codex runtime manual validation for available/unavailable delegation scenarios
  - blockers: none, as long as the slice stays on one explicit host and does not expand into runtime platform work
  - replan_condition: if truthful implementation requires a shared registry, automatic reviewer dispatch, `imm-work` automation, or more than the two named child reviewers, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: The runtime MVP boundary is codified around a single explicit host.
- Verification: `.imm/specs/subagent-runtime-mvp.spec.md` and `skills/imm-code-review/SKILL.md` both state that `imm-code-review` is the first shared runtime host, the child paths are limited to `security-reviewer` and `api-contract-reviewer`, and this slice does not introduce a shared registry or automatic dispatcher.
- Agent Hint: imm-code-review
- Test scenarios: Covers single-host runtime MVP; Covers no-registry truth; Covers bounded child reviewer set
- Depends on: none
- Scope: `.imm/specs/subagent-runtime-mvp.spec.md`, `skills/imm-code-review/SKILL.md`
- Replan condition: If the host boundary cannot be described without widening into platform work, stop and return to planner.

### Step 2
- Step ID: U2
- Result: Reviewer delegation contracts align to real runtime activation without changing authority.
- Verification: `skills/security-reviewer/SKILL.md` and `skills/api-contract-reviewer/SKILL.md` explicitly describe the layered packet inputs, advisory-only posture, retry/fallback expectations, and non-default gate behavior under delegated runtime use.
- Agent Hint: security-reviewer
- Test scenarios: Covers layered packet inputs; Covers advisory-only delegated reviewer posture; Covers non-default gate preservation
- Depends on: 1
- Scope: `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`
- Replan condition: If reviewer alignment requires code-edit authority, plan-write authority, or broader roster changes, stop and return to planner.

### Step 3
- Step ID: U3
- Result: Shared user-facing truth documents the runtime delegation trigger boundary.
- Verification: `README.md` and the manual-validation section of `.imm/specs/subagent-runtime-mvp.spec.md` clearly describe trigger-based delegation, allowed fallback reasons, and available/unavailable runtime expectations without weakening the workflow chain.
- Agent Hint: imm-planner
- Test scenarios: Covers user-facing runtime-host truth; Covers explicit solo fallback reasons; Covers manual validation path
- Depends on: 2
- Scope: `README.md`, `.imm/specs/subagent-runtime-mvp.spec.md`
- Replan condition: If user-facing truth requires broader workflow rewrites outside the runtime MVP boundary, stop and return to preplan.

### Step 4
- Step ID: U4
- Result: Focused regression guards the runtime MVP contract from drifting back to contract-only prose.
- Verification: `tests/test_skill_contracts.py` asserts that `imm-code-review` is an explicit runtime host, delegated reviewers require layered packets and explicit fallback reasons, and the slice still rejects shared registry or automatic dispatch claims.
- Agent Hint: imm-qa
- Test scenarios: Covers runtime-host assertion; Covers fallback-reason assertion; Covers no-platform-expansion assertion
- Depends on: 3
- Scope: `tests/test_skill_contracts.py`
- Replan condition: If truthful verification requires a new runtime harness or non-focused integration framework, keep this slice contract-level and replan broader execution support separately.

## Notes
- This plan intentionally picks the smallest real delegation surface instead of expanding the named reviewer roster.
- The target is not “full subagent automation”; the target is “one honest, shared runtime path that proves the repo can move from contract truth to execution-facing truth.”
