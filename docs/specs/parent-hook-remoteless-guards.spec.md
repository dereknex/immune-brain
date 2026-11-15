# Guard Parent hooks on remote-less single-task Lanes and drifted shell workspaces

**Status**: Candidate; plan-only, not enrolled.
**Task ID**: `parent-hook-remoteless-guards`.
**Design risk**: High — modifies Parent run-continuation observation and completion proof across `runtime/assurance/` and `runtime/unattended/` plus Phase Entry workspace admission across `runtime/assurance/`, `runtime/claude/`, and `runtime/antigravity/`, affecting authority-bound Hook gates and packaged MCP bundles.
**Execution posture**: test-first. Both Issue #503 regressions reproduce deterministically at existing behavioral test seams (`tests/claude-run-continuation.test.ts`, `tests/claude-phase-entry-gate.test.ts`, `tests/phase-entry.test.ts`) and must fail before implementation lands.
**Document language**: English, following the Planner document-language default.

## Outcome

Issue #503 closes two Claude Code Parent Hook warnings observed on remote-less `single_task` Lane runs:

1. **Remote-less `single_task` Parent `Stop` continuation and settlement**: `observeParentRun` and `recordParentRepair` dispatch `observeSingleTask` when `record.plan_source === "single_task"` instead of `observeInitiative` (`observeGithubInitiative` / `gh`), `observeParentCompletion` recognizes completed `single_task` batches with no configured `final_verification` (including after `cleanupSingleTaskLane` deletes `refs/heads/imm/<task_id>`), and Parent continuation tracks `plan_digest` across approved `lane_rebinds` chains.
2. **Fail-closed `PreToolUse` workspace alignment**: when a live `drive` entry binds `state.workspace` and `realpathSync(payload.cwd) !== state.workspace` (for example after `Bash` `cd`s into `.git/imm/worktrees/<slug>/<task>`), `PreToolUse` denies `start_unattended_batch` and `retire_stale_batch` with recovery guidance to `cd` back to `state.workspace`, and `run_continuation_session` records no tool correlation from a drifted `cwd`, eliminating `PostToolUse` `"batch receipt has no persisted identity"` split-brain warnings.

| Slice | Observable when it alone has landed | Remaining gap after it |
| --- | --- | --- |
| `parent-hook-remoteless-guards` | Remote-less `single_task` Lane `Stop` continuation blocks once on active progress, yields quietly while waiting, tracks `lane_rebinds`, and settles silently without `gh` or `final_verification`; `PreToolUse` denies gated MCP calls from drifted `cwd`s with `cd <state.workspace>` guidance and `PostToolUse` never emits `"batch receipt has no persisted identity"` | None within confirmed `#503` scope (`BR-OUT-1`..`BR-OUT-3` excluded by confirmation; `BR-DEFER-0` none) |

## User scenarios

- **BR-SCN-1** — `automated`, AC1, AC2.
  - **Actor**: Developer running a `single_task` Lane batch in Claude Code inside a Git repository with no configured remote.
  - **Given**: `drive` was entered at the repository root and `start_unattended_batch` started a `single_task` Lane batch with no `final_verification` configured.
  - **When**: Claude reaches `Stop` hook boundaries while the Lane Executor is running (including after an approved breaking `Intent` revision rebinds `plan_digest`) and again after the Lane commit integrates and the batch reaches `completed`.
  - **Then**: `Stop` emits no `"no git remotes found"` or `"Final verification has not passed on the delivered content"` warning, outputs a `{ "decision": "block" }` continuation prompt once on active progress, returns empty output on unchanged wait boundaries, and exits silently when the batch settles.
- **BR-SCN-2** — `automated`, AC3, AC4.
  - **Actor**: Developer supervising an active `drive` session in Claude Code.
  - **Given**: `drive` bound `state.workspace` to the coordinator repository root, and a subsequent Bash command changed the Parent shell `cwd` into `.git/imm/worktrees/<slug>/<task>`.
  - **When**: The Parent invokes `start_unattended_batch` or `retire_stale_batch` while `payload.cwd` points to that Lane worktree.
  - **Then**: `PreToolUse` returns `permissionDecision: "deny"` naming the workspace mismatch against `state.workspace` with recovery guidance to `cd` back to the coordinator root, the MCP tool does not execute, and `PostToolUse` never emits `"batch receipt has no persisted identity"`.

