# Host probe injection: remove the Claude adapter's Antigravity probe import

**Status**: Candidate; planning only.
**Design risk**: Medium — no persisted state, Kernel, Port or verdict change, but the change alters an internal constructor contract shared by two adapters (`ClaudeRuntimeOptions`, `McpRuntimeOptions`), changes three authority-gate call sites in the shared MCP runtime, and regenerates two packaged runtime bundles.
**Output language**: English, following the Planner document-language default.
**Threat model and supported environment**: Inputs are the Host version bound from the MCP `initialize` handshake (through `bindClientHandshake`) and the process environment; both are already trusted by the existing gates, and this change adds no input and no adversary. The environment version fallback stays disabled at the MCP gates. Supported environment: the existing Bun toolchain on darwin/linux, as both probes already require.
**Design views**: architecture layers; service/component interfaces.
**Execution posture**: test-first — BR-REQ-4 requires a failing regression test before the MCP gate fix, because the defect is evidenced only by code reading.

## Outcome

Issue #413, the part its own baseline assigns to it. `runtime/claude/kernel_ports.ts` stops importing `../antigravity/capability` and stops choosing a probe by `parentHost`; each adapter's composition root supplies its own host probe instead. The shared MCP runtime's three authority gates use that injected probe, so an Antigravity session is no longer judged against Claude Code's minimum version and its refusals name Antigravity. The host-to-host baseline in `tests/runtime-layering-boundary.test.ts` shrinks from five edges to four, all owned by #414, and the layering reference says so. #413 closes when this lands; the remaining cross-adapter edges and the handshake trust are #414's.

## User scenarios

| ID | Scenario | Tag |
| --- | --- | --- |
| SCN-1 | Source: BR-REQ-3 (refusals name the actual host). Actor: Antigravity user. Given: an Antigravity MCP session whose `initialize` bound no trusted host version, which is every Antigravity session until #414 (`runtime/claude/mcp_server.ts:405-408`). When: the user calls `start_unattended_batch`. Then: the call is refused with `unsupported_host` and the reason "Antigravity version is unavailable" instead of "Claude Code version is unavailable". | automated: AC3 |

BR-SCN-1 and BR-SCN-2 are not scenarios of this Spec: the Planner delta answer of 2026-11-08 moved them to #414 with BR-DEFER-2, because they become observable only once Antigravity's real `initialize` binds a trusted version.

## Evidence

