# Spec: CLI Help Must Not Mutate State

**Task ID**: IMM-RUNTIME-CLI-HELP-001  
**Owner**: Planner  
**Status**: Proposed

## 1. Goal

Make `--help` and `-h` safe for the state-mutating `imm-review` and `imm-finish`
CLI commands. Help must print command-specific usage, exit successfully, and leave
the State Ledger byte-identical.

## 2. Background

The plugin wrappers pass arguments directly to the shared TypeScript CLI runtime.
`imm-work record-execution` already short-circuits help before reading or writing
state. `runReviewCommand` and `runFinishCommand` do not. As a result,
`imm-review pass --help` records a pass and `imm-finish --help` resets the active
iteration instead of showing usage.

## 3. Requirements

### R1. Help is a zero-mutation query

- `imm-review --help`, `imm-review -h`, `imm-review <decision> --help`, and
  `imm-review <decision> -h` print `imm-review` usage and return zero.
- `imm-finish --help` and `imm-finish -h` print `imm-finish` usage and return
  zero.
- These invocations must not create, rewrite, reset, or append to a State Ledger.

### R2. Normal actions remain unchanged

- `imm-review pass|rework|replan` retains its existing decision behavior.
- `imm-review gate-pass` retains its review-gate recording behavior.
- `imm-finish` without a help flag retains its intentional-reset behavior.

### R3. Regression proof uses isolated State Ledger fixtures

- Focused Bun tests call the shared runtime in temporary roots and compare the
  State Ledger before and after each help invocation.
- Tests cover both long and short help flags and the normal mutation control
  paths, so a false positive cannot merely hide all command behavior.

## 4. Non-goals

- No changes to prior closed Plan evidence or historical `last_review` records.
- No State Ledger schema change, wrapper rewrite, command manifest expansion, or
  general CLI framework.
- No new help behavior for unrelated commands unless directly required by the
  shared fix.

## 5. Verification

```bash
bun test tests/plugin-package-runtime.test.ts
plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-002-fix-cli-help-no-state-mutation-plan.md --json
git diff --check
```
