# Stale Batch Disposition

Decision record: [ADR 0016](../adr/0016-stale-batch-disposition.md) (accepted).

This spec covers one recovery: a batch record the plan moved past. It does not
change how a batch starts (ADR 0005) or how lanes run (ADR 0013).

## Scope

- `superseded` as a terminal batch state in `runtime/unattended/batch_state.ts`.
- `runtime/unattended/batch_disposition.ts`: the Host-independent disposition.
- `retire_stale_batch` in both Hosts (Pi Tool, Claude MCP operation).
- Two new keys in the frozen reason table (`stale_batch_absent`,
  `stale_batch_in_flight`) and a drift refusal that names the disposition.
- A terminal report for a retired record, serial and lane shapes.

## Invariants

1. **Retiring is not settling.** A retirement writes `batch_state:
   "superseded"`, `updated_at`, and one report. Every child, state, commit,
   lane binding, recorded commit, `plan_digest`, `base_head`, and the original
   `confirmation_time` stay unchanged. The report's reason states that no batch
   trailer and no approval were granted.
2. **Terminal means settled.** A superseded record no longer matches
   `findExistingActiveBatch`, so a new batch for the Initiative may start, and
   it joins the lineage `findSettledBatchRecord` already permits a later run to
   reuse.
3. **A mid-flight child blocks the disposition.** `enrolled`, `settled`,
   `lane_admitted`, and `lane_committed` children belong to live Kernel runs.
   The operation refuses before the gate and names the child.
4. **The confirmation binds the record it described.** After the gate the record
   is re-read and must be byte-identical to the projection the user saw; a
   record that moved is refused with `plan_changed`.
5. **No new authority.** No capability is created or consumed, and no
   TaskRecord, attestation, claim, or Intent is touched. A non-interactive Host
   is refused exactly as it is for `start_unattended_batch`.
6. **The state owner stays the single validator.** A superseded record with a
   mid-flight child is invalid state, so the writer refuses it; the disposition
   cannot park a live child under a terminal batch.

## Both Hosts

- Pi registers `retire_stale_batch` beside `start_unattended_batch`, with one
  required `initiative_slug`. It renders the native dialog from the projected
  facts and returns the outcome, the rejection envelope, or nothing on decline.
- Claude exposes `unattended_batch` operation `retire_stale_batch`, gated by the
  same interactive-only rule, and renders the facts through the same
  confirmation port the start operation uses.
- Decline and cancel arrive as the Host's own envelope
  (`confirmation_declined` / `confirmation_cancelled`) and write nothing.

## Non-goals

- Automating the disposition from a preflight refusal, or from the runner.
- Retiring a batch with a mid-flight child.
- Any change to what a batch authorization grants, or to child settlement.
