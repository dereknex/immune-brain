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

## Parallel route for the nine remaining slices

Nine slices remain open. They do not form nine independent lanes: they collapse
into three chains, because two files are contended by four slices each.

**Contention points, verified rather than assumed.**
`scripts/dist-sync-manifest.ts` holds both `BASELINE_COPIES` and
`ROLE_PROMPT_SOURCE_DIR`/`ROLE_PROMPT_DIST_DIR`, so 2.2 and 2.3 cannot run
together. `plugins/immune-brain/dist/imm-planner.md` is claimed by 2.3, 4.1 and
the contract-document half of 3.3. Every Phase 3 slice writes
`.pi-extension/imm-canary-enroll.ts`. The original 2.2 draft named
`scripts/sync-dist-docs.ts`, which is the wrong file; the manifest is where the
copy lists live.

**The three chains.** Chain A is archival: 007 then 2.1b. Chain D is contract
documents: 008 (the re-scoped 2.2) then 2.3 then 4.1 then 4.2. Chain E is
enrollment authority: 009 (the corrected 3.5) then 3.3 then 3.4. A, D and E are
pairwise disjoint except that 3.3 reaches into the planner contract documents
owned by chain D, which is why 3.3 does not overlap a chain-D step.

**Wave schedule.** Five waves instead of nine serial slices:

| Wave | Lane A | Lane D | Lane E |
| --- | --- | --- | --- |
| 1 | ~~007 archive remaining specs~~ done | ~~008 realign IMMUNE.md~~ done | ~~009 forbid risk downgrade~~ done |
| 2 | 2.1b retention policy | 2.3 roadmap vocabulary | — |
| 3 | — | — | 3.3 relocate confirmation |
| 4 | — | 4.1 completion contract | 3.4 retire deadwood |
| 5 | — | 4.2 coverage check | — |

Wave 3 runs 3.3 alone deliberately. It is the only `critical` slice and the only
one that moves where user authority is captured, so it should not compete for
attention with a concurrent enrollment.

Ordering inside chain E is not arbitrary. 009 lands first so that from wave 2
onward no slice can lower its own risk tier to reach a weaker completion path,
including 3.3 itself.

**Worktree protocol.** One `git worktree` per lane, as used for 009 through 012.
Three costs apply, the third learned the hard way in wave 1.

1. A TaskRecord written inside a worktree lives in that worktree's state
   directory and is destroyed with it. Copy records back into the main
   repository before `git worktree remove`.
2. Each lane needs its own enrollment, so a three-lane wave costs three human
   gates plus three completions. That load, not scope conflict, is what caps
   practical lane width.
3. **Initialise Kernel state in the worktree, and verify the workspace claim is
   free, before starting work.** `.imm/tasks/`, `.imm/workspace.json` and
   `.imm/journal.jsonl` are gitignored, so a fresh worktree has no Kernel state
   at all and nothing forces enrollment to happen.

### Wave 1 deviation: 008 and 009 landed outside Managed Path

Recorded rather than silently absorbed. Both slices were implemented, merged to
`main`, and are functionally correct — `IMMUNE.md` carries no retired reference
and is stamped v4.0.0, the risk guard sits at `reducer_v2.ts:445` in the right
place with real test coverage — but neither went through the Kernel. There is no
TaskRecord for 007, 008 or 009 in `.imm/tasks/`, no journal entry, and no Kernel
state in any of the three worktrees; a filesystem-wide search found nothing
outside the intent sidecars. Every task from 001 to 006 has a record, so the
absence is meaningful rather than a gap in how records are written. No
enrollment, no QA, no Review, no completion decision. 009 in particular modifies
the authority reducer, and it is the slice whose whole purpose was to stop a task
weakening its own oversight.

Root cause: `.imm/workspace.json` still named `2026-08-20-006-archive-terminal-specs`
as `current_working` long after 006 completed and was archived.
`application_v2.ts:212-216` refuses enrollment while the workspace is owned by
another task, so enrolling in `main` was blocked, work moved to worktrees, and
worktrees had no Kernel state to enrol into. The claim has been released to
`null`, which is what `application_v2.ts:238-241` writes on a normal release.

