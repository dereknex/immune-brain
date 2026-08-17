---
title: Rejected pro-workflow SQLite and wiki plane as Immune-Brain authority
rejected: true
rejection_reason: >
  pro-workflow's SQLite + FTS5 global memory and wiki auto-research BFS conflict
  with FileSystem-as-Brain (.imm/memory/ + docs/solutions/). A third storage
  layer would duplicate gstack learnings.jsonl and blur Step-boundary execution.
reusability: medium
key_files:
  - docs/reference/upstream-pro-workflow-borrow-map.md
  - docs/solutions/upstream-pattern-integration-boundary-discipline.md
  - CONTEXT.md
next_reuse_scenarios:
  - A future slice proposes centralizing agent memory in SQLite
  - Evaluating pro-workflow wiki-research-loop for a project
  - Comparing self-correcting memory plugins against docs/solutions/
---

# Rejected: SQLite global memory and wiki plane in-repo

## Rejected approach

Adopt pro-workflow's `~/.pro-workflow/data.db` SQLite store and FTS5-indexed
wiki plane (including budget-capped auto-research BFS) as a default Immune-Brain
memory or research authority inside this repository.

## Rejection reason

Immune-Brain already commits to filesystem-as-brain: State Ledger in
`.imm/memory/current_iteration.json`, session summary in `state.json`, durable
learnings in `docs/solutions/`. Wiki auto-research disperses execution across
open-ended research instead of validated Plan Steps. SQLite would be a third
parallel memory system without a single closure owner.

## Preferred approach

- Borrow **compaction handoff shape** (HANDOFF section + `logic_state` mirror)
  and **host guidance** only.
- Keep wiki/SQLite as P2 defer or user-level opt-in under `~/.immune-brain/` if
  ever needed, not repo-shipped defaults.
- Record borrow intent in `docs/reference/upstream-pro-workflow-borrow-map.md`.

## Evidence

- Brainstorm manifest BR-DEC-1, BR-OUT-2, BR-DEFER-1 for plan
  `2026-05-19-003-feat-pro-workflow-compaction-handoff`.
- Slice shipped without SQLite or wiki implementation.
