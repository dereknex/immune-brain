# TaskIntent Payload Drafts — v4 Deletion Completion Roadmap

Companion to
[`docs/specs/v4-deletion-completion-and-contract-realignment-roadmap.spec.md`](../specs/v4-deletion-completion-and-contract-realignment-roadmap.spec.md).

This file holds **draft payload content** for the 13 candidate slices defined in
that roadmap's §5. It is planning memory, not authority. Nothing here is a
TaskIntent until it is authored and enrolled.

## Why these are drafts and not authored sidecars

`imm-kernel intent author` is exclusive-create: `commands/kernel.ts:616` returns
*"destination already exists; no-overwrite authoring never replaces it"*. And
`classifyIntentRevision` (`kernel/intent.ts:262-283`) classifies any change to
`goal`, `scope_hint`, or an existing `acceptance[].assertion` as **breaking**.

Together those mean an authored sidecar cannot be corrected in place. If its
scope turns out wrong, the only remedy is a new `task_id`, leaving a dead
sidecar behind. The repository already carries that cost: `2026-08-15-015` →
`016`, `2026-08-15-020` → `021`, and `2026-08-19-001` → `002` → `003` are all
successor pairs created because enrolled assertions could not be corrected.

Only a slice whose scope is provably stable should be authored ahead of its
gate. Of the 13 below, exactly one qualifies today
(`retire-imm-core-barrel`, §1.1).

## How to promote a draft

1. Confirm the slice's gate in the roadmap §5 is satisfied.
2. **Re-derive every `scope_hint` entry marked `RE-VERIFY`** against the current
   tree. Scope drift is non-waivable at enrollment.

   For any slice that deletes or moves a module, derive scope along **two** axes,
   not one. Importers are the obvious axis; the axis that gets missed is tests
   that name the module *by path string* and assert it exists or read it:

   ```bash
   rg -l "from \"[^\"]*/<module>\"" --glob '*.ts'   # importers
   rg -l "runtime/<module>\.ts" --glob '*.test.ts'  # path asserters
   ```

   A path asserter fails the instant the file disappears, and because it never
   imported the module it will not show up in an import search.
3. Assign `task_id` as `YYYY-MM-DD-NNN-<slug>` using the promotion date.
4. Set each descriptor's `runner_version` to the installed Bun version and point
   `argv` at the focused test file. Never use the full suite.
5. Author, validate, stage:

```bash
imm-kernel intent author docs/plans/<task-id>.intent.json --stdin --json < candidate.json
imm-kernel intent validate docs/plans/<task-id>.intent.json --json
git add docs/plans/<task-id>.intent.json
```

6. Enroll through the Pi TUI. Under test-first execution the descriptor rehearsal
   will report `failed` because the test file does not exist yet; that failure is
   waivable and requires the explicit waiver route.

**Descriptor template** — the `verification` field is a canonical JSON string:

```json
{"contract":"assurance_kernel/verification_descriptor/v1","runner_id":"bun","runner_version":"<bun --version>","argv":["test","tests/<focused>.test.ts"],"cwd":".","timeout_ms":30000,"max_output_bytes":65536}
```

---

## Phase 0 — already authored

`2026-08-19-004-realign-v4-contract-documents` is authored, Git-tracked, and
`enrollment_ready`. Not restated here.

---

## 1. Phase 1 slices

### 1.1 `retire-imm-core-barrel` — CLOSED

Promoted as `2026-08-19-005-retire-imm-core-barrel` and completed. Retained for
the scope-derivation lesson recorded below, not as a promotable draft.

