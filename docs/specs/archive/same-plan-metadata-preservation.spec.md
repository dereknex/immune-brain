# Functional Spec: Same-Plan Metadata Preservation

## Background

`imm-code-review` found that adding planner-owned metadata to an already
completed plan changed the plan signature and caused `imm-work status` to reset
closed steps back to `pending`. The affected case was the adversarial mechanisms
plan: adding `Devil's Advocate Audit` did not change any executable step, but
the State Ledger lost U1/U2/U3 closure.

## Goal

When a same-path plan is revalidated and only non-executable metadata changes,
the runtime must preserve closed State Ledger steps instead of asking
`imm-work` to activate already completed work again.

## Requirements

1. Same-plan signature changes that leave the completed step prefix unchanged
   must preserve closed steps.
2. Metadata-only additions such as top-level audit fields must be treated as
   preservation-safe when step proof fields still match the validated snapshot.
3. True step mutations must continue to reset closure state.
4. Tests must cover the regression path so a future metadata addition cannot
   silently re-open completed work.

## Non-Goals

- Do not hand-edit `.imm/memory/current_iteration.json` as the primary fix.
- Do not relax closure preservation when completed step proof fields change.
- Do not rewrite historical plan files solely to avoid the runtime behavior.

## Verification

- Unit tests prove metadata-only same-plan changes preserve closed steps.
- Existing reset tests continue to prove real step mutations clear closure.
- `imm-work status --json` should no longer recommend activating old completed
  steps after a metadata-only plan amendment.
