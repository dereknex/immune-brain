---
title: feat: define ai-eval-planner slice
type: feat
status: planned
date: 2026-05-09
origin: user asked to continue subagents planning and lock the first implementation slice to ai-eval-planner
---

# Iteration Plan

## Task
- Summary: Define the narrow project-specific `ai-eval-planner` slice for AI/agent projects
- Origin: User asked which subagents should be implemented first, then routed through `imm-preplan-review` and narrowed the next slice to a single `ai-eval-planner` plan instead of a batch rollout.
- Research: Checked `IMMUNE.md`, `README.md`, `.imm/specs/system-subagents-design.spec.md`, `docs/solutions/project-specific-reviewer-contract-slices.md`, `docs/solutions/dedicated-reviewer-activation-hosts.md`, existing `prompt-contract-reviewer` specs/plans, and `.imm/memory/MEMORY.md`. Conclusion: `ai-eval-planner` is already named as a project-specific AI/agent specialist with clear trigger prose and fallback hints, but it still lacks a standalone contract slice and any dedicated activation-host plan.
- Decisions: D1 keep the scope reduced to one project-specific slice; D2 define `ai-eval-planner` first as an `advisory`, read-only eval-design specialist instead of granting plan-write authority; D3 reuse the standalone-contract and activation-host patterns already proven by `prompt-contract-reviewer`; D4 keep the fallback narrow: `imm-planner` minimal eval plan or explicit manual acceptance path; D5 exclude registry, benchmark harness, automatic scoring, and multi-agent rollout from this iteration.
- Assumptions: AI/agent evaluation design can be expressed as a focused specialist contract without requiring a full eval platform; local regression can truthfully guard contract text and activation-host intent even if runtime activation remains manual; `skills/ai-eval-planner/SKILL.md` is the smallest plausible future host surface.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/ai-eval-planner.spec.md`, future `skills/ai-eval-planner/SKILL.md`, `tests/test_skill_contracts.py`, and only minimal repo-contract wording if drift is found
  - dependencies_known: true
  - verification_path:
      - target: `ai-eval-planner` becomes a standalone, verifiable project-specific eval-design slice with a future activation-host path
      - method: `imm-plan <plan-path> --json` plus future focused textual regression and Codex runtime manual validation
  - blockers: there is no existing dedicated `ai-eval-planner` host surface, and the slice must not silently expand into plan-write authority or eval-platform work
  - replan_condition: if execution starts requiring a benchmark harness, registry, automatic scoring, shared reviewer dispatch, or direct plan-write authority for `ai-eval-planner`, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: `ai-eval-planner` has a standalone project-specific contract slice
- Verification: `.imm/specs/ai-eval-planner.spec.md` defines the trigger boundary, manifest-style contract fields, advisory authority, read-only write boundary, eval-design outputs, and fallback posture.
- Test scenarios: Covers IMM-EVAL-001 R1; Covers IMM-EVAL-001 R2; Covers IMM-EVAL-001 acceptance criteria 1; Covers IMM-EVAL-001 acceptance criteria 2; Covers IMM-EVAL-001 acceptance criteria 3
- Depends on: none
- Scope: `.imm/specs/ai-eval-planner.spec.md` and only minimal supporting planning text if drift is discovered
- Replan condition: If the contract cannot be expressed without direct plan-write authority, runtime registry work, or broader reviewer framework decisions, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: `ai-eval-planner` has a dedicated activation-host target
- Verification: Planning artifacts define a future `skills/ai-eval-planner/SKILL.md` host with required eval-design inputs and an advisory-only, read-only boundary.
- Test scenarios: Covers IMM-EVAL-001 R4; Covers IMM-EVAL-001 acceptance criteria 5
- Depends on: 1
- Scope: future `skills/ai-eval-planner/SKILL.md` and only supporting spec wording needed for host-boundary clarity
- Replan condition: If clarifying the host boundary starts to require shared availability detection, multi-reviewer composition, or runtime dispatch policy beyond this one specialist, keep the scope on `ai-eval-planner` only and replan the platform work separately.

### Step 3
- Step ID: U3
- Result: `ai-eval-planner` has explicit trigger-only routing at the repo contract layer
- Verification: Planning artifacts state when `ai-eval-planner` should be activated, that it is not a default gate, and how `imm-planner` minimal eval planning or manual acceptance acts as fallback when the dedicated host is unavailable.
- Test scenarios: Covers IMM-EVAL-001 R3; Covers IMM-EVAL-001 acceptance criteria 4
- Depends on: 1, 2
- Scope: supporting spec wording, minimal repo-contract wording needed for routing clarity, and only planning artifacts required for traceability
- Replan condition: If truthful verification requires provider-specific orchestration, automatic scoring harnesses, or integration with multiple project-specific specialists, document the manual path and stop expanding this slice.

### Step 4
- Step ID: U4
- Result: a verifiable path exists for the `ai-eval-planner` slice
- Verification: Focused regression and manual runtime validation criteria guard the trigger surface, advisory/read-only boundary, fallback wording, and activation-host intent without claiming a full eval platform.
- Test scenarios: Covers IMM-EVAL-001 R5; Covers IMM-EVAL-001 acceptance criteria 6; Covers IMM-EVAL-001 acceptance criteria 7
- Depends on: 1, 2, 3
- Scope: `tests/test_skill_contracts.py`, spec manual-validation text, and only supporting planning artifacts needed for traceability
- Replan condition: If truthful verification requires provider-specific orchestration, automatic scoring harnesses, or integration with multiple project-specific specialists, document the manual path and stop expanding this slice.

## Notes
- Keep this slice narrower than a general AI eval framework: it defines one project-specific specialist contract and its activation-host target, not the eval system itself.
- Reuse `prompt-contract-reviewer` as the closest contract-shape reference, but do not copy its trigger or output surface.
- Keep `imm-planner` as the only plan-writing authority even if `ai-eval-planner` later becomes activatable.
- This plan remains a valid standalone reference even when a later batch rollout executes `ai-eval-planner` alongside other independently closable slices.
