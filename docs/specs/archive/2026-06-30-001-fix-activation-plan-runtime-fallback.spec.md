---
title: "fix: activation plan runtime fallback is discoverable"
type: fix
status: proposed
date: 2026-06-30
origin: imm-code-review reported same-boundary follow-ups after solo fallback because activation runtime was unavailable
---

# Spec: Activation Plan Runtime Fallback Discoverability

## Goal

Keep Immune-Brain review delegation **MCP-first** while making the `imm_activation_plan`
activation runtime discoverable through a guaranteed plugin-local CLI fallback. A review
host should not fall back to solo merely because `imm-activation-plan` is not installed
on `PATH` when the plugin-local runtime can execute the same command.

## Problem

During use, `imm-code-review` completed as a solo review even though the main code path
and focused tests were judged sufficient. The stated solo reason was:

> current environment has no `imm_activation_plan` MCP / `imm-activation-plan` CLI, so
> the subagent activation chain is unavailable.

Repository evidence shows the production runtime already exposes an activation surface:

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` registers `imm_activation_plan`
  in MCP tool metadata and maps it to `imm-activation-plan`.
- `plugins/immune-brain/bin/imm-activation-plan` exists, is executable, and delegates to
  `bun <plugin-root>/runtime/immune_brain_runtime.ts cli imm-activation-plan`.
- `plugins/immune-brain/.mcp.json` starts the Bun/TypeScript MCP launcher.

The gap is therefore not a reason to switch the architecture to CLI-only. The gap is that
the review contract and regression surface do not make the fallback order explicit enough:
MCP first, then plugin-local CLI, then optional installed CLI, and only then an unavailable
solo fallback.

## Accepted Behavior

### R1. MCP remains the host-facing default

For activation-plan-capable hosts, `imm-code-review` continues to prefer the plugin MCP
`imm_activation_plan` tool. The architecture must not replace MCP with a CLI-only design
for Codex, Cursor, Claude Code, or other MCP-capable hosts.

### R2. Plugin-local CLI is the guaranteed fallback

If the host cannot call MCP, the documented fallback is the plugin-local wrapper:

```bash
plugins/immune-brain/bin/imm-activation-plan
```

or its equivalent runtime command:

```bash
bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-activation-plan
```

A missing `PATH` entry for `imm-activation-plan` is not, by itself, activation runtime
unavailability.

### R3. Installed CLI is optional

A globally installed `imm-activation-plan` wrapper may be used when present, but the skill
contract must not require it. Plugin-local runtime ownership is the source of truth.

### R4. Unavailable fallback reason is explicit

Only when both MCP and plugin-local CLI fallback are unavailable should review report a
solo fallback with a runtime-specific reason such as `activation_runtime_unavailable`.
That reason is distinct from trigger outcomes like `trigger_not_hit`, policy outcomes like
`explicit_required`, and authorization outcomes like `host_authorization_required`.

### R5. Same-boundary follow-ups route to execution, not planning

If `imm-code-review` finds direct same-boundary fixes, it should emit first-class
`follow_up` handoff data for `imm-work`/execution continuation. It should not ask the
planner to mutate a Plan for repairs that stay inside the already-reviewed boundary.

## Acceptance Criteria

- [ ] Runtime surface tests prove `imm_activation_plan` appears in `list-tools`, framed
      MCP `tools/list`, and MCP `tools/call` responses.
- [ ] Runtime surface tests prove `plugins/immune-brain/bin/imm-activation-plan` and
      `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-activation-plan`
      both execute successfully from the repository root.
- [ ] Contract tests prove `imm-code-review` source and packaged skill text state the
      ordered fallback: MCP -> plugin-local CLI -> optional installed CLI ->
      `activation_runtime_unavailable`.
- [ ] Contract tests prove the skill does not recommend CLI-only replacement of MCP.
- [ ] Contract tests prove same-boundary review follow-ups remain routed to execution
      handoff instead of planner mutation.
- [ ] Documentation that mentions activation fallback names the plugin-local wrapper,
      not only an installed `PATH` command.

## Non-goals

- Do not replace MCP with CLI-only runtime integration.
- Do not implement actual subagent dispatch or host authorization policy changes.
- Do not require a globally installed `imm-activation-plan` wrapper.
- Do not re-open the retired Python runtime as a production fallback.
- Do not redesign the activation catalog or reviewer lens selection rules.
