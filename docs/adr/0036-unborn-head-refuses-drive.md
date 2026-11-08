# Unborn HEAD refuses drive

Status: accepted; supersedes item 4 and the Enrollment precondition parts of items 2-3 of [ADR 0024](0024-git-integration-preference.md).

## Context

[ADR 0019](0019-explicit-run-entry-owns-enrollment.md) and [ADR 0024](0024-git-integration-preference.md) let Enrollment write the repository's first commit: an empty root commit for an unborn HEAD, plus a precondition commit carrying the TaskIntent and its bound Spec under `Git integration: auto`. Both existed because the in-place Enrollment committed the task's planning inputs before it recorded a Git base.

Drive-always-lanes S7 (#396) retired in-place Enrollment: a `drive` entry now starts at the user's HEAD and enrolls inside a Lane. A Lane needs a commit to branch from, so the empty root commit can no longer be made — and both the initialization and the precondition commit lost every production caller. An unborn HEAD therefore refused with `git_head_unreadable` without any decision behind it (#401).

## Decision

An unborn HEAD refuses `drive`. The Lane entry reads HEAD before any Git effect and rejects with the stable reason `enrollment requires a committed Git HEAD` and the recovery action "commit working changes and ensure a committed Git HEAD exists in the current Host". Nothing creates an empty root commit, stages on the user's behalf, or writes a ref, the index or a branch during that refusal.

Enrollment makes no commit in either Git integration mode. Inside the Lane the runtime stages the task's TaskIntent and the Spec its binding names — all tracking requires — and nothing commits them; the user's HEAD stays the task's Git base. `Git integration: auto` keeps only ADR 0024's settle commit.

The initialization and precondition-commit code is deleted rather than kept dark: `initializeEnrollmentGitBase`, `commitEnrollmentPreconditions`, `commitUnbornEnrollmentPreconditions` and their helpers. `inspectEnrollmentGitBase` remains as the read-only base check the Kernel and `imm-kernel intent validate` use.

## Consequences

- A fresh repository needs one commit by hand before its first `drive` entry. The refusal says so and the message costs one retry.
- The user's branch never gains a commit they did not write: every mode commits only the settled delivery under `auto`.
- ADR 0019's empty root commit is gone; its planning/implementation split is unaffected.

## Rejected

- Restore the behavior and have the Lane entry create the root commit under the native gate: the Lane cannot branch from a commit it has not made yet, so the write would move to the pre-Lane preflight — the one step the batch contract keeps free of Git effects.
- Keep the retired functions exported for tests: the test helper now mirrors the Lane instead, so the coverage pins production behavior.
