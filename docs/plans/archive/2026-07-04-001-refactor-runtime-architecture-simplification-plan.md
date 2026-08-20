---
title: "refactor: runtime architecture simplification wave"
type: refactor
status: planned
date: 2026-07-04
origin:
  - imm-arch-explorer opportunity selection
  - docs/specs/archive/2026-07-04-runtime-architecture-simplification.spec.md
---

# Iteration Plan

## Task

- Summary: Plan one executable maintenance slice for simplifying the State Ledger helper shape, OpenCode command invocation contract, and Roadmap criteria validator feedback.
- Spec: `docs/specs/archive/2026-07-04-runtime-architecture-simplification.spec.md`
- Origin: The user selected all three `imm-arch-explorer` opportunities: simplify stateless `LedgerStateMachine`, reduce OpenCode CLI pass-through drift, and strengthen `acceptance_criteria` / `promotion_criteria` validation.
- Scope Mode: New executable slice. The currently synced CLI-only runtime Plan is already closed, so this Plan is not an append.
- Planner research dispatch: three readonly research subagents were dispatched because the request spans State Ledger runtime, OpenCode plugin integration, and Plan/Roadmap validation. Their evidence is summarized below.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, commands, schema fields, enum values, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Step`, `Plan`, `Spec`, `State Ledger`, `Roadmap`, `acceptance_criteria`, and `promotion_criteria`.

## Research

- `CONTEXT.md` defines `State Ledger`, `Plan`, `Step`, `Roadmap`, `Phase`, `acceptance_criteria`, and `promotion_criteria`. `acceptance_criteria` is required for Roadmaps with three or more phases and optional for one or two phases; `promotion_criteria` remains a separate concept.
- State Ledger research found `plugins/immune-brain/runtime/imm_core.ts` exports `LedgerStateMachine` as a stateless helper. Runtime callers mostly instantiate it locally, tests import it directly, and current methods mutate the passed State Ledger object in place.
- State Ledger constraints: preserve schema v2, state enum values, legal transitions, existing error text where asserted, and the exported class shape unless compatibility is intentionally broken.
- OpenCode runtime research found `.opencode-plugin/runtime.ts` centralizes tool calls through `callImmTool()`, builds CLI argv, shell-escapes it, and invokes `bun <runtime> cli ...`. Duplicate command mapping exists across OpenCode `buildToolCommand`, `plugins/immune-brain/bin/imm-*`, and runtime command metadata.
- OpenCode constraints: target repos may not vendor `plugins/immune-brain`; resolver behavior for loaded plugin roots, cache roots, and `IMMUNE_BRAIN_PLUGIN_ROOT` must keep working. `imm-pr-diag` is a standalone shell exception.
- Criteria validation research found current `validatePlan` validates parsed Plan steps and Brainstorm Trace only. It has no Roadmap phase parser and `imm-plan --json` currently has no warning channel.
- Criteria validation constraints: current roadmap-human-acceptance-gating work was Phase 1 document convention only; new validation should start focused, preserve smaller Plan compatibility, and not collapse `promotion_criteria` into acceptance completion.
- `docs/reference/planning-quality-gate.md` applies because this slice touches State Ledger runtime behavior, cross-host plugin behavior, and Plan validation output contracts.

## Decisions

- D1: Treat the State Ledger simplification as compatibility-first. Add function-first helpers, but keep `LedgerStateMachine` as a wrapper unless tests and users prove the export is disposable.
- D2: Do not remove plugin-local shell wrappers. They remain the stable user-facing CLI surface.
- D3: Scope the OpenCode seam to one tested invocation contract and drift prevention first. Direct in-process execution is allowed only if characterization tests prove target root and installed-plugin layouts keep working.
- D4: Keep `imm-pr-diag` outside the shared runtime command map in this slice.
- D5: Add Roadmap criteria feedback as warnings rather than a new hard gate for every Plan.
- D6: Keep `promotion_criteria` independent from `acceptance_criteria`; the validator may check presence or shape but must not infer promotion readiness.

## Assumptions

- Bun remains available because current plugin-local wrappers already require Bun.
- Existing external callers may import `LedgerStateMachine`, so compatibility is safer than deleting the class.
- Current Roadmap validation can start with text-level criteria checks before introducing a full Roadmap schema model.
- Historical docs may mention older behavior when clearly archival; active runtime contracts should match the new behavior.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: touching `imm_core.ts`, `immune_brain_runtime.ts`, and OpenCode plugin code in one slice can leave mixed runtime behavior if execution stops midway.
- Mitigation: each Step is independently revertible by file group. U1 can revert State Ledger helper changes and tests without touching OpenCode or validator output. U2 can revert plugin adapter changes and tests without changing State Ledger schema. U3 can revert warning output and roadmap criteria tests without changing persisted `.imm/memory/` state.

### 2. Verification Vanity

- Risk: tests that only prove files exist or command output parses would not catch real regressions in State Ledger mutation semantics, OpenCode root resolution, or criteria warning behavior.
- Mitigation: every Step uses executable tests that exercise the behavior surface: State Ledger transition tests, OpenCode runtime resolver and argv tests, wrapper smoke commands, Plan validation tests, and `imm-plan --json` contract checks.

### 3. Spec Dilution Detection

- Risk: opportunity 2 could be silently narrowed to documentation cleanup instead of reducing pass-through drift; opportunity 3 could become generic docs linting instead of domain validation.
- Mitigation: U2 must leave a tested command invocation contract in code, not only prose. U3 must add structured validator feedback tied to `acceptance_criteria` and `promotion_criteria` semantics, not only update `CONTEXT.md`.

## Planning Quality Gate

- **contract surface**: `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/.opencode-plugin/runtime.ts`, `plugins/immune-brain/.opencode-plugin/index.ts`, `plugins/immune-brain/bin/imm-*`, `tests/runtime-state.test.ts`, `tests/imm-autowork-continuation-runtime.test.ts`, `plugins/immune-brain/tests/opencode-runtime.test.ts`, `tests/plan-validation.test.ts`, and `tests/plugin-package-runtime.test.ts`.
- **compatibility**: Existing State Ledger files remain schema-compatible. CLI wrappers remain supported. `LedgerStateMachine` remains exported unless an intentional breaking change is separately planned.
- **interruption recovery**: If execution stops after one Step, the next `imm-work` run should resume from the active Step and use its focused tests. No Step requires partial State Ledger migration.
- **rollback path**: Revert the Step's touched runtime files and focused tests. If U3 adds a JSON warning channel, revert the runtime output change and tests together.
- **verification strength**: Prefer targeted Bun tests and `imm-plan --json` over text search. Wrapper smoke tests prove command paths still reach the runtime.
- **Brainstorm traceability**: No formal `Brainstorm manifest` was supplied. User-confirmed scope is mapped through Origin, Decisions, Spec requirements, and Step Results.

## Steps

### Step 1

- Step ID: U1
- Result: State Ledger transitions use a function-first compatibility API.
- Verification type: automated
- Verification: `bun test tests/runtime-state.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-001-refactor-runtime-architecture-simplification-plan.md --json`
- Execution note: characterization-first
- Test scenarios: Existing `LedgerStateMachine` imports still work; function-first helpers preserve in-place State Ledger mutation; illegal transition errors remain stable; active and completed Step lookup behavior remains unchanged through runtime commands.
- Discovery cache: plugins/immune-brain/runtime/imm_core.ts (State Ledger transition helpers); plugins/immune-brain/runtime/immune_brain_runtime.ts (runtime callers); tests/runtime-state.test.ts (direct transition coverage); tests/imm-autowork-continuation-runtime.test.ts (lifecycle coverage); tests/plugin-package-runtime.test.ts (CLI parity coverage)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If compatibility requires keeping the class indefinitely, keep the wrapper and record the function-first API as the maintained seam.

### Step 2

- Step ID: U2
- Result: OpenCode runtime calls share one command invocation contract.
- Verification type: automated
- Verification: `bun test plugins/immune-brain/tests/opencode-runtime.test.ts tests/plugin-package-runtime.test.ts tests/activation-plan-runtime-surface.test.ts && plugins/immune-brain/bin/imm-work status --json && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-001-refactor-runtime-architecture-simplification-plan.md --json`
- Execution note: characterization-first
- Test scenarios: `buildArgv()` or its replacement maps supported OpenCode tools deterministically; `IMMUNE_BRAIN_PLUGIN_ROOT` resolves a runtime outside the target repo; one plugin-local wrapper smoke path reaches the TypeScript runtime; `imm-pr-diag` remains explicitly excluded or separately documented.
- Discovery cache: plugins/immune-brain/.opencode-plugin/runtime.ts (OpenCode adapter); plugins/immune-brain/.opencode-plugin/index.ts (tool schema surface); plugins/immune-brain/bin/imm-work (wrapper smoke path); plugins/immune-brain/runtime/immune_brain_runtime.ts (command manifest and dispatch); plugins/immune-brain/tests/opencode-runtime.test.ts (resolver coverage); tests/activation-plan-runtime-surface.test.ts (wrapper coverage)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If direct in-process execution breaks installed-plugin or cache-root behavior, stop at the shared tested argv contract and record direct import as deferred rather than adding a fragile fallback stack.

### Step 3

- Step ID: U3
- Result: Roadmap criteria validation emits structured warnings.
- Verification type: automated
- Verification: `bun test tests/plan-validation.test.ts tests/plugin-package-runtime.test.ts tests/host-runtime-cutover.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-001-refactor-runtime-architecture-simplification-plan.md --json`
- Execution note: test-first
- Test scenarios: Three-plus phase Roadmaps warn on missing or empty `acceptance_criteria`; one-phase and two-phase Plans remain valid without criteria; recognizable non-behavioral acceptance entries produce warnings rather than fatal errors; `promotion_criteria` is reported or preserved independently from acceptance completion; `imm-plan --json` stays backwards-compatible while exposing warnings.
- Discovery cache: CONTEXT.md (canonical criteria semantics); docs/specs/archive/roadmap-human-acceptance-gating.spec.md (existing Roadmap requirements); docs/plans/2026-06-27-001-feat-roadmap-human-acceptance-gating-phase1-plan.md (Phase 1 boundary); plugins/immune-brain/runtime/imm_core.ts (validatePlan); plugins/immune-brain/runtime/immune_brain_runtime.ts (imm-plan JSON output); tests/plan-validation.test.ts (validator coverage); tests/host-runtime-cutover.test.ts (runtime output contract)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If Roadmap parsing is too ambiguous for reliable warnings, keep validation limited to explicit Roadmap headings and document unsupported formats before widening the parser.

## Test Scenarios

- State Ledger transition helpers keep current mutation semantics and compatibility imports.
- Runtime status, work activation, record-execution, review, and autowork paths still operate after helper simplification.
- OpenCode adapter command mapping is covered without relying on manual shell-string inspection.
- Plugin-local wrappers still work from the repository root and from an external target repo where applicable.
- Roadmap criteria warnings appear in JSON without breaking existing consumers that only read `errors` or `summary`.
- `promotion_criteria` remains a separate Roadmap concept and is not treated as proof that acceptance criteria passed.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-001-refactor-runtime-architecture-simplification-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-001-refactor-runtime-architecture-simplification-plan.md --sync`

## Next Action

- Validate this Plan with `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-001-refactor-runtime-architecture-simplification-plan.md --json`.
- If validation passes and the user confirms execution, sync the Plan and enter `imm-work` to activate Step `U1`.
