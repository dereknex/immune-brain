# Iteration Plan

## Task

- Summary: Preserve signed Roadmap Phase completion evidence so finished Phases cannot fall back to `deferred` after ordinary Plan synchronization.
- Origin: The user reported that the Pi `/imm-progress` Roadmap panel shows `P1 · Phase P1: Host-neutral Progress Projection · deferred` even though P1 completed successfully. Investigation proved that P1 has a signature-bearing sync event and matching `finish_reset`, while normal `imm-finish` persisted no Phase-scoped completion fact and the later P2 sync replaced the validated P1 snapshot. The current projection therefore applies its specified no-evidence fallback. The user explicitly requested a root-cause solution rather than a UI-only rename.
- Spec: `docs/specs/archive/2026-08-11-roadmap-finished-phase-evidence.spec.md`
- Research: `state_ledger.ts` keeps generic append-only history plus transition-only `closed_plan_history`; `applyIntentionalFinish` writes `finish_reset` and intentional reset through one CAS mutation but no Roadmap completion record. `project_migration.ts` is the sole historical-format interpreter and already provides read-only detection, content-addressed backup, journaling, rollback, path containment, interrupted-run recovery, and revision guards. `progress_projection.ts` assigns `current`, `successor_candidate`, and `transition_recorded`, then falls back to `deferred`; it ignores generic finish history for historical Phase mapping. The Pi client accepts relation values as bounded strings and the view renders them generically. The current P1 history contains a recoverable exact pair: sync path/signature plus finish-reset path/timestamp. Three read-only planner advisories agreed that completion must be first-class, atomic, signature-bound, migration-safe, and independent from successor/transition evidence; the advisory disagreement on one versus multiple Steps is resolved in favor of three dependency-ordered Steps because persistence, migration, and projection have distinct rollback and QA boundaries.
- Decisions: D1 add optional append-only `roadmap_phase_completion_history` under schema v3 rather than overloading generic reset history or transition archives. D2 define deterministic `roadmap_phase_completion/v1` records derived from the validated snapshot inside the finish transaction. D3 keep completion separate from successor and transition facts. D4 make `imm-migrate` the only historical proof interpreter; recover only exact finish-reset plus same-path signed-sync pairs whose current Plan bytes reproduce the recorded signature. D5 never infer from Phase order, timestamps alone, filenames, Git, sessions, cached QA, or UI output. D6 retain literal `progress_projection/v1` because `finished` is an additive value in the existing tolerant `string[]` relation field; preserve all existing fields and bounds. D7 allow independent relations in deterministic order, with `deferred` only as the zero-evidence fallback. D8 use existing Pi parsing/rendering without a second completion model. D9 leave closed P1/P2 Plan and Spec artifacts immutable. D10 execute incident migration and TUI acceptance against isolated copied authority during QA; migrate the primary workspace only after integrated code is available through explicit `imm-migrate` authority.
- Assumptions: `buildPlanSignature` covers the normalized Task fields containing Roadmap source and current Phase; a successful `finish_reset` remains authoritative proof that the matching Plan passed existing finish eligibility; the current P1 Plan file remains project-contained and byte-equivalent under its recorded signature; schema-v3 optional additive collections remain backward readable; no supported projection consumer exhaustively rejects unknown relation strings. If consumer strictness, signature coverage, or exact P1 recovery fails, execution must replan rather than weaken proof requirements.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Plan boundary: Signature-bound Roadmap completion evidence from atomic finish or explicit historical migration through host-neutral projection presentation.
- Boundary rationale: Persisted completion authority, its one-time source migration, and its read-only projection form one end-to-end truth invariant, but each has a separate failure mode and therefore a separate dependency-ordered Step. The Pi consumer needs only contract verification because it already renders additive relation strings.
- Scope pressure: Three focused Steps touch two State Ledger owners, the existing migration gateway, the progress projection, six focused runtime/consumer test surfaces, and one architecture map. They do not alter Plan execution, transition approval, host mutation tools, historical Plans/Specs, or unrelated Roadmap parsing.
- Successor candidate: none.
- Successor preconditions: none; this maintenance Plan closes the reported relation defect.
- Current-slice warning: Before activation, commit or otherwise establish a clean immutable baseline for the completed P2/detail-view changes. The current staged index contains an earlier Overlay/footer snapshot while the working tree contains the accepted Widget/detail-view implementation; activating or committing this Plan against that mixed baseline would make changed-file evidence ambiguous.

