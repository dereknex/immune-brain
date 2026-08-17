---
title: feat: define security-reviewer slice
type: feat
status: planned
date: 2026-05-09
origin: first-subagent-batch U1 requires a standalone conditional-risk slice for security-reviewer
---

# Iteration Plan

## Task
- Summary: Define the narrow conditional-risk `security-reviewer` slice for cross-project security-sensitive changes
- Origin: The first subagent batch plan chose `security-reviewer` as the first independently closable slice because it has the highest cross-project reuse and the clearest trigger surface among conditional-risk reviewers.
- Research: Checked `IMMUNE.md`, `README.md`, `.imm/specs/system-subagents-design.spec.md`, the existing `prompt-contract-reviewer` slice pattern, and the first-subagent-batch plan. Conclusion: `security-reviewer` is already described as a conditional, read-only reviewer with high-signal outputs, but it still lacks a standalone contract slice, explicit fallback, and verifiable path.
- Decisions: D1 keep this slice conditional-risk, advisory, read-only, and non-default; D2 define the contract around explicit security-sensitive trigger surfaces instead of broad “review everything” language; D3 keep fallback narrow: `imm-code-review` plus current-step security notes; D4 require focused regression or manual runtime validation instead of inventing a security platform; D5 exclude runtime registry, exploit harnesses, scanners, and threat-model platforms from this slice.
- Assumptions: Security-sensitive changes can be identified through task content or diff surfaces without a shared trigger engine; local regression can guard the contract text and fallback wording even if runtime activation remains manual; a future `skills/security-reviewer/SKILL.md` is the smallest plausible activation host.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/security-reviewer.spec.md`, future `skills/security-reviewer/SKILL.md`, `tests/test_skill_contracts.py`, and only minimal repo-contract wording if drift is found
  - dependencies_known: true
  - verification_path:
      - target: `security-reviewer` becomes a standalone, verifiable conditional-risk contract slice with explicit trigger, fallback, and manual runtime validation
      - method: `imm-plan <plan-path> --json` plus future focused textual regression and Codex runtime manual validation
  - blockers: no existing dedicated reviewer artifact surface exists yet, and the slice must not silently expand into threat-model infrastructure or default-gate behavior
  - replan_condition: if execution starts requiring a registry, shared dispatch, exploit tooling, automatic scanning, or non-advisory authority, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: `security-reviewer` has a standalone docs-first contract slice
- Verification: `.imm/specs/security-reviewer.spec.md` defines the trigger boundary, manifest-style contract fields, advisory authority, read-only write boundary, security-review outputs, and fallback posture.
- Test scenarios: Covers IMM-SEC-001 R1; Covers IMM-SEC-001 R2; Covers IMM-SEC-001 acceptance criteria 1; Covers IMM-SEC-001 acceptance criteria 2; Covers IMM-SEC-001 acceptance criteria 3
- Depends on: none
- Scope: `.imm/specs/security-reviewer.spec.md` and only minimal supporting planning text if drift is discovered
- Replan condition: If the contract cannot be expressed without default-gate behavior, automatic scanning, or broader runtime-platform decisions, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: the reviewer fallback is made explicit
- Verification: Execution artifacts define when `security-reviewer` is used for security-sensitive changes, when it is not default, and how `imm-code-review` plus current-step security notes act as fallback.
- Test scenarios: Covers IMM-SEC-001 R3; Covers IMM-SEC-001 acceptance criteria 4
- Depends on: 1
- Scope: `.imm/specs/security-reviewer.spec.md` and only supporting docs needed for routing clarity
- Replan condition: If clarifying fallback starts to require a broader security workflow, shared policy engine, or other reviewer classes, keep the scope on `security-reviewer` only and replan the broader rollout separately.

### Step 3
- Step ID: U3
- Result: a verifiable path exists for this reviewer slice
- Verification: Focused regression and/or a documented runtime manual check prove the trigger surface, fallback path, and advisory-only boundary without claiming a full security platform.
- Test scenarios: Covers IMM-SEC-001 R4; Covers IMM-SEC-001 acceptance criteria 5; Covers IMM-SEC-001 acceptance criteria 6
- Depends on: 1, 2
- Scope: focused tests under `tests/` and/or spec-plan validation text only
- Replan condition: If truthful verification now depends on provider-specific harnesses, automatic scanners, exploit tooling, or multi-reviewer platform behavior, document the manual path and stop expanding the slice.

## Notes
- Keep this slice narrower than a security program rollout: it defines one conditional-risk reviewer contract, not a threat-model or scanning framework.
- Reuse existing contract-test entry points before introducing new validators or security tooling.
- If execution later proves that `security-reviewer` should become a real delegated reviewer, add a dedicated activation-host slice separately instead of widening this docs-first contract in place.
