# Retire drained v4 CLI command surface

**Status**: Candidate; plan-only, not enrolled.
**Design risk**: Medium — removes a public CLI/API contract (bin entry points, runtime dispatch branch, README table rows) with full existing regression coverage; no new abstraction, no authority-store or schema change.
**Execution posture**: deletion-first, then update every stale assertion the deletion invalidates.
**Document language**: English, following the Planner document-language default.

## Outcome

Every CLI command already marked "Retired after v4 storage retirement" stops existing as an invocable name: its `bin/` wrapper is deleted, and the runtime's per-command `drain_required` / `v3_storage_retired` diagnostic wall is deleted with it. Invoking a formerly-retired command name (through the runtime's `cli` dispatch) now falls through to the same generic `Unknown Immune-Brain v4 command: <command>` response as any command that never existed. No file, dispatch branch, manifest entry, or documentation row continues to advertise these names as a recognized (even if rejected) surface.

This is one coherent deletion: leaving the `bin/` wrappers while removing the dispatch branch would produce broken symlinks; leaving the dispatch branch while removing the wrappers would leave dead code and a stale `list-commands --json` manifest entry naming commands nothing can reach.

## Brainstorm Trace

| ID | Confirmed requirement | Design / acceptance |
|---|---|---|
| BR-DEC-04 | Physically delete every CLI command marked "Retired after v4 storage retirement"; no diagnostic placeholder remains | D1–D3; AC1–AC3 |

Discovery in this Planner pass found two command names in the runtime's own retirement set (`imm-check-child-output`, `imm-retire-stale-wrapper`) that were never listed in the README's public table. BR-DEC-04's "every CLI command marked retired" is evidence-based, not README-scoped, so both are included in scope alongside the seven documented rows (`imm-work`, `imm-review`, `imm-autowork`, `imm-activation-plan`, `imm-heal`, `imm-migrate`, `imm-finish`). `imm-activation-plan` already has no `bin/` file (a prior, separate removal); only its stale README row and any stale test/doc mentions are in scope for it.

## Scope and exclusions

Include: the eight `bin/` wrapper files that resolve to the shared `imm-retired` script (`imm-work`, `imm-review`, `imm-autowork`, `imm-heal`, `imm-migrate`, `imm-finish`, `imm-check-child-output`, `imm-retire-stale-wrapper`) and the `imm-retired` script itself; `RETIRED_MUTATING_COMMANDS`, `retiredResponse`, its dispatch branch, and the `retired` field of the `list-commands --json` manifest in `runtime/v4_runtime.ts`; the seven CLI-table rows and any prose in `plugins/immune-brain/README.md` describing this diagnostic wall; every test asserting the current retired-command diagnostic behavior, which is `tests/host-runtime-cutover.test.ts`, `tests/wrapper-retirement.test.ts`, `tests/v4-runtime-launchers.test.ts`, `tests/loop-contract-v4-alignment.test.ts`, `tests/python-reference-boundary.test.ts`, `tests/plugin-package-runtime.test.ts`, `tests/roadmap-plan-host-acceptance.test.ts`, `tests/partially-live-runtime-trim.test.ts`, and `tests/roadmap-plan-e2e.test.ts`; `plugins/immune-brain/tests/host-manifest-consistency.test.ts` and `plugins/immune-brain/tests/skill-registry-consistency.test.ts`; and the generated Claude host bundle `plugins/immune-brain/dist/claude/mcp-server.mjs`, which inlines `runtime/v4_runtime.ts`'s siblings and must be regenerated whenever a shipped runtime module changes.

Enrolled-scope note: the five mirror suites above (`python-reference-boundary`, `plugin-package-runtime`, `roadmap-plan-host-acceptance`, `partially-live-runtime-trim`, `roadmap-plan-e2e`) were missing from the first scope_hint and are added by this slice's revision, because each one asserts a retired-command diagnostic or reads a `bin/` wrapper this slice deletes; leaving them out would ship a tree whose suite fails.

Exclude: `runtime/plan_core.ts` read-only Plan validation, `RETIRED_PLAN_OPTIONS` / `hasRetiredPlanOption` (a distinct, still-active retired-*option* wall for `imm-plan`, not a retired *command*), `imm-kernel`/`imm-plan`/`imm-tracker` themselves, the legacy `immune_brain_runtime.ts` module (already fully removed by a prior task, per `v4-runtime-launchers.test.ts`), and TaskRecord v2/v3 coexistence (separate, deferred slice). Do not introduce a new "removed commands" registry, changelog mechanism, or generic deprecation framework — deletion is unconditional and immediate, matching the confirmed major-cutover scope.