## Output Language

- Language: English
- Reason: Repository planning artifacts default to English; user-facing progress remains Chinese. Paths, commands, contracts, JSON fields, relation values, and identifiers remain literal.

## Devil's Advocate Audit

1. **Rollback Resilience**: U1 is an additive optional Ledger collection written inside the existing finish CAS. U2 uses the existing journaled migration transaction and never rewrites source evidence. U3 is a read-only additive relation. Reverting U3 leaves durable evidence unused but truthful; reverting U2 leaves old records unresolved; reverting U1 before any new finish leaves no partial reset because the write is atomic.
2. **Verification Vanity**: Tests must prove byte-level no-write projection, failed-CAS all-or-nothing finish behavior, deterministic IDs, malformed/duplicate record rejection, exact-signature migration, symlink/path/signature rejection, interrupted migration rollback, document-order independence, tolerant v1 parsing, and a real 40/100-column Pi frame showing P1 `finished`. Snapshot-only assertions or cached QA are insufficient.
3. **Spec Dilution Detection**: The Plan fails if implementation renames `deferred` in the UI, derives completion from ordering or current Plan lifecycle, treats a signed Plan without `finish_reset` as complete, mutates historical evidence in place, writes during projection, couples completion to transition, adds a Pi Ledger reader, or marks an unprovable legacy Phase finished.

## Planning Quality Gate

- **contract surface**: State Ledger optional completion collection; finish mutation; explicit project migration; `progress_projection/v1` Phase relation and Plan reference; Pi relation parsing/rendering tests.
- **compatibility**: Schema remains v3; missing completion collection normalizes empty; non-Roadmap finish behavior remains; existing projection fields and relations remain; Pi accepts arbitrary bounded strings; old unprovable records remain deferred.
- **interruption recovery**: Finish completion and reset share one CAS plus atomic file replacement. Migration retains prepared/committed/rolled-back manifests, content hashes, lock ownership, resume/rollback behavior, and post-migration revision verification.
- **rollback path**: Revert additive builders/validators, migration derivation, projection relation, tests, and architecture note. Do not delete completion records already written; older schema-v3 readers preserve unknown top-level fields through normalization, and rollback must be tested before release.
- **verification strength**: Test-first focused suites, cold-process migration fixtures, interrupted replacement hooks, recursive no-write snapshots, exact JSON relation assertions, Pi detail-view rendering at narrow/normal widths, strict TypeScript, Plan validation, diff diagnostics, independent Strict QA per Step, final Code Review, and final UI Review.
- **replan condition**: Replan if Plan signature excludes Roadmap identity, current P1 lacks an exact recoverable signature pair, schema-v3 normalization drops unknown additive fields, supported consumers reject unknown relation values, or migration requires synthesizing execution/QA evidence.
- **known external diagnostic**: The working tree contains previously completed uncommitted P2/UI changes plus a stale staged snapshot. This is an activation precondition, not Step Scope. The unrelated criteria parser accepting nested `**deferred**` content is also outside this Plan.

## Steps

### Step 1