## Brainstorm Trace

| ID | Disposition | Where |
| --- | --- | --- |
| `BR-REQ-1` | covered | D1, D2, D3; AC1, AC2 |
| `BR-REQ-2` | covered | D4, D5; AC3, AC4 |
| `BR-REQ-3` | covered | D6; AC1–AC5 |
| `BR-DEC-1` | decisioned | D1 (`single_task` uses `observeSingleTask`; non-`single_task` Initiatives without `docs/initiatives/<slug>.md` keep fail-closed `observeInitiative`); AC1 negative control |
| `BR-DEC-2` | decisioned | D4, D5 (fail-closed `PreToolUse` denial + correlation skip on `cwd !== state.workspace`, no silent `cwd` rewrite); AC3, AC4 |
| `BR-DEC-3` | decisioned | Single executable Slice `parent-hook-remoteless-guards` delivering runtime fixes, mirrors, and regression tests directly on `I503` |
| `BR-OUT-1` | out | Offline `Stop` fallback from `record.children` for GitHub-sourced Initiatives is excluded; missing remote/`gh` stays fail-closed (AC1 negative control) |
| `BR-OUT-2` | out | Silent Hook rewriting of drifted `payload.cwd` to `state.workspace` is excluded (D4, D5) |
| `BR-OUT-3` | out | Pi public tool schemas and unrelated `#426` observations (`agent_name_taken`) are untouched |
| `BR-DEFER-0` | deferred (none) | Zero deferred items from clarification |
| `BR-SCN-1` | covered | User scenarios; AC1, AC2 |
| `BR-SCN-2` | covered | User scenarios; AC3, AC4 |

## Scope, compatibility, recovery, and rollback

**Contract surface**
- Coordinator & unattended batch modules:
  - `plugins/immune-brain/runtime/assurance/run_continuation.ts`
  - `plugins/immune-brain/runtime/assurance/phase_entry.ts`
  - `plugins/immune-brain/runtime/unattended/batch_git.ts`
  - `plugins/immune-brain/runtime/host-core/run_continuation_session.ts`
- Host adapters:
  - `plugins/immune-brain/runtime/claude/lane_guard.ts`
  - `plugins/immune-brain/runtime/antigravity/lane_guard.ts`
- Focused test seams: `tests/claude-run-continuation.test.ts`, `tests/phase-entry.test.ts`, `tests/claude-phase-entry-gate.test.ts`, plus `tests/runtime-layering-boundary.test.ts`.
- Derived artifacts (`docs/agents/derived-files.json`): `plugins/immune-brain/dist/claude/mcp-server.mjs` and `plugins/immune-brain-antigravity/**`, plus `.changeset/parent-hook-remoteless-guards.md`.

**Compatibility**
- Persisted schemas (`assurance_kernel/batch_run_state/v2`, Phase Entry v1/v2 log lines, and session `.continuation` JSON) add no required fields and require no migration.
- Initiative batches (`plan_source === undefined`), `single_task` batches configured with explicit `final_verification`, MCP's own `requireRunEntry` workspace check (`mcp_runtime.ts:382-383`), `Stop`'s `"workspace changed"` release (`run_continuation_session.ts:270-272`), and Pi's `admitPhaseOperation(op, state)` 2-argument call remain backwards-compatible.

**Interruption recovery and rollback**
- All session metadata and batch run-state updates remain single-file atomic writes; a mid-turn interruption leaves the unspent `entry_token` intact when `PreToolUse` denies a drifted `cwd`, so `cd`ing back to `state.workspace` recovers immediately in the same `drive` session.
- Rollback is a single revert of the Slice commit (source modules, tests, changeset, and regenerated derived bundles).

