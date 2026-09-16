---
status: accepted
---

# SQLite Workflow Authority

## Context

Kernel authority used to live in many small JSON files under `.imm/state/`:
one TaskRecord per task, a workspace-ownership file, claim files, terminal
tombstones, transaction markers, a byte-CAS journal and archived planning copies
written by an artifact relocation step. Every authority transition therefore had
to fence several files at once, and correctness depended on byte-level SHA-256
comparisons of their raw bytes. An unrelated write — a formatter, a Git index
refresh, an editor newline — changed those bytes, and the store failed closed
with `expected record hash mismatch` in a state that needed manual repair. The
integration suite paid for that design too: concurrent task operations could only
be serialized by an external lock around a group of files.

`node:sqlite` is available in the supported host runtimes, so the transaction
machinery the design needed already ships with the platform.

## Decision

Authority lives in one SQLite database per worktree, `.imm/state/kernel.sqlite`,
opened under a store lock. A run row owns its TaskRecord, claim state, run
identity, committed operation results, pending relocations and terminal proof;
every Kernel mutation is one transaction with compare-and-swap on the revision it
read. Terminal settlement and audit export are idempotent, and an interrupted
export can never reactivate a settled run.

Git keeps sole ownership of code identity: TaskIntent and Spec content hashes,
the scoped delivery revision and the reviewed revision are Git object
identities. The database stores intent and delivery identity, never a second copy
of the code.

Terminal audit evidence stays tracked under `.imm/audit/<task-id>/`; the database
and its WAL/SHM siblings and backups stay Git-ignored.

Consequences accepted with the change:

- The retired file store is deleted rather than supported in parallel: no dual
  writes, no byte-CAS journal, no duplicate claim, tombstone or relocation
  writers. `runtime/kernel/legacy_audit.ts` remains the only reader of historical
  v3 State Ledger artifacts, is read-only, and is scheduled for removal in the
  next major release.
- Migration is explicit and claimless: it refuses to run with active tasks or a
  recoverable batch, imports raw historical facts into a temporary database,
  verifies counts, identities and digests, fsyncs, and publishes atomically.
  A failed publication retries through the recorded import identity. Restoring a
  backup requires every accessor stopped and revalidates the worktree binding;
  a restored database does not restore live host capabilities.
- Rollback after new writes must not overwrite the database with an old backup;
  recover by forward repair or an explicitly designed recovery. A pre-write
  rollback with the previous binary stays available while nothing has been
  written.
- Old binaries reject a newer schema instead of guessing, and new binaries
  diagnose a legacy layout without migrating on their own.

## Alternatives rejected

- **One JSON file with atomic replacement.** Keeps the byte-identity problem for
  every reader and still needs an external lock for concurrent tasks.
- **Git refs as authority.** Git would then own both code and workflow state, and
  a branch operation could rewrite or drop authority.
- **Keeping both stores during a transition.** Two writers over one workspace
  cannot be reconciled deterministically, and divergence is discovered only at
  settlement.
