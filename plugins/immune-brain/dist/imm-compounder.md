---
name: imm-compounder
description: Use when capturing learnings.
---

# Immune-Brain: Compounder

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Workflow Profiles

Run only from an explicit runtime `complete` checkpoint whose
`compounder_requirement.required` is true. Strict Plans and Plans declaring
`Compounder: required` preserve the existing handoff. Standard optional Plans
require Compounder after at least two completed review follow-ups or when the
current changed-file surface includes `docs/solutions/` or `CONTEXT.md`.
Otherwise the final review gate atomically finishes and this skill is skipped.
The host must not infer another trigger or invoke Compounder automatically.

## Core Responsibilities

- **Learning Capture**: Extract reusable guidance from finished work and update `docs/solutions/`.
- **Memory Maintenance**: Refresh `.imm/memory/MEMORY.md` after learning capture.
- **Evidence-Backed**: Preserve only evidence-backed lessons, not broad claims.
- **Debate & Evidence Critique**: Before storing a reusable lesson, challenge whether it is true, reusable, and worth adding to the knowledge base.

## Workflow Rules

- **Closure Complete**: Compounder runs only after workflow closure and assurance are already complete. Do not mutate workflow phase or completion state, and do not invoke retired v3 mutation commands or a missing dispatcher. There is no separate dehydration step: historical State Ledger overflow is already archived. Capture learnings from the closed work.
- **Compound Debt Backfill**: The legacy `.imm/imm-compound-debt.py` command has been retired. When asked to inspect or backfill historical missed compound work, inspect the `.imm/memory/current_iteration_history.jsonl` history archive the runtime writes when it trims the Ledger, plus recent closed plans/specs for bounded high-confidence candidates, then compound only candidates with enough repo-local evidence for a durable `docs/solutions/` entry.
- **Periodic Failure-Mode Review**: When a recurring automation asks for a weekly or periodic Immune-Brain review, inspect available conversation history, task logs, `.imm/memory/`, recent plans/specs, workspace diffs, and installation/runtime health signals for repeated failure modes before recommending changes. Include PATH-resolved wrapper drift, plugin-local runtime parity, and CLI fallback status when recent evidence mentions stale wrappers, install issues, or runtime mismatch. Prefer narrowly scoped skill-contract or documentation edits only when the same problem appears in at least two evidence sources; otherwise report the proposed patch and the missing evidence. Always update the automation memory with the reviewed window, decisions, files touched, and blocked sources.
- **Dispatch Efficiency Reporting**: Before reporting dispatch metrics, read `.imm/memory/dispatch_telemetry.jsonl` when it exists and derive `dispatch_efficiency` from recorded dispatch outcomes. Treat a missing telemetry file as "no dispatch telemetry recorded", not as evidence that dispatch was unused.
- **Subagent Scorecard Consumption**: When `.imm/memory/subagent_scorecard.jsonl` exists or the completed work produced scorecard entries, use `imm_core.subagent_scorecard.summarize_scorecard_for_compounder` to report role-level result value, adopted/rejected/deferred/duplicate finding counts, degraded dispatch reasons, and downstream routing effects. Treat missing scorecard data as `insufficient_evidence`, not as support for a shared registry or generic dispatcher.
- **Durable Storage**: Store durable knowledge in `docs/solutions/` only when reusability is high or medium.
- **Thematic Append-First**: Before creating a new standalone solution file, check the theme hubs `docs/solutions/workflow.md`, `docs/solutions/contracts.md`, `docs/solutions/infra.md`, and `docs/solutions/architecture.md`. Append the learning to the best-fitting hub when the premise naturally belongs there; create a new file only when no hub can hold it without blurring the theme.
- **Debate & Evidence Critique**: Run a critical-editor pass before writing durable guidance. Record `reusability_critique_notes` covering falsifiability (what would make this lesson false or too local), evidence trail audit (which tests, benchmarks, review evidence, or artifacts actually support it), and architecture entropy resistance (why this should append to an existing hub or justify a new file without duplicating ADRs or patterns).
- **Reuse Tags**: Use explicit reuse tags: `reusability: high|medium|low` and `next_reuse_scenarios`.
- **Discovery Indexing**: Add or backfill `key_files` frontmatter on every created or touched solution file, listing the most useful repo paths future agents should read first. Keep the list short and evidence-backed; include directories only when the whole directory is the navigation target.
- **Architecture Map Sync**: When a captured learning changes durable navigation knowledge, update root `CONTEXT.md` `## Architecture Map`; when no map update is needed, record that in the compounder notes so future agents do not infer it was skipped accidentally. A `superseded` decision that changes navigation knowledge triggers the same sync.
- **Rejected Decisions**: When extracting learnings from completed work, if a design alternative was explicitly considered during brainstorm or planning but rejected, record it in `docs/solutions/` with `rejected: true` frontmatter plus the rejection reason. When closure evidence supports concrete future triggers, add optional `reconsider_if` as a YAML `list<string>`; use the list form even for one condition, and treat each item as an independently sufficient trigger (OR semantics). If several facts must all hold, write them as one complete condition string. Never invent a reconsideration condition: omit `reconsider_if` when evidence cannot support one. Existing rejected Learning files without the field remain valid and require no bulk backfill. This prevents future brainstorm or planning sessions from re-litigating the same rejected approach.
- **Superseded Decisions**: When a previously adopted decision is replaced by a new one, retire the old decision in place rather than deleting it silently. Add frontmatter `status: superseded`, `superseded_by: <path-to-current-doc>`, `retired_at: <date>`, and `reason: <one-line why superseded>`. This keeps agents from reading stale decisions as current fact. Low-value pure-process docs (old plans, progress logs) need no superseded record — delete them and rely on Git history. `superseded` is a parallel state to `rejected`: `rejected` = never adopted, `superseded` = adopted then replaced.
- **ADR Suggestions**: When a completed step involved an architectural decision, evaluate whether it meets all three ADR criteria: (1) hard to reverse — changing later has meaningful cost, (2) surprising without context — a future reader would wonder why, (3) result of a real trade-off — genuine alternatives existed. If all three are met, suggest writing a `docs/adr/NNNN-slug.md` with a minimal format: title paragraph covering context plus decision plus reasoning. Optional sections (Status, Considered Options, Consequences) only when they add genuine value. Create the `docs/adr/` directory lazily on first ADR.

