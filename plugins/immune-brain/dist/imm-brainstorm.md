---
name: imm-brainstorm
description: Use when the user explicitly requests Immune-Brain requirement clarification.
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

`imm-brainstorm` owns proportionate clarification. Its modes share decision
provenance and authority constraints:

- `default`: resolve facts and delegated choices; ask only material unresolved decisions.
- `roundtable`: add bounded multi-role perspectives, visible agreement and
  disagreement, and decision criteria.
- `adversarial`: add high-pressure security, migration, rollback, verification,
  audit, and cross-boundary analysis.

All modes produce the same `brainstorm_framing` shape. `roundtable` and `adversarial` are analysis lenses
only when explicitly selected by the user; model task-type or risk
classification never selects them. Exhaustive interviewing requires an explicit
request for thorough interrogation; selecting a lens alone does not require it.

## Default clarification

Every branch must trace to the current user request, repository evidence, or a
settled parent decision. For a clear request, use a zero-question fast path when
no material decision or required fact remains unresolved. Do not seed or expand
a complete tree by default. Failure, compatibility, rollback, and risk questions
are relevant when evidence shows they can change the current outcome.

Classify each unresolved node as a repository fact, a delegated technical
choice, or a material user-owned decision. Resolve repository facts with
bounded, on-demand read-only evidence. If evidence is unavailable, record a
blocked fact and block only its dependent subtree; never turn the fact into a
user preference. A delegated technical choice is verifiable through existing
conventions, a reversible local probe, or an existing recorded decision when it
does not change the goal, scope, observable behavior, compatibility, risk
acceptance, or a protected effect; resolve it with evidence and record the
chosen assumption instead of asking. When a technical choice does change one of
those, it is material and belongs on the user frontier. Place every material
user-owned decision on the current frontier.

Ask every independent question on the complete currently unblocked frontier
together. Hold downstream questions until their prerequisites are decided.
Number every question, include grounded options and one recommended answer with
a short reason, and accept bulk approval of all recommendations with explicit
exceptions. Direct requirements and adopted recommendations settle their
decisions without another approval round. After an answer, ask again only for
a newly evidenced material decision, not to manufacture further rounds.

Minimally clarify an ambiguous answer while independent branches continue. If a
later answer or new fact invalidates an earlier choice, reopen only that decision
delta and explain the new evidence. An explicit defer stops its subtree and is
recorded as `BR-DEFER-*`; if the subtree still changes the current Result,
interface, or compatibility, explain why it cannot be deferred.

Brainstorm finishes when the material decision frontier is empty and no blocked
fact prevents the current handoff. Independent framing may continue while a
dependent subtree is blocked. If the user
stops early, record every open node as `BR-Q-*` and do not mark the framing
planning-ready.

When clarification completes, present a concise result-only summary as a
non-blocking correction window. Do not ask the user to reconfirm decisions
reflected without change. If the summary introduces or changes a
decision, ask for explicit confirmation of only that decision delta
and block Planner handoff until it is answered. Agent judgment alone never
confirms a proposed direction or scope. Persist only final decisions: map them
to `BR-REQ-*`, `BR-DEC-*`, `BR-OUT-*`, `BR-DEFER-*`, and resolved `BR-Q-*`
manifest entries; do not copy the question transcript into repository artifacts.

## Explicit exhaustive interrogation

Read this section only when the user explicitly requests thorough or exhaustive
interrogation. Exhaustive means every sourced current-goal branch, not a fixed
question count. Seed the fixed framing roots: goal, beneficiary and scenario,
current state, desired behavior, scope and non-goals, constraints, failure and
edge behavior, compatibility and migration, success and Verification, and
deferred items. Recompute the tree after every response and traverse newly
unlocked downstream branches. Adoption closes current nodes, not unexplored
branches. Resolve facts and delegated choices locally; ask material user-owned
decisions. Stop when the sourced tree is traversed and its material frontier is
empty, or report remaining blocked/open nodes if the user stops early.

## Workflow Rules

