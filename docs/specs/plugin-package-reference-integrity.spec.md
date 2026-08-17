# Functional Spec: Plugin Package Reference Integrity

## Background

Installed `immune-brain` package checks found that several skill documents
refer to local package files that are absent or unreachable after installation.
The main runtime can start, but review and workflow instructions lose important
reference material when used from the plugin cache.

Observed examples:

- `imm-ui-review` references `docs/reference/ux-heuristic-checklist.md`, but
  the packaged `dist/docs/reference/` copy does not include it.
- `imm-code-review` references `agent-quality-checklists.md` and
  `code-simplification-checklist.md`, but those files are not packaged.
- `imm-work` references `HANDOFF-template.md` and
  `compaction-handoff-hosts.md`, but those files are not packaged.
- Several `dist/*.md` Markdown links use source-tree relative paths such as
  `../BASELINE.md`, `../../../../docs/reference/...`, or `./SKILL.md` that do
  not resolve inside the installed plugin.

## Goal

The packaged `immune-brain` plugin must be self-consistent: any local reference
that a skill instructs an agent to load must either exist inside the plugin at
the referenced path or be intentionally classified as a target-project runtime
path.

## Requirements

1. Package all `docs/reference/*` files that packaged skill documents instruct
   agents to load as local reference material.
2. Rewrite or neutralize Markdown links in `plugins/immune-brain/dist/*.md` so
   they resolve inside the installed plugin package.
3. Keep target-project runtime paths such as `.imm/memory/*`, `docs/plans/*`,
   and generated artifacts out of the packaged-reference requirement.
4. Add automated regression coverage that fails when a packaged skill document
   points to a missing plugin-local reference.
5. Keep existing runtime entrypoints and activation-plan validation behavior
   unchanged.

## Non-Goals

- Do not package the full repository documentation tree.
- Do not change skill behavior beyond making its documented references
  available and linkable.
- Do not broaden `imm-activation-plan --validate-refs` unless it remains
  compatible with the current catalog reference validation contract.

## Verification

- A package-reference integrity test scans packaged skill documents and fails
  on missing plugin-local references.
- `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts`
  passes.
- Focused manual inspection confirms `imm-ui-review`, `imm-code-review`, and
  `imm-work` reference files exist in `plugins/immune-brain/dist/docs/reference/`.
