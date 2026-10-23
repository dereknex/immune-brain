# Batch runtime skew refusal

**Status**: candidate for TaskIntent `batch-runtime-skew-refusal`; grants no execution authority.
**Issue**: dereknex/immune-brain#289 (follow-up to #288), scope as revised in the #289 scope-adjustment comment.
**Planning baseline**: `1c4fbf6`; recheck affected paths if HEAD changes before Enrollment.
**Document language**: English; user discussion remains Chinese.
**Design risk**: High — changes how every batch-record reader treats persisted state written by another runtime build, adds a batch reason to the Host-neutral reason table both Hosts render, and adds a field to the Claude `status` result.
**Design views**: component interfaces, data flow.
**Threat model and supported environment**: input is batch state under `.imm/state/batches/` written by some Immune-Brain runtime build on the same machine; there is no adversary, the fault is a reader older or newer than the writer. The plugin bundle file read for `status` is trusted local plugin content. Supported: Claude Code with the cached or `--plugin-dir` plugin, Pi with the bundled extension, macOS and Linux, Bun 1.4.

## Outcome

A runtime that meets a batch record written under a newer `batch_run_state` contract refuses with a message that says the loaded runtime is too old and names where it was loaded from, instead of skipping the record (and offering a fresh batch) or misreading it. Claude `status` reports which bundle the server runs, so two builds with the same version string can be told apart. The rule that a change in a record's meaning requires a contract bump is recorded so the next meaning change is protected by this reader.

## Sources

- **SRC-288**: #288 diagnosis — a cached 5.5.1 bundle misread a Parent-branch `batch_run_state/v2` record and reported `batch_head_lineage_broken`.
- **SRC-Q4**: grilling decision Q4 — mark records by bumping the contract id, not a separate `min_runtime` number; a too-old reader says so and names the loaded path.
- **SRC-Q5**: grilling decision Q5 — `status` reports the loaded bundle path and the first 12 hex characters of its sha256.
- **SRC-Q8**: grilling decision Q8 — audit the other record types branch-boundary-r2 touched and list meaning changes without a bump.
- **SRC-Q9**: grilling decision Q9 (supersedes Q7) — no v3 bump and no migration now; readers fail closed on a newer contract instead of skipping it.
- **EVID-skip**: `runtime/unattended/batch_preflight.ts:120,155,199` and `runtime/unattended/batch_git.ts:982` `continue` past any contract other than v1/v2; the 5.5.1 cache does the same (`mcp-server.mjs:13681`).
- **EVID-parse**: `runtime/unattended/batch_state.ts:888-893` (`parseAnyBatchRunState`) routes non-v2 to the v1 parser, which throws a generic `has an unknown contract` at `:332`.

## User scenarios

- **SCN-1** (source SRC-Q4, SRC-Q9; `automated`, AC1): a user re-enters a batch with a runtime older than the one that wrote the batch record; `start_unattended_batch` refuses with `batch_runtime_too_old`, naming the record, its contract and the loaded runtime path, and says to reconnect or upgrade the plugin. No batch is created.
- **SCN-2** (source SRC-Q5; `automated`, AC4): a user suspects a stale plugin and calls `status`; the result shows the loaded bundle path and a 12-hex sha256 prefix, which differ between the cache and a `--plugin-dir` build of the same version.

## Decisions

