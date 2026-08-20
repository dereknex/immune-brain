# Spec: Bun TypeScript Runtime Migration

**Task ID**: IMM-BUN-TS-RUNTIME-001
**Owner**: Planner
**Status**: In Progress
**Date**: 2026-06-29

## 1. Goal

Replace the production Immune-Brain host runtime from Python to Bun + TypeScript across all supported hosts.

The final production path must not require `python3` for host runtime execution. Python may remain temporarily as a test reference while Bun + TypeScript parity is proven.

## 2. Accepted Behaviors

### 2.1 Runtime Source Of Truth

- Bun + TypeScript becomes the production source of truth for the Immune-Brain runtime.
- The runtime exposes the same public surfaces currently served by `plugins/immune-brain/dist/immune_brain_runtime.py`:
  - `list-tools`
  - `cli`
  - `mcp`
- The MCP tool surface preserves the existing tool names and argument contracts:
  - `imm_work_status`
  - `imm_plan_validate`
  - `imm_work_activate`
  - `imm_work_record_execution`
  - `imm_review`
  - `imm_autowork`
  - `imm_heal`
  - `imm_activation_plan`

### 2.2 Host Runtime Cutover

- OpenCode, Cursor, Codex, and Claude host adapters invoke the Bun + TypeScript runtime in production paths.
- `plugins/immune-brain/.mcp.json` starts a Bun command instead of a Python command.
- OpenCode native plugin code calls the TypeScript runtime directly rather than shelling through `python3`.
- Packaged plugin metadata, generated runtime artifacts, and repository task commands stop advertising Python as the production runtime requirement.

### 2.3 Breaking Migration

- No compatibility window is required for old Python runtime installs.
- Existing State Ledger JSON and Plan documents remain readable by the TypeScript runtime unless a deliberate persisted schema migration is recorded.
- If a persisted schema migration is introduced, it must be explicit, deterministic, and covered by tests.

### 2.4 Python Reference Boundary

- Python may remain under a clearly labeled reference or legacy path for parity tests only.
- Reference Python code must not be used by production host adapters, MCP startup commands, or published runtime entrypoints.
- Reference removal criteria must be recorded before Python reference code is deleted.

### 2.5 Verification Expectations

- Runtime parity is proven by executable tests that compare TypeScript behavior against the Python reference where the reference remains useful.
- MCP stdio framing tests cover initialize, malformed input, bare JSON input, tool listing, and at least one mutating workflow command.
- Plan validation, State Ledger behavior, heal behavior, activation behavior, and packaged plugin checks have automated coverage before host cutover is treated as complete.

## 3. Non-Goals

- Do not preserve Python as a production fallback.
- Do not maintain host-specific behavior forks for the same workflow tool.
- Do not rewrite unrelated upstream fixtures or non-runtime Python examples just because they contain Python.
- Do not treat TypeScript compilation alone as runtime parity.

## 4. Contract Surface

| Surface | Contract |
| --- | --- |
| `plugins/immune-brain/dist/immune_brain_runtime.py` | Temporary Python reference for current runtime behavior |
| `plugins/immune-brain/.mcp.json` | Host-neutral MCP startup command |
| `plugins/immune-brain/.opencode-plugin/` | OpenCode native plugin adapter |
| `.imm/imm_core/` | Current source for workflow behavior to port |
| `.imm/memory/current_iteration.json` | State Ledger shape that must remain readable or be migrated explicitly |
| `docs/plans/` | Plan format consumed by validation and runtime sync |
| `tests/test_immune_brain_mcp_runtime.py` | Current MCP behavior coverage to port or replace |
| `tests/test_immune_brain_plugin_package.py` | Current packaging and host adapter coverage to port or replace |
| `mise.toml` | Developer task surface that must stop pointing production checks at Python runtime commands |

## 5. Roadmap

### Phase 1: TypeScript Runtime Foundation

Goal: create the Bun + TypeScript runtime entrypoint and parity harness without cutting hosts over yet.

Acceptance criteria:
- `bun` can execute a TypeScript runtime entrypoint with `list-tools`, `cli`, and `mcp` subcommands.
- Runtime tool metadata matches the Python reference for the existing public tool surface.
- Contract tests can run TypeScript and Python reference behavior side by side.

Promotion criteria:
- The parity harness proves enough surface area to safely port deterministic workflow modules next.

### Phase 2: Deterministic Workflow Port

Goal: port the deterministic runtime modules that own State Ledger, Plan validation, activation, heal, and package-local runtime behavior.

Acceptance criteria:
- TypeScript tests prove State Ledger read/write behavior.
- TypeScript tests prove Plan validation and sync behavior.
- TypeScript tests prove heal and activation outputs for representative workspace states.

Promotion criteria:
- TypeScript runtime can satisfy production workflow commands without invoking Python.

### Phase 3: Host Runtime Cutover

Goal: make all host adapters and packaged production entrypoints use the Bun + TypeScript runtime.

Acceptance criteria:
- `.mcp.json` starts Bun.
- OpenCode native plugin no longer shells to `python3`.
- Cursor, Codex, and Claude package metadata and bin wrappers no longer rely on Python runtime startup.
- Package checks prove production paths do not contain Python runtime invocations.

Promotion criteria:
- Cross-host tests pass against the Bun + TypeScript runtime.

### Phase 4: Reference Retirement

Goal: remove or quarantine Python reference code after TypeScript parity and host cutover are complete.

Acceptance criteria:
- No production host runtime path references Python.
- Remaining Python files are either deleted or labeled test/reference only.
- Documentation states Bun + TypeScript as the runtime requirement.

Promotion criteria:
- Maintainers accept that Python reference parity coverage is no longer needed.

## 6. Risks

- The Python runtime currently acts as both executable logic and reference behavior, so accidental behavior drift is likely without characterization tests.
- MCP stdio framing bugs are easy to miss if verification only checks command output.
- Breaking migration reduces compatibility work but increases packaging and install failure risk for users with old cached plugin installs.
- OpenCode already has a TypeScript plugin package, but it currently bridges to Python; treating that as sufficient would silently miss the core migration.

