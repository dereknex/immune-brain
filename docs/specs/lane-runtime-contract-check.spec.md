# Lane runtime contract check

**Status**: candidate; authored and structurally validated by the Planner. Validation is not execution or QA evidence, and this document grants no execution authority.
**Planning baseline**: `52f374d715`; recheck affected paths before Enrollment if HEAD changes.
**Document language**: English; user discussion remains Chinese.
**Design risk**: High — it changes the pre-gate admission check of every new Lane batch and the argv of claude-code Lane Executors; no persisted schema or state machine changes.
**Design views**: component interfaces, data flow.

## Outcome and provenance

A new Lane batch is refused before its native gate only when the runtime that will run in the Lane cannot exchange Kernel state with the coordinator, judged by runtime contract identifiers. Developing Immune-Brain with Immune-Brain no longer fails at every start merely because the workspace plugin source is ahead of the installed build; that difference stays visible as a `status` warning.

No Brainstorm manifest exists; direct Planner entry after a Chinese analysis exchange. Each decision and acceptance below names exactly one source.

| Source | Evidence, user direction or delegated choice |
| --- | --- |
| U1 | User agreement, 2026-11-20 ("同意") to the proposal: refuse only when the coordinator runtime and the Executor-loaded runtime disagree on contract identifiers; byte-level workspace skew becomes a warning; fix the recovery action; re-check the mid-batch reload gate under the same assumption. |
| E1 | `plugins/immune-brain/runtime/unattended/batch_lanes.ts:360-377`: `laneRuntimeContractRefusal` first refuses on `pluginSourceSkewWarning` (byte compare of `dist/claude/mcp-server.mjs`, `plugin_source_skew.ts:46-51`), so its contract-identifier comparison (`runtimeContractDifferences`, `kernel/runtime_contracts.ts:73`) is never reached in the plugin source repository. Spec `branch-boundary.spec.md` D4 introduced the refusal on the premise that Lane Executors load the coordinator's build. |
| E2 | Observed 2026-11-20 in this repository: the Claude cache 9.1.0 bundle and the Pi Executor package (`~/.pi/agent/git/github.com/dereknex/immune-brain`, `c5b13485`) are byte-identical, yet `start_unattended_batch` refused `batch_runtime_contract_mismatch` because the workspace bundle (`52f374d715`) differs. |
| E3 | `plugins/immune-brain/runtime/lane_sessions/index.ts:123-132`: `executorSessionTarget` passes only `--model`/`--effort` (`--thinking` for pi); a claude-code Lane Executor therefore loads whatever plugin its Host has installed, unlike the CLI reviewer, which receives `--plugin-dir runtimeClaudePluginDir()` (`assurance/cli_review.ts:297,374`, #426 F13). |
| E4 | `plugins/immune-brain/runtime/unattended/batch_reasons.ts:242-247`: `batch_run_rejected` carries the recovery action "delete or rename the conflicting branch…", which `host-core/runtime.ts:1301-1302` returns for the runtime contract refusal. |
| E5 | `batch_lanes.ts:1294-1311` and `branch-boundary-r2-followups.spec.md` D9: the mid-batch `runtime_reload_required` pause compares the Parent tip bundle with the loaded build because a Lane Executor may load a checkout whose files move as children integrate. |
| T1 | Delegated technical choice: keep `laneRuntimeContractRefusal`'s signature and its existing contract-identifier half (explicit `executor_runtime`, else the workspace manifest when the repository is the Immune-Brain package) so callers in `host-core/runtime.ts` and `runLaneBatch` change behavior without new parameters. |

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D1 | `laneRuntimeContractRefusal` no longer refuses on `pluginSourceSkewWarning`. It refuses only when `runtimeContractDifferences(RUNTIME_CONTRACTS, executorContracts)` is non-empty or the explicit executor runtime has no or a malformed manifest — the existing behavior of its second half. | U1 |
| D2 | A loaded build that differs byte-wise from the workspace plugin remains the existing `status` warning `loaded_plugin_differs_from_workspace` (`assurance/coordinator.ts:442`) with its current wording; it never refuses a batch start. | U1 |
| D3 | `executorSessionTarget` adds `--plugin-dir <runtimeClaudePluginDir()>` for a claude-code Executor when that directory resolves, so a claude-code Lane Executor runs the coordinator's own plugin by construction (the reviewer pattern of E3). Pi and Antigravity argv are unchanged. | E3 |
| D4 | `batch_runtime_contract_mismatch` gets its own entry in the batch reason table with state `rejected` and a recovery action telling the user to load the same Immune-Brain runtime contracts in the coordinator Host and the Lane Executor Host, then retry in the current Host. Both refusal sites use it; `batch_run_rejected` keeps its text for its other callers. | E4 |
| D5 | The mid-batch `runtime_reload_required` pause (`parentRuntimeSkew`) is re-checked and kept unchanged: a Pi Executor may load a checkout whose runtime moves as children integrate, so the pause still protects a real case. Explicitly deferred, not part of this task. | E5 |

## Boundaries and non-goals

- No detection of the Pi or Antigravity Executor's actual package source before the gate; an incompatible Lane is still parked by the existing `batch_lane_contract_mismatch` classification (`batch_lanes.ts:378-383`). Deferred: the coordinator has no reliable reader for a Pi package source today.
- No change to `parentRuntimeSkew`, `runtime_reload` / `runtime_skew_acknowledged` record fields, the bundle staleness watch, or the `status` warning wording.
- `branch-boundary.spec.md` D4 stays as the historical record; this Spec supersedes it.

**Threat model and supported environment**: No new external input. Inputs are the coordinator's own loaded plugin path and the runtime contract manifests on disk, written by Immune-Brain builds the user installed. A stale or mismatched install is the failure considered; a malicious manifest is out of scope. Supported: macOS and Linux with Claude Code, Pi or Antigravity Executors.

## Technical design

**Component interface.** `laneRuntimeContractRefusal(root, executorRuntime?, loadedFrom?)` keeps its signature; `loadedFrom` no longer affects the result. `executorSessionTarget` returns the same `{ host, hostArgs }` shape with the extra flag for claude-code. `BATCH_REASONS.batch_runtime_contract_mismatch` is a new table entry.

**Data flow.** Batch start → `laneRuntimeContractRefusal` → contract identifiers of coordinator vs executor manifest → refusal through `batchReason("batch_runtime_contract_mismatch", detail)` or proceed to the native gate. `status` → `pluginSourceSkewWarning` → warning only. Lane session open → `executorSessionTarget` → Herdr `agent start … -- <hostArgs>`.

## Devil's Advocate Audit

- **Rollback resilience**: Code-only change in four runtime modules plus tests; reverting restores the byte refusal. Nothing persisted depends on it.
- **Verification vanity**: AC1 pins both directions at the same seam (byte skew starts, contract skew still refuses), so a change that deletes the whole check fails AC1. AC2 pins that the warning survives. AC3 pins the argv rather than trusting the premise.
- **Spec dilution**: U1's four parts map to D1/AC1 (refuse only on contracts), D2/AC2 (warning), D4/AC4 (recovery action) and D5 (re-check, deferred with reason); D3/AC3 closes the hole where a claude-code Executor could run a different build than the coordinator.

## Acceptance mapping

| AC | Assertion summary | Seam | Source |
| --- | --- | --- | --- |
| AC1 | Byte-differing workspace bundle with matching contracts: refusal null, batch running; differing `task_record` still refuses naming both manifests, no record. | `tests/unattended-batch-lanes.test.ts` via `laneRuntimeContractRefusal`, `startBatch` | D1 |
| AC2 | Ordinary source checkout: skew warning and status warning unchanged; refusal null. | `tests/lane-executor-status-guidance.test.ts` | D2 |
| AC3 | claude-code Executor argv carries `--plugin-dir <runtimeClaudePluginDir()>`; pi argv does not. | `tests/lane-sessions.test.ts` | D3 |
| AC4 | Reason table entry for `batch_runtime_contract_mismatch` with the runtime recovery action; `batch_run_rejected` unchanged. | `tests/unattended-batch-run.test.ts` | D4 |

## User scenarios

| ID | Actor | Given | When | Then | Mode | AC |
| --- | --- | --- | --- | --- | --- | --- |
| SCN-1 | Maintainer | The Immune-Brain source repository whose workspace plugin build is newer than the installed plugin, with equal runtime contract identifiers | They call `start_unattended_batch` with a `task_id` | The native Enrollment gate opens instead of a `batch_runtime_contract_mismatch` rejection | automated | AC1 |
| SCN-2 | Maintainer | A Lane Executor runtime whose `task_record` contract differs from the coordinator's | They call `start_unattended_batch` | The rejection names both runtime manifests and a recovery action about loading matching runtimes, not about branches | automated | AC4 |

SCN-1 and SCN-2 are Spec-local, sourced to U1.
