# Iteration Plan

## Task

- Summary: Retire the remaining Python reference runtime after the Bun + TypeScript runtime migration, replacing Python parity with canonical Bun/TypeScript coverage and removing stale Python runtime references.
- Origin: User chose option B from the Python dependency cleanup framing: create a complete Python reference runtime retirement plan.
- Spec: `docs/specs/python-reference-retirement.spec.md`
- Scope Mode: New executable slice. This Plan does not execute the deletion yet; it defines the retirement path and verification gates.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, tool names, config keys, command names, JSON keys, and canonical terms such as `Step`, `Plan`, `Spec`, `Verification`, `State Ledger`, and `Devil's Advocate Audit`.

## Research

- `CONTEXT.md` defines a Plan as an ordered sequence of independently closable Steps and identifies `.imm/imm_core/`, `.imm/imm-*.py`, `plugins/immune-brain/dist/immune_brain_runtime.py`, packaged MCP surfaces, and `docs/solutions/` as relevant architecture surfaces.
- `.imm/memory/current_iteration.json` is idle with no active validated plan, so this is a new slice rather than an append.
- `docs/solutions/python-reference-quarantine-boundary.md` records that Python is currently reference-only and lists retirement criteria: TypeScript characterization coverage, no production host runtime references to `python3`, Python reference tests no longer needed, and dev tooling either ported or explicitly accepted as non-runtime.
- Repository dependency scan found only `.imm/pyproject.toml` and `plugins/immune-brain/dist/.imm/pyproject.toml` as local Python dependency declarations; both only require Python `>=3.9` and `setuptools>=64` for editable `imm_core` package installation.
- Import inventory over `.imm/`, `tests/`, `scripts/`, and `plugins/immune-brain/` found no third-party Python package dependency candidates beyond local modules; cleanup target is Python runtime/reference ownership rather than pip packages.
- Existing TypeScript boundary tests include `tests/host-runtime-cutover.test.ts` and `tests/python-reference-boundary.test.ts`, but they still point at the Bun migration plan and do not yet prove full retirement of Python reference files.
- `public-release/templates/mise.toml` previously contained `python3 plugins/immune-brain/dist/immune_brain_runtime.py list-tools`; U4 replaces that public runtime guidance with Bun + TypeScript commands.
- Planning research subagents were not dispatched: this is a single-domain cleanup plan and existing evidence is sufficient to decompose concrete Steps.

## Decisions

- D1: Treat Python removal as coverage-gated retirement, not dependency pruning; there are no meaningful third-party Python packages to remove first.
- D2: TypeScript/Bun tests become canonical before any Python reference file is deleted.
- D3: `upstreams/` Python files and unrelated example requirements are out of scope unless they are referenced by Immune-Brain runtime or canonical tests.
- D4: Python developer utilities may be retained only if they are explicitly classified as non-runtime with a recorded reason; production and public-release runtime paths must not invoke Python.
- D5: Prefer a small number of outcome Steps: prove coverage, remove runtime reference files and configs, then clean stale public/docs references.

## Assumptions

- The Bun + TypeScript runtime migration is sufficiently complete that retirement planning can target remaining reference surfaces rather than designing a new runtime.
- Maintainers accept a breaking removal of Python reference runtime after coverage gates pass.
- If a Python developer utility is expensive to port, it may be deferred only with an explicit non-runtime exception and verification that no host runtime path calls it.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: deleting `.imm/` or packaged Python reference files could break unported tests or local workflow commands.
- Mitigation: Step 1 must prove TypeScript canonical coverage and produce an exception inventory before Step 2 deletes runtime files. Rollback for Step 2 is restoring deleted Python files and dependency declarations from git while keeping the Step open.

### 2. Verification Vanity

- Risk: a search that only checks `python3` strings could miss Python imports, editable installs, or public-release template startup paths.
- Mitigation: verification combines Bun behavior tests, Python file inventory, pyproject existence checks, and targeted scans of production/public-release surfaces.

### 3. Spec Dilution Detection

- Risk: retaining Python developer utilities could silently become retaining the runtime.
- Mitigation: the Spec separates runtime-owned Python from non-runtime developer utilities; any retained Python must have an explicit exception reason and must be excluded from host runtime startup.

## Steps

### Step 1

