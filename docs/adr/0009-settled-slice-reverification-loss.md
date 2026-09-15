---
status: accepted
---

# Settled-Slice Re-verification Loss

## Context

A TaskIntent's acceptance descriptors bind the runner that verified them:
`runtime/assurance/verification.ts` reads the frozen runner and
`assertRunnerCompatible` rejects a descriptor whose `runner_version` differs from
the host's, with `frozen runner version mismatch: ... assurance unavailable`. A
frozen snapshot is therefore only re-verifiable on the runner version it was
frozen against.

`52e0619` moved the project to bun `1.4.2`, forced by Homebrew removing the
`1.3.14` Cellar path the frozen QA runner resolved to, and updated every
still-candidate TaskIntent's `runner_version` to match. Three TaskIntents had
already settled and keep `1.3.14` in their frozen descriptors:

- `wc-host-neutral-contract-tool-names` (acceptance `HTN-1`–`HTN-3`),
- `wc-behavioral-guardrails` (`GRD-1`–`GRD-3`),
- `wc-batch-resume-single-gate` (`RSM-1`–`RSM-4`).

Their reverification now fails on the runner check before any descriptor runs,
and nothing in the settlement path can re-open a settled TaskRecord to rebind it.

## Decision

1. **Accept the loss as permanent for those three Slices.** Their frozen
   descriptors keep the `1.3.14` they were verified under, and their
   re-verification stays unavailable for the life of the repository. The
   decision of record here is that this is a cost of keeping frozen evidence
   honest, not a defect to repair.
2. **Re-verification protection for settled Slices going forward belongs to
   `main`'s standing test suite, not to a re-openable frozen artifact.** The
   behaviour a settled Slice delivered is kept alive by the repository's tests
   and CI gates — the same suite every later change must pass — so protecting it
   never requires replaying a historical descriptor on a historical runner.
3. **No code changes implement this decision.** A new Slice binds the runner
   version its QA actually ran on, and a runner move only rebinds descriptors
   that have not settled yet.

## Rejected Alternatives

- **Rewriting the frozen descriptors' `runner_version` to `1.4.2`.** The frozen
  descriptor is the record of what ran; editing it would claim verification on a
  runner that never executed those assertions.
- **Re-verifying them under a substituted or emulated runner.** Same claim, with
  extra machinery: provenance would be unverifiable from Host events.
- **Making `assertRunnerCompatible` version-agnostic.** It exists to reject
  exactly this: a verdict attributed to a runner that did not run it. Relaxing it
  would trade an auditable evidence boundary for tidier re-runs.

## Consequences

- Three settled Slices can never be re-verified, and any future reader must read
  their `1.3.14` descriptors as historical evidence rather than as a
  reproducible check.
- The double-verification a running settlement performs stays available for
  active work, so a runner move rebinds every Slice that has not yet settled.
- Regression protection for shipped behaviour is asserted where it can actually
  fail: by `main`'s standing tests, which are a precondition of every later
  change rather than a historical replay.
