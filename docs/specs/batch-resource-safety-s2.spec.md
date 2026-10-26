# Batch resource safety — S2: retain Lanes without trusted exit evidence

**Status**: Candidate, user-approved option A; no execution authority.
**Design risk**: High — destructive resource lifecycle, interruption recovery and completion reporting span shared runtime paths.
**Execution posture**: characterization-first; preserve observable safety with regression tests before changing shared logic.
**Design views**: interfaces, state transitions and temporal recovery.
**Document language**: English, following Planner's default document policy.

## Outcome and approved reduction

S2 of Initiative `batch-resource-safety` prevents automatic Lane deletion and destructive redo when Executor exit cannot be independently established, preserves unknown ignored files, and reports retained resources and blocked recovery. S1 lands first and supplies admission ownership protection.

The user explicitly selected option A after learning that neither batch Host adapter owns Executor process handles. Therefore this slice does **not** promise safe automatic deletion/recreation after exit. Both current production Hosts lack that evidence: retain the Lane even if a caller says `idle`, `done`, or `stopped`, or the Kernel has settled. Destructive redo may remain paused. This is a deliberate safety/automation tradeoff, not an undisclosed incomplete implementation.

No new Host lifecycle protocol, process registry, model-reported deletion permission, broad terminal routing change, intent-revision change, or privileged automatic cleanup is included. Temporary detached Parent verification worktrees are not Executor Lanes and retain their existing bounded lifecycle.

## Sources

- U1: The user confirmed the two-slice `batch-resource-safety` decomposition and S1 → S2 ordering.
- U2: The user chose option A in this session: fail closed without trustworthy exit evidence, preserve unknown ignored files, and defer restoration of automation with an owner and explicit exit conditions.
- E1: `runtime/unattended/batch_lanes.ts:1294–1309` deletes clean integrated Parent Lanes without process evidence; `:1057` invokes destructive `recreateLaneWorktree` for redo. All runtime paths here are under `plugins/immune-brain/`.
- E2: `runtime/unattended/batch_worktrees.ts:60–95,122–135` deletes/recreates Lanes, including the missing-path branch-deletion recovery; Git status does not enumerate ignored files. `withParentWorktree` is a separate disposable verification lifecycle.
- E3: `.pi-extension/imm-unattended-batch.ts` and `runtime/claude/kernel_ports.ts` pass `lane_instruction` through; `runtime/claude/mcp_server.ts` exposes caller-reported session status. None owns an Executor process handle. `dist/imm-run-batch.md` keeps tab/pane identity in Parent supervision instructions, not runtime records.
- E4: `runtime/unattended/batch_lanes.ts:903–910,1360–1389` already distinguishes integrated from released and allows completion with integrated children. `batch_runner.ts:23–52` rebuilds completed reports and can otherwise lose per-tick cleanup diagnostics.
- E5: `runtime/unattended/batch_state.ts` has `lane_refusals`, existing child reasons and `next_action`; no new persisted field is required for a conservative observation. ADR 0029 prohibits changing persisted meaning without a contract bump.
- E6: `dist/imm-run-batch.md`, `runtime/prompts/lane-steward.md`, its packaged mirror, `CONTEXT.md`, and ADR 0027 contain lifecycle statements that need scoped alignment. `scripts/dist-sync-manifest.ts` declares prompt mirrors; `scripts/build-claude-plugin.ts` owns the Claude bundle.

## Threat model and supported environment

Runtime-owned Lane directories may still be used by a live or unobserved Executor and may contain ignored user files. Caller-reported session states are untrusted for authorizing deletion. No defense against a malicious user rewriting both Git and the authority store is claimed. Support current repository Git/Bun environments; use real temporary Git repositories and fixture-owned child processes for tests, without OS-wide process scans, network or credentials. A real process test must fail rather than skip when its prerequisite is unavailable.

## Decisions and technical design

### D1 — No evidence means no destructive Lane operation

Source: U2.

Do not infer process exit from Kernel terminal proofs, missing claims, Git cleanliness, elapsed time, missing directory, or UI `idle`/`done`. Neither current Host has a trusted exit source, so no automatic Executor Lane deletion or recreation is authorized in this slice. Do not add a future-facing callback or `stopped: true` option with no production provider.

Remove the reachable unsafe Lane deletion route rather than leave an unused destructive export for later callers. Keep creation of genuinely new Lanes and detached verification worktrees separate. If `removeLaneWorktree`/`recreateLaneWorktree` become unused, retire those helpers and their unused imports/tests; preserve any still-needed commit-retention behavior at its actual remaining call site, without an orphaned helper. No blanket `--force`, prune, reset, or branch deletion is introduced.

### D2 — Fail closed for both release and redo

Source: U2.

An integrated Lane stays `integrated` while present. Report the retained path, task identity and missing-exit-evidence reason through existing report fields. Safe delivery/final verification may still complete; a retained directory is not an undelivered Child. Existing observation that a path has disappeared may mark it `released` where already supported, but it does not prove process exit or authorize recreating that path.

