# Spec: Brainstorm Codebase-First & Preplan Grill Mode Hardening

## Background

Analysis of the upstream `grill-me` skill from `mattpocock/skills` identified two
patterns that `imm-brainstorm` and `imm-preplan-review` currently lack or
under-execute:

1. **Codebase-first questioning**: `grill-me` has an explicit rule — "If a
   question can be answered by exploring the codebase, explore the codebase
   instead." `imm-brainstorm`'s inline narrowing challenge does not yet enforce
   this before surfacing probes to the user.

2. **Serial single-question + recommended-answer**: `grill-me` walks the decision
   tree one question at a time, each with a recommended answer. This reduces user
   cognitive load and prevents parallel-question overwhelm.
   `imm-preplan-review`'s existing Relentless Grilling Mode mentions decision-tree
   expansion but lacks the per-question mechanics.

## Goal

Strengthen `imm-brainstorm` and `imm-preplan-review` with the interaction
patterns that make `grill-me` effective, without weakening the existing scale-
adjusted probing depth or opt-in workflow gate design.

## Requirements

1. `imm-brainstorm` Inline Narrowing Challenge must include an explicit
   codebase-first rule: before surfacing any probe to the user, the agent must
   verify the codebase cannot answer the question itself.
2. The codebase-first rule must cover codebase exploration, existing
   `docs/solutions/`, and `CONTEXT.md` as self-resolution paths.
3. `imm-preplan-review` Relentless Grilling Mode must document the serial
   single-question + recommended-answer pattern as the preferred interaction
   style.
4. Each grilling question must include a recommended answer so the user can
   accept, reject, or refine.
5. Neither change must alter `imm-brainstorm`'s scale-adjusted probe count
   (lightweight tasks still get 1–2 probes).
6. Neither change must promote `imm-preplan-review` to a default workflow stage.
7. No new standalone Skill or workflow stage is introduced.

## Non-Goals

- Exhaustive grilling for all tasks (reserved for high-risk preplan review)
- Removing multi-probe surface for larger brainstorm tasks
- Changing the overall workflow routing (brainstorm → planner → work → QA)
