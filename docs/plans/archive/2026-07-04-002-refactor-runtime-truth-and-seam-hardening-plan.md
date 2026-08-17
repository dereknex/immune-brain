---
title: "refactor: runtime truth and seam hardening"
type: refactor
status: planned
date: 2026-07-04
origin:
  - imm-arch-explorer candidate selection A,B,C,D
  - docs/specs/2026-07-04-runtime-truth-and-seam-hardening.spec.md
---

# Iteration Plan

## Task

- Summary: Plan one executable maintenance slice for aligning active runtime truth, guarding against retired runtime-current references, splitting the largest runtime core seams, and hardening OpenCode command drift checks.
- Spec: `docs/specs/2026-07-04-runtime-truth-and-seam-hardening.spec.md`
- Origin: The user selected all four architecture candidates: runtime truth cleanup, active docs stale-reference guard, `imm_core.ts` seam split, and OpenCode/CLI manifest de-duplication.
- Scope Mode: New executable slice. The existing `docs/plans/2026-07-04-001-refactor-runtime-architecture-simplification-plan.md` is closed in the State Ledger and only overlaps part of this scope, so this Plan is not an append.
- Planner research dispatch: no new research subagents were launched. Prior architecture Domain Mapper probes returned no output, and local read-only evidence was sufficient to decompose steps with concrete verification paths.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, commands, schema fields, enum values, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Step`, `Plan`, `Spec`, `State Ledger`, `Activation Plan`, and `Domain Mapper`.

## Research

- `README.md` identifies the current host-facing runtime as plugin-local Bun + TypeScript through `plugins/immune-brain/runtime/immune_brain_runtime.ts` and `plugins/immune-brain/bin/imm-*` wrappers, with no Python `.imm` runtime fallback.
- `docs/solutions/python-reference-retirement-exception-inventory.md` records `.imm/imm_core/`, packaged Python runtime files, and Python test surfaces as retired.
- `CONTEXT.md` still describes `.imm/imm_core/`, `.imm/imm-plan.py`, and `tests/test_skill_contracts.py` as active architecture surfaces, which conflicts with the current Bun test and TypeScript runtime surface.
- `plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md` still names `dist/.imm/imm_core/activation_plan.py` as the packaged activation planner even though packaged Python runtime files were retired.
- `scripts/detect-stale-refs.ts` only checks skill references, docs/specs|docs/plans links, and legacy `.imm/specs` links. It does not protect active docs from retired runtime-current references such as `.imm/imm_core`, `immune_brain_runtime.py`, `.mcp.json`, or `list-tools`.
- A full `bun scripts/detect-stale-refs.ts docs` run reports many historical findings, mostly in `docs/plans/`. This Plan intentionally protects active docs first instead of rewriting all historical Plans.
- `plugins/immune-brain/runtime/imm_core.ts` combines Plan parsing and validation, State Ledger transitions, review gates, heal helpers, wrapper retirement, and activation mode helpers. `plugins/immune-brain/runtime/immune_brain_runtime.ts` imports many unrelated symbols from this one module.
- `plugins/immune-brain/.opencode-plugin/runtime.ts` maps OpenCode tool names to CLI arguments separately from the runtime command manifest in `immune_brain_runtime.ts`. Some host-specific mapping is legitimate, but supported command drift needs a focused test or shared contract.
- `docs/adr/0001-dedicated-architecture-explorer-skill.md` constrains this work to planner-owned scope selection and step decomposition before execution.
- `docs/reference/planning-quality-gate.md` applies because this slice touches runtime contracts, cross-host plugin behavior, packaged docs, and compatibility boundaries.

## Decisions

- D1: Use a new Plan rather than append to the closed runtime architecture simplification Plan.
- D2: Fix active runtime truth before changing runtime code so executor and reviewer guidance points at the current architecture.
- D3: Add a focused active-doc guard instead of trying to clear all historical `docs/plans/` stale references in this slice.
- D4: Split `imm_core.ts` only at real maintenance seams. Preserve `imm_core.ts` as a compatibility barrel unless a later breaking-change Plan retires the export path.
- D5: Keep OpenCode's host-specific tool argument mapping, but verify it against the CLI command contract so drift is caught.
- D6: Keep `imm-pr-diag` outside the shared runtime command map in this slice.

## Assumptions

- Bun remains available because current plugin-local wrappers already require Bun.
- Historical docs may retain old references when clearly archival; active docs and packaged runtime docs should not present retired runtime paths as current truth.
- External tests or users may import from `plugins/immune-brain/runtime/imm_core.ts`, so compatibility is safer than direct removal.
- OpenCode tool names do not need to exactly match CLI command names as long as the supported command mapping is tested.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: executing docs truth, guard tooling, runtime module extraction, and OpenCode contract hardening in one Plan can leave mixed behavior if a Step stops midway.
- Mitigation: Steps are sequenced by rollback boundary. U1 only changes active docs and packaged docs. U2 only adds the guard and tests for the guard. U3 can revert runtime module extraction and tests while leaving docs truth intact. U4 can revert OpenCode drift hardening and tests without touching State Ledger schema or Plan parsing behavior.

### 2. Verification Vanity

- Risk: verification could devolve into checking that text exists or that files compile while stale current-tense references and command drift remain possible.
- Mitigation: U1 uses negative runtime-reference greps plus packaged sync checks. U2 adds a reusable guard that must fail on the retired-runtime patterns. U3 runs behavior tests for Plan and State Ledger runtime surfaces, not just import tests. U4 exercises OpenCode mapping, runtime command discovery, wrapper smoke, and activation-plan surface coverage.

### 3. Spec Dilution Detection

- Risk: selecting A,B,C,D could be silently narrowed back to only documentation cleanup or only the previously closed runtime simplification scope.
- Mitigation: Each selected candidate maps to one Step Result: U1 covers runtime truth, U2 covers the stale-reference guard, U3 covers `imm_core.ts` seam split, and U4 covers OpenCode/CLI command drift. Deferred historical cleanup is explicitly out of scope, not silently dropped.

## Planning Quality Gate

- **contract surface**: `CONTEXT.md`, `README.md`, `docs/specs/`, `docs/solutions/architecture.md`, `plugins/immune-brain/dist/docs/`, `scripts/detect-stale-refs.ts` or a focused sibling script, `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/.opencode-plugin/runtime.ts`, `plugins/immune-brain/.opencode-plugin/index.ts`, `plugins/immune-brain/bin/imm-*`, and related Bun tests.
- **compatibility**: `imm_core.ts` remains import-compatible; State Ledger schema v2 and runtime JSON output remain backward-compatible; plugin-local wrappers remain supported.
- **interruption recovery**: If a Step fails, revert that Step's touched files and rerun its focused verification. No Step requires data migration or partial State Ledger writes.
- **rollback path**: Use git checkout/revert on the Step file group. For U3, revert extracted runtime modules and restore `imm_core.ts` while keeping behavior tests as characterization evidence if useful.
- **verification strength**: Prefer focused Bun tests, sync checks, negative grep/guard checks, and `imm-plan --json` over prose-only assertions.
- **Brainstorm traceability**: No formal `Brainstorm manifest` was supplied. User-confirmed scope is mapped through Origin, Decisions, Spec requirements, and Step Results.

## Steps

### Step 1

- Step ID: U1
- Result: Active runtime docs describe the Bun TypeScript CLI truth.
- Verification type: automated
- Verification: `bash -lc 'if rg -n "dist/\.imm/imm_core|\.imm/imm_core|\.imm/imm-plan\.py|immune_brain_runtime\.py|\.mcp\.json|list-tools" CONTEXT.md plugins/immune-brain/dist/docs README.md; then exit 1; fi; rg -n "Historical note|Superseded current-truth pattern|source-only reference" docs/solutions/architecture.md' && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-002-refactor-runtime-truth-and-seam-hardening-plan.md --json`
- Test scenarios: `CONTEXT.md` names the current TypeScript runtime and State Ledger boundary; packaged activation docs no longer point at packaged Python modules; architecture learnings that mention retired MCP/Python paths are marked historical or source-only instead of current truth.
- Discovery cache: CONTEXT.md (Architecture Map); README.md (current runtime truth); docs/solutions/python-reference-retirement-exception-inventory.md (retirement truth); plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md (packaged stale runtime doc); docs/solutions/architecture.md (historical architecture learnings); scripts/sync-dist-docs.ts (packaged mirror check)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If historical docs need to retain old paths, mark them explicitly historical and narrow the negative grep to active/current sections rather than deleting context.

### Step 2

- Step ID: U2
- Result: Active docs reject retired runtime-current references.
- Verification type: automated
- Verification: `bun test tests/active-runtime-docs-contract.test.ts tests/dist-docs-sync-contract.test.ts tests/baseline-packaging-contract.test.ts && bun scripts/detect-stale-refs.ts --runtime-truth CONTEXT.md README.md plugins/immune-brain/dist/docs && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-002-refactor-runtime-truth-and-seam-hardening-plan.md --json`
- Execution note: characterization-first
- Test scenarios: The focused guard fails on current-tense `.imm/imm_core`, `immune_brain_runtime.py`, `.mcp.json`, and `list-tools` runtime references in active docs; the guard reports file and line evidence; historical `docs/plans/` references are not required to be cleaned in this Step.
- Discovery cache: scripts/detect-stale-refs.ts (existing stale reference checker); tests/dist-docs-sync-contract.test.ts (packaged docs contract); tests/baseline-packaging-contract.test.ts (baseline packaging contract); docs/reference (active references); docs/specs (active specs); plugins/immune-brain/dist/docs (packaged docs)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If extending `detect-stale-refs.ts` makes historical docs too noisy, add an active-doc mode or a small sibling script instead of widening the default all-docs check.

### Step 3

- Step ID: U3
- Result: `imm_core.ts` becomes a compatibility barrel over runtime seams.
- Verification type: automated
- Verification: `bun test tests/plan-validation.test.ts tests/runtime-state.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-work status --json && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-002-refactor-runtime-truth-and-seam-hardening-plan.md --json`
- Execution note: characterization-first
- Test scenarios: Existing imports from `imm_core.ts` still work; extracted Plan helpers preserve parsing, normalization, signatures, validation, and Roadmap-related warnings; extracted State Ledger helpers preserve transition states, mutation semantics, review pass records, active/completed Step lookup, and runtime command behavior.
- Discovery cache: plugins/immune-brain/runtime/imm_core.ts (current core exports); plugins/immune-brain/runtime/immune_brain_runtime.ts (runtime imports); tests/plan-validation.test.ts (Plan parser and validator coverage); tests/runtime-state.test.ts (State Ledger coverage); tests/imm-loop-review-orchestration-contract.test.ts (review gate coverage); tests/plugin-package-runtime.test.ts (runtime command behavior)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If extracting both seams causes excessive churn, extract only the State Ledger seam first and leave Plan helpers behind `imm_core.ts` with a recorded follow-up.

### Step 4

- Step ID: U4
- Result: OpenCode command mapping is checked against the CLI command contract.
- Verification type: automated
- Verification: `bun test plugins/immune-brain/tests/opencode-runtime.test.ts tests/opencode-cli-adapter.test.ts tests/activation-plan-runtime-surface.test.ts tests/host-runtime-cutover.test.ts && plugins/immune-brain/bin/imm-work status --json && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-002-refactor-runtime-truth-and-seam-hardening-plan.md --json`
- Execution note: characterization-first
- Test scenarios: Runtime `list-commands --json` exposes the supported CLI commands; OpenCode tool mappings cover the supported command subset without MCP protocol names; `IMMUNE_BRAIN_PLUGIN_ROOT` still resolves an installed plugin runtime; at least one plugin-local wrapper smoke path reaches the TypeScript runtime; `imm-pr-diag` remains explicitly excluded.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (command manifest and dispatch); plugins/immune-brain/.opencode-plugin/runtime.ts (OpenCode command mapping); plugins/immune-brain/.opencode-plugin/index.ts (OpenCode tool surface); plugins/immune-brain/bin/imm-work (wrapper smoke path); plugins/immune-brain/tests/opencode-runtime.test.ts (resolver and mapping coverage); tests/opencode-cli-adapter.test.ts (adapter coverage); tests/activation-plan-runtime-surface.test.ts (activation command coverage); tests/host-runtime-cutover.test.ts (CLI-only contract)
- Agent Hint: imm-executor
- Depends on: 3
- failure_behavior: If sharing the runtime manifest would over-couple OpenCode to runtime internals, keep the adapter mapping and add a drift test instead of adding a generic command-schema layer.

## Test Scenarios

- Active architecture docs and packaged runtime docs present one current runtime truth: Bun + TypeScript CLI through the plugin-local runtime and wrappers.
- The stale-reference guard catches retired runtime-current references without forcing historical plan cleanup.
- Plan and State Ledger behavior remain stable after `imm_core.ts` becomes a compatibility barrel over smaller seams.
- OpenCode command mapping remains host-specific but cannot silently drift from the supported CLI command contract.
- Plugin-local wrappers continue to work from the repository root and target-repo contexts covered by existing tests.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-002-refactor-runtime-truth-and-seam-hardening-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-002-refactor-runtime-truth-and-seam-hardening-plan.md --sync`

## Next Action

- Validate this Plan with `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-002-refactor-runtime-truth-and-seam-hardening-plan.md --json`.
- If validation passes and the user confirms execution, sync the Plan and enter `imm-work` to activate Step `U1`.
