---
title: "feat: adaptive cache-first agent workflow"
type: feat
status: planned
date: 2026-07-05
origin:
  - user selected agent workflow efficiency as the target improvement area
  - docs/specs/archive/2026-07-05-adaptive-cache-first-agent-workflow.spec.md
---

# Iteration Plan

## Task

- Summary: Plan one executable slice that turns the adaptive cache-first workflow into a shared contract and runtime route signal.
- Spec: `docs/specs/archive/2026-07-05-adaptive-cache-first-agent-workflow.spec.md`
- Origin: The user chose agent workflow efficiency, asked for the best scheme, and invoked planner for an executable Plan.
- Scope Mode: New executable slice. The older `docs/plans/2026-05-17-003-feat-cost-efficiency-r3-plan.md` is stale because it targets retired Python runtime files, so this Plan uses the current Bun TypeScript runtime surface.
- Roadmap source: `docs/specs/archive/2026-07-05-adaptive-cache-first-agent-workflow.spec.md` Roadmap.
- Execution scope: Phase 1 only: executable adaptive route.
- Deferred phases: Phase 2 telemetry feedback tuning and Phase 3 optional DAG or semantic memory.
- Roadmap note: This Plan is not the full roadmap implementation Plan.
- Planner research dispatch: Two read-only Explore probes were launched for workflow docs and runtime hooks, but both returned no output. Local read-only evidence was sufficient to decompose steps with concrete verification paths.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, commands, schema fields, enum values, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Step`, `Plan`, `Spec`, `State Ledger`, `Activation Plan`, and `Discovery cache`.

## Research

- `CONTEXT.md` defines the current architecture map: Bun TypeScript runtime, plugin-local `imm-*` wrappers, Plan validation and sync, skill contracts, bootstrap templates, durable learnings, and upstream references.
- `.imm/memory/current_iteration.json` is idle after completing the previous runtime truth Plan. The active runtime plan can be replaced by a new synced Plan.
- `docs/specs/archive/discovery-navigation-layer.spec.md` already defines static `CONTEXT.md`, dynamic Step `discovery_cache`, and pattern-layer `docs/solutions/` `key_files` discovery.
- `plugins/immune-brain/runtime/plan_core.ts` parses `Discovery cache` and `Parallel probes` fields. `plugins/immune-brain/runtime/state_ledger.ts` preserves those fields on synced Steps.
- `docs/reference/subagent-dispatch-protocol.md` already defines lightweight short-circuiting, global activation mode handling, `cost_scope_mismatch`, and the `shared_context_summary` plus `focus_delta` packet.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` exposes `imm-activation-plan`, but its command currently returns empty candidates and does not derive route evidence from `--task-summary` or `--changed-path`.
- `tests/activation-plan-runtime-surface.test.ts` and `tests/code-review-activation-contract.test.ts` are the focused test surfaces for activation runtime behavior.
- `docs/specs/archive/cost-efficiency-r3.spec.md` and its 2026-05-17 Plan are useful historical evidence but reference retired Python runtime paths, so they should not be appended.
- `docs/reference/planning-quality-gate.md` applies because this slice touches workflow contracts, subagent routing, runtime JSON output, and cross-host skill behavior.

## Decisions

- D1: Use a new Plan rather than append to the stale cost-efficiency R3 Plan.
- D2: Make the current slice Phase 1 only so the fastest useful improvement lands before telemetry automation or DAG work.
- D3: Treat cache-first discovery as the default route before broad search.
- D4: Keep subagent dispatch cost-gated instead of enabling parallelism by default for every task.
- D5: Extend the existing `imm-activation-plan` surface rather than adding a new workflow driver.
- D6: Preserve existing JSON fields and add route evidence in a backward-compatible way.

## Assumptions

- Bun is available because the current Immune-Brain runtime and tests already depend on Bun.
- Existing hosts can tolerate extra JSON fields in `imm-activation-plan` output.
- Low-risk single-domain work should prefer solo execution when a direct verification command exists.
- High-risk surfaces and explicit user requests must remain eligible for subagent dispatch.
- Skill source and packaged dist guidance need to stay synchronized.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: a runtime route change could leave docs promising behavior that `imm-activation-plan` does not expose.
- Mitigation: Step 1 changes the contract first. Step 2 adds focused runtime evidence. Step 3 aligns skill prompts and package sync after the runtime signal exists. Each Step can be reverted by its file group without changing State Ledger schema or historical Plans.

### 2. Verification Vanity

- Risk: verification could only prove that words like cache-first exist while the runtime still cannot distinguish small solo work from subagent-worthy work.
- Mitigation: Step 2 must add tests and a CLI smoke command that assert route evidence and fast-path fallback in `imm-activation-plan` output. Step 3 runs packaging and skill contract checks so the route is visible to real host prompts.

### 3. Spec Dilution Detection

- Risk: the user asked for the best efficiency scheme, but the Plan could silently shrink to docs-only guidance.
- Mitigation: The Plan covers the three parts of the selected scheme that make Phase 1 executable: shared contract, runtime route evidence, and host prompt consumption. Telemetry tuning and DAG or semantic memory are explicitly deferred rather than omitted.

## Planning Quality Gate

