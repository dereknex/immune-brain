# Pi batch acceptance runbook

How to run an unattended batch from a Pi session and decide whether it actually completed. Commands in `sh` blocks are executed against a real fixture by `tests/pi-batch-acceptance-integration.test.ts`; replace `<placeholders>` with your values.

## What counts as evidence

| Source | Establishes | Does not establish |
|---|---|---|
| `tests/pi-batch-acceptance-integration.test.ts` | The registered `start_unattended_batch` Tool, real Kernel ownership, real QA in a delivery materialization, settlement/export and runner commits behave as described below. | Which build your session loaded; independent Review (every fixture child is `routine`); native Host dialogs (the test answers them through a seam). |
| A live Pi session | The loaded build, the native gate, and foreground Review for `material` children. | Nothing beyond the batch you observed. |

A green test run is never a live observation. Report the two separately.

## Before starting

1. Confirm the loaded build. Call `imm_kernel_canary` with `{ op: "status" }` for any task and compare `plugin_version` with `version` in `package.json`. A newer version on disk proves nothing about the session; restart the session if they differ.
2. Start from a clean tree on the branch the batch will commit to:

```sh
git status --porcelain --untracked-files=all
```

Empty output is required. Record the current HEAD as `<base-head>`.

## Run the batch

1. Call `start_unattended_batch` with the Initiative slug. Confirm the native gate once.
2. The return is `state: "started"` with `report.handoff` naming one enrolled child (`role: "executor"`, `next_obligation: "submit_assurance"`). No QA has run and nothing is committed yet.
3. Implement that child and stage its scoped paths by name.
4. Call `imm_kernel_canary` `{ op: "advance_assurance" }` for the child. A `material` child returns `review_ready`: run the Reviewer and `submit_review` before touching any file, because edits invalidate the frozen snapshot.
5. When the result is `state: "completed"` with `lifecycle: "done"`, the Kernel has exported the terminal evidence pair as untracked files. Stage it; the runner refuses untracked bytes (`working tree has unstaged or untracked changes`):

```sh
git add .imm/audit/<task-id>
```

6. Call `start_unattended_batch` again with the same slug. While the authorization is live this opens no gate. The runner makes exactly one commit for the settled child and hands off the next one. Repeat from step 3.

Calling the Tool again while a child is still enrolled is safe: it returns the same handoff and performs no Enrollment, gate, QA run or commit.

A committed child's `reason` reads `crash after settlement; resuming at commit` on this normal path. It is not a failure signal.

Make no commit on the batch branch yourself. The runner binds to HEAD and stops when it moves.

## Repair a failed check

`advance_assurance` returns `state: "rework"` with `recovery.finding_ids`. Until each finding is disposed, the child stays enrolled, `start_unattended_batch` returns the same `recovery`, and a further `advance_assurance` is refused with `Kernel requires resolve_findings`.

1. Fix and stage the bytes.
2. Dispose each listed finding by its exact id: `{ op: "resolve_finding", finding_id }`, or an evidence-bound `refute_finding`.
3. Run a fresh `advance_assurance`, then continue from step 5 above. The batch id and earlier commits are unchanged.

## After an interruption

Summaries are not authority. After a restart or compaction, call `status` for the child named in the last handoff and act on its `next_obligation` (`submit_assurance`, `resolve_findings`, …). Calling `start_unattended_batch` again returns the current handoff or recovery without repeating work.

## Renewal

A confirmed batch does not expire. While it is still running on the same plan, branch and HEAD lineage, `start_unattended_batch` continues it with no gate, however long the child sat in foreground Review. The dialog itself has no time limit either: it waits until you answer or the caller cancels.

A new native gate opens only when something no longer binds: the batch is parked for a human, the plan digest changed, the branch changed, or HEAD left the recorded lineage.

- Decline, cancel, or a HEAD that moved while the dialog was open: the call is refused and the batch state, commits, index and enrolled child are unchanged. Retry through a fresh gate.
- Confirm: the same batch id continues; earlier commits and the enrolled child's run are kept, and later continuations open no further gate.

## Decide whether the batch completed

Completion has four separate dimensions. Check each; one does not imply the next.

| Dimension | Check |
|---|---|
| Implemented | The child's scoped changes are staged. |
| Settled | `advance_assurance` returned `completed`, `lifecycle: "done"`, and `.imm/audit/<task-id>/<run-id>/` exists. |
| Committed | The runner's report lists a commit for the child, and the branch has exactly one commit per child, in order: |

```sh
git log --format=%H <base-head>..HEAD
```

| Dimension | Check |
|---|---|
| Batch-reported | The final return has `report.batch_state: "completed"` and the verifier agrees: |

```sh
bun scripts/verify-batch-completion.ts --batch-id <batch-id> --json
```

Run it from the repository root. It only reads.

| Exit | Meaning |
|---|---|
| 0 | `complete: true`: state, report, terminal evidence and commits are mutually consistent. |
| 1 | Evidence is readable but contradictory; `code` names the mismatch (for example `lineage_mismatch`, `scope_mismatch`, `stopped_lifecycle`). |
| 2 | Invalid input or unreadable evidence. A batch that is still running reports `malformed_report` here, because the report file is written only at a terminal batch state. |

Anything other than exit 0 means the batch is not complete. A child settled or committed outside the runner leaves the batch `running` or `failed` even when the work itself is merged.
