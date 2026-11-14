# Layered configuration

Status: accepted; supersedes [ADR 0033](0033-lane-preferences-local-preset.md) and item 1 of [ADR 0024](0024-git-integration-preference.md).

## Context

Personal choices, repository policy and existing local configuration need a shared resolution order across Hosts and worktrees.

## Decision

Use the user configuration under `$XDG_CONFIG_HOME/immune-brain/config.json` (or `~/.config/immune-brain/config.json`) and tracked `.imm/config.json`. Resolve per-repository overrides by normalized origin, or the main checkout real path when no origin exists. Personal choices prefer per-project user overrides; repository facts and policy prefer the tracked project file. User egress can only narrow the project ceiling.

Expose each value with its source and diagnostics via `imm-kernel config --json` and both Hosts’ task status. Invalid sections fail closed; diagnostics never contain credential values. Tests isolate the user configuration directory.

Read the existing Lane, decision-model and tracked instruction-file sources for one major version, with deprecation or ignored-source warnings. Their owning later major release removes the compatibility readers after migration to the two new files. Existing consumers migrate in the subsequent slices of [the layered configuration Spec](../specs/layered-config.spec.md).

## Amendment: User-level `git_integration`

`immune_brain/user_config/v1` also accepts optional top-level `git_integration` (`"manual" | "auto"`), resolved with precedence `user → project → legacy → default` (`"manual"`). `projects.<project_key>.git_integration` remains disallowed (`config_invalid`, `unknown key`). A malformed user file, unknown top-level/`projects.<key>` error, or invalid `user.git_integration` fails `git_integration` closed to `"manual"` even when tracked `.imm/config.json` sets `"auto"`.