## Discovery evidence and reference closure

- `plugins/immune-brain/runtime/assurance/run_continuation.ts`:
  - `:137-142` (`observeParentRun`) reads `record` via `readAnyBatchRunState`, enforces `record.plan_digest === binding.plan_digest`, and unconditionally calls `observeInitiative(root, binding.initiative_slug)` followed by `observeParentCompletion`.
  - `:199-205` builds `ParentContinuationObservation`; `:222-232` (`decideRunContinuation`) compares `binding.plan_digest !== observation.plan_digest` and settles when `all_required_integrated && final_passed && !pending_repair`.
- `plugins/immune-brain/runtime/host-core/runtime.ts:1052,1176`: `HostRuntime` already dispatches `options.plan_source === "single_task" ? observeSingleTask : ...` and exempts `single_task` batches from mandatory `final_verification`.
- `plugins/immune-brain/runtime/unattended/batch_plan.ts:69-72` & `plugins/immune-brain/runtime/github_issue_tracker.ts:935-944`: `observeInitiative` falls through to `observeGithubInitiative` (`gh`) whenever `docs/initiatives/<slug>.md` is absent.
- `plugins/immune-brain/runtime/unattended/batch_git.ts`:
  - `:1010-1031` (`observeParentCompletion`) reads `readBatchRef(root, parent.branch!)` (throwing `"Parent evidence requires an existing Parent ref"` if deleted) and requires `final?.passed === true && holds(final)` for `finalPassed`.
  - `:1142-1159` (`recordParentRepair`) unconditionally calls `observeInitiative(root, batch.initiative_slug)` at `:1148`.
- `plugins/immune-brain/runtime/unattended/batch_lanes.ts:1473-1500` & `plugins/immune-brain/runtime/unattended/lane_cleanup.ts:74-79`: a `single_task` batch without `final_verification` sets `batch_state = "completed"` after `deliverSingleTask` succeeds (`status: "staged"` or `"fast_forwarded"`), and `cleanupSingleTaskLane` deletes both `refs/heads/imm-lane/...` and `refs/heads/imm/<task_id>` (`child.lane_removed`).
- `plugins/immune-brain/runtime/unattended/batch_state.ts:475-498,1233-1271`: `rebindSingleTaskIdentity` (commit `0cdfbebacc`) atomically updates `record.plan_digest` and appends `{ from_digest, to_digest, ... }` to `record.lane_rebinds`.
- `plugins/immune-brain/runtime/assurance/phase_entry.ts:98-105,161-187`: `PhaseEntryState` already carries `workspace: string | null`, while `admitPhaseOperation(operation, state)` checks only `state?.run_live`.
- `plugins/immune-brain/runtime/claude/lane_guard.ts:170-223`: `recordPhaseEntryPrompt` binds `workspace = realpathSync(cwdOf(payload))`, while `phaseEntryGateHookOutput` does not compare `cwdOf(payload)` against `state.workspace`.
- `plugins/immune-brain/runtime/host-core/run_continuation_session.ts:184-218,270-273`: `tool_call` records `Correlation` with `session.workspace` whenever `entry_state(sessionId)?.run_live` is true without checking `entry.workspace`; `tool_result` reads `readAnyBatchRunState(workspace, response.batch_id)` and throws `"batch receipt has no persisted identity"` at `:215` when `workspace` is a Lane worktree.
- `plugins/immune-brain/.pi-extension/imm-canary-work.ts:367`: Pi already checks `state.workspace !== piWorkspace(ctx?.cwd)` before calling `admitPhaseOperation`.
- `plugins/immune-brain/runtime/antigravity/lane_guard.ts:671-679`: Antigravity calls `admitPhaseOperation(opName, state)` in `evaluatePreToolUseSync`.
- Authorized probe logs (`~/imm-probe/evidence/v4/`):
  - `f16b/parent-pane-final.txt:79` & `f19/parent-pane-final.txt:128,159,191` confirm `Stop` failing in `observeGithubInitiative` with `gh` `"no git remotes found"`.
  - `f16/parent-pane-1.txt:41,61-64,135,142` & `f16b/parent-pane-final.txt:87,95,110,117` confirm `Bash(cd .../.git/imm/worktrees/...)` persisted `payload.cwd` in the Lane worktree while MCP wrote `L4/.imm/state/batches/`, causing `PostToolUse` `"batch receipt has no persisted identity"`.
  - `f19/batch-probe-f16d.final.json:3,17,70-95` confirms completed `single_task` records carry `final_verification: null` and `return_to_coordinator.status: "staged"`.

