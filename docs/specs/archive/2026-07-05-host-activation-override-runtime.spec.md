# Spec: Host activation override runtime consumption

## Summary

Immune-Brain `imm-activation-plan` must honor `[subagent_activation.hosts]` overrides read from the selected coding agent's local config. Today the runtime only reads `[subagent_activation].default`, so a host-specific `disabled` override is ignored and the activation plan reports `trigger_not_hit` instead of `config_disabled`.

## Problem

A same-boundary `imm-code-review` found that:

- `docs/reference/immune-brain-config.md` documents `[subagent_activation.hosts]` with precedence above `[subagent_activation].default`.
- `docs/reference/automatic-subagent-activation-policy.md` repeats that precedence.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` `runActivationPlanCommand` only reads `loaded.config.subagent_activation?.default`.
- A temp HOME config with:

  ```toml
  [subagent_activation]
  default = "auto"

  [subagent_activation.hosts]
  imm-code-review = "disabled"
  ```

  still returns `solo_fallback_reason: trigger_not_hit` for `imm-activation-plan --host imm-code-review --coding-agent pi`, instead of `config_disabled`.

This is a contract gap: docs promise host overrides, runtime ignores them.

## Goals

- Make `imm-activation-plan` resolve host overrides from `[subagent_activation.hosts][host]` above `[subagent_activation].default`.
- Preserve explicit CLI `--activation-mode` above file config.
- Preserve agent-local root isolation and zero-config behavior.
- Keep the resolved mode validation (`auto` / `explicit_only` / `disabled`).
- Provide focused regression tests proving host override changes runtime output.

## Non-goals

- No lens-level or subagent-level override implementation in this slice.
- No generic dispatcher or new activation host.
- No change to State Ledger schema.
- No change to agent-local root resolution or migration docs.
- No provider live dispatch in tests.

## Accepted behavior

### Resolution order

For a given `--host <host>`:

1. `--explicit-solo` / `--explicit-subagents` (handled by `resolveActivationMode`).
2. `--activation-mode` CLI flag.
3. `[subagent_activation.hosts][host]` from the loaded agent-local config.
4. `[subagent_activation].default` from the loaded agent-local config.
5. built-in default `auto`.

A `disabled` host override produces `solo_fallback_reason: config_disabled`. An `explicit_only` host override without an explicit subagent request continues to produce `explicit_required` only when the host skill later checks that; the activation plan itself still reports the resolved mode and `solo_fallback_reason` consistent with the current minimal host model (`config_disabled` when disabled, otherwise `trigger_not_hit`).

### Type surface

`AdvisoryDispatchConfig.subagent_activation` becomes:

```ts
subagent_activation?: {
  default?: string
  hosts?: Record<string, string>
}
```

`lenses` and `subagents` override tables remain documented but are out of scope for runtime consumption in this slice.

### CLI behavior

- `imm-activation-plan --host imm-code-review --coding-agent pi` reads `~/.pi/agent/immune-brain/config.toml`.
- `[subagent_activation.hosts].imm-code-review = "disabled"` changes output to `config_disabled`.
- `--activation-mode auto` overrides a `disabled` host override.
- Missing config preserves current `trigger_not_hit` behavior.

## Compatibility

- Existing users with no `[subagent_activation.hosts]` see unchanged behavior.
- Existing `[subagent_activation].default` users see unchanged behavior.
- State Ledger schema does not change.
- Agent-local root resolution and the retired `~/.immune-brain/` default do not change.

## Verification expectations

- A temp HOME with `[subagent_activation.hosts].imm-code-review = "disabled"` makes `imm-activation-plan --host imm-code-review --coding-agent pi` return `config_disabled`.
- A temp HOME with only `[subagent_activation].default = "disabled"` still returns `config_disabled`.
- A temp HOME with host override `disabled` but CLI `--activation-mode auto` returns `trigger_not_hit`.
- Missing config preserves `trigger_not_hit`.
