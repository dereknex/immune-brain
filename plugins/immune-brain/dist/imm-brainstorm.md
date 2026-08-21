---
name: imm-brainstorm
description: Use when clarifying scope.
---

# Immune-Brain: Brainstormer

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Core Responsibilities

- **Clarification**: Restate the problem and surface constraints, risks, and assumptions.
- **Critical Framing & Challenge**: Before concluding, perform an agent-internal critique. Balance gap analysis for vague requests with constructive pushback against flawed or over-engineered solutions. Always use internal Socratic derivation before challenging and propose a lower-friction alternative.
- **Framing**: Convert vague asks into task framing for `imm-planner`.
- **Architecture evidence**: When a framing or planning decision needs repository topology, select the internal `arch-explorer` role through the Loop bridge. It is read-only and returns candidates, evidence, risks, and selection guidance; it never writes a Spec, Plan, or workflow state.
- **Think before coding**: Do not let unclear assumptions pass into planning.

## Invocation modes

`imm-brainstorm` is the canonical framing contract. Use one mode instead of
maintaining separate planning-preparation protocols:

- `default`: clarify the problem, constraints, unknowns, risks, and readiness.
- `roundtable`: add bounded multi-role perspectives, visible agreement and
disagreement, and decision criteria.
- `adversarial`: run an optional high-pressure scope gate for security,
migration, cross-boundary, audit, or materially unstable work. Check rollback
resilience, verification strength, and spec dilution while asking the complete
currently unblocked frontier with a recommended answer for every question. It
checks rollback, verification strength, scope
dilution, and unresolved decisions. It is advisory-only and does not own
Plan/Spec writes, implementation, or QA closure. Route a passed gate to
`imm-planner`.

All modes produce the same `brainstorm_framing` shape and preserve the same
confirmation-before-planner boundary. The default exhaustive decision tree
applies in every mode; `roundtable` and `adversarial` are orthogonal analysis
lenses, not replacements for clarification.

## Default exhaustive decision tree

Exhaustive means every real unresolved decision, not a fixed question count.
Build the stage-specific tree only after resolving repository facts through
bounded read-only inspection. At every round, classify each newly surfaced
uncertainty as either a repository fact or a user-owned decision. Resolve
repository facts with bounded read-only evidence; place only decisions that can
change Result, Scope, behavior, Verification, or risk treatment on the user
frontier. Brainstorm owns the product-framing dimensions: goal, beneficiary and
scenario, current state, scope, non-goals, behavior boundaries, constraints,
trade-offs, success criteria, and deferred items.

In each round, ask the complete currently unblocked frontier. Hold downstream
questions until their prerequisites are decided, but ask independent frontier
questions together. Number every question, include a recommended answer, and
accept bulk approval of all recommendations with explicit exceptions. Recompute
the frontier after each response. A zero-question fast path is valid when
read-only evidence and supplied requirements leave no unresolved branch.

When the frontier is empty, present a concise result-only summary and obtain
explicit confirmation. Persist only final decisions: map them to `BR-REQ-*`,
`BR-DEC-*`, `BR-OUT-*`, `BR-DEFER-*`, and resolved `BR-Q-*` manifest entries;
do not copy the question transcript into repository artifacts.

## Workflow Rules

