---
title: Python Reference Quarantine Boundary
reusability: high
key_files:
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - tests/python-reference-boundary.test.ts
  - tests/host-runtime-cutover.test.ts
  - tests/plugin-package-runtime.test.ts
  - scripts/plugin_versioning.ts
  - scripts/plugin_release.ts
---

# Pattern: Python Reference Quarantine Boundary

## 场景

The Immune-Brain host runtime migrated from Python to Bun + TypeScript
(`docs/specs/archive/bun-typescript-runtime-migration.spec.md`). The Python parity
reference has been retired; production and developer command surfaces should use
Bun/TypeScript.

## 方案模板

- Production host runtime = Bun + TypeScript exclusively.
  - `plugins/immune-brain/runtime/immune_brain_runtime.ts` is the source of truth.
  - `.mcp.json`, `bin/imm-*`, `.opencode-plugin/runtime.ts`, and `mise.toml`
    runtime tasks invoke `bun`, never `python3`.
- Python reference boundary:
  - `plugins/immune-brain/dist/immune_brain_runtime.py`, packaged `.imm/`, root
    `.imm/imm_core/`, `.imm/imm-*.py`, and `tests/test_*.py` Python regression
    surfaces are retired.
  - Release/versioning, stale-ref detection, coverage generation, imm-init, and
    benchmark fixture tests have Bun/TypeScript replacements.

## Reference Retirement Criteria

Python reference code was deleted after ALL of the following held:

1. The TypeScript runtime has characterization coverage for every Python
   reference module ported in Step U2 (state machine, plan runtime, ledger,
   heal, activation).
2. No production host runtime path references `python3` or
   `immune_brain_runtime.py` (enforced by `tests/host-runtime-cutover.test.ts`).
3. The Python reference tests are no longer needed as a parity baseline —
   i.e., the TypeScript characterization tests are the canonical regression
   surface.
4. `mise.toml` dev tooling that used `python3` (unittest suite, `json.tool`,
   `plugin_versioning.py`) was ported to Bun/TypeScript.

## 可复用前提

- A breaking migration is acceptable (no compatibility window).
- The new runtime has executable regression tests that replace the old reference.

## 验证依据

- `bun test tests/host-runtime-cutover.test.ts` — production-path scan fails on
  `python3` runtime startup.
- `bun test tests/python-reference-boundary.test.ts` — repo-local Python outside
  `upstreams/` is absent and host runtime commands do not reference Python.
