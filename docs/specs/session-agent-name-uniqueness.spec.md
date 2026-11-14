# Unique backend session names across `SupervisedSessionPort` batches (`#502`)

**Status**: Candidate; no execution authority.
**Document language**: English (repository default for Specs; user discussion remains Chinese).
**Design risk**: Medium — changes backend agent and terminal naming across both external `SupervisedSessionPort` providers (`herdr` and `herdr-core`), preserves ownership-token identity across exited-Host `--resume` in `herdr`, tightens live duplicate-name invariants in both provider stand-ins (`fake-herdr` and `fake-herdr-core`), and updates canonical reference documentation and packaged plugin mirrors.
**Design views**: service/component interfaces and data flow. Existing `SupervisedSessionPort` state transitions, architecture layers (`ADR 0038`), and `Parent` / `Executor` temporal sequences are unchanged.

## Outcome

Both external `SupervisedSessionPort` adapters (`herdr` and `herdr-core`) derive backend session names internally from the folded `CreateSessionInput.label` plus a 12-hex slice of the session's own ownership `token` (`<folded-label>-<token-slice>`, bounded to `1..32` characters), so repeated `imm-session create --label <label>` calls across batches or concurrent Lanes never collide on `agent_name_taken` (Herdr) or duplicate live `--name` (`herdr-core`) even when prior tabs or live terminals remain open for inspection. `CreateSessionInput`, `imm-session` CLI flags, and `Parent` Loop prompt contracts remain unchanged.

**Threat model and supported environment**: Inputs are caller-supplied `CreateSessionInput.label` (validated to `1..32` trimmed non-empty characters by `validateCreateInput` in `herdr_provider.ts:75` and `herdr_core_provider.ts:116`), adapter-minted cryptographic hex tokens (`node:crypto.randomBytes`), and `SessionHandle` payloads validated via `own()` / `owned()` before reuse. Negative and boundary cases explicitly handled: two concurrent live sessions created with identical `label` (`"slice-a"`); `label` values with no leading ASCII letter (`"123-456"`, `"---"`, `"_99"`); `label` values whose folded form exceeds the 19-character prefix budget (`"abcdefghijklmnopqrstuvwxyz012345"`) or ends with `-`/`_` right at the cut boundary; exited-Host `--resume` in `herdr` reusing `found.ids.token` rather than minting a new token; and stand-in CLIs rejecting duplicate live backend names while allowing reuse after pane/tab close or terminal `kill`/`rm`. Supported platforms match existing `SupervisedSessionPort` providers: macOS and Linux under Node/Bun, `herdr` protocol `22` (`agent start` name regex `^[a-z][a-z0-9_-]{0,31}$`, unique per workspace), and `herdr-core` `>=0.1.19` (`hc run --name` `1..32` chars of `[a-z0-9_-]`, unique among live terminals).

## Sources and Brainstorm Trace

Upstream `Brainstorm manifest` from `/immune-brain:clarify #502` (2026-11-14) mapped completely:

| Upstream ID | Classification | Mapping in this Spec |
|---|---|---|
| `BR-REQ-1` | Requirement | Covered by `AC1`, Technical Design §1 (`herdrAgentName(label, token)` obeying `^[a-z][a-z0-9_-]{0,31}$`) |
| `BR-REQ-2` | Requirement | Covered by `AC2`, Technical Design §2 (`herdrCoreName(label, token)` obeying `1..32` chars of `[a-z0-9_-]`) |
| `BR-REQ-3` | Requirement | Covered by `AC1`, Technical Design §1 (`herdr` `--resume` exited-Host restart reuses `found.ids.token`) |
| `BR-REQ-4` | Requirement | Covered by `AC1`, `AC2`, Technical Design §3 (`fake-herdr` and `fake-herdr-core` duplicate-live-name refusals + conformance and provider tests) |
| `BR-REQ-5` | Requirement | Covered by `AC3`, Technical Design §3 (`docs/reference/supervised-session-port.md`, `.changeset/`, and generated plugin mirrors) |
| `BR-DEC-1` | Confirmed decision | Covered by `AC1`, `AC2`, Technical Design §1–§2 (adapter-internal ownership `token` suffix; no batch/run CLI flag) |
| `BR-DEC-2` | Confirmed decision | Covered by `AC1`, `AC2`, Technical Design §1–§3 (both `herdr` and `herdr-core` in scope + shared conformance test) |
| `BR-OUT-1` | Non-goal | Explicitly excluded: `CreateSessionInput`, `imm-session` CLI flags, and `Parent` Loop contracts (`dist/drive-batch.md`, `subagent-dispatch-protocol.md`) stay unchanged |
| `BR-OUT-2` | Non-goal | Explicitly excluded: `runCommand` and `createHerdrViewer` tab naming do not invoke `herdr agent start` or `hc run --name` and stay unchanged |
| `BR-OUT-3` | Non-goal | Explicitly excluded: `herdr-core` Loop admission (`#495`) and `start_failed` tab-retention behavior stay unchanged |
| `BR-SCN-1` | Scenario | Mapped to `User scenarios` (`BR-SCN-1` → `AC1`, `AC2`) |

