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

`imm-brainstorm` is the canonical exhaustive clarification owner. Its modes share
one interaction protocol:

- `default`: traverse the full sourced design tree.
- `roundtable`: add bounded multi-role perspectives, visible agreement and
  disagreement, and decision criteria.
- `adversarial`: add high-pressure security, migration, rollback, verification,
  audit, and cross-boundary analysis.

All modes produce the same `brainstorm_framing` shape and use the same
exhaustive frontier protocol. `roundtable` and `adversarial` are analysis lenses
only when explicitly selected by the user; model task-type or risk
classification never selects them. Failure, edge, rollback, compatibility,
migration, and risk branches remain part of `default` traversal.

## Default exhaustive decision tree

Exhaustive means every sourced current-goal branch, not a fixed question count.
Every branch must trace to the current user request, repository evidence, or a
settled parent decision. Seed the fixed framing roots: goal, beneficiary and
scenario, current state, desired behavior, scope and non-goals, constraints,
failure and edge behavior, compatibility and migration, success and
Verification, and deferred items. Expand them dynamically after every answer.
Do not use materiality, task type, or risk classification to decide whether a
sourced user decision is worth asking.

Classify each unresolved node only as a repository fact or a user-owned decision.
Resolve facts with bounded, on-demand read-only evidence. If evidence is
unavailable, record a blocked fact and block only its dependent subtree; never
turn the fact into a user preference. Place every sourced user decision on the
current frontier.

Ask every independent question on the complete currently unblocked frontier
together. Hold downstream questions until their prerequisites are decided.
Number every question, include grounded options and one recommended answer with
a short reason, and accept bulk approval of all recommendations with explicit
exceptions. Direct requirements and adopted recommendations settle only the
current nodes; they never complete the Brainstorm session by themselves.
Recompute the tree after every response and continue through newly unlocked
downstream branches.

Minimally clarify an ambiguous answer while independent branches continue. If a
later answer or new fact invalidates an earlier choice, reopen only that decision
delta and explain the new evidence. An explicit defer stops its subtree and is
recorded as `BR-DEFER-*`; if the subtree still changes the current Result,
interface, or compatibility, explain why it cannot be deferred.

Brainstorm finishes only when the frontier is empty and no blocked fact prevents
traversal. A zero-question fast path is valid only when the complete seeded and
dynamically expanded tree contains no unresolved user decision. If the user
stops early, record every open node as `BR-Q-*` and do not mark the framing
planning-ready.

When traversal completes, present a concise result-only summary as a
non-blocking correction window. Do not ask the user to reconfirm decisions
reflected without change. If the summary introduces or changes a
decision, ask for explicit confirmation of only that decision delta
and block Planner handoff until it is answered. Agent judgment alone never
confirms a proposed direction or scope. Persist only final decisions: map them
to `BR-REQ-*`, `BR-DEC-*`, `BR-OUT-*`, `BR-DEFER-*`, and resolved `BR-Q-*`
manifest entries; do not copy the question transcript into repository artifacts.

## Workflow Rules