**Threat model and supported environment**: Inputs are Hook JSON payloads (`cwd`, `session_id`, `tool_name`, `tool_use_id`, `transcript_path`) from the local Host process and Kernel-store batch records under `.imm/state/batches/` written under `withKernelStoreLock`. No external network adversary; handled negative cases are missing Git remotes, `gh` unavailability, shell `cwd` drift into subdirectories/worktrees or deleted paths, unconfigured vs failing `final_verification`, blocked checkout delivery, and unlinked or broken `lane_rebinds` digest chains. Supported environment: Bun runtime on macOS and Linux with standard SHA-1/SHA-256 Git repositories.

## Technical Design

**Design views**: architecture layers (Dependency Rule preservation across Adapter → Coordinator → Unattended), service/component interfaces (`admitPhaseOperation`, `observeParentRun`, `observeParentCompletion`), state transitions (Parent continuation `binding.plan_digest` progression and `settled` transition), and temporal sequence (`PreToolUse` → MCP → `PostToolUse` → `Stop`). Data-flow view is omitted because no persisted file format or wire schema changes.

### D1. Local topology dispatch for `single_task` Parent continuation and repair (`BR-REQ-1`, `BR-DEC-1`)

- In `observeParentRun` (`plugins/immune-brain/runtime/assurance/run_continuation.ts:141`), replace the unconditional `observeInitiative` call with:
  `const plan = await (record.plan_source === "single_task" ? observeSingleTask : observeInitiative)(root, binding.initiative_slug);`
- In `recordParentRepair` (`plugins/immune-brain/runtime/unattended/batch_git.ts:1148`), select `isLaneBatchRecord(batch) && batch.plan_source === "single_task" ? observeSingleTask : observeInitiative` when checking whether `taskId` is already a planned child.
- Initiatives with `plan_source !== "single_task"` and no `docs/initiatives/<slug>.md` keep calling `observeInitiative` → `observeGithubInitiative` and fail closed when Git remote or `gh` is unavailable (`BR-DEC-1`, `BR-OUT-1`).

### D2. `single_task` completion proof without `final_verification` and after Lane cleanup (`BR-REQ-1`, repository evidence `batch_lanes.ts:1473-1500`, `lane_cleanup.ts:74-79`, `batch_git.ts:1011-1030`)

In `observeParentCompletion` (`plugins/immune-brain/runtime/unattended/batch_git.ts:1011-1030`):
1. **Cleaned-up `single_task` Parent ref fallback**: if `parent` is present and `readBatchRef(root, parent.branch!)` returns `null`, resolve `deliveryHead` to `expectedBatchHead(parent)` **only** when all of the following hold:
   - `isLaneBatchRecord(parent) && parent.plan_source === "single_task" && parent.batch_state === "completed"`;
   - `parent.children[0]?.lane_removed !== undefined` and `parent.final_report?.return_to_coordinator.status !== "blocked"`;
   - `git rev-parse --verify --quiet ${expectedBatchHead(parent)}^{commit}` succeeds in `root`; and
   - `deliveryAlreadyApplied(root, parent.children[0].lane?.base_head ?? parent.base_head, expectedBatchHead(parent))` returns `true`.
   Otherwise keep throwing `"Parent evidence requires an existing Parent ref"`.