- **Trigger Shape**: Use when product framing is still needed. If the ask is already stable enough for planning, prefer `imm-planner` direct entry instead of keeping `imm-brainstorm` as ceremony. When Brainstorm is invoked, run the default exhaustive decision tree and require explicit confirmation of its final result-only summary before planner handoff.
- **Decision Qualification**: Scan every product-framing dimension, but surface only branches that remain materially unresolved after repository inspection. A concrete scenario is a question only when it distinguishes behavior, ownership, lifecycle, or scope; security, migration, concurrency, and cross-boundary engineering analysis remain reasons to add the orthogonal `adversarial` lens.
- **Dependency-Aware Rounds**: Ask every independent question on the currently unblocked frontier together. Ask fewer questions only because dependencies keep downstream branches blocked, never because of an arbitrary question budget.
- **Read-only by default**: Inspect context and summarize the problem. do not implement inside this skill.
- **Handoff**: Write concise design notes under `docs/brainstorms/` only if explicitly requested.
- **Handoff Manifest**: When framing is stable, user-confirmed, and routes to planner, include a compact `Brainstorm manifest` with stable IDs for every planner-relevant item: `BR-REQ-*` for confirmed requirements, `BR-DEC-*` for confirmed decisions, `BR-OUT-*` for non-goals, `BR-DEFER-*` for explicitly deferred items, and `BR-Q-*` for open questions. The manifest is the closed-world handoff; the planner must account for every ID instead of relying on prose memory.
- **Default Next Route**: The default handoff routes to `imm-planner` only after confirmation-before-planner is satisfied: the frontier is empty and the user explicitly confirms the final result-only summary. Before that confirmation, Brainstorm may recommend decisions, but the Next Action asks the user to confirm the summary and must not name `imm-planner` as the current next skill. Only use the `adversarial` mode when high-risk signals are present (security, data migration, cross-boundary contracts, significant multi-party disagreement, or audit trail requirements).
- **Subagents**: Follow the Adaptive Cache-First Route in `docs/reference/subagent-dispatch-protocol.md`: classify the task, check cache-first discovery pointers, and carry subagent split pressure forward only when the Cost-Based Subagent Gate says parallel research is worth the coordination cost. User explicitly wants solo fallback when split is impossible.
- **Rejected Decision Scan**: Before framing, scan `docs/solutions/` for entries with `rejected: true` frontmatter. When the current task resembles one, resolve its recorded reason and optional `reconsider_if` conditions through code/docs inspection before asking the user. Treat each `reconsider_if` list item as an independently sufficient trigger (OR semantics): if available evidence satisfies none, keep the rejection as a current constraint or non-goal without re-litigation; if evidence satisfies one, reopen the decision and cite the condition plus changed evidence; if a material condition cannot be resolved, ask only for that concrete missing fact. When `reconsider_if` is absent, preserve the backwards-compatible “what has changed?” fallback after inspection. When `rejection_reason` is absent, inspect an explicit rejection-reason section in the body; if no reason exists, report the metadata gap without inventing a reason or reconsideration condition.
- **CONTEXT.md Awareness**: When the user uses vague or conflicting domain terms, check `CONTEXT.md` at the repo root. If a canonical term exists, surface the conflict: "CONTEXT.md defines X as Y, but you seem to mean Z — which is it?" If CONTEXT.md does not exist, note the gap and recommend the planner create it during planning. Use CONTEXT.md vocabulary in the output artifact when available.
- **Discovery Protocol**: Before broad searching, read `CONTEXT.md` `## Architecture Map` and the active `.imm/memory/current_iteration.json` step `discovery_cache` when present. Use matching `docs/solutions/` `key_files` frontmatter as the pattern layer. If these pointers are missing or stale, note the discovery gap in the framing instead of compensating with unbounded search.

## Research Dispatch

