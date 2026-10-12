---
"immune-brain": minor
---

An enrolled task can now add a concrete sibling file to its scope without a native confirmation: `classifyIntentRevision` treats a scope that keeps every previous entry and adds only concrete files beside an existing concrete file as `compatible`, unless it touches a risk-floor path (Kernel, assurance, Claude Host authority, Pi extension), `docs/specs` or `docs/plans`. Both Hosts refuse that route when an added or anchoring entry is a directory in the worktree; list concrete files or widen with a glob entry, which is breaking. A revision is now judged against its next scope, so a worktree that already holds the added files no longer blocks it, while a changed path outside both scopes still refuses before any gate. The Review prompt names every path added this way, derived from Kernel history with no new TaskRecord field. Lane delegation still refuses a widening that is not compatible. ADR 0021 records the rule (#217).
