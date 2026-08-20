---
title: "fix: CLI help must not mutate State Ledger"
type: fix
status: proposed
date: 2026-07-10
origin: observed during closed risk-tiered Technical Design conformance workflow
---

# Iteration Plan

## Task

- Summary: Make `imm-review` and `imm-finish` help flags return usage without mutating the State Ledger
- Spec: docs/specs/archive/2026-07-10-cli-help-no-state-mutation.spec.md
- Origin: During U1 closure, `imm-review pass --help` recorded a QA pass and `imm-finish --help` reset the iteration. The completed U1 evidence remains immutable; user said continue after the defect was recorded as a separate follow-up candidate.
- Research: Plugin shell wrappers only delegate arguments to `plugins/immune-brain/runtime/immune_brain_runtime.ts`. `runWorkCommand` already handles `--help`/`-h` before state mutation for `record-execution`; `runReviewCommand(args, root)` and `runFinishCommand(root)` do not inspect help flags. `tests/plugin-package-runtime.test.ts` provides temporary roots, direct TypeScript CLI invocation, and existing help regression style.
- Decisions: D1 add command-local help short circuits, not a new CLI framework; D2 accept help both before and after an `imm-review` decision word; D3 compare isolated State Ledger bytes before/after help; D4 preserve normal review, gate-pass, and finish mutation behavior as controls; D5 do not repair or rewrite the prior closed U1 `last_review` metadata.
- Assumptions: Standard CLI convention treats a help flag as a successful query regardless of position; no persisted state needs migration because the correct behavior is absence of mutation.
- Scope Mode: New Slice
- Planner research dispatch: solo; single runtime module and one existing focused test file provide sufficient direct evidence.

## Output Language

- Human-readable prose: English for Spec and Plan documents; Chinese for user-facing replies
- Preserved literals: `--help`, `-h`, `imm-review`, `imm-finish`, `State Ledger`, `pass`, `rework`, `replan`, `gate-pass`, and file paths

## Devil's Advocate Audit

1. **Rollback Resilience**: Revert one runtime help guard, focused tests, this Spec, and this Plan. No schema or migration exists.
2. **Verification Vanity**: Usage text alone is insufficient. Tests snapshot the State Ledger before and after long/short help flags, then prove normal `pass`, `gate-pass`, and `imm-finish` still mutate as intended.
3. **Spec Dilution Detection**: This slice fixes only accidental mutation caused by help flags. It does not retroactively alter the closed U1 review evidence, broaden into all command parsing, or add a general CLI abstraction.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `tests/plugin-package-runtime.test.ts`, this Spec, and this Plan.
- compatibility: normal action syntax and wrapper delegation remain unchanged; help becomes safe query behavior.
- interruption recovery: a help request makes no write, so a stopped invocation leaves the current iteration unchanged.
- rollback path: revert runtime guard and focused tests; no State Ledger migration or cleanup.
- verification strength: isolated-root byte comparisons plus normal-action controls, Plan validation, and `git diff --check`.

## Steps

### Step 1

- Step ID: U1
- Result: CLI help queries leave the State Ledger unchanged
- Verification type: automated
- Verification: `bun test tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-002-fix-cli-help-no-state-mutation-plan.md --json && git diff --check`
- Test scenarios: Covers `imm-review --help` and `imm-review -h` without a State Ledger; Covers `imm-review pass --help` and `imm-review pass -h` with an active State Ledger; Covers `imm-finish --help` and `imm-finish -h` with a non-idle State Ledger; Covers each help output usage and zero exit; Covers normal review pass, review gate-pass, and finish reset behavior unchanged
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (review and finish handlers plus dispatch); tests/plugin-package-runtime.test.ts (isolated root and CLI fixture); docs/specs/archive/2026-07-10-cli-help-no-state-mutation.spec.md (accepted boundary)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If safely handling help requires a command-wide parser rewrite or changes normal action semantics, stop and return to Planner rather than widening this fix.
- security_considerations: A help query must not grant or trigger workflow state authority; preserving State Ledger bytes prevents accidental closure/reset from inspection tooling.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-002-fix-cli-help-no-state-mutation-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-002-fix-cli-help-no-state-mutation-plan.md --sync`

## Notes

- This is one closable outcome. Splitting tests, guards, and controls would produce an intermediate state where help behavior is either still unsafe or no longer verified.
