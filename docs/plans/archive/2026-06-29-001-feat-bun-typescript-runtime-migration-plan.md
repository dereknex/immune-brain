# Iteration Plan

## Task

- Summary: Migrate Immune-Brain production host runtime from Python to Bun + TypeScript across OpenCode, Cursor, Codex, and Claude, using Python only as a temporary parity reference.
- Origin: User confirmed the brainstorm direction: all host runtimes move off Python, the migration may be breaking, and Python may remain temporarily as a test reference.
- Spec: `docs/specs/bun-typescript-runtime-migration.spec.md`
- Brainstorm Manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-DEC-001; BR-OUT-001; BR-DEFER-001
- Scope Mode: Roadmap-backed full migration Plan. This Plan covers the executable migration through host cutover and reference quarantine; the Spec preserves promotion criteria for each phase.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, tool names, config keys, command names, JSON keys, and canonical terms such as `Step`, `Plan`, `Spec`, `Verification`, `State Ledger`, and `Devil's Advocate Audit`.

## Brainstorm Manifest

| ID | Item |
| --- | --- |
| `BR-REQ-001` | All host runtimes must move off Python to Bun + TypeScript. |
| `BR-REQ-002` | Migration may be breaking; no backwards compatibility window is required. |
| `BR-REQ-003` | Python may remain temporarily as test reference only. |
| `BR-DEC-001` | TypeScript runtime becomes the new source of truth. |
| `BR-OUT-001` | Do not implement a thin TypeScript bridge over Python as the final design. |
| `BR-DEFER-001` | Exact Python reference removal criteria can be decided during planning. |

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U3 | Host cutover verifies production host runtimes start Bun. |
| BR-REQ-002 | captured_as_decision | D2 | Breaking migration is recorded as a decision. |
| BR-REQ-003 | covered_by_step | U4 | Python reference quarantine enforces test-only use. |
| BR-DEC-001 | covered_by_step | U2 | Deterministic workflow port makes TypeScript the source of truth. |
| BR-OUT-001 | covered_by_step | U3 | Host cutover rejects the TypeScript bridge over Python final design. |
| BR-DEFER-001 | covered_by_step | U4 | Reference retirement criteria are recorded in the quarantine step. |

## Research

- `CONTEXT.md` defines Plan and Step vocabulary. A Step is one independently closable outcome unit with a single Result and Verification path.
- `.imm/memory/current_iteration.json` is idle with no active validated plan, so this is a new slice rather than an append.
- `docs/solutions/architecture.md` identifies `.imm/imm_core/`, `.imm/imm-plan.py`, `plugins/immune-brain/.mcp.json`, `plugins/immune-brain/dist/immune_brain_runtime.py`, and MCP runtime tests as key architecture files.
- `docs/specs/opencode-native-plugin.spec.md` and the matching Plan intentionally kept the TypeScript plugin as a thin bridge to Python. This migration reverses that decision.
- `plugins/immune-brain/.mcp.json`, `plugins/immune-brain/.opencode-plugin/runtime.ts`, `plugins/immune-brain/dist/immune_brain_runtime.py`, and `mise.toml` currently expose production Python runtime commands.
- `tests/test_immune_brain_mcp_runtime.py` and `tests/test_immune_brain_plugin_package.py` are the current behavioral evidence surfaces for MCP framing, tool metadata, runtime resolution, package metadata, and plugin checks.
- Planning research subagents were not dispatched: the task spans multiple domains, but current host policy requires explicit parallel research and existing evidence is sufficient to decompose the Plan.

## Decisions

- D1: Bun + TypeScript is the production runtime target for all supported hosts.
- D2: This is a breaking migration; old Python runtime installs do not require a compatibility window.
- D3: Python may remain only as a temporary parity reference and must not be used by production host paths.
- D4: Preserve existing public tool names and argument contracts unless a later Plan explicitly changes the contract.
- D5: Keep State Ledger JSON and Plan documents readable unless an explicit persisted schema migration is introduced and tested.
- D6: Treat TypeScript compilation as necessary but insufficient; runtime parity requires executable MCP, CLI, State Ledger, Plan validation, and packaging tests.

## Assumptions