| ID | Evidence |
| --- | --- |
| E1 | `runtime/claude/kernel_ports.ts:115` imports `probeHost as probeAntigravityHost` from `../antigravity/capability`; `ClaudeRuntime.probeHost` (`:368-373`) dispatches on `this.parentHost === "antigravity"`. Its callers are the confirmation step (`:436`), `startUnattendedBatch` (`:909`) and `retireStaleBatch` (`:1236`). |
| E2 | `ClaudeRuntimeOptions` is declared at `runtime/claude/kernel_ports.ts:259`; the Lane decision relay rebuilds a runtime from `{ ...this.options, ... }` (`:620`), so an option on it propagates to Lane runtimes. |
| E3 | `AntigravityRuntime` (`runtime/antigravity/kernel_ports.ts:6-13`) and `createAntigravityMcpRuntime` (`runtime/antigravity/mcp_server.ts:14-21`) both reach `ClaudeRuntime` with `parentHost: "antigravity"`; the second goes through `createMcpRuntime` (`runtime/claude/mcp_server.ts:161`) via `McpRuntimeOptions` (`:122`). |
| E4 | The shared MCP runtime has three gates that check `negotiatedVersion` with a hard-coded "Claude Code version is unavailable" and then call the Claude `probeHost`: `start_unattended_batch` (`runtime/claude/mcp_server.ts:241,245`), `retire_stale_batch` (`:280,284`) and every other authority-mutating tool after `status` (`:312,318`). Minimums differ: Claude `2.1.236` (`runtime/claude/capability.ts:1`), Antigravity `0.1.0` (`runtime/antigravity/capability.ts:1`). |
| E5 | `initialize` trusts only `clientInfo.name === HOST_ID` (`"claude-code"`, `runtime/claude/mcp_server.ts:405-408`), so a real Antigravity client binds no version; `bindClientHandshake` (`:218`) is the programmatic seam existing tests use (`tests/claude-batch-authority.test.ts:90`). The repository records no Antigravity `clientInfo` wire capture. |
| E6 | The MCP gates deliberately disable the environment version fallback (`runtime/claude/mcp_server.ts:309-312`; `docs/plans/archive/2026-09-01-002-claude-code-host.intent.json:8`). |
| E7 | `tests/runtime-layering-boundary.test.ts:25-31` baselines five edges, only `claude/kernel_ports.ts -> antigravity/capability` owned by `#413`; `:138-146` asserts length 5 and compares observed with baseline, failing on both unexpected and stale edges. |
| E8 | `docs/reference/layering-rules.md:59` states the five-edge baseline and that `kernel_ports.ts:115` stays baselined under #413; its byte-equal copies are `plugins/immune-brain/dist/docs/reference/layering-rules.md` and `plugins/immune-brain-antigravity/dist/docs/reference/layering-rules.md`, guarded by `tests/layering-rules-contract.test.ts` (`:43-47`). |
| E9 | Generated outputs: `plugins/immune-brain/dist/claude/mcp-server.mjs` (`docs/agents/derived-files.json:14`, `bun scripts/build-claude-plugin.ts`), and the Antigravity package's runtime copies and `dist/antigravity/mcp-server.mjs` (`derived-files.json:60,93-124`, `bun scripts/build-antigravity-plugin.ts`). |
| E10 | `bun test <file> -t <pattern>` exits 1 when the pattern matches no test (Bun 1.4.2, recorded in `docs/specs/layering-rules.spec.md` E10), so name-filtered descriptors cannot pass vacuously. |
| E11 | ADR 0035 Decision 1 and `docs/reference/layering-rules.md` Dependency Rule: adapters neither import nor extend each other; non-host runtime files import no host directory (`tests/runtime-layering-boundary.test.ts:1-7`); ADR 0004 Decision 5 forbids a host registry or dispatcher. |

## Decisions and provenance

| ID | Decision | Source |
| --- | --- | --- |
| D1 | `ClaudeRuntimeOptions` gains an optional host-probe function with the existing probe signature `(env, platform, hostVersion?) => HostProbe`, defaulting to the Claude `probeHost`. `ClaudeRuntime.probeHost` calls it with the same arguments as today; the `parentHost === "antigravity"` branch and the `../antigravity/capability` import are deleted. `parentHost` keeps its other uses (confirmation reference, Lane supervision). | BR-REQ-2, BR-DEC-2, E1 |
| D2 | `McpRuntimeOptions` gains the same optional probe and `createMcpRuntime` forwards it to `ClaudeRuntime`. `AntigravityRuntime` and `createAntigravityMcpRuntime` pass the Antigravity `probeHost`; an explicitly supplied option still wins, as `host` does today. | BR-REQ-2, E3 |
| D3 | All three MCP gates (E4) use the injected probe. For a session with no negotiated version the refusal is `unsupported_host` with the injected probe's own "version is unavailable" reason; the environment fallback stays disabled (the probe never sees the environment version at these gates); the existing order of checks (version, then interactivity, then minimum) is preserved. A Claude session's refusal texts are unchanged. | BR-REQ-3, BR-DEC-3, Planner delta answer 2026-11-08 (gate `:312/318`), E6 |
| D4 | No new type crosses a host boundary: the Antigravity side names the option through `ClaudeRuntimeOptions` and `McpRuntimeOptions`, which it already imports over baselined `#414` edges, so no new edge appears. | E7, E11 |
| D5 | The probe is selected at each adapter's composition root, not in `runtime/assurance/`: a neutral dispatcher would import host directories, which the boundary test forbids, and a lookup table would be the host registry ADR 0004 Decision 5 forbids. | BR-DEC-2, E11 |
| D6 | `tests/runtime-layering-boundary.test.ts`: delete the `#413` baseline entry, narrow the owner type and the header comment to `#414`, and assert a four-edge baseline whose owners are all `#414`. | BR-REQ-1, BR-DEC-1, E7 |
| D7 | `docs/reference/layering-rules.md` Enforcement section states a four-edge baseline owned by #414 and drops the `kernel_ports.ts:115` sentence; regenerate both packaged copies. `tests/layering-rules-contract.test.ts` `layering reference` asserts the new text. | BR-REQ-5, E8 |
| D8 | Regenerate `plugins/immune-brain/dist/claude/mcp-server.mjs` and the Antigravity package with the two build scripts; add a patch changeset. | BR-REQ-5, E9 |
| D9 | New tests go in `tests/antigravity-assurance-conformance.test.ts` under two describe blocks, `runtime host probe` and `MCP host probe gates`, each driving the real runtime or MCP runtime of both hosts. | BR-REQ-4, delegated technical choice: the file already constructs `AntigravityRuntime` and imports the Antigravity probe, and the Claude cases are controls for the same seam. |

