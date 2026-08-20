# Spec: OpenCode Native Plugin

> **SUPERSEDED**: This spec documented the thin TypeScript bridge to the Python runtime.
> The Bun + TypeScript runtime migration (see `docs/specs/bun-typescript-runtime-migration.spec.md`)
> replaced this design. Python reference files are retired; the OpenCode plugin calls
> the TypeScript runtime directly.

**Task ID**: IMM-OPENCODE-NATIVE-001
**Owner**: Planner
**Status**: Superseded by IMM-BUN-TS-RUNTIME-001
**Date**: 2026-06-27

## 1. Goal
Provide Immune-Brain as a first-class **native OpenCode plugin**, exposing all workflow tools directly inside OpenCode's plugin runtime with session and compaction hooks — alongside the existing MCP fallback path.

---

## 2. Target Design

### 2.1 Plugin Architecture
A thin TypeScript layer (`index.ts` + `runtime.ts`) originally acted as a bridge to the old Python runtime. This is superseded; the current design calls the Bun/TypeScript runtime directly.

**Superseded call chain**: OpenCode tool call → `callImmTool()` → `input.$`python3 <runtime> cli <tool> ...`` → stdout returned

**Current call chain**: OpenCode tool call → `callImmTool()` → `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli <tool> ...` → stdout returned

The plugin exposes:
- 8 workflow tools (`imm_work_status`, `imm_plan_validate`, `imm_work_activate`, `imm_work_record_execution`, `imm_review`, `imm_autowork`, `imm_heal`, `imm_activation_plan`)
- `session.created` hook — injects tool list context
- `experimental.session.compacting` hook — persists workflow state across compaction

### 2.2 Distribution
- npm package: `opencode-immune-brain` (version `1.0.0`)
- User adds to `opencode.json`: `{ "plugin": ["opencode-immune-brain"] }`
- Local alternative: copy `index.ts` + `runtime.ts` into `.opencode/plugins/`

### 2.3 Runtime Discovery
Superseded design: `findRuntime()` scanned for `immune_brain_runtime.py` in order:
1. Repo-local: `plugins/immune-brain/dist/` or `dist/`
2. Cache dirs under `~`: `.opencode/plugins/cache/`, `.codex/plugins/cache/`, `.claude/plugins/cache/`, `.cursor/plugins/cache/`

### 2.4 MCP Fallback
The existing `.mcp.json` stdio MCP configuration is preserved as a fallback for OpenCode users who prefer MCP-only mode.

---

## 3. Constraints
* **Thin bridge only**: All logic lives in Python; TS layer is a pass-through.
* **No Bun required on user machine**: Plugin runs inside OpenCode's embedded JS runtime.
* **Zod-based tool args**: Required by `@opencode-ai/plugin@>=1.0.0`.
* **`PluginInput.$` for subprocess**: Use `$` (BunShell tagged template) instead of `Bun.spawnSync`.
* **Preserve existing MCP tests**: `test_skill_contracts.py` must still pass.

---

## 4. Files

| File | Purpose |
|------|---------|
| `.opencode-plugin/index.ts` | Plugin entry: tools + hooks |
| `.opencode-plugin/runtime.ts` | Python runtime discovery + CLI bridge |
| `.opencode-plugin/package.json` | npm metadata |
| `.opencode-plugin/tsconfig.json` | TypeScript config |
| `.mcp.json` | MCP fallback (unchanged) |