| ID | Decision | Source |
|---|---|---|
| D1 | A record whose `contract` is `assurance_kernel/batch_run_state/v<N>` with integer N greater than the highest supported version (2) is *newer*. A record with that prefix that is neither v1, v2 nor newer (for example `v0`, `vnext`) is unreadable. Other contracts are not batch records and stay skipped. | SRC-Q9 |
| D2 | `findExistingActiveBatch` returns the corrupt variant with an added `newer_contract` for a newer record whose `initiative_slug` equals the requested slug or is not a string. Reusing `corrupt: true` keeps every existing `!found.corrupt` guard (`batch_lanes.ts:88-92`, `kernel_ports.ts:893`, `batch_git.ts:1143`) fail-closed without new branches. A newer record of a different slug does not block. | delegated technical choice |
| D3 | `findSettledBatchRecord` does not skip a matching-slug newer record: it throws the runtime-too-old error, so no caller reuses an older settled lineage beside an unreadable newer one. | delegated technical choice |
| D4 | `findResumableBatchSlugForTask` keeps skipping newer records: its null means only "nothing to continue automatically", and the following batch entry refuses through D2. | delegated technical choice |
| D5 | `observeParentCompletion` throws the runtime-too-old error for a matching-slug newer record instead of skipping it. | EVID-skip |
| D6 | `parseAnyBatchRunState` throws the runtime-too-old error for a newer contract, so every direct reader (`readAnyBatchRunState`, the Claude hook at `claude/mcp_server.ts:874`) reports the same cause. The hook treats such a record as an active batch, not as absence. | EVID-parse |
| D7 | New reason `batch_runtime_too_old` in `BATCH_REASONS`, state `blocked`: reason `batch_runtime_too_old: <path> uses <contract>, newer than this runtime supports (batch_run_state/v2); runtime loaded from <runningRuntimeSource()>`, recovery `reconnect the immune-brain MCP server or upgrade the plugin so the loaded runtime supports this batch record, then retry in the current Host`. Preflight (`batch_preflight.ts:653`) and stale disposition (`batch_disposition.ts:167,219`) render it instead of `batch_state_unreadable` when `newer_contract` is present. Existing reason texts are unchanged. | SRC-Q4 |
| D8 | Claude `status` adds `loaded_bundle: { path, sha256_prefix }`, where `sha256_prefix` is the first 12 lowercase hex characters of the sha256 recorded by `watchBundleIdentity` at startup, or `null` when the bundle was unreadable at startup. `BundleIdentityWatch` exposes that startup hash; no second read. Pi is out of scope: it runs the runtime source from the checkout, not a cached bundle. | SRC-Q5 |
| D9 | No `batch_run_state/v3` writer and no v2 migration in this task. | SRC-Q9 |
| D10 | ADR 0029 records the rule: a change in a persisted record's meaning requires a new contract id, and readers refuse a newer id of their own record family. | SRC-Q4 |

## Technical Design

### Component interfaces

- `batch_state.ts` owns the version classification: `classifyBatchRunStateContract(contract: unknown): "v1" | "v2" | "newer" | "unreadable" | "foreign"` and the error `BatchRuntimeTooOldError { path, contract, loadedFrom }` whose message is the D7 reason text. Every reader in D2-D6 calls this one classifier; no reader keeps its own v1/v2 list.
- `BatchRecordLookup` corrupt variant gains optional `newer_contract: string`. Callers that already branch on `corrupt` keep working; renderers pick D7 when `newer_contract` is set.
- `BundleIdentityWatch` gains `readonly sha256: string | null` (startup hash). `createMcpRuntime` puts `loaded_bundle` on every `status` result, stale or not.

### Data flow

Batch directory entry → JSON parse (parse failure stays `batch_state_unreadable`) → `classifyBatchRunStateContract` → `foreign`: skip; `unreadable`: corrupt; `newer`: corrupt with `newer_contract` (lookup) or `BatchRuntimeTooOldError` (parser, settled lookup, Parent completion); `v1`/`v2`: existing validation unchanged. No reader writes, moves or rewrites the newer record.

## Devil's Advocate Audit

- **Rollback resilience**: the change only adds refusals and a read-only status field; reverting the commit restores the old skip behavior with no persisted-state change, because nothing writes a newer contract (D9). A partial implementation that misses one reader still leaves the others refusing; the shared classifier makes a missed reader visible as a remaining literal v1/v2 list, which Review checks with `grep -n 'batch_run_state/v' runtime`.
- **Verification vanity**: every acceptance plants an on-disk record with `batch_run_state/v3` (and `v9`) and asserts the refusal plus byte-identical record, so a reader that still skips fails by producing a fresh batch or a `stale_batch_absent`. Negative controls keep v1/v2 behavior, a different-slug newer record and a foreign contract file passing, so an over-broad refusal also fails. The status test compares prefixes from two different bundle files, so a constant or version-derived value fails.
- **Spec dilution detection**: issue items map as — reader fail-closed → AC1-AC3; status provenance → AC4; rule → AC5; audit → completed during planning, see Discovery evidence; v3 bump and migration → removed by SRC-Q9 and recorded in #289.