- Bun is acceptable as the required runtime for host plugin execution after the breaking migration.
- Existing Python behavior is the reference for current workflow semantics until a TypeScript replacement has characterization coverage.
- Non-runtime Python fixtures and upstream examples are outside this Plan unless they are part of a production host runtime path.
- Package versioning helpers may remain Python temporarily if they are not used to execute host runtime behavior; production runtime commands must move to Bun + TypeScript.

## Planning Quality Gate

- **Contract surface**: `plugins/immune-brain/dist/immune_brain_runtime.py`, proposed TypeScript runtime entrypoints, `.imm/imm_core/`, `.imm/memory/current_iteration.json`, `docs/plans/`, `plugins/immune-brain/.mcp.json`, `.opencode-plugin/`, host plugin manifests, `plugins/immune-brain/bin/`, `mise.toml`, `tests/test_immune_brain_mcp_runtime.py`, and `tests/test_immune_brain_plugin_package.py`.
- **Compatibility**: old Python runtime installs are not preserved; persisted State Ledger and Plan data remain readable or receive an explicit tested migration.
- **Interruption recovery**: each Step leaves either the old Python production runtime still intact or the new TypeScript production runtime fully verified for the touched surface. No Step should leave host adapters pointing at a half-ported command.
- **Rollback path**: revert the files listed in the failed Step's `Discovery cache`; State Ledger test fixtures must not mutate real `.imm/memory/current_iteration.json` outside controlled temp workspaces.
- **Verification strength**: prefer Bun test suites, MCP framed protocol tests, package contract tests, and negative searches for production Python invocations over file-existence checks.
- **Brainstorm traceability**: all `BR-*` manifest items are mapped above.
- **Acceptance scope discipline**: the Spec Roadmap defines phase promotion criteria; this Plan executes the migration through host cutover and reference quarantine.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: a Step could cut one host adapter to Bun while another still depends on Python, leaving a mixed runtime package.
- Mitigation: Step 3 owns host cutover as one Result and verifies production paths together. If it fails, rollback reverts host adapter and package command files as one coherent set.

### 2. Verification Vanity

- Risk: `bun test` and `tsc` can pass while MCP stdio framing, CLI JSON output, or State Ledger mutation semantics drift from Python behavior.
- Mitigation: Step 1 creates parity tests against the Python reference; Step 2 adds behavioral tests for State Ledger and Plan validation; Step 3 adds production-path checks that fail if Python bridge commands remain.

### 3. Spec Dilution Detection

- Risk: preserving the existing OpenCode TypeScript bridge could be mistaken for satisfying the migration.
- Mitigation: the Spec explicitly rejects a thin TypeScript bridge over Python as the final design, and Step 3 verifies host production paths no longer invoke Python.

## Steps

### Step 1

- Step ID: U1
- Result: TypeScript runtime parity harness covers the public runtime contract
- Execution note: `test-first`
- Verification type: `automated`
- Verification: `bun test plugins/immune-brain/runtime tests/runtime-parity.test.ts` passes and includes coverage for tool listing, framed MCP initialize, malformed framed input, bare JSON input, and at least one `imm_plan_validate` CLI call compared against the Python reference.
- Discovery cache: plugins/immune-brain/dist/immune_brain_runtime.py (Python reference runtime surface); tests/test_immune_brain_mcp_runtime.py (current MCP behavior evidence); plugins/immune-brain/.opencode-plugin/package.json (existing Bun package context)
- Parallel probes: scope=plugins/immune-brain/dist/immune_brain_runtime.py,output=public command contract,readonly=true; scope=tests/test_immune_brain_mcp_runtime.py,output=current protocol scenarios,readonly=true; scope=plugins/immune-brain/.opencode-plugin,output=Bun package constraints,readonly=true
- failure_behavior: If parity cannot be established, keep all production host commands on Python and record the missing contract before retrying.

### Step 2

