---
title: feat: define api-contract-reviewer slice
type: feat
status: planned
date: 2026-05-09
origin: first-subagent-batch U2 requires a standalone conditional-risk slice for api-contract-reviewer
---

# Iteration Plan

## Task
- Summary: Define the narrow conditional-risk `api-contract-reviewer` slice for cross-project API and exported contract changes
- Origin: The first subagent batch plan chose `api-contract-reviewer` as the second independently closable slice because API and contract surfaces are common, structured, and easy to trigger explicitly across projects.
- Research: Checked `IMMUNE.md`, `README.md`, `.imm/specs/system-subagents-design.spec.md`, the existing `prompt-contract-reviewer` and `security-reviewer` slice patterns, and the first-subagent-batch plan. Conclusion: `api-contract-reviewer` is already described as a conditional, read-only reviewer with high-signal outputs, but it still lacks a standalone contract slice, explicit fallback, and verifiable path.
- Decisions: D1 keep this slice conditional-risk, advisory, read-only, and non-default; D2 define the contract around explicit API / contract trigger surfaces instead of broad interface-review language; D3 keep fallback narrow: `imm-code-review` plus planner or executor contract notes; D4 require focused regression or manual runtime validation instead of inventing an API diff platform; D5 exclude runtime registry, consumer-compatibility tooling, diff engines, and version-policy frameworks from this slice.
- Assumptions: Contract-sensitive changes can be identified through task content or diff surfaces without a shared trigger engine; local regression can guard the contract text and fallback wording even if runtime activation remains manual; a future `skills/api-contract-reviewer/SKILL.md` is the smallest plausible activation host.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/api-contract-reviewer.spec.md`, future `skills/api-contract-reviewer/SKILL.md`, `tests/test_skill_contracts.py`, and only minimal repo-contract wording if drift is found
  - dependencies_known: true
  - verification_path:
      - target: `api-contract-reviewer` becomes a standalone, verifiable conditional-risk contract slice with explicit trigger, fallback, and manual runtime validation
      - method: `imm-plan <plan-path> --json` plus future focused textual regression and Codex runtime manual validation
  - blockers: no existing dedicated reviewer artifact surface exists yet, and the slice must not silently expand into API-platform infrastructure or default-gate behavior
  - replan_condition: if execution starts requiring a registry, shared dispatch, API diff tooling, automatic compatibility engines, or non-advisory authority, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: `api-contract-reviewer` has a standalone docs-first contract slice
- Verification: `.imm/specs/api-contract-reviewer.spec.md` defines the trigger boundary, manifest-style contract fields, advisory authority, read-only write boundary, contract-review outputs, and fallback posture.
- Test scenarios: Covers IMM-API-001 R1; Covers IMM-API-001 R2; Covers IMM-API-001 acceptance criteria 1; Covers IMM-API-001 acceptance criteria 2; Covers IMM-API-001 acceptance criteria 3
- Depends on: none
- Scope: `.imm/specs/api-contract-reviewer.spec.md` and only minimal supporting planning text if drift is discovered
- Replan condition: If the contract cannot be expressed without default-gate behavior, automatic compatibility tooling, or broader runtime-platform decisions, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: the reviewer fallback is made explicit
- Verification: Execution artifacts define when `api-contract-reviewer` is used for contract-sensitive changes, when it is not default, and how `imm-code-review` plus planner or executor contract notes act as fallback.
- Test scenarios: Covers IMM-API-001 R3; Covers IMM-API-001 acceptance criteria 4
- Depends on: 1
- Scope: `.imm/specs/api-contract-reviewer.spec.md` and only supporting docs needed for routing clarity
- Replan condition: If clarifying fallback starts to require a broader API policy workflow, shared contract engine, or other reviewer classes, keep the scope on `api-contract-reviewer` only and replan the broader rollout separately.

### Step 3
- Step ID: U3
- Result: a verifiable path exists for this reviewer slice
- Verification: Focused regression and/or a documented runtime manual check prove the trigger surface, fallback path, and advisory-only boundary without claiming a full contract platform.
- Test scenarios: Covers IMM-API-001 R4; Covers IMM-API-001 acceptance criteria 5; Covers IMM-API-001 acceptance criteria 6
- Depends on: 1, 2
- Scope: focused tests under `tests/` and/or spec-plan validation text only
- Replan condition: If truthful verification now depends on provider-specific harnesses, API diff tooling, compatibility engines, or multi-reviewer platform behavior, document the manual path and stop expanding the slice.

## Notes
- Keep this slice narrower than an API governance rollout: it defines one conditional-risk reviewer contract, not a compatibility platform.
- Reuse existing contract-test entry points before introducing new validators or API tooling.
- If execution later proves that `api-contract-reviewer` should become a real delegated reviewer, add a dedicated activation-host slice separately instead of widening this docs-first contract in place.