At every destructive redo entry (including conflict redo, grant-resume, parked revival, and missing-path recovery), stop before deleting directories, refs, registrations or ignored Authority Store data. Preserve the old Lane, branch, commit and redo target. Park the affected Child with a concrete existing-format reason; dependent Children remain blocked while independent siblings can proceed. A repeated tick or fresh generic confirmation cannot bypass the missing-evidence condition, recreate the directory, repeatedly consume redo grants, or duplicate integration.

Retain existing budget/accounting history; do not grant extra execution or silently count a blocked retry as a completed redo. The old delivery commit remains reachable through its retained Lane branch or already-existing retained refs. Do not delete the branch merely because the directory is absent. A user deleting resources externally does not create trusted exit evidence for automatic redo.

### D3 — Protect all Lane contents conservatively

Source: U2.

Retaining the entire Lane protects tracked, untracked and ignored files, including known runtime scratch. Do not add a file allowlist or selective cleanup in this safety slice. Where a diagnostic inspects ignored entries, list paths only, never file contents; use Git-aware, null-delimited parsing. Unknown ignored files are never treated as disposable because of their directory location.

A test must include a real ignored sentinel file and verify byte-for-byte preservation plus ref/worktree-registration identity. A fake `clean: true` alone does not establish this guarantee. No data export/archive format is necessary because the original data stays in place.

### D4 — Reports remain truthful across completion and restart

Source: E4.

Use `lane_refusals`, Child `reason` and `next_action`, without a new stored state or field. Ensure ordinary ticks, parked resume, repeated terminal reports, and `completedParentReport` preserve or reconstruct retained-resource diagnostics. Reports must distinguish delivery completed from cleanup not performed. Never rewrite immutable terminal evidence to pretend cleanup occurred, and never classify a retained completed Lane as new work to enroll.

Only the runtime owns batch transitions. Human guidance asks the user to inspect/stop their Executor, preserve needed files, and manage external cleanup; it does not issue automatic force-delete commands or claim manual removal enables safe automatic redo.

### D5 — Minimal contract alignment and restoration boundary

Source: U2.

Update only lifecycle statements affected by retention: new batches still create Lanes, but do not automatically remove them without trustworthy exit evidence; destructive redo can park. Align `dist/imm-run-batch.md`, the Lane Steward source/mirror, relevant `CONTEXT.md` vocabulary, and ADR 0027 with a clearly scoped amendment. Do not rewrite unrelated Herdr product routing or dialog authority. Update tests that require unsafe automatic deletion; retain integration, user checkout, lineage and legacy external-Lane protections.

Automation restoration is a separate proposal, not a third unfinished Slice of this Initiative:

- **Owner**: Immune-Brain runtime/Host lifecycle maintainer; project owner `dereknex` owns prioritization.
- **Revisit milestone**: a concrete Host-owned Executor identity/exit-observation capability becomes available and a separate proposal is approved. The owner reviews this gate at that milestone; there is no time-based relaxation.
- **Exit conditions**: process identity binds to repository/Lane and execution generation; stale observations cannot authorize reuse; relaunch invalidates prior exit evidence; interruption and timeout have fail-closed recovery; tests cover live/exited/unknown processes in every supported provider; unknown file protection remains.
- **Cleanup cost**: replace the conservative retention decision with the proven lifecycle guard, update focused behavior/contract tests and generated bundle. No dual-written store, temporary adapter or permanent hidden bypass is introduced now. Until those conditions hold, retention is the supported behavior, not a TODO counted as complete automation.

## Lifecycle enumeration and compatibility

Triggers: successful integration, ordinary tick, terminal-report refresh, redo request/grant-resume, parked revival, Parent interruption/restart, externally missing Lane path, and a live/idle/done/unobserved Executor. Process exit/cancel/timeout/dispatch failure provide no new runtime proof in this slice; all remain unknown for destruction authorization.

States remain existing values: `integrated` retains delivery and directory; `released` is only the existing disappearance observation, not exit proof; redo parks as `needs_human`; dependencies may be `skipped_blocked`. No new state machine, persistent field, branded receipt or parser migration is introduced. Only existing runner transitions write batch state. Kernel settlement remains exclusively Kernel-owned. Missing claim and tool success are non-authoritative for process exit.

Both Hosts get identical conservative shared behavior without new tool schema parameters. Existing legacy offered Lanes remain user-managed. Old records remain readable with their original meaning. If implementation requires changing stored meaning, stop for Planner/ADR 0029 rather than reinterpret v2. No automated rollback or orphan cleanup is part of this slice; reverting to automatic deletion restores the identified risk and is not a safe recovery recommendation.

## User scenarios

All scenarios source U2 and belong only to S2.