## Slices and acceptance mapping

One TaskIntent. Reader refusal and status provenance share one release changeset and one regenerated bundle; each acceptance is independently testable.

| AC | Assertion summary | Seam (test file → boundary) | Decisions |
|---|---|---|---|
| AC1 | Batch start and Lane-parallel resolution refuse a matching-slug newer record with `batch_runtime_too_old`; v1/v2, different-slug newer, foreign contract and `vnext` controls | `tests/batch-serial-retirement.test.ts` → `prepareBatchPreflight`/`resolveLaneParallel`; `tests/unattended-batch-run.test.ts` → `BATCH_REASONS` table | D1, D2, D7 |
| AC2 | `retire_stale_batch` and `status` batch lookup refuse/report a newer record; file byte-identical | `tests/batch-stale-disposition.test.ts` → `readStaleBatchLookup`/`retireStaleBatch` | D2, D3, D7 |
| AC3 | `observeParentCompletion` and `readAnyBatchRunState` throw the runtime-too-old error for a newer record | `tests/batch-completion-verifier.test.ts` → `observeParentCompletion`, `readAnyBatchRunState` | D5, D6 |
| AC4 | Claude `status` reports `loaded_bundle` path and 12-hex prefix that differ for two bundle bytes; `null` prefix when unreadable at startup | `tests/claude-bundle-staleness.test.ts` → MCP `status` | D8 |
| AC5 | ADR 0029 is Accepted and states the contract-bump rule | `docs/adr/0029-record-meaning-requires-contract-bump.md` | D10 |

## Discovery evidence

- Readers with literal v1/v2 lists: `runtime/unattended/batch_preflight.ts:120,155,199`, `runtime/unattended/batch_git.ts:982`, `runtime/unattended/batch_state.ts:888-893`. Contract-agnostic reader: `runtime/kernel/sqlite_migration.ts:278` (`recoverableBatch`, checks only `batch_state`; unchanged).
- Lookup consumers: `runtime/assurance/coordinator.ts:418` (status), `runtime/unattended/batch_lanes.ts:88-92`, `runtime/claude/kernel_ports.ts:893-894`, `runtime/unattended/batch_disposition.ts:160-219`, `runtime/unattended/batch_git.ts:1143`, Claude hook `runtime/claude/mcp_server.ts:874`.
- Reason table: `runtime/unattended/batch_reasons.ts`; frozen-text test `tests/unattended-batch-run.test.ts:765`.
- Bundle identity: `runtime/plugin_source_skew.ts` (`watchBundleIdentity`), consumed at `runtime/claude/mcp_server.ts:172,279-283`; seam prior art `tests/claude-bundle-staleness.test.ts:128`.
- Generated mirror: `plugins/immune-brain/dist/claude/mcp-server.mjs` (build parity via `scripts/build-claude-plugin.ts --check`); release note under `.changeset/`.
- **Audit (SRC-Q8) of records touched by branch-boundary-r2 (`f9aab4d^..HEAD`)**: no contract id was bumped.
  - `batch_run_state/v2`: meaning changed — `branch` became the unchecked-out Parent ref `refs/heads/imm/<slug>`; added `progress_mode`, `redo_grants`, `redo_head`, `topology_digest`, `final_report`; `revision_delegation`/`delegated_revisions` narrowed. Should have bumped; addressed for the future by this task (D9, D10).
  - `task_record/v4`: meaning changed — for a single task `git_base_head` is now the Enrollment HEAD and covers the whole delta (`79973ca`). Should have bumped. Not changed here.
  - `batch_commit_evidence/v1`: additive optional `previous_head`; existing fields keep their meaning. No bump needed.
  - `batch_final_report/v1`: new contract.
  - `batch_run_report/v1`: construction moved, no field meaning change found.

## Out of scope

- Writing `batch_run_state/v3` or migrating v2 records (SRC-Q9).
- Bumping `task_record/v4` despite the audit finding; it needs its own reader refusal first.
- Pi `status` provenance (D8).
- Patching already-released bundles; release-time version-bump enforcement (#289 Out of scope).
