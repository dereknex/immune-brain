---
name: imm-pr-fix
description: Use when fixing PRs.
---

# Immune-Brain: PR Repairer

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Core Responsibilities

- **Blocker Resolution**: Read GitHub PR, remote checks, and review threads to resolve blockers (conflicts, feedback, CI failures).
- **Minimal Repair**: Keep changes focused on the named blocker. Avoid unrelated features or refactors.
- **Feedback Closeout**: Resolve or reply to handled feedback and push the repair branch.

## Workflow Rules

- **Target Discovery**: Accept PR URL/number/branch. If missing, read the current local branch and use it as the lookup key for PR discovery. Treat current-branch discovery as incomplete until remote GitHub metadata confirms the PR target. Do not start repair work from current-branch discovery alone. Stop if ambiguous (e.g., detached HEAD, zero PR matches, multiple PR, or unavailable GitHub metadata).
- **Remote First**: Read PR page/API before editing. Prefer `gh pr view`, `gh pr checks`, etc.
- **Script-First Diagnosis**: After target discovery, run `imm-pr-diag <PR>` to collect a structured snapshot of CI checks, review feedbacks, and merge conflicts. Use this snapshot as the single source of truth for blocker classification. Do not start repair work until the diagnostic snapshot is available. If the script is unavailable, fall back to manual `gh pr view` / `gh pr checks` collection and structure the results identically.
- **Conflict File Uncertainty**: Treat `diagnostic_snapshot.conflicts.conflicting_files_status: "unknown"` as an explicit uncertainty boundary. Do not use changed PR files as a proxy for conflicting files; inspect the merge state locally or with GitHub metadata before assigning conflict repair files.
- **Conflict Resolution**: Keep business intent, avoid unrelated edits, and mark ambiguities as follow-up notes.
- **Check Repair**: Fix only files in the failing path. Include minimal reproduction path and validation command.
- **Validation**: Re-run project checks and PR-related conflict checks. Compare local HEAD against PR head expectation before push.

## Boundary

- **Allowed**: same shared baseline, plus inspect PR context, edit blocker-related files, push repair branch, and close feedback.
- **Blocked**: same shared baseline, plus unrelated cleanup, new features, silent plan-scope changes, and unresolved ambiguity.
- **Workflow guard**: keep changes tied to named PR blocker; route broader issues back to `imm-code-review` or `imm-planner`.

## Dispatch Protocol

Follow [`docs/reference/subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md) for the full dispatch lifecycle. This section defines imm-pr-fix-specific dispatch behavior.

**Environment detection (Phase 1):** Check whether the current runtime supports subagent dispatch and branched workspaces. If unavailable, use solo fallback (`unavailable_environment`) and repair all blocker categories inline.

**Blocker classification (Phase 2):** From `imm-pr-diag` output, classify blockers into shards: `check_repair` (CI failures), `feedback_repair` (review threads), `conflict_repair` (merge conflicts). Only dispatch when ≥2 independent blocker categories exist; when only 1 category exists, repair solo. File-level partition: no two shards should write the same file. If file overlap exists between shards, merge those shards into one. If conflict files are unknown, keep `conflict_repair` solo or merge it with any shard that must inspect the same merge surface.

**Prompt construction (Phase 3):** Build one `shared_context_summary` covering the PR target, full diagnostic snapshot, and repo context. Build one `focus_delta` per shard: specific blockers assigned, affected files, repair scope, `tool_policy: write — shard-scoped files only`.

**Dispatch invocation (Phase 4):** Use Pi native `Agent` subagents with `isolation: worktree` for independent shards. Dispatch independent shards in one parallel tool call, with a maximum of 3 concurrent shards. State each shard's owned files explicitly and tell every worker that other agents may be editing the codebase and it must not revert their changes.

**Result synthesis (Phase 5):** Collect repair results from branched workspaces. Merge file changes back into the repair branch. Detect cross-shard conflicts and resolve manually if found. Run unified validation: re-run project checks, verify PR merge status, confirm feedback threads handled. Compare local HEAD against PR head expectation before push.

**Exception handling (Phase 6):** Retry once per shard on failure. On second failure, fall back to solo repair for that shard. Record which shards succeeded, failed, or fell back.

## Output artifact

`repair_report` including: `PR target`, `diagnostic_snapshot` (reference to imm-pr-diag output), `handled blockers`, `feedback status`, `dispatch_summary` (which shards dispatched vs. solo, per-shard outcome), `push result`, `validation results`, and `remaining risk`.

## Next Action

Next Action: specify next skill, reason, and user confirmation needs.

## Output style

Default user-facing shape: `Outcome -> Blockers handled -> Validation / next step`. Lead with what was repaired or what remains blocked.
