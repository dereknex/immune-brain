---
"immune-brain": minor
---

Add the `Git integration: manual|auto` preference, read from the tracked root `AGENTS.md` or `CLAUDE.md` (ADR 0024, superseding ADR 0023). The default `manual` writes no runtime commit outside batches: Enrollment stages its TaskIntent and Spec instead of committing them, unborn-HEAD in-scope changes are claimed as task work, and storage-layout migration leaves its diff in the working tree with the affected paths listed. `auto` keeps the precondition commits and, when a task settles done, commits exactly its settled scoped paths as `imm(<task-id>): settled delivery`. An invalid value behaves as `manual` with an `invalid_git_integration` status warning, and both Hosts' status Tools report the resolved mode as `git_integration`. The confirmed empty root commit for an unborn HEAD is unchanged.
