# Supervised Session Port

The capability contract for the session a Parent launches a Lane Executor in. ADR 0038 (`docs/adr/0038-supervised-session-port.md`) records why it exists and where it sits; this reference is its single operational text. The Parent's Loop contract (`dist/drive-batch.md`, Herdr Lane Tabs) consumes it through `imm-session`; the Kernel, the batch runtime, the Host adapters and the `lane-steward` never do.

A supervised session keeps the four guarantees the Loop contract defines: it is a separate Host process rooted in the Lane, it receives one explicit `drive` entry and nothing else, control returns to the Parent without polling when it stops working, and the Parent can stop it. The port states them as verbs. Session state and output are never Kernel progress evidence; Kernel projections in the batch report remain the only progress signal.

## Interface

`plugins/immune-brain/runtime/session/supervised_session_port.ts`, port protocol `1`.

- **Port**: the contract below. It speaks only of *session*, *handle*, *state* and *instruction*; tabs, panes, workspaces and sockets stay inside an adapter.
- **Provider**: an implementation, named by a literal (`herdr`, `fake`; later `herdr-core`). Adding one adds a literal, not a port change.
- **Selection**: every `imm-session` call names its provider with `--provider`. Nothing is auto-detected, and one provider never stands in for another. This is not a Host registry or dispatcher (ADR 0004 Decision 5): it chooses where one already-decided Executor session runs, and owns no routing.
- **Handle**: opaque; only the adapter that minted it decodes it. Handles are not persisted by the runtime and are not authority.
- **State**: `working | blocked | idle | done | unknown`, each with a provenance `detected | reported | none`.

### Required capabilities

A provider missing any of these, or implementing another port protocol, is refused admission; it is never degraded.

| Capability | Precondition | Postcondition | Fail-closed |
| --- | --- | --- | --- |
| `createSession` | Lane `cwd`; one explicit `drive` entry; label ≤ 32 characters | Exactly one live session rooted in the Lane, the entry submitted once, state reported | Refusal and no session; never a detached job, in-process subagent or serial in-place work. A start dialog reports `entry_submitted: false`, `blocked`. With `resume`, the entry is resubmitted in the same session only when it is `idle` or `done` |
| `sendInstruction` | Owned handle; the adapter observes `idle` immediately before sending; the Parent recorded the instruction first (`lane_instruction` accepted) | Delivered, with the state after delivery | Any other state: `state_refused`, nothing sent |
| `awaitTransition` | Owned handle | Returns once the session is not `working` (at once if it already is not): `changed`, `exited`, `timeout` or `events_lost` | `timeout` and `exited` carry `unknown`; `exited` is a process signal, never a verdict or settlement |
| `readOutput` | Owned handle | Text labelled `visible` or `scrollback` | For people only; never progress evidence |
| `observeState` | Owned handle | State and provenance | No readable state is `unknown`, never an invented `idle` or `done` |
| `stopSession` | Owned handle | Soft interrupt, then the provider's hard stop | Foreign handle: `not_owned` |
| `closeSession` | Owned handle and every Executor close fact: created by the Parent, child integrated, release handoff issued, audit pair reachable on the batch branch, close recorded | Session resources released | `close_unproven` naming each unmet fact; `imm-session` offers no close verb until the close rule is adopted by the Loop contract |
| `reconcile` | The caller's own handles | The last known state of each | A foreign handle is listed `unknown` with `refused: not_owned`; there is no "all sessions" listing |

### Optional capabilities

A missing optional capability takes its degrade path, and the degrade is stated in the tick or batch report. `admitSessionProvider` names the missing ones.

| Capability | Degrade when absent |
| --- | --- |
| `waitForState` | `awaitTransition` and a re-observe; the re-observe races, so state it |
| `sendKeys` | Hard stop only |
| `subscribeEvents` | List and get reconciliation; `events_lost` stays part of the port |
| `snapshot` | `reconcile`; a mismatch is `unknown` and wakes the user |
| `manageWorktree` | The Lane's own provisioning (`lane-steward`) |
| `reportState` | Provider detection only; a provider whose only state source is self-report must declare it in the admission matrix |
| `attachSession` | No effect on Parent scheduling |

`structuredResult` is reserved and unfilled: verdicts return through the file protocol, and a provider that fills it is refused.

### Refusal codes

`invalid_input`, `provider_unavailable`, `protocol_mismatch`, `not_owned`, `state_refused`, `start_failed`, `close_unproven`, `provider_error`. A `provider_error` proves nothing about delivery: observe before repeating.

### `imm-session`

```text
imm-session <verb> --provider herdr [options]
  probe
  create --cwd <lane_path> --label <name> --host claude-code|pi --entry <drive entry> [--resume <handle>] [-- <host arguments>]
  send <handle> --text <instruction>
  await <handle> [--timeout-ms <ms>]
  observe <handle>
  read <handle> [--source visible|scrollback]
  stop <handle>
  reconcile <handle>...
```

