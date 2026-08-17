# Spec: Doc-hygiene curation capability for Immune-Brain

## Summary

Immune-Brain can plan, execute, review, QA, and compound engineering work, but it
has no first-class way to curate documentation that accumulates over long
iteration. Repos drift into hundreds of mixed docs — authoritative, active,
historical, runtime traces, scratch, obsolete. This spec adds a read-only
doc-hygiene sweep to `docs-verifier`, backed by a shared doc-lifecycle taxonomy
reference, plus a stale-decision retirement convention in `imm-compounder`.
Actual file moves and deletes stay outside the advisory boundary: they are
applied by `imm-executor` or a normal agent after a dry-run and user
confirmation, preserving the advisory/execution invariant.

## Problem

- `docs-verifier` today only checks docs-vs-code consistency on a bounded delta;
  it cannot inventory or classify a whole doc tree.
- There is no shared vocabulary for doc lifecycle, so agents cannot consistently
  separate "current fact" from "historical evidence" or "runtime trace".
- Expired decisions have only a partial convention: `imm-compounder` records
  `rejected: true`, but there is no `superseded` / `obsolete` retirement path.
- Nothing routes "this doc is a delete or archive candidate" through a safe,
  git-reversible, confirmation-gated path.

## Goals

- Add a read-only doc-hygiene sweep mode to `docs-verifier`: inventory, lifecycle
  classification, dry-run cleanup candidates, and broken-link / scratch /
  runtime-trace findings.
- Introduce a shared reference doc `docs/reference/doc-lifecycle-hygiene.md`
  defining the lifecycle classes and the cleanup safety protocol.
- Extend `imm-compounder` with a stale-decision retirement convention
  (`status: superseded` + `superseded_by`, or `status: obsolete`) alongside the
  existing `rejected: true` convention.
- Keep all file moves and deletes outside advisory skills; document the safe
  apply path: dry-run, confirm, `imm-executor` or normal agent, re-audit.

## Non-goals

- No new skill (no `docs-curator`); enhance existing skills only.
- No write authority added to `docs-verifier`; it stays read-only.
- No `imm-docs-audit` CLI in this slice (deferred).
- No cleanup performed on any target repository such as `refine` or
  `nextty.dev`; they are analysis samples only.
- No mandatory routing through `imm-planner` / `imm-work` for routine doc cleanup.

## Lifecycle taxonomy (canonical)

- `current`: authoritative fact; must stay navigable.
- `active`: in-flight task material; archive, delete, or compound after closure.
- `historical`: kept as evidence; not current truth.
- `runtime_trace`: `.imm/` and `.planning/` run artifacts; not a knowledge base.
- `scratch`: temporary; merge, delete, or archive.
- `obsolete`: expired or misleading; delete or mark superseded.
- `decision`: reusable decision; route to `docs/solutions/` or an ADR.

## Accepted behavior

### docs-verifier hygiene sweep

- Explicit trigger only (for example "doc hygiene sweep", "docs cleanup
  inventory", or a periodic review request).
- Produces a read-only report: classified inventory, delete candidates, archive
  candidates, decision candidates, broken or misleading links, root-level scratch
  docs, and a runtime-trace listing.
- Emits dry-run suggested actions and performs no file mutation. Explicitly
  routes execution to `imm-executor` or a normal agent after user confirmation,
  and offers a re-audit after apply.
- References `doc-lifecycle-hygiene.md` for class definitions and safety rules.

### doc-lifecycle-hygiene reference

- Defines the seven lifecycle classes and how each is handled.
- States the cleanup safety protocol: dry-run first; low-value process docs are
  delete-safe because git history is the recovery path; misleading-but-historical
  docs are archived or marked `superseded`; rejected approaches keep a minimal
  record; deletion or move is a trust-boundary action requiring confirmation.

### compounder decision retirement

- Extends the "Rejected Decisions" rule: when a prior decision is expired, record
  `status: superseded` + `superseded_by: <path>` (or `status: obsolete`) with a
  reason, alongside the existing `rejected: true` convention.
- The hygiene sweep's `decision_candidates` route to `imm-compounder`.

## Compatibility

- Markdown and manifest-only changes; no runtime, State Ledger, or test-behavior
  changes.
- No new skill directory, so the skill-registry and host-manifest consistency
  contracts are unaffected.
- The new packaged reference mirror is registered in
  `scripts/dist-sync-manifest.ts` and kept byte-identical by
  `bun scripts/sync-dist-docs.ts`.

## Verification expectations

- `bun scripts/sync-dist-docs.ts --check` reports no drift.
- `bun test` (repo root and plugin) stays green, including
  `dist-docs-sync-contract`, `skill-registry-consistency`, and
  `host-manifest-consistency`.
- `dist/docs-verifier.md` describes the hygiene sweep, references
  `doc-lifecycle-hygiene.md`, and still states it is read-only with no file
  mutation (boundary preserved).
- `doc-lifecycle-hygiene.md` defines all seven lifecycle classes and the safety
  protocol.
- `dist/imm-compounder.md` documents `superseded_by` / `obsolete` alongside
  `rejected: true`.
