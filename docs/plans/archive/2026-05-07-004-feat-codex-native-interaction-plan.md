---
title: feat: add codex-native interaction contract
type: feat
status: planned
date: 2026-05-07
origin: user brainstorm on Codex integration on 2026-05-07
---

# Iteration Plan

## Task
- Summary: Make Immune-Brain easier to use inside Codex through a native interaction contract
- Origin: User asked how Immune-Brain can better integrate with Codex and fully use Codex interaction capabilities. Follow-up requested concrete benefits and improvement suggestions, then asked for an Immune-Brain plan.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/immune-brain-requirements.md`, `docs/solutions/skill-local-workflow-guards.md`, `docs/solutions/single-step-orchestration-entry.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, and existing plan/spec examples.
- Decisions: D1 plan the narrow Codex-native interaction contract first; D2 keep Codex as interaction coordinator rather than executor; D3 expose tool integrations as optional capability hooks; D4 preserve validated plan and active step guards before implementation.
- Assumptions: Existing `.imm` state is enough for first routing improvements; Codex plugin availability varies by environment; the first useful outcome is clearer interaction and safer routing, not automatic end-to-end execution.

## Steps

### Step 1
- Step ID: U1
- Result: 交互契约成型
- Verification: `.imm/specs/codex-native-interaction.spec.md` defines the first-version Codex-native contract, including state reporting, next-action fields, workflow guards, and explicit non-goals around full automation.
- Test scenarios: Covers IMM-CODEX-001 AC1
- Depends on: none

### Step 2
- Step ID: U2
- Result: 阶段输出统一
- Verification: The user-facing Immune-Brain skill docs that start or route workflow stages describe a consistent `Next Action`, `Allowed`, `Blocked`, and workflow guard output shape without granting implementation authority to read-only or coordinator roles.
- Test scenarios: Covers IMM-CODEX-001 AC2; Covers IMM-CODEX-001 AC5
- Depends on: 1

### Step 3
- Step ID: U3
- Result: 工作状态适配Codex
- Verification: `imm-work` status documentation or output describes how Codex should consume the active plan, active step, verification requirement, stop condition, and next skill while preserving one-step-at-a-time execution.
- Test scenarios: Covers IMM-CODEX-001 AC3; Covers IMM-CODEX-001 AC5
- Depends on: 2

### Step 4
- Step ID: U4
- Result: 能力钩子可发现
- Verification: Documentation lists Codex capability hooks for Browser QA, GitHub PR, automation, sub-agent advisory, and external notes, with trigger conditions, boundaries, and fallback behavior when the capability is unavailable.
- Test scenarios: Covers IMM-CODEX-001 AC4
- Depends on: 3

## Notes
- Do not implement a centralized router in this slice.
- Do not make `imm-work` execute code or record QA decisions.
- If a capability hook requires a plugin that is unavailable, the workflow should continue with a plain text next-action recommendation.