2. **Optional `final_verification` satisfaction**: inside the `records.some(...)` check for `finalPassed`, when `isLaneBatchRecord(record) && record.plan_source === "single_task" && !record.final_verification?.length && !record.final_verification_result`, return `record.batch_state === "completed" && record.final_report?.head === deliveryHead && record.final_report.return_to_coordinator.status !== "blocked"`. When `record.final_verification?.length` is non-empty, keep requiring `final?.passed === true && holds(final)`. Non-`single_task` records are untouched.

### D3. Parent continuation `plan_digest` progression across `lane_rebinds` (`BR-REQ-1`, delegated technical choice grounded in `batch_state.ts:475-498,1233-1271`)

- Export pure helper `hasContiguousLaneRebind(record: AnyBatchRunStateRecord, fromDigest: string): boolean` from `plugins/immune-brain/runtime/assurance/run_continuation.ts`:
  - Returns `true` iff `isLaneBatchRecord(record) && record.plan_source === "single_task" && Array.isArray(record.lane_rebinds) && record.lane_rebinds.length > 0`, where a suffix starting at index `i` has `record.lane_rebinds[i].from_digest === fromDigest`, every adjacent pair satisfies `record.lane_rebinds[k + 1].from_digest === record.lane_rebinds[k].to_digest`, and `record.lane_rebinds.at(-1)!.to_digest === record.plan_digest`.
- In `observeParentRun` (`run_continuation.ts:138-139,199-205`):
  - Accept `record.plan_digest === binding.plan_digest || hasContiguousLaneRebind(record, binding.plan_digest)` (otherwise throw `"Parent continuation has no matching persisted batch identity"`).
  - Add optional `rebound_from_plan_digest?: string` to `ParentContinuationObservation`, populated with `binding.plan_digest` when matched via `hasContiguousLaneRebind`, and include `plan_digest: record.plan_digest` in `progress_digest` so a rebind registers as progress after a prior wait yield.
- In `decideRunContinuation` (`run_continuation.ts:222-231`):
  - Treat `observation.plan_digest === binding.plan_digest || observation.rebound_from_plan_digest === binding.plan_digest` as a valid identity match, and advance the returned `state.binding` to `{ ...binding, plan_digest: observation.plan_digest }`.
- In `applyRunContinuationEvent` (`plugins/immune-brain/runtime/host-core/run_continuation_session.ts:213-218`):
  - When `start_unattended_batch` succeeds (`state: "started"`) while `metadata.state?.binding.kind === "parent"` already binds the same `batch_id` and `initiative_slug` and `hasContiguousLaneRebind(batch, metadata.state.binding.plan_digest)` holds, update `metadata.state = { ...metadata.state, binding: { ...metadata.state.binding, plan_digest: batch.plan_digest } }`.

### D4. Fail-closed `admitPhaseOperation` and Hook `PreToolUse` workspace alignment (`BR-REQ-2`, `BR-DEC-2`)

- Layering direction (`docs/reference/layering-rules.md`): `runtime/claude/lane_guard.ts` and `runtime/antigravity/lane_guard.ts` (Adapter) → `runtime/assurance/phase_entry.ts` (Coordinator); no upward or cross-adapter import is added.
- Extend `admitPhaseOperation(operation: PhaseOperation, state: PhaseEntryState | null, workspace?: string | null): PhaseAdmission` in `plugins/immune-brain/runtime/assurance/phase_entry.ts:174`:
  - When `operation.kind === "tool"` and `!state?.run_live`, keep returning the existing `RUN_ENTRY_REQUIRED` refusal unchanged.
  - When `operation.kind === "tool"`, `state.run_live === true`, `state.workspace !== null`, and `workspace !== undefined && workspace !== state.workspace`, return:
    - `ok: false`
    - `reason_code: RUN_ENTRY_REQUIRED`
    - `detail: "${operation.name} was called from ${workspace ?? "an unresolvable cwd"} while drive is bound to ${state.workspace}"`
    - `recovery_action: "cd ${state.workspace} to return to the bound workspace, or ${PHASE_ENTRY_RECOVERY[RUN_ENTRY_REQUIRED]}"`
  - Omitting `workspace` (`undefined`) preserves 2-argument callers (`imm-canary-work.ts:368` and existing unit tests).