Repository discovery evidence:

- `plugins/immune-brain/runtime/session/herdr_provider.ts:58-64,264-273,295-343` — `herdrAgentName(label)` folds `input.label` without salting, `startHost` passes `herdrAgentName(input.label)` to `herdr agent start`, `createSession` mints 12-hex `token = randomBytes(6).toString("hex")` at line `333`, and `resume` restarts exited hosts (`HOST_GONE_CODES`) at line `323` while returning `found.handle` (`found.ids.token`).
- `plugins/immune-brain/runtime/session/herdr_core_provider.ts:103-108,127-129,239-250,331-334` — `herdrCoreName(label)` folds `input.label` without salting, `newToken()` mints 24-hex `randomBytes(12).toString("hex")` at line `127`, `createSession` passes `herdrCoreName(input.label)` to `HC_CLI.run` (`line 240`) and `input.label` to `openViewer` (`line 247`), while `attachSession` passes `found.terminal.name` to `openViewer` (`line 332`).
- `tests/supervised-session-boundary.test.ts:44-59` — locks the exact file list in `plugins/immune-brain/runtime/session/` (`cli.ts`, `exec.ts`, `fake_provider.ts`, `herdr_core_provider.ts`, `herdr_provider.ts`, `marked_result.ts`, `supervised_session_port.ts`) and forbids imports outside `node:` and `runtime/session/`; helpers must remain inside existing provider modules rather than adding a new `.ts` file.
- `tests/fixtures/fake-herdr/herdr:62-73` and `tests/fixtures/fake-herdr-core/hc:37-61` — stand-in CLIs currently accept duplicate live names without error, masking `#502` in `tests/supervised-session-conformance.test.ts` and `tests/supervised-session-herdr-core.test.ts:174`.
- `docs/reference/supervised-session-port.md:82,106` and `docs/agents/derived-files.json` — canonical `createSession` rows document the unsalted name derivation and sync to `plugins/immune-brain/dist/docs/reference/supervised-session-port.md` and `plugins/immune-brain-antigravity/dist/docs/reference/supervised-session-port.md`, while `build-antigravity-plugin.ts` copies `runtime/session/*.ts` to `plugins/immune-brain-antigravity/runtime/session/`.

## User scenarios

| ID | Actor | Given | When | Then | Mode / Mapping |
|---|---|---|---|---|---|
| `BR-SCN-1` | Parent session (or operator) invoking `imm-session` | An existing live supervised session created with `--label slice-a` whose Herdr tab (or `herdr-core` terminal) remains open in the same workspace | The actor runs `imm-session create` a second time with the same `--label slice-a` for a new Lane session without closing the first session | `imm-session create` exits `0` and prints JSON with `"ok": true` and a new distinct `handle`, and both sessions exist concurrently without an `agent_name_taken` or duplicate-name refusal | `automated`: `AC1`, `AC2` |

## Technical Design

### 1. `herdr` backend agent naming and `--resume` token reuse (`BR-REQ-1`, `BR-REQ-3`, `BR-DEC-1`, `BR-OUT-1`, `BR-OUT-2`)

