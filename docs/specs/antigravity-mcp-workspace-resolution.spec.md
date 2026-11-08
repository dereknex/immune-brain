# Antigravity MCP workspace resolution and handshake admission

**Status**: Candidate; planning only.
**Design risk**: Medium — no persisted state, Kernel, Port, or verdict schema change, but the change updates the MCP workspace resolution contract, handshake client-identity and semver gates, and stdio entrypoint across `runtime/antigravity/` and `runtime/claude/`, and regenerates both packaged runtime bundles.
**Output language**: English, following the Planner document-language default.
**Threat model and supported environment**: Inputs are the MCP `initialize` handshake (`clientInfo`, `capabilities`), per-call `tools/call` `params._meta["antigravity.google/workspace_paths"]`, and MCP `roots/list` `file://` URIs supplied by the local Host over stdio. The Host process is trusted; malformed, relative, empty, or non-`file://` workspace inputs are rejected before binding and fall back to the next configured source without widening authority. The environment version fallback stays disabled at the MCP authority gates. Supported environment: Bun and Node.js on darwin/linux with standard Git worktrees.
**Design views**: service/component interfaces; data flow.
**Execution posture**: test-first — reproduce the workspace mismatch, handshake rejection, and duplicate bundle entrypoint in `tests/antigravity-assurance-conformance.test.ts` and `tests/antigravity-host-package.test.ts` before applying the runtime fixes.

## Outcome

Issue #429. When Antigravity launches the packaged MCP server (`node ${PLUGIN_ROOT}/dist/antigravity/mcp-server.mjs`) with its process working directory set to the installed plugin root (`~/.gemini/config/plugins/immune-brain`), the server resolves the active session workspace per call in priority order: (1) `tools/call` `params._meta["antigravity.google/workspace_paths"][0]`, (2) the first valid `file://` URI from MCP `roots/list`, (3) `options.cwd ?? process.cwd()`. In addition, the Antigravity MCP runtime trusts Antigravity's `initialize` client names (`"antigravity-client"` and `"antigravity"`), normalizes an optional leading `"v"` in `parseSemver` (such as `"v1.0.0"`), runs on the shared bidirectional stdio transport, and prevents the bundled Claude module entrypoint from double-starting on Antigravity's bundle. An Antigravity Lane Executor can therefore call both `status` and execution-phase MCP tools (`advance_assurance`, `revise_intent`, `resolve_finding`, `refute_finding`, `submit_review`, `submit_verification`, `repair_authority_state`) against its enrolled Lane worktree.

## User scenarios

| ID | Scenario | Tag |
| --- | --- | --- |
| BR-SCN-1 | Source: confirmed Brainstorm manifest `BR-SCN-1`. Actor: Antigravity Lane Executor session launched in a Lane worktree while the MCP server process `cwd` is the installed plugin root (`~/.gemini/config/plugins/immune-brain`). Given: a TaskIntent is enrolled in the Lane worktree (`.git/imm/worktrees/<slug>/<task_id>`) and the Antigravity client initializes with `clientInfo: { name: "antigravity-client", version: "v1.0.0" }`, `capabilities: { elicitation: {}, roots: { listChanged: true } }`, and sends `params._meta["antigravity.google/workspace_paths"]` (or MCP `roots/list`) pointing to the Lane worktree. When: the Executor calls `status` and `advance_assurance` for `<task_id>`. Then: `status` returns the active Lane `claim`, `run_id`, and `config.project_key` matching the Lane worktree path (not the plugin root), and `advance_assurance` executes against the Lane worktree without failing on `unsupported_host`. | automated: AC1, AC2 |

## Evidence

