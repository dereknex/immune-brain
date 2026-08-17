# Specification: Cost Efficiency Improvements Round 3

## Problem Statement
While earlier efforts (skills baselining, delegation context sharding) significantly reduced token consumption, Immune-Brain still encounters high overhead in these specific areas:
1. **Discovery & Search**: Broad search (`glob` + full file reads) consumes excessive context when trying to understand unknown code.
2. **Dispatch Short-circuiting**: High fixed cost for initializing subagents on tasks that do not actually hit the risk constraints.
3. **Telemetry-Driven Prompt Pruning**: Unused safety guards continue to cost tokens without providing value, while we now have historical telemetry that could prove their safety.
4. **State GC / Archiving**: `current_iteration.json` grows indefinitely with closed step details and child evidence over a long project lifecycle.

## Requirements
1. **Discovery Constraint**: Require agents (especially `imm-brainstorm` and `imm-executor`) to use specific codebase parsers or fine-grained regex to grab signatures instead of full file bodies during the exploration phase.
2. **Dispatch Short-circuiting**: Refine the Subagent Dispatch Protocol (`docs/reference/subagent-dispatch-protocol.md`) to define a fast-path for lightweight, single-domain changes, bypassing specialized reviewers unless explicitly triggered by domain keywords or specific rule boundaries.
3. **Telemetry Pruning**: Leverage recent dev-insights telemetry to deprecate or implicitly fold 1-2 redundant rules in `BASELINE.md` into the assumed context, testing the effect on regression.
4. **State Archiving**: Implement an explicit `Dehydrate` / Archiving step inside `imm-compounder` (or during iteration closure) that scrubs verbose `child_evidence` and `focus_delta` out of `current_iteration.json` for successfully closed steps, replacing them with a pointer/ID.

## Out of Scope
- Rewriting the core `invoke_agent` LLM bridge.
- Full RAG implementation for discovery.
- Fully automated, unsupervised modification of `BASELINE.md` by telemetry (human-in-the-loop review is still required for pruning).

## Success Criteria
- The plan validates successfully against `imm-plan`.
- Context overhead on subsequent small bug fixes drops noticeably due to dispatch short-circuiting.
- The `.imm/memory/current_iteration.json` file size shrinks post-closure due to dehydration.