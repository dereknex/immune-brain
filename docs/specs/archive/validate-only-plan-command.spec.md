# Functional Spec: Validate-Only Plan Command

## Background

`imm-code-review` found that using `imm-plan --json` as a validation command
still mutates `.imm/memory/current_iteration.json`. During review, validating
the older adversarial mechanisms plan switched the active State Ledger away
from the completed metadata-preservation repair plan and cleared completed
steps.

## Goal

Plan validation must be safe to run against historical or candidate plans
without changing runtime workflow state. Runtime State Ledger synchronization
must become an explicit action.

## Requirements

1. `imm-plan <plan> --json` validates and prints normalized JSON without
   changing `.imm/memory/current_iteration.json`.
2. Runtime synchronization remains available through an explicit sync flag.
3. Workflow entry points that intentionally prepare a plan for execution use
   the explicit sync path.
4. Regression tests prove validating a historical plan does not switch the
   current runtime plan or clear completed steps.

## Non-Goals

- Do not restore lost State Ledger state by hand-editing
  `.imm/memory/current_iteration.json`.
- Do not remove runtime sync support from `imm-plan`.
- Do not broaden this slice into unrelated State Ledger recovery tooling.

## Verification

- Unit tests cover non-mutating JSON validation and explicit sync behavior.
- Existing `imm-work` activation tests continue to prove unsynced plans cannot
  be activated accidentally.
- The plan validator can be run on historical plans without changing
  `imm-work status`.
