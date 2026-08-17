# Pocock-Inspired Improvements for Immune-Brain

## Origin

Brainstorm: deep study of mattpocock/skills repo (72k stars) identifying 7 improvement directions for the Immune-Brain system. User confirmed all 7 in scope, CONTEXT.md at repo root, fast-track threshold at ≤2 steps.

## Accepted Behaviors

### 1. CONTEXT.md — Shared Domain Language

- A `CONTEXT.md` file at the repo root defines the project's domain vocabulary (terms, relationships, flagged ambiguities).
- `imm-brainstorm` Workflow Rules reference CONTEXT.md: when the user uses vague or conflicting domain terms, brainstorm surfaces the conflict and proposes a canonical term. If CONTEXT.md does not exist, create it lazily on first resolved term.
- `imm-planner` Planning Rules reference CONTEXT.md: step descriptions, result lines, and verification paths use domain vocabulary from CONTEXT.md when available.

### 2. Feedback Loop / Verification Quality

- `imm-planner` step schema gains an optional `verification_type` annotation: `automated` | `hitl` | `manual`.
- `imm-qa` Workflow Rules: when a step's verification is `manual`, QA flags it as technical debt and recommends the executor add an automated regression guard in a follow-up step or record the gap in docs/solutions/.

### 3. Prototype Step Type

- `imm-planner` Planning Rules support an optional `prototype` flag on steps. A prototype step produces a throwaway artifact whose output is a recorded decision (ADR or docs/solutions/ entry), not production code.
- `imm-executor` Workflow Rules: when executing a prototype step, skip test-first discipline; the artifact is throwaway. Capture the answer before deleting the prototype.

### 4. Fast-Track for Small Tasks (≤2 steps)

- `imm-work` Workflow Rules gain a fast-track path: when the validated plan has ≤2 steps and all steps have automated verification, `imm-work` can drive plan→execute→QA within a single interaction turn without requiring the user to explicitly invoke each skill transition.
- Fast-track does not bypass evidence recording or QA judgment — it compresses the ceremony.

### 5. Handoff Document

- `imm-work` Workflow Rules: after each step completion (QA pass), auto-update a `HANDOFF.md` in the repo root with human-readable current state: plan progress, last completed step, next step, known blockers.
- HANDOFF.md is a convenience artifact for cross-session continuity; it does not replace `.imm/memory/` as the source of truth.

### 6. Rejected Decisions Record

- `imm-compounder` Workflow Rules: when extracting learnings, if a decision was explicitly rejected during brainstorm or planning, record it in docs/solutions/ with a `rejected: true` frontmatter tag plus the rejection reason.
- `imm-brainstorm` Workflow Rules: before framing, scan docs/solutions/ for `rejected: true` entries to avoid re-litigating previously rejected approaches.

### 7. Lightweight ADR Mechanism

- `imm-compounder` Workflow Rules: when a completed step involved an architectural decision that is hard-to-reverse, surprising-without-context, and the result of a real trade-off (all three criteria), suggest writing a `docs/adr/NNNN-slug.md` instead of or in addition to a docs/solutions/ learning.
- ADR format is minimal: title paragraph with context, decision, and why. Optional sections only when they add value.

## Out of Scope

- Converting Immune-Brain to Pocock's loose-coupling model (different problem scales).
- Issue tracker integration (triage/to-issues are project management, not IMM's domain).
- Writing/content-creation skills (fragments/beats/shape).
- Changes to `.imm/` Python tooling (imm-plan.py, imm-work.py, etc.) — all changes are skill text only.
