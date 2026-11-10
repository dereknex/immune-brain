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

`runtime/session/herdr_provider.ts`, pinned to Herdr protocol `22` (Herdr 0.9.x). Admission requires `HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, a `herdr` executable and `herdr api schema --json` stating a pinned top-level `protocol`. A handle names the Parent's workspace, tab and pane; any other workspace is `not_owned`. The adapter's `HERDR_CLI` table is the one place a command is spelled.

Every spelling and response shape below is checked against the Herdr 0.9.5 CLI reference and API schema (`docs/reports/issue-426-herdr-provider-probe.md`). A success prints `{"id","result":{...}}` on stdout; a server error prints `{"id","error":{"code","message"}}` on stderr and exits `1`. State is read from `.result.agent.agent_status`, whose vocabulary is the port's own five states.

| Port | Herdr command |
| --- | --- |
| `createSession` | `tab create --workspace <ws> --cwd <lane> --label <name> --no-focus` (IDs at `.result.tab.tab_id`, `.result.root_pane.pane_id`), `agent start <agent-name> --kind claude\|pi --pane <pane> -- <args>`, `agent prompt <pane> <entry> --wait --until working --until blocked --timeout 30000`. The agent name is the label folded to `[a-z][a-z0-9_-]{0,31}`; `agent_not_ready` is a dialog |
| `sendInstruction` | `agent get <pane>`, then `agent prompt` as above only when `idle`; Herdr's own `agent_blocked` refusal is `state_refused` |
| `awaitTransition` | `agent wait <pane> --until idle --until done --until blocked --until unknown [--timeout <ms>]`: Herdr's default ignores `unknown`, the port does not. `timeout` and `pane_not_found` / `agent_not_running` / `agent_not_found` map to `timeout` and `exited` |
| `readOutput` | `pane read <pane> --source visible\|recent-unwrapped`, which prints terminal text |
| `observeState` | `agent get <pane>`; provenance `detected` |
| `stopSession` | `agent send-keys <pane> ctrl+c`, then `pane close <pane>` |
| `closeSession` | `tab close <tab>`; a `confirmation_required` answer is a `provider_error` |
| `reconcile` | `agent get` per owned handle |
| `sendKeys` | `agent send-keys <pane> <key>` |
| `snapshot` | Not wired; Herdr offers `api snapshot`, to adopt with event subscriptions |
| `waitForState`, `subscribeEvents`, `manageWorktree`, `attachSession` | Not implemented in this adapter; degrade as above |
| `reportState` | Not applicable: Herdr TUI state is `detected` |

The shapes are checked against Herdr's published source and schema, not yet by running a Herdr binary; the first live create → send → await → read → stop run confirms them.

### herdr-core (`herdr-core`)

Not admitted. The probe of herdr-core 0.1.19's released OpenRPC schema closes the four open mappings, and its consequences for admission are recorded there; an adapter waits for a live run.

| Port | herdr-core method | Note |
| --- | --- | --- |
| `createSession` | `terminal.run` (`hc run --bg --json --name --cwd`) | Returns `address` (`t7`), the stable handle on that core |
| `sendInstruction` | `terminal.send` with `if: idle` | Server-side conditional send; no check-then-act race. Never `force`, which may answer a dialog |
| `awaitTransition` | `terminal.wait` | `reason`: `status`, `exit`, `output`, `timeout`, `not_started`; timeout is in seconds and defaults to 180, after which it checks in and leaves the terminal running |
| `observeState` | `terminal.get` | Provenance `reported` (OSC 7501); a program that reports nothing has no state, which is `unknown`. Its `error` word maps to `unknown` |
| `readOutput` | `terminal.read` | |
| `stopSession` | `terminal.interrupt`, then `terminal.kill` | |
| `closeSession` | `terminal.rm` | |
| `reconcile` | `terminal.list` / `terminal.get` | |
| `sendKeys` | `terminal.keys` | |
| `subscribeEvents` | `events.subscribe` | |
| `snapshot`, `manageWorktree` | None | Degrade as above |

## Admission matrix

A role is admitted per provider, not globally. The close rule is a Kernel fact on every provider.

| Role | Needs | `herdr` | `herdr-core` |
| --- | --- | --- | --- |
| executor | create, await, observe, stop, close | Admitted | Only if the Executor Host reports its status through OSC 7501, and after a live run; otherwise every state is `unknown` and no instruction or settled wake is possible |
| authority | create, await with a reliable completion signal, file-protocol verdict | Not admitted (controlled experiment only) | Only if the verifier self-reports `done`; `exited` is not a completion signal |
| advisory | create, send, read, observe | Not admitted until the dispatch protocol defines it | Same OSC 7501 condition as executor |

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
