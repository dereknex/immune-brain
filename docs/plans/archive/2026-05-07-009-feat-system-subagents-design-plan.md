---
title: feat: Define system subagents design for Immune-Brain
type: feat
status: planned
date: 2026-05-07
origin: user request and .imm/specs/system-subagents-design.spec.md
---

# Iteration Plan

## Task
- Summary: Refine the first-version governance contract for Immune-Brain system subagents
- Origin: Continuation of `IMM-SUBAGENTS-001` after README review, upstream subagent analysis, and `imm-preplan-review` chose `Hold Scope` for a docs-and-contract first slice.
- Research: Checked `IMMUNE.md`, the current README subagent sections, the existing spec, and upstream subagent patterns from BMAD, Compound Engineering, GSD, gstack, and impeccable. Conclusion: the repo already has a solid three-layer roster direction, but the first executable slice should tighten authority/routing boundaries, manifest/output contracts, and the minimal project-specific layer before any runtime work.
- Decisions: D1 keep the work docs-first and governance-first; D2 preserve the three-layer roster and the <=8 core-agent cap; D3 explicitly separate `imm-party` advisory behavior from the system subagent roster; D4 treat invocation stage, authority class, manifest fields, and output schema as the first implementation boundary; D5 keep risk specialists conditional and keep project-specific agents minimal instead of broadening the default roster.
- Assumptions: Existing README and spec content are a baseline to refine rather than blank pages; verification can rely on spec/README/plan alignment plus the local plan validator; no runtime dispatcher, agent-to-agent communication, or persistent subagent state belongs in this slice.

## Steps

### Step 1
- Step ID: U1
- Result: authority matrix 与 routing boundary 成文
- Verification: `.imm/specs/system-subagents-design.spec.md` and repository documentation clearly distinguish `imm-party`, system subagents, and `imm-*` authority roles, and define which subagent classes are advisory versus bounded artifact/execution helpers.
- Scope: `.imm/specs/system-subagents-design.spec.md`, `README.md`, and this plan's task framing only.
- Replan condition: If the chosen boundary requires runtime dispatch behavior, long-lived subagent state, or authority expansion beyond existing `imm-*` roles, return to `imm-preplan-review`.
- Test scenarios: Covers R1; Covers R3; Covers R9
- Depends on: none

### Step 2
- Step ID: U2
- Result: core / conditional / project-specific subagent manifest contract 成文
- Verification: Documentation defines the required manifest fields for subagents, including trigger, invocation stage, authority class, write/tool boundary, and minimum output schema, and applies that contract to the first-version core roster.
- Scope: `.imm/specs/system-subagents-design.spec.md`, `README.md`, and any supporting plan text needed to express the contract.
- Replan condition: If the contract cannot be expressed without inventing a runtime registry or provider-specific execution layer, narrow the contract back to docs-only parseable fields.
- Test scenarios: Covers R2; Covers R7; Covers R8; Covers R9
- Depends on: 1

### Step 3
- Step ID: U3
- Result: 条件风险层与项目专用层的最小首版范围成文
- Verification: Documentation defines conditional triggers for risk specialists, identifies a minimal first-version project-specific layer, and explains why these agents are not default workflow participants.
- Scope: `.imm/specs/system-subagents-design.spec.md` and `README.md` sections describing layer boundaries, triggers, and scenario mapping.
- Replan condition: If project-specific examples start expanding into a broad default roster or require new workflow stages, return to a narrower first-version layer definition.
- Test scenarios: Covers R4; Covers R5; Covers R6; Covers R10
- Depends on: 2

### Step 4
- Step ID: U4
- Result: README / spec / upstream rationale 对齐并通过本地计划校验
- Verification: README and spec align on the docs-first first version, on the borrowed-versus-rejected upstream patterns, and on the first-version non-goals; `imm-plan docs/plans/2026-05-07-009-feat-system-subagents-design-plan.md --json` passes.
- Scope: README/spec alignment, upstream rationale wording, and plan validation evidence only.
- Replan condition: If the docs disagree on first-version scope or the validator exposes mixed-outcome steps, revise the plan before any execution handoff.
- Test scenarios: Covers R6; Covers R10
- Depends on: 1, 2, 3

## Notes
- Keep the first implementation documentation-first and contract-first.
- Do not add a runtime registry, automatic dispatcher, or agent-to-agent communication in this plan.
- Use upstream learnings to justify boundaries, not to import upstream-sized rosters.
- If execution discovers that a subagent needs broader write access, route that through `imm-preplan-review` or a new plan before expanding permissions.
