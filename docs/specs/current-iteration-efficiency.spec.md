# Spec: Current Iteration Efficiency

## Status: R1 and R2 hold, R3 is withdrawn

R1 holds — `imm-finish` writes the intentional idle marker. R2 was regressed by
the TypeScript port and is restored as of 2026-08-01: `writeStateLedgerAtomic`
trims `history` to `HISTORY_TAIL_LIMIT` and appends the overflow to
`.imm/memory/current_iteration_history.jsonl` before writing. Compaction sits at
that level because `commitStateMutation` has twelve call sites and
`saveStateLedger` has one, so a bound placed higher would miss almost every
write. Existing oversized Ledgers compact on their next write.

R3 is withdrawn. It existed to keep the `state.json` snapshot small, but R2
already bounds the Ledger that snapshot would copy, so the size problem it
addressed no longer exists. What remained was durability, and the Ledger is
tracked in Git, which covers accidental loss without a second in-repo copy.
Reviving the snapshot would also revive the restore path R1 had to gate after it
replayed a plan that `imm-finish` had intentionally reset.

`imm-dehydrate` is therefore retired rather than repaired. With compaction on
every write it had no remaining job, and it was not merely a no-op: it passed
`buildStatus(state)` and `captureStateCommitExpectation(state)` as sibling
arguments, and since `buildStatus` mutates in place and arguments evaluate left
to right, the expectation described the mutated state. Whenever `buildStatus`
would change a derived field the command died with an uncaught `State Ledger
changed before commit.`; it survived only where the stored derived fields already
agreed, such as immediately after a normal step-closing sequence. The one test
that exercised it asserted exactly that error under a concurrent-write hook, so
it could not tell a correct stale-commit rejection from an unconditional crash.
`.imm/memory/state.json` is deleted;
`.imm/memory/current_iteration_history.jsonl` stays, and is live again as the R2
archive target.

## Background

`.imm/memory/current_iteration.json` is the active State Ledger for the current
workflow. It is not intended to be a long-lived archive. Recent analysis showed
that the file was about 128KB, with roughly 121KB coming from accumulated
`history` records. The current `state.json.current_iteration` snapshot can also
copy that large payload and later restore a completed plan after `finish` has
reset the active runtime state.

The previous recovery slice intentionally restored an accidentally emptied
`current_iteration.json` from `state.json.current_iteration`. That recovery
remains useful, but it needs to distinguish accidental loss from an intentional
finish reset.

## Requirements

### R1. Intentional finish reset is not auto-recovered

- A successful `imm-finish` reset must leave a recognizable idle marker in
  `current_iteration.json`.
- `load_current_iteration_state` must not restore `state.json.current_iteration`
  when the canonical state is an intentional idle reset.
- The existing accidental-empty recovery behavior must remain available for
  unmarked empty states with a valid in-project `state.json.current_iteration`.

### R2. Hot State Ledger history is bounded

- `current_iteration.json` should keep a small recent history tail instead of
  carrying the entire cross-plan audit trail.
- Older history entries must be written to a filesystem archive such as
  `.imm/memory/current_iteration_history.jsonl`.
- The archive must preserve enough data to audit action, timestamp, details,
  and plan context without introducing a database or second authority.

### R3. Durable snapshots stay lightweight

- `imm-dehydrate` should write a compact `state.json.current_iteration` snapshot
  using the same bounded-history behavior as the active State Ledger.
- Rehydrate output must still have enough state to show active step context when
  a step is active.
- Closed-step evidence dehydration remains intact.

### R4. Packaged runtime parity is preserved

- Runtime changes must be mirrored into the packaged Immune-Brain plugin runtime
  where applicable.
- Regression coverage should prevent repo runtime and packaged runtime from
  drifting for the touched files.

## Non-Goals

- No SQLite, FTS, wiki plane, or external memory store.
- No broad rewrite of the State Ledger state machine.
- No manual history rewrite of existing completed work.
- No change to `imm-plan --sync` ownership of plan-level runtime state.
- No atomic-write redesign in this slice.

## Acceptance Criteria

- `python3 -m unittest tests.test_current_iteration_state tests.test_workflow_loop`
  passes with coverage for intentional reset versus accidental-empty recovery.
- A State Ledger with more than the configured history tail writes older entries
  to the history archive and persists only the recent tail in
  `current_iteration.json`.
- `state.json.current_iteration` no longer stores an unbounded history payload.
- `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts`
  passes after packaged runtime parity is updated.
