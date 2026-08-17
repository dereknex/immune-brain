# Spec: Host-specific Immune-Brain config runtime consumption

## Summary

Immune-Brain must stop relying on a global `~/.immune-brain/` directory for any local runtime content. Runtime-owned local files should live under the corresponding coding agent's own config directory. This includes `config.toml` plus local-only content such as dev-insights data, caches, diagnostics, or per-host scratch files, so Pi, Codex, Cursor, Claude Code, OpenCode, or future hosts do not influence each other.

## Problem

A read-only review of the current runtime found that local config is not consumed by the TypeScript CLI runtime. `imm-activation-plan` only reads CLI flags such as `--activation-mode`; a temporary config with `[subagent_activation].default = "disabled"` still returned `solo_fallback_reason: trigger_not_hit`. The newly added model-routing helpers accept a `config` object, but no runtime path reads an agent-local config file and passes it in.

This creates a misleading contract: docs say users can configure activation and model routing, while runtime behavior ignores those files. It also fails the multi-host requirement because different coding agents often need different model IDs, tool availability, cost defaults, diagnostics, and local runtime state. A single global Immune-Brain directory would mix host-specific choices in one place.

## Goals

- Add a coding-agent-local Immune-Brain root resolver.
- Add a runtime config loader for `<agent-root>/config.toml`.
- Keep zero-config behavior unchanged.
- Use each coding agent's own config directory as the default location for all local Immune-Brain content.
- Make activation policy and advisory model routing consume the loaded config.
- Preserve CLI flags as explicit overrides above file config.
- Keep local Immune-Brain files out of git.
- Provide focused tests proving that agent-local config files change runtime behavior and that the old global directory is not used by default.

## Non-goals

- No generic authority dispatcher.
- No project-local committed config in this slice.
- No secrets manager or credential storage.
- No provider-level live dispatch in tests.
- No full TOML implementation if the documented sections can be parsed by a small bounded parser.
- No dev-insights feature redesign; only its local file location follows the agent-native root if the runtime writes or reads it.
- No automatic fan-out migration from one old shared directory to every coding agent.
- No implicit fallback to `~/.immune-brain/config.toml` or any other `~/.immune-brain/*` path; that directory is retired from default discovery.

## Accepted behavior

### Agent-native local roots

The runtime first resolves an agent-local Immune-Brain root. Runtime-owned local files must live under that root. Config is then loaded from `<agent-root>/config.toml` unless an explicit config file path is provided.

The runtime loads config in this order:

1. Explicit config path: `IMMUNE_BRAIN_CONFIG` if set.
2. Explicit agent config path: `IMMUNE_BRAIN_AGENT_CONFIG` if set.
3. `<agent-root>/config.toml` for the resolved coding agent.
4. Built-in defaults.
5. CLI flags and host-provided explicit values override all file config.

There is no default global Immune-Brain directory. The old `~/.immune-brain/` root is not read or written unless a user explicitly points a file-level override such as `IMMUNE_BRAIN_CONFIG` at one file inside it. That explicit bridge does not make the rest of the old directory active.

The supported initial agent ids and default roots are:

| Agent id | Agent-native Immune-Brain root | Default config path |
|---|---|---|
| `pi` | `~/.pi/agent/immune-brain/` | `~/.pi/agent/immune-brain/config.toml` |
| `codex` | `~/.codex/immune-brain/` | `~/.codex/immune-brain/config.toml` |
| `cursor` | `~/.cursor/immune-brain/` | `~/.cursor/immune-brain/config.toml` |
| `claude-code` | `~/.claude/immune-brain/` | `~/.claude/immune-brain/config.toml` |
| `opencode` | `~/.config/opencode/immune-brain/` | `~/.config/opencode/immune-brain/config.toml` |

OpenCode may also support `~/.opencode/immune-brain/` as a compatibility fallback only if the primary `~/.config/opencode/immune-brain/` root is absent, because both directories appear in real developer environments.

The agent id may come from a CLI flag such as `--coding-agent <id>` or from `IMMUNE_BRAIN_CODING_AGENT`. Unknown ids are allowed after normalization to lowercase `[a-z0-9-]`, but path traversal, slashes, and empty ids are rejected.

### Merge semantics

