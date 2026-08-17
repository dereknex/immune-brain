---
title: "feat: adaptive cache-first agent workflow"
type: feat
status: planned
date: 2026-07-05
origin:
  - user selected agent workflow efficiency as the target improvement area
  - user requested one best plan after comparing cache-first routing and subagent parallelism costs
  - local readonly evidence from CONTEXT.md, current State Ledger, discovery navigation specs, subagent dispatch protocol, activation runtime, and related tests
---

# Adaptive Cache-First Agent Workflow Spec

## 1. Goal

Make Immune-Brain route work through one adaptive workflow: reuse known discovery first, classify the task, and only spend subagent overhead when the expected benefit is higher than the coordination cost.

The selected best direction is:

1. Cache-first discovery before broad search.
2. Task classification before workflow ceremony.
3. Cost-gated subagent dispatch with a shared briefing.
4. Impact-scoped verification instead of default full-suite testing.
5. Lightweight telemetry that can tune the routing rules later.

## 2. Current Technical Evidence

### Existing cache-first pieces

`CONTEXT.md` already defines an `Architecture Map`. `docs/specs/discovery-navigation-layer.spec.md` defines a three-tier discovery model: static `CONTEXT.md`, dynamic State Ledger `discovery_cache`, and pattern-layer `docs/solutions/` `key_files`. The current TypeScript parser already supports `Discovery cache` fields in Plans, and State Ledger sync preserves `discovery_cache` on Steps.

### Existing subagent cost controls

`docs/reference/subagent-dispatch-protocol.md` already has a lightweight short-circuit phase with `cost_scope_mismatch`, `explicit_required`, and `config_disabled` fallback reasons. The protocol also defines `shared_context_summary` plus per-lens `focus_delta`, which is the right shape for avoiding repeated child context.

### Runtime gap

`plugins/immune-brain/runtime/immune_brain_runtime.ts` exposes `imm-activation-plan`, but the current command returns an empty payload and does not use `--task-summary` or `--changed-path` to report a route class or cost gate. That leaves the best workflow mostly documented rather than executable from runtime evidence.

### Workflow prompt gap

The planner and brainstorm contracts already mention discovery caches and optional subagent dispatch. The missing part is a single visible adaptive route that tells hosts when to use the fast path, when to consult cache, and when to dispatch parallel probes or reviewers.

## 3. Requirements

### R1. Adaptive route contract

- Define a small task classifier with at least `trivial`, `single_domain`, `multi_domain`, and `high_risk` route classes.
- Define the cache-first discovery order: `CONTEXT.md` `## Architecture Map`, active Step `discovery_cache`, relevant `docs/solutions/` `key_files`, then targeted grep/read.
- Define the subagent cost gate: dispatch only when the task is multi-domain, high-risk, explicitly requested, or has a concrete `parallel_probes` surface.
- Keep the shared briefing requirement: one `shared_context_summary`, sharded `focus_delta`, short structured output.

### R2. Runtime route evidence

- Extend `imm-activation-plan` so it reports the route class and dispatch cost evidence from `--task-summary`, `--changed-path`, and activation mode.
- Preserve existing activation output fields such as `candidates`, `lenses`, `candidate_lenses`, and `solo_fallback_reason`.
- Keep solo fallback reasons deterministic: `cost_scope_mismatch` for low-risk single-domain work, `trigger_not_hit` when no trigger matches, `explicit_required` when policy requires explicit dispatch, and `config_disabled` when disabled.
- Do not add dependencies.

### R3. Workflow prompt consumption

- Update the relevant host skill contracts so `imm-brainstorm`, `imm-planner`, and `imm-work` follow the same adaptive route language.
- Preserve role boundaries: planner writes Plans, work coordinates the active Step, executor edits code, QA judges closure.
- Keep subagent dispatch optional and bounded; the route must not create a generic dispatcher or a new workflow driver.

### R4. Verification routing

- Add verification guidance that prefers focused tests tied to changed surfaces before full suites.
- Keep full-suite verification for high-risk, release, migration, or cross-host contract changes.
- Ensure Plan validation stays part of every executable Plan handoff.

## 4. Roadmap

### Phase 1: Executable adaptive route

- acceptance_criteria: The adaptive route is documented, `imm-activation-plan` reports route evidence, and skill contracts consume the same cache-first and cost-gated language.
- promotion_criteria: Runtime tests prove low-risk work short-circuits while explicit or high-risk work remains eligible for subagent dispatch.

### Phase 2: Telemetry feedback tuning

- acceptance_criteria: Dispatch and fallback telemetry can answer whether subagents saved time, caused rework, or produced actionable findings.
- promotion_criteria: At least several real workflow runs produce enough data to tune default route thresholds.

### Phase 3: Optional DAG and semantic memory

- acceptance_criteria: A task DAG or global semantic memory is justified by measured repeated overhead after Phase 1 and Phase 2.
- promotion_criteria: There is evidence that the simpler cache-first route cannot meet efficiency goals.

## 5. Non-goals

- No generic dispatcher platform.
- No new daemon, scheduler, SQLite, FTS, or wiki memory plane.
- No full task DAG in this slice.
- No automatic prompt pruning without human review.
- No unsupervised issue-to-patch pipeline.
- No rewrite of historical Plans.

## 6. Acceptance Criteria

- The adaptive route contract names task classes, cache-first discovery order, subagent cost gate, shared briefing, and focused verification rules.
- `imm-activation-plan` reports deterministic route evidence while preserving its current JSON shape.
- Low-risk single-domain input produces a solo fallback with `cost_scope_mismatch` or an equivalent documented fast-path reason.
- Explicit subagent requests and high-risk surfaces remain eligible instead of being swallowed by the fast path.
- Relevant skill contracts point to the same route language instead of re-describing conflicting dispatch rules.
- The executable Plan validates with `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-adaptive-cache-first-agent-workflow-plan.md --json`.
