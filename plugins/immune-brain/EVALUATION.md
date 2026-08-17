# Immune-Brain Evaluation Notes

## Plugin Eval budget measurement

Plugin Eval reports two different budget signals for this plugin:

- Static active budget: the estimated text visible from the root Pi package
  manifest's `pi.skills` and `pi.extensions` entry surfaces plus each skill
  `SKILL.md` entry file.
- Observed benchmark usage: the real input tokens consumed by representative
  benchmark sessions, including benchmark workspace context, user task text,
  files inspected during the run, and runtime-expanded `dist/` instructions.

These two values are intentionally not the same measurement. The static active
budget is a compact-entry estimate. It is useful for checking that manifest entry text and skill trigger shims stay small. Observed benchmark usage is a
runtime cost measurement. It is useful for checking the actual cost of a full
workflow run.

`deferred_cost_tokens` remains a real monitoring signal. The packaged `dist/`
instructions and reference material are loaded only when a workflow needs them,
but they still represent maintenance and runtime cost pressure. A high deferred
budget should trigger targeted inspection of repeated reference text and
runtime loading paths, not broad edits to already-small skill shims.

Do not rewrite compact `SKILL.md` entry files only to reduce observed benchmark
usage. Those files intentionally stay short and route to detailed `dist/`
instructions on invocation. If observed usage remains high, inspect the specific
benchmark scenario, files loaded by that scenario, and repeated reference text
before changing skill entry contracts.

## GPT-5.6 behavior baseline

The versioned behavior contract is
`tests/fixtures/immune-brain-benchmark.json`. It covers five representative
routes: managed planning, managed execution, an unprompted Direct-first local
task with multiple files/verifiers, a hard-risk public-contract Managed
boundary, and a weak plugin match. Keep the fixture workspace small so the run
measures workflow behavior rather than repository discovery.

For GPT-5.6 prompt migration, change one prompt or runtime behavior group at a
time and rerun the same scenarios. Compare task completion, unnecessary
questions, lifecycle artifacts, tool loops, subagent calls, input tokens,
latency, and cost. Lower resource use counts as an improvement only when all
scenario success checks and verifier commands still pass.

The benchmark invokes a paid model and is not a normal unit-test dependency.
Its first GPT-5.6 model run is intentionally recorded as pending until an
authorized operator runs the repository's plugin-eval command. Unit tests only
validate that the benchmark contract remains portable and keeps all five
behavior classes.

`mise r benchmark-eval` emits one structured record containing
`scenario_status`, `question_count`, `tool_uses`, `reported_tokens`, and
`duration_ms` for every scenario. It writes the newest record to
`benchmark-results/immune-brain/latest.json` and appends the same record to
`benchmark-results/immune-brain/history.jsonl` for local historical comparison.
These generated paid-run artifacts stay inside the repository working directory
but are ignored by Git.

Focused Brainstorm prompt migrations use
`tests/fixtures/imm-brainstorm-behavior-benchmark.json` instead of adding
narrowing-only cases to the five-route baseline. Run all scenarios through one
parallel Pi `Agent` batch with the model and isolation contract declared in the
config. Compare dependent-question count, independent-probe budget, conditional
scenario use, rejected-decision re-litigation, tool uses, reported tokens, and
duration. When Pi does not expose provider billing, record
`cost: unavailable_by_host` rather than estimating it.
