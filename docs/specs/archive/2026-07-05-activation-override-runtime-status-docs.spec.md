# Spec: Document runtime support status of activation override tables

## Summary

Immune-Brain config docs currently present `[subagent_activation.hosts]`, `[subagent_activation.lenses]`, and `[subagent_activation.subagents]` as equally supported override tables. Runtime only consumes `hosts` and `default`; `lenses` and `subagents` are documented-but-not-yet-runtime-backed. Docs should say so explicitly to avoid misleading users.

## Problem

A post-closure `imm-code-review` found that:

- `docs/reference/immune-brain-config.md` lists `hosts`, `lenses`, `subagents` override tables without distinguishing runtime-backed from documented-only.
- `docs/reference/automatic-subagent-activation-policy.md` declares `activation_overrides: {hosts, lenses, subagents}` as the full contract.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` only reads `hosts[host]` and `default`; `lenses` / `subagents` override tables have no runtime consumer.

This is a docs-vs-runtime honesty gap, not a runtime bug. Plan 003 D5 explicitly deferred `lenses` / `subagents` runtime consumption.

## Goals

- Mark `[subagent_activation.lenses]` and `[subagent_activation.subagents]` as documented-but-not-yet-runtime-backed in config docs.
- Keep `[subagent_activation.hosts]` and `[subagent_activation].default` as runtime-backed.
- Sync packaged dist mirror docs.
- No runtime, test, or State Ledger changes.

## Non-goals

- No runtime implementation of `lenses` / `subagents` override tables.
- No change to activation plan behavior.
- No change to `hosts` or `default` runtime support.
- No change to solution/historical docs.

## Accepted behavior

### Config docs annotation

`docs/reference/immune-brain-config.md` adds a short note under `[subagent_activation]` stating:

- `default` and `hosts` are runtime-backed.
- `lenses` and `subagents` are documented for forward compatibility but not yet consumed by the TypeScript CLI runtime.

`docs/reference/automatic-subagent-activation-policy.md` adds a matching note that `activation_overrides.lenses` and `activation_overrides.subagents` are not yet runtime-backed.

### Dist mirror

Packaged dist copies stay synchronized via `bun scripts/sync-dist-docs.ts`.

## Compatibility

- No runtime change.
- No behavior change.
- Existing config files remain valid; `lenses` / `subagents` tables parse but are ignored, same as today.

## Verification expectations

- Config docs name `default` and `hosts` as runtime-backed.
- Config docs name `lenses` and `subagents` as not-yet-runtime-backed.
- `automatic-subagent-activation-policy.md` carries the same distinction.
- Dist mirror docs stay synchronized.
- `git diff --check` passes.