Releasing a claim is not currently reachable from the `imm-kernel` command
surface, which offers only author, validate, status and audit. Worth a slice if
this recurs.

007 followed the same pattern: no record, and it merged with its third
acceptance criterion unmet. `acc-links-and-suite-intact` promised a passing
suite and no new unresolved reference, and neither held. Its primary deliverable
was correct — 52 specs archived, the 56-entry blanket list replaced by a 3-entry
protected set with per-file justifications — but every archived plan's Spec
reference was left pointing at a path the archival had emptied.

### Plan-to-Spec link rot, and the one real signature exemption

Measured after the merge: 132 archived plans carried 354 Spec references to
specs that had moved to `docs/specs/archive/`, and zero pointed at a spec that
existed nowhere. The breakage was entirely caused by the archival program,
starting with 006 and only becoming visible when 007 happened to archive the one
spec a test pins. The link scripts do report this — `detect-stale-refs` finds
751 broken doc links under `docs/plans/archive` alone — but nothing consumes
their output, so the criterion citing them could pass while being false.

All 354 were rewritten to their archive paths, with two deliberate exceptions:

- `2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md` keeps its
  original reference. `tests/plan-validation.test.ts` compares its plan
  signature against a frozen cross-runtime parity constant, and that payload
  includes the Spec reference, so rewriting it would change the signature. This
  is what 006's "migration-plan signature parity" note was reaching for — the
  constraint is real, but it justifies exempting one plan, not 56 specs.
- `assurance-kernel-v4-p2a-readiness-r2.spec.md` exists nowhere and was left
  alone as genuine pre-existing rot.

Worth a slice: make a link check consume `detect-stale-refs` output as a gate
for the paths a slice declares, so `acc-links-*` criteria cannot pass vacuously.

**Do not downgrade a declared tier to speed a merge.** Every wave-1 slice is
`material` on purpose. Until 009 lands the reducer accepts a downgrade silently,
which is how 006 completed with zero approvals.

---

## 1. Phase 1 slices

### Standing rule: scope scans must include `.pi-extension/`

Default `rg` skips dot-directories, so a plain search never sees
`plugins/immune-brain/.pi-extension/` — ten TypeScript files that are the live
Pi host integration layer, including `imm-canary-enroll.ts` and
`imm-canary-work.ts`. Every "no live importers" or "unreachable" conclusion
reached with a default scan carries that blind spot, and it is the worst
possible place to have one because that directory is where live code lives.
A concrete instance: the 2.3 draft called the `qa` and `ui-review` role prompts
undispatchable, when `imm-canary-work.ts` lists both in `LOOP_DIRECT_ROLES`.

Use `rg --hidden` for any reachability or deletion-scope question. The suite at
799 pass covers what has already shipped, so this is a forward risk for
remaining slices rather than a defect in landed work.

### RE-VERIFY sweep of the remaining open drafts

Run against the tree at `01fb945`, after three consecutive drafts failed on
stale premises.

**3.3 `relocate-enrollment-confirmation` — premises hold, scope stale.** The
`ctx.ui.custom` host gate is real (`imm-canary-enroll.ts:115`) and is a genuine
TUI select the model cannot fabricate, so the "reuse rather than invent an
attestation primitive" instruction stands. Rehearsal does currently run before
confirmation: `assertDescriptorRehearsalSnapshot` is called at lines 1047, 1099
and 1132, bracketing the confirmation window, so the reordering this slice
proposes is a real change. One scope correction — `runtime/pi_canary_prepare.ts`
no longer exists, deleted during Phase 1; drop it from `scope_hint`.
`runtime/kernel/enrollment.ts` still exists.

**3.4 `retire-enrollment-confirmation-deadwood` — holds exactly as written.**
`requiresEnrollmentConfirmation` at lines 91-95 returns
`risk === "routine" || risk === "material" || risk === "critical"` over a closed
three-value enum, so it is literally always true, and the unreachable
`pi-plan-approved` branch is still at line 1112. Remains strictly downstream of
3.3.

