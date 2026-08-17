---
title: feat: define docs-verifier slice
type: feat
status: planned
date: 2026-05-09
origin: first-subagent-batch U4 requires a standalone project-specific slice for docs-verifier
---

# Iteration Plan

## Task
- Summary: Define the narrow project-specific `docs-verifier` slice for user-facing documentation consistency
- Origin: The first subagent batch plan chose `docs-verifier` as the fourth independently closable slice because public docs and usage guidance are a clear project-specific concern with simple fallback and high user impact when stale.
- Research: Checked `IMMUNE.md`, `README.md`, `.imm/specs/system-subagents-design.spec.md`, the existing `prompt-contract-reviewer` and `ai-eval-planner` slice patterns, and the first-subagent-batch plan. Conclusion: `docs-verifier` is already described as a project-specific, read-only reviewer with high-signal outputs, but it still lacks a standalone contract slice, explicit fallback, and verifiable path.
- Decisions: D1 keep this slice project-specific, advisory, read-only, and non-default; D2 define the contract around explicit public-doc and usage trigger surfaces instead of broad “review docs” language; D3 keep fallback narrow: executor or `imm-code-review` manual docs checks; D4 require focused regression or manual runtime validation instead of inventing a docs pipeline; D5 exclude runtime registry, docs build/publish systems, public docs indexing, and shared reviewer infrastructure from this slice.
- Assumptions: Documentation-sensitive changes can be identified through task content or diff surfaces without a shared trigger engine; local regression can guard the contract text and fallback wording even if runtime activation remains manual; a future `skills/docs-verifier/SKILL.md` is the smallest plausible activation host.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/docs-verifier.spec.md`, future `skills/docs-verifier/SKILL.md`, `tests/test_skill_contracts.py`, and only minimal repo-contract wording if drift is found
  - dependencies_known: true
  - verification_path:
      - target: `docs-verifier` becomes a standalone, verifiable project-specific contract slice with explicit trigger, fallback, and manual runtime validation
      - method: `imm-plan <plan-path> --json` plus future focused textual regression and Codex runtime manual validation
  - blockers: no existing dedicated reviewer artifact surface exists yet, and the slice must not silently expand into docs-pipeline infrastructure or default-gate behavior
  - replan_condition: if execution starts requiring a registry, shared dispatch, docs build tooling, public docs indexing, or non-advisory authority, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: `docs-verifier` has a standalone docs-first contract slice
- Verification: `.imm/specs/docs-verifier.spec.md` defines the trigger boundary, manifest-style contract fields, advisory authority, read-only write boundary, docs-review outputs, and fallback posture.
- Test scenarios: Covers IMM-DOCS-001 R1; Covers IMM-DOCS-001 R2; Covers IMM-DOCS-001 acceptance criteria 1; Covers IMM-DOCS-001 acceptance criteria 2; Covers IMM-DOCS-001 acceptance criteria 3
- Depends on: none
- Scope: `.imm/specs/docs-verifier.spec.md` and only minimal supporting planning text if drift is discovered
- Replan condition: If the contract cannot be expressed without default-gate behavior, docs pipeline work, or broader runtime-platform decisions, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: the reviewer fallback is made explicit
- Verification: Execution artifacts define when `docs-verifier` is used for public-doc changes, when it is not default, and how executor or `imm-code-review` manual docs checks act as fallback.
- Test scenarios: Covers IMM-DOCS-001 R3; Covers IMM-DOCS-001 acceptance criteria 4
- Depends on: 1
- Scope: `.imm/specs/docs-verifier.spec.md` and only supporting docs needed for routing clarity
- Replan condition: If clarifying fallback starts to require a broader docs workflow, publish system, or other reviewer classes, keep the scope on `docs-verifier` only and replan the broader rollout separately.

### Step 3
- Step ID: U3
- Result: a verifiable path exists for this reviewer slice
- Verification: Focused regression and/or a documented runtime manual check prove the trigger surface, fallback path, and advisory-only boundary without claiming a full docs platform.
- Test scenarios: Covers IMM-DOCS-001 R4; Covers IMM-DOCS-001 acceptance criteria 5; Covers IMM-DOCS-001 acceptance criteria 6
- Depends on: 1, 2
- Scope: focused tests under `tests/` and/or spec-plan validation text only
- Replan condition: If truthful verification now depends on provider-specific harnesses, docs pipeline tooling, public docs indexing, or multi-reviewer platform behavior, document the manual path and stop expanding the slice.

## Notes
- Keep this slice narrower than a docs program rollout: it defines one project-specific reviewer contract, not a documentation platform.
- Reuse existing contract-test entry points before introducing new validators or docs tooling.
- If execution later proves that `docs-verifier` should become a real delegated reviewer, add a dedicated activation-host slice separately instead of widening this docs-first contract in place.
