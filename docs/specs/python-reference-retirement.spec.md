# Spec: Python Reference Retirement

**Task ID**: IMM-PYTHON-RETIREMENT-001
**Owner**: Planner
**Status**: Draft
**Date**: 2026-06-29

## 1. Goal

Retire the remaining Python reference runtime after the Bun + TypeScript runtime has become the production source of truth.

The final repository should not require Python for Immune-Brain runtime behavior, host startup, package checks, or canonical workflow regression tests. Any Python that remains must be explicitly outside the Immune-Brain runtime boundary, such as unrelated upstream examples or intentionally retained developer utilities with a documented owner.

## 2. Accepted Behaviors

### 2.1 TypeScript Coverage Replaces Python Parity

- TypeScript/Bun tests are the canonical regression surface for runtime behavior.
- Coverage exists for every retired Python reference domain:
  - MCP framing and tool metadata
  - Plan validation and sync
  - State Ledger read/write behavior
  - activation planning
  - heal checks
  - autowork/work/review command behavior currently exposed by the runtime
  - host package startup and bin wrappers
- No canonical test requires importing `.imm/imm_core` as the source of runtime truth.

### 2.2 Runtime Command Bridge Retirement

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` does not invoke `python3` for `cli`, MCP tool calls, or packaged host commands.
- Runtime command behavior currently bridged through legacy Python scripts is ported to native Bun/TypeScript behavior or replaced by a TypeScript command adapter with equivalent tests.
- Boundary tests fail if the production TypeScript runtime contains a `spawnSync("python3", ...)`, `spawn("python3", ...)`, or equivalent Python command bridge for Immune-Brain workflow commands.

### 2.3 Reference Runtime Deletion

- `plugins/immune-brain/dist/immune_brain_runtime.py` is removed after equivalent TypeScript coverage is in place and the TypeScript runtime command bridge no longer needs Python.
- `plugins/immune-brain/dist/.imm/` Python reference runtime files are removed unless they are proven necessary for non-runtime fixture coverage.
- Root `.imm/` Python runtime wrappers and `.imm/imm_core/` reference modules are removed or reduced to clearly non-runtime migration/developer utilities only after their behavior has TypeScript coverage or is explicitly declared out of scope.
- `.imm/pyproject.toml` and `plugins/immune-brain/dist/.imm/pyproject.toml` are removed when editable Python package installation is no longer needed by tests or tooling.

### 2.4 Dev Tooling Cleanup

- `mise.toml` no longer uses Python for canonical runtime validation, plugin checks, or JSON validation where Bun/Node equivalents are available.
- `public-release/templates/mise.toml` no longer advertises Python runtime startup.
- `scripts/plugin_versioning.py`, `scripts/plugin_release.py`, and related Python developer utilities are either ported to TypeScript/Bun or explicitly retained as non-runtime developer tooling with a recorded reason.

### 2.5 Documentation and Stale Reference Cleanup

- README, specs, plans, solutions, and public-release templates no longer describe Python as the runtime or bridge path.
- Superseded docs may mention Python only as historical context or as a retired reference boundary.
- `docs/solutions/python-reference-quarantine-boundary.md` is updated or superseded with the completed retirement outcome.

### 2.6 Verification Expectations

- A repository scan fails on Python runtime startup references in production and public-release surfaces.
- A Python-file inventory has zero runtime-owned Python files, or every remaining Python file is mapped to an explicit non-runtime exception.
- Bun/TypeScript tests pass for the runtime, package, Plan validation, State Ledger, activation, heal, autowork/work/review, and stale-reference checks.

## 3. Non-Goals

- Do not rewrite unrelated `upstreams/` projects or their Python examples.
- Do not remove Python files that are external fixtures unless they are referenced by Immune-Brain runtime or canonical tests.
- Do not preserve a Python fallback for host runtime execution.
- Do not delete reference Python before TypeScript coverage can fail on the same behavioral regressions.

## 4. Contract Surface

| Surface | Retirement contract |
| --- | --- |
| `plugins/immune-brain/runtime/immune_brain_runtime.ts` | Production runtime source of truth remains Bun + TypeScript and must not bridge workflow commands through `python3` |
| `plugins/immune-brain/dist/immune_brain_runtime.py` | Remove after TypeScript coverage replaces reference behavior |
| `plugins/immune-brain/dist/.imm/` | Remove packaged Python reference runtime or justify any non-runtime leftovers |
| `.imm/imm_core/` and `.imm/imm-*.py` | Remove, port, or explicitly classify as non-runtime developer utility |
| `.imm/pyproject.toml` and `plugins/immune-brain/dist/.imm/pyproject.toml` | Remove when Python editable install is no longer needed |
| `tests/test_*.py` | Port runtime/contract assertions to Bun or retire if superseded |
| `mise.toml` and `public-release/templates/mise.toml` | Must not use Python for runtime or canonical package validation |
| `README.md`, `docs/specs/`, `docs/plans/`, `docs/solutions/` | Must not contain stale production Python runtime guidance |

## 5. Risks

- Deleting Python reference code too early could hide behavior drift in TypeScript ports.
- Repository-wide Python scans may overreach into unrelated upstream content or historical docs.
- Porting all Python developer utilities at once could expand scope beyond runtime retirement.
- Removing `.imm/` files may break workflow scripts if any host or test still invokes legacy commands.