## Technical Design

**Architecture layers.** Before: Claude adapter → Antigravity adapter (`kernel_ports.ts:115`), host selection inside the Claude adapter. After: each adapter's composition root (`AntigravityRuntime`, `createAntigravityMcpRuntime`; `ClaudeRuntime`'s default) supplies its own probe; the Claude adapter no longer names Antigravity. Dependency direction is unchanged everywhere else; the three `antigravity → claude` edges and `.pi-extension → claude/review_host` stay until #414. Prohibited coupling: a new host-to-host edge, a probe dispatcher in `runtime/assurance/`, or a host lookup table.

**Component interface.**

| Element | Contract |
| --- | --- |
| Input | Optional `probeHost` on `ClaudeRuntimeOptions` and `McpRuntimeOptions`: `(env, platform, hostVersion?) => HostProbe`. |
| Output | The existing `HostProbe` union; the Antigravity probe's extra `host` field is structurally compatible. |
| Errors | Unchanged codes: a failed probe throws `NativeAuthorityError("unsupported_host", probe.reason)`. |
| Compatibility | Optional with a Claude default: every existing Claude construction and test keeps its behavior. A `ClaudeRuntime` built with `parentHost: "antigravity"` and no probe now uses the Claude probe; production never builds one (E3). |
| Ownership | Caller (adapter composition root) owns the choice; `ClaudeRuntime` and `createMcpRuntime` only call it. |

**Invariants.** (I1) No file under `runtime/claude/` imports `runtime/antigravity/`. (I2) Each runtime probes with the probe its composition root supplied, including Lane runtimes rebuilt from its options. (I3) MCP authority gates never accept an environment-only version. (I4) Claude-session refusal texts and check order are unchanged.

## Devil's Advocate Audit

- **Rollback resilience**: no persisted state or schema; a partial implementation fails AC1 (edge still present, or baseline stale), AC2/AC3 (wrong probe) or the build `--check` scripts (stale bundle). Reverting the commit restores the dispatch, the five-edge baseline, and the old text together.
- **Verification vanity**: AC1 fails before the change through its stale-edge rule once the baseline entry is deleted, and through its unexpected-edge rule if the import returns. AC2's bound control (`parentHost: "antigravity"` without a probe uses the Claude probe) fails today, proving the dispatch is gone rather than renamed. AC3's Antigravity `1.0.0` case fails today with "Claude Code 1.0.0 is below the minimum supported 2.1.236", the defect BR-REQ-4 asks to reproduce first. Text presence in the reference (AC4) proves only the documentation.
- **Spec dilution**: every `BR-*` item maps below. The narrowing from issue items 3 and 4 to #414 is the confirmed BR-DEC-1, not a Planner reduction; BR-SCN-1/2 moved with an explicit user answer; the third gate (`:312/318`) was added by an explicit user answer, widening rather than narrowing BR-REQ-3.

## Acceptance and verification mapping

