---
status: accepted
---

# Stale Batch Disposition

Accepted when the recovery for the stale `parallel-batch-lanes` batch landed.
It adds one authority-backed operation, `retire_stale_batch`, beside
`start_unattended_batch`. Nothing in ADR 0005 or ADR 0013 changes: a batch
starts through one gate and runs through one authorization.

## Context

`start_unattended_batch` binds one plan digest and one Git lineage for the whole
batch (ADR 0005). A child that needs an Intent Revision mid-batch changes the
plan, and the batch can then neither continue nor reconfirm:

- `projectBatchPreflight` refuses with `plan_changed` and reports that the old
  authorization cannot execute the revised plan.
- The batch record, its report, its commit evidence, and its audit stay intact,
  and the refusal explicitly does not terminate the old batch.
- `findExistingActiveBatch` keeps matching the record, so no new batch for the
  Initiative can start either.

That is correct for the running batch and dead-ends the workspace. On
2026-08-18 the stale `parallel-batch-lanes` batch reached exactly this state:
S1 and S2 were committed by the batch, S3 was mid-flight, S4 and S5 had never
run. The only exits were editing `.imm/state/batches/<batch-id>.json` by hand or
deleting it. The first corrupts the Authority Store's own evidence, and the
second destroys the record of what the batch actually delivered.

Three facts shape the decision:

- The record is durable evidence, not scratch state. Terminal records survive
  (`.imm/audit/<task>/task-record.json` plus the batch report under
  `.imm/state/batches/`), and `findSettledBatchRecord` already lets a later run
  reuse a terminal record's branch and lineage.
- A batch authorization is a fact about a plan and a lineage. Once the plan
  moved, that authorization is spent; keeping it "active" grants nothing and
  blocks everything.
- The disposition is not a settlement. Retiring a record says nothing about the
  children it never ran, and must not look like it does.

## Decision

1. **`superseded` is a new terminal batch state.** `isTerminalBatchState` covers
   it, so a retired record is settled: it stops blocking a new batch and joins
   the lineage a later run may reuse. `BATCH_RUN_STATES` is exported so the
   preflight derives its accepted-state set from the state owner instead of
   keeping a second list that would read a retired record as corrupt.

2. **`retire_stale_batch` retires the Initiative's active record through one
   literal-user gate.** It reads the newest non-terminal record, projects a
   confirmation fact (batch id, state, plan digest, branch, base HEAD, recorded
   commits, every child with its lane binding), and asks the Host. The gate is
   the same native confirmation port `start_unattended_batch` uses; a Host that
   cannot reach it returns its own rejection and writes nothing.

3. **The retirement preserves everything and claims nothing.** It rewrites only
   `batch_state` to `superseded` and `updated_at`, through the state owner's
   atomic CAS, and writes one terminal report whose reason states that the
   disposition preserves evidence and grants no batch trailer and no approval.
   Every child, state, commit, lane binding, recorded commit, `plan_digest`,
   `base_head`, and the old `confirmation_time` stay byte-identical. A lane
   record retires to a lane report with empty handoffs. A retired record with a
   mid-flight child is invalid state, so the writer refuses it rather than
   parking a live child under a terminal batch.

4. **A mid-flight child blocks the disposition.** `enrolled`, `settled`,
   `lane_admitted`, and `lane_committed` children belong to live Kernel runs.
   The operation refuses with `stale_batch_in_flight` naming the child and
   directing the operator to settle or stop it through its own task first. A
   decline or a cancel is the Host's own envelope and writes nothing.

5. **The confirmation is consumed by the record it described.** After the gate
   the operation re-reads the record and requires the identical bytes; a record
   that moved (state, children, or lineage) is refused with `plan_changed`
   rather than retired from a stale projection. This is the same adopt-before-
   mutate rule the batch runner uses.

6. **No new authority tier.** The disposition consumes no capability, creates no
   capability, and touches no TaskRecord, attestation, or claim. It is one
   literal-user decision about the batch's own state file, which is what ADR
   0005's rejected "batch-scoped authority record" would have been. A
   non-interactive Host cannot reach it, exactly as it cannot start a batch.

## Consequences

- The stale-batch dead end is gone: an operator retires the record, and a fresh
  `start_unattended_batch` for the same Initiative starts on the current plan,
  reusing the lineage a settled record already permits.
- The evidence of what the stale batch delivered stays readable, including the
  lane bindings of children that never integrated.
- Operators must not read a retirement as progress. It terminates nothing about
  the children it never ran, and the report says so.
- A workspace whose batch record is mid-flight still needs the child settled
  first; the disposition does not become a way to abandon live work.

## Rejected Alternatives

- **Auto-superseding a drifted record during preflight.** A preflight must write
  nothing before a literal user approves anything, including on decline or
  rejection, and a refusal that retires the record would let any read-only
  command retire a batch.
- **Letting the runner retire the record when it detects the drift.** The drift
  is detected before execution, and a runner-side retirement would be authority
  without a user decision.
- **Deleting or hand-editing the record.** Both destroy evidence the Authority
  Store is required to keep; this ADR exists because that was the only exit.
- **Reusing `start_unattended_batch` for the disposition.** One Tool per
  authority act: starting a batch and retiring one are different decisions, and
  the start path's capability flow has no branch that retires anything.
