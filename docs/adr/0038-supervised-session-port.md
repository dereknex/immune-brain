---
status: accepted
---

# Supervised Session Port

**Status update:** this ADR narrows the boundary that
[ADR 0013](0013-optional-parallel-batch-lanes.md) (revision 2026-10-09) drew
around Herdr. The Parent's Loop contract no longer names a workspace tool's
commands; it names `imm-session` and a provider. The Herdr command surface moves
into one runtime adapter, `runtime/session/herdr_provider.ts`. Everything else in
that revision stands. Source: issue #426, decisions D1 to D7 accepted
2026-11-08, and the follow-up choices of 2026-11-10 recorded below.

## Context

ADR 0013 defined a supervised session by its guarantees, then wired Herdr into
the Parent's Loop contract by name: `dist/drive-batch.md` spelled `herdr tab
create`, `herdr agent start`, `herdr agent prompt` and `herdr agent wait`, and
the Parent ran them itself. That made the contract the only Herdr adapter, with
no conformance test, no version pin and no way to add a second provider
(herdr-core, a different runtime with a different transport and state source)
without forking the prose.

The Parent is a model following prose, not a TypeScript caller, and its wait
must re-invoke it as a Host background command. A port therefore needs a
command surface the Parent runs, not only an interface.

## Decision

1. **A capability port, not a framework.** `SupervisedSessionPort`
   (`plugins/immune-brain/runtime/session/supervised_session_port.ts`) states
   eight required capabilities, seven optional ones and one reserved, unfilled
   `structuredResult` slot, each with fail-closed semantics. A missing required
   capability or another port protocol refuses the provider; a missing optional
   one takes a stated degrade. The operational text, the provider mapping and
   the (role × provider) admission matrix live once, in
   [`docs/reference/supervised-session-port.md`](../reference/supervised-session-port.md),
   and move with the port protocol version.
2. **The Parent calls it through `imm-session`.** `plugins/immune-brain/bin/imm-session`
   is routed by `runtime/v4_runtime.ts` like `imm-kernel` and `imm-tracker`.
   Every call names its provider; nothing is auto-detected and no provider
   stands in for another. `imm-session await` runs as the Host background
   command that re-invokes the Parent, so supervision stays event-driven. The
   runtime does not drive sessions on its own initiative: `start_unattended_batch`,
   the batch runner and the `lane-steward` neither import the port nor launch
   anything through it.
3. **A new runtime location.** `runtime/session/` holds the port, a `fake`
   provider and the Herdr adapter. It depends only on itself and Node builtins;
   only the CLI router imports it. It is independent of the review machinery
   that #414 will extract, so it does not wait for that location decision.
4. **Handles are opaque and not persisted.** A Herdr handle encodes the
   Parent's workspace, tab and pane; ownership means the handle names the
   Parent's own workspace. The runtime writes no handle or heartbeat to the
   batch record, which keeps ADR 0013's rejection of persisted session identity.
   The Parent keeps `task_id → handle` as it kept `task_id → tab_id, pane_id`.
5. **Herdr TUI is the first provider, pinned.** The adapter maps port verbs onto
   the same `herdr` commands the Loop contract used, admits only inside Herdr
   with the Parent's workspace, and refuses a Herdr protocol other than 22.
   Every command spelling sits in one table so a live probe corrects one place.
   herdr-core is not admitted until a live probe closes its open mappings.
6. **Behavior is unchanged in this step.** The Parent still closes no tab and
   stops no session, still answers no dialog, and still treats Kernel
   projections as the only progress signal. `imm-session` offers no `close` verb;
   adopting the Executor close rule is a later change to the Loop contract.
7. **Not a generic Host registry and not the framework #220 rejected.**
   ADR 0004 Decision 5 forbids a Host registry or automatic dispatcher. Provider
   selection here chooses where one already-decided Executor session runs; it
   routes nothing and selects no Host adapter. The #220 report rejected a
   runtime-owned adapter framework that would own provider selection and swap
   Host adapters; this is a capability contract at the Parent's Loop layer with
   thin per-provider translation, explicit selection and a handoff when a
   capability is missing.

Choices recorded 2026-11-10: the Parent is the caller (not the runtime, and not
a documentation-only port); runtime supervision (`LaneSupervisor`) and the
Claude Code background command stay outside the port for now and may later be
admitted as a `child-process` provider; the Herdr adapter uses the `herdr` CLI
rather than its socket protocol.

## Rejected Alternatives

- **The runtime drives Herdr inside `start_unattended_batch`.** It would undo
  ADR 0013's rule that the Parent owns the session, and a dialog only the user
  may answer would block a Host tool call.
- **A documentation-only port.** Its conformance suite could test only a fake,
  so nothing would guard the real mapping.
- **Folding `LaneSupervisor` in now.** Its non-interactive, exit-only sessions
  would widen the required capability set to fit a different shape.
- **Waiting for #414's neutral location.** That extraction is blocked on #386
  and concerns review machinery this port does not share.

## Consequences

- `CONTEXT.md` gains **Supervised Session Port** and **Session Provider** and an
  Architecture Map entry for `runtime/session/`.
- `tests/supervised-session-conformance.test.ts` runs every provider through the
  same behaviors; the Herdr adapter runs against a stand-in `herdr` executable,
  so its exec seam, spelling and parsing are tested. Every spelling and response
  shape is checked against Herdr 0.9.5's published CLI reference and API schema
  (`docs/reports/issue-426-herdr-provider-probe.md`); a live Herdr run is still
  required to confirm them on a running server.
- `tests/supervised-session-boundary.test.ts` locks the dependency direction and
  that only the Herdr adapter spawns `herdr`.
- The `herdr`-spelling assertions in the Loop contract tests become `imm-session`
  assertions; the guarantees they protect are unchanged.