- **SCN-4 (automated → AC1)**: A Child has integrated, but its Executor is alive or unobserved. The next tick retains its directory, branch and files; passing delivery can still complete with a visible cleanup notice.
- **SCN-5 (automated → AC2)**: Redo is requested for a Lane containing an ignored user file. The runtime parks without deleting or recreating resources; repeated resume does not spend more budget merely for the same refusal.
- **SCN-6 (automated → AC3)**: A user reopens a completed batch report. It still identifies retained Lanes and does not claim cleanup or launch the Child again.

## Verification and acceptance mapping

| Acceptance | Source | Positive, negative and bound controls | Agreed seams |
| --- | --- | --- | --- |
| AC1 | D1/D3 (single decision source: U2) | Positive: ordinary creation/integration/final verification still works and leaves the integrated Lane retained. Negative: real live fixture process, unknown session, no claim, caller idle/done and unknown ignored sentinel never authorize removal. Bound: external offered Lane remains untouched; detached Parent verification worktrees retain their separate cleanup behavior. | `tests/batch-parent-branch.test.ts`, `tests/unattended-batch-lanes.test.ts` |
| AC2 | D2 | Positive: independent siblings keep integrating while the affected Child is parked. Negative: conflict redo, granted-redo resume, parked revival and absent-path recovery never delete/recreate resources without exit proof. Bound: repeated ticks/confirmation preserve refs, target, grants and file bytes without duplicate work. | `tests/batch-merge-queue.test.ts`, `tests/batch-parked-revive.test.ts`, `tests/batch-redo-slot.test.ts` |
| AC3 | D4 | Positive: retained resource identity/reason appears in ordinary and completed reports. Negative: repeated terminal reads do not drop the notice, enroll again, or assert cleaned-up state while path exists. Bound: already absent paths are observations only; final delivery evidence remains unchanged. | `tests/batch-final-report.test.ts`, `tests/goal-driven-batch-run.test.ts` |
| AC4 | D5 | Positive: affected source/mirror lifecycle rules agree with conservative retention and deferred restoration. Negative: no active contract promises automatic deletion from Git-clean/Kernel-terminal alone. Bound: legacy external-Lane ownership and dialog rules remain intact. | `tests/role-prompt-bridge.test.ts`, `tests/dist-docs-sync-contract.test.ts` |

Run the real-process regression with a fixture-owned child that signals ready before the tick and exits only after a controlled release. Clean up only that child in `finally`; do not use sleeps as synchronization or kill arbitrary processes. Ignored sentinel, refs and registrations must be compared before/after rejected cleanup and redo. Adjust only assertions protecting the retired automatic deletion behavior; the remaining integration and data protection checks must run.

Dependencies: host `bun` and `git`, tracked test code, existing installed dependencies; no package installation/network/credentials. Temporary repositories and processes are test-owned and cleaned on failure. Zero matching tests, skipped required controls or missing prerequisites are failures. Planning only validates descriptors; QA executes them after implementation.

Implementation also runs `bun run typecheck`, regenerates/checks the Claude bundle with `scripts/build-claude-plugin.ts`, checks dist mirrors, and adds `.changeset/batch-resource-safety-s2.md`. These checks supplement, not replace, behavioral verification.

## Reference closure and scope

Runtime transition owners: `batch_lanes.ts` (release, redo, terminal ticks), `batch_worktrees.ts` (Lane deletion/recreation versus detached verification), `batch_runner.ts` (completed report rebuilding), and `batch_state.ts` (existing record/report meanings). `batch_final_report.ts` supplies existing delivery evidence; no new final-report schema is planned.

The two Host adapters consume shared reports; no Host process management or public input is added. Contract owners and mirrors are E6. The focused tests in the table plus generated Claude bundle and changeset cover packaging. Include `tests/batch-redo-slot.test.ts` because grant accounting shares the redo transition, not only the deleting helper.

## Devil's Advocate Audit

- **Rollback resilience**: retention cannot erase data; crash/restart reconstructs the refusal. Existing branch/commit protects unintegrated work. No migration rollback or force cleanup is needed.
- **Verification vanity**: assert actual sentinel bytes, refs, registrations and runnable process state, not just an error string. Positive integrated completion prevents an always-fail runner satisfying the tests. Terminal replay and redo-grant controls catch alternate routes around the guard.
- **Spec dilution**: automatic cleanup after trusted exit is explicitly removed by user option A, not silently claimed. Every confirmed retained-resource, ignored-data and destructive-redo requirement maps to AC1–AC3; contract truthfulness and the restoration owner/gate map to AC4. Full lifecycle automation remains excluded, not an unfinished acceptance.

## Handoff completeness

S1 covers resource admission ownership and legitimate recovery. S2 covers missing-exit-evidence retention, ignored-file preservation, destructive-redo refusal, completion visibility and the automation restoration boundary. Both have independently verifiable outcomes and run S1 → S2 because their runtime and tests overlap. The user-approved option A supersedes the earlier S2 promise to automatically clean once an exit is observed. No automatic lifecycle facility or third hidden Slice is required to complete this reduced Initiative.
