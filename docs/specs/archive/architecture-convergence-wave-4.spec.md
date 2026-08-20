---
title: Architecture Convergence Wave 4
type: refactor
status: planned
date: 2026-06-01
---

# Spec: Architecture Convergence Wave 4

## Objective

Close the five architecture opportunities selected from the latest
`imm-arch-explorer` run without reopening rejected platform work. The slice
should reduce repeated dispatch-helper contract logic, strengthen plugin
runtime parity, make planning-artifact status drift visible, harden Skill
registry loading, and continue the package-first `imm_core` migration.

## Background

The architecture exploration identified five current seams:

- Dispatch helpers repeat the same activation modes, advisory boundary wording,
  tool policy, status normalization, and fallback reason vocabulary across
  several host-bound modules.
- The plugin runtime under `plugins/immune-brain/dist/.imm/` is the public
  execution surface, but parity checks only cover a subset of runtime files.
- `docs/specs/` and `docs/plans/` contain many stale `planned`, `proposed`, and
  `active` status markers even when runtime evidence shows a slice has moved.
- `skills/registry.yaml` is machine-readable source of truth, but the runtime
  loader still parses it with ad hoc line splitting.
- `.imm/pyproject.toml` exists, but CLI scripts and tests still rely on
  `sys.path.insert` or dynamic module loading in places where normal package
  imports should be the default.

Existing decisions constrain the solution:

- `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects a
  shared registry or generic dispatcher until stronger multi-host evidence
  exists.
- `docs/solutions/subagent-execution-truth-protocol.md` requires deterministic
  host-bound helpers rather than hand-authored dispatch prompts.
- `docs/reference/planning-quality-gate.md` applies because this slice touches
  runtime helpers, packaged plugin output, contracts, and compatibility.

## Requirements

### R1. Dispatch helper vocabulary is centralized narrowly

- Introduce a small runtime contract module for shared constants and pure
  normalization helpers used by host-bound dispatch helpers.
- Preserve each host helper's ownership of envelope construction and outcome
  synthesis.
- Do not add a shared subagent registry, scheduler, cross-host dispatcher, or
  default fan-out gate.

### R2. Skill registry loading is structured

- Replace the current ad hoc `registry.yaml` line splitting in
  `SkillRuntime` with structured loading.
- Preserve the current registry schema and role validation behavior.
- Add focused tests for valid entries, missing required fields, and malformed
  registry shape.

### R3. Planning artifact status drift is detectable

- Add a deterministic check that reports stale or inconsistent plan/spec status
  markers using repo-local evidence only.
- The check must produce actionable output without rewriting historical plans
  automatically.
- Avoid treating `docs/plans/`, `docs/specs/`, `.imm/memory/`, or long
  conversation history as a new authority layer.

### R4. `imm_core` imports become package first

- Reduce runtime and test reliance on `sys.path.insert` and
  `importlib.util.spec_from_file_location` where stable package imports are
  available.
- Keep CLI wrapper compatibility and plugin-copy execution intact.
- Leave dynamic loading only where a file-name wrapper or plugin isolation
  boundary genuinely requires it.

### R5. Packaged runtime parity covers the selected repairs

- Mirror touched runtime files into `plugins/immune-brain/dist/.imm/`.
- Expand parity tests so every runtime file touched by this slice is either
  checked for exact parity or explicitly documented as generated/host-specific.
- Keep public release behavior centered on the self-contained plugin package.

## Non-Goals

- No shared registry, generic dispatcher, background scheduler, or LLM router.
- No automatic rewrite of historical plan/spec status.
- No replacement of `registry.yaml` with a database or new state file.
- No PyPI publishing or external package distribution for `imm_core`.
- No implementation edits outside the selected architecture surfaces.

## Acceptance Criteria

- Dispatch helper tests prove shared vocabulary reuse without changing
  host-bound envelope ownership.
- `SkillRuntime` registry tests still pass and cover malformed registry input.
- A status-drift command or module reports stale artifacts deterministically and
  is covered by focused tests.
- Package-first import changes pass focused runtime tests without requiring
  external installation beyond repo-local execution.
- `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts`
  passes after plugin runtime parity is updated.
