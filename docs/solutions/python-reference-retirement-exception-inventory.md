---
title: Python Reference Retirement Exception Inventory
reusability: medium
key_files:
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - tests/python-reference-boundary.test.ts
  - tests/host-runtime-cutover.test.ts
  - tests/plugin-package-runtime.test.ts
  - docs/specs/python-reference-retirement.spec.md
  - docs/plans/2026-06-29-002-refactor-python-reference-retirement-plan.md
---

# Python Reference Retirement Exception Inventory

## Purpose

This inventory is the coverage gate for retiring the Immune-Brain Python reference runtime. It records the deleted runtime targets and the current exception policy after the Bun/TypeScript cutover.

## Current Runtime Truth

- Production host startup is Bun + TypeScript.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` is the production entrypoint.
- Python files are not accepted as production host startup paths.
- Repo-local Python files outside `upstreams/` are retirement targets unless explicitly listed as non-runtime exceptions below.

## Temporary Retirement Targets

Retired in the Python reference retirement Plan:

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` command bridge — retired from the Python exception list; workflow command dispatch now runs through native TypeScript handlers instead of `python3`.
- `plugins/immune-brain/dist/immune_brain_runtime.py` — deleted packaged Python reference runtime.
- `plugins/immune-brain/dist/.imm/` — deleted packaged Python reference workflow modules.
- `.imm/imm_core/` — deleted root Python reference workflow modules.
- `.imm/imm-*.py` — deleted legacy workflow wrappers and developer command surfaces.
- `.imm/pyproject.toml` — deleted editable Python package declaration for `imm_core` tests.
- `plugins/immune-brain/dist/.imm/pyproject.toml` — deleted packaged editable Python package declaration.
- `tests/test_*.py` — deleted Python test surfaces after Bun tests became canonical.

## Non-Runtime Exceptions

Current repo-local exceptions outside `upstreams/`: **none**.

Former non-runtime Python utilities were ported to Bun/TypeScript and the Python files were deleted:

- `scripts/plugin_versioning.py` → `scripts/plugin_versioning.ts`.
- `scripts/plugin_release.py` → `scripts/plugin_release.ts`.
- `scripts/detect-stale-refs.py` → `scripts/detect-stale-refs.ts`.
- `scripts/generate-plugin-coverage.py` → `scripts/generate-plugin-coverage.ts`.
- `plugins/immune-brain/skills/imm-init/scripts/init_project.py` → `plugins/immune-brain/skills/imm-init/scripts/init_project.ts`.
- `plugins/immune-brain/tests/test_init_project.py` → `plugins/immune-brain/tests/init-project.test.ts`.
- `tests/fixtures/immune-brain-benchmark-workspace/tests/test_fixture_contract.py` → `tests/fixtures/immune-brain-benchmark-workspace/tests/fixture-contract.test.ts`.

`upstreams/` Python files and requirements remain external reference content; they are out of scope unless copied into Immune-Brain runtime paths.

## Coverage Gate

Before deleting Python reference runtime files, Bun/TypeScript tests must cover:

- tool metadata and MCP startup through Bun;
- Plan validation through Bun;
- State Ledger status through Bun;
- activation planning through Bun;
- heal checks through Bun;
- autowork/work/review tool surfaces through Bun metadata or executable command tests;
- production host and public package startup scans that reject Python runtime commands.

## Retirement Rule

A Python file outside `upstreams/` must either be deleted, ported to Bun/TypeScript, or mapped to one of the non-runtime exceptions above. New exceptions require a documented owner and a scan proving no host runtime startup path invokes them.

## Behavior Not Ported

The coverage gate above is stated in terms of surfaces, so a guard could disappear
while every listed surface still had a passing test. An audit on 2026-08-01
compared the Python runtime against the TypeScript one on guards rather than
files and found four behaviors that no test missed. Three were restored the same
day:

- `depends_on` was enforced at activation in Python and became advisory in the
  port — any Step could be started first. Restored in `activateStep`.
- `activate_step` and `record_execution_evidence` were Ledger history actions in
  Python. The port kept the review-side vocabulary and dropped the
  execution-side, so history recorded decisions about work but not the work.
  Both are logged again.
- `rework` and `replan` required a reason in Python. The port accepted either
  without one, keeping the decision and losing what had to change. `imm-review`
  rejects them without `--notes`.

The fourth is a recorded gap rather than a restoration. Python's
`validate_step_activation` reads as an authority model, but its only caller
supplies the three defaults, so its role assertions compare hardcoded constants
against a static registry — a self-consistency check now covered by
`tests/skill-registry-metadata-contract.test.ts`. Its one dynamic guard,
`require_skill(agent_hint)`, is genuinely absent: a Plan may name a skill that
does not exist and the runtime stores the hint and hands it to `imm-loop` for
dispatch. Restoring it means the runtime reads `registry.yaml`, which ships
beside the runtime in the Claude, Cursor, and Codex channels but not in the
OpenCode npm package. That leaves failing closed, which breaks a channel, or
failing open, which is the silent no-op this repo already treats as a defect.
Neither is worth a typo-catcher, so `agent_hint` stays unvalidated until the
registry is reliably co-located.