## Discovery evidence and reference closure

- `plugins/immune-brain/bin/{imm-work,imm-review,imm-autowork,imm-heal,imm-migrate,imm-finish,imm-check-child-output,imm-retire-stale-wrapper}`: symlinks to `plugins/immune-brain/bin/imm-retired`, a 4-line shell script (`exec bun "$PLUGIN_ROOT/runtime/v4_runtime.ts" cli imm-work "$@"`).
- `plugins/immune-brain/runtime/v4_runtime.ts:38-47`: `RETIRED_MUTATING_COMMANDS` set (the eight names above). Line 89-121: `retiredResponse`, returning `drain_required` or `v3_storage_retired` with exit code 1. Line 227: dispatch `if (RETIRED_MUTATING_COMMANDS.has(command)) return retiredResponse(root);`. Line 276: `retired: [...RETIRED_MUTATING_COMMANDS].sort()` inside the `list-commands --json` manifest. Line 302: re-exported for tests (no test currently imports it). Lines 1-20 module comment documents the wall as a permanent feature; must be corrected. Line 232 generic fallback already exists: `Unknown Immune-Brain v4 command: ${command}` (exit code 2) — this is what a retired-then-deleted command now falls into, with no code change needed to produce it.
- `plugins/immune-brain/README.md:150-163`: the seven documented CLI-table rows using the exact phrase "Retired after v4 storage retirement".
- `tests/wrapper-retirement.test.ts`: two of its four tests directly exercise the diagnostic being removed (`imm-retire-stale-wrapper is retired...`, `Heal warning names the retirement path`); the other two (packaged runtime omitting the legacy dispatcher, `imm-plan --help`) are unrelated and stay.
- `tests/host-runtime-cutover.test.ts:91-99`: `bin imm-work status is retired after v4 storage retirement` invokes the real `bin/imm-work` wrapper and asserts the diagnostic; this wrapper no longer exists after this change.
- `tests/loop-contract-v4-alignment.test.ts:37-42`: asserts README `toContain("bin/imm-autowork")` and `toMatch(/Retired after v4 storage retirement/)` — the exact phrase being deleted from README. `Retired after v4 storage retirement` occurs only in `README.md` and this test file repo-wide (confirmed by search); no other doc mirrors it.
- `tests/v4-runtime-launchers.test.ts:38-46`: `expectV4Manifest` asserts `manifest.retired).toContain("imm-heal")` against the `list-commands --json` output; this field is being removed.
- `plugins/immune-brain/tests/skill-registry-consistency.test.ts` and `plugins/immune-brain/tests/host-manifest-consistency.test.ts`: general registry/manifest consistency guards; included defensively in scope_hint in case either enumerates `bin/` contents, though no direct match was found for the retired names.

## Technical Design

**Design views**: none beyond the existing dispatch table are material; this is a deletion within an already-documented command-routing structure, not a new one.
**Diagram decision**: not required
**Diagram reason**: no new control-flow shape is introduced; the change is subtractive within the existing `runCli` dispatch chain already described in prose above.

### D1. Delete the retired `bin/` surface

Remove the eight wrapper files and the shared `imm-retired` script. No replacement file, stub, or `command not found` shim is added — the shell's native "no such file" behavior is the only remaining response to invoking a deleted name directly.

### D2. Delete the runtime diagnostic wall

Remove `RETIRED_MUTATING_COMMANDS`, `retiredResponse`, the dispatch branch at the former line 227, the `retired` field from the `list-commands --json` manifest, and the re-export. Correct the module's top-of-file comment (lines 1-20) to state that these commands are fully removed rather than diagnosed. `RETIRED_PLAN_OPTIONS`/`hasRetiredPlanOption` (the `imm-plan` retired-*option* wall) is untouched — it guards a different, still-active surface.

### D3. Update documentation, tests, and the generated host bundle to the new "fully absent" state

