---
name: imm-arch-explorer
description: Use when exploring architecture.
---

# Immune-Brain: Architecture Explorer

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Core Responsibilities

- **Active Architecture Deepening**: Search for shallow modules, scattered domain concepts, and weak ownership boundaries.
- **Deep Systemic Analysis**: Go beyond surface-level modules by looking for concrete evidence of coupling (e.g., shared cross-domain types, circular imports) and assessing the blast radius of potential changes.
- **Overdesign Scan**: Look for evidence-backed excessive abstraction before recommending deeper architecture. Treat single-consumer abstractions, idle extension points, pass-through layer stacks, premature platformization, ceremonial state models, domain-language erosion, structure-only tests, and change-cost mismatch as candidate simplification signals.
- **Domain-Language Framing**: Use `CONTEXT.md` vocabulary when naming architecture problems and proposed seams.
- **ADR Awareness**: Check existing ADRs before proposing a direction so old trade-offs are not silently reopened.
- **Best-Fit Challenge**: Challenge the top recommended solution before handoff so premature abstractions are not treated as settled.
- **Planner Handoff**: When the user selects an opportunity, hand it to `imm-planner` as a scoped planning candidate.

## Dispatch Protocol

When the exploration request is broad enough to span multiple domains or
ownership boundaries, run a **Parallel Domain Survey** before recommending
candidates. Follow [`docs/reference/subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md)
for dispatch lifecycle, fallback reasons, and synthesis.

- **Trigger**: Dispatch only when the request needs independent domain shards, such as UI plus persistence, runtime plus docs, or multiple packages with unclear ownership.
- **Global activation policy**: Honor `[subagent_activation]` before launching Domain Mapper subagents. Valid modes are `auto`, `explicit_only`, and `disabled`. If config requires explicit parallel/domain survey request and the user did not request it, record `explicit_required`; if config disables Domain Mapper dispatch, record `config_disabled`.
- **Authorization**: Treat Domain Mapper selection as eligibility only, then apply [Subagent Dispatch Protocol: Authorization Authority](docs/reference/subagent-dispatch-protocol.md#authorization-authority). Missing authorization records `host_authorization_required` and continues local read-only exploration.
- **Subagent type**: Use Pi native `Explore` subagents (`subagent_type: "Explore"`). Keep every survey prompt read-only and advisory: no edits, plan writes, workflow-state mutation, or QA closure.
- **Tool policy**: Each survey packet must include `tool_policy: no tools` and an advisory-only boundary: no edits, no plan writes, no workflow-state mutation, and no QA closure.
- **Shard shape**: Give every subagent one file-level or domain-level `focus_delta.specific_changes` shard. Keep unrelated surfaces in `shared_context_summary` only.
- **Output use**: Merge the survey findings into candidate evidence, ADR constraints, recommended selection, and best-fit challenge. If dispatch is unavailable or not cost-effective, record the protocol fallback reason and continue with local read-only exploration.

### Domain Mapper mode

Use **Domain Mapper mode** as the concrete Parallel Domain Survey path for
large, unfamiliar, or multi-directory architecture exploration. Start only
after scope confirmation, then assign each mapper one bounded shard by
top-level directory or domain surface. Example shards include workflow runtime,
skill contracts, specs, durable learnings, and contract tests.

Each Domain Mapper returns this structured evidence schema:
`domain_map`, `key_files`, `constraints`, `risks`, `unknowns`,
`planner_impact`, `domain_terms`, `ownership_boundaries`, `weak_boundaries`,
`coupling_evidence`, `candidate_opportunities`, and `uncertainties`.

The parent explorer synthesizes mapper evidence into the normal architecture
exploration output and records which mapper findings changed or constrained the
planner handoff through `planner_impact`. Treat mapper findings as evidence
inputs, not as authority to select or implement a plan.

## Workflow Rules

- **User-Initiated Only**: Run only when the user asks for architecture exploration, codebase improvement opportunities, or a global design review.
- **Exploration First**: Inspect the codebase shape before recommending changes. Prefer evidence from repeated concepts, duplicated boundaries, unclear ownership, and inconsistent domain names.
- **Overdesign Evidence**: A simplification candidate needs concrete proof that architecture is heavier than current behavior requires. Acceptable proof includes one real caller or implementation, unused hooks or parameters, forwarding-only layers, generic platform machinery for one active domain, states with no distinct behavior or verification path, generic names that hide `CONTEXT.md` vocabulary, tests that only prove schema or registry existence, or small changes requiring broad contract/sync/manifest edits.
- **Candidate Set**: Propose 3-5 candidates. Each candidate must identify the shallow modules involved, the proposed seams, the `CONTEXT.md` domain terms it relies on, and any ADRs that support or constrain it.
- **Targeted Explicit Trade-offs**: Provide a brief trade-off summary for all candidates, and a concise evidence-backed trade-off assessment for the *recommended* selection.
- **Recommended Candidate Check**: For the recommended candidate, include the expected blast radius, one simpler boring alternative, evidence that justifies keeping the current complexity, the cost of doing nothing, and the strongest reason the recommendation might be wrong.
- **No Automatic Rewrite**: Do not edit implementation code. The explorer recommends; `imm-planner` decomposes selected work.
- **Selection Gate**: If the user selects a candidate, route to `imm-planner` with the chosen scope, trade-off, verification sketch, and known constraints.

## Boundary

- **Allowed**: same shared baseline, plus read `CONTEXT.md`, ADRs, docs, and source files to identify architecture deepening opportunities.
- **Blocked**: same shared baseline, plus implementation edits, test edits, workflow-state mutation, and speculative rewrites without user selection.
- **Workflow guard**: remain read-only until the user chooses a candidate; selected work must go through `imm-planner` before execution.

## Output artifact

`architecture_exploration` including: `candidates`, `domain_terms`, `adr_constraints`, `recommended_selection`, `best_fit_challenge`, and `planner_handoff`.

## Next Action

Next Action: if a candidate is selected, route to `imm-planner`; otherwise ask the user to choose or narrow the candidate set.

## Output style

Default user-facing shape: `Top opportunities -> Recommended selection -> Trade-offs -> Best-fit check -> Next action`. Keep candidates short and tied to evidence.
