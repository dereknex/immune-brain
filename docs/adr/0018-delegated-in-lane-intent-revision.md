---
status: accepted
---

# Delegated In-Lane Intent Revision

Accepted on 2026-10-10 by the repository owner, for retro issues #194 and #198.
It revises one clause of ADR 0005 and one clause of ADR 0016. ADR 0013 (Lanes)
is unchanged.

## Context

A lane-mode batch is meant to run an Initiative with as little human
involvement as possible. In the #187 batch, the S2 Lane needed about 19
breaking Intent revisions. Each one opened a native confirmation in the Lane's
tab, the Lane sat `blocked` until the user went there to answer, and the
coordinator could only tell the user to go. Issue #193 removes most of those
revisions (an in-goal defect is rework, not a revision); this ADR handles the
rest.

The same batch then hit a second wall. S2's revised Intent entered the batch
branch with S2's integration, the plan digest of the batch no longer matched
the authorization, and provisioning S3 was refused with `plan_digest mismatch`.
Recovery followed ADR 0016: retire the batch as `superseded`, start a new one,
two more native confirmations and one retired record.

Three accepted decisions stood in the way:

- ADR 0005 rejected a "batch-scoped authority record": a batch is one coverage
  decision, never a tier above the enrolled TaskIntent.
- ADR 0016, clause 6: "No new authority tier."
- #178: breaking revisions go through the existing native gate, and a
  `plan_digest` change fails closed.

## Decision

1. **One opt-in grant, inside the batch confirmation.** When a lane-mode batch
   is confirmed, the same native gate offers one extra choice: let the batch
   coordinator approve a Lane child's breaking Intent revisions that stay
   inside the child's originally authorized TaskIntent. It is off by default.
   A batch confirmed without it behaves exactly as before. The grant is
   recorded on that batch's own record (`revision_delegation`), bound to that
   batch id and that confirmation time.
2. **Bounds.** A delegated revision may change acceptance items, may narrow
   `scope_hint`, and must raise the revision. It may not widen `scope_hint`
   beyond the child's TaskIntent as authorized for the batch, change risk,
   goal, owner, task id, the bound Spec reference, or any other field. Host
   trust, sign-in and permission dialogs are never covered. Anything outside
   the bounds is refused with a stable reason and falls back to the
   Executor's ordinary `approve_breaking_intent_revision` native gate, which
   the user answers in person.
3. **A Kernel operation, not keystrokes.** The coordinator submits the revision
   as `lane_revision` on `start_unattended_batch`. The runtime checks the grant
   and the bounds and then applies the ordinary Kernel
   `approve_breaking_intent_revision` in the Lane's Authority Store with user
   authority whose actor is `batch-coordinator` and whose confirmation
   reference is `delegated-batch:<batch_id>@<confirmation_time>`. The audit
   history therefore tells a delegated approval apart from an approval by the
   user in person (`literal-user`, a Host confirmation reference) and traces it
   to the specific batch authorization. The batch record lists every applied
   revision in `delegated_revisions`. Nobody answers a dialog in a tab.
4. **Expiry.** The grant is read only from the batch record that carries it and
   only while that batch is running. A terminal, retired (`superseded`) or
   parked record applies no revision, and a later batch has a grant only if its
   own confirmation granted one.
5. **Reseal at integration (#198).** A revision approved under the grant is a
   fact inside the scope of the batch authorization. When that child is
   integrated and its integrated TaskIntent equals the last delegated revision
   recorded for it, the runner replaces that child's identity in the batch's
   recorded intent identities, recomputes `plan_digest`, and records the digest
   before and after in `reseals`. Later children continue under the same
   authorization. Already integrated commits, their commit evidence and their
   lineage are untouched.
6. **Everything else still fails closed.** A revision the user approved in
   person, an Intent edited on the coordinator side, or a record written before
   this ADR (no recorded intent identities) is not resealed: the plan digest
   still changes, `plan_changed` still refuses, and ADR 0016's retirement path
   is unchanged.

## Revised Clauses

- **ADR 0005, rejected "batch-scoped authority record".** Still rejected as a
  tier: the grant adds no authority of its own. It is the literal user's
  answer in the batch gate, scoped to revisions of already-authorized children
  that cannot leave those children's authorized envelope. The record that
  carries it is the same orchestration record ADR 0005 already allows; it now
  also holds the user's recorded answer.
- **ADR 0016, clause 6, "No new authority tier".** The disposition still adds
  none. This ADR adds no tier either, but it does let one literal-user act
  cover a bounded class of later revision approvals. That is the deliberate
  change, and it is opt-in per batch.
- **#178, "a `plan_digest` change continues to fail closed".** Narrowed to every
  change not produced by a delegated revision recorded on the same batch.

## Consequences

- A lane batch whose Executors stay inside their envelopes runs to completion
  without the user visiting Lane tabs for revisions.
- The user's single batch confirmation carries more weight, so the gate states
  the grant and its bounds explicitly, and declining it is the default.
- Revisions that grow scope or risk still stop for the user, as they should.

## Rejected Alternatives

- **The coordinator answers the Lane's native dialog.** Sending keys to a tab
  impersonates the user and leaves an audit record that claims a literal-user
  approval. Rejected.
- **Raising or removing the breaking-revision gate in Lane mode.** Loses the
  distinction between in-envelope and envelope-growing revisions.
- **Auto-superseding a drifted batch at preflight** (ADR 0016's rejected
  alternative). Still rejected: the reseal accepts only revisions the batch's
  own grant produced and never retires anything.