| ID | Evidence |
| --- | --- |
| E1 | `plugins/immune-brain/runtime/antigravity/mcp_server.ts:15-23` (`createAntigravityMcpRuntime`) delegates to `createMcpRuntime` without a dynamic workspace resolver, and `plugins/immune-brain/runtime/claude/mcp_server.ts:166` constructs `new ClaudeRuntime({ cwd: options.cwd ?? process.cwd(), ... })` once at startup. When Antigravity CLI `1.5.3` launches the plugin MCP server from `plugins/immune-brain-antigravity/mcp_config.json:6`, `customizations.(*Manager).resolvePluginMcpCwd` sets the server process `cwd` to `~/.gemini/config/plugins/immune-brain`. |
| E2 | In Antigravity CLI `1.5.3` (`/Users/derek/.local/bin/agy`), `McpClientSessionInstance.callToolRaw` (`0x1015f51a0`) populates `params._meta["antigravity.google/workspace_paths"]` as `string[]` on every `tools/call` request — the same workspace list that Antigravity hooks read via `payload.workspacePaths?.[0]` in `plugins/immune-brain/runtime/antigravity/run_continuation.ts:9` and `plugins/immune-brain/runtime/antigravity/lane_guard.ts:192,202`. |
| E3 | In Antigravity CLI `1.5.3`, `NewMcpManager` (`0x101602e60`) and `AddWorkspaceRoots` (`0x1016044c0`) register workspace roots on the MCP client as `file://` URIs and advertise `roots` capability during `initialize`. |
| E4 | In Antigravity CLI `1.5.3`, `NewMcpManager` (`0x101602e60`) sends `initialize` with `clientInfo: { name: "antigravity-client", version: "v1.0.0" }` and `capabilities.elicitation`. Currently `plugins/immune-brain/runtime/claude/mcp_server.ts:418` checks `params.clientInfo?.name === HOST_ID` (`"claude-code"`), and `plugins/immune-brain/runtime/antigravity/capability.ts:10-14` (`parseSemver`) rejects `"v1.0.0"` because of the leading `"v"`. Consequently, all non-`status` tools fail at `plugins/immune-brain/runtime/claude/mcp_server.ts:325-332` with `unsupported_host`. |
| E5 | `ClaudeRuntime` (`plugins/immune-brain/runtime/claude/kernel_ports.ts:344,465-1243`) stores `this.cwd` on the instance and reads `this.cwd` at method-call time across `status`, `project`, `advance`, `submitReview`, `submitVerification`, `reviseIntent`, `resolveFinding`, `refuteFinding`, `authorize`, `startUnattendedBatch`, and `retireStaleBatch`. In `plugins/immune-brain/runtime/claude/mcp_server.ts`, `options.cwd ?? process.cwd()` is also read at `:208`, `:242`, `:273`, and `:340,343,347` (`withCompletionDelivery`). |
| E6 | `plugins/immune-brain/runtime/antigravity/mcp_server.ts:25-44` defines a separate `readline` `serveStdio` loop that cannot issue server-to-client requests (`roots/list` or `elicitation/create`), whereas `plugins/immune-brain/runtime/claude/mcp_server.ts:667-900` already implements a bidirectional stdio transport with `pending` request correlation and non-blocking `runCall` for `tools/call`. |
| E7 | `plugins/immune-brain/runtime/claude/mcp_server.ts:945-949` checks `if (entry.endsWith("mcp_server.ts") || entry.endsWith("mcp-server.mjs"))`. Because `plugins/immune-brain/runtime/antigravity/mcp_server.ts` imports `../claude/mcp_server`, bundling `plugins/immune-brain-antigravity/dist/antigravity/mcp-server.mjs` includes both module-level entrypoint guards (`dist/antigravity/mcp-server.mjs:23899,24538`), starting both a Claude stdio server and an Antigravity stdio server on the same `stdin`/`stdout` and emitting duplicate responses for every request. |
| E8 | `tests/antigravity-assurance-conformance.test.ts:464-477` (`"names Antigravity for a client whose initialize binds no trusted version"`) passed `clientInfo: { name: "antigravity", version: "1.0.0" }` only because `handleJsonRpc` previously trusted `"claude-code"` exclusively (`docs/specs/host-probe-injection.spec.md:18,30`). |
| E9 | `docs/agents/derived-files.json:14,48-234` declares `plugins/immune-brain/dist/claude/mcp-server.mjs` and the `plugins/immune-brain-antigravity/**` mirror tree as generated outputs checked by `bun scripts/build-claude-plugin.ts --check` and `bun scripts/build-antigravity-plugin.ts --check`. `tests/runtime-layering-boundary.test.ts:25-30` enforces the 4-edge host-to-host import baseline owned by `#414`. |