- In `phaseEntryGateHookOutput` (`plugins/immune-brain/runtime/claude/lane_guard.ts:209`): resolve `currentWorkspace` via `realpathSync(cwdOf(payload))` (`null` if `realpathSync` throws) and pass it to `admitPhaseOperation(operation, state, currentWorkspace)`. On refusal, `denyPreToolUse(phaseRefusalMessage(admission))` runs and no `.admit` file is written, leaving `state.token` unspent.
- In `evaluatePreToolUseSync` (`plugins/immune-brain/runtime/antigravity/lane_guard.ts:674`): when `payload.workspacePaths?.[0]` is provided, resolve its `realpathSync` (`null` on error) and pass it as `workspace`; pass `undefined` when `payload.workspacePaths?.[0]` is absent.

### D5. `run_continuation_session` `tool_call` workspace guard & `Stop` compatibility (`BR-REQ-2`, `BR-OUT-2`)

- In `applyRunContinuationEvent` (`plugins/immune-brain/runtime/host-core/run_continuation_session.ts:187`): check `const entry = host.entry_state(sessionId); if (!entry?.run_live) return { kind: "none" }; if (entry.workspace && entry.workspace !== workspace) return { kind: "none" };`. No `.call` correlation is written when `session.workspace` has drifted away from `entry.workspace`, so `PostToolUse` ignores drifted-`cwd` tool results instead of reading `.imm/state/batches/` in a subdirectory or throwing `"batch receipt has no persisted identity"`.
- Keep `Stop` `"workspace changed; enter drive explicitly in this workspace"` (`run_continuation_session.ts:270-272`) unchanged.

### D6. Regenerated Host bundles, Antigravity mirror, and changeset (`BR-REQ-3`, `docs/agents/derived-files.json`)

- Regenerate `plugins/immune-brain/dist/claude/mcp-server.mjs` (`bun scripts/build-claude-plugin.ts`) and `plugins/immune-brain-antigravity/**` (`bun scripts/build-antigravity-plugin.ts`), and add `.changeset/parent-hook-remoteless-guards.md` (`"immune-brain": patch`).

### False-compromise check

`D4` (`BR-DEC-2`) rejects gated MCP calls when `payload.cwd !== state.workspace` rather than silently rewriting `payload.cwd` to `state.workspace` (an Intermediary / Self-Service transform). Silent rewriting would hide persistent shell `cwd` drift into `.git/imm/worktrees/...` and let subsequent Bash commands run in the wrong worktree while Hooks pretend to be at the coordinator root, violating explicit workspace authority (`ADR 0025`). No false compromise detected.

## Verification and acceptance mapping

Agreed seams:
- `tests/claude-run-continuation.test.ts` — exercises Claude Hook `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` over real Git repositories and Kernel/batch stores.
- `tests/phase-entry.test.ts` & `tests/claude-phase-entry-gate.test.ts` — exercises pure `admitPhaseOperation` and end-to-end Claude `PreToolUse` → `handleJsonRpc` MCP admission.
- `tests/runtime-layering-boundary.test.ts`, `scripts/build-claude-plugin.ts --check`, and `scripts/build-antigravity-plugin.ts --check` — exercises Dependency Rule compliance and derived-bundle parity.

