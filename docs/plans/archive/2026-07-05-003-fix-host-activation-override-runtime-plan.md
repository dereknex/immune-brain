---
title: "fix: host activation override runtime consumption"
type: fix
status: planned
date: 2026-07-05
origin:
  - imm-code-review same-boundary finding on host-specific local root runtime
  - docs/specs/archive/2026-07-05-host-activation-override-runtime.spec.md
---

# Iteration Plan

## Task

- Summary: Make `imm-activation-plan` consume `[subagent_activation.hosts]` host overrides above `[subagent_activation].default`, so a host-specific `disabled` override returns `config_disabled`.
- Spec: `docs/specs/archive/2026-07-05-host-activation-override-runtime.spec.md`
- Origin: A same-boundary `imm-code-review` found that docs promise host overrides but runtime only reads `default`. The prior host-specific local root Plan was already closed and finished, so this is a new follow-up slice.
- Scope Mode: New follow-up slice. The previous Plan is closed and intentionally reset, so this Plan does not append closed Step history.
- Planner research dispatch: solo. The failure mode is local, bounded, and supported by direct runtime/code evidence.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, commands, schema fields, TOML table names, env var names, CLI flags, model ids, Skill names, and canonical terms such as `Step`, `Plan`, `Spec`, `State Ledger`, and `Activation Plan`.

## Research

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` `runActivationPlanCommand` reads only `loaded.config.subagent_activation?.default` and ignores `[subagent_activation.hosts]`.
- `plugins/immune-brain/runtime/imm_core.ts` `AdvisoryDispatchConfig.subagent_activation` is typed as `{ default?: string }`, so the parser already accepts `hosts` as a nested table but the type does not expose it.
- `docs/reference/immune-brain-config.md` documents `[subagent_activation.hosts]` and precedence: lens/subagent override > host override > default.
- `docs/reference/automatic-subagent-activation-policy.md` repeats the same precedence.
- A temp HOME repro with host override `disabled` returned `trigger_not_hit` instead of `config_disabled`.
- `tests/activation-config-runtime.test.ts` already covers file-backed `default`, agent isolation, and `IMMUNE_BRAIN_CODING_AGENT`; it does not yet cover host overrides.

## Decisions

- D1: Resolve activation mode as `hosts[host] > default > auto` in `imm-activation-plan`.
- D2: Keep CLI `--activation-mode` above file config.
- D3: Extend `AdvisoryDispatchConfig.subagent_activation` to type `hosts?: Record<string, string>`. Do not type `lenses` or `subagents` in this slice.
- D4: Do not change agent-local root resolution, migration docs, or State Ledger schema.
- D5: Do not implement lens or subagent override tables in this slice; docs keep them as documented-but-not-yet-runtime-backed.

## Assumptions

- `[subagent_activation.hosts]` values use the same valid mode set: `auto`, `explicit_only`, `disabled`.
- Invalid host override values should still be rejected by `validateActivationMode`.
- Missing `hosts` or missing host key falls back to `default`.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: adding host override resolution could change behavior for users who set `hosts` but expected it to be ignored.
- Mitigation: docs already promise host overrides, so honoring them is a fix, not a behavior change. Rollback is confined to the runtime activation line, type surface, and focused tests.

### 2. Verification Vanity

- Risk: tests might only check that `hosts` is parsed without proving runtime output changes.
- Mitigation: U1 requires a temp HOME black-box CLI test proving `imm-activation-plan --host imm-code-review --coding-agent pi` returns `config_disabled` when the host override is `disabled`, and `trigger_not_hit` when `--activation-mode auto` overrides it.

### 3. Spec Dilution Detection

- Risk: the Plan could silently expand into lens or subagent override tables.
- Mitigation: D5 explicitly defers `lenses` and `subagents` runtime consumption; only `hosts` is in scope.

## Planning Quality Gate

- **contract surface**: `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `tests/activation-config-runtime.test.ts`, and `docs/reference/immune-brain-config.md`.
- **compatibility**: Missing `hosts` preserves current behavior. Existing `default` users see no change. State Ledger schema does not change.
- **interruption recovery**: If U1 is interrupted before runtime wiring, no command consumes host overrides, so behavior stays current.
- **rollback path**: Revert the activation mode resolution line, the type extension, and the focused tests together.
- **verification strength**: Use temp HOME black-box CLI tests plus focused unit tests. Avoid grep-only proof.
- **Brainstorm traceability**: No formal brainstorm manifest exists for this direct follow-up. The review finding maps directly to U1.

## Steps

### Step 1

- Step ID: U1
- Result: Activation plan resolves host override above default.
- Verification type: automated
- Verification: `bun test tests/activation-config-runtime.test.ts tests/immune-brain-config-runtime.test.ts && git diff --check`
- Execution note: test-first
- Test scenarios: temp HOME `[subagent_activation.hosts].imm-code-review = "disabled"` makes `imm-activation-plan --host imm-code-review --coding-agent pi` return `config_disabled`; `--activation-mode auto` overrides the host override; `[subagent_activation].default = "disabled"` still returns `config_disabled`; missing `hosts` falls back to `default`; missing config preserves `trigger_not_hit`.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (activation command wiring); plugins/immune-brain/runtime/imm_core.ts (config type and loader); tests/activation-config-runtime.test.ts (existing file-backed activation tests)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If host override values outside the valid mode set appear, `validateActivationMode` should reject them; do not silently coerce.
- security_considerations: Host override values are local preferences; do not print raw config in diagnostics.

## Test Scenarios

- A user with no `hosts` table gets current behavior.
- A user with `[subagent_activation.hosts].imm-code-review = "disabled"` gets `config_disabled` for that host.
- A user with `default = "disabled"` still gets `config_disabled`.
- CLI `--activation-mode auto` overrides a disabled host override.
- Invalid host override values are rejected by `validateActivationMode`.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-003-fix-host-activation-override-runtime-plan.md --json`
- Do not sync or execute this Plan until the user confirms.

## Next Action

- If the user approves execution, sync this Plan and start U1 through `imm-work`.
