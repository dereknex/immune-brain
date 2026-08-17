# Spec: MCP-first subagent activation

**Task ID**: IMM-SUBAGENT-ACTIVATION-004
**Owner**: Planner
**Status**: Proposed
**Related**: docs/reference/automatic-subagent-activation-policy.md, docs/reference/subagent-dispatch-protocol.md, docs/reference/immune-brain-config.md, docs/specs/global-subagent-activation-policy.spec.md, docs/specs/cross-host-plugin-runtime.spec.md

## Background

Immune-Brain now has two overlapping runtime paths:

- Plugin-local MCP runtime through `plugins/immune-brain/.mcp.json`.
- Manual `plugins/immune-brain/bin/imm-*` wrappers and older managed-copy
  `~/.local/bin/imm-*` wrappers.

For subagent activation, this causes two problems:

- Hosts can accidentally call stale CLI wrappers instead of the plugin runtime.
- Codex requires an explicit user request before `spawn_agent`; writing
  "use subagents" inside a Skill is not always enough to satisfy that host
  authorization gate.

The desired behavior is that Codex, Cursor, and Claude Code all use MCP as the
primary runtime surface, while user preference and project instructions reduce
repeated subagent confirmation prompts where the host permits it.

## Goal

Make MCP the canonical host runtime path for activation planning and define a
standing authorization contract for automatic subagent use.

The design must:

- Prefer plugin MCP tools over PATH-based CLI wrappers for all hosts.
- Expose activation planning as a structured MCP tool.
- Define when `AGENTS.md` can count as standing project authorization.
- Preserve host tool policy: if a host still requires current-session explicit
  authorization, Immune-Brain must fall back with a named reason instead of
  pretending dispatch occurred.

## Requirements

### R1. MCP-first runtime

Codex, Cursor, and Claude Code documentation must describe MCP as the primary
runtime integration. `plugins/immune-brain/bin/imm-*` remains only for manual
debugging or hosts without MCP support.

Runtime docs must warn users not to place old managed-copy wrappers ahead of the
plugin runtime path as the main integration.

### R2. Activation plan MCP tool

The plugin MCP runtime must expose `imm_activation_plan` with structured inputs
equivalent to the activation planner CLI:

- `changed_paths`
- `task_summary`
- `host`
- `explicit_solo`
- `explicit_subagents`
- `activation_mode`
- `activation_overrides`
- `unbounded`
- `dispatch_unavailable`
- `validate_refs`
- `record_dispatch_telemetry`
- `execution_status`

The MCP tool returns the same JSON activation plan shape as
`.imm/activation_plan.py`.

### R3. Standing authorization contract

Immune-Brain must distinguish activation eligibility from host authorization.

Eligibility is resolved by `[subagent_activation]`, trigger matches, boundary
checks, and runtime availability.

Authorization is resolved separately from these sources, in priority order:

1. Current user message explicitly asks for solo work: deny dispatch.
2. Current user message explicitly asks for subagents or parallel agent work:
   allow dispatch for the current request.
3. Session-level user instruction grants Immune-Brain permission to use
   subagents automatically: allow dispatch for the current session when
   eligibility passes.
4. Project `AGENTS.md` declares standing authorization: allow dispatch only if
   the host treats project instructions as sufficient user authorization.
5. No authorization source: do not dispatch; return a named fallback.

### R4. New fallback reason

When activation eligibility passes but host authorization is not sufficient,
hosts must return:

- `host_authorization_required`: the activation plan recommends dispatch, but
  the current host requires explicit user authorization before spawning
  subagents.

This reason must not be reported as `trigger_not_hit`, `explicit_required`, or
`unavailable_environment`.

### R5. AGENTS.md wording

Project templates may include standing authorization wording, but the wording
must not claim it overrides host tool policy.

Recommended meaning:

```md
When Immune-Brain `[subagent_activation]` resolves to `auto` and the activation
plan returns triggered candidates, this project authorizes bounded advisory
subagent or readonly parallel-probe work unless the user asks for solo work.
If the current host still requires current-session authorization, ask once for
session-level authorization and record `host_authorization_required`.
```

### R6. Skill contract wording

Subagent-capable host Skills must use this sequence:

1. Call MCP `imm_activation_plan`.
2. If no candidates are returned, stay solo with the planner fallback reason.
3. If candidates are returned, resolve authorization source.
4. Dispatch only when both eligibility and authorization pass.
5. Otherwise report `host_authorization_required` and offer the one-line
   session authorization phrase.

## Non-goals

- No attempt to bypass Codex `spawn_agent` policy.
- No background scheduler.
- No automatic cross-session queue.
- No shared runtime registry.
- No automatic edits outside docs/specs/plans/template surfaces in this slice.
- No removal of `bin/` wrappers; they remain useful for manual debugging.

## Acceptance Criteria

- MCP tool list includes `imm_activation_plan`.
- Plugin-only copy can build an activation plan through MCP without PATH.
- README and policy docs define MCP as the primary runtime path for Codex,
  Cursor, and Claude Code.
- Policy docs define `host_authorization_required`.
- Subagent host docs define the MCP-first eligibility then authorization flow.
- AGENTS template/docs define standing authorization without claiming it
  overrides host tool policy.
- Tests cover MCP activation planning and contract wording for the new fallback.

