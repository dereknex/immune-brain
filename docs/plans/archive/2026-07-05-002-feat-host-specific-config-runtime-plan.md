---
title: "feat: host-specific local root runtime consumption"
type: feat
status: planned
date: 2026-07-05
origin:
  - user requested follow-up plan for config.toml taking real effect
  - user requested considering different coding agents using different config files
  - user requested moving all ~/.immune-brain contents into corresponding coding-agent directories
  - docs/specs/archive/2026-07-05-host-specific-config-runtime.spec.md
---

# Iteration Plan

## Task

- Summary: Make local Immune-Brain runtime files real inputs under each coding agent's own config directory, without relying on a global `~/.immune-brain/` folder.
- Spec: `docs/specs/archive/2026-07-05-host-specific-config-runtime.spec.md`
- Origin: A read-only `imm-code-review` check found that local config is currently documentation-only for the TypeScript CLI runtime. The user asked to append a plan that accounts for different coding agents using their own configuration directories, then clarified that all old `~/.immune-brain/` contents should move into the corresponding coding-agent directory to avoid cross-host influence.
- Scope Mode: New follow-up slice. The previous multi-model advisory dispatch Plan is closed and intentionally reset, so this Plan does not append closed Step history.
- Planner research dispatch: solo. The failure mode is local, bounded, and supported by direct runtime/code evidence.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, commands, schema fields, TOML table names, env var names, CLI flags, model ids, Skill names, and canonical terms such as `Step`, `Plan`, `Spec`, `State Ledger`, and `Activation Plan`.

## Research

