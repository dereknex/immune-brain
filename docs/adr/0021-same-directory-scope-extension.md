---
status: superseded by ADR-0028
---

# Same-Directory Scope Extension

Superseded by [ADR 0028](0028-scope-as-estimate.md). Scope is now an estimate;
the same-directory special rule is retired. The decision below is preserved as
historical context.

Accepted on 2026-10-12 by the repository owner (user decisions U2 and U3 in
`docs/specs/ceremony-trim-r647.spec.md`), for Issue #217. It revises one rule
of the Intent revision classifier that ADR 0018 builds on. ADR 0018 itself is
unchanged.

## Context

Every change to `scope_hint` was a breaking revision, so adding one sibling
file to an enrolled task opened a native confirmation. In the r647 session the
task needed a file next to ones it already owned, the confirmation carried no
information the user could act on, and the revision was first refused because
the worktree already held the file it added. The confirmation protects against
scope that grows into territory nobody agreed to. A file beside the files the
user already authorized is not that.

## Decision

1. **A same-directory addition is `compatible`.** `classifyIntentRevision`
   returns `compatible` for a scope that contains every previous entry and adds
   only entries that (a) are concrete files, with no `*` or `?`, (b) share a
   parent directory with a previous entry that is itself a concrete file, and
   (c) touch no path the project's risk floor names in `.imm/risk-floor.json`
   (ADR 0023), in either tier and either list. In this repository that is the
   Kernel, assurance, Claude Host authority and Pi extension prefixes plus
   `docs/specs` and `docs/plans`.
   There is no count limit. Every other scope change stays `breaking`: a
   removed entry, a glob, a new directory, an entry that swallows a previous
   one, any floor path, or any combination with another breaking field.
2. **The Host checks what the classifier cannot.** The classifier is pure and
   cannot tell a file from a directory written without a trailing slash. Before
   `revise_intent`, each Host refuses the compatible route when an added entry,
   or the previous entry that anchors it, is a directory in the worktree. The
   refusal names the way out: list concrete files, or widen with a glob entry
   such as `dir/**`, which classifies `breaking` and goes through
   `approve_breaking_intent_revision`. A bare directory entry has no gated
   route.
3. **The envelope is judged against the next scope.** While a revision is being
   prepared, the authorization-envelope check uses the next intent's scope. A
   changed path outside both the previous and the next scope still refuses
   before any gate, and a failed preparation restores the staged sidecar.
4. **Disclosure replaces confirmation.** The Kernel writes the added paths into
   the `revise_intent` history entry's `reason`; no TaskRecord field is added.
   Every Review prompt lists the paths added by compatible revisions of the
   task, derived from that history, and tells the reviewer to judge each
   against the goal and acceptance instead of treating it as approved.

## Relation to ADR 0018

ADR 0018 lets a batch coordinator approve a Lane child's breaking revision that
does not widen `scope_hint`. It is unchanged:

- A widening that is not compatible is still refused by `batch_delegation.ts`
  and falls back to the Executor's own native gate.
- A same-directory addition now reaches the Lane as `compatible`. It needs no
  approval, so nothing is delegated and `lane_revision` does not carry it.

## Consequences

- The common "one more file beside the ones I own" case no longer interrupts
  the user, and the Planner defaults ordinary scope to the smallest coherent
  module directory so it stays that case.
- The user gives up the per-file confirmation for these additions in exchange
  for Review-time disclosure. The paths the classifier already protects keep
  the confirmation: the paths the project's risk floor names (ADR 0023), which
  in this repository are the Kernel, assurance, Claude Host authority and Pi
  extension prefixes plus `docs/specs` and `docs/plans`. The floor names no migration, secret or security directory, so
  a file there beside an owned file is a same-directory addition; the Planner
  keeps such scope exact and Review sees every added path.
- A revision no longer fails merely because the worktree holds the files it
  adds, but a changed path outside both scopes still does.
