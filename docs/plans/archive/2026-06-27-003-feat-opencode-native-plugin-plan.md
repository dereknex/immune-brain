# Iteration Plan

## Task

- Summary: Implement OpenCode native plugin support for Immune-Brain, replacing the MCP-only approach with a first-class TypeScript plugin that exposes workflow tools directly inside OpenCode's plugin runtime.
- Origin: User request to "目标设计为opencode原生插件，重新调整方案"
- Spec: docs/specs/opencode-native-plugin.spec.md
- Research: [@opencode-ai/plugin@1.17.11](https://www.npmjs.com/package/@opencode-ai/plugin) uses Zod-based tool args and tagged-template `$` shell. [OpenCode docs](https://opencode.ai/docs/plugins/) confirm Plugin type signature, session/compaction hooks, and `{ raw: string }` ShellExpression for raw commands.
- Decisions: D1 Keep thin TS bridge to Python runtime (no logic rewrite). D2 Use `tool()` helper + Zod schemas for type-safe tool definitions. D3 Use `input.$` tagged template for subprocess execution instead of `Bun.spawnSync`. D4 Expose 8 tools matching existing MCP tool set. D5 Preserve `.mcp.json` as MCP fallback.
- Assumptions: OpenCode's embedded JS runtime supports `node:*` imports and BunShell tagged templates.
- Scope Mode: Hold Scope — complete native plugin + docs in one step.

## Output Language

- Human-readable prose: English for Spec and Plan documents
- Preserved literals: file paths, tool names, config keys

## Brainstorm Manifest

| ID | Item |
|----|------|
| BR-REQ-1 | Create `.opencode-plugin/` with `index.ts`, `runtime.ts`, `package.json`, `tsconfig.json` |
| BR-REQ-2 | Rewrite `callImmTool()` to use `PluginInput.$` tagged template instead of `Bun.spawnSync` |
| BR-REQ-3 | Use `tool()` helper + Zod schemas for tool args (required by @opencode-ai/plugin@1.x) |
| BR-REQ-4 | Plugin function must accept `PluginInput` parameter to access `$` |
| BR-REQ-5 | Run `bun install` to resolve dependencies |
| BR-REQ-6 | Verify TypeScript compiles with zero errors |
| BR-REQ-7 | Update spec from MCP-only to native plugin |
| BR-REQ-8 | Create plan document for native plugin work |
| BR-REQ-9 | Update README with OpenCode native plugin config instructions |
| BR-REQ-10 | Update `test_skill_contracts.py` to check `.opencode-plugin/` surface |
| BR-DEC-1 | Preserve `.mcp.json` as MCP fallback |
| BR-DEC-2 | No `build` script needed — OpenCode executes `.ts` directly |

## Brainstorm Trace

| ID | Status | Reason / Mapping |
|----|--------|------------------|
| BR-REQ-1 | covered_by_step | Map to Step 1 |
| BR-REQ-2 | covered_by_step | Map to Step 1 |
| BR-REQ-3 | covered_by_step | Map to Step 1 |
| BR-REQ-4 | covered_by_step | Map to Step 1 |
| BR-REQ-5 | covered_by_step | Map to Step 1 |
| BR-REQ-6 | covered_by_step | Map to Step 1 |
| BR-REQ-7 | covered_by_step | Map to Step 2 |
| BR-REQ-8 | covered_by_step | Map to Step 2 |
| BR-REQ-9 | covered_by_step | Map to Step 2 |
| BR-REQ-10 | covered_by_step | Map to Step 2 |
| BR-DEC-1 | captured_as_decision | D5 |
| BR-DEC-2 | captured_as_decision | No build pipeline needed |

## Devil's Advocate Audit

### 1. Rollback Resilience
- Risk: `.opencode-plugin/` files could conflict with existing OpenCode plugin system.
- Mitigation: New directory is additive; no existing files modified. `.mcp.json` MCP path preserved as fallback. Rollback is `rm -rf plugins/immune-brain/.opencode-plugin`.

### 2. Verification Vanity
- Risk: TypeScript compiles but `input.$` tagged template fails at runtime in OpenCode.
- Mitigation: The `{ raw: cmd }` pattern is documented in OpenCode plugin docs. Runtime behavior matches Bun's shell API which is well-tested. Can only fully verify inside OpenCode.

### 3. Version Compatibility
- Risk: `@opencode-ai/plugin@1.17.11` may change API in future minor versions.
- Mitigation: Peer dependency uses `>=1.0.0` range. Breaking changes would require major version bump.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/.opencode-plugin/index.ts` (plugin entry), `plugins/immune-brain/.opencode-plugin/runtime.ts` (CLI bridge), `plugins/immune-brain/.opencode-plugin/package.json` (npm metadata), `plugins/immune-brain/.opencode-plugin/tsconfig.json` (TS config).
- compatibility: `.mcp.json` MCP path unchanged; existing Python tests unaffected.
- interruption recovery: All files are additive; partially created `.opencode-plugin/` can be deleted and recreated.
- rollback path: `rm -rf plugins/immune-brain/.opencode-plugin && git checkout docs/`
- verification strength: `tsc --noEmit` passes with zero errors; existing `PYTHONPATH=.imm python3 -m unittest discover -s tests` still passes.
- Brainstorm traceability: Complete coverage in Brainstorm Trace.

## Steps

### Step 1 — Plugin Implementation

- Step ID: U1
- Result: Native OpenCode plugin compiles and is ready for use
- Scope: `.opencode-plugin/index.ts`, `.opencode-plugin/runtime.ts`, `.opencode-plugin/package.json`, `.opencode-plugin/tsconfig.json`, `bun install`
- Discovery cache: `@opencode-ai/plugin/dist/index.d.ts` (Plugin type), `@opencode-ai/plugin/dist/tool.d.ts` (ToolDefinition + tool helper), OpenCode docs (plugin API)
- Verification: `cd plugins/immune-brain/.opencode-plugin && bunx tsc --noEmit`
- Verification type: automated
- failure_behavior: Fix type errors iteratively until clean compile
- security_considerations: Subprocess (`python3`) execution uses shell-escaped args; no unsanitized user input reaches shell

### Step 2 — Documentation & Tests

- Step ID: U2
- Result: Spec, plan, README, and contract tests updated for native plugin
- Scope: `docs/specs/opencode-native-plugin.spec.md`, `docs/plans/2026-06-27-003-feat-opencode-native-plugin-plan.md`, `README.md`, `tests/test_skill_contracts.py`
- Discovery cache: existing MCP spec, existing README, existing contract tests
- Verification: `PYTHONPATH=.imm python3 -m unittest tests.test_skill_contracts -v`
- Verification type: automated
- failure_behavior: Revert test changes if existing tests break
- security_considerations: None