- Step ID: U1
- Result: Every successful Roadmap-backed Plan finish persists one signature-bound Phase completion record within the finish transaction.
- Scope: `plugins/immune-brain/runtime/state_ledger.ts`; `plugins/immune-brain/runtime/commands/finish.ts`; `tests/finish-dehydrate-runtime.test.ts`; `tests/runtime-state.test.ts`
- Verification: `bun test tests/finish-dehydrate-runtime.test.ts tests/runtime-state.test.ts tests/imm-follow-up-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-001-fix-roadmap-finished-phase-evidence-plan.md --json && git diff --check`
- Verification type: automated plus diagnostics
- Agent Hint: imm-executor
- Test scenarios: Covers a Roadmap-backed successful finish; a legacy non-Roadmap finish; deterministic `completion_id`; runtime provenance; exact plan signature, Roadmap source, Phase, and finish timestamp; duplicate ID rejection; malformed contract/path/signature/source/phase/timestamp/provenance rejection; stale CAS and injected concurrent write preserving both pre-finish state and empty completion history; retry/duplicate finish rejection; schema-v3 Ledger without the optional collection remaining readable; unknown top-level field preservation across rollback-compatible normalization.
- Discovery cache: `plugins/immune-brain/runtime/state_ledger.ts` (`StateLedger`, `createEmptyStateLedger`, `taskSnapshot`, `applyIntentionalFinish`, `validateTransitionState`, `normalizeCurrentIteration`, canonical JSON/hash helpers); `plugins/immune-brain/runtime/commands/finish.ts` (eligibility, CAS capture, one commit); `tests/finish-dehydrate-runtime.test.ts` (finish reset, duplicate, revision, and no-arg compatibility fixtures); `tests/runtime-state.test.ts` (schema and normalization contracts)
- Depends on: none
- Execution note: test-first
- failure_behavior: Reject malformed completion authority before persistence. A failed or stale finish exposes neither `finish_reset` nor a completion record. A Plan without both signed Roadmap fields follows existing finish behavior without a record.
- security_considerations: Record fields come only from the validated Ledger snapshot; canonical paths and bounded strings fail closed; deterministic IDs prevent replay ambiguity; no caller/session/UI data can grant completion authority.

### Step 2

- Step ID: U2
- Result: Every recoverable historical Roadmap finish becomes the same Phase completion contract through the project migration gateway.
- Scope: `plugins/immune-brain/runtime/project_migration.ts`; `tests/state-ledger-migration.test.ts`; `tests/roadmap-plan-progression-runtime.test.ts`
- Verification: `bun test tests/state-ledger-migration.test.ts tests/roadmap-plan-progression-runtime.test.ts tests/roadmap-plan-transition-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-001-fix-roadmap-finished-phase-evidence-plan.md --json && git diff --check`
- Verification type: automated plus diagnostics
- Agent Hint: imm-executor
- Test scenarios: Covers the exact P1/P2 incident shape; read-only `--check`; exact same-path nearest sync pairing; current Plan signature recomputation; signed Roadmap source and Phase extraction; migration provenance; deterministic idempotent output; already-migrated no-op; content-addressed backup and manifest; interruption before/after replacement plus rollback/recovery; concurrent Ledger replacement rejection; missing/moved/symlinked/escaping Plan; signature mismatch; ambiguous sync history; missing Roadmap fields; signed Plan without finish-reset; finish-reset without signed sync; skipped diagnostics without fabricated records or Plan/history rewrites.
- Discovery cache: `plugins/immune-brain/runtime/project_migration.ts` (`toCurrentLedger`, `buildMigrationFiles`, path containment, manifest, rollback, interrupted recovery, revision guards); `plugins/immune-brain/runtime/plan_core.ts` (Plan parse/normalize/validation); `plugins/immune-brain/runtime/state_ledger.ts` (completion builder/validator and `buildPlanSignature`); `tests/state-ledger-migration.test.ts` (check/write/idempotence/crash fixtures); `tests/roadmap-plan-progression-runtime.test.ts` and `tests/roadmap-plan-transition-runtime.test.ts` (ordinary sync versus explicit transition histories)
- Depends on: U1
- Execution note: test-first
- failure_behavior: Append only records proven by exact persisted finish plus signed sync identity. Leave uncertain records unresolved with machine-readable diagnostics. Never mutate source history or signed planning artifacts.
- security_considerations: Enforce project containment, regular-file and whole-path symlink rejection, exact signature equality, bounded parsing, lock/CAS replacement protection, and no inference from order, names, timestamps alone, Git, cache, or session state.