- Step ID: U2
- Depends on: 1
- Result: TypeScript core owns deterministic workflow behavior
- Execution note: `characterization-first`
- Verification type: `automated`
- Verification: `bun test tests/runtime-state.test.ts tests/plan-validation.test.ts tests/heal-activation.test.ts tests/package-runtime.test.ts` passes and proves representative behavior against temp workspaces and Python reference fixtures.
- Discovery cache: .imm/imm_core/current_iteration_state.py (State Ledger behavior); .imm/imm_core/state_machine.py (workflow transitions); .imm/imm_core/plan_runtime.py (Plan validation behavior); .imm/imm_core/heal.py (environment checks); .imm/imm_core/activation_plan.py (activation output behavior); tests/test_immune_brain_plugin_package.py (packaged runtime expectations)
- Parallel probes: scope=.imm/imm_core/current_iteration_state.py + .imm/imm_core/state_machine.py,output=State Ledger invariants,readonly=true; scope=.imm/imm_core/plan_runtime.py + .imm/imm-plan.py,output=Plan validation contract,readonly=true; scope=.imm/imm_core/heal.py + .imm/imm_core/activation_plan.py,output=Heal activation behavior,readonly=true
- failure_behavior: If a workflow module drifts from reference behavior, keep the Python reference test failing alongside the TypeScript test until the intended difference is documented or fixed.

### Step 3

- Step ID: U3
- Depends on: 2
- Result: Host packages start the Bun runtime exclusively
- Verification type: `automated`
- Verification: `bun test tests/host-runtime-cutover.test.ts tests/plugin-package-runtime.test.ts` passes, `bun run check-plugin` passes, and a production-path scan over `plugins/immune-brain/.mcp.json`, `plugins/immune-brain/.opencode-plugin/`, `plugins/immune-brain/bin/`, host plugin manifests, and `mise.toml` fails on `python3` runtime startup references.
- Discovery cache: plugins/immune-brain/.mcp.json (MCP startup command); plugins/immune-brain/.opencode-plugin/index.ts (OpenCode tool adapter); plugins/immune-brain/.opencode-plugin/runtime.ts (current Python discovery bridge); plugins/immune-brain/bin (host command wrappers); plugins/immune-brain/.codex-plugin (Codex metadata); plugins/immune-brain/.cursor-plugin (Cursor metadata); plugins/immune-brain/.claude-plugin (Claude metadata); mise.toml (developer command surface)
- Parallel probes: scope=plugins/immune-brain/.mcp.json + plugins/immune-brain/bin,output=MCP and wrapper startup paths,readonly=true; scope=plugins/immune-brain/.opencode-plugin,output=OpenCode adapter changes,readonly=true; scope=plugins/immune-brain/.codex-plugin + plugins/immune-brain/.cursor-plugin + plugins/immune-brain/.claude-plugin,output=host metadata changes,readonly=true
- failure_behavior: If one host cannot start the Bun runtime, revert the host cutover files together and keep the Step open rather than shipping mixed host behavior.
- security_considerations: Bun command construction must avoid interpolating untrusted Plan paths or workspace paths into shell strings without structured argument handling.

### Step 4

- Step ID: U4
- Depends on: 3
- Result: Python is quarantined as reference only
- Verification type: `automated`
- Verification: `bun test tests/python-reference-boundary.test.ts` passes, docs mention Bun + TypeScript runtime requirements, and a production-path scan proves remaining Python files are not referenced by host runtime commands.
- Discovery cache: README.md (runtime documentation); docs/specs/opencode-native-plugin.spec.md (superseded bridge decision); docs/plans/2026-06-27-003-feat-opencode-native-plugin-plan.md (superseded bridge plan); plugins/immune-brain/dist (runtime packaging boundary); tests (reference test boundary)
- failure_behavior: If reference code cannot be safely removed, keep it in a labeled reference-only location and record the remaining removal blocker in docs.

## Test Scenarios

- MCP `initialize` returns a framed response from the TypeScript runtime.
- MCP malformed framed input returns the expected parse error from the TypeScript runtime.
- Bare JSON initialize without newline returns before EOF.
- `imm_plan_validate` defaults to validate-only and syncs only when requested.
- `imm_work_status` reads the existing State Ledger shape from `.imm/memory/current_iteration.json`.
- `imm_work_activate` mutates only the intended State Ledger fields in a temp workspace.
- `imm_heal` reports environment status without requiring Python runtime startup.
- OpenCode native plugin invokes the TypeScript runtime directly.
- `.mcp.json` starts Bun and resolves the packaged runtime from repo and cache-like paths.
- Package checks fail if production host runtime paths contain `python3` bridge startup commands.

## Next Action

- Validate this Plan with `python3 .imm/imm-plan.py docs/plans/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md --json`.
- If validation passes and the user confirms scope, enter `imm-work` and activate Step `S1-runtime-contract-parity`.

