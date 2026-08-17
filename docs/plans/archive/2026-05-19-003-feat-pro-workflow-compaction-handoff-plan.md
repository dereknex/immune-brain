---
title: "feat: pro-workflow upstream compaction and handoff slice"
type: feat
status: active
date: 2026-05-19
origin: imm-brainstorm — add pro-workflow as upstream reference; first slice compaction/handoff for Codex, Claude Code, Cursor
---

# Iteration Plan

## Task

- Summary: Register **pro-workflow** as an upstream submodule, publish borrow-map and host-specific compaction guidance, then implement a boundary-safe **compaction handoff** contract across `HANDOFF.md`, `imm-work`, and `imm-dehydrate` without SQLite or hook bundling.
- Origin: Brainstorm manifest from pro-workflow analysis; user confirmed BR-Q-1 (Codex, Claude Code, Cursor) and BR-Q-2 (compaction/handoff first).
- Research: pro-workflow `compact-guard`, `PreCompact`/`PostCompact` hooks, `/handoff` template, and `docs/context-engineering.md` Write/Compress ops; Immune-Brain already has `HANDOFF.md` (imm-work), `imm-dehydrate`/`rehydrate`, State Ledger v2, and rejected patterns for SQLite authority and post-closure ledger rewrite. Adaptation follows `docs/solutions/upstream-pattern-integration-boundary-discipline.md`.
- Decisions: D1 submodule path `upstreams/pro-workflow`; D2 reference-only for hooks (document in host guide, do not vendor); D3 `compaction_handoff` lives in `logic_state` plus mirrored HANDOFF sections; D4 max 5 **compaction priority** files in HANDOFF (pro-workflow constraint, advisory); D5 no new CLI command required in slice 1 — extend `imm-dehydrate` and skills.
- Assumptions: Users run agents from **project root**; installed `imm-dehydrate` wrapper tracks runtime copy after `mise run legacy-installer`.
- Scope Mode: Hold Scope

## Brainstorm manifest

Declared items: BR-REQ-1, BR-REQ-2, BR-REQ-3, BR-DEC-1, BR-DEC-2, BR-OUT-1, BR-OUT-2, BR-OUT-3, BR-DEFER-1, BR-DEFER-2, BR-Q-1, BR-Q-2

## Brainstorm Trace

| ID | Status | Mapping |
|----|--------|---------|
| BR-REQ-1 | covered_by_step | U1 — submodule `upstreams/pro-workflow` |
| BR-REQ-2 | covered_by_step | U1 — `docs/reference/upstream-pro-workflow-borrow-map.md` |
| BR-REQ-3 | covered_by_step | U2–U4 — spec plus implementation of P0 compaction/handoff only |
| BR-DEC-1 | captured_as_decision | Plan Decisions D3; no SQLite authority |
| BR-DEC-2 | captured_as_decision | Plan Decisions D2; hooks documented, not shipped |
| BR-OUT-1 | out_of_scope | Reason: imm-work / State Ledger remain orchestration authority |
| BR-OUT-2 | out_of_scope | Reason: wiki auto-research deferred to BR-DEFER-1 |
| BR-OUT-3 | out_of_scope | Reason: rejected shared registry pattern per solutions doc |
| BR-DEFER-1 | deferred | Reason: user-level opt-in wiki plane; future slice |
| BR-DEFER-2 | deferred | Reason: LLM prompt hooks / llm-council; future slice |
| BR-Q-1 | resolved_as_assumption | Codex + Claude Code + Cursor → U3 host guide |
| BR-Q-2 | resolved_as_assumption | compaction/handoff → U2–U4 |

## Engineering Closure Check

- architecture_surface: `.gitmodules`, `README.md`, `docs/reference/`, `docs/specs/pro-workflow-compaction-handoff.spec.md`, `HANDOFF.md` (template section in reference), `skills/imm-work/SKILL.md`, `.imm/imm-dehydrate.py`, `tests/`
- dependencies_known: true
- verification_path:
  - target: plan validates; contract tests pass; dehydrate round-trips compaction_handoff
  - method: `python3 .imm/imm-plan.py docs/plans/2026-05-19-003-feat-pro-workflow-compaction-handoff-plan.md --json`; `python3 -m unittest tests.test_skill_contracts tests.test_workflow_loop` (plus any new test module)
- blockers: none
- replan_condition: if host hook bundling is required for acceptance, stop and split a user-level optional pack slice

## Steps

### Step 1

- Step ID: U1
- Result: The pro-workflow upstream submodule is registered under `upstreams/pro-workflow`
- Verification: `.gitmodules` contains `[submodule "upstreams/pro-workflow"]` with path `upstreams/pro-workflow` and URL `https://github.com/rohitg00/pro-workflow.git`; `git submodule update --init upstreams/pro-workflow` succeeds; `README.md` upstreams list includes `pro-workflow`
- Test scenarios: Covers spec R1; Covers BR-REQ-1
- Depends on: none
- Scope: `.gitmodules`, `upstreams/pro-workflow`, `README.md`

### Step 2

- Step ID: U2
- Result: The pro-workflow borrow-map reference doc exists at `docs/reference/upstream-pro-workflow-borrow-map.md`
- Verification: File exists with P0 compaction/handoff mapping row plus explicit non-goals (no SQLite authority; no orchestrator replacement); links to upstream paths for `compact-guard` and `handoff`
- Test scenarios: Covers spec R1; Covers BR-REQ-2
- Depends on: 1
- Scope: `docs/reference/upstream-pro-workflow-borrow-map.md`

### Step 3

- Step ID: U3
- Result: The compaction handoff contract is published for Codex Claude Code Cursor hosts
- Verification: `docs/specs/pro-workflow-compaction-handoff.spec.md` includes R2 field table; `docs/reference/compaction-handoff-hosts.md` documents per-host rituals; `docs/reference/HANDOFF-template.md` lists Compaction Handoff headings matching spec R2
- Test scenarios: Covers spec R2–R3; Covers BR-REQ-3 (contract)
- Depends on: 2
- Scope: `docs/specs/pro-workflow-compaction-handoff.spec.md`, `docs/reference/compaction-handoff-hosts.md`, `docs/reference/HANDOFF-template.md`

### Step 4

- Step ID: U4
- Result: Runtime skills plus dehydrate persist compaction handoff per spec R2
- Verification: `skills/imm-work/SKILL.md` includes Compaction Handoff workflow rule; `.imm/imm-dehydrate.py` round-trips `logic_state.compaction_handoff`; `python3 -m unittest tests.test_skill_contracts tests.test_workflow_loop` exits zero
- Test scenarios: Covers spec R4–R5; Covers BR-REQ-3 (implementation); Covers BR-DEC-1; Covers BR-DEC-2
- Depends on: 3
- Scope: `skills/imm-work/SKILL.md`, `.imm/imm-dehydrate.py`, `tests/test_skill_contracts.py`, `tests/test_workflow_loop.py`

## Notes

- Default is four outcome steps; do not merge U3/U4 unless a blocker forces replan.
- When editing `README.md`, preserve substrings required by `tests/test_skill_contracts.py`.
- pro-workflow hook scripts remain in upstream submodule for diff reference only.

## Next Action

Use **`imm-work`** with this plan path: activate **U1**, execute via **`imm-executor`**, close with **`imm-qa`**, then continue U2 → U4.
