# Spec: Planning Quality Gate Phase 1

## Goal

Land the first version of the detailed-design hardening guidance as a repository-compatible planning quality gate.

Phase 1 keeps the change documentation-only. It establishes the accepted wording and validation expectations for future high-risk planning work, while preserving the current Immune-Brain workflow and plan parser.

## Scope

In scope:

- Replace the previous mandatory Master-Phase language with guidance aligned to `IMMUNE.md`.
- Define the checks that planners should apply when work has elevated design risk.
- Keep all plan syntax compatible with the existing `imm-plan.py` validator.
- Make validation prove that the plan itself is parseable, not just that files exist.

Out of scope:

- No runtime parser changes.
- No compiled skill contract changes.
- No new mandatory global workflow.
- No automatic enforcement beyond the existing plan validator.

## Existing Plan Format Contract

Phase 1 uses the plan structure already understood by `.imm/imm_core/plan_runtime.py`:

- `## Task` with `Summary`, `Origin`, `Spec`, and optional `Brainstorm manifest`.
- `## Brainstorm Trace` table with `Item`, `Status`, `Target`, and `Reason`.
- `### Step N` sections with `Step ID`, `Result`, `Verification`, `Test scenarios`, `Discovery cache`, and `Depends on`.
- `Discovery cache` entries must use `path (reason)` format and multiple entries must be separated with semicolons.

Any future stronger schema must be implemented in the validator and covered by tests before being described as enforced.

## Phase 1 Readiness Checks

The plan is ready for execution only when:

- The Master spec states the quality gate as guidance rather than a new constitution.
- This Phase 1 spec names the existing parser-compatible fields instead of inventing a new schema.
- The plan verification includes `python3 .imm/imm-plan.py docs/plans/2026-05-26-009-establish-design-hardening-framework-plan.md --json`.
- Existence checks are paired with content checks for the specific risks corrected by this phase.

## Verification Gate

Use the existing plan validator plus focused content assertions:

```bash
python3 .imm/imm-plan.py docs/plans/2026-05-26-009-establish-design-hardening-framework-plan.md --json
```

The validator must pass before this phase can be considered ready for `imm-work`.