## Decisions and provenance

| ID | Decision | Exactly one source |
| --- | --- | --- |
| D1 | Resolve the effective MCP workspace per tool call in priority order: (1) `tools/call` `params._meta["antigravity.google/workspace_paths"][0]` when it is a non-empty absolute path string; (2) the first `roots` entry from MCP `roots/list` whose `uri` is a valid `file://` URL convertible via `fileURLToPath` to an absolute path; (3) `options.cwd ?? process.cwd()`. | BR-DEC-2 |
| D2 | `ClaudeRuntime` exposes `bindWorkspace(cwd: string): void` to update `this.cwd` when a non-empty absolute path is resolved, and `createMcpRuntime` resolves the per-call workspace before dispatching any tool so `runtime.*`, `requireRunEntry`, `readRunToolSession`, `resolveLaneParallel`, and `withCompletionDelivery` all use that bound workspace. When a subsequent call carries neither `_meta` workspace nor a `roots/list` workspace, `createMcpRuntime` re-binds the default `options.cwd ?? process.cwd()`. | E5 |
| D3 | `createMcpRuntime` tracks whether the client's `initialize` capabilities include `roots` and accepts an optional `rootsProvider` (via `McpRuntimeOptions.rootsProvider` or `mcp.bindRootsProvider`). When priority (1) is absent and a `rootsProvider` is active, `callTool` queries `rootsProvider` once, caches the resolved `file://` workspace path until re-`initialize` or `notifications/roots/list_changed`, and falls back to priority (3) on any error, timeout, or non-`file://` URI. | BR-DEC-2 |
| D4 | `McpRuntimeOptions` gains optional `trustedClientNames?: ReadonlyArray<string>` (defaulting to `[HOST_ID]`, i.e. `["claude-code"]`) and optional `serverInfo?: { name: string; minimumHostVersion: string }` (defaulting to `{ name: HOST_ID, minimumHostVersion: MIN_CLAUDE_CODE_VERSION }`). `createAntigravityMcpRuntime` supplies `trustedClientNames: ["antigravity-client", "antigravity"]` and `serverInfo: { name: "antigravity", minimumHostVersion: MIN_ANTIGRAVITY_VERSION }`. No import from `runtime/claude/` to `runtime/antigravity/` is added. | BR-DEC-1 |
| D5 | `parseSemver` in `plugins/immune-brain/runtime/antigravity/capability.ts` normalizes at most one optional leading lowercase `"v"` (matching `/^v?(0\|[1-9]\d*)\.(0\|[1-9]\d*)\.(0\|[1-9]\d*)$/` on the trimmed string) so `"v1.0.0"` parses as `[1, 0, 0]` while `"vv1.0.0"`, `"v1.0"`, and `"1.0.0-beta"` still return `null`. | BR-DEC-1 |
| D6 | `serveStdio` in `plugins/immune-brain/runtime/antigravity/mcp_server.ts` delegates to the shared bidirectional `serveStdio` in `plugins/immune-brain/runtime/claude/mcp_server.ts` with `runtime: createAntigravityMcpRuntime(options)`, and the shared `serveStdio` binds a `roots/list` requester on `mcp` using its `pending` JSON-RPC map alongside `elicitation/create`. | E6 |
| D7 | Narrow the module-level CLI entrypoint guard in `plugins/immune-brain/runtime/claude/mcp_server.ts:946` to `/claude/mcp_server.ts` and `/claude/mcp-server.mjs` (and in `runtime/antigravity/mcp_server.ts:112` to `/antigravity/mcp_server.ts` and `/antigravity/mcp-server.mjs`) so bundling `dist/antigravity/mcp-server.mjs` starts only the Antigravity server or hook runner. | E7 |
| D8 | Update `tests/antigravity-assurance-conformance.test.ts` and `tests/antigravity-host-package.test.ts` to cover workspace resolution priority/fallback, `"antigravity-client"` / `"v1.0.0"` handshake admission, untrusted-client rejection, and single-response `dist/antigravity/mcp-server.mjs` stdio execution; regenerate both plugin bundles with `bun scripts/build-claude-plugin.ts` and `bun scripts/build-antigravity-plugin.ts` and add a patch changeset. | BR-REQ-3 |