- **Component interface (`plugins/immune-brain/runtime/session/herdr_provider.ts`)**:
  - Keep `CreateSessionInput` (`supervised_session_port.ts:52-58`), `cli.ts`, `runCommand`, and `createHerdrViewer` unchanged; tab title on `herdr tab new` continues to use `--title <input.label>` (`line 336`) so human tab headers remain readable while backend agent names become unique.
  - Update `herdrAgentName(label: string, token: string): string`:
    1. Normalize `suffix = token.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 12)`.
    2. Fold `label` as `const folded = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").replace(/[-_]+$/g, "") || "lane"`.
    3. If `!suffix`, return `folded.slice(0, 32).replace(/[-_]+$/g, "") || "lane"`.
    4. Compute `prefixBudget = 32 - 1 - suffix.length` (`19` when `suffix` is 12 hex chars). Compute `const prefix = folded.slice(0, prefixBudget).replace(/[-_]+$/g, "") || "lane".slice(0, prefixBudget)`.
    5. Return `${prefix}-${suffix}` — guaranteed `1..32` chars matching `/^[a-z][a-z0-9_-]{0,31}$/`.
  - Update `startHost(runner, env, cwd, paneId, token, input)` (`line 264`) to pass `herdrAgentName(input.label, token)` to `HERDR_CLI.agentStart(...)`.
  - In `createSession`:
    - On the `input.resume !== undefined` path when `HOST_GONE_CODES.has(status.error.code)` (`line 322`), pass `found.ids.token` to `startHost(..., found.ids.paneId, found.ids.token, input)` so the restarted host in the existing pane re-registers under the session's existing ownership token without minting a new token or altering `found.handle`.
    - On the new-session path (`line 333`), mint `const token = randomBytes(6).toString("hex")` before opening the tab and pass `token` to `startHost(..., paneId, token, input)`.

### 2. `herdr-core` terminal naming and viewer consistency (`BR-REQ-2`, `BR-DEC-1`, `BR-OUT-1`, `BR-OUT-3`)

