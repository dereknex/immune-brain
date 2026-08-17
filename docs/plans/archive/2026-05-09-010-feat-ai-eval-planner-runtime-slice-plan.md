---
title: feat: activate ai-eval-planner runtime slice
type: feat
status: planned
date: 2026-05-09
origin: user asked to continue the first subagent batch into activatable use, and preplan review narrowed the current execution unit to ai-eval-planner runtime activation
---

# Iteration Plan

## Task
- Summary: Implement the first runtime-level batch-activation slice by making `ai-eval-planner` explicitly activatable and verifiable
- Origin: User asked to continue the first subagent batch into activatable use rather than stopping at docs-first contracts. `imm-brainstorm` reframed this as a batch activation roadmap, `imm-preplan-review` reduced the immediate planning unit to one slice, and the chosen first slice is `ai-eval-planner`.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/imm-brainstorm-first-subagent-batch-activation-roadmap-2026-05-09.md`, `.imm/specs/first-subagent-batch.spec.md`, `.imm/specs/ai-eval-planner.spec.md`, `.imm/specs/prompt-contract-reviewer-runtime.spec.md`, `README.md`, and `docs/solutions/dedicated-reviewer-activation-hosts.md`. Conclusion: the repo already has a proven single-reviewer runtime pattern and a closed docs-first `ai-eval-planner` contract, but still lacks a dedicated activation host and explicit trigger-only runtime routing for this specialist.
- Decisions: D1 keep `Scope Reduction` from preplan and implement only the `ai-eval-planner` runtime slice; D2 choose a dedicated local skill surface as the minimal activation host instead of inventing registry or shared runtime infrastructure; D3 preserve `advisory`, read-only, trigger-only posture and explicit fallback to `imm-planner` minimal eval planning or manual acceptance; D4 keep the broader first-batch activation roadmap out of the execution boundary so this plan closes one activatable slice, not batch orchestration.
- Assumptions: A local `skills/ai-eval-planner/SKILL.md` surface is the smallest truthful runtime host in this repo; focused contract tests can verify the activation contract without claiming end-to-end runtime orchestration; README alignment should stay narrow and only cover trigger-only routing plus fallback wording.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `skills/ai-eval-planner/SKILL.md`, `.imm/specs/ai-eval-planner-runtime.spec.md`, `.imm/specs/ai-eval-planner.spec.md`, `README.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: `ai-eval-planner` can be explicitly activated as a dedicated read-only eval-design specialist surface, or clearly fall back when unavailable
      - method: focused local contract regression plus Codex runtime manual check
  - blockers: there is no dedicated specialist skill surface yet, so execution must create only the narrow activation host and not drift into a broader batch runtime or eval platform; repo-local tests cannot fully prove runtime availability
  - replan_condition: if execution starts requiring benchmark harnesses, automatic scoring, shared reviewer dispatch, unified capability detection, non-advisory authority, or more than one new reviewer slice, stop and return to preplan

## Steps

### Step 1
- Step ID: U1
- Result: `ai-eval-planner` has a dedicated runtime activation host with an advisory-only contract
- Verification: `skills/ai-eval-planner/SKILL.md` and supporting spec text define the explicit trigger boundary, required eval-design inputs, advisory-only output focus, no-tools / no-write boundary, and explicit fallback posture.
- Test scenarios: Covers IMM-EVAL-002 R1; Covers IMM-EVAL-002 R2; Covers IMM-EVAL-002 acceptance criteria 1; Covers IMM-EVAL-002 acceptance criteria 2; Covers IMM-EVAL-002 acceptance criteria 3
- Depends on: none
- Scope: `skills/ai-eval-planner/SKILL.md`, `.imm/specs/ai-eval-planner-runtime.spec.md`, and only supporting contract wording in `.imm/specs/ai-eval-planner.spec.md` if drift is discovered
- Replan condition: If a dedicated activation host cannot be expressed without registry work, authority expansion, or cross-skill orchestration changes, stop and return to `imm-preplan-review`.

### Step 2
- Step ID: U2
- Result: `ai-eval-planner` is explicit as a trigger-only specialist path at the repo contract layer
- Verification: Execution artifacts state when `ai-eval-planner` should be activated, that it is not a default gate, and how `imm-planner` minimal eval planning or manual acceptance acts as fallback when the dedicated specialist path is unavailable.
- Test scenarios: Covers IMM-EVAL-002 R3; Covers IMM-EVAL-002 acceptance criteria 4
- Depends on: 1
- Scope: `README.md`, `skills/ai-eval-planner/SKILL.md`, `.imm/specs/ai-eval-planner-runtime.spec.md`, and only supporting docs needed for routing clarity
- Replan condition: If clarifying routing starts to require a broader reviewer matrix, generic dispatcher language, or activation rules for other batch members, keep the scope on `ai-eval-planner` only and replan the broader rollout separately.

### Step 3
- Step ID: U3
- Result: a verifiable path exists for the runtime specialist slice
- Verification: `tests/test_skill_contracts.py` and the runtime spec guard the dedicated skill surface, trigger-only boundary, fallback wording, and manual validation path without claiming a full platform.
- Test scenarios: Covers IMM-EVAL-002 R4; Covers IMM-EVAL-002 acceptance criteria 5; Covers IMM-EVAL-002 acceptance criteria 6
- Depends on: 1, 2
- Scope: `tests/test_skill_contracts.py`, `.imm/specs/ai-eval-planner-runtime.spec.md`, and only supporting wording needed for traceability
- Replan condition: If truthful verification requires a provider-specific harness, runtime registry, automatic scoring stack, or orchestration across multiple reviewers, document the manual path and stop expanding this slice.

## Notes
- Keep this slice narrower than an eval platform rollout: it activates one project-specific specialist and nothing else.
- Prefer a dedicated local skill surface over hidden behavior inside existing `imm-*` authority roles.
- Manual Codex runtime validation is acceptable when the repo cannot truthfully simulate specialist activation end to end.