| AC | Seam | Controls |
| --- | --- | --- |
| AC1 | `tests/runtime-layering-boundary.test.ts`, the real import scan of `plugins/immune-brain/` | Positive: observed host-to-host edges equal a four-entry baseline, every owner `#414`. Negative: an edge from `runtime/claude/kernel_ports.ts` to `runtime/antigravity/*` would be reported as unexpected; the existing fixture test still flags a new edge. Bound: the existing stale-entry test still fails a baseline entry with no observed edge. |
| AC2 | `tests/antigravity-assurance-conformance.test.ts` › `runtime host probe`: `retireStaleBatch` on real `AntigravityRuntime` / `ClaudeRuntime` in a temp directory with no confirmation port, so a passing probe surfaces `interaction_not_opened` | Positive: `AntigravityRuntime` with `ANTIGRAVITY_VERSION=0.2.0` reaches `interaction_not_opened`; `ClaudeRuntime` with `CLAUDE_CODE_VERSION=2.1.236` does too. Negative: `AntigravityRuntime` with `ANTIGRAVITY_VERSION=0.0.9` → `unsupported_host` naming `0.1.0`; `AntigravityRuntime` with only `CLAUDE_CODE_VERSION=2.1.236` → "Antigravity version is unavailable". Bound: `ClaudeRuntime` with `parentHost: "antigravity"`, no probe and only `ANTIGRAVITY_VERSION=0.2.0` → "Claude Code version is unavailable". |
| AC3 | Same file › `MCP host probe gates`: `createAntigravityMcpRuntime` / `createMcpRuntime` with `bindClientHandshake`, and one real `handleJsonRpc` `initialize` | Positive: Antigravity handshake `1.0.0` interactive — `start_unattended_batch` and `retire_stale_batch` without a run entry fail `run_entry_required`, and `advance_assurance` is not refused `unsupported_host`. Negative: Antigravity `0.0.9` → `unsupported_host` naming `0.1.0` on all three tools; an Antigravity session initialized with `clientInfo.name: "antigravity"` (SCN-1) → `start_unattended_batch` refused `unsupported_host` "Antigravity version is unavailable", also with `ANTIGRAVITY_VERSION=1.0.0` in the environment. Bound: Claude handshake `2.1.100` → "Claude Code 2.1.100 is below the minimum supported 2.1.236"; unversioned Claude session → "Claude Code version is unavailable". |
| AC4 | `tests/layering-rules-contract.test.ts` › `layering reference` | Positive: the Enforcement section names `tests/runtime-layering-boundary.test.ts`, a four-edge baseline and #414. Negative: it no longer contains `kernel_ports.ts:115`, "five-edge" or "#413". Bound: both packaged copies stay byte-equal to the source. |

Final local checks for the Executor, not acceptance: `bun scripts/build-claude-plugin.ts --check`, `bun scripts/build-antigravity-plugin.ts --check`, `bun scripts/sync-dist-docs.ts --check`, `bun test tests/claude-host-authority.test.ts tests/claude-batch-authority.test.ts tests/dual-host-assurance-conformance.test.ts`, `bun run typecheck`.

## Brainstorm Trace

| Item | Mapping |
| --- | --- |
| BR-REQ-1 | D6; AC1 |
| BR-REQ-2 | D1, D2, D4; AC2 |
| BR-REQ-3 | D3, widened to the `:312/318` gate by the Planner delta answer of 2026-11-08; AC3 |
| BR-REQ-4 | Execution posture test-first; AC3 Antigravity `1.0.0` case |
| BR-REQ-5 | D7, D8; AC4, plus the Executor's build `--check` runs |
| BR-REQ-6 | Final local checks above; the four acceptance files are the focused subset |
| BR-DEC-1 | Outcome; D6. The delivering PR closes #413. |
| BR-DEC-2 | D1, D5 |
| BR-DEC-3 | D3 |
| BR-DEFER-1 | Deferred to #414: `antigravity/kernel_ports.ts`, `antigravity/mcp_server.ts`, `antigravity/interaction.ts` and `.pi-extension` edges stay baselined (D6). |
| BR-DEFER-2 | Deferred to #414: `initialize` identity and client trust (`runtime/claude/mcp_server.ts:405-421`), now also carrying BR-SCN-1 and BR-SCN-2. |
| BR-OUT-1 | Out: no Kernel, `AssuranceHostPort` or verdict change. |
| BR-OUT-2 | Out: no registry or dispatcher (D5). |
| BR-OUT-3 | Out: Pi and the other adapter code unchanged beyond D1–D3. |
| BR-SCN-1 | Deferred to #414 with BR-DEFER-2 (Planner delta answer, 2026-11-08). |
| BR-SCN-2 | Deferred to #414 with BR-DEFER-2 (Planner delta answer, 2026-11-08). |

## Rollback

Revert the delivering commit. The probe option, the three gate changes, the four-edge baseline, the reference text and the regenerated bundles revert together; no runtime state or record format is involved.
