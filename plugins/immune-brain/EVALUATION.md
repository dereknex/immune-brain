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

## Behavior baseline

The versioned behavior contract is
`tests/fixtures/immune-brain-benchmark.json`. It covers five representative
routes: candidate Spec/TaskIntent planning, a routine Managed lifecycle,
host-native mutation, a public-contract compatibility boundary, and a weak
plugin match. Managed scenarios run sequentially in independent copied Git
fixtures through an interactive Host with native authority tools. They require
real Enrollment decisions and exact terminal evidence; a passing test or
child summary is not lifecycle completion.

The existing `benchmark_eval.ts` runner uses non-interactive `pi --mode json`
and therefore rejects this fixture before launching a child. It remains usable
for fixtures that do not require native authority gates. Interactive lifecycle
and paid cost measurements remain pending; contract tests do not establish
provider-runtime savings. Do not bypass the gate to produce a baseline.

Compare completion, unnecessary questions, tool calls, tokens, duration, user
interventions, successful recovery, duplicated QA, and scope revisions only
from observed Host events. Missing signals are unavailable, never estimated
from child prose. Compare cost only with completion, verification, and authority
parity. Lower resource use alone is not an improvement.

The benchmark invokes a paid model and is not a normal unit-test dependency.
Unit tests validate the fixture and deterministic execution contracts; they do
not claim that an interactive benchmark has run.

For supported non-interactive fixtures, `benchmark_eval.ts --fixture <path>` emits one structured record containing
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