**4.1 `retirement-completion-contract` — needs a recount and a scope decision.**
The "roughly 193 absence assertions across 57 test files" figure predates the
Phase 1 deletions and must be recounted with its original method before it goes
into a goal. `BASELINE.md` is not one file: three byte-identical 7715-byte
copies exist at `plugins/immune-brain/BASELINE.md`,
`plugins/immune-brain/skills/BASELINE.md` and
`plugins/immune-brain/dist/BASELINE.md`, so "the BASELINE authoring source" in
`scope_hint` has to name which one is authoritative and how the other two stay
in sync.

**4.2 `packaged-contract-coverage-check` — smaller than drafted.** Phase 1 left
only three `dist/imm-*.md` and three `skills/*/SKILL.md`. The three-way
`BASELINE.md` copy is a second copy relationship and already has
`tests/baseline-packaging-contract.test.ts`. Confirm what the Phase 0 guard
already enumerates before sizing this slice.

### Packaged contracts are 4-6x their authoring sources, guarded by 8 tokens

Found while sizing Wave A, and it outranks every remaining draft. The documents
agents load at runtime are the `dist` copies, and each dwarfs the skill that
nominally sources it: `imm-planner` 5,570 bytes of skill against 34,155 of dist,
`imm-brainstorm` 2,393 against 13,374, `imm-loop` 3,371 against 13,086. About
60KB of binding instruction sits downstream of 11KB of source.

The only guard, `tests/skill-dist-consistency.test.ts`, compares presence of an
eight-entry `RUNTIME_SURFACE` token list, so it says nothing about the other
~50KB. Demonstration: `dist/imm-planner.md` mentions Roadmap four times,
`skills/imm-planner/SKILL.md` mentions it zero times, and the guard passes.
Neither `sync-dist-docs.ts` nor `dist-sync-manifest.ts` names `imm-planner`, so
no generation step binds the pair either.

Phase 0 fixed one symptom of this — `dist/imm-loop.md` directing agents to a
retired command. The mechanism that allowed it was never touched. This promotes
4.2 from a routine cleanup gated behind 4.1 into the highest-value remaining
slice, authored as 012.

### Wave A — three slices in parallel, plus direct bookkeeping

The one real contention point is `dist/imm-planner.md`, touched by 2.3, 3.3 and
4.1, so those three serialize into a single lane. `imm-canary-enroll.ts` is
shared by 3.3 and 3.4, and 3.4 was already downstream. Everything else is
independent.

| Wave | Parallel lanes |
| --- | --- |
| A | 011 planner roadmap instructions · 012 packaged contract coverage · 013 stale-reference ratchet |
| B | 3.3 relocate enrollment confirmation (`critical`) |
| C | 4.1 retirement completion contract · 3.4 enrollment confirmation deadwood |

Merging 011 before 012 avoids one rebase, since 012 tightens the guard over the
document 011 edits. Bookkeeping — marking 1.3, 1.6, 1.7, 2.2, 3.1, 3.2 and 3.5
closed — was done directly rather than as a slice, matching how this memo has
always been maintained and avoiding contention with all three intents.

Before 4.1 is authored, two figures must be restated: its "193 absence
assertions across 57 test files" predates the Phase 1 deletions, and
`BASELINE.md` is three byte-identical copies whose authoritative one must be
named.

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

### 1.3 `resolve-subagent-activation-contract` — CLOSED

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

### 1.4 `drain-v3-island-test-surface` — CLOSED

Promoted as `2026-08-19-007-drain-v3-island-test-surface` and completed. Both
acceptance items were re-verified independently: zero references to the seven
modules remain from outside the island, all seven files are still on disk, all
seven mixed test files survive, and each surviving module still carries between
two and six test files. The suite went from 973 to 827 passing tests across 9
fewer files, which is exactly the 10 island-only files removed and 1 added.

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

### 1.5 `delete-v3-runtime-island` — CLOSED