## Technical Design

**Data shape first.**
- `ToolMeta` in `plugins/immune-brain/runtime/claude/kernel_ports.ts` and the `meta` parameter of `mcp.callTool` gain optional `workspace?: string`.
- `McpRuntimeOptions` in `plugins/immune-brain/runtime/claude/mcp_server.ts` gains:
  - `trustedClientNames?: ReadonlyArray<string>`
  - `serverInfo?: { name: string; minimumHostVersion: string }`
  - `rootsProvider?: (signal?: AbortSignal) => Promise<ReadonlyArray<{ uri?: unknown }> | undefined>`
- `bindClientHandshake` input gains optional `roots?: boolean`.

**Component interfaces.**

| Element | Contract |
| --- | --- |
| `metaWorkspacePath(meta)` | Reads `meta?.["antigravity.google/workspace_paths"]`. Returns `first.trim()` when `Array.isArray(paths)`, `typeof paths[0] === "string"`, and `isAbsolute(first.trim())`; otherwise `undefined`. |
| `firstFileRootPath(roots)` | Iterates `roots`; for the first entry whose `uri` is a string starting with `"file://"`, converts `fileURLToPath(uri)` inside `try/catch` and returns the path when `isAbsolute(path)`; otherwise `undefined`. |
| `mcp.resolveWorkspace(meta)` | Async helper inside `createMcpRuntime`: returns `meta.workspace` if valid absolute path, else queries/caches `rootsProvider` when bound and `negotiatedRoots` (or `options.rootsProvider`) is active, else returns `defaultWorkspace = options.cwd ?? process.cwd()`. Calls `runtime.bindWorkspace(workspace)` and returns `workspace`. |
| `handleJsonRpc` | On `initialize`: checks `trustedClientNames.includes(String(params.clientInfo?.name ?? ""))`, binds `version`, `interactive`, and `roots`, and returns `serverInfo` from `mcp.serverInfo`. On `notifications/roots/list_changed`: clears cached roots workspace and returns `null`. On `tools/call`: passes `workspace: metaWorkspacePath(params._meta)` in `meta` to `mcp.callTool`. |
| `serveStdio` | Binds `mcp.bindRootsProvider` to send `{ jsonrpc: "2.0", id: "immune-brain:roots:<connectionId>:<seq>", method: "roots/list", params: {} }` over `output` and await `pending`, returning `result.roots` on success or `undefined` on JSON-RPC error or closed stream. |

**Data flow.**
1. Client sends `initialize` (`clientInfo: { name: "antigravity-client", version: "v1.0.0" }`, `capabilities: { elicitation: {}, roots: { listChanged: true } }`).
2. `handleJsonRpc` verifies `clientInfo.name` against `mcp.trustedClientNames`, binds `negotiatedVersion = "v1.0.0"`, `negotiatedInteractive = true`, and `negotiatedRoots = true`, and forwards `"v1.0.0"` to `runtime.bindHostVersion`.
3. Client sends `tools/call` for `status` or `advance_assurance` with `params._meta["antigravity.google/workspace_paths"] = [laneWorktree]`.
4. `handleJsonRpc` extracts `laneWorktree` via `metaWorkspacePath` and passes `workspace: laneWorktree` to `mcp.callTool`.
5. If `_meta` lacked a valid workspace path and `negotiatedRoots` (or `options.rootsProvider`) is active, `mcp.callTool` invokes `rootsProvider`, converts the first `file://` root URI via `fileURLToPath`, and caches it until `notifications/roots/list_changed`. Otherwise it falls back to `options.cwd ?? process.cwd()`.
6. `mcp.callTool` calls `runtime.bindWorkspace(workspace)` and executes the tool against `workspace`.