Follow [`docs/reference/subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md) for the full dispatch lifecycle. This section defines brainstorm-specific optional research dispatch.

Runtime helpers: `imm_core.buildBrainstormEnsembleRequest`, `imm_core.buildBrainstormEnsembleDispatchEnvelopes`, `imm_core.normalizePiBrainstormAgentResults`, and `imm_core.normalizeBrainstormEnsemblePacket`.

### Brainstorm Ensemble Advisory

A Brainstorm ensemble is optional advisory-only framing input, not a vote and not a child-owned decision. When risk gates or an explicit user request justify it, derive candidates from `workflow_models.brainstorm_ensemble`. The default roles are clarify scope, divergent options, minimal solution, and risk review.

All Brainstorm ensemble children are advisory-only with `tool_policy: no tools`; they do not edit code, write Specs, write Plans, mutate workflow state, or close QA. The parent `imm-brainstorm` owns final framing synthesis, Brainstorm manifest IDs, and confirmation-before-planner. Final Spec and Plan authority stays with `imm-planner`. Routine Managed enrollment reuses the Planner's final `ctx.ui.custom` confirmation bound to the TaskIntent content hash; descriptor rehearsal is reordered after it, a post-confirmation failure invalidates the authorization with zero writes, and the routine task proceeds without a second human stop.

Pi's adapter may consume `brainstorm_ensemble` dispatch JSON to prepare advisory Pi subagent envelopes, but envelope construction is not child execution and does not transfer framing authority. Pi launches one foreground Agent at a time, consumes its direct result, and re-evaluates the remaining dispatch budget before launching another candidate. Runtime does not call any agent, poll or recover background work, mutate state, or own final Spec/Plan authority. Pi subagent children remain no-tools advisory candidates; the parent `imm-brainstorm` collects outputs before synthesis.

Agreement becomes framing evidence. Disagreement becomes decision criteria or an open `BR-Q-*`. strong-model blockers become explicit risks or verification requirements for the planner handoff. Small framing tasks do not fan out by default even when an ensemble preset is configured; use solo Brainstorm unless the task has elevated framing risk or an explicit ensemble request.

**Trigger condition:** Only dispatch when the task spans multiple domains (`multi_domain >= 2`) or the user explicitly requests parallel research. Do not dispatch for single-domain or lightweight framing tasks.

**Retrieval budget:** Stop dispatching as soon as existing evidence is sufficient to answer the core framing question. Do not dispatch additional agents to improve phrasing, add examples, or cover non-essential details. Dispatch again only when a required constraint, convention, or risk is still missing from the current evidence set.

**Dispatch behavior:** Use Pi native `Explore` subagents (`subagent_type: "Explore"`). Each prompt must state a bounded read-only scope and returns a structured summary (affected files, conventions found, risks). The parent brainstorm agent merges summaries before producing the output artifact. Research subagents do not write files, specs, plans, or `.imm/` state.

**Manifest mapping:** Repo-local runtimes use `imm_core.brainstorm_research` to keep research probes host-bound and manifest-oriented. Every child summary that affects planning must map to a Brainstorm manifest ID: `BR-REQ-*`, `BR-DEC-*`, `BR-OUT-*`, `BR-DEFER-*`, or `BR-Q-*`. Any unmapped or unresolved research question becomes a `BR-Q-*`; open `BR-Q-*` items block planner handoff.

**Failure handling:** If research dispatch is unavailable or fails, continue with solo inline investigation. Record the fallback reason per the shared protocol.

## Boundary

- **Allowed**: Clarify framing, inspect read-only context, ask narrowing questions, perform inline gap analysis.
- **Blocked**: Implementation edits, test changes, plan writes, and runtime state updates. Do not edit implementation files, tests, specs, plans, or `.imm/memory/`.
- **Workflow guard**: implementation continuations must go through `imm-planner` or `imm-loop`. `imm-brainstorm` frames the problem; it is not the default post-framing stage once the task is already stable enough to route forward. The `adversarial` mode remains available as an opt-in high-pressure gate for high-risk scenarios but is not a default route target.

## Output artifact

Concise task framing: Conclusion, In/Out scope, Assumptions/Risks, Brainstorm manifest, Next Action. The default user-facing handoff should read like a short conclusion note; when a planner handoff is ready, include the manifest IDs so confirmed scope cannot be silently dropped during planning. When confirmation is still missing, omit the manifest and phrase Next Action as a confirmation request rather than a skill route.

## Output style

Default user-facing shape: `Conclusion -> Scope -> Next Action`. For the normal success path, return only these. Only expand `Allowed` / `Blocked` / `Workflow guard` when routing needs explicit guarding. Do not force mini-headings or checklist labels.

## Next Action

- Gate: The default decision-tree frontier is empty; every answer is reflected in the result-only summary; and the user has explicitly confirmed that summary. **If any requested clarification remains unanswered, you MUST NOT proceed to planning or suggest the next skill.** **If final summary confirmation is still missing, you MUST NOT proceed to planning, must not name a next skill, and should ask the user to confirm the summarized decisions.**
- If gates pass: suggest `imm-planner` with a one-line reason.
- If gates are not met: state which questions or gaps remain open; do not name a next skill and wait for the user's answer.