Promoted as `2026-08-19-008-delete-v3-runtime-island` and completed. All three
acceptance items re-verified independently: the seven modules are gone with zero
residual references; the drain guard was superseded rather than dropped, with the
surviving-module coverage table carried into `tests/v3-island-deletion.test.ts`
intact; and both live projections are byte-identical to the values recorded
before any of this work began — `imm-plan --routing-status` still reports
`tracked_clean / active / policy_active` and `imm-kernel status` still reports
`{"phase":"done","reason":"legacy-finished"}`.

The diff removed 6341 lines across 8 files, and the suite stayed at exactly 827
passing tests across 128 files, unchanged from before the deletion. Deleting
6341 lines while changing zero test outcomes is the strongest available evidence
that the closure was genuinely dead. **The R4 deletion line the predecessor
roadmap declared finished is now actually finished.**

**Scope defect caught before enrollment.** The first authoring of this slice
scoped only the seven modules and a new test. It missed
`tests/v3-island-drain.test.ts`, the guard written by the drain slice, which
asserts the seven modules exist using `statSync(...).isFile()` and therefore
throws the moment they are deleted. The import-and-path scans used to derive
scope for earlier slices did not surface it, because that test stores bare module
names in an array and builds the paths by template interpolation, so the literal
string `runtime/state_ledger.ts` never appears in the source. Deriving deletion
scope needs a third probe beyond importers and path asserters: a bare-name scan.

That guard is superseded, not discarded. Its second assertion — that every
surviving module kept its coverage — is the only automated protection against a
future slice quietly deleting a mixed test file, so it carries forward into
`tests/v3-island-deletion.test.ts` while the existence check inverts to absence.

A bare-name scan also confirms nothing else references the seven. The remaining
matches are unrelated data values that must survive: `source_kind:
"project_migration"` is a live enum in `authority_commit_receipts.ts`,
`automatic_observations.ts`, and `observation.ts`, and `"activation"` in
`kernel/readiness.ts` is an event family. A find-and-replace on the module names
would corrupt all four.

**Risk**: `material` · **Gate**: `drain-v3-island-test-surface` closed. After the
drain slice this is a pure deletion of seven files with no accompanying edits.
The intent states the stop condition explicitly: if any edit outside the seven
module paths turns out to be necessary, that is evidence the drain was
incomplete, and the correct response is to stop and reopen the drain rather than
widen this slice.

**Artifact lifecycle note.** Execution has now deleted the TaskIntent file on
completion three times (006, 007, and by the same behavior 008 will follow),
while 004 and 005 were left in place. The deletion is not requested by any scope
or contract. Both 006 and 007 have been restored — 006 byte-exact from Git
history, 007 by re-running `imm-kernel intent author` on the identical candidate,
which reproduces content hash `fd15bbce` exactly; a hand-written copy does not,
because the CLI canonicalizes. Archival belongs to Phase 2's
`archive-terminal-planning-artifacts`, which is gated on a status/audit fallback
that does not exist yet. Worth fixing at the source rather than restoring each
time.

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

### 1.6 `trim-partially-live-runtime` — CLOSED

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

### 1.7 `retire-kernel-v1-store` (conditional) — CLOSED

**Risk**: `material` · **Gate**: a completed read-only reachability trace, **not**
the preceding slices

**TRACE COMPLETE — GO.** Performed read-only on 2026-08-19 while slice 008 was
executing. The v1 store is unreachable from `canary_application.ts`:

- `canary_application.ts` imports exactly four symbols from `storage.ts`:
  `commitDrainLocked`, `readTaskRecordV2Raw`, `readWorkspaceStateRaw`, and
  `withKernelStoreLockV2`. None is a v1 entry point.
- `withKernelStoreLockV2` has a 22-line body that calls none of
  `readPendingTransaction`, `completeTransactionLocked`, `readTaskRecordRaw`, or
  `parseTaskRecord`. The v2 lock does not reach v1 recovery.
- The four v1 call sites resolve to three private functions
  (`readTaskRecordRaw`, `readPendingTransaction`, `completeTransactionLocked`)
  reachable only through three exported entry points: `readTaskRecord`,
  `writeTaskRecord`, and `applyTaskAction`.
- Every external reference to those three is a test. The v1 lock
  `withKernelStoreLock` has no external reference at all.