### Step 3

- Step ID: U3
- Result: Completion-evidenced Roadmap Phases have one truthful `finished` presentation across host-neutral consumers.
- Scope: `plugins/immune-brain/runtime/progress_projection.ts`; `tests/progress-projection-runtime.test.ts`; `tests/pi-progress-extension.test.ts`; `CONTEXT.md`
- Verification: `bun test tests/progress-projection-runtime.test.ts tests/roadmap-plan-progression-runtime.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/pi-progress-extension.test.ts tests/state-ledger-migration.test.ts tests/finish-dehydrate-runtime.test.ts && bunx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --skipLibCheck plugins/immune-brain/.pi-extension/index.ts plugins/immune-brain/.pi-extension/progress_client.ts plugins/immune-brain/.pi-extension/progress_views.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-001-fix-roadmap-finished-phase-evidence-plan.md --json && git diff --check`; after fresh execution evidence, an `imm-ui-review` pass uses an isolated copied P1/P2 Ledger, runs explicit migration, launches real Pi TUI, verifies P1 `finished` plus P2 `current, finished` at 40 and 100 columns, closes the detail view with Esc, and confirms zero transcript overlap.
- Verification type: automated plus hitl review
- Agent Hint: imm-executor
- Test scenarios: Covers literal v1 contract retention; relation order `current`, `finished`, `successor_candidate`, `transition_recorded`; valid relation overlap; `deferred` only for zero evidence; exact Roadmap-source and Phase matching; unrelated completion records ignored; malformed records fail closed; reordered Phase documents preserve relations; signed Plan without completion remains deferred; completion `plan_ref` lifecycle/source/path; deterministic repeat output; recursive filesystem no-write proof; Pi client tolerance for additive/unknown relation strings; Pi detail-view P1 row rendering without a new authority path.
- Discovery cache: `plugins/immune-brain/runtime/progress_projection.ts` (`addRelation`, `addPlanReference`, Roadmap source normalization, deterministic serialization, projection bounds); `plugins/immune-brain/.pi-extension/progress_client.ts` (bounded string-list parsing); `plugins/immune-brain/.pi-extension/progress_views.ts` (generic Roadmap relation rendering); `tests/progress-projection-runtime.test.ts` (v1, no-write, lifecycle, path safety); `tests/pi-progress-extension.test.ts` (detail-view width/navigation/authority spy); `CONTEXT.md` (canonical runtime and migration ownership map)
- Depends on: U2
- Execution note: test-first
- failure_behavior: Reject malformed authority records; ignore valid records belonging to another Roadmap; retain `deferred` when no explicit relation exists; never read historical Plans or write state from projection or Pi.
- security_considerations: The runtime remains the sole relation authority; Pi stays translation/presentation-only; no session persistence, Markdown parsing, mutation controls, percentage, ETA, or completion inference enters the host process.

## Validation

- Validate without sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-001-fix-roadmap-finished-phase-evidence-plan.md --json`.
- Activation prerequisite: first reconcile and commit the completed P2/detail-view workspace so `git status` has no mixed stale staged snapshot and the new Plan obtains an unambiguous activation baseline.
- Before U1 execution, confirm the State Ledger is `idle + intentional_reset` with no active Step or pending follow-up, then run `imm-plan --sync` and activate U1 through `imm-work`.
- Strict QA closes U1, U2, and U3 independently from fresh evidence. Final Code Review covers the cumulative changed-file signature; final UI Review covers the isolated migrated P1/P2 frame.
- Compounder is required because this Plan adds a durable workflow authority contract and migration rule. Capture the completion-versus-transition evidence distinction plus the signed-history migration proof in `docs/solutions/contracts.md` and `.imm/memory/MEMORY.md` only after all Steps and review gates pass.
- Apply `imm-migrate --check --json` and then explicit `imm-migrate --json` to the primary workspace only after the integrated runtime is available and no active migration/finish writer competes. Verify `imm-work progress --json` no longer labels recoverable P1 as `deferred`.
