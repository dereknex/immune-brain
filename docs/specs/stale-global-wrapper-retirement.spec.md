# Spec: Stale Global Wrapper Retirement

## Goal

Give users a safe explicit path to retire or replace stale global
`imm-plan` wrappers after `imm-heal` detects that PATH is shadowing the
plugin-local runtime.

The previous `stale-global-imm-plan-sync` slice made the supported sync path
reachable and added the warning. This follow-up closes the operator gap: the
warning should point to a bounded action that can be previewed before any user
file changes.

## Requirements

### R1. Retirement action is explicit

Provide a deterministic command or script path that can inspect the PATH
resolved `imm-plan` wrapper and decide whether it is a stale Immune-Brain
managed-copy wrapper.

The default mode must be dry-run/report-only. Any file mutation must require an
explicit apply flag or equivalent opt-in.

### R2. Only known managed-copy wrappers are eligible

The retirement path may only act on wrappers that carry Immune-Brain managed
copy markers such as:

- `imm-install-mode: copy`
- `imm-install-family: agent-skills`
- `imm-install-runtime-root:`

Unmarked files, symlinks, or unrelated user scripts must be reported as
ineligible and left untouched.

### R3. Plugin-local runtime remains the source of truth

The replacement or guidance must point to the plugin-local command surface:

- `plugins/immune-brain/bin/imm-plan`
- MCP `imm_plan_validate` with `sync: true`

The solution must not revive the old managed-copy installer as the primary
installation path.

### R4. Health output is actionable without being destructive

`imm-heal` may keep warning about the stale wrapper, but the warning should name
the bounded retirement command or script so the next action is obvious.

The health check itself must not delete or rewrite files.

## Non-Goals

- No silent deletion of files under `~/.local/bin`, `~/.immune-brain`, or any
  user directory.
- No broad redesign of `imm-heal`.
- No revival of legacy managed-copy install as the default runtime path.
- No direct editing of `.imm/memory/current_iteration.json` outside validated
  Plan sync.

## Acceptance Criteria

- [ ] A dry-run retirement command identifies the current stale global
      `imm-plan` wrapper as eligible because it has managed-copy markers.
- [ ] The same command refuses unmarked wrapper files.
- [ ] Apply mode is explicit and covered by a temp-directory test without
      touching the real user home.
- [ ] `imm-heal` warning text names the retirement path while preserving the
      plugin-local and MCP fallback guidance.
- [ ] Plugin-local `imm-plan --help` still exposes `--sync`.

## Verification

- `python3 -m unittest tests.test_immune_brain_plugin_package`
- `python3 -m unittest tests.test_immune_brain_mcp_runtime`
- `python3 .imm/imm-heal.py`