## Boundary

- **Allowed**: same shared baseline, plus write evidence-backed learnings and refresh `.imm/memory/MEMORY.md` after closure.
- **Blocked**: same shared baseline, plus implementation/test edits, and unsupported generalizations.
- **Workflow guard**: only compound after work is closed; route implementation back to `imm-work`.

## Output artifact

`learning_capture` including: `solution_doc_path`, `reusable_premise`, `evidence`, `key_files`, `reusability_critique_notes`, `architecture_map_update`, and `memory_index_update`. Treat the learning-capture fields as traceability metadata.

Optional dispatch metrics (when subagent dispatch occurred during the completed work): `dispatch_count` (total subagent dispatches in this iteration), `solo_fallback_count` (how many fell back to solo), `fallback_reasons` (distribution of reason codes), and `dispatch_efficiency` derived from `.imm/memory/dispatch_telemetry.jsonl`. These fields are informational — they help future iterations tighten or relax catalog triggers based on observed dispatch effectiveness.

Optional scorecard summary (when scorecard entries exist or the run explicitly evaluated subagent result value): `role_value` (per-role result value), `degraded_dispatch_reasons`, `routing_effects`, and `shared_registry_review.status`. `shared_registry_review.status` must be `insufficient_evidence` unless scorecard evidence from three or more workflow roles backs a review. Do not route shared registry work from prose impressions alone.

Optional periodic review summary (when invoked by a recurring review automation): `failure_mode_review` including `review_window`, `evidence_sources`, `top_repeated_failures`, `recommended_skill_changes`, `patches_made_or_proposed`, `verification`, `blocked_sources`, and `automation_memory_update`.

## Next Action

Next Action: specify next skill, reason, and user confirmation needs.

## Output style

Default user-facing shape: what reusable pattern was captured, where it was written, and what future work should reuse it.
