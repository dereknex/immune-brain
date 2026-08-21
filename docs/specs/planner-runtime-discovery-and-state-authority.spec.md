# Planner Runtime Discovery and State Authority Contract

**Status**: Candidate
**Task**: `2026-08-21-003-planner-runtime-discovery-and-state-authority`
**Output Language**: English prose; preserve CLI commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: Medium - this changes public Planner instructions that select canonical control-plane commands and interpret workflow ownership, but it does not change runtime code or mutation authority.
**Diagram decision**: not_required
**Diagram reason**: The change is two direct instruction invariants with no new state transition, component flow, or runtime interface.

## Problem

The public Planner contracts instruct agents to invoke bare `imm-plan` and
`imm-kernel` commands even though a Pi package guarantees the packaged wrappers
exist but does not guarantee they are exposed through the shell `PATH`. A real
Planner run therefore failed with `imm-plan: command not found` and had to search
for the wrapper before continuing.

The same contract tells Planner to inspect `CONTEXT.md` for vocabulary and
navigation but does not state the authority order when prose status there
conflicts with the Assurance projection or TaskRecord. This can cause needless
history reconstruction even though `CONTEXT.md` is explicitly not the runtime
source of truth.

## Goal

Make Planner execution deterministic by requiring it to resolve canonical CLI
wrappers from the declared Skill location instead of assuming shell `PATH`, and
make workflow-state interpretation explicit: Assurance projection and TaskRecord
own current task facts; `CONTEXT.md` owns vocabulary and architecture navigation
only.

## Technical Design

1. In both `plugins/immune-brain/skills/imm-planner/SKILL.md` and
   `plugins/immune-brain/dist/imm-planner.md`, define the loaded Skill location as
   the anchor for canonical wrapper discovery. Resolve `../../bin/imm-plan` and
   `../../bin/imm-kernel` from the source Skill directory before invoking routing,
   authoring, or validation commands. Do not assume a bare command is on `PATH`.
2. In both contracts, state that current owner, phase, completion, and authority
   facts come from the Assurance projection and TaskRecord. Treat `CONTEXT.md` as
   non-authoritative vocabulary and architecture navigation. On conflict, report
   stale documentation, keep routing based on the authority projection, and do
   not automatically synchronize one representation into the other.
3. Extend `tests/imm-planner-kernel-intent-contract.test.ts` to pin both invariants
   across the source and packaged contracts. Reuse this focused test rather than
   adding another test file.

## Compatibility and Failure Behavior

- Keep the existing canonical wrappers and CLI grammar unchanged.
- Keep TaskIntent authoring, validation, Pi TUI Enrollment, and all authority
  boundaries unchanged.
- If the Skill location cannot be resolved, stop with a concrete runtime-path
  error; do not search broadly, fall back to an unrelated binary, or infer
  authority from `CONTEXT.md`.
- No migration or compatibility layer is introduced.

## Non-Goals

- No `imm_planner_action` Tool or other new runtime surface.
- No `Brainstorm Trace` scaffolding command.
- No automatic `CONTEXT.md` and `.imm` synchronization.
- No Kernel output-handling changes.
- No broad Skill/dist deduplication. Existing duplicated fail-closed authority,
  confirmation, exhaustive-decision, and retirement contracts remain intact.

## Acceptance Criteria

1. Source and packaged Planner contracts resolve the canonical `imm-plan` and
   `imm-kernel` wrappers relative to the declared Skill location and explicitly
   prohibit assuming they are available on `PATH`.
2. Source and packaged Planner contracts identify Assurance projection and
   TaskRecord as the authority for current workflow facts, keep `CONTEXT.md`
   non-authoritative, and require conflict reporting without automatic sync.
3. The focused Planner Kernel contract test fails if either source or packaged
   instructions lose either invariant.

## Devil's Advocate Audit

- **Rollback resilience**: The change is contract text plus focused assertions;
  one revert restores the prior behavior and no persisted workflow data changes.
- **Verification vanity**: Assertions must check both source and packaged files,
  the concrete relative wrapper paths, the no-`PATH` assumption, the authority
  sources, and the no-auto-sync behavior. Checking only generic command names
  would not catch the observed regression.
- **Spec dilution detection**: The scope retains both confirmed outcomes. It does
  not substitute package `bin` metadata for Skill-relative resolution and does
  not weaken the distinction between navigation prose and runtime authority.
