---
title: imm-arch-explorer Domain Mapper mode
type: feat
status: planned
date: 2026-05-18
---

# Spec: imm-arch-explorer Domain Mapper mode

## Objective

Extend the existing `imm-arch-explorer` Parallel Domain Survey into a concrete
Domain Mapper mode for large or unfamiliar codebases. The goal is to reduce
solo exploration context pressure by surveying bounded directory or domain
shards in parallel while preserving the explorer's read-only advisory boundary.

## Background

`imm-arch-explorer` already has a prompt-level Dispatch Protocol for Parallel
Domain Survey. That first slice proved the contract surface but still leaves
three gaps:

1. Domain Mapper behavior is not named as a concrete mode with a stable shard
   strategy and child output schema.
2. There is no host-facing execution truth comparable to the `imm-code-review`
   completion path.
3. Mapper findings are not yet durable enough for later planning or compounder
   analysis.

The repository also has a rejected learning against shared registry or generic
dispatcher work. This spec keeps the work host-bound to `imm-arch-explorer`.

## Requirements

- **R1. Contract mode**: `skills/imm-arch-explorer/SKILL.md` defines Domain
  Mapper as a concrete mode under Parallel Domain Survey.
- **R2. Trigger and shard rules**: Domain Mapper dispatch is used only after
  scope confirmation for large or unfamiliar multi-directory exploration. Shards
  are bounded by top-level directory or domain surface.
- **R3. Child boundary**: Each mapper uses `generalPurpose`, `readonly: true`
  where supported, `tool_policy: no tools`, and advisory-only instructions.
- **R4. Child output schema**: Each mapper returns structured evidence:
  `key_files`, `domain_terms`, `ownership_boundaries`, `weak_boundaries`,
  `coupling_evidence`, `candidate_opportunities`, and `uncertainties`.
- **R5. Host synthesis**: `imm-arch-explorer` merges mapper outputs into
  candidates, recommended selection, blast radius, boring alternative, cost of
  doing nothing, strongest counterargument, and planner handoff.
- **R6. Execution truth**: A later phase may introduce host-facing helpers that
  build mapper invocation envelopes and normalize mapper results without
  creating a generic dispatcher.
- **R7. Durability and telemetry**: A later phase may persist mapper findings as
  child evidence or telemetry so later planning and compounder work can inspect
  whether dispatch improved coverage.

## Non-goals

- No shared registry, generic dispatcher, background scheduler, or cross-host
  platform.
- No automatic architecture rewrite.
- No subagent authority to write plans, implementation code, `.imm/memory/`, or
  QA closure decisions.
- No new dedicated `domain-mapper` skill unless later evidence shows
  `generalPurpose` prompts are insufficient.

## Phases

### Phase 1: Contract-first Domain Mapper

Lock the prompt contract and regression coverage. This phase should be small:
`imm-arch-explorer` names Domain Mapper mode, defines trigger and shard rules,
defines the child output schema, and preserves no-platform constraints.

### Phase 2: Host-facing execution truth

Add deterministic host-facing evidence for how mapper dispatch is assembled and
how child results are normalized. Provider tool calls remain outside unit tests;
tests should use fake runtime callables or envelope builders.

### Phase 3: Durable evidence and telemetry

Persist or summarize mapper results so later `imm-planner` and
`imm-compounder` work can inspect dispatch coverage, fallback reasons, shard
coverage, and whether mapper output improved architecture candidate quality.

## Acceptance

- Each phase is independently closable by automated tests.
- Phase 1 can ship without Phase 2 or Phase 3.
- Later phases must preserve the rejected shared-registry boundary.
