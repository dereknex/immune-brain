# Changelog

## 3.6.1

### Patch Changes

- [#33](https://github.com/dereknex/immune-brain/pull/33) [`2657d08`](https://github.com/dereknex/immune-brain/commit/2657d082052c7000d28b66eb51dcb671c3691489) Thanks [@dereknex](https://github.com/dereknex)! - Resolve the TaskIntent sidecar through the TaskRecord on the Claude Code Host.

  `freeze_artifacts` relocates `docs/plans/<task-id>.intent.json` into
  `docs/plans/archive/`, but the Claude adapter read every intent at the pre-freeze
  default path. Any Managed task therefore failed QA settlement with a raw `ENOENT`
  once its artifacts were frozen, which no test covered because every settled task
  in this repository had run on Pi.

  - `runtime/claude/kernel_ports.ts` now reads through `intent_ref.path` at all five
    call sites, matching the Pi adapter.
  - `runtime/kernel/intent.ts` resolves a path-less read to the sidecar that exists —
    active first, archive as the post-freeze fallback — and reports a missing sidecar
    as a stable contract failure instead of a raw filesystem error.
  - `runtime/assurance/coordinator.ts` proves a rejected ordinary mutation wrote
    nothing by re-reading the record revision, so a Kernel precondition rejection is
    reported as a deterministic failure rather than `settlement_unknown`, which the
    Loop would otherwise retry forever.
  - `dist/imm-loop.md` carries the Initiative carrier gate it actually performs, so a
    failed `publish-initiative` batch can no longer be cleared by re-entering the Loop.

## 3.6.0

### Minor Changes

- [`35a46f7`](https://github.com/dereknex/immune-brain/commit/35a46f7541ec413f51032a6d4f18b0d9ba831e24) Thanks [@dereknex](https://github.com/dereknex)! - Make Initiative carrier resolution host-portable and remove its silent default. Planner now reads the repository and user-level agent instruction files directly instead of assuming the Host injected `AGENTS.md` into context, so a configured carrier is no longer ignored on Hosts that auto-load `CLAUDE.md` or never read `~/.pi/agent/AGENTS.md`. When no valid directive is found, Planner asks and reports which sources it checked rather than silently resolving to `local` or `github`.

## 3.5.0

### Minor Changes

- [`75842d3`](https://github.com/dereknex/immune-brain/commit/75842d36c6c9cff625e29140cd512a6417e7344c) Thanks [@dereknex](https://github.com/dereknex)! - Deepen Task Rail acceptance-progress row with granular lifecycle phases and introduce the read-only `/imm-tasks` command and modal overview.

## 3.4.0

### Minor Changes

- [`6d7d645`](https://github.com/dereknex/immune-brain/commit/6d7d6457a03ff25bdbe82b36d2139c149527d952) Thanks [@dereknex](https://github.com/dereknex)! - Replace Claude permission-Hook authorization with digest-bound server-initiated MCP elicitation, make Managed authority guidance Host-neutral, and raise the verified Claude Code minimum to 2.1.236.

## 3.3.0

### Minor Changes

- [`e5e41ac`](https://github.com/dereknex/immune-brain/commit/e5e41ac9b43d2b367d3c88918d101eba3ee74a11) Thanks [@dereknex](https://github.com/dereknex)! - Retire the critical user approval gate from Kernel settlement. Fresh QA and any required Review now settle tasks automatically; the former critical-completion confirmation gate is removed, and `request_authorization` is reserved for unresolved user decisions and explicit stop. User authority stays bound to unresolved decisions, explicit stop, breaking Intent revisions, and concrete exception operations rather than risk tier alone.

## 3.2.2

### Patch Changes

- [`af66a62`](https://github.com/dereknex/immune-brain/commit/af66a62df426d84b2f51cbd2a9ae7216050a04e3) Thanks [@dereknex](https://github.com/dereknex)! - Slim public skill entry points to minimal canonical-contract loaders: imm-planner, imm-loop, and imm-agent-doc-maintain SKILL.md files no longer duplicate contract prose and instead identify and load their dist/ packaged contracts; contract tests and the dist sync manifest enforce the loader shape.

## 3.2.1

### Patch Changes

- [`f031290`](https://github.com/dereknex/immune-brain/commit/f031290002748d23b414e73ff063a3a0a1471b49) Thanks [@dereknex](https://github.com/dereknex)! - Use Changesets as the only version bump and publish entrypoint while retaining manifest synchronization and validation for the Claude Code plugin.

## 3.2.0

### Minor Changes

- [`32d6538`](https://github.com/dereknex/immune-brain/commit/32d6538330d794385f1294c2565b3edfc9e2a1c0) Thanks [@dereknex](https://github.com/dereknex)! - Replace incremental GitHub Initiative Issue creation with one complete publication batch.

  Planner now presents the full Parent/Child decomposition, granularity, dependencies, and execution order for one user decision before any remote mutation. After approval, `imm-tracker publish-initiative --stdin --json` validates every tracked TaskIntent and the complete dependency graph, idempotently publishes and verifies all native Issue relationships, links each Child to its Parent, and returns the recommended first Issue, stable order, and parallel groups.

  The former `create-initiative` and `upsert-task` CLI entrypoints are removed. Existing terminal Issue projection remains unchanged.

- [`dc76728`](https://github.com/dereknex/immune-brain/commit/dc767286cace89bc111b0984a1af0fdfd73c72d) Thanks [@dereknex](https://github.com/dereknex)! - Add `imm-agent-doc-maintain` as the sixth public standalone maintenance skill for agent-facing documentation upkeep.

## 3.0.1

### Patch Changes

- [`f0b99a0`](https://github.com/dereknex/immune-brain/commit/f0b99a0a2f1d4577f9e219aa023e6cb61e8fe8fc) Thanks [@dereknex](https://github.com/dereknex)! - Normalize JSON-string Tool action arguments before schema validation.

  `hyper/qwen3.8-flash` can emit the object-valued `action` argument of
  `imm_loop_action` and `imm_kernel_canary` as a JSON string
  (`action: "{\"op\":\"status\"}"`), which the strict TypeBox schemas previously
  rejected with repeated pre-execution failures. These Tools now recover exactly
  that observed shape through Pi's `prepareArguments` pre-validation hook: only a
  top-level `action` string that parses to a non-null, non-array object is
  recovered; native object input, invalid JSON, arrays, `null`, primitives, and
  all other malformed input still fail the unchanged strict schemas.

## 2.8.3

### Patch Changes

- [`61ccc29`](https://github.com/dereknex/immune-brain/commit/61ccc29c175edc29af7c485f795c8c33e4be8c1f) Thanks [@dereknex](https://github.com/dereknex)! - fix(tracker): avoid gh output limit exceeded by paginating snapshot and raising MAX_GH_OUTPUT

  - paginate GitHub Issues snapshot (100/page, up to 100 pages) instead of single --paginate --slurp blob
  - raise MAX_GH_OUTPUT 1MiB -> 8MiB to handle 65KB bodies without per-page overflow

## 2.2.0

### Removed

- The temporary Canary Slash Commands are removed from the Pi extension and npm package. Enrollment, assurance, authorization, interruption recovery, and successor state transitions no longer have command fallbacks or replacement aliases.

### Changed

- Repository mutation requests now enter Managed Path from natural language automatically. `imm-brainstorm`, `imm-planner`, and `imm-loop` remain the public workflow Skills.
- Enrollment and assurance continue through the foreground `imm_canary_enrollment` and `imm_kernel_canary` Tools with native TUI authorization and persistent Kernel `next_action` results.
