# Spec: stale global imm-plan sync guard

## Goal

Prevent stale global `imm-plan` wrappers from hiding the plugin-local runtime
that already supports explicit `--sync`.

Users must have a legitimate sync path for Plans without hand-editing
`.imm/memory/current_iteration.json`.

## Requirements

### R1. MCP plan validation exposes explicit sync

The plugin MCP `imm_plan_validate` tool must accept a `sync` boolean.

When `sync` is true, the adapter must pass `--sync` to `imm-plan` after the
Plan path. The existing `json` boolean must continue to control `--json`.

Default behavior stays validate-only: absent `sync` means no runtime state
mutation.

### R2. Plugin-local CLI remains the command source of truth

`plugins/immune-brain/bin/imm-plan --help` and
`python3 plugins/immune-brain/dist/immune_brain_runtime.py cli imm-plan --help`
must expose `--sync`.

The fix must not depend on the legacy managed-copy runtime under
`~/.immune-brain/runtime/agent-skills`.

### R3. Health check reports stale global wrappers

`imm-heal` must detect when `command -v imm-plan` resolves to a wrapper that
does not expose `--sync` while the plugin-local runtime does.

The warning must explain that the stale global wrapper should be replaced or
removed, and that users should use the plugin-local wrapper or MCP tool in the
meantime.

### R4. Runtime state remains owned by imm-plan sync

No command may write or fabricate `.imm/memory/current_iteration.json` directly
to compensate for a missing `--sync` flag.

Only a validated `imm-plan <plan-path> --sync` flow may update plan-level State
Ledger metadata.

## Non-goals

- No manual editing of `.imm/memory/current_iteration.json`.
- No revival of the removed legacy installer as the primary install path.
- No deletion of user files under `~/.local/bin` or `~/.immune-brain`.
- No broad redesign of `imm-heal`.

## Acceptance Criteria

- [ ] MCP tool schema includes `sync` for `imm_plan_validate`.
- [ ] MCP tool calls include `--sync` only when requested.
- [ ] Plugin-local `imm-plan --help` exposes `--sync`.
- [ ] `imm-heal` warns when PATH points at a stale global wrapper.
- [ ] Automated tests cover validate-only default behavior and sync opt-in.
- [ ] Automated tests cover stale global wrapper detection without touching the
      real user home.

## Verification

- `python3 -m unittest tests.test_immune_brain_mcp_runtime`
- `python3 -m unittest tests.test_immune_brain_plugin_package`
- `python3 -m unittest discover -s tests`