- **Component interface (`plugins/immune-brain/runtime/session/herdr_core_provider.ts`)**:
  - Update `herdrCoreName(label: string, token: string): string`:
    1. Normalize `suffix = token.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 12)` (12-hex prefix of `newToken()`'s 24-hex token).
    2. Fold `label` as `const folded = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "lane"` (preserving leading ASCII digits valid under `hc run --name`).
    3. If `!suffix`, return `folded.slice(0, 32).replace(/[-_]+$/g, "") || "lane"`.
    4. Compute `prefixBudget = 32 - 1 - suffix.length` (`19` for 12-hex `suffix`), `const prefix = folded.slice(0, prefixBudget).replace(/[-_]+$/g, "") || "lane".slice(0, prefixBudget)`, and return `${prefix}-${suffix}` — guaranteed `1..32` chars matching `/^[a-z0-9_-]{1,32}$/`.
  - In `createSession` (`lines 239-250`): compute `const token = newToken()` and `const name = herdrCoreName(input.label, token)` up front; pass `name` to `HC_CLI.run(name, input.cwd, command)` AND pass `name` (instead of raw `input.label`) to `openViewer(address, name, input.cwd)` so the initial viewer tab title `${name} (hc ${address})` matches `attachSession` (`line 332`, which reads `found.terminal.name`).

### 3. Stand-in duplicate-name guards, boundary invariant, docs, changeset, and mirrors (`BR-REQ-4`, `BR-REQ-5`, `BR-DEC-2`)

- **Boundary preservation (`tests/supervised-session-boundary.test.ts`)**: Keep all logic inside `herdr_provider.ts` and `herdr_core_provider.ts`; add zero new files under `plugins/immune-brain/runtime/session/`.
- **Stand-in fixtures**:
  - `tests/fixtures/fake-herdr/herdr` (`agent start`, `lines 62-73`): validate `name` matches `/^[a-z][a-z0-9_-]{0,31}$/` (else `fail("invalid_agent_name", ...)`), and before setting `target.agent = true; target.name = name`, scan `Object.entries(state.panes)` and reject with `fail("agent_name_taken", \`agent name already in use: ${name}\`)` if any pane with `id !== paneId && !pane.closed && pane.workspace === target.workspace && pane.agent && pane.name === name` exists. Because `pane close` / `tab close` sets `pane.closed = true; pane.agent = false` and exited hosts have `pane.agent = false`, closed sessions and in-place `--resume` restarts do not falsely collide.
  - `tests/fixtures/fake-herdr-core/hc` (`run`, `lines 37-61`): validate `name` matches `/^[a-z0-9_-]{1,32}$/` (else `fail("invalid_name", ...)`), and reject with `fail("name_taken", \`live terminal name already in use: ${name}\`)` if `Object.values(state.terminals).some((t) => t.state === "live" && t.name === name)`. Because `kill` sets `t.state = "finished"` and `rm` deletes the entry, finished/removed terminals release their name just like real `hc`.
- **Tests**:
  - `tests/supervised-session-conformance.test.ts`: add a shared contract test across `fake`, `herdr`, and `herdr-core` verifying two consecutive `createSession` calls with identical `label: "slice-a"` succeed concurrently while the first session stays live (`status: "idle"`), returning distinct handles that can both be closed cleanly.
  - `tests/supervised-session-herdr.test.ts`: add unit/integration assertions for `herdrAgentName` edge cases (standard label + token, leading digits/punctuation `"123-456"` / `"---"` falling back to `"lane-<suffix>"`, 32-char label truncation without double hyphens), verify `--resume` on an exited host reuses `found.ids.token` (`herdrAgentName(label, found.ids.token)`), and verify `fake-herdr` directly rejects a raw duplicate `agent start` name on a second live pane with `agent_name_taken`.
  - `tests/supervised-session-herdr-core.test.ts`: update existing name assertions (`lines 29, 173`) from exact `"lane-a"` to `/^lane-a-[0-9a-f]{12}$/`, verify `herdrCoreName` edge cases (leading digits preserved, punctuation-only fallback `"lane-<suffix>"`, 32-char max length), verify initial `openViewer` tab title matches `attachSession` (`${name} (hc ${address})`), and verify `fake-herdr-core/hc` directly rejects a duplicate `hc run --name` while live and permits reuse after `hc kill`.
- **Documentation, changeset, and mirrors**:
  - Update `docs/reference/supervised-session-port.md` (`herdr` `createSession` row at `line 82` and `herdr-core` `createSession` row at `line 106`) to document `<folded-label>-<12-hex-token>` backend naming (`<=32` chars) and `herdr` `--resume` token reuse.
  - Add `.changeset/session-agent-name-uniqueness.md` (`patch` bump for `@immune-brain/plugin` or repository changeset convention — inspect existing `.changeset/*.md` or `CHANGELOG.md` frontmatter convention during `drive`).
  - Run `bun scripts/sync-dist-docs.ts`, `bun scripts/build-antigravity-plugin.ts`, and `bun scripts/build-claude-plugin.ts` (if needed) during `drive` so `plugins/immune-brain/dist/` and `plugins/immune-brain-antigravity/` mirrors pass `--check`.

**False-compromise check**: No false compromise detected — reserving 13 characters (`-<12-hex-token>`, 48 bits of entropy) out of the 32-character backend name limit trims long `label` prefixes from 32 to 19 characters on backend agent/terminal identifiers while keeping full `input.label` on Herdr tab titles (`--title <input.label>`) and eliminating cross-batch collisions without changing any caller CLI or `CreateSessionInput` contract (`BR-DEC-1`).

## Devil's Advocate Audit

- **Rollback resilience**: Changes are confined to in-memory name derivation inside two adapter files (`herdr_provider.ts`, `herdr_core_provider.ts`), test stand-ins, docs, and mirrored plugin files. `SessionHandle` wire format (`herdr:v1:...` and `herdr-core:v1:...`), `.imm/` SQLite schemas, and `TaskIntent` contracts are untouched; rolling back cleanly restores prior naming with zero state migration.
- **Verification vanity**: Testing dual `createSession` calls against stand-ins that silently allow duplicate live names would pass even if `herdrAgentName` / `herdrCoreName` forgot the token suffix. `AC1` and `AC2` explicitly require negative controls proving `fake-herdr` rejects duplicate live `agent start` names with `agent_name_taken` and `fake-herdr-core/hc` rejects duplicate live `hc run --name` with `name_taken`, ensuring the shared conformance test would fail without the adapter fix.
- **Spec dilution**: Neither `herdr-core` nor `--resume` token reuse was deferred; all 11 upstream `Brainstorm manifest` items (`BR-REQ-1`..`5`, `BR-DEC-1`..`2`, `BR-OUT-1`..`3`, `BR-SCN-1`) are covered in one bounded slice.

## Acceptance and verification mapping

| Acceptance | Observable invariant and enumerated controls | Agreed seam & done-looks-like | Focused descriptor | Single source |
|---|---|---|---|---|
| `AC1` | Shared conformance (`fake`, `herdr`, `herdr-core`) and `herdr` provider invariants hold. Positive: two live `createSession` calls with identical `label: "slice-a"` succeed concurrently with distinct handles while the first session stays live; `herdrAgentName(label, token)` produces `^[a-z][a-z0-9_-]{0,31}$` across normal labels, non-alpha-prefixed labels (`"123-456"`, `"---"` → `"lane-<12hex>"`), and 32-char labels; `createSession` with `resume` on an exited host restarts in-place reusing `found.ids.token` without minting a new token; `runCommand`, `createHerdrViewer`, `cli.ts`, and `runtime/session/` file-list boundary remain intact. Negative: `fake-herdr` rejects a duplicate `agent start` name on another live pane in the same workspace with `agent_name_taken` while allowing reuse after pane/tab close. | `tests/supervised-session-conformance.test.ts`, `tests/supervised-session-herdr.test.ts`, `tests/supervised-session-advisory.test.ts`, `tests/supervised-session-boundary.test.ts`; Parent can open multiple Herdr Lane sessions with the same `--label` across batches without `agent_name_taken`. | `bun test tests/supervised-session-conformance.test.ts tests/supervised-session-herdr.test.ts tests/supervised-session-advisory.test.ts tests/supervised-session-boundary.test.ts` | `BR-REQ-1` |
| `AC2` | `herdr-core` provider naming and stand-in uniqueness invariants hold. Positive: `herdrCoreName(label, token)` produces `1..32` chars of `[a-z0-9_-]` ending with `-<12hex>` across digit-prefixed (`"01-slice-a"`), punctuation-only (`"---"` → `"lane-<12hex>"`), and 32-char labels; two concurrent live `herdr-core` sessions with identical `label` succeed with distinct handles and consistent viewer tab titles `${name} (hc ${address})` across `createSession` and `attachSession`. Negative: `fake-herdr-core/hc` rejects a duplicate `hc run --name` while the first terminal is `live` (`name_taken`) and allows the name again once `hc kill` transitions the first terminal to `finished`. | `tests/supervised-session-herdr-core.test.ts`; Operator/Parent can create concurrent `herdr-core` sessions with identical `--label` without live-name collisions. | `bun test tests/supervised-session-herdr-core.test.ts` | `BR-REQ-2` |
| `AC3` | `docs/reference/supervised-session-port.md` (`herdr` and `herdr-core` `createSession` rows) documents `<folded-label>-<12-hex-token>` naming and `--resume` token reuse; `.changeset/session-agent-name-uniqueness.md` is present; all generated doc mirrors and plugin mirrors (`plugins/immune-brain/dist/`, `plugins/immune-brain-antigravity/`) and TypeScript types pass `sync-dist-docs.ts --check`, `build-antigravity-plugin.ts --check`, `build-claude-plugin.ts --check`, `tests/dist-docs-sync-contract.test.ts`, and `bun run typecheck`. | `docs/reference/supervised-session-port.md`, `.changeset/session-agent-name-uniqueness.md`, parity scripts, and `typecheck`; Maintainer sees canonical docs and packaged host plugins cleanly synchronized. | `sh -c "bun scripts/sync-dist-docs.ts --check && bun scripts/build-antigravity-plugin.ts --check && bun scripts/build-claude-plugin.ts --check && bun test tests/dist-docs-sync-contract.test.ts && bun run typecheck"` | `BR-REQ-5` |

## Handoff completeness

- **Single Slice result**: One coherent TaskIntent `session-agent-name-uniqueness` delivers the complete confirmed outcome for `#502` across `herdr`, `herdr-core`, shared conformance tests, stand-in duplicate-name guards, reference docs, and plugin mirrors.
- **Remaining gap**: Runtime implementation, fixture updates, mirror sync, changeset creation, and execution of `AC1`–`AC3` await literal-user Enrollment via `/immune-brain:drive`.