- Step ID: U1
- Result: Python reference deletion is coverage-gated by canonical TypeScript evidence
- Execution note: `characterization-first`
- Verification type: `automated`
- Verification: `bun test tests/host-runtime-cutover.test.ts tests/plugin-package-runtime.test.ts tests/python-reference-boundary.test.ts` passes after the boundary tests assert canonical Bun/TypeScript coverage for Plan validation, State Ledger, activation, heal, autowork/work/review surfaces, and produce or verify a remaining-Python exception inventory.
- Discovery cache: tests/python-reference-boundary.test.ts (current quarantine assertions); tests/host-runtime-cutover.test.ts (production runtime cutover assertions); tests/plugin-package-runtime.test.ts (package runtime assertions); plugins/immune-brain/runtime/immune_brain_runtime.ts (production runtime source of truth); plugins/immune-brain/runtime/imm_core.ts (ported workflow behavior); docs/solutions/python-reference-quarantine-boundary.md (retirement criteria)
- failure_behavior: If coverage gaps remain, do not delete Python reference files; record the missing behavior as a blocker in the exception inventory.

### Step 2

- Step ID: U2
- Depends on: 1
- Result: Runtime workflow commands run without Python bridge
- Execution note: `characterization-first`
- Verification type: `automated`
- Verification: `bun test tests/python-reference-boundary.test.ts tests/plugin-package-runtime.test.ts tests/host-runtime-cutover.test.ts && ! grep -R "spawnSync(\"python3\"\|spawn(\"python3\"" plugins/immune-brain/runtime` passes.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (current command bridge); plugins/immune-brain/runtime/imm_core.ts (ported workflow behavior); tests/python-reference-boundary.test.ts (bridge-retirement assertion); tests/plugin-package-runtime.test.ts (runtime command coverage); tests/host-runtime-cutover.test.ts (host wrapper coverage)
- failure_behavior: If a command still needs legacy Python behavior, keep Python reference files in place and record the missing TypeScript command behavior before retrying deletion.

### Step 3

- Step ID: U3
- Depends on: 2
- Result: Python reference runtime ownership is retired from repository files
- Verification type: `automated`
- Verification: `test ! -f plugins/immune-brain/dist/immune_brain_runtime.py && test ! -d plugins/immune-brain/dist/.imm && test ! -f .imm/pyproject.toml && bun test tests/python-reference-boundary.test.ts` passes, with any remaining repo-local `*.py` files outside `upstreams/` mapped to documented non-runtime exceptions.
- Discovery cache: plugins/immune-brain/dist/immune_brain_runtime.py (packaged Python runtime reference); plugins/immune-brain/dist/.imm (packaged Python reference modules); .imm/pyproject.toml (editable Python package declaration); plugins/immune-brain/dist/.imm/pyproject.toml (packaged editable Python declaration); .imm/imm_core (root Python reference modules); .imm/imm-*.py (legacy workflow wrappers); tests/test_*.py (Python test surfaces); scripts/*.py (developer utility candidates)
- failure_behavior: If a deleted file is still required by a canonical test or command, restore it and either port the missing behavior to TypeScript or add a non-runtime exception before retrying deletion.

### Step 4

- Step ID: U4
- Depends on: 3
- Result: Public surfaces describe Bun TypeScript as the only runtime path
- Verification type: `automated`
- Verification: `bun test tests/python-reference-boundary.test.ts && mise run check-plugin` passes, and targeted scans over `README.md`, `docs/specs/`, `docs/plans/`, `docs/solutions/`, `mise.toml`, and `public-release/templates/mise.toml` show no stale Python production-runtime guidance outside historical or explicitly superseded context.
- Discovery cache: mise.toml (developer command surface); public-release/templates/mise.toml (public release template); README.md (runtime documentation); docs/specs/opencode-native-plugin.spec.md (superseded Python bridge spec); docs/solutions/python-reference-quarantine-boundary.md (quarantine learning to update or supersede); docs/specs/python-reference-retirement.spec.md (retirement contract)
- failure_behavior: If historical docs need to keep Python mentions, label them as historical/superseded rather than deleting useful context.

## Test Scenarios

- Bun runtime validates a Plan without invoking Python.
- Bun runtime reads State Ledger status without invoking Python.
- Bun runtime exercises activation, heal, autowork/work/review surfaces covered by canonical tests.
- Package runtime tests fail if host startup paths use Python.
- Boundary tests fail if `plugins/immune-brain/dist/immune_brain_runtime.py`, `plugins/immune-brain/dist/.imm/`, or Python editable package declarations return without an explicit exception.
- Public-release template checks fail if they advertise `python3` runtime startup.
- Documentation scans allow historical/superseded mentions but reject current production Python runtime instructions.

## Next Action

- Validate this Plan with `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-plan docs/plans/2026-06-29-002-refactor-python-reference-retirement-plan.md --json`.
- If validation passes and the user confirms scope, enter `imm-work` and activate Step `U1`.