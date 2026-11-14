---
status: accepted
---

# Authority Review as a Review-Profile CLI Stage

**Amended:** Decision 9 by [ADR 0039](0039-verification-cli-stage.md): findings
verification after a CLI Review is now a CLI process as well.

**Status update:** this ADR partially supersedes
[ADR 0006](0006-unattended-review-dispatch-authority.md) (its rejected
alternative "the runtime invokes the reviewer model" is not the shape here, but
the primary Review is no longer an in-process Agent dispatch),
[ADR 0017](0017-receipt-bound-review-verdict-submission.md) (the observed
subagent receipt no longer carries the primary Review; findings verification
keeps it) and [ADR 0030](0030-marker-keyed-review-dispatch.md) (its
marker-keyed Agent-dispatch binding applies to findings verification only).
Those ADRs gain a status note pointing here.

**Amendment (tri-host capability alignment S7):** Decision 4 is amended by
[ADR 0039](0039-host-capability-profiles.md) and Spec
`docs/specs/tri-host-capability-alignment.spec.md` D8/D9 (which supersedes
`review-cli-stage` D9 by explicit reference). Pi reviewer argv adds
`--no-extensions --no-skills --no-mcp`, an explicit existing absolute
`authority-review/SKILL.md` path, and narrowed tools
`--tools read,grep,find,ls,bash`. Residual risks are explicitly disclosed: Pi
Bash arguments cannot be restricted to Git; Antigravity `agy --print` lacks CLI
restriction flags and shell-less native roles cannot perform immutable-Git
checks; tree guard covers tracked files but untracked files are uncovered.
Neither CLI is preventively read-only, native Antigravity Review is not
certified, and both remain `guard-only` on port P5 while `review_host: antigravity`
remains supported.

Accepted by the repository owner for Issue #386 through the decisions recorded
in `docs/specs/review-cli-stage.spec.md` (BR-REQ-1..7, BR-DEC-1..6, BR-SCN-1/2).
It records Slices S1-S3 of that Spec; Slice S4 retires what is left of the
subagent Review path.

## Context

The Kernel requires a Review verdict for `material` and `critical` tasks, and
the Parent dispatches that reviewer as a foreground Agent. The verdict reaches
settlement as the bytes a Host adapter observed at that dispatch
(ADR 0017), correlated by a reserved prompt marker (ADR 0030).

That shape has two costs the Initiative set out to remove. The reviewer's model
and reasoning settings come from the Parent Host's Agent configuration rather
than from the project, so a project cannot choose a different reviewer; and the
dispatch path needs a reserved prompt, a marker, a packet handle and per-Host
observation code before any review happens. A reviewer that runs as a separate
process can be selected by the project and observed by its own output bytes.

## Decision

1. **Review profile.** `lanes` gains `review_host` (`pi` | `claude-code` |
   `antigravity`), `review_model` and `review_effort`, resolved with the
   existing active-profile → project precedence. `chooseReviewer(resolvedLanes)`
   returns `{ host, model?, effort? }` or `null`. No model-distinctness rule:
   a profile may set the same model for executor and reviewer.
2. **Parent launches, runtime prepares.** On `review_ready` the runtime writes
   the packet, a POSIX `sh` script that runs the reviewer CLI in the task's
   working directory, and the output pair. The result carries `review_command`
   (`sh <script>`) and `review_profile` instead of `agent_params`. The script
   writes stdout under a temporary name and the exit status last, so a present
   exit file marks a complete output.
3. **Receipt and release.** `submit_review` without a verdict applies the
   process's output bytes; a relayed verdict must fingerprint-match them. A
   missing exit file retains the reservation. A non-zero exit, empty output, a
   contract-mismatch line or a changed reviewed tree releases it without a
   Review round. A valid verdict keeps the existing REVISE/PASS,
   `review_incomplete` and round-budget mechanics.
