# IMMUNE.md - Immune-Brain Constitution

This project uses the Immune-Brain workflow when work needs managed authority.

## Route Selection

Repository-mutating requests use Managed Path by default. Users do not need to
name the route; the host applies the routing contract before selecting a Skill.

- An active Assurance projection, TaskIntent, TaskRecord, or reviewer follow-up
  resumes through `imm-loop` and keeps its existing authority.
- Read-only, explanation, review-only, Plan-only, and explicit no-modification
  requests stay host-native and do not enroll or create task authority.
- A materially ambiguous mutation goes to `imm-brainstorm` for clarification;
  a clear new mutation goes to `imm-planner`.
- Planner output is a candidate for later literal-user Enrollment. Generated
  artifacts are never enrolled unconditionally.
- Fast-Track remains Managed and preserves TaskIntent scope, Enrollment, QA,
  Review, authorization, and completion boundaries.
- A wholly absent bootstrap is initialized idempotently for Managed phases;
  complete state remains byte-stable, and partial or incompatible state fails
  closed before any write.

File count, local verifier count, ordinary retries, optional read-only advisors,
and unrelated dirty files do not change this route or authority boundary.

## Non-Mutating Host Path

- Keep read-only and explicit no-modification requests inside the ordinary host
  agent.
- Do not create a Spec, Plan, TaskIntent, TaskRecord, State Ledger, acceptance
  evidence, QA job, mandatory Review job, HANDOFF update, or Compounder gate.
- If a request becomes a mutation while work is in progress, stop before the
  next write and route it through `imm-planner`.

## Managed Path

- Files are the durable memory for Managed decisions and workflow authority.
- `imm-planner` creates the Spec and TaskIntent/Plan contract.
- The matching Kernel or legacy owner drives execution, QA, Review, and
  completion without switching to Direct.
- Work stays inside the active Managed boundary, and every authority mutation
  is recorded by its owning runtime.
- Roadmaps preserve deferred phases separately from the current executable
  slice.

## Confirmation Boundary

Request exact host confirmation for release/deployment or remote writes,
destructive or irreversible operations, Git history rewrite,
credential/secret/permission changes, authority discard, task stop, breaking
intent revision, and risk/policy overrides. Do not request confirmation for
ordinary local edits, local verification, Direct rework, scoped diff review, or
completion reporting.

## Project Artifacts

- `.imm/` stores Managed workflow authority and recovery state.
- `docs/specs/` stores Managed task specs.
- `docs/brainstorms/` stores clarified request framing when needed.
- `docs/plans/` stores Managed TaskIntent or legacy Plan artifacts.
- `docs/solutions/` stores evidence-backed reusable learnings when warranted.