- **Trigger Shape**: Use when product framing is still needed. Direct Planner entry remains available for a clear request, but once the user invokes Brainstorm, do not short-circuit its exhaustive traversal because an initial frame appears clear. Do not add a second confirmation for an unchanged final summary.
- **Decision Provenance**: Traverse every sourced current-goal branch. A concrete scenario is a branch when the request, repository, or a settled parent decision makes it relevant; do not invent speculative future needs.
- **Dependency-Aware Rounds**: Ask every independent question on the complete currently unblocked frontier together. Ask fewer questions only because dependencies keep downstream branches blocked, never because of an arbitrary question budget.
- **Read-only by default**: Inspect context and summarize the problem. do not implement inside this skill.
- **Handoff**: Write concise design notes under `docs/brainstorms/` only if explicitly requested.
- **Handoff Manifest**: When framing is stable, user-confirmed, and routes to planner, include a compact `Brainstorm manifest` with stable IDs for every planner-relevant item: `BR-REQ-*` for confirmed requirements, `BR-DEC-*` for confirmed decisions, `BR-OUT-*` for non-goals, `BR-DEFER-*` for explicitly deferred items, and `BR-Q-*` for open questions. The manifest is the closed-world handoff; the planner must account for every ID instead of relying on prose memory.
- **Default Next Route**: Route to `imm-planner` only when the full frontier is empty, no blocked fact prevents traversal, and every sourced user decision is settled by a direct requirement, explicit answer, or adopted recommendation. Those inputs close their nodes but never the session. An unchanged final summary is a correction window, not another gate. If Brainstorm introduces a new decision, ask for that delta and do not name `imm-planner` as the current next skill.
- **Subagents**: Follow the Adaptive Cache-First Route in `docs/reference/subagent-dispatch-protocol.md`: classify the task, check cache-first discovery pointers, and carry subagent split pressure forward only when the Cost-Based Subagent Gate says parallel research is worth the coordination cost. User explicitly wants solo fallback when split is impossible.
- **Rejected Decision Evidence**: Use on-demand rejected-decision evidence instead of a global preflight. When a live branch resembles a rejected decision, resolve its recorded reason and optional `reconsider_if` conditions through code/docs inspection before asking the user. Treat each `reconsider_if` list item as an independently sufficient trigger (OR semantics): if available evidence satisfies none, keep the rejection as a current constraint or non-goal without re-litigation; if evidence satisfies one, reopen the decision and cite the condition plus changed evidence; if a condition cannot be resolved, ask only for that concrete missing fact. When `reconsider_if` is absent, preserve the backwards-compatible "what has changed?" fallback after inspection. When `rejection_reason` is absent, inspect an explicit rejection-reason section in the body; if no reason exists, report the metadata gap without inventing a reason or reconsideration condition.
- **CONTEXT.md Awareness**: When the user uses vague or conflicting domain terms, check `CONTEXT.md` at the repo root. If a canonical term exists, surface the conflict: "CONTEXT.md defines X as Y, but you seem to mean Z — which is it?" If CONTEXT.md does not exist, note the gap and recommend the planner create it during planning. Use CONTEXT.md vocabulary in the output artifact when available.
- **Discovery Protocol**: Before broad searching, read `CONTEXT.md` `## Architecture Map` and the active `.imm/memory/current_iteration.json` step `discovery_cache` when present. Use matching `docs/solutions/` `key_files` frontmatter as the pattern layer. If these pointers are missing or stale, note the discovery gap in the framing instead of compensating with unbounded search.

## Research Dispatch

Follow [`docs/reference/subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md) for the full dispatch lifecycle. This section defines brainstorm-specific optional research dispatch.

Runtime helpers: `imm_core.buildBrainstormEnsembleRequest`, `imm_core.buildBrainstormEnsembleDispatchEnvelopes`, `imm_core.normalizePiBrainstormAgentResults`, and `imm_core.normalizeBrainstormEnsemblePacket`.

### Brainstorm Ensemble Advisory

A Brainstorm ensemble is optional advisory-only framing input, not a vote and not a child-owned decision. When risk gates or an explicit user request justify it, derive candidates from `workflow_models.brainstorm_ensemble`. The default roles are clarify scope, divergent options, minimal solution, and risk review.

All Brainstorm ensemble children are advisory-only with `tool_policy: no tools`; they do not edit code, write Specs, write Plans, mutate workflow state, or close QA. The parent `imm-brainstorm` owns final framing synthesis, Brainstorm manifest IDs, and decision-delta confirmation. Final Spec and Plan authority stays with `imm-planner`. Routine Managed enrollment uses the Planner's final `ctx.ui.custom` confirmation bound to the TaskIntent content hash as the single authority gate; Enrollment validates descriptor structure without executing acceptance descriptors, deterministic QA executes them after implementation, and the routine task proceeds without a second human stop.

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

Concise task framing: Conclusion, In/Out scope, Assumptions/Risks, Brainstorm manifest, Next Action. The default user-facing handoff should read like a short conclusion note; when a planner handoff is ready, include the manifest IDs so confirmed scope cannot be silently dropped during planning. When a decision delta is still unconfirmed, omit the handoff manifest and phrase Next Action as a focused confirmation request rather than a skill route.

## Output style

Default user-facing shape: `Conclusion -> Scope -> Next Action`. For the normal success path, return only these. Only expand `Allowed` / `Blocked` / `Workflow guard` when routing needs explicit guarding. Do not force mini-headings or checklist labels.

## Next Action

- Gate: The exhaustive frontier is empty; no blocked fact prevents traversal; every sourced user decision is settled by a direct requirement, explicit answer, or adopted recommendation; and the result-only summary introduces no unconfirmed decision delta. **If any requested clarification remains unanswered, you MUST NOT proceed to planning or suggest the next skill.** **If a decision delta is still unconfirmed, you MUST NOT proceed to planning, must not name a next skill, and should ask the user to confirm only that delta.**
- If gates pass: suggest `imm-planner` with a one-line reason.
- If gates are not met: state which questions or decision deltas remain open; do not name a next skill and wait for the user's answer.