**Invariants.**
- (I1) No file under `runtime/claude/` imports `runtime/antigravity/`; the 4-edge host-to-host baseline in `tests/runtime-layering-boundary.test.ts` is unchanged.
- (I2) Every `mcp.callTool` invocation binds the workspace resolved for that call before touching `ClaudeRuntime` or workspace-scoped helpers, and never leaks a prior call's `_meta` workspace to a later call that has neither `_meta` nor `roots/list`.
- (I3) MCP authority gates never fall back to environment variables (`ANTIGRAVITY_VERSION` or `CLAUDE_CODE_VERSION`) when `initialize` bound no trusted version.
- (I4) Executing `dist/antigravity/mcp-server.mjs` starts only the Antigravity entrypoint, never the bundled Claude entrypoint.

## Devil's Advocate Audit

- **Rollback resilience**: No persisted Kernel state, SQLite schema, or TaskRecord format changes. Reverting the commit restores the previous runtime files and generated bundles atomically.
- **Verification vanity**:
  - `AC1` would fail before this change because `createAntigravityMcpRuntime({ cwd: pluginDir })` ignores `params._meta["antigravity.google/workspace_paths"]` and `roots/list`, returning `claim: null` and `pluginDir`'s `project_key` instead of the enrolled Lane worktree's projection. Its bound controls prove both that `_meta` takes precedence over `roots/list` and that a per-call `_meta` workspace does not leak into a subsequent call without `_meta`.
  - `AC2` would fail before this change in two independent places: `handleJsonRpc` rejects `clientInfo.name: "antigravity-client"` as untrusted (`Antigravity version is unavailable`), and `parseSemver("v1.0.0")` returns `null` (`Antigravity version v1.0.0 is not valid semver`). Negative controls verify that `"vv1.0.0"`, `"v1.0"`, `"1.0.0-beta"`, `"v0.0.9"`, and untrusted client names are still rejected.
  - `AC3` would fail before this change because spawning `node dist/antigravity/mcp-server.mjs` emits two JSON-RPC responses per request with `serverInfo.name: "claude-code"`.
- **Spec dilution**: Every `BR-*` item from the confirmed Brainstorm manifest is mapped below without narrowing; both workspace resolution (`BR-DEC-2`) and handshake/semver gates (`BR-DEC-1`) are delivered in full.

## Acceptance and verification mapping

