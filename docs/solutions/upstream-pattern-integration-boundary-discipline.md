---
title: "Upstream Pattern Integration Requires Boundary-First Adaptation"
reusability: high
next_reuse_scenarios:
  - Integrating patterns from any external skill/agent repository
  - Adapting open-source agent patterns to authority-separated systems
  - Adding advisory annotations to plan schemas without tooling changes
  - Introducing cross-session convenience artifacts (HANDOFF.md-style)
date: 2026-05-12
origin: pocock-inspired-improvements iteration (plans 064, 065, 066)
---

## Pattern

When importing improvement patterns from an upstream repository into an authority-separated system, every imported pattern must be adapted to the host system's boundary model before merging. Patterns that work in a monolithic or loosely-coupled agent system will systematically violate authority separation when transplanted directly.

## Evidence

Studied Matt Pocock's `mattpocock/skills` repository (72k stars) and identified 7 improvement directions for Immune-Brain: shared domain language (CONTEXT.md), verification quality annotations, prototype steps, fast-track ceremony compression, cross-session handoff documents, rejected decision records, and lightweight ADRs.

Initial implementation required two rounds of code-review-driven fixes (6 total findings) before all 7 patterns correctly respected Immune-Brain's authority boundaries:

1. **Read-only roles must not write**: `imm-brainstorm` cannot create `CONTEXT.md` lazily — it surfaces conflicts and the planner creates the file. Pocock's system has no such constraint because his skills don't separate read and write authority.

2. **New write surfaces need explicit boundary declarations**: `HANDOFF.md` writes by `imm-work` required adding it to the Boundary Allowed list, parallel to existing `codex_plan.tasks` sync.

3. **Advisory annotations must declare their parsing layer**: `Verification type` and `Prototype` are advisory annotations read from raw plan markdown text, not from runtime state parsed by `imm-plan.py`. The wording "when the active step carries X" falsely implied runtime state had the field — changed to "when the active step's raw plan text contains X".

4. **Ceremony compression must not blur authority**: Fast-track cannot say `imm-work` "drives QA judgment" because QA is an authority role. Reworded to "routes through `imm-qa` closure semantics".

5. **Boundary Allowed lists must match Workflow Rules**: Planner's CONTEXT.md Vocabulary rule says "add new terms to CONTEXT.md" but Boundary Allowed only listed specs, plans, and memory. Added `CONTEXT.md` to the Allowed list.

## Reusable Guidance

- **Boundary-first, not feature-first**: Before implementing any upstream pattern, map each write it produces to the role that owns that write in the host system. If no role owns it, either assign ownership explicitly or reject the pattern.
- **Advisory vs parsed distinction**: When adding new schema fields that are not consumed by tooling, document them as advisory and name the exact layer that reads them (e.g., "read from raw plan text by executor").
- **Contract tests catch wording drift**: Each boundary fix was locked by a contract test asserting specific phrasing (e.g., `assertIn("raw plan text contains", content)`). Without these, the wording violations would have survived review.
- **Two review rounds is normal for cross-system transplants**: The first review catches structural misalignments (wrong role writes, missing boundary entries). The second catches semantic misalignments (wording that implies wrong authority, ambiguous parsing layer). Budget for both.