- The migration path that exercises them most heavily is already retired:
  `v4_runtime.ts` lists `imm-migrate` among retired mutating commands, and
  `.imm/tasks/` holds 47 v2 records and zero v1 records.

The slice is therefore a GO rather than a cancellation. Note when scoping it that
`kernel-migrate.test.ts`, `kernel-r2c1-boundary.test.ts`,
`kernel-r2c2-boundary.test.ts`, `kernel-record-v2.test.ts`, and
`v4-storage-retirement-kernel-store.test.ts` are the test surface, and that some
of them assert v1 rejection behavior rather than v1 success, so they need the
three-probe treatment rather than blanket deletion.

**Original precondition, now satisfied.** `.imm/tasks/` holds 43
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

### 2.1 `archive-terminal-planning-artifacts` — SPLIT, ONE SLICE OPEN

Shipped as three slices, with a fourth open:

- `2026-08-20-003-archive-terminal-planning-artifacts` — CLOSED. Intent sidecars.
- `2026-08-20-005-archive-terminal-prose-plans` — CLOSED. All 29 prose Plans
  moved; `docs/plans/` now holds only the four canary fixtures.
- `2026-08-20-006-archive-terminal-specs` — CLOSED but incomplete. Archived 102
  specs as clean renames, then exempted 56 more via a hardcoded `exemptionList`
  in its own guard test, commented "terminal but kept active". The check skips
  exempt entries before evaluating, so the assertion passes by construction.
- `2026-08-20-007-complete-terminal-spec-archival` — OPEN, authored, `material`.
  Archives the 52 still-archivable specs and replaces the blanket list with a
  3-entry protected set carrying per-file justifications.

Two lessons worth carrying forward. First, "the implementing Plan is archived"
does not by itself prove a spec is non-normative; the stronger argument is that
a spec regulating machinery that no longer exists cannot constrain anything.
Second, protect live artifacts by *reference from live planning artifacts*, not
by heuristic: both the filename-or-citation rule and a retired-versus-live token
scan independently misclassified the live v4 roadmap as terminal, because a
roadmap about deleting v3 necessarily talks about v3 constantly.

**Original draft, retained for provenance** — **Risk**: `routine` · **Gate**: Phase 1 closed

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

### 2.1b `reconcile-planning-artifact-retention-policy`

**Risk**: `routine` · **Gate**: 2.1 fully closed, including 007

**goal**

> `docs/reference/planning-artifact-retention.md` now contradicts the repository
> it governs. It states that files under `docs/plans/` and `docs/specs/` stay at
> their existing paths by default, that archives are "not an automatic
> destination for completed Plans or Specs", and that five conditions must be
> proven per file before any move. Slices 003, 005, 006 and 007 bulk-moved 29
> prose Plans and roughly 154 specs on a two-signal rule. The document was in no
> slice's scope and is unchanged since the first commit, yet
> `docs/adr/0002-maintenance-surface-ownership.md` cites it as binding. Either
> restate the policy around the signal-based rule actually in force or supersede
> it through the ADR, then align the ADR either way. This is precisely the
> class of defect Phase 0 existed to remove, recreated by the archival work.

**acceptance**

- `acc-retention-policy-matches-practice` — no active retention guidance
  contradicts the archival layout, and ADR 0002 points at whatever now governs.

**scope_hint** — `docs/reference/planning-artifact-retention.md`,
`docs/adr/0002-maintenance-surface-ownership.md`. `RE-VERIFY` for other inbound
citations before authoring.

### 2.2 `single-source-shared-contracts` — CLOSED, fully superseded by 008

**Superseded by `2026-08-20-008-realign-immune-constitution`, authored, `material`.**
Two of the three premises below expired during Phase 0 and Phase 1, and were
dropped rather than carried into the intent. The three `BASELINE.md` copies are
already byte-identical at sha `140a3fad` and their identity is enforced by
`tests/baseline-packaging-contract.test.ts`, so a generated single source buys no
invariant that is not already held. `AGENTS.md` is 18 lines after Phase 0 removed
the `ctx_*` block, so there is no 80% overlapping block left to shrink. What
survives is the constitution itself: `IMMUNE.md` still presents `imm-autowork` as
a live checkpoint runtime at lines 44, 72 and 74, lists `State Ledger` as a
creatable artifact at line 52, and is stamped v1.1.0 / 2026-05-29. Scope narrowed
to that one file plus the three contract tests that read it.