| AC | Source | Seam and controls |
| --- | --- | --- |
| AC1 | BR-REQ-1 | `tests/antigravity-assurance-conformance.test.ts` › `MCP workspace resolution`. Positive: (1) with `createAntigravityMcpRuntime({ cwd: pluginDir })` where `pluginDir` is unowned and `laneDir` has an enrolled task, `handleJsonRpc` `tools/call` for `status` and `advance_assurance` with `params._meta: { "antigravity.google/workspace_paths": [laneDir] }` returns the enrolled Lane `claim`, `run_id`, and `config.project_key` for `laneDir`, and `advance_assurance` advances the task in `laneDir` (`BR-SCN-1`); (2) over `serveStdio` with `cwd: pluginDir`, when `tools/call` omits `_meta` and the client advertises `capabilities: { roots: { listChanged: true } }` and replies to `roots/list` with `[{ uri: pathToFileURL(laneDir).href }]`, `status` projects `laneDir`, and after `notifications/roots/list_changed` a subsequent call re-queries `roots/list`. Negative: (1) `_meta["antigravity.google/workspace_paths"]` set to `[]`, `[""]`, or `["relative/path"]` and `roots/list` returning `[{ uri: "https://example.com/repo" }]` are rejected and fall back to `pluginDir` (`claim: null`); (2) `roots/list` returning a JSON-RPC error `{ code: -32601, message: "Method not found" }` falls back to `pluginDir`. Bound: (1) when `_meta` names `laneDir` and `roots/list` names `otherDir`, `status` projects `laneDir` without using `otherDir`; (2) a call with `_meta: [laneDir]` followed by a call with no `_meta` and no `roots` capability re-binds `pluginDir` (`claim: null`). |
| AC2 | BR-REQ-2 | `tests/antigravity-assurance-conformance.test.ts` › `MCP host probe gates`. Positive: (1) `parseSemver("v1.0.0")` equals `[1, 0, 0]` and `probeHost({}, "darwin", "v1.0.0")` succeeds; (2) `handleJsonRpc` `initialize` on `createAntigravityMcpRuntime` with `clientInfo: { name: "antigravity-client", version: "v1.0.0" }` (and `{ name: "antigravity", version: "1.0.0" }`) and `capabilities: { elicitation: {} }` returns `serverInfo.name === "antigravity"` and `minimumHostVersion === "0.1.0"`, admits `advance_assurance` past `unsupported_host`, and reaches `run_entry_required` on `start_unattended_batch` and `retire_stale_batch`. Negative: (1) `parseSemver("vv1.0.0")`, `parseSemver("v1.0")`, and `parseSemver("1.0.0-beta")` return `null`; (2) `handleJsonRpc` `initialize` with `clientInfo: { name: "untrusted-client", version: "v1.0.0" }` or `{ name: "antigravity-client", version: "" }` (even with `env: { ANTIGRAVITY_VERSION: "1.0.0" }`) refuses `start_unattended_batch` and `advance_assurance` with `unsupported_host: Antigravity version is unavailable`; (3) `clientInfo: { name: "antigravity-client", version: "v0.0.9" }` refuses `start_unattended_batch`, `retire_stale_batch`, and `advance_assurance` with `unsupported_host: Antigravity version v0.0.9 is older than minimum supported 0.1.0`. Bound: `createMcpRuntime` (Claude default) initialized with `clientInfo: { name: "antigravity-client", version: "v1.0.0" }` refuses `start_unattended_batch` with `unsupported_host: Claude Code version is unavailable`. |
| AC3 | BR-REQ-3 | `tests/antigravity-host-package.test.ts` and `tests/runtime-layering-boundary.test.ts` plus `bun scripts/build-antigravity-plugin.ts --check` and `bun scripts/build-claude-plugin.ts --check`. Positive: (1) spawning `node dist/antigravity/mcp-server.mjs` with `initialize` (`id: 1`) and `tools/list` (`id: 2`) writes exactly 2 JSON-RPC reply lines (`replies.length === 2`) with `replies[0].result.serverInfo.name === "antigravity"` and `minimumHostVersion === "0.1.0"`; (2) both plugin build `--check` commands exit `0` and the 4-edge host-to-host import baseline in `tests/runtime-layering-boundary.test.ts` passes unchanged. Negative: removing `dist/antigravity/mcp-server.mjs` in a relocated copy fails launch and reports `hook command: missing dist/antigravity/mcp-server.mjs`. Bound: spawning `node plugins/immune-brain/dist/claude/mcp-server.mjs` with `initialize` (`id: 1`) writes `serverInfo.name === "claude-code"` and `minimumHostVersion === "2.1.236"`. |

Final local checks for the Executor beyond acceptance: `bun run typecheck` and `bun test tests/claude-host-authority.test.ts tests/claude-host-package.test.ts tests/dual-host-assurance-conformance.test.ts`.

## Brainstorm Trace

| Item | Mapping |
| --- | --- |
| BR-REQ-1 | D1, D2, D3, D6; AC1 |
| BR-REQ-2 | D4, D5, D7; AC2 |
| BR-REQ-3 | D7, D8; AC3 |
| BR-DEC-1 | D4, D5; AC2 |
| BR-DEC-2 | D1, D2, D3, D6; AC1 |
| BR-OUT-1 | Out: cross-host `runtime/host-core/` extraction (`#414`) and CLI Review stage migration (`#386` / `#433`) are not part of this slice. |
| BR-DEFER-1 | Deferred to `#414`: extracting shared MCP/Review/Continuation host-core modules after `#386` settles. |
| BR-Q-NONE | No open questions remained at Brainstorm handoff; no Planner decision delta required. |
| BR-SCN-1 | Automated by AC1 and AC2. |

## Completeness and remaining gap

The complete confirmed outcome (workspace resolution priority order, Antigravity handshake client-name and `v`-prefixed semver support, bidirectional stdio `roots/list` support, single-entrypoint Antigravity bundle, and regenerated plugin packages) is delivered in one TaskIntent slice. Every upstream `BR-*` item is mapped once above and no phase is excused.

Remaining gap at handoff: implementation, bundle regeneration, and acceptance verification runs are pending execution under `drive`.

## Rollback

Revert the delivering commit. The runtime changes, test updates, changeset, and regenerated Claude/Antigravity bundles revert together with no persisted data migration.
