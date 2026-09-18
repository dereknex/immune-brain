---
status: accepted
---

# Frozen Readers for Pre-v4 Terminal Evidence

## Context

`ADR-0010` moved workflow authority into one SQLite store per worktree, and
`close-taskrecord-v3-drain-window` narrowed the live `TaskRecord` union to v4
alone. That left a question the cutover had promised to answer: the repository
still tracks 150 settled task records under `.imm/audit/`, and 79 of them are
pre-v4 (70 `task_record/v2`, 9 `task_record/v3`). The planned closing slice,
`imm-kernel migrate --to-vNext`, would flatten every historical record into
"pure v4-shaped JSON that no versioned parser is needed to read", publish a
receipt, and gate this version's startup on a marker that the migration wrote.

Before writing any of it, the transformation was measured against the live
parser on this repository's own corpus. Projecting each pre-v4 record onto the
v4 shape — carrying `intent_snapshot` through verbatim, mapping `phase` to
`lifecycle`/`artifact_state`, `approvals` to `attestations`, and `from_phase`/
`to_phase` to `from_state`/`to_state` — left **5 of 79** records acceptable to
`parseTaskRecord`. The other 74 are blocked by rules that did not exist when
those tasks settled:

- 91 attestations whose `acceptance_results` do not cover every acceptance id
  (full coverage became a requirement later);
- 65 review attestations with no `review_revision`, the Git binding v4 demands;
- 6 records whose stored `intent_ref.content_hash` no longer matches their own
  embedded snapshot.

Each blocker is closed only by inventing a QA result, a Review revision, or an
intent binding for a task that already reached terminal state. `.imm/audit/` is
tracked terminal evidence — the same material the Kernel exports so an audit
pair is the durable copy of a settlement — so rewriting it in place would put
the repository's own authority history out of step with the commits, Reviews and
Issue projections that record those settlements.

## Decision

Terminal evidence is immutable. Pre-v4 records are read through the frozen
parsers that `close-taskrecord-v3-drain-window` shipped —
`kernel/legacy_task_record.ts`, reached by the fallbacks in
`storage.ts:readAuditTaskPair`, `sqlite_migration.ts:readLegacyTasks` and
`verifyCandidateStore` — and that is the permanent design, not a transitional
shim needing an exit.

`imm-kernel migrate --to-vNext` is not built. There is no vNext receipt, no
`store_meta` marker, and no startup gate on evidence shape; the slice was
stopped by a literal-user decision with zero deliverables, and the measurement
above is recorded on its stop commit.

Reading historical records does not require a versioned parser for *live*
authority: the frozen module exists only to decode bytes that were authored
under older contracts, exactly as Git history is read with the format rules of
its time. A future need to read a new old-shape field is met by adding a reader
to that frozen module, never by rewriting a settled record.

## Alternatives rejected

- **Flatten with fabricated fields.** Filling `review_revision`,
  `acceptance_results` coverage, or a recomputed `intent_ref.content_hash` would
  make 74 records parse and would be a lie about what those tasks verified.
- **Flatten and discard.** Emitting a v4 envelope with `attestations: []` and
  the old `evidence`/`approvals` dropped produces a parseable file while
  deleting the provenance that makes the record worth keeping.
- **A "verify and mark only" migration** — inventory, preserve bytes, write a
  receipt and marker, rewrite nothing. This ships a state flag no reader
  consults, plus a mandatory operator step and a startup gate that can only
  refuse. It buys ceremony, not simplification.
- **Move pre-v4 evidence out of Git** so the readers can go away. The audit pair
  is the durable export of a settlement; untracking it removes the evidence the
  Kernel relies on to classify a task as terminal.
