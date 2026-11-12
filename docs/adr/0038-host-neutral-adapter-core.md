# Host-neutral adapter core

Status: accepted; builds on [ADR 0004](0004-dual-host-assurance-adapters.md) and
[ADR 0035](0035-layering-doctrine.md).

## Context

ADR 0004 fixed one Kernel behind a host-neutral Port and coordinator, with the
Host adapters on top, and forbade a generic host registry. ADR 0035 decision 3
required an ADR before a new shared location or cross-layer dependency, and left
the neutral location for adapter machinery unnamed.

By Issue #414 the two adapters had forked the same machinery: the hook event log
and its private-file helpers, the verifier observation state machine, the runtime
body inherited through `AntigravityRuntime extends ClaudeRuntime`, the MCP stdio
runtime, and run continuation. The forks had already drifted: the Antigravity log
had no ownership check, followed a planted symlink, and returned file-name hashes
from `sessions()`, so a verification receipt could never settle on that Host.

## Decision

Record one neutral layer `plugins/immune-brain/runtime/host-core/` for adapter
machinery that both Hosts need, with this dependency direction:

    kernel ← assurance ← host-core ← adapters (claude, antigravity)

- `host-core` may import `kernel/`, `assurance/`, `config/`, `unattended/` and
  other host-neutral modules. It imports no adapter.
- `runtime/kernel/` and `runtime/assurance/` import nothing from `host-core`.
- The Claude Code and Antigravity adapters may import `host-core`; they still
  neither import nor extend each other.
- Each adapter's composition root wires its own profiles. No host registry and no
  dispatcher is introduced.
- Pi stays outside this layer. `.pi-extension` may import it later; this
  initiative adds no such import.

`docs/reference/layering-rules.md` names the layer in its Dependency Rule, and
`tests/runtime-layering-boundary.test.ts` enforces the direction: the existing
inner-layer rule already refuses a `host-core` import of any adapter, and a
`kernel/` or `assurance/` import of `host-core` is refused by the third rule
recorded here. The host-to-host edge baseline stays owned by #414 and shrinks as
each Slice retires an edge.

The first code in this layer is the hook event log and its private-file helpers
(Spec `docs/specs/host-neutral-adapter-core.spec.md` D3): one implementation, with
the Claude storage behavior, serving both adapters under their unchanged cache
directory names. Later Slices move the verifier observation state machine, the
runtime body, the MCP stdio runtime and run continuation into the same layer.

A new shared concern is added to `host-core` by its own Slice, never by extending
one adapter from the other.

## Consequences

- Adapter machinery shared by two Hosts has one implementation and one owner.
- An adapter keeps only what is specific to its Host: hook payload parsing into
  typed events, subagent primitives, transcript reading, CLI spawn arguments,
  manifests and hooks, and native gate UX.
- The hook event log's Antigravity storage moves to the Claude format. Antigravity
  `.events.jsonl` files written before the move are no longer read; they held
  only in-flight verifier events that could never settle a receipt.
- Reverting a Slice restores its predecessor's file set, because later Slices
  depend on earlier ones only through modules they added.
