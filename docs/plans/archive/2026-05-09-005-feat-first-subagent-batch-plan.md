---
title: feat: define first subagent batch
type: feat
status: planned
date: 2026-05-09
origin: user explicitly expanded the first implementation round from a single ai-eval slice to a four-slice batch
---

# Iteration Plan

## Task
- Summary: Define the first four-subagent batch as independently closable standalone slices
- Origin: User first asked which subagents should be implemented first, then overrode the prior single-slice narrowing and explicitly required this round to include `security-reviewer`, `api-contract-reviewer`, `ai-eval-planner`, and `docs-verifier`.
- Research: Checked `IMMUNE.md`, `README.md`, `.imm/specs/system-subagents-design.spec.md`, `docs/solutions/project-specific-reviewer-contract-slices.md`, `docs/solutions/dedicated-reviewer-activation-hosts.md`, the finished `prompt-contract-reviewer` docs/runtime slices, and the narrow `ai-eval-planner` single-slice plan. Conclusion: the repo already has a reusable contract/host pattern, and the user-selected four form a coherent first batch because they cover the highest-signal conditional-risk pair plus the most relevant project-specific pair without yet dragging in registry or platform work.
- Decisions: D1 accept the user-requested batch expansion instead of preserving the prior single-slice reduction; D2 keep all four slices advisory, read-only, trigger-only, and non-default; D3 preserve the layer split by planning `security-reviewer` and `api-contract-reviewer` as conditional-risk reviewers while planning `ai-eval-planner` and `docs-verifier` as project-specific specialists; D4 require each slice to stand on its own contract, activation-host target, fallback, and verification path; D5 keep registry, shared dispatch, multi-reviewer composition, and shared infrastructure out of scope even though four slices are planned together.
- Assumptions: A four-slice planning batch is still tractable if each slice remains independently closable; existing focused textual regression patterns can be reused across all four slices; the prior single-slice `ai-eval-planner` plan remains valid as a narrower reference but is no longer the active top-level rollout boundary.
- Scope Mode: Selective Expansion
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/first-subagent-batch.spec.md`, future slice specs and skill surfaces for the four named subagents, `tests/test_skill_contracts.py`, and only minimal repo-contract wording needed for routing clarity
  - dependencies_known: true
  - verification_path:
      - target: the first batch is locked to four independently executable slices, each with contract, host target, fallback, and validation requirements
      - method: `imm-plan <plan-path> --json` plus future focused textual regression and Codex runtime manual validation per slice
  - blockers: broadening beyond the four named slices or introducing shared runtime/platform behavior would collapse the batch into a framework task instead of four closable slice plans
  - replan_condition: if any step starts requiring registry work, shared dispatch, availability-detection infrastructure, benchmark harnesses, or coupling between slices beyond shared planning conventions, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: `security-reviewer` has a standalone conditional-risk slice plan
- Verification: Planning artifacts define `security-reviewer` trigger boundaries, advisory/read-only contract, dedicated activation-host target, fallback posture, and verification path without turning it into a default gate.
- Test scenarios: Covers IMM-BATCH-001 R2; Covers IMM-BATCH-001 R3; Covers IMM-BATCH-001 acceptance criteria 2; Covers IMM-BATCH-001 acceptance criteria 3
- Depends on: none
- Scope: future `security-reviewer` spec, future `skills/security-reviewer/SKILL.md`, and only minimal routing wording needed for this slice
- Replan condition: If the `security-reviewer` slice starts requiring exploit harnesses, automatic threat modeling, or shared reviewer orchestration, stop and replan it as separate platform work.

### Step 2
- Step ID: U2
- Result: `api-contract-reviewer` has a standalone conditional-risk slice plan
- Verification: Planning artifacts define `api-contract-reviewer` trigger boundaries, advisory/read-only contract, dedicated activation-host target, fallback posture, and verification path without turning it into a default gate.
- Test scenarios: Covers IMM-BATCH-001 R2; Covers IMM-BATCH-001 R3; Covers IMM-BATCH-001 acceptance criteria 2; Covers IMM-BATCH-001 acceptance criteria 3
- Depends on: none
- Scope: future `api-contract-reviewer` spec, future `skills/api-contract-reviewer/SKILL.md`, and only minimal routing wording needed for this slice
- Replan condition: If the `api-contract-reviewer` slice starts requiring consumer contract tooling, API diff engines, or shared reviewer orchestration, stop and replan it as separate platform work.

### Step 3
- Step ID: U3
- Result: `ai-eval-planner` has a standalone project-specific slice plan
- Verification: Planning artifacts define `ai-eval-planner` trigger boundaries, advisory/read-only contract, dedicated activation-host target, fallback posture, and verification path without turning it into a plan-writing authority or eval platform.
- Test scenarios: Covers IMM-BATCH-001 R2; Covers IMM-BATCH-001 R4; Covers IMM-BATCH-001 acceptance criteria 2; Covers IMM-BATCH-001 acceptance criteria 4
- Depends on: none
- Scope: future `ai-eval-planner` spec, future `skills/ai-eval-planner/SKILL.md`, and only minimal routing wording needed for this slice
- Replan condition: If the `ai-eval-planner` slice starts requiring benchmark harnesses, automatic scoring, or shared eval infrastructure, stop and replan it as separate platform work.

### Step 4
- Step ID: U4
- Result: `docs-verifier` has a standalone project-specific slice plan
- Verification: Planning artifacts define `docs-verifier` trigger boundaries, advisory/read-only contract, dedicated activation-host target, fallback posture, and verification path without turning it into a default docs gate or docs publishing workflow.
- Test scenarios: Covers IMM-BATCH-001 R2; Covers IMM-BATCH-001 R4; Covers IMM-BATCH-001 acceptance criteria 2; Covers IMM-BATCH-001 acceptance criteria 4
- Depends on: none
- Scope: future `docs-verifier` spec, future `skills/docs-verifier/SKILL.md`, and only minimal routing wording needed for this slice
- Replan condition: If the `docs-verifier` slice starts requiring docs build/publish tooling, shared public-surface indexing, or shared reviewer orchestration, stop and replan it as separate platform work.

## Notes
- This batch is intentionally wider than the prior `ai-eval-planner` single-slice plan, but each step must still be executable and reviewable in isolation.
- Use the existing `prompt-contract-reviewer` slice as the nearest proven template, while preserving the different trigger surfaces and fallback paths of each new slice.
- Do not create shared abstractions for the four slices during planning unless the validator or later execution proves duplication is blocking closure.