| AC | Source | Seam | Done looks like |
| --- | --- | --- | --- |
| AC1 | D1, D2; `BR-REQ-1`, `BR-DEC-1`, `BR-SCN-1` | `tests/claude-run-continuation.test.ts` | Remote-less `single_task` Lane `Stop` blocks once while running, yields on unchanged waits, and settles silently without `gh` or `final_verification` (both `lane_retained` and `lane_removed`), while remote-less GitHub Initiatives and failed/blocked `single_task` deliveries still fail closed |
| AC2 | D3; `BR-REQ-1`, `BR-SCN-1` | `tests/claude-run-continuation.test.ts` | Approved `single_task` `lane_rebinds` chains advance Parent continuation `binding.plan_digest` on `Stop` and `PostToolUse` without identity errors, while unlinked or broken digest changes fail closed |
| AC3 | D4; `BR-REQ-2`, `BR-DEC-2`, `BR-SCN-2` | `tests/phase-entry.test.ts`, `tests/claude-phase-entry-gate.test.ts` | `admitPhaseOperation` and `phaseEntryGateHookOutput` deny `start_unattended_batch` and `retire_stale_batch` when `cwd` drifts into `.git/imm/worktrees/...`, another directory, or an unresolvable path, naming `state.workspace` and `cd <state.workspace>` without spending the token, and admit immediately once `cwd` returns to `state.workspace` |
| AC4 | D5; `BR-REQ-2`, `BR-OUT-2`, `BR-SCN-2` | `tests/claude-run-continuation.test.ts` | `PreToolUse` + `PostToolUse` from a drifted Lane `cwd` write no correlation and never emit `"batch receipt has no persisted identity"`, while `Stop` at a changed `cwd` still reports `"workspace changed"` |
| AC5 | D4, D6; `BR-REQ-3`, Layering Rules | `tests/runtime-layering-boundary.test.ts` + build `--check` scripts | Dependency direction holds (`Adapter → Coordinator → Unattended`) and Claude/Antigravity derived bundles and mirrors match source bytes |

Controls:
- **Positive**: AC1 remote-less `single_task` running nudge + `lane_retained`/`lane_removed` silent settlement + `recordParentRepair` without `gh`; AC2 single and chained `lane_rebinds` progression; AC3 matching/symlinked `cwd` admitted; AC5 clean `--check`.
- **Negative**: AC1 remote-less non-local Initiative `Stop` pauses with `"continuation facts could not be verified"`; AC1 `single_task` with configured failing `final_verification`, blocked checkout return, or missing Parent ref without `lane_removed` refuses settlement; AC2 tampered `plan_digest` or broken `lane_rebinds` chain throws `"Parent continuation has no matching persisted batch identity"`; AC3 drifted Lane `cwd`, foreign dir, and missing dir denied at `PreToolUse` with zero `.admit` writes while MCP `requireRunEntry` still catches `grant.workspace !== mcp.cwd`; AC4 drifted `PostToolUse` produces `null` instead of `"batch receipt has no persisted identity"`.
- **Bound**: AC1 repeated unchanged `Stop` callbacks yield `null` without revoking `entry_token` and settlement revokes it once; AC2 2-step contiguous `D1 → D2 → D3` rebind chain advances in one `Stop`; AC3 denied drifted `PreToolUse` leaves `entry_token` unspent for immediate recovery after `cd` back to `state.workspace`.

## Devil's Advocate Audit

- **Rollback resilience**: No persisted schema version or required field changes. Reverting the Slice commit cleanly restores prior Hook and continuation behavior with zero unreadable `.imm/state/batches/` or `.continuation` files. If `PreToolUse` denies a call due to drifted `cwd`, no `.admit` or `.call` side effect is written and `entry_token` remains live.
- **Verification vanity**: AC1 runs against a real `git init` repository with zero remotes and `PATH` stripped of `gh` (or shimmed to fail), exercising `runContinuationHookOutput` through real `BatchLaneRunStateRecord` states including post-`cleanupSingleTaskLane` ref deletion (`git update-ref -d refs/heads/imm/<task>`). AC3 and AC4 reproduce the exact `f16b` sequence (`drive` at `root`, `cwd` moved to `root/.git/imm/worktrees/<slug>/<task>`, `start_unattended_batch` invoked) rather than mocking internal helpers.
- **Spec dilution detection**: All confirmed items (`BR-REQ-1`..`BR-REQ-3`, `BR-DEC-1`..`BR-DEC-3`, `BR-SCN-1`..`BR-SCN-2`) are delivered in full in one Slice, including the two coupled `single_task` continuation invariants (`final_verification`-less completion and `lane_rebinds` digest progression) without which `observeSingleTask` alone would still fail before settlement.
