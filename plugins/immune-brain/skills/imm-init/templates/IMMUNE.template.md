# IMMUNE.md - Immune-Brain Constitution

This project uses the Immune-Brain workflow when work needs managed authority.

## Route Selection

Direct Path is the default when no Managed trigger applies. The ordinary host
agent implements and verifies the requested local change without creating
workflow state.

Use Managed Path only when one of these triggers applies:

- a nonterminal Plan, TaskIntent, TaskRecord, or reviewer follow-up already owns
  the work;
- the user explicitly requests planning, audit, independent closure, or Managed
  execution;
- the task touches security, credentials, permissions, public API/schema or
  compatibility, persistence/migration, concurrency/recovery,
  release/deployment/external writes, destructive or irreversible effects,
  authority discard, or risk override;
- multiple independently owned domains cannot close as one coherent outcome;
- material ownership or risk uncertainty remains after one minimal question or
  bounded read-only probe.

Multiple files, multiple local verifier commands, ordinary retries, optional
read-only advisors, and unrelated dirty files do not independently select
Managed.

## Direct Path

- Keep changes inside the user's requested scope and leave unrelated changes
  untouched.
- Run reproducible task-scoped verification and inspect the stable task-owned
  diff before reporting completion.
- Do not create a Spec, Plan, TaskIntent, TaskRecord, State Ledger, acceptance
  evidence, QA job, mandatory Review job, HANDOFF update, or Compounder gate.
- If discovery reveals a Managed trigger, stop further mutation and route to
  Managed before continuing.

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
