---
"immune-brain": major
---

Replace the multi-file JSON authority store with one SQLite database per
worktree (`.imm/state/kernel.sqlite`), and remove the retired file store, its
byte-CAS journals, the duplicate claim/tombstone/relocation writers and the
manual repair instructions that existed to reconcile them.

Enrollment, freeze, QA, Review, settlement and audit export now run as Kernel
transactions over that store; Git keeps sole ownership of code identity and
terminal audit evidence stays tracked under `.imm/audit/<task-id>/`.

Behavior that becomes simpler or stricter in the same release:

- A simple TaskIntent no longer needs a Spec, and freeze, rework and stop bind
  artifacts in place instead of relocating them into `archive/`.
- Delivery scope is an authorization envelope: new helpers and tests inside an
  approved directory need no revision, while staged work outside the envelope
  is rejected and each task's own dirt is preserved.
- Deterministic QA runs every descriptor in a disposable materialization of the
  frozen tree with isolated Git metadata, so a descriptor can no longer observe
  or contaminate the live worktree.
- Ordinary Review rework returns straight to execution. Only a recurring
  security boundary, or five effective rework rounds, pauses a task for a user
  decision, and a passing Review may carry non-blocking advisories that settle
  the task with the notes recorded on the attestation.

The legacy audit projection stays read-only and is scheduled for removal in the
next major release; migration of an existing workspace is explicit, claimless
and validated against a temporary database before publication.
