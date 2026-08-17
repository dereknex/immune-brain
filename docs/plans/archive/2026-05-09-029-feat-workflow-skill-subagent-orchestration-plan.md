---
title: feat: add workflow skill subagent orchestration
type: feat
status: planned
date: 2026-05-09
origin: user requested a planner review of workflow skills and corresponding subagent orchestration rules
---

# Iteration Plan

## Task
- Summary: Add a repo-local orchestration contract that decides when workflow skills split into subagents, how reviewer subagents converge before planning or work, and how failure fallback and conflict arbitration are handled
- Origin: The user asked to review the workflow skills and plan the corresponding subagents with four explicit rules: split only when multi-role/review/audit pressure is real, keep the `imm-brainstorm -> imm-preplan-review -> imm-planner -> imm-work -> imm-executor/imm-qa -> imm-finish` chain, converge parallel reviewers before `imm-planner` or `imm-work`, and resolve failures by retry-once then main-flow fallback with fixed arbitration priority.
- Research: Checked `IMMUNE.md`, `.imm/specs/skill-trigger-template-routing.spec.md`, `docs/plans/2026-05-09-028-feat-skill-trigger-template-routing-plan.md`, `system-subagents-design` manifest/output guidance, `workflow-trigger-repair`, `imm-code-review`, `security-reviewer`, `api-contract-reviewer`, and `imm-work`. Conclusion: the repo already has the role boundaries and trigger-only reviewer slices, but it lacks a single planning slice that decides when those slices should actually participate in a workflow and how their outputs should be reconciled.
- Decisions: D1 choose `Hold Scope` and keep this slice on orchestration contract only, not runtime automation; D2 preserve the existing authority chain and keep `imm-work` as the post-plan continue entry; D3 keep `imm-code-review` as the broad review baseline while `security-reviewer` and `api-contract-reviewer` remain explicit conditional reviewers; D4 require retry-once fallback and a fixed `security > performance > compatibility > readability` arbitration order so planner/work can close conflicting reviewer advice without inventing ad hoc policy each time.
- Assumptions: The user wants a reusable orchestration design, not immediate implementation of a classifier or dispatcher; existing reviewer skills remain the source of truth for trigger surfaces and write boundaries; manual validation is acceptable if truthful orchestration cannot be fully unit-tested locally.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, `docs/plans/2026-05-09-029-feat-workflow-skill-subagent-orchestration-plan.md`, `README.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: the workflow can truthfully explain when it stays solo, when it adds bounded reviewer subagents, how it preserves the existing activation chain, and how it resolves failure or conflicting reviewer output
      - method: planning artifacts plus focused contract verification and manual contract inspection where runtime orchestration is not locally executable
  - blockers: none, as long as the slice stays on orchestration truth and does not expand into a generic classifier, shared dispatcher, or execution-time automation engine
  - replan_condition: if implementation starts requiring new workflow state fields, automatic fan-out scheduling, cross-agent communication, or role-boundary changes, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: The repo has one dedicated spec for workflow skill subagent orchestration
- Verification: `.imm/specs/workflow-skill-subagent-orchestration.spec.md` exists as the single source of truth for split gate, activation sequence, reviewer convergence, and fallback/arbitration rules.
- Test scenarios: Covers split-versus-solo gate; Covers activation sequence preservation; Covers fallback/arbitration contract presence
- Depends on: none
- Scope: `.imm/specs/workflow-skill-subagent-orchestration.spec.md`
- Replan condition: If the contract cannot be expressed without inventing a generic runtime orchestration engine or changing existing role authority, stop and return to preplan.

### Step 2
- Step ID: U2
- Result: README publishes the orchestration contract for end users
- Verification: `README.md` describes when the workflow stays solo, when bounded reviewers join, and why `imm-work` remains the default continue entry after planning.
- Test scenarios: Covers split gate explanation; Covers conditional reviewer participation; Covers continue-entry preservation
- Depends on: 1
- Scope: `README.md`
- Replan condition: If alignment requires broader workflow-document rewrites outside the orchestration slice, keep the spec narrow and replan the wider documentation work separately.

### Step 3
- Step ID: U3
- Result: The workflow skill contracts align to the orchestration rules
- Verification: `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, and `skills/imm-work/SKILL.md` describe split gating, stage sequencing, and continue-entry behavior consistently with the spec.
- Test scenarios: Covers preplan conditionality; Covers activation-sequence preservation; Covers continue-entry wording
- Depends on: 2
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`
- Replan condition: If alignment requires new skill families, merged authority roles, or a wider orchestration model, stop and return to preplan.

### Step 4
- Step ID: U4
- Result: The reviewer skill contracts align to the orchestration rules
- Verification: `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, and `skills/api-contract-reviewer/SKILL.md` describe baseline-versus-conditional reviewer participation, trigger-only posture, and fallback behavior consistently with the spec.
- Test scenarios: Covers baseline-vs-conditional reviewer distinction; Covers trigger-only reviewer posture; Covers retry/fallback wording
- Depends on: 3
- Scope: `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`
- Replan condition: If reviewer alignment requires a shared reviewer platform or default multi-reviewer fan-out, stop and return to preplan.

### Step 5
- Step ID: U5
- Result: Focused verification guards the orchestration contract against drift
- Verification: `tests/test_skill_contracts.py` or an equivalent focused check proves that split gating remains conditional, reviewer subagents remain trigger-only, `imm-work` remains the post-plan continue entry, and fallback/arbitration rules remain documented and traceable.
- Test scenarios: Covers no-default-split behavior; Covers conditional `security-reviewer` and `api-contract-reviewer`; Covers retry-once then main-flow fallback; Covers fixed arbitration order
- Depends on: 4
- Scope: `tests/test_skill_contracts.py` and only supporting wording needed for traceability in spec or README
- Replan condition: If truthful verification requires a new orchestration harness or provider-specific runtime automation, keep verification contract-level and replan broader execution support separately.

## Notes
- This slice defines orchestration policy, not the execution engine that may consume it later.
- Keep the workflow chain intact; reviewer subagents may add evidence, but they do not own scope, implementation, or QA closure.
- Preserve the repo rule that conditional reviewers stay opt-in or trigger-based rather than becoming default ceremony.
