---
title: feat: define skill contract lint slice
type: feat
status: planned
date: 2026-05-07
origin: user asked on 2026-05-07 to analyze OpenAI's Harness engineering article and plan the best next improvement for this system, with the reference URL preserved in the planning docs
---

# Iteration Plan

## Task
- Summary: Define the first skill/workflow contract lint slice for Immune-Brain
- Origin: User asked to analyze OpenAI's Harness engineering article and decide how this system should improve next; `imm-brainstorm` and `imm-preplan-review` narrowed the default recommendation to skill/workflow contract lint rather than a broader workflow harness. Reference: [Harness engineering](https://openai.com/index/harness-engineering/).
- Research: Checked `IMMUNE.md`, `docs/brainstorms/immune-brain-requirements.md`, `docs/brainstorms/imm-brainstorm-output-2026-05-07.md`, `docs/solutions/skill-local-workflow-guards.md`, `docs/solutions/codex-native-interaction-contract.md`, `tests/test_skill_contracts.py`, existing `.imm/specs/*workflow*`, and prior plans for current-step orchestration and bounded autowork. Conclusion: the repo already has plan/work validators and some contract tests, but skill-level contract coverage is still shallow enough that a narrow lint slice is the best first improvement.
- Decisions: D1 choose skill/workflow contract lint as the first slice instead of a full workflow harness; D2 keep the first slice document-and-test centric, not runtime centric; D3 require explicit coverage for `Next Action`, `Allowed`, `Blocked`, and `Workflow guard`; D4 treat role-boundary checks and handoff-guard checks as separate outcomes so later implementation can prove both; D5 preserve the article reference URL directly in spec/plan artifacts for traceability.
- Assumptions: Existing `tests/test_skill_contracts.py` is the right anchor for first implementation; the main value of this slice is stronger mechanical readability for agents rather than new user-visible functionality; if stronger stateful validation is needed later, it should become a separate workflow harness plan.

## Steps

### Step 1
- Step ID: U1
- Result: contract lint scope is specified
- Verification: `.imm/specs/skill-contract-lint.spec.md` defines the first slice as skill/workflow contract lint, explicitly excludes full workflow harness work, and preserves the OpenAI article URL as a source reference.
- Test scenarios: Covers IMM-WORKFLOW-005 R1; Covers IMM-WORKFLOW-005 R5
- Depends on: none

### Step 2
- Step ID: U2
- Result: contract outcomes are decomposed into independent checks
- Verification: This plan separates contract-field coverage, role-boundary coverage, and workflow-guard coverage into distinct verifiable outcomes instead of bundling them into a generic "improve skill contracts" step.
- Test scenarios: Covers IMM-WORKFLOW-005 R2; Covers IMM-WORKFLOW-005 R3; Covers IMM-WORKFLOW-005 R4
- Depends on: 1

### Step 3
- Step ID: U3
- Result: validation path for the first implementation is explicit
- Verification: The spec and plan together state how a later implementation must prove contract fields, role boundaries, and workflow guards through local tests rooted in `tests/test_skill_contracts.py` or focused fixtures.
- Test scenarios: Covers IMM-WORKFLOW-005 acceptance criteria 2; Covers IMM-WORKFLOW-005 acceptance criteria 4; Covers IMM-WORKFLOW-005 acceptance criteria 5
- Depends on: 2

## Notes
- Keep this slice narrow: do not expand into workflow harness, stale-doc GC, or runtime orchestration changes during planning.
- Prefer extending the existing skill contract test entrypoint over adding a parallel validation subsystem.
- If implementation reveals that text-only contract checks are insufficient, create a separate follow-up plan for stateful workflow harness work instead of silently expanding this slice.