- **contract surface**: `docs/specs/archive/2026-07-05-adaptive-cache-first-agent-workflow.spec.md`, `docs/reference/subagent-dispatch-protocol.md`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `plugins/immune-brain/skills/imm-planner/SKILL.md`, `plugins/immune-brain/skills/imm-work/SKILL.md`, packaged `plugins/immune-brain/dist/*.md`, and related Bun tests.
- **compatibility**: Existing activation JSON fields remain present. Extra route fields are additive. No State Ledger schema migration is required.
- **interruption recovery**: If a Step fails, revert that Step's touched files and rerun its focused verification. Syncing this Plan does not mutate implementation files beyond State Ledger plan metadata.
- **rollback path**: Use git checkout or revert for the Step file group. Step 2 can revert runtime additions while keeping Step 1 docs as aspirational guidance if necessary.
- **verification strength**: Use focused Bun tests, CLI smoke checks, sync checks, skill contract checks, and `imm-plan --json` instead of prose-only assertions.
- **Brainstorm traceability**: No formal `Brainstorm manifest` was supplied. User-confirmed scope is mapped through Origin, Decisions, the Spec requirements, and Step Results.

## Steps

### Step 1

- Step ID: U1
- Result: Adaptive route contract is authoritative.
- Verification type: automated
- Verification: `rg -n "Adaptive Cache-First|Task Classifier|Cost-Based Subagent Gate|cache-first discovery" docs/specs/archive/2026-07-05-adaptive-cache-first-agent-workflow.spec.md docs/reference/subagent-dispatch-protocol.md plugins/immune-brain/skills plugins/immune-brain/dist && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-adaptive-cache-first-agent-workflow-plan.md --json`
- Test scenarios: The protocol names task classes, cache-first discovery order, subagent cost gate, shared briefing, and focused verification rules.
- Discovery cache: docs/specs/archive/2026-07-05-adaptive-cache-first-agent-workflow.spec.md (new route contract); docs/reference/subagent-dispatch-protocol.md (dispatch lifecycle); plugins/immune-brain/skills/imm-brainstorm/SKILL.md (framing route); plugins/immune-brain/skills/imm-planner/SKILL.md (planning route); plugins/immune-brain/skills/imm-work/SKILL.md (execution coordination route)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If existing protocol language already covers a rule, link to it instead of duplicating the text in every skill.

### Step 2

- Step ID: U2
- Result: Activation plan reports route evidence.
- Verification type: automated
- Verification: `bun test tests/activation-plan-runtime-surface.test.ts tests/code-review-activation-contract.test.ts && bash -lc 'bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-activation-plan --host imm-code-review --task-summary "single docs typo" --changed-path docs/reference/subagent-dispatch-protocol.md | rg "route_class|cost_scope_mismatch|solo_fallback_reason"' && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-adaptive-cache-first-agent-workflow-plan.md --json`
- Execution note: test-first
- Test scenarios: Low-risk single-domain input returns solo fallback cost evidence. Disabled activation still reports `config_disabled`. Explicit subagent requests are not swallowed by the fast path. Existing activation payload fields remain present.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (activation CLI); plugins/immune-brain/runtime/imm_core.ts (activation helpers); tests/activation-plan-runtime-surface.test.ts (runtime surface tests); tests/code-review-activation-contract.test.ts (activation contract tests); docs/reference/immune-brain-config.md (activation policy docs)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If route derivation becomes too heuristic, expose conservative route evidence and keep dispatch solo unless explicit or high-risk input is present.

### Step 3

- Step ID: U3
- Result: Host skill contracts consume adaptive routing.
- Verification type: automated
- Verification: `bun test tests/plan-validation.test.ts tests/baseline-packaging-contract.test.ts tests/dist-docs-sync-contract.test.ts plugins/immune-brain/tests/skill-registry-consistency.test.ts && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-adaptive-cache-first-agent-workflow-plan.md --json`
- Test scenarios: `imm-brainstorm`, `imm-planner`, and `imm-work` refer to cache-first discovery before broad search. Subagent routing remains bounded by activation mode and cost gate. Packaged dist guidance matches source guidance.
- Discovery cache: plugins/immune-brain/skills/imm-brainstorm/SKILL.md (brainstorm routing); plugins/immune-brain/skills/imm-planner/SKILL.md (planner routing); plugins/immune-brain/skills/imm-work/SKILL.md (work routing); plugins/immune-brain/dist (packaged prompts); tests/baseline-packaging-contract.test.ts (packaging contract); tests/dist-docs-sync-contract.test.ts (dist sync contract)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If source and dist sync tooling cannot cover skill prompt changes, update the smallest existing packaging contract rather than adding a new generator.

## Test Scenarios

- A single documentation edit with no risk trigger uses cache-first discovery and reports a solo cost gate.
- A task with explicit subagent request bypasses the solo cost gate and remains dispatch-eligible.
- A high-risk task surface does not get hidden by the single-domain fast path.
- A Plan with `Discovery cache` continues to validate and sync.
- Packaged guidance does not drift from source guidance.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-adaptive-cache-first-agent-workflow-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-adaptive-cache-first-agent-workflow-plan.md --sync`

## Next Action

- Validate this Plan with `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-adaptive-cache-first-agent-workflow-plan.md --json`.
- If validation passes and the user confirms execution, sync the Plan and enter `imm-work` to activate Step `U1`.
