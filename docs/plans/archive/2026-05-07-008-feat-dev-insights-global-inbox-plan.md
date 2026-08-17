---
title: feat: add developer insights global inbox
type: feat
status: planned
date: 2026-05-07
origin: imm-brainstorm and imm-preplan-review handoff on 2026-05-07
---

# Iteration Plan

## Task
- Summary: Add a developer insights global inbox for Immune-Brain workflow improvement notes
- Origin: User asked to collect workflow usage improvement points for periodic improvement, then clarified that the record must live in a local computer global path across projects and that the install script should expose a switch parameter.
- Research: Checked `IMMUNE.md`, `skills/imm-compounder/SKILL.md`, `scripts/legacy-installer.sh`, `.imm/templates/iteration-plan-template.md`, `.imm/imm-plan.py`, `docs/solutions/infra-state-management.md`, `docs/solutions/skill-local-workflow-guards.md`, and `docs/solutions/codex-native-interaction-contract.md`. Conclusion: project `.imm/memory/` is runtime state, `docs/solutions/` is verified learning, and the right first slice is a disabled-by-default user-level inbox configured through the local installer.
- Decisions: D1 use `~/.immune-brain/insights/workflow-improvement-inbox.md` as the default cross-project inbox; D2 make dev insights opt-in through `IMM_DEV_INSIGHTS` or installer-created global config; D3 keep normal install behavior unchanged; D4 record structured Markdown insights only; D5 defer periodic analysis to a later plan.
- Assumptions: The feature is for Immune-Brain system developers, tests can use a temporary `HOME` to avoid writing real global files, and failed insight writes should warn without blocking the active workflow.

## Steps

### Step 1
- Step ID: U1
- Result: Developer insight contract exists
- Verification: `.imm/specs/dev-insights-global-inbox.spec.md` defines the global path, opt-in switch, record format, installer expectations, acceptance criteria, and non-goals.
- Test scenarios: Covers IMM-DEV-INSIGHTS-001 AC1
- Depends on: none

### Step 2
- Step ID: U2
- Result: Installer switch configures insights
- Verification: `zsh scripts/legacy-installer.sh --help` documents the dev insights parameter, a temporary `HOME` run initializes `~/.immune-brain/config.toml` and the inbox path, and default install leaves dev insights disabled.
- Test scenarios: Covers IMM-DEV-INSIGHTS-001 AC2; Covers IMM-DEV-INSIGHTS-001 AC3; Covers IMM-DEV-INSIGHTS-001 AC4; Covers IMM-DEV-INSIGHTS-001 AC8
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Workflow insight capture works
- Verification: With dev insights enabled through environment or global config, a workflow closure path can append one structured Markdown insight containing project identity and improvement fields; with dev insights disabled, the same path does not append.
- Test scenarios: Covers IMM-DEV-INSIGHTS-001 AC6; Covers IMM-DEV-INSIGHTS-001 AC7
- Depends on: 2

### Step 4
- Step ID: U4
- Result: Insight setup check is visible
- Verification: `zsh scripts/legacy-installer.sh --check` preserves existing skill checks and reports dev insights configuration status when the feature is enabled.
- Test scenarios: Covers IMM-DEV-INSIGHTS-001 AC5
- Depends on: 3

### Step 5
- Step ID: U5
- Result: Developer guidance is documented
- Verification: README or relevant skill docs explain the opt-in switch, global inbox path, record privacy boundary, and that periodic analysis is deferred.
- Test scenarios: Covers IMM-DEV-INSIGHTS-001 AC1; Covers IMM-DEV-INSIGHTS-001 AC2
- Depends on: 4

## Notes
- Do not implement a scheduler or periodic analyzer in this plan.
- Do not write real user global files during tests; use a temporary `HOME`.
- Do not make dev insights part of normal installation defaults.
- If the installer switch design expands beyond opt-in setup, return to replan before implementation.
