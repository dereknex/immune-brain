# Planning Artifact Retention

Plans and Specs are durable workflow evidence. Their paths may be referenced by
current documentation, tests, packaged material, State Ledger snapshots, release
records, or support investigations, so age and completion status alone do not
make them disposable.

## Default Policy

- Keep files under `docs/plans/` and `docs/specs/` at their existing paths by default.
- Keep the active Plan and its Spec in place while any State Ledger references them.
- Preserve historical files that document decisions, verification evidence, rejected scope, compatibility constraints, or incident context.
- Put reusable conclusions in `docs/solutions/`; do not treat a solution summary as permission to remove its source evidence.
- Use `docs/archives/` for consolidated historical summaries, not as an automatic destination for completed Plans or Specs.

## Move Or Delete Gate

Before moving or deleting a Plan or Spec, prove all of the following:

1. Repository references have been inventoried with `git grep` or an equivalent tracked-file search.
2. Tests, fixtures, package manifests, generated-output classifications, and release scripts do not depend on the path.
3. The current State Ledger and supported migration fixtures do not identify the path as active state.
4. Current documentation and support guidance do not use the file as decision or verification evidence.
5. Any retained durable conclusion has a canonical home and all current inbound links are updated.

If any check is uncertain, keep the file. Historical prose does not need rewriting
solely to use a newer path or term.

## Scope Discipline

Retention cleanup must be a bounded Plan with an explicit candidate list and a
copy-paste verification command. Do not combine bulk archival with runtime,
manifest, packaging, or schema changes. Git history is rollback support, not a
replacement for preserving links that remain part of the current repository.
