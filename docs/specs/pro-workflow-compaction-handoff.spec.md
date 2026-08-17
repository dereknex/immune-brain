# Spec: pro-workflow compaction and handoff (slice 1)

**Task ID**: IMM-UPSTREAM-PW-001
**Owner**: Planner
**Status**: Partially superseded

The `HANDOFF.md` half shipped and then changed hands: the runtime now owns the
derivable region and refreshes it on `imm-review pass`, while the narrative
sections stay with the agent. The `imm-dehydrate` / `state.json` /
`logic_state.compaction_handoff` half is withdrawn along with the command; see
`docs/specs/current-iteration-efficiency.spec.md`. Read every mention of
dehydration or rehydration below as historical.

## 1. Goal

Borrow [pro-workflow](https://github.com/rohitg00/pro-workflow) patterns for **compaction-safe session continuity** and **richer cross-session handoff**, adapted to Immune-Brain authority boundaries, for hosts **Codex**, **Claude Code**, and **Cursor**.

This slice does **not** introduce SQLite, wiki planes, or a second memory authority. `.imm/memory/` remains source of truth; `HANDOFF.md` remains a human-readable convenience artifact written by `imm-work`.

## 2. Problem

After context compaction (manual or automatic), agents lose:

- Which **Plan** and **Step** were active
- Which files were being edited (host limits: Claude Code restores ~5 files / ~50K tokens)
- Decisions made this session that are not yet in specs or solutions

`imm-dehydrate` already writes `state.json` with summary, next steps, and `current_iteration`, but it does not document **pre-compaction ritual**, **priority file selection**, or a **stable HANDOFF section schema** aligned across three hosts.

## 3. Requirements

### R1. Upstream reference registration

- Add git submodule `upstreams/pro-workflow` → `https://github.com/rohitg00/pro-workflow.git`
- Publish `docs/reference/upstream-pro-workflow-borrow-map.md` with P0/P1/P2 mapping and explicit non-goals (no SQLite authority, no orchestrator replacement)
- README upstreams section lists the new path and init command

### R2. Compaction handoff contract (file-backed)

Define a documented **Compaction Handoff** block that `imm-work` may write into `HANDOFF.md` before compaction or at QA pass when the user signals compaction risk.

Required fields (markdown headings):

| Field | Source of truth | Notes |
|-------|-----------------|-------|
| Active plan path | `.imm/memory/current_iteration.json` or validated plan on disk | Relative to project root |
| Active Step ID + Result | State Ledger derived active step | Omit when no active step |
| Files in play | Session edits + explicit user priority | Max 5 paths called out as **compaction priority** (pro-workflow lesson) |
| Uncommitted work | `git status --short` summary | One-line counts + top paths |
| Decisions this session | Free text | Not a substitute for ADR/solutions |
| Next boundary | `imm-work` / QA next action | e.g. executor vs QA |

`.imm/memory/state.json` `logic_state` may mirror the same structure under `compaction_handoff` for machine-readable rehydrate; `imm-dehydrate` must accept optional JSON via stdin or `--logic-state` file when present (backward compatible if absent).

### R3. Host guidance (Codex, Claude Code, Cursor)

- `docs/reference/compaction-handoff-hosts.md` documents per-host compaction behavior and recommended user actions
- Claude Code: optional pointer to pro-workflow `PreCompact`/`PostCompact` hooks as **user-installed** plugin hooks, not repo-shipped defaults
- Codex / Cursor: ritual is **manual** `imm-dehydrate` + HANDOFF update; no assumption of hook events
- All hosts: recommend `python3 .imm/imm-dehydrate.py --rehydrate` (or installed `imm-dehydrate --rehydrate`) at session start after compaction

### R4. Skill boundary compliance

- `imm-work` may create/update `HANDOFF.md` (existing boundary exception)
- `imm-dehydrate` may write `.imm/memory/state.json` and `MEMORY.md` summary sync only
- No new role may write closed Step evidence in the State Ledger (see `docs/solutions/rejected-post-closure-ledger-rewrite.md`)
- Do not add generic subagent registry/dispatcher (see `docs/solutions/rejected-shared-registry-generic-dispatcher.md`)

### R5. Regression locks

- Contract tests assert HANDOFF compaction section headings exist in template or skill text
- `imm-dehydrate` unit tests cover optional `compaction_handoff` in `logic_state`
- `python3 .imm/imm-plan.py` validates the iteration plan for this spec

## 4. Non-goals (this slice)

- Shipping pro-workflow hook scripts inside this repo
- SQLite learnings DB or wiki auto-research
- Replacing `imm-work` with pro-workflow orchestrator
- Automatic compaction detection in Python (host-dependent; document only)

## 5. Acceptance

- [ ] Submodule initialized and documented
- [ ] Borrow-map and host guide exist under `docs/reference/`
- [ ] Spec R2 fields reflected in HANDOFF template and `imm-work` workflow rule
- [ ] `imm-dehydrate` preserves `logic_state.compaction_handoff` round-trip
- [ ] `python3 -m unittest tests.test_skill_contracts tests.test_workflow_loop` passes (or targeted new test module green)
