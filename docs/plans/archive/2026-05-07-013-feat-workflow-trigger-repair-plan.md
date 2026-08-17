---
title: feat: repair workflow trigger gaps
type: feat
status: planned
date: 2026-05-07
origin: user reported three Immune-Brain skill trigger failures on 2026-05-07
---

# Iteration Plan

## Task
- Summary: Repair observed Immune-Brain workflow trigger gaps
- Origin: User reported that `imm-autowork` does not update Codex status, dev insights stays empty after multiple compound runs, and subagents never activate. `imm-brainstorm` confirmed the three observations, and `imm-preplan-review` narrowed the work to observable trigger repairs rather than registry or orchestration expansion.
- Research: Checked `IMMUNE.md`, `skills/imm-work/SKILL.md`, `skills/imm-autowork/SKILL.md`, `skills/imm-compounder/SKILL.md`, `skills/imm-party/SKILL.md`, `.imm/imm-finish.py`, `.imm/specs/bounded-autowork-skill.spec.md`, `.imm/specs/dev-insights-global-inbox.spec.md`, `.imm/specs/system-subagents-design.spec.md`, and existing solution docs for Codex task snapshots, global dev insights, and bounded autowork. Conclusion: the gaps are mostly disconnected runtime hooks and missing Codex/sub-agent facing contracts, not a need for a new workflow platform.
- Decisions: D1 keep the scope to the three user-observed trigger gaps; D2 preserve `.imm` as source of truth and only sync Codex task display one way; D3 connect dev insights to the compound/finish closure path without turning inbox entries into formal solutions; D4 make sub-agent activation explicit-request only with solo fallback; D5 require focused regression evidence so the fixes are observable.
- Assumptions: Codex status can be refreshed from `imm-work status` after autowork state changes; the existing dev insights format is sufficient for compound-triggered records; the current environment may support sub-agents but the workflow must still provide a fallback; full subagent registry work belongs in a later plan.
- Scope Mode: Scope Reduction
- Engineering Closure Check: Edit surfaces are identifiable across skill contracts, `.imm/imm-finish.py`, and focused tests. Verification can use local status output, temporary HOME dev insights tests, and explicit party/sub-agent routing checks. Replan if implementation requires long-lived subagent state, background scheduling, or reverse Codex state sync.

## Steps

### Step 1
- Step ID: U1
- Result: autowork exposes Codex task sync
- Verification: `skills/imm-autowork/SKILL.md` and any supporting docs state that Codex must refresh native task display from `imm-work status` / `codex_plan.tasks` after autowork state changes, while preserving one-way `.imm` to Codex sync.
- Test scenarios: Covers IMM-WORKFLOW-006 R1; Covers IMM-WORKFLOW-006 acceptance criteria 1; Covers IMM-WORKFLOW-006 acceptance criteria 2
- Depends on: none

### Step 2
- Step ID: U2
- Result: compounder records dev insights
- Verification: With dev insights enabled in a temporary HOME or environment override, the compound/finish closure path appends one structured record to `workflow-improvement-inbox.md`; with dev insights disabled, the same path appends nothing.
- Test scenarios: Covers IMM-WORKFLOW-006 R2; Covers IMM-WORKFLOW-006 acceptance criteria 3; Covers IMM-WORKFLOW-006 acceptance criteria 4
- Depends on: none

### Step 3
- Step ID: U3
- Result: party requests activate subagents
- Verification: `skills/imm-party/SKILL.md` and focused tests or documented runtime checks prove explicit party / multi-agent requests route to bounded read-only sub-agent advisory when available, and otherwise produce an explicit solo fallback.
- Test scenarios: Covers IMM-WORKFLOW-006 R3; Covers IMM-WORKFLOW-006 acceptance criteria 5; Covers IMM-WORKFLOW-006 acceptance criteria 6
- Depends on: none

### Step 4
- Step ID: U4
- Result: regression coverage proves triggers
- Verification: Local validation includes the new spec and plan, plus focused tests or command evidence for autowork Codex sync, dev insights append behavior, and explicit sub-agent routing / fallback.
- Test scenarios: Covers IMM-WORKFLOW-006 R4; Covers IMM-WORKFLOW-006 acceptance criteria 7
- Depends on: 1, 2, 3

## Notes
- Keep the first implementation surgical. Do not introduce a runtime registry, background scheduler, reverse Codex sync, or automatic sub-agent selection.
- If actual Codex sub-agent activation cannot be unit-tested locally, record a clear manual validation path and keep automated tests around the routing contract.
- If dev insights needs a shared helper, extract only the existing finish-path append behavior; do not create telemetry or analytics infrastructure.