Each call admits and probes the provider, runs one verb and prints one JSON object. Exit `0` on success, `1` on a refusal, `2` on a usage error.

## Provider mapping

### Herdr TUI (`herdr`)

`runtime/session/herdr_provider.ts`, pinned to Herdr protocol `22`. Admission requires `HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, a `herdr` executable and `herdr api schema` stating a pinned protocol. A handle names the Parent's workspace, tab and pane; any other workspace is `not_owned`. The adapter's `HERDR_CLI` table is the one place a command is spelled.

| Port | Herdr command |
| --- | --- |
| `createSession` | `tab create --workspace <ws> --cwd <lane> --label <name> --no-focus`, `agent start <name> --kind claude\|pi --pane <pane> -- <args>`, `agent prompt <pane> <entry> --wait --until working --until blocked --timeout 30000`; `agent_not_ready` is a dialog |
| `sendInstruction` | `agent get <pane>`, then `agent prompt` as above only when `idle` |
| `awaitTransition` | `agent wait <pane> [--timeout <ms>]` |
| `readOutput` | `pane read <pane> --source visible\|recent-unwrapped` |
| `observeState` | `agent get <pane>`; provenance `detected` |
| `stopSession` | `agent send-keys <pane> ctrl+c`, then `pane close <pane>` |
| `closeSession` | `tab close <tab>` |
| `reconcile` | `agent get` per owned handle |
| `sendKeys` | `agent send-keys <pane> <key>` |
| `waitForState`, `subscribeEvents`, `snapshot`, `manageWorktree`, `attachSession` | Not implemented in this adapter; degrade as above |
| `reportState` | Not applicable: Herdr TUI state is `detected` |

`tab create`, `agent start`, `agent prompt`, `agent wait` and `agent get` are the spellings the Loop contract used before this port. `api schema`, `pane read`, `agent send-keys`, `pane close` and `tab close` are spelled from Herdr's documented methods and await a live probe; a different spelling is corrected in `HERDR_CLI` alone.

### herdr-core (`herdr-core`)

Not admitted. Its transport (OpenRPC over stdio), its state source (OSC 7501 self-report only) and four mappings (a wait verb, raw keys, snapshot, a machine-readable id from `run`) await a live probe before an adapter is written.

## Admission matrix

A role is admitted per provider, not globally. The close rule is a Kernel fact on every provider.

| Role | Needs | `herdr` | `herdr-core` |
| --- | --- | --- | --- |
| executor | create, await, observe, stop, close | Admitted | Not admitted until probed |
| authority | create, await with a reliable completion signal, file-protocol verdict | Not admitted (controlled experiment only) | Only if the verifier self-reports `done`; `exited` is not a completion signal |
| advisory | create, send, read, observe | Not admitted until the dispatch protocol defines it | Not admitted until probed |

## Invariants

- The Kernel, the batch runtime, the Host adapters and the `lane-steward` import nothing from `runtime/session/`; only the CLI router does.
- Only `runtime/session/herdr_provider.ts` spawns `herdr`, and no packaged contract spells a `herdr` command.
- No session handle or heartbeat is written to the batch record.
- An instruction reaches only an `idle` session; a dialog is never answered by the Parent.
- `unknown` is a wake and ordering signal only, never terminal proof.

## Side Effects

The Herdr adapter creates tabs in the Parent's own workspace, starts Host processes there, submits text and keys to panes it owns, and closes panes or tabs it owns. It writes no file and no Kernel or batch state.

## Verification

`bun test tests/supervised-session-conformance.test.ts tests/supervised-session-herdr.test.ts tests/supervised-session-boundary.test.ts`. A new provider is accepted by passing the same conformance suite, then a live create → send → await → read → stop run on the real provider.

## New provider checklist

1. Transport and authentication: socket, stdio or HTTP; local or remote.
2. Lifecycle: create, stop and close verbs; whether a create spawns a stray shell.
3. State model and source: vocabulary, provenance, how often `unknown` occurs.
4. Wait semantics: event-driven or polled; a wait on a session that is not working; what a timeout returns.
5. Instruction delivery: when it refuses, and what a refusal leaves sent.
6. Structured results: none means the file protocol.
7. Event durability: how loss is detected and what reconciles it.
8. Ownership: which sessions it may close; a rule that the user's own sessions are never closed.
9. Worktrees: none means the Lane's own provisioning.
10. Multiple machines: remote sessions, addressing, disconnection.
11. Versioning: a versioned, self-describing API; unknown methods fail closed.
12. Conformance: the suite above, then a live run on the real provider.