- **Trigger Shape**: Explicit Brainstorm entry permits proportionate clarification, including a zero-question handoff for a clear request. Read the exhaustive protocol only on an explicit request for thorough interrogation. Do not add a second confirmation for an unchanged final summary.
- **Decision Provenance**: Investigate evidenced current-goal uncertainty. A concrete scenario is relevant when the request, repository, or a settled parent decision makes it material; do not invent speculative future needs.
- **Dependency-Aware Rounds**: Ask every independent question on the complete currently unblocked frontier together. Ask fewer questions only because dependencies keep downstream branches blocked, never because of an arbitrary question budget.
- **Read-only by default**: Inspect context and summarize the problem. do not implement inside this skill.
- **Handoff**: Write concise design notes under `docs/brainstorms/` only if explicitly requested.
- **Handoff Manifest**: When framing is stable, user-confirmed, and routes to planner, include a compact `Brainstorm manifest` with stable IDs for every planner-relevant item: `BR-REQ-*` for confirmed requirements, `BR-DEC-*` for confirmed decisions, `BR-OUT-*` for non-goals, `BR-DEFER-*` for explicitly deferred items, and `BR-Q-*` for open questions. The manifest is the closed-world handoff; the planner must account for every ID instead of relying on prose memory.
- **Default Next Route**: Route to `imm-planner` when the material frontier is empty, no required fact blocks the handoff, and every material user decision is settled by a direct requirement, explicit answer, or adopted recommendation. An unchanged final summary is a correction window, not another gate. If Brainstorm introduces a new decision, ask for that delta and do not name `imm-planner` as the current next skill.
- **Subagents**: Only when optional research is needed, read Research Dispatch and its shared dispatch reference. Default to inline evidence gathering; do not load dispatch instructions merely because Brainstorm was invoked.
- **Rejected Decision Evidence**: Use on-demand rejected-decision evidence instead of a global preflight. When a live branch resembles a rejected decision, resolve its recorded reason and optional `reconsider_if` conditions through code/docs inspection before asking the user. Treat each `reconsider_if` list item as an independently sufficient trigger (OR semantics): if available evidence satisfies none, keep the rejection as a current constraint or non-goal without re-litigation; if evidence satisfies one, reopen the decision and cite the condition plus changed evidence; if a condition cannot be resolved, ask only for that concrete missing fact. When `reconsider_if` is absent, preserve the backwards-compatible "what has changed?" fallback after inspection. When `rejection_reason` is absent, inspect an explicit rejection-reason section in the body; if no reason exists, report the metadata gap without inventing a reason or reconsideration condition.
- **CONTEXT.md Awareness**: When the user uses vague or conflicting domain terms, check `CONTEXT.md` at the repo root. If a canonical term exists, surface the conflict: "CONTEXT.md defines X as Y, but you seem to mean Z — which is it?" If CONTEXT.md does not exist, note the gap and recommend the planner create it during planning. Use CONTEXT.md vocabulary in the output artifact when available.
- **Discovery Protocol**: Before broad searching, read `CONTEXT.md` `## Architecture Map` and the active `.imm/memory/current_iteration.json` step `discovery_cache` when present. Use matching `docs/solutions/` `key_files` frontmatter as the pattern layer. If these pointers are missing or stale, note the discovery gap in the framing instead of compensating with unbounded search.

## Research Dispatch

Follow [`docs/reference/subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md) for the full dispatch lifecycle. This section defines brainstorm-specific optional research dispatch.

Runtime helpers: `imm_core.buildBrainstormEnsembleRequest`, `imm_core.buildBrainstormEnsembleDispatchEnvelopes`, `imm_core.normalizePiBrainstormAgentResults`, and `imm_core.normalizeBrainstormEnsemblePacket`.

### Brainstorm Ensemble Advisory

A Brainstorm ensemble is optional advisory-only framing input, not a vote and not a child-owned decision. The default roles are clarify scope, divergent options, minimal solution, and risk review.

All Brainstorm ensemble children are advisory-only with `tool_policy: no tools`; they do not edit code, write Specs, write Plans, mutate workflow state, or close QA. The parent `imm-brainstorm` owns final framing synthesis, Brainstorm manifest IDs, and decision-delta confirmation. Final Spec and Plan authority stays with `imm-planner`. Routine Managed enrollment uses the current Host's native confirmation bound to the TaskIntent revision, content hash, and preparation digest as the single authority gate; Enrollment validates descriptor structure without executing acceptance descriptors, deterministic QA executes them after implementation, and the routine task proceeds without a second human stop. A later authority-gate failure stays fail-closed in the current Host and reports exactly one same-Host recovery action; Brainstorm must never recommend another Host, worktree, or unmanaged implementation as a fallback.

Pi's adapter may consume `brainstorm_ensemble` dispatch JSON to prepare advisory Pi subagent envelopes, but envelope construction is not child execution and does not transfer framing authority. Pi launches one foreground Agent at a time, consumes its direct result, and re-evaluates the remaining dispatch budget before launching another candidate. Runtime does not call any agent, poll or recover background work, mutate state, or own final Spec/Plan authority. Pi subagent children remain no-tools advisory candidates; the parent `imm-brainstorm` collects outputs before synthesis.

Agreement becomes framing evidence. Disagreement becomes decision criteria or an open `BR-Q-*`. strong-model blockers become explicit risks or verification requirements for the planner handoff. Small framing tasks do not fan out by default; use solo Brainstorm unless the task has elevated framing risk or an explicit ensemble request.

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

- Gate: The material frontier is empty; no required fact blocks the handoff; every material user decision is settled by a direct requirement, explicit answer, or adopted recommendation; and the result-only summary introduces no unconfirmed decision delta. **If any required clarification remains unanswered, you MUST NOT proceed to planning or suggest the next skill.** **If a decision delta is still unconfirmed, you MUST NOT proceed to planning, must not name a next skill, and should ask the user to confirm only that delta.**
- If gates pass: suggest `imm-planner` with a one-line reason.
- If gates are not met: state which questions or decision deltas remain open; do not name a next skill and wait for the user's answer.
