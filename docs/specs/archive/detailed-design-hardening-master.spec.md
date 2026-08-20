# Spec: Detailed Design Hardening Quality Gate

## Goal

Improve planning quality for large or risky Immune-Brain work without replacing the existing workflow in `IMMUNE.md`.

This spec defines a guidance-level Planning Quality Gate. It strengthens the current `Spec -> Plan -> Step -> QA` path by making design risks explicit before execution. It does not introduce a new global workflow, a new plan schema, or a mandatory two-layer spec system.

## Operating Model

The existing repository terms remain authoritative:

- A **Spec** defines the accepted behavior or contract for a change.
- A **Plan** decomposes the spec into independently closable **Steps**.
- `imm-planner` owns spec and plan creation.
- `imm-work` owns runtime coordination through `.imm/memory/current_iteration.json`.
- `HANDOFF.md` is a human-readable convenience artifact, not the runtime source of truth.

The Planning Quality Gate is applied by the planner when a task has elevated planning risk, such as:

- Cross-runtime or cross-host behavior.
- State ledger, migration, or resume behavior.
- Reviewer or subagent contract changes.
- Data compatibility or rollback requirements.
- Broad changes where the affected files cannot be verified by a single narrow check.

Small, low-risk tasks continue to use the normal single-spec and plan flow.

## Quality Gate Checks

For elevated-risk plans, the spec or plan must make the following checks explicit:

- **Contract surface**: name the files, skills, runtime modules, or docs whose behavior is part of the promised result.
- **Compatibility**: state whether existing plans, state files, host contracts, or users need migration behavior.
- **Interruption recovery**: describe the expected state if execution stops midway and how the next `imm-work` run should continue.
- **Rollback path**: state how to undo the change at the same level of granularity as the step being executed.
- **Verification strength**: prefer validator or contract-test evidence over simple existence checks.
- **Traceability**: ensure every `BR-*` item listed in `Brainstorm manifest` is represented in `Brainstorm Trace`.

## Non-Goals

- Do not require every large task to create `master.spec.md` and `phaseN.spec.md` files.
- Do not claim zero design drift or fixed rollback times without measured evidence.
- Do not introduce a TypeScript-style plan schema unless the Python plan validator is changed in the same work.
- Do not make `imm-preplan-review` mandatory for all large work; it remains an optional high-pressure gate under `IMMUNE.md`.

## Acceptance Criteria

- The repository can use this spec as a planning-quality reference without changing runtime behavior.
- Any future enforcement work must update the relevant parser, skill contract, or test surface in the same plan.
- Plans that cite this quality gate must still pass the existing `python3 .imm/imm-plan.py <plan> --json` validator.
