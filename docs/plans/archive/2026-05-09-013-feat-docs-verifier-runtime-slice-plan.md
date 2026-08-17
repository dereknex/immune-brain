---
title: feat: activate docs-verifier runtime slice
type: feat
status: planned
date: 2026-05-09
origin: user asked to push existing subagents into usable state, and preplan review narrowed the current execution unit to docs-verifier runtime activation
---

# Iteration Plan

## Task
- Summary: Implement the next runtime-level batch-activation slice by making `docs-verifier` explicitly activatable and verifiable
- Origin: User asked to push the existing subagents into usable state. `imm-brainstorm` and `imm-preplan-review` reduced the immediate boundary to one reviewer runtime slice, and because `prompt-contract-reviewer` and `ai-eval-planner` already have dedicated hosts, the next minimal gap is `docs-verifier`.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/imm-brainstorm-subagents-post-ai-eval-next-slice-2026-05-09.md`, `.imm/specs/docs-verifier.spec.md`, `.imm/specs/prompt-contract-reviewer-runtime.spec.md`, `.imm/specs/ai-eval-planner-runtime.spec.md`, `README.md`, `tests/test_skill_contracts.py`, and `docs/solutions/dedicated-reviewer-activation-hosts.md`. Conclusion: the repo already has a proven single-reviewer runtime pattern and a closed docs-first `docs-verifier` contract, but still lacks a dedicated activation host and explicit trigger-only runtime routing for this reviewer.
- Decisions: D1 keep `Scope Reduction` from preplan and implement only the `docs-verifier` runtime slice; D2 choose a dedicated local skill surface as the minimal activation host instead of inventing registry or shared runtime infrastructure; D3 preserve `advisory`, read-only, trigger-only posture and explicit fallback to `executor` manual docs checks or `imm-code-review`; D4 keep the broader “all existing subagents become usable” ambition out of the execution boundary so this plan closes one activatable slice, not batch orchestration.
- Assumptions: A local `skills/docs-verifier/SKILL.md` surface is the smallest truthful runtime host in this repo; focused contract tests can verify the activation contract without claiming end-to-end runtime orchestration; README alignment should stay narrow and only cover trigger-only routing plus fallback wording.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `skills/docs-verifier/SKILL.md`, `.imm/specs/docs-verifier-runtime.spec.md`, `.imm/specs/docs-verifier.spec.md`, `README.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: `docs-verifier` can be explicitly activated as a dedicated read-only docs-consistency reviewer surface, or clearly fall back when unavailable
      - method: focused local contract regression plus Codex runtime manual check
  - blockers: there is no dedicated reviewer skill surface yet, so execution must create only the narrow activation host and not drift into a broader docs workflow or multi-reviewer runtime; repo-local tests cannot fully prove runtime availability
  - replan_condition: if execution starts requiring docs pipeline tooling, shared reviewer dispatch, unified capability detection, non-advisory authority, or more than one new reviewer slice, stop and return to preplan

## Steps

### Step 1
- Step ID: U1
- Result: `docs-verifier` has a dedicated runtime activation host with an advisory-only contract
- Verification: `skills/docs-verifier/SKILL.md` and supporting spec text define the explicit trigger boundary, required review inputs, advisory-only output focus, no-tools / no-write boundary, and explicit fallback posture.
- Test scenarios: Covers IMM-DOCS-002 R1; Covers IMM-DOCS-002 R2; Covers IMM-DOCS-002 acceptance criteria 1; Covers IMM-DOCS-002 acceptance criteria 2; Covers IMM-DOCS-002 acceptance criteria 3
- Depends on: none
- Scope: `skills/docs-verifier/SKILL.md`, `.imm/specs/docs-verifier-runtime.spec.md`, and only supporting contract wording in `.imm/specs/docs-verifier.spec.md` if drift is discovered
- Replan condition: If a dedicated activation host cannot be expressed without registry work, authority expansion, or cross-skill orchestration changes, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: `docs-verifier` is explicit as a trigger-only reviewer path at the repo contract layer
- Verification: Execution artifacts state when `docs-verifier` should be activated, that it is not a default gate, and how `executor` manual docs checks or `imm-code-review` act as fallback when the dedicated reviewer path is unavailable.
- Test scenarios: Covers IMM-DOCS-002 R3; Covers IMM-DOCS-002 acceptance criteria 4
- Depends on: 1
- Scope: `README.md`, `skills/docs-verifier/SKILL.md`, `.imm/specs/docs-verifier-runtime.spec.md`, and only supporting docs needed for routing clarity
- Replan condition: If clarifying routing starts to require a broader reviewer matrix, generic dispatcher language, or activation rules for other batch members, keep the scope on `docs-verifier` only and replan the broader rollout separately.

### Step 3
- Step ID: U3
- Result: a verifiable path exists for the runtime reviewer slice
- Verification: `tests/test_skill_contracts.py` and the runtime spec guard the dedicated skill surface, trigger-only boundary, fallback wording, and manual validation path without claiming a full platform.
- Test scenarios: Covers IMM-DOCS-002 R4; Covers IMM-DOCS-002 acceptance criteria 5; Covers IMM-DOCS-002 acceptance criteria 6
- Depends on: 1, 2
- Scope: `tests/test_skill_contracts.py`, `.imm/specs/docs-verifier-runtime.spec.md`, and only supporting wording needed for traceability
- Replan condition: If truthful verification requires a provider-specific harness, runtime registry, docs pipeline stack, or orchestration across multiple reviewers, document the manual path and stop expanding this slice.

## Notes
- Keep this slice narrower than a docs platform rollout: it activates one project-specific reviewer and nothing else.
- Prefer a dedicated local skill surface over hidden behavior inside existing `imm-*` authority roles.
- Manual Codex runtime validation is acceptable when the repo cannot truthfully simulate reviewer activation end to end.
