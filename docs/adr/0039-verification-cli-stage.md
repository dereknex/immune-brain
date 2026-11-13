---
status: accepted
---

# Findings Verification as a CLI Stage

**Status update:** this ADR amends [ADR 0037](0037-authority-review-cli-stage.md)
Decision 9, which kept findings verification on its Host subagent. It keeps
[ADR 0017](0017-receipt-bound-review-verdict-submission.md)'s receipt binding
unchanged: the verifier's output bytes are read twice and must agree before they
count. Source: #426 S3, decided 2026-11-11.

## Context

ADR 0037 moved the authority Review to a CLI process the Parent runs, so the
Review's verdict is a file a later step reads. Findings verification (#284), the
step that may refute a Review's blocking findings, stayed an in-process Host
subagent. #426 S3 wants that verifier in a supervised session the user can
watch, and #426 S4 already runs the Review script in one; but a subagent is not
a process, so there was nothing to put in a session. The verifier also always
ran on the reviewer's own model under CLI Review: the CLI receipt offered no
other model, so #284 D1 (a different model whenever one is available) could not
hold.

## Decision

1. **A verification after a CLI Review is a CLI process.**
   `CliReviewHost.prepareVerification` writes the verifier prompt (the
   `review-verifier` role contract and the verification packet) to a packet file
   and a script that runs one fresh, read-only print session of the same
   reviewer Host, in the same working directory, on the selected verifier model.
   The script is the Review's: output under a temporary name, exit status last.
   `verification_ready` carries `verification_command`; the Parent runs it and
   calls `submit_verification` without a result.
2. **Receipt and release.** `inspectVerification` keeps the reservation while no
   exit file exists (`verification result pending`), releases with no receipt on
   a non-zero exit or empty output, and otherwise returns the output bytes as the
   receipt. The coordinator's existing binding applies: the two reads must agree,
   the model must be the one selected, and invalid or unbound output keeps every
   finding (`dispatch_failed`, `receipt_mismatch`, `malformed_output`).
   Verification never weakens Review.
3. **Verifier model.** `lanes.review_verifier_model` (a `review_*` key, so it
   follows `review_host`'s layer) is offered by the Review receipt; the
   coordinator's selection then picks it whenever it differs from the reviewer
   model, so the relation is recorded `different`. Without it the verifier runs
   on the reviewer's model and the relation is `same`, as before.
4. **Tools.** On Claude Code the verifier keeps the
   `immune-brain-review-verifier` boundary: `Read, Grep, Glob, Bash` with only
   read-only Git subcommands allowed. Pi and Antigravity run their print session
   under the user's own configuration, as their reviewers do.
5. **Session transport (#426 S3).** With `lanes.review_transport: herdr` the
   command runs through `imm-session run --provider herdr` in a tab labelled
   `verify <task_id>`, exactly as the Review does (ADR 0038 addendum). The
   completion signal is the script's exit status, never an agent state.
6. **Scope.** A verification that follows no CLI Review (the `subagent` rollback
   value of `IMMUNE_BRAIN_REVIEW_DISPATCH`) keeps its Host subagent through
   `agent_params`. Whether verification runs at all is still
   `review_verifier` (`off` by default) and remains #284's decision.

## Consequences

- `HostReviewReservation` gains `verification_command`; `VerificationReadyResult`
  gains it too. The Kernel, the attestation contract and the history facts are
  unchanged: a CLI verifier records `verifier_actor` `cli-verifier:<host>:<op>`.
- No tree guard is taken for verification: the verifier reads the immutable
  revision named in its packet through Git, not the working tree.
- Tests: `tests/cli-review-dispatch.test.ts` "verification CLI stage" (bound
  receipt, pending while running, failed process keeps findings, a configured
  verifier model is used, fallback to the wrapped Host) and the S3 case under
  "review transport (#426 S4)".
