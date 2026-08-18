---
status: superseded
superseded_by: docs/adr/0003-internal-role-prompt-routing.md
retired_at: 2026-08-18
reason: Architecture exploration is now an internal role dispatch selected by Brainstorm or Planner; public user-facing entry surfaces are being reduced to the three canonical Skills.
---

# Dedicated Architecture Explorer Skill

## Context
Matt Pocock's skills repository includes a `/improve-codebase-architecture` command for active codebase deepening. Initially, we considered adding this responsibility to the `imm-compounder` skill, which already handles technical debt extraction.

## Decision
We have decided to create a dedicated `imm-arch-explorer` skill as a user-initiated entry point for global architecture exploration, rather than overloading `imm-compounder`.

## Reasoning
1. **Active vs Passive Boundary**: `imm-compounder` is a passive, workflow-forced skill that runs at the end of a task (收尾). Architecture exploration is an active, user-initiated exploration (开启) that leads to new planning cycles. Mixing these creates conceptual confusion and state machine friction.
2. **State Machine Integrity**: A compounder-initiated refactor would require a jump from the end of a task back to the beginning of a new one, bypassing the natural user-initiated entry point.
3. **Cognitive Load**: By separating the explorer, we keep the compounder focused on evidence-backed learning extraction and keep the explorer focused on high-leverage architectural seams.

## Consequences
- A new standalone skill `imm-arch-explorer` is added to the system.
- `imm-compounder` remains focused on post-task knowledge consolidation.
- Architectural deepening opportunities are surfaced when the user explicitly requests them, or when they are selected from explorer candidates and handed to `imm-planner`.
