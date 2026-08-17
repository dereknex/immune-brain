---
title: "fix: activation plan runtime fallback discoverability"
type: fix
status: proposed
date: 2026-06-30
origin: imm-code-review same-boundary follow-up after activation runtime unavailable solo fallback
---

# Iteration Plan

## Task

- Summary: Keep `imm_activation_plan` MCP-first while making the plugin-local `imm-activation-plan` CLI fallback discoverable, tested, and explicitly reflected in `imm-code-review` fallback wording.
- Spec: docs/specs/2026-06-30-001-fix-activation-plan-runtime-fallback.spec.md
- Origin: User reported an `imm-code-review` completion note: the code path and tests were sufficient, but two same-boundary follow-ups remained; the reviewer stayed solo because the current environment had no `imm_activation_plan` MCP / `imm-activation-plan` CLI. Direct planner entry after the user invoked `imm-planner`; no formal Brainstorm manifest applies.
- Research: `plugins/immune-brain/runtime/immune_brain_runtime.ts` already registers `imm_activation_plan`, maps MCP `tools/call` to `imm-activation-plan`, and supports the `cli` mode. `plugins/immune-brain/bin/imm-activation-plan` exists, is executable, and calls the plugin-local Bun/TypeScript runtime. `PATH` does not contain `imm-activation-plan` in this workspace, which proves an installed CLI cannot be the fallback source of truth. `plugins/immune-brain/dist/imm-code-review.md` currently says to call plugin MCP first and use the installed CLI wrapper only as manual/fallback, but it does not make plugin-local CLI detection and `activation_runtime_unavailable` explicit enough. Current State Ledger is idle with completed plan 004, so this is a new slice rather than an append.
- Decisions: D1 Preserve MCP-first host integration; do not replace MCP with CLI-only runtime integration. D2 Treat `plugins/immune-brain/bin/imm-activation-plan` and `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-activation-plan` as the guaranteed fallback, while a `PATH` installed wrapper is optional. D3 Add executable runtime-surface tests for MCP and plugin-local CLI instead of relying on prose. D4 Update `imm-code-review` source and packaged contracts so unavailable solo fallback is reported only after MCP and plugin-local CLI are unavailable. D5 Same-boundary review follow-ups stay execution handoffs, not Plan mutations.
- Assumptions: The current Bun/TypeScript runtime remains the production source of truth. Host tool availability can differ from repository-local command availability, so the skill contract should distinguish host MCP absence from plugin-local runtime absence. Existing activation planner output keys (`candidates`, `lenses`, `solo_fallback_reason`, `rationale_codes`) remain stable for this slice.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; the hot path is bounded to runtime surfaces, one wrapper, skill contracts, and focused tests.

## Output Language

- Human-readable prose: English for Spec and Plan documents; Chinese for user-facing replies in this workspace
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Devil's Advocate Audit

1. **Rollback Resilience**: The slice should touch only focused tests plus activation fallback wording in source/packaged skill docs and, only if tests expose a real gap, the existing TypeScript runtime/wrapper. If a step fails midway, revert the new activation tests and the contract text changes together; no State Ledger migration or persisted schema change is involved.
2. **Verification Vanity**: Text-only assertions would be vanity because the reported failure is runtime discoverability. Step 1 must exercise actual Bun commands and MCP framed `tools/list`/`tools/call` behavior. Step 2 may include text contract checks, but they must look for the ordered fallback and explicit unavailable reason, not just the words "MCP" or "CLI".
3. **Spec Dilution Detection**: The tempting broad fix is to move everything to CLI-only or redesign dispatch authorization. That would dilute the confirmed direction. This plan keeps the scope to activation-plan availability and same-boundary fallback wording while explicitly preserving MCP-first architecture and existing host authorization gates.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`mcp`, `list-tools`, `cli`, `imm_activation_plan` mapping), `plugins/immune-brain/runtime/mcp-launcher.ts`, `plugins/immune-brain/.mcp.json`, `plugins/immune-brain/bin/imm-activation-plan`, `plugins/immune-brain/skills/imm-code-review/SKILL.md`, `plugins/immune-brain/dist/imm-code-review.md`, runtime/contract tests under `tests/`.
- compatibility: Existing MCP-capable hosts keep the same `imm_activation_plan` tool name and argument contract. CLI fallback becomes more explicit but does not require a global PATH install. No State Ledger or Plan document migration is needed.
- interruption recovery: If execution stops after Step 1, runtime surface tests identify whether MCP, CLI, or wrapper availability is the remaining gap. If execution stops after Step 2, contract tests identify which source/dist wording still disagrees.
- rollback path: Revert the new activation runtime surface test, the code-review activation contract test, and any touched runtime/skill/doc files as one coherent slice.
- verification strength: Prefer executable Bun tests that spawn the real runtime and parse MCP frames; contract wording tests are allowed only for the skill routing/fallback language.
- Brainstorm traceability: No formal Brainstorm manifest exists; the accepted direction is the user-confirmed planner entry after the MCP-first + CLI fallback framing.

