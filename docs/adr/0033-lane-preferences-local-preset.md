---
status: accepted
---

# Lane preferences live in a local preset

Accepted on 2026-10-30 by the repository owner (#327, grilling session Q1–Q11 recorded in https://github.com/dereknex/immune-brain/issues/327#issuecomment-6517431178; `docs/specs/lane-preferences-local-preset.spec.md` D1–D9). It refines [ADR 0013](0013-optional-parallel-batch-lanes.md): lane mode itself is unchanged, only where its standing choices come from.

## Context

The preference reference held one principle: Immune-Brain loads no agent-local file, and every preference belongs in the Host's agent instruction files. Lane preferences (`Lane max parallel`, `Lane Executor Host`, `Lane Executor model`, `Lane Executor effort`) followed it, resolved from the request, the tracked repository instruction file, the user-level instruction file, then a default. Those values are personal and per machine — parallelism a laptop can carry, a Host subscription, a model and effort budget — yet a tracked `AGENTS.md` imposed one person's choice on every clone, and the user-level file could not hold more than one set. A fifth directive, `Batch final verification`, sat in the same table though it named repository facts, not preferences.

## Decision

Lane preferences are the one exception to "preferences live in Host instruction files". They live in `.imm/lanes.local.json` at the Parent's checkout root, which is gitignored.

- The file holds `active` (optional, a profile name) and `profiles` only; no `contract` field. A profile has four optional fields: `max_parallel`, `executor_host`, `executor_model`, `executor_effort`.
- Each field resolves as the literal request value, else the selected profile (the one the request names, else `active`), else today's default. With no file the behavior is today's no-directive behavior. A profile's model and effort apply only with that profile's `executor_host`.
- Malformed JSON, an unknown profile, an unknown key or an invalid value is reported and no batch starts.
- The Parent alone reads the file, directly. The runner, the runtime and Lane worktrees do not; no resolver helper exists.
- The four instruction-file lane directives are no longer read. The `Batch final verification` directive is deleted: final verification commands come from the request, else the repository's prose test and type-check commands, else none. The plain-command, at-most-8 constraint stays on the `final_verification` parameter.

`Initiative carrier default`, `Git integration` and the other preferences stay in instruction files.

## Consequences

Existing directive configurations are silently ignored after upgrade; the release is a major version and its changeset gives the migration. Each maintainer creates their own preset; none is committed. Contract checks prove the Parent contract states the resolution, not that an LLM Parent obeys it.
