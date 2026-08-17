---
title: feat: activate prompt-contract-reviewer runtime slice
type: feat
status: planned
date: 2026-05-09
origin: user request to continue subagents functionality after closing the docs-first prompt-contract-reviewer slice
---

# Iteration Plan

## Task
- Summary: Implement the first runtime-level project-specific reviewer slice by making `prompt-contract-reviewer` explicitly activatable and verifiable
- Origin: User asked to continue subagents functionality. `imm-brainstorm` narrowed the next slice to `prompt-contract-reviewer` runtime activation, and `imm-preplan-review` kept `Hold Scope` so the next step is planning a minimal activation path rather than adding more reviewers or registry infrastructure.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/imm-brainstorm-subagents-next-runtime-slice-2026-05-09.md`, `.imm/specs/prompt-contract-reviewer.spec.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `README.md`, `skills/imm-code-review/SKILL.md`, and solution docs for bounded advisory delegation packets and project-specific reviewer contract slices. Conclusion: the repo already has a closed docs-first reviewer contract, explicit fallback, and focused textual regression, but still lacks a real activation host; there is no dedicated reviewer skill surface yet.
- Decisions: D1 keep `Hold Scope` and implement only the `prompt-contract-reviewer` runtime slice; D2 choose a dedicated local skill surface as the minimal activation host instead of inventing a registry or overloading an existing `imm-*` authority role; D3 preserve `advisory`, read-only, trigger-only posture and explicit fallback to `scope-reviewer` + `imm-code-review`; D4 accept manual Codex runtime validation for real activation behavior while local automated checks guard the repo-level contract.
- Assumptions: A local `skills/prompt-contract-reviewer/SKILL.md` surface is the smallest truthful runtime host in this repo; focused contract tests can verify the activation contract without claiming end-to-end runtime orchestration; README alignment should stay narrow and only cover trigger-only routing plus fallback wording.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/prompt-contract-reviewer/SKILL.md`, `.imm/specs/prompt-contract-reviewer-runtime.spec.md`, `.imm/specs/prompt-contract-reviewer.spec.md`, `README.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: `prompt-contract-reviewer` can be explicitly activated as a dedicated read-only reviewer surface, or clearly fall back when unavailable
      - method: focused local contract regression plus Codex runtime manual check
  - blockers: there is no dedicated reviewer skill surface yet, so execution must create only the narrow activation host and not drift into a broader project-specific reviewer framework; repo-local tests cannot fully prove runtime availability
  - replan_condition: if execution starts requiring a shared registry, automatic multi-reviewer dispatch, non-advisory authority, or more than one new reviewer slice, stop and return to preplan

## Steps

### Step 1
- Step ID: U1
- Result: `prompt-contract-reviewer` has a dedicated runtime activation host with an advisory-only contract
- Verification: `skills/prompt-contract-reviewer/SKILL.md` and supporting spec text define the explicit trigger boundary, required review inputs, advisory-only output focus, no-tools / no-write boundary, and explicit fallback posture.
- Test scenarios: Covers IMM-PROMPT-002 R1; Covers IMM-PROMPT-002 R2; Covers IMM-PROMPT-002 acceptance criteria 1; Covers IMM-PROMPT-002 acceptance criteria 2; Covers IMM-PROMPT-002 acceptance criteria 3
- Depends on: none
- Scope: `skills/prompt-contract-reviewer/SKILL.md`, `.imm/specs/prompt-contract-reviewer-runtime.spec.md`, and only supporting contract wording in `.imm/specs/prompt-contract-reviewer.spec.md` if drift is discovered
- Replan condition: If a dedicated activation host cannot be expressed without registry work, authority expansion, or cross-skill orchestration changes, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: `prompt-contract-reviewer` is explicit as a trigger-only reviewer path at the repo contract layer
- Verification: Execution artifacts state when `prompt-contract-reviewer` should be activated, that it is not a default gate, and how `scope-reviewer` + `imm-code-review` act as fallback when the dedicated reviewer path is unavailable.
- Test scenarios: Covers IMM-PROMPT-002 R3; Covers IMM-PROMPT-002 acceptance criteria 4
- Depends on: 1
- Scope: `README.md`, `skills/prompt-contract-reviewer/SKILL.md`, `.imm/specs/prompt-contract-reviewer-runtime.spec.md`, and only supporting docs needed for routing clarity
- Replan condition: If clarifying routing starts to require a broader reviewer matrix, generic dispatcher language, or activation rules for other project-specific reviewers, keep the scope on `prompt-contract-reviewer` only and replan the broader rollout separately.

### Step 3
- Step ID: U3
- Result: a verifiable path exists for the runtime reviewer slice
- Verification: `tests/test_skill_contracts.py` and the runtime spec guard the dedicated skill surface, trigger-only boundary, fallback wording, and manual validation path without claiming a full platform.
- Test scenarios: Covers IMM-PROMPT-002 R4; Covers IMM-PROMPT-002 acceptance criteria 5; Covers IMM-PROMPT-002 acceptance criteria 6
- Depends on: 1, 2
- Scope: `tests/test_skill_contracts.py`, `.imm/specs/prompt-contract-reviewer-runtime.spec.md`, and only supporting wording needed for traceability
- Replan condition: If truthful verification requires a provider-specific harness, runtime registry, or automated orchestration across multiple reviewers, document the manual path and stop expanding this slice.

## Notes
- Keep this slice narrower than a reviewer framework rollout: it activates one project-specific reviewer and nothing else.
- Prefer a dedicated local skill surface over hidden behavior inside existing `imm-*` authority roles.
- Manual Codex runtime validation is acceptable when the repo cannot truthfully simulate reviewer activation end to end.
