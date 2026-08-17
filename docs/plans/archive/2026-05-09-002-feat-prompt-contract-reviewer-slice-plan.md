---
title: feat: define prompt-contract-reviewer slice
type: feat
status: planned
date: 2026-05-09
origin: user asked to continue subagents planning after the imm-party delegation slice closed
---

# Iteration Plan

## Task
- Summary: Define the narrow project-specific `prompt-contract-reviewer` slice for AI/agent projects
- Origin: User asked to continue planning subagents. The latest brainstorm concluded that after closing the `imm-party` delegation slice, the best-fit next slice for this AI/agent workflow repo is `prompt-contract-reviewer`, not a generic registry or a full conditional-risk rollout.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/imm-brainstorm-subagents-next-slice-2026-05-09.md`, `.imm/specs/system-subagents-design.spec.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `README.md`, and solution docs for layered subagent governance, tested skill contracts, and bounded advisory delegation packets. Conclusion: `prompt-contract-reviewer` is already positioned as a project-specific reviewer with `scope-reviewer` + `imm-code-review` fallback, but it still lacks a standalone, verifiable contract slice.
- Decisions: D1 choose `Hold Scope` because the brainstorm already narrowed the next slice sufficiently and no new hidden dependency was introduced; D2 keep this slice docs-first and project-specific instead of escalating to registry or multi-reviewer rollout; D3 preserve `advisory` authority and a read-only boundary; D4 reuse the new bounded advisory delegation packet pattern only as a reusable model, not as justification for a broader runtime platform; D5 require either focused regression or a documented runtime check so this reviewer slice is more than roster prose.
- Assumptions: The current repo does not yet have a dedicated `prompt-contract-reviewer` skill or manifest directory, so the first executable slice should live in spec/plan/testable-doc surfaces; AI/agent behavior-contract review is more repo-relevant than starting with a generic conditional-risk reviewer; current test infrastructure can support a narrow textual contract check if needed.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/prompt-contract-reviewer.spec.md`, `docs/plans/2026-05-09-002-feat-prompt-contract-reviewer-slice-plan.md`, `README.md`, and focused regression under `tests/` if execution adds one
  - dependencies_known: true
  - verification_path:
      - target: `prompt-contract-reviewer` becomes a standalone, verifiable project-specific contract slice with explicit trigger, fallback, and authority boundaries
      - method: plan validator plus future focused textual regression and/or a documented runtime manual check
  - blockers: no existing dedicated reviewer artifact surface exists yet, so execution must avoid accidentally expanding into a registry or a new general subagent runtime layer
  - replan_condition: if execution starts requiring a shared manifest registry, multiple reviewer rollout, non-advisory authority, or a provider-specific runtime harness, stop and return to preplan instead of widening this slice in place

## Steps

### Step 1
- Step ID: U1
- Result: `prompt-contract-reviewer` has a standalone docs-first contract slice
- Verification: `.imm/specs/prompt-contract-reviewer.spec.md` defines the reviewer purpose, trigger boundary, manifest-style contract fields, advisory authority, and read-only write boundary.
- Test scenarios: Covers IMM-PROMPT-001 R1; Covers IMM-PROMPT-001 R2; Covers IMM-PROMPT-001 acceptance criteria 1; Covers IMM-PROMPT-001 acceptance criteria 2; Covers IMM-PROMPT-001 acceptance criteria 3
- Depends on: none
- Scope: `.imm/specs/prompt-contract-reviewer.spec.md` and only minimal supporting README alignment if contract drift is discovered
- Replan condition: If the contract cannot be expressed without inventing a registry, new runtime state, or execution authority, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: the reviewer fallback is made explicit
- Verification: Execution artifacts define when `prompt-contract-reviewer` is used for AI/agent changes, when it is not default, and how `scope-reviewer` + `imm-code-review` act as fallback.
- Test scenarios: Covers IMM-PROMPT-001 R3; Covers IMM-PROMPT-001 acceptance criteria 4
- Depends on: 1
- Scope: `.imm/specs/prompt-contract-reviewer.spec.md`, `README.md`, and only supporting docs needed for routing clarity
- Replan condition: If clarifying fallback starts to pull in other reviewer classes or scenario matrices beyond this one reviewer, keep the scope on `prompt-contract-reviewer` only and replan the broader rollout separately.

### Step 3
- Step ID: U3
- Result: a verifiable path exists for this reviewer slice
- Verification: Focused regression and/or a documented runtime manual check prove the trigger surface, fallback path, and advisory-only boundary without claiming a full runtime platform.
- Test scenarios: Covers IMM-PROMPT-001 R4; Covers IMM-PROMPT-001 acceptance criteria 5; Covers IMM-PROMPT-001 acceptance criteria 6
- Depends on: 1, 2
- Scope: focused tests under `tests/` and/or spec-plan validation text only
- Replan condition: If truthful verification now depends on a provider-specific harness, multi-agent platform behavior, or automatic reviewer dispatch across multiple classes, document the manual path and stop expanding the slice.

## Notes
- Keep this slice narrower than the finished `imm-party` delegation work: it defines one project-specific reviewer contract, not a new reviewer framework.
- Reuse existing contract-test entry points before introducing any new validator or registry surface.
- If execution later proves that `prompt-contract-reviewer` should become a real delegated reviewer, reuse the bounded advisory packet pattern instead of reinventing packet vocabulary.
