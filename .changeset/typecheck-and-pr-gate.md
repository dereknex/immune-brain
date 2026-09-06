---
"immune-brain": patch
---

Typecheck the repository and gate every pull request

Four host-adapter defects reached published plugins in a row. The systemic cause
was not any one of them: this repository had never been type checked, and no
check ran before a merge.

There was no `tsconfig.json`, no `tsc` invocation anywhere, and TypeScript was
not even a dependency. Turning the compiler on reported 59 errors in the runtime
and script sources, 17 of them (36%) in `runtime/claude/kernel_ports.ts` and
`runtime/claude/review_host.ts` — the two files that produced three of the four
escapes. The compiler was already pointing at the shipped defect family:
`'{ review_revision?: … }' is not assignable to 'TaskApprovalV2'` and
`Property 'git_base_head' does not exist on type 'TaskRecord'`.

All 59 are fixed, none by widening to `any`. The substantive ones:

- The Claude approval literal was untyped, so `kind` widened to `string` and
  every check on `review_revision` — the exact field family that shipped broken
  four times — was disabled. It is now a declared `TaskApprovalV2`.
- Reading `git_base_head` off a `TaskRecord` union tested the contract string
  into a plain boolean, which does not narrow. Adds `isTaskRecordV4`, and both
  host adapters now prove the field is present before binding a revision.
- `runtime/claude/review_host.ts` matched a reservation on `sessionId` and
  `agentId`, which `PendingReview` never declared; every check was inert and the
  function had no callers. Removed.
- `commitEnrollmentLocked` was declared as returning a v2 record while returning
  a v4 one, and `JournalReasonCode` was missing the 13 codes the Kernel CLI
  actually emits.
- A `TaskTombstone` could be written with `terminal_lifecycle: "active"`, which
  its own contract forbids; settlement now refuses a nonterminal record.
- `failCanaryTool` could not report `review_preparation_failed`, a declared
  `ToolFailureV1` state and a documented Loop recovery path.
- `notifyOnce` was called through a coordinator port that supplies no UI.

Closes the type-level hole behind the last escape: `ReviewRevision.manifest_digest`
was optional, so a host returning the bare commit identity still satisfied
`ensureReviewRevision`. The bare identity is now a separate
`ReviewRevisionCommit`, and omitting the digest fails the build instead of every
v4 submission at runtime. Deletes the unused `ensureReviewRevision` export that
defined the loose shape.

Makes the production port wiring reachable from tests. `ClaudeRuntime.kernelPorts()`
returns the object the coordinator actually runs on, and its `ports` option now
layers overrides on top of it rather than replacing it wholesale; the Pi ports
move out of an anonymous default export into
`createPiAssuranceProgressionPorts`. Every escaped defect lived in these two
objects, and neither was constructible from a test.

Adds `.github/workflows/ci.yml` on `pull_request`, running typecheck, the
plugin build and doc sync checks, versioning validation and `bun test`. Adds
`bun run typecheck` and wires it into `verify:release`.
