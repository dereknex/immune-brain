---
title: Grill-Me Interaction Mechanics Borrow
reusability: high
key_files:
  - plugins/immune-brain/skills/imm-brainstorm/SKILL.md
  - plugins/immune-brain/skills/imm-planner/SKILL.md
  - plugins/immune-brain/dist/imm-brainstorm.md
  - plugins/immune-brain/dist/imm-planner.md
  - tests/brainstorm-decision-probing-contract.test.ts
  - tests/exhaustive-decision-tree-contract.test.ts
  - tests/fixtures/imm-brainstorm-behavior-benchmark.json
next_reuse_scenarios:
  - Borrowing interaction discipline from a terse upstream skill without importing its workflow topology
  - Clarifying a fixed current goal through provenance-bounded exhaustive traversal
  - Separating repository facts from user-owned decisions
  - Continuing downstream traversal after a recommended answer is adopted
  - Keeping Planner clarification limited to concrete omissions, conflicts, and invalidated assumptions
---

## Current pattern

`imm-brainstorm` owns exhaustive clarification for the fixed current goal:

1. Classify each surfaced uncertainty by provenance. Resolve repository facts with bounded read-only evidence; put user-owned decisions on the clarification frontier.
2. Ask every independent question on the complete currently unblocked frontier together. Include a concrete recommendation and trade-off for each decision.
3. Treat an adopted recommendation as the answer to that frontier node only. Expand and traverse newly reachable downstream branches until the frontier is empty.
4. Reopen a confirmed decision only when new evidence invalidates an assumption or the proposed summary introduces or changes a decision.
5. Record explicit `defer` and `blocked` outcomes rather than silently treating them as resolved.

`adversarial` is an explicit analysis lens over this same frontier protocol. It does not own a separate interview or routing stage.

`imm-planner` consumes the confirmed Brainstorm manifest, resolves repository facts and ordinary technical choices, and performs reference closure. It asks a clarification supplement only for a concrete omission, repository conflict, invalidated assumption, or newly surfaced user decision; it does not run a second exhaustive interview or silently change a confirmed decision.

## Historical origin

The pattern originated by borrowing decision-tree traversal, recommended answers, and codebase-before-human discipline from Matt Pocock's terse `grill-me` skill. The first Immune-Brain implementation split those mechanics across `imm-brainstorm` and `imm-preplan-review` and applied fixed question budgets.

`imm-preplan-review` has been retired. These interaction mechanics now belong to `imm-brainstorm`, and the former split ownership and budget rules are historical evidence only. Git history and archived Specs retain the original implementation details; they are not current routing or behavior instructions.

## Verification evidence

- `tests/brainstorm-decision-probing-contract.test.ts` guards frontier ordering, recommendation continuation, provenance handling, retired ownership, and focused behavior scenarios.
- `tests/exhaustive-decision-tree-contract.test.ts` guards complete-frontier traversal, frontier-empty completion, decision-delta reopening, and Planner's supplement-only posture.
- `tests/fixtures/imm-brainstorm-behavior-benchmark.json` covers dependent and independent frontiers, recommendation continuation, scenario-qualified questions, and rejected-decision evidence.
- `bun scripts/sync-dist-docs.ts --check` keeps the public Skill sources and packaged contracts synchronized.

## Reuse boundary

Borrow interaction mechanics into existing owners only when they strengthen the current authority model. Do not import an upstream skill's stage topology, fixed budget, or ownership split merely because its interview behavior is useful. Contract tests prove instruction presence and ownership boundaries; focused model scenarios provide bounded behavioral evidence but do not establish cross-model compliance.

## Architecture map

No `CONTEXT.md` Architecture Map entry is needed. This Learning describes behavior inside the existing Brainstorm and Planner public entries and adds no runtime path or authority owner.

---
Recorded: 2026-06-27 | Rewritten for current ownership: 2026-08-25
