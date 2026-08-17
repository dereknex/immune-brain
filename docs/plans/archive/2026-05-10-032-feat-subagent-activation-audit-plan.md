---
title: feat: audit subagent activation strategy and guard solo fallback
type: feat
status: completed
date: 2026-05-10
origin: user requested planner follow-up to lock default subagent activation policy and fallback condition
---

# Iteration Plan

## Task
- Summary: Validate that repo workflow documents and SKILL contracts currently enforce a default-subagent-first strategy with explicit solo fallback, and produce a bounded mismatch report if any evidence is missing.
- Origin: User request for default subagents activation with solo fallback.
- Research: Read `IMMUNE.md`, latest orchestration/trigger planning specs, relevant brainstorm/plan notes, and existing skill SKILL definitions to confirm current policy is already expressible in repo artifacts.
- Decisions: Keep scope to audit-only so this step is independent and does not expand runtime behavior; only emit evidence-based correction items if mismatches are found.
- Assumptions: The requested outcome is policy alignment, not code execution changes. Existing local contracts are the source of truth unless directly contradicted by prior user instructions in this thread.
- Scope Mode: Scope Reduction

## Steps

### Step 1
- Step ID: U1
- Result: Produce a bounded compliance audit result: either confirm `default-activate / fallback-solo` policy is met or return a minimal list of wording mismatches.
- Verification: Check against `IMMUNE.md`, `.imm/specs/workflow-skill-orchestration.spec.md`, `.imm/specs/skill-trigger-template-routing.spec.md`, `.imm/specs/workflow-skill-orchestration-review-followup.spec.md`, latest `docs/plans/2026-05-09-029-feat-workflow-skill-subagent-orchestration-plan.md`, and SKILL files for `imm-brainstorm`, `imm-preplan-review`, `imm-planner`, `imm-work`, and conditional reviewers to confirm three invariants: split-first when possible, solo fallback on instability/constraints, and no implementation without `imm-planner`/`imm-work` handoff.
- Status: completed
- Test scenarios: policy-boundary audit; solo fallback clarity audit; continuation-entry audit.
- Scope: `IMMUNE.md`, `.imm/specs/workflow-skill-orchestration.spec.md`, `.imm/specs/skill-trigger-template-routing.spec.md`, `.imm/specs/workflow-skill-orchestration-review-followup.spec.md`, `docs/plans/2026-05-09-029-feat-workflow-skill-subagent-orchestration-plan.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/api-contract-reviewer/SKILL.md`
- Replan condition: If a required audit result needs new policy text not derivable from existing contracts, pause and switch to a bounded addendum spec + implementation plan.

### Step 2
- Step ID: U2
- Result: A user-visible audit note is produced describing whether policy is already compliant or listing minimal correction actions.
- Verification: Output one concise note in plan handoff: `compliant` or `non-compliant`, with concrete file references for any missing/contradictory guard.
- Status: completed
- Test scenarios: compliant-path closure; non-compliant path with corrected action list.
- Depends on: 1
- Scope: This plan and the Planner handoff content.
- Replan condition: If U1 uncovers multiple cross-surface contradictions that affect execution authority, return to `imm-preplan-review` for scope split before implementation.
