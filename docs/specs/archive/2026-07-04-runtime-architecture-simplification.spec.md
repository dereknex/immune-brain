---
title: "refactor: runtime architecture simplification wave"
type: refactor
status: planned
date: 2026-07-04
origin:
  - imm-arch-explorer opportunities 1, 2, and 3
  - readonly planner research on State Ledger, OpenCode runtime, and Roadmap criteria validation
---

# Runtime Architecture Simplification Spec

## 1. Goal

Simplify three architecture seams without changing the Immune-Brain workflow authority model:

1. Replace ceremonial State Ledger class usage with a function-first API while preserving compatibility for existing imports.
2. Reduce OpenCode runtime command pass-through drift by giving plugin calls one tested command invocation contract.
3. Move `acceptance_criteria` and `promotion_criteria` from document-only Roadmap convention toward lightweight validator feedback.

This is a maintenance slice. It should remove or constrain accidental complexity, not create a new platform layer.

## 2. Current Technical Evidence

### State Ledger helper seam

`plugins/immune-brain/runtime/imm_core.ts` exports `LedgerStateMachine`, but the class has no instance state. Runtime callers instantiate it as a stateless helper, and tests import it directly. Current behavior mutates the passed State Ledger object in place. Existing State Ledger schema, state enum values, and transition behavior must remain stable.

### OpenCode command seam

`plugins/immune-brain/.opencode-plugin/runtime.ts` currently maps OpenCode tool names to CLI arguments, shell-escapes them, then invokes `bun <runtime>/immune_brain_runtime.ts cli ...` through `input.$`. The TypeScript runtime also owns its own command manifest and dispatch table. The main failure mode is drift between OpenCode command mapping, plugin-local `bin/imm-*` wrappers, and runtime `IMM_COMMANDS`. `imm-pr-diag` is a shell exception and is not part of the runtime pass-through set.

### Roadmap criteria seam

`CONTEXT.md` defines `acceptance_criteria` and `promotion_criteria`. Existing Roadmap human acceptance gating work intentionally kept Phase 1 as document convention only. The current TypeScript `validatePlan` validates parsed Plan steps and Brainstorm Trace, but it does not parse Roadmap phases or emit warnings for missing or non-behavioral acceptance criteria. The runtime plan JSON output currently exposes errors but no warning channel.

## 3. Requirements

### R1. State Ledger helper simplification

- Provide a function-first State Ledger transition API in `plugins/immune-brain/runtime/imm_core.ts`.
- Preserve `LedgerStateMachine` as a compatibility wrapper unless a test intentionally proves the export can be removed.
- Preserve in-place mutation semantics, State Ledger schema, step state enum values, legal transitions, and existing error text where tests assert it.
- Avoid widening State Ledger behavior such as parallel active Steps or new lifecycle states.

### R2. OpenCode command invocation contract

- Keep plugin-local CLI wrappers as supported user-facing command entry points.
- Keep `imm-pr-diag` explicitly outside the shared runtime command map unless it is intentionally ported later.
- Add focused tests for OpenCode `buildArgv()` mappings, `IMMUNE_BRAIN_PLUGIN_ROOT` runtime resolution, and at least one plugin-local wrapper smoke path.
- Reduce duplicated command mapping where practical by sharing a typed command contract or exported manifest from the runtime layer.
- If direct in-process OpenCode invocation is implemented, it must preserve target project root resolution and still support installed-plugin/cache layouts that do not vendor the target repo.

### R3. Roadmap criteria validation feedback

- Add a small validator model for Roadmap phase `acceptance_criteria` presence when a Roadmap has three or more phases.
- Keep `promotion_criteria` independent from acceptance completion; do not collapse the concepts.
- Emit structured warnings for non-behavioral or empty acceptance criteria instead of blocking valid one-phase or two-phase Plans.
- Extend `imm-plan --json` output with a backwards-compatible warning channel if warnings are introduced.
- Add focused TypeScript tests before broadening validator behavior.

## 4. Non-goals

- Do not change State Ledger persisted schema or migrate existing `.imm/memory/current_iteration.json` files.
- Do not remove plugin-local shell wrappers in this slice.
- Do not add a daemon, scheduler, generic dispatcher, MCP replacement, or new dependency.
- Do not make Roadmap validation a hard gate for all Plans.
- Do not rewrite unrelated workflow authority boundaries such as Executor, QA, reviewer gates, or Compounder behavior.
- Do not implement deferred Roadmap Phase 3 or Phase 4 enforcement beyond lightweight validator feedback.

## 5. Acceptance Criteria

- Focused State Ledger tests pass after the helper becomes function-first and compatibility imports still work.
- OpenCode runtime tests cover command argument mapping, runtime root override, and wrapper smoke behavior.
- Runtime command discovery and OpenCode mapping cannot silently drift for supported `imm-*` commands.
- Roadmap criteria validation reports missing or empty acceptance criteria for three-plus phase Roadmaps while allowing smaller Plans.
- `promotion_criteria` remains separately represented and independently testable.
- `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-001-refactor-runtime-architecture-simplification-plan.md --json` validates the Plan.