- Missing config files are ignored.
- `IMMUNE_BRAIN_CONFIG` and `IMMUNE_BRAIN_AGENT_CONFIG` are explicit file paths, not global defaults.
- When both explicit paths are present, the agent config path overlays the base explicit path.
- Coding-agent native root is a single default directory, not an overlay over `~/.immune-brain`.
- Tables merge recursively when two explicit config files are provided.
- Scalars replace scalars.
- Arrays replace arrays.
- `inherit` remains a normal scalar value and means “omit provider model parameter.”

### Runtime consumers

The first executable slice must wire the agent-local root and loaded config into:

- `imm-activation-plan` for `[subagent_activation]` defaults and host/lens/subagent overrides.
- advisory model resolution for `[subagent_models]`, `[subagent_models.lens_overrides]`, `[workflow]`, and `[workflow_models]`.
- planner ensemble helper input when no explicit config object is passed.
- any runtime helper that would otherwise read or write local Immune-Brain files under `~/.immune-brain/*`.

The activation planner must keep explicit CLI flags above file config:

1. `--explicit-solo` / `--explicit-subagents`
2. `--activation-mode`
3. `IMMUNE_BRAIN_AGENT_CONFIG`
4. `IMMUNE_BRAIN_CONFIG`
5. coding-agent native config path
6. built-in default

### Host-specific examples

Pi config:

```toml
# ~/.pi/agent/immune-brain/config.toml
[subagent_activation]
default = "auto"

[workflow]
model_preset = "balanced"

[subagent_models]
fast = "deepseek/deepseek-v4-flash"
mid = "deepseek/deepseek-v4-pro"
strong = "inherit"
local = "inherit"
```

Codex config:

```toml
# ~/.codex/immune-brain/config.toml
[subagent_activation]
default = "explicit_only"

[workflow]
model_preset = "off"
```

Cursor config:

```toml
# ~/.cursor/immune-brain/config.toml
[subagent_models]
fast = "anthropic/claude-haiku-4-5"
mid = "anthropic/claude-sonnet-4-6"
strong = "anthropic/claude-opus-4-5"
```

OpenCode config:

```toml
# ~/.config/opencode/immune-brain/config.toml
[subagent_activation]
default = "auto"

[workflow]
model_preset = "budget"
```

Claude Code config:

```toml
# ~/.claude/immune-brain/config.toml
[subagent_activation]
default = "explicit_only"

[subagent_models]
fast = "inherit"
mid = "inherit"
strong = "inherit"
```

### Legacy directory migration

The old shared directory should be moved into exactly one corresponding coding agent root, not copied to every agent. For example, if the old directory belonged to Pi usage:

```bash
mkdir -p ~/.pi/agent
mv ~/.immune-brain ~/.pi/agent/immune-brain
```

If multiple coding agents previously shared the old directory, users should split only the known host-specific content manually. The runtime must not guess ownership or silently fan out shared state.

### Security and privacy

Local root contents must not be dumped in command output. Tests may inspect derived behavior, but runtime diagnostics should redact keys containing `token`, `key`, `secret`, `password`, or `jwt` if a future diagnostic command prints config summaries.

## Compatibility

Existing users with no agent-local root see unchanged behavior. Existing `--activation-mode disabled` still returns `config_disabled`. Existing helper tests that pass explicit config objects remain valid. The loader is additive and should not change State Ledger schema. Existing `~/.immune-brain/` users need to move the relevant directory contents into their coding agent's root. `IMMUNE_BRAIN_CONFIG` can temporarily point to an old config file, but that does not migrate or activate the rest of the old directory.

## Verification expectations

- A temp HOME with `~/.pi/agent/immune-brain/config.toml` containing `[subagent_activation].default = "disabled"` changes `imm-activation-plan --coding-agent pi` output to `config_disabled`.
- A temp HOME with `~/.codex/immune-brain/config.toml` disabled does not affect `--coding-agent pi`.
- A temp HOME with files only under old `~/.immune-brain/` does not affect runtime behavior unless `IMMUNE_BRAIN_CONFIG` points to one explicit config file.
- Runtime-owned local path helpers resolve dev-insights/cache/diagnostic paths under the agent-native root, not `~/.immune-brain/`.
- CLI `--activation-mode auto` or `disabled` overrides file defaults.
- `[subagent_models]` and `[workflow_models]` from agent-local file config drive model resolution without manually passing a config object.
- Invalid coding-agent ids with slashes or traversal are rejected.
- Docs describe agent-native roots, precedence, merge semantics for explicit paths, migration guidance for the entire old directory, and examples.
- Dist docs stay synchronized.
