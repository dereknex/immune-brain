---
title: feat: sync Immune-Brain plans to Codex tasks
type: feat
status: planned
date: 2026-05-07
origin: user request to reference CE Codex plan integration on 2026-05-07
---

# Iteration Plan

## Task
- Summary: Sync Immune-Brain plan steps into Codex native task display
- Origin: User asked to reference CE's Codex plan integration and improve this project's Codex integration. Prior analysis found CE maps durable plan units into Codex `update_plan` tasks while keeping the Markdown plan as the source of truth.
- Research: Checked CE `ce-plan`, `ce-work`, and Codex compatibility mapping; checked local `.imm/specs/codex-native-interaction.spec.md`, `.imm/imm-work.py`, `skills/imm-work/SKILL.md`, README, and current-step driver plan. Conclusion: Immune-Brain already exposes `codex_status`, but it lacks a Codex-native task snapshot equivalent to CE's U-ID-to-task mapping.
- Decisions: D1 add `codex_plan.tasks` to `imm-work status` instead of changing plan files; D2 derive statuses from existing `.imm` state so Codex is display-only; D3 document that `imm-work` should call Codex `update_plan` from the snapshot; D4 leave reverse sync, full-plan autowork, and executor/QA authority unchanged.
- Assumptions: Codex consumers can translate `pending` / `in_progress` / `completed` task rows into `update_plan`; existing plan validation is enough to build the snapshot; this can coexist with the current-step driver work because it only extends status output and docs.

## Steps

### Step 1
- Step ID: U1
- Result: Codex task snapshot exists
- Verification: `python3 .imm/imm-work.py status` returns `codex_plan.tasks` with each plan step mapped to `pending`, `in_progress`, or `completed`.
- Test scenarios: Covers IMM-CODEX-002 AC1; Covers IMM-CODEX-002 AC2
- Depends on: none

### Step 2
- Step ID: U2
- Result: Codex sync contract documented
- Verification: `skills/imm-work/SKILL.md` and README explain that Codex should sync `codex_plan.tasks` to native `update_plan`, while `.imm` remains the source of truth.
- Test scenarios: Covers IMM-CODEX-002 AC3; Covers IMM-CODEX-002 AC4
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Plan sync validation is reproducible
- Verification: `python3 .imm/imm-plan.py docs/plans/2026-05-07-006-feat-codex-plan-sync-plan.md --json`, `python3 .imm/imm-work.py status`, and a focused `rg` check prove the plan, status output, and docs contain the Codex sync contract.
- Test scenarios: Covers IMM-CODEX-002 AC5
- Depends on: 2

## Notes
- Do not make Codex native plan a writable state source.
- Do not expand this slice into current-step execution automation.
- If reverse sync becomes necessary, create a separate spec because it changes ownership and failure modes.