Remove the seven CLI-table rows and any surrounding prose in `README.md` that describes the per-command diagnostic. Update `tests/loop-contract-v4-alignment.test.ts`'s second test to assert README no longer mentions `imm-autowork` at all (rather than asserting it is present-but-retired). Replace `tests/host-runtime-cutover.test.ts`'s `imm-work` diagnostic test with an assertion that the wrapper is absent and that `bun runtime/v4_runtime.ts cli imm-work` returns the generic `Unknown Immune-Brain v4 command` response. Update `tests/wrapper-retirement.test.ts`'s two affected cases the same way (or fold them into the `host-runtime-cutover` replacement if that removes duplication) and delete `tests/v4-runtime-launchers.test.ts`'s `manifest.retired` assertion. No test is left asserting the removed diagnostic as current behavior.

The five mirror suites named in the scope above keep their own coverage but stop asserting the removed surface: `python-reference-boundary` and `plugin-package-runtime` replace each retired-command diagnostic expectation with the generic unknown-command response and drop the removed wrapper names from their manifest lists; `roadmap-plan-host-acceptance` and `roadmap-plan-e2e` assert the same generic response for `imm-work`/`imm-review`/`imm-finish`/`imm-plan --sync` (the last one keeps the still-active option wall); `partially-live-runtime-trim` keeps asserting the retained commands and drops the removed names. `tests/v4-runtime-launchers.test.ts`'s mise invocations set `MISE_TASK_RUN_AUTO_INSTALL=false`, because a verification run must use the `bun` already on `PATH` instead of installing the pinned toolchain into a sanitized `HOME`.

`plugins/immune-brain/dist/claude/mcp-server.mjs` is regenerated with `bun scripts/build-claude-plugin.ts` and staged with the rest of the slice, so the checked-in host bundle matches the shipped runtime it inlines.

The shipped tree's suite must also stay green: `tests/activation-plan-runtime-surface.test.ts` asserts the removed `manifest.retired` entries and belongs on the same update, `tests/planning-artifact-archival.test.ts` owns the active-Spec exemption list this slice's own Spec must join, and `tests/dual-host-assurance-conformance.test.ts` registers its Host-package seams only when the real packages cannot be imported, so a suite run never hands a Host-facing sibling file a mocked Host package.

## Verification and acceptance mapping

| Acceptance | Focused verification | Required regression behavior |
|---|---|---|
| AC1 | `bun test tests/host-runtime-cutover.test.ts` | every remaining `bin/` wrapper still resolves to `exec bun .../runtime/v4_runtime.ts`; the eight retired names are absent from `bin/`; invoking a retired name through the runtime CLI returns the generic unknown-command response, not a retired-specific one |
| AC2 | `bun test tests/wrapper-retirement.test.ts tests/v4-runtime-launchers.test.ts` | no test asserts the deleted diagnostic; the legacy-runtime and `imm-plan --help` cases untouched by this change still pass; `list-commands --json` no longer carries a `retired` field |
| AC3 | `bun test tests/loop-contract-v4-alignment.test.ts` | README no longer documents `imm-autowork` (or any of the eight names) as a retired command; the packaged `imm-loop` contract check is unaffected |

Outside these focused descriptors: `bun run typecheck` (the deleted export must have no remaining importer), `bun scripts/build-claude-plugin.ts --check` (README/dist consistency), and `bun test plugins/immune-brain/tests/skill-registry-consistency.test.ts plugins/immune-brain/tests/host-manifest-consistency.test.ts` (registry/manifest guards potentially touching `bin/`).

## Devil's Advocate Audit

- **Rollback resilience**: purely subtractive on already-dead code paths (every deleted command already refused to execute any v3 mutation); reverting the commit restores the prior diagnostic wall exactly. No stored state, schema, or authority record is touched.
- **Verification vanity**: the replacement assertions must prove absence (`existsSync` false, generic unknown-command response) rather than merely deleting the old assertions and adding nothing — an empty test file or a silently-removed `it()` block would be a false pass.
- **Spec dilution**: this must not become a general CLI-surface redesign, a new deprecation-warning mechanism, or a `list-commands` schema change beyond removing the one field being deleted. `RETIRED_PLAN_OPTIONS` (a distinct, still-live wall) must not be touched.

## Delivery boundary

One Spec and one TaskIntent settle together. This candidate authorizes nothing until native Enrollment. Execution completion requires the focused acceptance checks, `bun run typecheck`, the doc-consistency scripts, and required Review (CLI/runtime and doc changes both qualify); planning completion requires canonical author/validate success, a tracked candidate artifact, and the complete BR trace above.
