# Changelog

## 3.6.6

### Patch Changes

- [`b1d8696`](https://github.com/dereknex/immune-brain/commit/b1d8696501fd7e97e5ce38132f43256a71cd6b65) Thanks [@dereknex](https://github.com/dereknex)! - Unattended batch runs: Git branch preflight and scope-bounded child commits

  Batch preflight now requires a clean tree (including untracked files and dirty
  submodules), a committed HEAD, a verified top-level repository root, and the
  absence of `imm/<initiative-slug>` before any state is written. Child commits
  are created only after Kernel settlement, staged strictly within the child's
  TaskIntent scope plus its audit directory, verified against branch/HEAD
  lineage and the committed tree delta, and backed by durable commit evidence so
  crash recovery can distinguish its own commits from forged external ones.
  Also fixes the bun runner resolution under mise/asdf shims.

## 3.6.5

### Patch Changes

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Carry the assurance fixes found while running the first real batch

  Driving an enrolled batch through both Hosts surfaced five boundaries that
  stopped a task with no way forward:

  - A user can now authorize rework continuation directly, without escalating a
    routine rework to the reviewer.
  - A malformed Review receipt is recovered from durable evidence instead of
    pinning the task in a state no operation can leave.
  - The Claude Host exposes `resolve_finding`, so a closed finding on that Host no
    longer requires switching to Pi.
  - Published GitHub Issues carry their own public acceptance summary instead of
    the canonical TaskIntent assertion prose. The projected text stays within
    1–500 characters, and the input limit now accepts a summary that matches a
    canonical assertion length rather than rejecting the whole batch.

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Stop a Managed task from Pi with one native confirmation

  Kernel already settled tasks on `stop`, but the Pi extension exposed no user
  reachable entry, so a task holding the workspace claim could not be released
  without editing `.imm` state by hand.

  `imm_kernel_canary` accepts `action: {op: request_stop}` for an eligible
  `active` or `frozen` task, including one waiting on Review or a replan gate.
  The Host opens one native confirmation, builds the stop authority itself, and
  the Kernel performs the existing stop settlement: terminal TaskRecord,
  terminal proof, archived planning artifacts and a released claim. Unrelated
  and implementation files are preserved.

  Cancelling, timing out, aborting, or closing the session before the commit
  mutates nothing, and a stop preparation failure releases the invocation so the
  same session can retry. Concurrent Assurance work and a snapshot that moved
  under the request are rejected rather than overwritten; a confirmed stop
  invalidates outstanding Review resources so a late verdict cannot rewrite
  terminal evidence. A delivery failure after the commit is reported separately
  and does not undo the stop.

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Run one confirmed Initiative batch serially and resume it after a crash

  A confirmed batch plan had no executor that could survive an interruption: a
  child could be enrolled, settled and committed at three separate points, and
  restarting the run re-derived none of them.

  `startBatch` and `resumeBatch` now drive one eligible child at a time through
  enroll → advance → commit, and a resumed run adopts whatever the previous
  process had already persisted. Recovery shares the dependency-aware child
  selection rule with the normal loop instead of re-implementing it, so a
  reverse-ordered plan resumes identically to a forward-ordered one.

  Renewed authorization no longer loses the consumption history of children that
  were already committed. Before the next enrollment the driver verifies each
  committed child against the batch commit ledger, so a stale or fabricated
  `committed` flag cannot report a completed batch, and HEAD lineage stays
  enforced for the first enrollment of a fresh authorization.

  Persistence derives its path from a validated `batch_id` at every entrypoint,
  so a caller cannot escape `.imm/state/batches/`, and the replan gate keeps
  QA rework and Review rework on separate counters.

## 3.6.4

### Patch Changes

- [#39](https://github.com/dereknex/immune-brain/pull/39) [`5a14619`](https://github.com/dereknex/immune-brain/commit/5a14619ad8e2b383c5c99646d46b689e554c837b) Thanks [@dereknex](https://github.com/dereknex)! - Publish the full Review revision identity from the Claude Host

  `submitReview` re-derives the Review revision and compares `base_head`,
  `review_commit`, `review_tree` and `manifest_digest` against the reservation. The
  Claude Host adapter returned only the commit identity, so the last comparison put
  a real digest against `undefined` and every TaskRecord v4 submission stopped with
  `review_preparation_failed: Review revision changed before submission` — an
  unfalsifiable failure, because the revision it named had not moved. No Review
  could settle on that Host.

  The adapter now recomputes the manifest and republishes the same four fields the
  Review snapshot binds, using the outcomes of the settled QA attestation. The Pi
  adapter already recomputed the manifest but drew its outcomes from a preflight
  stand-in, which matched the settled attestation only because deterministic QA
  happens to write that exact summary; it now reads the attestation too, so both
  hosts agree by construction rather than by coincidence.

  Adds `tests/review-revision-identity-conformance.test.ts`, which drives a real
  repository and a real TaskRecord through `advance` and `submitReview`. A port
  double cannot express this defect, which is why the existing coordinator suites
  never saw it.

- [#40](https://github.com/dereknex/immune-brain/pull/40) [`934115b`](https://github.com/dereknex/immune-brain/commit/934115b9c3fb4cdce100321d8930209faa413297) Thanks [@dereknex](https://github.com/dereknex)! - Typecheck the repository and gate every pull request

  Four host-adapter defects reached published plugins in a row. The systemic cause
  was not any one of them: this repository had never been type checked, and no
  check ran before a merge.

  There was no `tsconfig.json`, no `tsc` invocation anywhere, and TypeScript was
  not even a dependency. Turning the compiler on reported 59 errors in the runtime
  and script sources, 17 of them (36%) in `runtime/claude/kernel_ports.ts` and
  `runtime/claude/review_host.ts` — the two files that produced three of the four
  escapes. The compiler was already pointing at the shipped defect family:
  `'{ review_revision?: … }' is not assignable to 'TaskApprovalV2'` and
  `Property 'git_base_head' does not exist on type 'TaskRecord'`.

  All 59 are fixed, none by widening to `any`. The substantive ones:

  - The Claude approval literal was untyped, so `kind` widened to `string` and
    every check on `review_revision` — the exact field family that shipped broken
    four times — was disabled. It is now a declared `TaskApprovalV2`.
  - Reading `git_base_head` off a `TaskRecord` union tested the contract string
    into a plain boolean, which does not narrow. Adds `isTaskRecordV4`, and both
    host adapters now prove the field is present before binding a revision.
  - `runtime/claude/review_host.ts` matched a reservation on `sessionId` and
    `agentId`, which `PendingReview` never declared; every check was inert and the
    function had no callers. Removed.
  - `commitEnrollmentLocked` was declared as returning a v2 record while returning
    a v4 one, and `JournalReasonCode` was missing the 13 codes the Kernel CLI
    actually emits.
  - A `TaskTombstone` could be written with `terminal_lifecycle: "active"`, which
    its own contract forbids; settlement now refuses a nonterminal record.
  - `failCanaryTool` could not report `review_preparation_failed`, a declared
    `ToolFailureV1` state and a documented Loop recovery path.
  - `notifyOnce` was called through a coordinator port that supplies no UI.

  Closes the type-level hole behind the last escape: `ReviewRevision.manifest_digest`
  was optional, so a host returning the bare commit identity still satisfied
  `ensureReviewRevision`. The bare identity is now a separate
  `ReviewRevisionCommit`, and omitting the digest fails the build instead of every
  v4 submission at runtime. Deletes the unused `ensureReviewRevision` export that
  defined the loose shape.

  Makes the production port wiring reachable from tests. `ClaudeRuntime.kernelPorts()`
  returns the object the coordinator actually runs on, and its `ports` option now
  layers overrides on top of it rather than replacing it wholesale; the Pi ports
  move out of an anonymous default export into
  `createPiAssuranceProgressionPorts`. Every escaped defect lived in these two
  objects, and neither was constructible from a test.

  Adds `.github/workflows/ci.yml` on `pull_request`, running typecheck, the
  plugin build and doc sync checks, versioning validation and `bun test`. Adds
  `bun run typecheck` and wires it into `verify:release`.

## 3.6.3

### Patch Changes

- [#37](https://github.com/dereknex/immune-brain/pull/37) [`89254ef`](https://github.com/dereknex/immune-brain/commit/89254ef60b07c3996624dc1b64831f406d931314) Thanks [@dereknex](https://github.com/dereknex)! - Settle Claude Host Review from the async Agent transcript

  The Claude Code Host reconstructed the Review receipt from the `Agent` tool's
  `PostToolUse` result, assuming that result was the reviewer's verdict. This
  Claude Code build runs every `Agent` call asynchronously — `run_in_background:
false` is not honoured and there is no synchronous mode — so the result is a
  launch receipt (`{"isAsync":true,"status":"async_launched",…}`) and never the
  verdict. No Review could be consumed on that Host.

  `inspectReview` now recognises the launch receipt, cross-checks the `agentId`
  against the `SubagentStart`/`SubagentStop` pair it already observed, and reads
  the reviewer's terminal message from the transcript the receipt names, matching
  the writing `agentId` per record. There is no fallback to Parent-supplied bytes:
  an unreadable or silent transcript fails closed, because an optional weaker path
  is one the Parent could force.

  A stale `SessionEnd` no longer discards live evidence. A resumed session reuses
  its id and hook log, so an end recorded for the previous run could sit ahead of
  the current run's events; draining cleared the whole log and stopped there. It
  now advances surviving reservations past the end — keeping pre-end events
  unusable — and reclaims the log only when nothing followed. `prepareReview`
  also drains before taking its cursors.

  Adds `tests/claude-review-host-async-agent.test.ts`, whose fixtures are recorded
  from Claude Code 2.1.261 rather than reconstructed from the documented shapes.

## 3.6.2

### Patch Changes

- [#35](https://github.com/dereknex/immune-brain/pull/35) [`0464612`](https://github.com/dereknex/immune-brain/commit/04646126c0ae3cbdf63663fb3f6b20240a74fdfc) Thanks [@dereknex](https://github.com/dereknex)! - Resolve packaged internal role prompts from the shipped bundle layout

  `loadRolePrompt` walked one directory up from the module that contains it and
  looked for `dist/role-prompts/`. That is correct from source, where the module
  sits in `runtime/` beside `dist/`, but the Claude Code Host loads the bundle at
  `dist/claude/mcp-server.mjs`, where the same walk computes a `dist/dist/` that
  never exists. Every internal role prompt therefore failed to load on the Claude
  Host, blocking Review delegation. The resolver now searches both layouts.

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
