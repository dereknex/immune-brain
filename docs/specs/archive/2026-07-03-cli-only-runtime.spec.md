---
title: "refactor: make Immune-Brain runtime CLI-only"
type: refactor
status: planned
date: 2026-07-03
origin:
  - user-requested MCP versus CLI comparison
  - user explicitly excluded historical decisions and breaking-change concerns
  - worktree validation spike in /Users/derek/workspaces/agent-skills-mcp-cli-validation
---

# CLI-Only Runtime Spec

## 1. Goal

Make the Immune-Brain plugin runtime a CLI-only integration surface. The core workflow commands remain available through `plugins/immune-brain/bin/imm-*` wrappers and `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli <command>`, while MCP server configuration, MCP stdio handling, and MCP tool-call adapters are removed.

## 2. Current Technical Evidence

The current TypeScript runtime already routes CLI commands directly through `runImmCommand(...)`. MCP requests are a thin adapter over the same command handlers: `tools/call` maps a tool name into CLI-style command arguments and then calls `runImmCommand(...)`.

The validation spike in the CLI-only worktree removed `plugins/immune-brain/.mcp.json`, `plugins/immune-brain/runtime/mcp-launcher.ts`, MCP JSON-RPC handling, MCP tool metadata, and `list-tools`. After that removal, the following CLI smoke paths still exited successfully:

- `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-work status --json`
- `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-plan docs/plans/2026-07-03-001-fix-autorun-boundary-simplification-plan.md --json`
- `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-activation-plan`
- `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-heal`
- `bun test tests/wrapper-retirement.test.ts`
- `bun test tests/autowork-false-completion.test.ts`

The same spike left 9 Bun test failures, all concentrated on MCP and `list-tools` contract coverage. That means the implementation risk is primarily contract migration, not CLI runtime capability.

## 3. Requirements

### R1. CLI wrappers are the supported host-facing runtime entry

- `plugins/immune-brain/bin/imm-plan`, `imm-work`, `imm-review`, `imm-heal`, `imm-autowork`, `imm-activation-plan`, `imm-finish`, and `imm-dehydrate` must remain executable wrappers.
- Wrapper commands must delegate to `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli <command> ...`.
- The runtime must keep `runImmCommand(...)` as the shared command dispatch surface.

### R2. MCP server surface is removed

- Remove `plugins/immune-brain/.mcp.json`.
- Remove `plugins/immune-brain/runtime/mcp-launcher.ts`.
- Remove runtime `mcp` mode, MCP stdio framing, JSON-RPC handling, `tools/list`, `tools/call`, and MCP tool-to-command adapter code.
- Runtime help text must no longer advertise `mcp`.

### R3. CLI keeps structured command discovery

- Replace MCP `tools/list` discovery with a CLI-native JSON manifest, for example `list-commands --json` or an equivalent CLI command.
- The manifest must describe supported commands, descriptions, required arguments, optional flags, JSON output support, and examples.
- Tests must prove the manifest includes all supported `imm-*` wrappers and omits MCP-only concepts.

### R4. Agent-facing outputs remain machine-readable

- Existing `--json` outputs for command paths that already support JSON must keep stable JSON shape unless a focused test proves a deliberate replacement.
- Failure paths for new CLI discovery features should use non-zero exit codes and structured error output when `--json` is requested.
- Commands that accept JSON-shaped arguments, such as activation overrides or autowork queues, must keep deterministic quoting-safe forms.

### R5. Contract tests and active documentation become CLI-only

- Runtime tests must assert CLI behavior rather than MCP initialize, MCP framed messages, `tools/list`, or `tools/call`.
- Active docs, Skill contracts, specs, release templates, and `CONTEXT.md` architecture pointers must describe CLI-only integration.
- Historical archived notes may keep MCP references only if they are clearly historical and do not instruct current behavior.

## 4. Non-goals

- Do not change State Ledger schema or Plan validation semantics.
- Do not introduce a background daemon, scheduler, generic dispatcher, or network service.
- Do not preserve MCP compatibility in this slice.
- Do not rewrite unrelated workflow authority boundaries such as QA, review gates, or Compounder behavior.
- Do not require global PATH installation when plugin-local wrappers can be invoked by path.

## 5. Acceptance Criteria

- CLI smoke commands for status, plan validation, activation plan, heal, autowork, review, finish, and dehydrate pass through plugin-local wrappers or direct runtime CLI.
- No active production runtime path contains MCP server launch configuration or JSON-RPC MCP handling.
- A CLI command manifest replaces MCP `tools/list` as the structured discovery surface.
- Focused tests that previously covered MCP runtime surfaces are rewritten or retired so `bun test` passes with CLI-only contracts.
- Active README, Skill, reference, package, and architecture docs no longer instruct users or hosts to configure MCP for Immune-Brain.
- `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-refactor-cli-only-runtime-plan.md --json` validates this Plan.