- `.imm/memory/current_iteration.json` shows the prior Plan is `idle`, `intentional_reset`, and all U1-U3 steps are closed. Append-to-closed-step is not legal; this is a new slice.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` currently builds `imm-activation-plan` from CLI flags only. It uses `parseOption(args, "--activation-mode") || "auto"` and does not read local config files.
- `plugins/immune-brain/runtime/imm_core.ts` contains `AdvisoryDispatchConfig`, `resolveAdvisoryModel`, `resolveWorkflowStageModels`, and `buildPlannerEnsembleRequest`, but those helpers only consume a config object that a caller has already supplied.
- `~/.immune-brain/config.toml` exists on the current machine but only contains `[dev_insights]`. A temporary config with `[subagent_activation].default = "disabled"` still returned `solo_fallback_reason: trigger_not_hit`, proving the CLI does not load config files.
- Existing docs and README references still mention `~/.immune-brain/config.toml`, `~/.immune-brain/insights/workflow-improvement-inbox.md`, and `~/.immune-brain/runtime/agent-skills`; these references need to move to agent-native local roots or become explicit legacy notes.
- `docs/reference/immune-brain-config.md` documents `[subagent_activation]`, `[workflow]`, `[workflow_models]`, `[subagent_models]`, and lens overrides, but the implementation does not yet honor agent-local files.
- Different coding agents need different local model ids and local runtime content: Pi may use DeepSeek model ids and insights under `~/.pi/agent/immune-brain/`, Cursor may use Anthropic model ids under `~/.cursor/immune-brain/`, Codex may prefer `explicit_only` or `off` under `~/.codex/immune-brain/`, and OpenCode/Claude Code may have their own tool constraints.
- `docs/reference/planning-quality-gate.md` applies because this slice touches runtime config, cross-host behavior, packaged docs, local runtime paths, and subagent dispatch contracts.

## Decisions

- D1: Use coding-agent-native Immune-Brain roots by default instead of a global `~/.immune-brain/` folder.
- D2: Keep zero-config behavior unchanged.
- D3: Support explicit override env vars: `IMMUNE_BRAIN_CONFIG`, `IMMUNE_BRAIN_AGENT_CONFIG`, and `IMMUNE_BRAIN_CODING_AGENT` without making them default global paths.
- D4: Add a `--coding-agent <id>` CLI input where runtime commands need deterministic host-specific root resolution.
- D5: Keep CLI flags above file config so tests and user commands can force behavior.
- D6: Use a bounded parser for the documented TOML subset unless a built-in or existing dependency is already available. Do not add a dependency just to parse the current simple tables.
- D7: Do not expand this into a generic dispatcher or provider-specific secret store.
- D8: Treat old `~/.immune-brain/` as retired from default discovery; users may move its contents into one corresponding coding-agent root, or point `IMMUNE_BRAIN_CONFIG` at one legacy config file only as an explicit bridge.
- D9: Do not auto-copy the old global directory into every coding-agent root because that would preserve cross-host contamination.

## Assumptions

- Local Immune-Brain root contents are local preferences/state, not project state, and should not be written to git.
- Missing agent-local roots and config files are normal and must not produce warnings during ordinary commands.
- Host detection may be explicit at first; automatic host detection can be deferred unless already available from the current runtime.
- The first implementation can cover the TypeScript CLI runtime only. External host tools can pass equivalent config objects or root paths later.
- Redaction is required only for diagnostics that print config or local-root summaries; ordinary command outputs should show derived behavior, not raw file contents.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: reading agent-local files could change behavior for users unexpectedly.
- Mitigation: zero-config remains unchanged; CLI flags stay highest priority; tests cover missing files and explicit overrides. Rollback is confined to the local-root resolver, config loader, runtime wiring, docs, and focused tests.

### 2. Verification Vanity

- Risk: tests might only check that docs mention agent-local paths while runtime still ignores them.
- Mitigation: U1 and U2 require temp HOME runtime tests proving `imm-activation-plan` output changes when agent-local files change. Model resolution tests must load from file, not pass inline config objects. Local-root tests must prove old `~/.immune-brain/*` is ignored by default.

### 3. Spec Dilution Detection

- Risk: the Plan could reintroduce a global `~/.immune-brain/` base root and only add per-agent overlays.
- Mitigation: U1 requires agent-native roots as defaults and explicitly rejects old global discovery. U2 requires `--coding-agent` / `IMMUNE_BRAIN_CODING_AGENT` behavior. U3 documents whole-directory migration into Pi, Codex, Cursor, Claude Code, and OpenCode roots.

## Planning Quality Gate

- **contract surface**: `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, CLI wrappers under `plugins/immune-brain/bin/`, `README.md`, `docs/reference/immune-brain-config.md`, `docs/reference/automatic-subagent-activation-policy.md`, `docs/reference/subagent-dispatch-protocol.md`, `docs/reference/workflow-and-subagents.md`, packaged dist docs, and focused Bun tests.
- **compatibility**: Missing agent-local roots preserve current behavior. Existing CLI flags remain valid and override file config. State Ledger schema does not change. Old `~/.immune-brain/*` content is ignored unless an explicit file path such as `IMMUNE_BRAIN_CONFIG` selects one file.
- **interruption recovery**: If U1 is interrupted, no runtime command should consume partial local-root behavior. If U2 is interrupted, helper tests may pass but CLI config behavior remains disabled until runtime wiring is complete.
- **rollback path**: Revert the local-root resolver, config loader/helper changes, runtime command wiring, focused tests, and docs together.
- **verification strength**: Use temp HOME black-box CLI tests for agent-native directories plus unit tests for explicit env override precedence, local-root path resolution, and invalid coding-agent ids. Avoid grep-only proof.
- **Brainstorm traceability**: No formal brainstorm manifest exists for this direct follow-up. The user's requested items map directly to U1-U3.

## Steps

### Step 1

- Step ID: U1
- Result: Runtime local root resolves agent-native precedence.
- Verification type: automated
- Verification: `bun test tests/immune-brain-config-runtime.test.ts && git diff --check`
- Execution note: test-first
- Test scenarios: missing agent-local roots return empty config; `~/.pi/agent/immune-brain/config.toml` parses documented tables; `~/.codex/immune-brain/config.toml` does not affect Pi; local dev-insights/cache/diagnostic path helpers resolve under `~/.pi/agent/immune-brain/`; `~/.config/opencode/immune-brain/` is the primary OpenCode root; `~/.opencode/immune-brain/` is a fallback only when the primary root is absent; `IMMUNE_BRAIN_CONFIG` selects an explicit config file; `IMMUNE_BRAIN_AGENT_CONFIG` overlays an explicit base path; `--coding-agent` style ids normalize safely; slash or traversal ids are rejected; old `~/.immune-brain/*` is ignored by default.
- Discovery cache: plugins/immune-brain/runtime/imm_core.ts (local root and config helper home); tests/advisory-dispatch-core.test.ts (existing model config assertions); docs/reference/immune-brain-config.md (documented schema)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If TOML parsing grows beyond the documented subset, stop and replan before adding a parser dependency.
- security_considerations: Do not print raw local-root contents or config values in command output. Future diagnostics must redact keys containing token, key, secret, password, or jwt.

### Step 2

- Step ID: U2
- Result: Loaded local config drives routing.
- Verification type: automated
- Verification: `bun test tests/activation-config-runtime.test.ts tests/advisory-dispatch-core.test.ts tests/planner-ensemble-contract.test.ts tests/host-runtime-cutover.test.ts && git diff --check`
- Execution note: test-first
- Test scenarios: temp HOME `~/.pi/agent/immune-brain/config.toml` with `[subagent_activation].default = "disabled"` makes `imm-activation-plan --coding-agent pi` return `config_disabled`; `--activation-mode auto` overrides disabled file config; Codex config does not affect Pi runs; `IMMUNE_BRAIN_CODING_AGENT=pi` selects the Pi root; `[subagent_models]` from agent-local files affects resolved advisory model ids; `[workflow].model_preset` and `[workflow_models]` from agent-local files drive planner ensemble model entries; old `~/.immune-brain/config.toml` preserves current `trigger_not_hit` behavior unless explicitly selected.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (CLI command wiring); plugins/immune-brain/runtime/imm_core.ts (model and config helpers); tests/advisory-dispatch-core.test.ts (existing helper coverage); tests/planner-ensemble-contract.test.ts (planner ensemble helper coverage); tests/host-runtime-cutover.test.ts (runtime command guard)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If runtime cannot infer the current coding agent, require explicit `--coding-agent` or `IMMUNE_BRAIN_CODING_AGENT` and document automatic detection as deferred.
- security_considerations: Local config and local-root contents must not become State Ledger state and must not be persisted in Plan artifacts.

### Step 3

- Step ID: U3
- Result: Docs describe agent-local migration.
- Verification type: automated
- Verification: `bun test tests/dist-docs-sync-contract.test.ts tests/host-runtime-cutover.test.ts tests/activation-config-runtime.test.ts && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-002-feat-host-specific-config-runtime-plan.md --json && git diff --check`
- Test scenarios: docs name `~/.pi/agent/immune-brain/`, `~/.codex/immune-brain/`, `~/.cursor/immune-brain/`, `~/.claude/immune-brain/`, `~/.config/opencode/immune-brain/`, `IMMUNE_BRAIN_CONFIG`, `IMMUNE_BRAIN_AGENT_CONFIG`, `IMMUNE_BRAIN_CODING_AGENT`, and `--coding-agent`; docs state old `~/.immune-brain/` is retired from default discovery; docs describe moving the whole old directory into exactly one corresponding coding-agent root; docs show Pi, Codex, Cursor, Claude Code, and OpenCode examples; docs state CLI flags override files; packaged mirror docs stay synchronized.
- Discovery cache: README.md (user-facing old global path references); docs/reference/immune-brain-config.md (canonical config docs); docs/reference/automatic-subagent-activation-policy.md (activation policy docs); docs/reference/workflow-and-subagents.md (activation and model docs); docs/reference/subagent-dispatch-protocol.md (dispatch model resolution docs); plugins/immune-brain/dist/docs/reference/immune-brain-config.md (packaged mirror); scripts/sync-dist-docs.ts (mirror sync)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If docs and runtime diverge, treat the runtime tests as source of truth and update docs before recording evidence.

## Test Scenarios

- A user with no agent-local root gets exactly current default behavior.
- A user with only old `~/.immune-brain/` contents gets exactly current default behavior unless `IMMUNE_BRAIN_CONFIG` explicitly points to one config file.
- A user with `~/.pi/agent/immune-brain/config.toml` gets Pi-specific model slots only when running with Pi agent id.
- Runtime-owned local file helpers resolve under the selected coding-agent root.
- Codex can use a different default activation mode from Cursor without changing repo docs or State Ledger.
- CLI flags override config files.
- Invalid agent ids cannot escape the resolved coding-agent directory through path traversal.
- Model routing helpers can still be called with explicit config objects by host integrations.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-002-feat-host-specific-config-runtime-plan.md --json`
- Do not sync or execute this Plan until the user confirms.

## Next Action

- If the user approves execution, sync this Plan and start U1 through `imm-work`.