## Steps

### Step 1

- Step ID: U1
- Result: Activation planner runtime surface has executable fallback coverage
- Verification type: automated
- Verification: `bun test tests/activation-plan-runtime-surface.test.ts` passes, asserting that (a) `bun plugins/immune-brain/runtime/immune_brain_runtime.ts list-tools` includes `imm_activation_plan`; (b) framed MCP `tools/list` includes `imm_activation_plan`; (c) framed MCP `tools/call` for `imm_activation_plan` returns a text activation plan payload with keys such as `candidates`, `lenses`, and `solo_fallback_reason`; (d) `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-activation-plan --host imm-code-review` exits 0; and (e) `plugins/immune-brain/bin/imm-activation-plan --host imm-code-review` exits 0 from the repository root.
- Execution note: test-first
- Test scenarios: Covers MCP metadata availability; Covers MCP call execution; Covers plugin-local CLI wrapper execution; Covers direct runtime CLI execution; Covers missing PATH install not being treated as proof of unavailable plugin-local fallback.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (MCP tool metadata, `toolToCommand`, and `runImmCommand`); plugins/immune-brain/runtime/mcp-launcher.ts (MCP launcher path); plugins/immune-brain/.mcp.json (host MCP startup command); plugins/immune-brain/bin/imm-activation-plan (plugin-local wrapper); tests/plugin-package-runtime.test.ts (Bun spawnSync runtime test style)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If MCP `tools/call` fails while `list-tools` and CLI pass, fix the MCP command bridge only; do not route the whole architecture to CLI-only.
- security_considerations: The test payload should avoid secrets and should not record dispatch telemetry by default.

### Step 2

- Step ID: U2
- Result: Code-review activation fallback contract distinguishes unavailable runtime from missing installed CLI
- Verification type: automated
- Verification: `bun test tests/code-review-activation-contract.test.ts` passes, asserting that `plugins/immune-brain/skills/imm-code-review/SKILL.md` plus `plugins/immune-brain/dist/imm-code-review.md` both state this ordered fallback: `imm_activation_plan` MCP first, plugin-local `plugins/immune-brain/bin/imm-activation-plan` or Bun runtime CLI second, optional installed `imm-activation-plan` third, `activation_runtime_unavailable` last; assert they do not recommend replacing MCP with CLI-only; assert same-boundary `follow_up` routing still points to execution continuation instead of planner mutation.
- Execution note: test-first
- Test scenarios: Covers ordered fallback wording; Covers `activation_runtime_unavailable` distinct from `trigger_not_hit`, `explicit_required`, and `host_authorization_required`; Covers plugin-local wrapper named explicitly; Covers no CLI-only replacement; Covers same-boundary follow-up handoff route.
- Discovery cache: plugins/immune-brain/skills/imm-code-review/SKILL.md (source skill contract); plugins/immune-brain/dist/imm-code-review.md (packaged skill contract); docs/reference/subagent-dispatch-protocol.md (dispatch lifecycle); docs/reference/automatic-subagent-activation-policy.md (activation planner contract)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If source and dist skill contracts intentionally diverge, stop and return to planner because packaged contract drift would make host behavior ambiguous.
- security_considerations: Contract wording must keep authorization separate from eligibility so fallback runtime availability does not bypass host permission.

## Validation

- Plan validator: `./plugins/immune-brain/bin/imm-plan docs/plans/2026-06-30-001-fix-activation-plan-runtime-fallback-plan.md --json`
- Runtime sync after user scope confirmation: MCP `imm_plan_validate(sync=true)` or `./plugins/immune-brain/bin/imm-plan docs/plans/2026-06-30-001-fix-activation-plan-runtime-fallback-plan.md --sync` if MCP is unavailable
