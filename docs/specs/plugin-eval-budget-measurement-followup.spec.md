# Spec: Plugin Eval Budget Measurement Follow-up

## Background

`plugin-eval analyze` reported `immune-brain` at 81/100 after real benchmark
usage was attached. The failing check was `observed-usage-estimate-drift`:
static active budget was 2369 tokens while observed average input usage was
91849 tokens across three benchmark samples. The warning check was
`deferred_cost_tokens-budget-high` at 56161 tokens. A small info deduction also
came from missing coverage artifacts under `plugins/immune-brain/`.

Local inspection of the cached Plugin Eval implementation showed that plugin
static active budget is computed from the plugin manifest and each skill
`SKILL.md` file. It does not model runtime-expanded `dist/*.md` instructions,
project files opened during benchmark tasks, or other session context. The
large observed/static delta is therefore a measurement interpretation gap unless
later evidence proves repeated instruction text is being unnecessarily loaded.

## Goal

Make the next Immune-Brain improvement slice turn the Plugin Eval findings into
actionable, repeatable evidence without rewriting already-compact skill entry
files.

## Requirements

1. The plugin must document the difference between static Plugin Eval budgets
   and observed benchmark usage in a place maintainers can find when evaluating
   `plugins/immune-brain`.
2. The documentation must state that static active budget covers manifest plus
   `SKILL.md` entry files, while observed usage includes benchmark session
   context and runtime-expanded instructions.
3. The fix must not hide real budget pressure. It must preserve the
   `deferred_cost_tokens` finding as a signal to monitor and explain why
   `dist/` and reference material are expected contributors.
4. The plugin target must provide a recognized coverage artifact under
   `plugins/immune-brain/` so Plugin Eval no longer reports
   `coverage-artifacts-unavailable`.
5. The coverage path must be reproducible from repository commands and must not
   require network access during normal verification.
6. Focused regression coverage must prevent the budget interpretation note and
   coverage artifact path from silently drifting.

## Non-Goals

- Do not edit the cached `plugin-eval` package.
- Do not rewrite every `SKILL.md`; current skill entry files are intentionally
  compact.
- Do not remove `dist/` instructions or packaged reference material only to
  improve a static budget score.
- Do not claim the observed/static drift is fixed unless a rerun with observed
  usage proves it.

## Verification

- Focused tests assert the budget measurement note exists and contains the
  static-vs-observed distinction.
- A local coverage command produces `plugins/immune-brain/coverage.xml`.
- `plugin-eval analyze plugins/immune-brain --format markdown --observed-usage
  plugins/immune-brain/.plugin-eval/benchmark-usage.jsonl` is rerun after the
  implementation slice to compare the resulting checks.