**Risk**: `routine` · **Gate**: Phase 0 complete · **Scope stability**: verified
stable across Phase 0 (zero overlap with Phase 0's scope)

**goal**

> Delete the `runtime/imm_core.ts` re-export barrel and repoint its test
> importers at the concrete modules they actually use. The barrel has no
> non-test importer, so no production path changes. This slice exists on its own
> because it converts the v3 runtime island from "referenced through a barrel"
> to "referenced by nothing", which is the seam the island deletion depends on.
> Import rewiring must preserve the exact symbol each test consumed; a barrel
> removal is where an accidental repoint to a different symbol would hide.

**acceptance**

- `acc-barrel-absent` — `runtime/imm_core.ts` does not exist and no file in the
  repository imports it.
- `acc-suite-unchanged` — the full test suite passes with every rewired test
  importing its symbols directly from the owning module.

**verification** — one focused test asserting barrel absence and zero importers;
suite health is proven by the QA run rather than by a descriptor.

**scope_hint** (verified 2026-08-19)

```
plugins/immune-brain/runtime/imm_core.ts
plugins/immune-brain/tests/review-gates.test.ts
tests/advisory-budget-contract.test.ts
tests/advisory-dispatch-core.test.ts
tests/fast-track-detection.test.ts
tests/handoff-projection.test.ts
tests/handoff-scope-exclusion.test.ts
tests/heal-activation.test.ts
tests/imm-loop-review-lifecycle-state.test.ts
tests/immune-brain-config-runtime.test.ts
tests/loop-child-output-contract.test.ts
tests/loop-execution-routing.test.ts
tests/pi-brainstorm-agent-result-contract.test.ts
tests/pi-only-current-contracts.test.ts
tests/pi-only-runtime-host-contract.test.ts
tests/plan-validation.test.ts
tests/planner-ensemble-contract.test.ts
tests/python-reference-boundary.test.ts
tests/role-prompt-bridge.test.ts
tests/runtime-state.test.ts
```

The last two entries above are **path asserters, not importers**, and were added
after re-verification on promotion day. `python-reference-boundary.test.ts:65`
asserts the barrel exists, and `pi-only-current-contracts.test.ts:50,96` read it
to scan for forbidden tokens; both fail on deletion. The barrel must be dropped
from those assertions rather than the assertions being weakened — they are
pinning "no progress-projection / no host-selector tokens in live runtime
sources", so the token scan stays and only the deleted path leaves the list.

### 1.2 `rehome-agent-config-loader` — CLOSED

Promoted as `2026-08-19-006-rehome-agent-config-loader` and completed. The
dependency direction held: `agent_config.ts` imports only node built-ins and
`plan_core` (a survivor, trimmed but not deleted by slice 1.6), and
`advisory_dispatch.ts` imports back from it.

**Risk**: `routine` · **Gate**: `retire-imm-core-barrel` closed

**goal**

> Move the agent-local config loader out of `advisory_dispatch.ts` into a module
> that survives the island deletion. Slice 1.1 uncovered that `imm_core.ts` was
> not a pure barrel — it owned the only implementation of
> `resolveImmuneBrainLocalRoot`, `resolveImmuneBrainLocalPath`, and
> `readImmuneBrainConfig` — and relocated that code into `advisory_dispatch.ts`,
> which slice 1.4 deletes. Rehoming keeps the deletion slice a pure deletion and,
> more importantly, prevents demolition from silently deciding a product question
> that belongs to slice 1.3. This slice moves code without changing behavior: it
> neither wires the loader into any caller nor retires it.

**acceptance**

- `acc-loader-rehomed` — the three exported loader functions and their private
  TOML helpers live in a module outside the seven island modules, and
  `advisory_dispatch.ts` no longer defines them.
- `acc-behavior-unchanged` — resolution of the local root, path rejection for
  absolute or traversal inputs, and the documented override precedence between
  `IMMUNE_BRAIN_AGENT_CONFIG`, `IMMUNE_BRAIN_CONFIG`, and the Pi-root
  `config.toml` are byte-identical to the pre-move behavior.

**scope_hint** — the new module, `runtime/advisory_dispatch.ts`, and the four
test files referencing the loader: `immune-brain-config-runtime.test.ts`,
`advisory-dispatch-core.test.ts`, `planner-ensemble-contract.test.ts`,
`pi-only-runtime-host-contract.test.ts`. `RE-VERIFY` before promotion.

**Note on the target module.** Do not rehome into another island module. The
loader's only structural dependency on `advisory_dispatch.ts` is the
`AdvisoryDispatchConfig` return type, which must be re-examined during this
slice: if that type is itself island-bound, the loader needs its own config type
or the slice must be re-scoped rather than importing a type out of the demolition
zone.

### 1.3 `resolve-subagent-activation-contract`

**Risk**: `material` · **Gate**: `rehome-agent-config-loader` closed · branches
off the deletion chain rather than sitting in it

**Product decision, not a cleanup.** The loader has no caller anywhere:
`runtime/v4_runtime.ts` and every `.pi-extension/*` module ignore it. Meanwhile
`[subagent_activation]` is asserted as binding policy by `AGENTS.md`, the
bootstrap `AGENTS.md` template, the packaged `dist/imm-planner.md` and
`dist/imm-brainstorm.md` contracts — which define `auto`, `explicit_only`, and
`disabled` and instruct agents to honor them before dispatching subagents — and
six reference documents including `docs/reference/immune-brain-config.md` with
its override-precedence table.

Packaged contracts therefore oblige agents to obey a policy the runtime never
loads. Resolve in one of two directions, and state which in the TaskIntent goal:
wire the loader into activation resolution so the documented behavior becomes
real, or retire `[subagent_activation]` from every surface above. Do not author
this slice until the direction is chosen; the two directions have disjoint scope.

`RE-VERIFY` scope entirely. Either direction touches `docs/reference/immune-brain-config.md`,
`scripts/dist-sync-manifest.ts` and the `dist/docs` copy, plus the documentation
asserters `pi-only-current-contracts.test.ts` and `host-runtime-cutover.test.ts`.

### 1.4 `drain-v3-island-test-surface`

**Risk**: `material` · **Gate**: `rehome-agent-config-loader` closed

**goal**

> Reduce the seven v3 island modules to zero references without deleting them,
> so that the deletion slice that follows is a pure file removal. The 21 affected
> test files need three different treatments, and the whole risk of the island
> retirement concentrates in telling them apart: 10 exercise only island modules
> and are deleted, 7 also cover surviving modules and must be trimmed rather than
> deleted, and 4 are path asserters that drop island paths while keeping their
> assertions. Deleting a mixed file to make the suite green would silently
> discard live coverage and still leave every test passing, which is precisely
> why this work is separated from the 6364-line deletion it enables.

**acceptance**

- `acc-references-drained` — no file outside the seven island modules imports
  any of them or names one by path, while all seven still exist on disk.
- `acc-live-coverage-preserved` — `authority_commit_receipts`,
  `automatic_observations`, `plan_core`, `role_prompt_bridge`, `loop_contract`,
  `dist-sync-manifest`, and `agent_config` each retain test coverage, and none of
  the seven trimmed files was deleted.

**The 7 files that must be trimmed, never deleted** — `advisory-dispatch-core`,
`authority-commit-receipts`, `immune-brain-config-runtime`,
`pi-only-runtime-host-contract`, `planner-ensemble-contract`, `role-prompt-bridge`,
`state-ledger-migration`.

### 1.5 `delete-v3-runtime-island`

**Risk**: `material` · **Gate**: `drain-v3-island-test-surface` closed. After the
drain slice this is a pure deletion of seven files with no accompanying edits.

**goal**

> Delete the seven v3 runtime modules that become unreferenced once the
> `imm_core` barrel is gone, together with the tests that exercise only them and
> the absence tests that existed only to pin them. This completes the deletion
> line that the predecessor roadmap's R4 declared finished while leaving the
> library closure in place. Deletion is justified by proven absence of live
> importers, not by the modules being unused at runtime.

**acceptance**

- `acc-island-absent` — `state_ledger.ts`, `project_migration.ts`,
  `advisory_dispatch.ts`, `work_probes.ts`, `environment.ts`, `handoff.ts`, and
  `activation.ts` do not exist under `runtime/`.
- `acc-live-projections-unchanged` — `imm-plan --routing-status --json` and
  `imm-kernel status --json` return the same projection shape as before the
  deletion.

**Blocking precondition — the relocated config loader.** Slice 1.1 revealed that
`imm_core.ts` was not a pure barrel: it also owned ~139 lines implementing the
agent-local config loader (`resolveImmuneBrainLocalRoot`,
`resolveImmuneBrainLocalPath`, `readImmuneBrainConfig`, and private TOML
parse/merge helpers). Execution relocated that code into `advisory_dispatch.ts`,
which is one of the seven modules this slice deletes. Deleting the island as-is
would therefore also delete the only code in the repository that reads
`IMMUNE_BRAIN_CONFIG` and `IMMUNE_BRAIN_AGENT_CONFIG`.

That loader is already documented-but-unreachable: `docs/reference/immune-brain-config.md`
specifies an override priority order, yet no live entry point calls the loader —
neither `runtime/v4_runtime.ts` nor any `.pi-extension/*` module. The condition
predates slice 1.1.

**Resolved by sequencing.** Slice 1.2 rehomes the loader out of this slice's
demolition set, and slice 1.3 owns the decision about whether the
`[subagent_activation]` contract should be wired or retired. Do not author this
slice until 1.2 has closed; deleting the island while the loader still lives in
`advisory_dispatch.ts` would silently answer 1.3 by demolition and reintroduce
exactly the contract-lie class that Phase 0 removed.

**scope_hint (re-derived after slice 1.1, both axes)** — the seven modules
`state_ledger.ts`, `project_migration.ts`, `advisory_dispatch.ts`,
`work_probes.ts`, `environment.ts`, `handoff.ts`, `activation.ts`, plus the union
of 20 test files below. The island is confirmed closed: the only non-test
importers of any of the seven are `environment.ts` and `project_migration.ts`,
both inside the island.

Axis 1, test importers (17): `plugins/immune-brain/tests/review-gates.test.ts`,
`advisory-budget-contract`, `advisory-dispatch-core`, `authority-commit-receipts`,
`bounded-ledger-history`, `execution-evidence-runtime`, `handoff-projection`,
`heal-activation`, `imm-loop-review-lifecycle-state`, `immune-brain-config-runtime`,
`pi-brainstorm-agent-result-contract`, `pi-only-runtime-host-contract`,
`planner-ensemble-contract`, `roadmap-plan-transition-state`, `role-prompt-bridge`,
`runtime-state`, `state-ledger-migration`.

Axis 2, path asserters adding three files not in axis 1:
`pi-subagent-dispatch-observability-contract`, `work-probe-packaging-contract`,
`wrapper-retirement`.

If the precondition resolves toward removing or rehoming the config loader, scope
additionally covers `docs/reference/immune-brain-config.md`,
`scripts/dist-sync-manifest.ts`, its `dist/docs` copy, and the documentation
asserters `pi-only-current-contracts.test.ts` and `host-runtime-cutover.test.ts`.

### 1.6 `trim-partially-live-runtime`

**Risk**: `material` · **Gate**: `delete-v3-runtime-island` closed

**goal**

> Trim the dead halves of two partially live modules and shrink the CLI surface
> without touching their live halves. Remove the `loop_contract.ts` child-output
> validators superseded by deterministic QA and native verdict parsing, and the
> `plan_core.ts` fast-track and migration-signature helpers whose only callers
> were deleted. Delete `bin/imm-activation-plan`, which currently exits with an
> unknown-command error and no guidance, and collapse the eight retired wrappers
> into one stub preserving today's retirement message. `package.json` declares no
> `bin` field and the only historical PATH install is already handled by
> `scripts/retire-stale-global-imm-wrappers.sh`, so no supported installation
> breaks.

**acceptance**

- `acc-dead-halves-removed` — the named validators and helpers are absent.
- `acc-live-halves-intact` — `imm-plan <plan-path> --json` and `imm_loop_action`
  return their current projections, proving the modules were trimmed not gutted.
- `acc-retired-surface-consistent` — every retired command name still prints
  retirement guidance rather than an unknown-command error.

**scope_hint** — `runtime/loop_contract.ts`, `runtime/plan_core.ts`,
`plugins/immune-brain/bin/*`, plus `RE-VERIFY` affected tests along both axes.
Note that this slice trims modules rather than deleting them, so `plan_core.ts`
path asserters such as `v4-plan-control-plane.test.ts` keep passing; only tests
covering the removed helpers need scope.

### 1.7 `retire-kernel-v1-store` (conditional)

**Risk**: `material` · **Gate**: a completed read-only reachability trace, **not**
the preceding slices

**Precondition to resolve before drafting further.** `.imm/tasks/` holds 43
`task_record/v2` entries and zero v1 records, but v1 `parseTaskRecord` is still
called from live `kernel/storage.ts` at lines 470, 522, 584, and 671. v1 and v2
paths coexist inside a live module. The trace must establish whether any of those
call sites is reachable from `canary_application.ts`.

**If the trace clears them**, the goal is to delete `kernel/reducer.ts`, the v1
storage paths, and the v1 `parseTaskIntent`/`parseTaskRecord` validators.
**If any is live, cancel this slice.** Do not force it because the sequence
suggests it.

**scope_hint** — `RE-VERIFY` entirely; depends on the trace result.

---

## 2. Phase 2 slices

### 2.1 `archive-terminal-planning-artifacts`

**Risk**: `routine` · **Gate**: Phase 1 closed

**goal**

> Archive terminal planning artifacts so agents browsing `docs/specs/` and
> `docs/plans/` reach current work instead of completed or superseded slices.
> Move terminal specs into `docs/specs/archive/`, prioritizing those citing dead
> Python paths or retired v3 concepts, and move the prose Plans in `docs/plans/`
> into `archive/` now that every v3 owner is terminal. Archival is a move, never
> a delete: history and provenance are preserved.

**acceptance**

- `acc-no-dead-tool-references` — no active spec references `imm-plan.py`,
  `activation_plan.py`, or `imm-autowork`.
- `acc-plans-current-only` — `docs/plans/` contains only non-terminal artifacts.

**scope_hint** — `docs/specs/`, `docs/plans/`, plus a new archival check test.
Counts measured today (205 active specs, 79 with Python references, 92 with v3
references, 29 prose Plans) are `RE-VERIFY` after Phase 1.

### 2.2 `single-source-shared-contracts`

**Risk**: `material` · **Gate**: Phase 1 closed

**goal**

> Reduce the duplicated shared contract text that every agent reads before doing
> any work. Collapse the three real `BASELINE.md` copies to one authoring source
> with generated copies, shrink the roughly 80% overlapping IMMUNE-BRAIN block in
> `AGENTS.md` to a reference, and bring `IMMUNE.md` to v4 with a version bump
> from v1.1.0 / 2026-05-29, removing its retired-command narrative.

**acceptance**

- `acc-baseline-single-source` — one authoring source exists and every generated
  copy is byte-identical to it.
- `acc-constitution-current` — `IMMUNE.md` references no retired command and
  records a bumped version.

**scope_hint** — the three `BASELINE.md` paths, `AGENTS.md`, `IMMUNE.md`,
`scripts/sync-dist-docs.ts`, plus `RE-VERIFY` affected contract tests.

### 2.3 `retire-roadmap-family-vocabulary`

**Risk**: `material` · **Gate**: `archive-terminal-planning-artifacts` closed

**goal**

> Close the vocabulary deferral recorded in Phase 0. Remove the Roadmap-family
> terms from `CONTEXT.md` together with the `dist/imm-planner.md` Roadmap-Backed
> Planning section that mandates recording them, so no contract requires a field
> the vocabulary no longer defines. Delete the `ui-review` and `qa` role prompts,
> which cannot be dispatched on the Kernel path because native review hardcodes
> `code-review` and QA is deterministic. The prose Plans consuming these fields
> must be archived first, which is why this slice follows 2.1.

**acceptance**

- `acc-vocabulary-contract-agreement` — no contract document mandates a field
  absent from `CONTEXT.md`.
- `acc-unreachable-prompts-absent` — the `ui-review` and `qa` role prompts and
  their packaged copies do not exist.

**scope_hint** — `CONTEXT.md`, `plugins/immune-brain/dist/imm-planner.md`,
`runtime/prompts/`, `dist/role-prompts/`, plus `RE-VERIFY` for `plan_core.ts`
roadmap validation if the fields are removed from Plan parsing too.

---

## 3. Phase 3 slices

### 3.1 `wire-breaking-intent-revision`

**Risk**: `material` · **Gate**: Phase 0 complete only — **independent of Phases
1 and 2**

**goal**

> Expose the already-implemented `approve_breaking_intent_revision` action on the
> `imm_kernel_canary` tool schema so a mid-task breaking scope change can be
> authorized in place instead of forcing task stop plus re-enrollment. The
> reducer and application port already implement it
> (`kernel/reducer_v2.ts:406-452`, `kernel/canary_application.ts:258-269`); only
> the tool surface is missing. This is wiring: no trust boundary moves, and user
> authority remains required for the action.

**acceptance**

- `acc-breaking-revision-exposed` — the tool schema accepts the action and
  rejects it without user authority.
- `acc-resume-without-reenrollment` — an approved breaking revision closes the
  open `replan_required` finding and returns the task to `working`.

**scope_hint** — `plugins/immune-brain/.pi-extension/imm-canary-work.ts`, plus a
focused test.

### 3.2 `deterministic-risk-tier-floor`

**Risk**: `material` · **Gate**: Phase 0 complete · **Order**: land before or
with 3.3

**goal**

> Add a deterministic minimum risk tier so tier-based behavior does not rest on
> planner self-grading. No runtime classifier exists today: `risk` is whatever
> the planner writes into the TaskIntent and `parseTaskIntentV1` only checks the
> enum. Force at least `material` when `scope_hint` touches kernel or authority
> paths, regardless of the declared tier. Without this floor, any tier-based gate
> exemption lets a model both assign the tier and consume the privilege.

**acceptance**

- `acc-tier-floor-enforced` — an intent declaring `routine` with a kernel-path
  `scope_hint` is rejected or promoted to `material` at validation.
- `acc-floor-does-not-lower` — the floor never reduces a declared tier.

**scope_hint** — `runtime/kernel/intent.ts`, `runtime/kernel/validation.ts`, plus
a focused test.

### 3.3 `relocate-enrollment-confirmation`

**Risk**: `critical` · **Gate**: Phase 0 complete; 3.2 landed or in the same
review

**goal**

> Move the single enrollment confirmation to the end of Planner and bind it to
> the TaskIntent digest, then reorder descriptor rehearsal to run after
> confirmation so the user is not blocked waiting on it. Enrollment, execution,
> and QA then proceed unattended for a routine task. This reuses the existing
> `ctx.ui.custom` host gate rather than introducing an attestation primitive:
> the confirmation must remain a signal the model cannot fabricate. Because
> rehearsal now runs after confirmation, a rehearsal failure must invalidate the
> authorization rather than being reported after authority already exists.

**acceptance**

- `acc-single-confirmation-routine` — a routine task runs from confirmed plan to
  QA completion with exactly one host confirmation.
- `acc-post-confirmation-rehearsal-invalidates` — a rehearsal failure after
  confirmation blocks enrollment and leaves zero authority writes.
- `acc-digest-binding` — the confirmation is bound to the intent content hash and
  is rejected if the intent changes afterward.

**scope_hint** — `.pi-extension/imm-canary-enroll.ts`,
`runtime/kernel/enrollment.ts`, `runtime/pi_canary_prepare.ts`, planner contract
docs, plus focused tests. `RE-VERIFY` after Phase 0 rewrites the contracts.

This is the one slice in the roadmap that moves where user authority is captured.
It must not share a slice with 3.4.

### 3.4 `retire-enrollment-confirmation-deadwood`

**Risk**: `routine` · **Gate**: 3.3 shipped **and** reviewed

**goal**

> Delete the tautological `requiresEnrollmentConfirmation`
> (`.pi-extension/imm-canary-enroll.ts:91-95`), which returns true for every
> member of a closed three-value enum, and the unreachable `pi-plan-approved`
> branch at line 1112 that can never be selected while it does. Until the
> relocated gate of 3.3 is proven, these are the only thing standing between a
> fabricated confirmation and Kernel authority, which is why this slice is
> strictly downstream.

**acceptance**

- `acc-tautology-removed` — the function and the unreachable branch are absent
  and no `confirmation_ref` can be minted without a host-attested confirmation.

**scope_hint** — `.pi-extension/imm-canary-enroll.ts`, plus `RE-VERIFY` tests
touched by 3.3.

---

## 4. Phase 4 slices

### 4.1 `retirement-completion-contract`

**Risk**: `material` · **Gate**: Phases 1 and 2 closed

**goal**

> Make the failure mode this roadmap corrects structurally unavailable. Write
> "source and contract text deleted" into the completion condition for
> retirement-class work in the Planner contract and `BASELINE.md`, and state that
> an absence test is temporary scaffolding for an in-progress deletion rather
> than a substitute for one. Every retirement to date stopped at routing the
> command to a retirement wall and pinning it with absence assertions, which is
> why roughly 193 such assertions across 57 test files accumulated while the code
> they guard stayed in the repository.

**acceptance**

- `acc-deletion-is-completion` — the Planner contract names deletion of source
  and contract text as a completion condition for retirement-class work.
- `acc-absence-tests-scoped` — the contract states absence tests are transitional
  and may not stand in place of deletion.

**scope_hint** — `plugins/immune-brain/dist/imm-planner.md`, the BASELINE
authoring source, plus a contract test.

### 4.2 `packaged-contract-coverage-check`

**Risk**: `routine` · **Gate**: `retirement-completion-contract` closed

**goal**

> Generalize the Phase 0 consistency guard so every packaged contract document is
> covered by a sync or consistency test. The `skills/*/SKILL.md` to
> `dist/imm-*.md` pair was the only copy relationship in the repository without
> such a check, and it was the one that drifted into instructing agents to run a
> retired command. An enumerating check makes that class of drift impossible to
> reintroduce silently.

**acceptance**

- `acc-coverage-enumerated` — a check enumerates packaged contract documents and
  fails on any document not covered by a sync or consistency test.

**scope_hint** — `scripts/dist-sync-manifest.ts`, `tests/`, plus the new check.