**Original draft, retained for provenance** — **Risk**: `material` · **Gate**: Phase 1 closed

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

### 2.3 `retire-roadmap-family-vocabulary` — DRAFT PREMISES FAILED RE-VERIFY

Both halves of the draft below are wrong against the current tree. Do not
promote it as written.

**The Roadmap vocabulary is not dead.** `plan_core.ts` still validates it —
`ROADMAP_SLICE_CONTRACT`, `ROADMAP_SLICE_REQUIRED_FIELDS` — and archived plans
still use it: 8 declare `roadmap-slice/v1`, 13 carry `Successor candidate`, 12
`Roadmap source`, 8 `Current phase`. `imm-plan` is still run against archived
plans by live tests, so removing the parser's handling would break reading
history. The draft assumed archiving the prose Plans made the fields
irrelevant; archiving moved them, it did not retire them.

**The role prompts are dispatchable.** The draft claims `ui-review` and `qa`
cannot be dispatched because native review hardcodes `code-review`. In fact
`.pi-extension/imm-canary-work.ts:108` declares
`LOOP_DIRECT_ROLES = ["qa", "code-review", "ui-review"]`, and that constant types
the `dispatch_role` operation, so both are valid targets in the live tool schema.
Deleting the prompts would break the dispatch surface. Drop
`acc-unreachable-prompts-absent` entirely.

**What survives is narrower and still real.** v3 Plan mutation is retired, so no
new prose Plan can be created, yet `dist/imm-planner.md` still instructs agents
to produce Roadmap-backed Plans and to record `roadmap-slice/v1` fields (lines
113, 190, 197, 232). Those are instructions that can never be followed — the same
defect Phase 0 removed from `dist/imm-loop.md`. A re-scoped slice would trim the
planner contract only, leave `plan_core.ts` parsing intact for backward
compatibility, and decide whether `CONTEXT.md` keeps the terms marked historical
rather than deleting definitions the parser still relies on.

**Original draft, retained for provenance** — **Risk**: `material` · **Gate**: `archive-terminal-planning-artifacts` closed

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

### 3.1 `wire-breaking-intent-revision` — CLOSED

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

### 3.2 `deterministic-risk-tier-floor` — CLOSED

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

### 3.5 `forbid-unapproved-risk-downgrade` — CLOSED

**Authored as `2026-08-20-009-forbid-risk-downgrade-on-revision`, `material`.**

The first draft of this entry assumed a downgrade was ungated. `RE-VERIFY`
disproved that and produced a sharper mechanism, which the authored intent
carries. `classifyIntentRevision` already ranks a downgrade as `breaking`
(`kernel/intent.ts:351`), and the reducer already demands user authority for a
breaking revision (`reducer_v2.ts:423`). The gate fires. The defect is what the
gate lets through:

- `reducer_v2.ts` guards task identity (427) and goal and owner (432–438) across
  a revision, but never risk, and on success installs the incoming intent as the
  governing snapshot (443).
- `completion.ts:70` reads `REQUIRED_APPROVALS` from that current snapshot —
  `routine: []`, `material: ["review"]`.
- `completion.ts:72–75` stales every approval bound to the prior revision and
  content hash.

So a downgrade removes the requirement *and* invalidates the approval already
satisfying it. Approving a breaking revision consents to the intent having
changed, not to completing without the review the tier required; those are
different and unequally weighted consents. Fix is a risk guard symmetric with
the existing goal and owner guard. A high-water mark pinning completion to the
highest tier ever held is the fallback if a legitimate downgrade appears.

Also verified: `imm-kernel intent author` is exclusive no-overwrite, so 006's
revision 2 was a direct file edit, not a CLI re-author. Pre-enrollment editing
needs no new guard — enrollment is the binding moment — which is why scope stays
on the reducer.

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