4. **Reviewer invocation (amended by ADR 0039 and Spec tri-host-capability-alignment D8/D9, superseding review-cli-stage D9).**
   Each Host gets one argv:
   - `claude --print` with a read-only tool allowlist (`Read,Grep,Glob,Bash`),
     `--allowedTools` restricted to immutable git commands (`git show:*`,
     `git diff:*`, `git log:*`, `git cat-file:*`, `git rev-parse:*`,
     `git ls-tree:*`), `--permission-mode dontAsk`, and no session persistence.
   - `pi --print --no-session` with `--no-extensions --no-skills --no-mcp`, an
     explicit existing absolute `authority-review/SKILL.md` path (`--skill <path>`),
     and narrowed tools `--tools read,grep,find,ls,bash`. Pi Bash arguments
     cannot be restricted to Git.
   - `agy --print` with no CLI restriction flags (Antigravity provides no CLI
     flags to restrict tools or permissions).
   Each ends with the skill invocation on the packet. The executable is
   resolved from `PATH`; an absent binary fails reservation with
   `review_host_unavailable`.
5. **Tree guard.** Reservation records `git rev-parse HEAD`, the sha256 of
   `git ls-files -s` and the sha256 of `git diff --binary HEAD`.
   `inspectReview` recomputes them before reading the output and releases with
   `review_tree_changed` plus the changed paths on any mismatch. Untracked files
   are outside the guard. The reviewer process is trusted to return a verdict,
   not to stay read-only.
6. **Missing profile fails closed.** With CLI dispatch active and no
   `review_host`, Review preparation returns `review_preparation_failed` with
   `review_profile_required` and one recovery action. QA settlement is retained.
   Routine tasks never reach Review and never consult the profile.
7. **Composition and switch.** `CliReviewHost` is a Host-neutral
   `AssuranceHostPort` in `runtime/assurance/cli_review.ts`. It owns Review
   preparation and release, delegates `prepareVerification` and
   `inspectVerification` unchanged, and the three composition roots select it
   from one internal value read from `IMMUNE_BRAIN_REVIEW_DISPATCH`
   (`subagent` | `cli`). CLI is the default; `subagent` is the rollback value
   until S4 deletes the switch. It is not a user configuration key.
8. **Packaged skill.** `plugins/immune-brain/skills/authority-review/SKILL.md`
   is generated from the `code-review` role prompt and the static review rules —
   the inputs of `currentReviewContractHash()` — and stamps that hash. A
   reviewer reads the packet it was given and, when the packet's
   `review_contract_hash` differs from its own, replies exactly
   `REVIEW_CONTRACT_MISMATCH <own hash>` and stops. The mismatch line is
   self-reported: a reviewer without a matching install produces either that
   line or output that is not a valid verdict, and both release without a Review
   round.
9. **Unchanged.** Findings verification (`verification_ready` →
   `submit_verification`) keeps its Host subagent dispatch and the
   receipt-bound observation of ADR 0017. Advisory review, `dispatch_role`
   `ui-review` and QA are untouched.

Contracts describe the CLI stage: `drive.md` step 3 and its Review section,
`drive-batch.md` (a Lane Review runs in the Lane's tree before integration;
PASS gates integration, REVISE returns to the Lane executor) and the authority
Review parts of `docs/reference/subagent-dispatch-protocol.md`.

## Consequences

- A project can choose the reviewer's Host, model and effort independently of
  its executor, and the reviewer is a fresh process with no Parent
  conversation.
- The Parent must have the configured executable on `PATH` and must wait for a
  process instead of an Agent result. A long review is run in the background
  when the shell tool would time out.
- Review authority no longer depends on a Host's Agent-observation hook for the
  primary Review; it depends on the output bytes and the tree guard. A reviewer
  that writes tracked content is detected after the fact, not prevented.
- Residual risks (amended by tri-host capability alignment D8/D9):
  - Pi Bash arguments cannot be restricted to Git; `--tools read,grep,find,ls,bash`
    narrows privilege but does not prevent arbitrary shell commands.
  - Antigravity `agy --print` has no CLI restriction flags, and shell-less
    native roles cannot perform immutable-Git checks.
  - The tree guard compares HEAD, the index, and tracked worktree content;
    untracked files are uncovered.
  - Neither CLI is preventively read-only, and native Antigravity Review is not
    certified. Both Pi and Antigravity remain `guard-only` on port P5, while
    `review_host: antigravity` remains supported.
- Until S4 lands, two dispatch paths exist behind one internal switch, and the
  in-process path's tests select `subagent` explicitly.
- The rollback is flipping the default back to `subagent`; S4 is the
  irreversible slice and lands after S3 has run real Reviews.
