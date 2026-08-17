# Iteration Plan

## Task

- Summary: Establish a versioned runtime Progress Projection as the read-only authority for future Pi Roadmap and Plan execution visualization.
- Origin: User requested an implementation plan for visualizing current progress, Roadmap Phases, and corresponding Plan execution inside Pi. Two bounded read-only investigations confirmed that Pi provides `setStatus`, `setWidget`, and overlay APIs, while `imm-work status --json` already exposes most execution facts but no complete Roadmap Phase projection.
- Spec: `docs/specs/2026-08-10-pi-progress-visualization.spec.md`
- Research: `immune_brain_runtime.ts` owns `buildWorkStatusProjection`, Ledger revision, successor projection, CLI routing, command manifest, and migration access classification. `commands/work.ts` already serializes status and is the narrow routing owner. `plan_core.ts` already parses Roadmap Phase criteria from Markdown, but `imm-plan --json` intentionally omits the full Phase list. The root Pi package currently registers Skills only. Installed Pi docs and examples confirm composable footer status, editor widgets, overlays, lifecycle events, redraw, and shutdown cleanup. Advisory agreement favored a read-only runtime projection plus thin Pi consumer; one advisory suggestion to persist milestone entries in the Pi Session tree was rejected because workflow progress must remain session-neutral and Ledger-authoritative.
- Decisions: D1 add `imm-work progress --json` instead of expanding existing status output or creating a second runner. D2 define literal `progress_projection/v1` with deterministic bounded fields and no generation timestamp. D3 keep all lifecycle, Roadmap reference, and Phase evidence derivation in TypeScript runtime. D4 preserve `imm-work status --json` byte-shape compatibility. D5 represent unavailable Roadmap data explicitly without fabricating Phase progress. D6 treat criteria and document order as display facts, never completion authority. D7 defer Pi manifest and TUI implementation until the runtime contract closes. D8 prohibit Session entries, conversation inference, host persistence, mutation actions, percentages, and ETA. D9 keep this current Plan uncontracted because the intentionally finished predecessor is a legacy Plan and ordinary legacy-to-contracted switching is forbidden; the Roadmap and P2 candidate remain durable but non-authoritative. D10 reuse `currentPlanStep` and `currentPlanAlreadyFinished` as lifecycle predicates, while rejecting multiple active-like Step records as malformed. D11 protect Roadmap reads through canonical containment, whole-path symlink rejection, and post-read identity verification. D12 enforce explicit v1 item/text limits without silent truncation and verify no-write behavior through recursive file-set/type/target/content snapshots.
- Assumptions: The current State Ledger is schema v3, `idle + intentional_reset`, and has no active Step or pending Next Action. The worktree was clean before planning. Existing Roadmap source forms use either a backtick-delimited project path plus a `Roadmap` label or one plain project-relative Markdown path. `parsePlan` can provide Phase grammar without calling Plan validation on the Roadmap Spec itself. No product question blocks P1; precise Pi layout choices remain deferred to P2 and cannot change the v1 authority boundary.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Roadmap source: `docs/specs/2026-08-10-pi-progress-visualization.spec.md` Roadmap
- Current phase: P1
- Plan boundary: One host-neutral read contract covering deterministic Roadmap, Plan, Step, and gate projection through the existing TypeScript runtime and `imm-work` wrapper.
- Boundary rationale: Projection schema, lifecycle derivation, safe Roadmap parsing, CLI routing, and no-write evidence share one API, review, compatibility, and rollback boundary. Pi package registration, event lifecycle, component rendering, and human TUI acceptance belong to a separate host-consumer boundary after this invariant is stable.
- Scope pressure: One high-risk Step crosses a focused pure runtime module, existing CLI/work routing, command/package compatibility tests, and canonical architecture vocabulary. It does not modify State Ledger persistence, Plan transitions, host adapters, package manifest, or UI code.
- Execution scope: Phase P1 only: `progress_projection/v1` runtime contract.
- Deferred phases: P2 Pi package Extension, footer/widget/overlay rendering, refresh lifecycle, and TUI acceptance.
- Successor candidate: P2, advisory only because this Plan does not opt into `roadmap-slice/v1`.
- Successor preconditions: P1 passes independent QA and required code review; the exact v1 schema and no-write/path-safety guarantees are stable; installed Pi Extension APIs are rechecked before P2 planning.
- Current-slice warning: This Plan does not register a Pi Extension, render TUI components, persist UI state, add workflow mutation controls, or implement the full Roadmap.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, JSON keys, Pi API names, and `CONTEXT.md` canonical terms such as `Roadmap`, `Phase`, `Plan`, `Step`, `State Ledger`, `Plan boundary`, and `Progress Projection`

## Devil's Advocate Audit

### 1. Rollback Resilience

- P1 is additive: revert the new projection module, `imm-work progress` wiring, focused tests, and the `CONTEXT.md` map entry as one unit. No State Ledger migration, Plan rewrite, package manifest repair, or Pi cleanup is required.
- If safe Roadmap reference normalization cannot support existing declarations without broadening trust, return an explicit unavailable diagnostic. Do not relax path containment or move parsing into Pi.
- If execution discovers that v1 needs workflow mutation or a new persisted field, stop and return to Planner rather than widening the Step.

### 2. Verification Vanity

- Tests must construct real temporary Plan, Roadmap, and schema v3 Ledger fixtures, invoke the CLI through fresh processes, and recursively snapshot isolated project plus agent-local target roots. Closure compares complete relative file sets, file types, symlink targets, and content hashes before/after, so newly created temp, lock, cache, or inbox artifacts fail; access times and directory mtimes are not semantic writes.
- Lifecycle fixtures must distinguish pending, active, review, rework, replan, follow-up, terminated, closed, and matching-finish states. They must prove closed-plus-active selection, multiple-active-like rejection, and stale non-matching `finish_reset` behavior; one happy-path JSON snapshot is insufficient.
- Roadmap tests must prove document order and acceptance text do not create completion claims. Invalid/missing/oversized sources must produce stable explicit diagnostics. Path fixtures cover traversal, canonical outside-root resolution, a final symlink, a symlinked parent, and pre/post-read identity mismatch where the platform permits deterministic replacement.
- Package verification must execute the existing `imm-work` wrapper and assert the command manifest, not merely import the projection function.

### 3. Spec Dilution Detection

- P1 fails if it expands raw `status` output instead of providing a versioned contract, reads conversation/session state, emits stale cached truth, exposes arbitrary Ledger payloads, evaluates criteria, estimates percentages, or creates any authority-file write.
- P1 intentionally defers all Pi rendering, watchers, lifecycle hooks, package registration, and human TUI acceptance to P2. Those requirements remain preserved in the Spec Roadmap rather than silently omitted.
- The plan does not claim global Roadmap membership or completion. It exposes only document facts plus explicit current/archive/transition evidence.

## Planning Quality Gate

- **contract surface**: `runtime/progress_projection.ts`, `runtime/commands/work.ts`, `runtime/immune_brain_runtime.ts`, `runtime/imm_core.ts`, `CONTEXT.md`, focused progress tests, existing progression tests, and package wrapper/manifest tests.
- **compatibility**: `imm-work progress` is additive; `imm-work status`, schema v3, Plan signatures, existing wrappers, transition history, host adapters, and legacy Plans remain unchanged. No migration is introduced.
- **interruption recovery**: Until command wiring closes, existing runtime behavior continues. The command is read-only, so retrying after interruption reconstructs solely from persisted project bytes.
- **rollback path**: Revert the focused module, routing/manifest changes, tests, and architecture map entry. No data repair is needed.
- **verification strength**: Pure mapping fixtures, mixed/stale/ambiguous lifecycle cases, fresh-process recursive no-write snapshots, byte-stable serialization, canonical containment and symlink-chain cases, pre/post-read identity checks, explicit projection limits, existing progression regressions, package wrapper execution, Plan validation, and `git diff --check`.
- **design-depth classification**: High risk because this creates a cross-host API over persisted workflow state and must preserve authority, compatibility, and path-safety boundaries.
- **Technical Design baseline**: The referenced Spec is the sole authority for v1 shape, lifecycle precedence, Roadmap semantics, failure behavior, and the P1/P2 boundary.
- **Mermaid intent**: The Spec diagram makes the prohibited host-to-authority paths and one-way projection flow explicit.
- **Design Conformance**: QA compares implementation against Spec R1-R5 and Technical Design 5.1-5.4. Local defects route to `rework`; any new persisted state, changed authority, or host-side derivation routes to `replan`.
- **roadmap information preservation**: P2 retains UI goals, API surfaces, refresh and cleanup semantics, tests, human acceptance, promotion criteria, and explicit non-goals in the Spec.
- **executable-slice discipline**: P1 owns only the runtime invariant. Pi package/UI work is not hidden inside the Step.
- **Plan boundary cohesion**: Schema, derivation, routing, package visibility, and no-write verification must close together before any consumer relies on v1.
- **scope-pressure reasoning**: Cross-module risk is bounded to one runtime read API and its executable tests. The independent Pi host boundary is split by authority and rollback semantics, not by file count.
- **successor authority**: P2 is advisory planning metadata only. This uncontracted Plan does not request or imply automatic successor activation.
- **session neutrality**: Projection behavior depends only on project artifacts and remains identical across Pi sessions.

## Steps

### Step 1

- Step ID: U1
- Result: Runtime clients receive the versioned read-only Progress Projection.
- Scope: `plugins/immune-brain/runtime/progress_projection.ts`; `plugins/immune-brain/runtime/commands/work.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/imm_core.ts`; `tests/progress-projection-runtime.test.ts`; `tests/plugin-package-runtime.test.ts`; `tests/roadmap-plan-progression-runtime.test.ts`; `CONTEXT.md`
- Discovery cache: `plugins/immune-brain/runtime/immune_brain_runtime.ts` (command registry, Ledger revision, current Plan validation, successor projection, migration access classification); `plugins/immune-brain/runtime/commands/work.ts` (`imm-work` subcommand routing and JSON failure semantics); `plugins/immune-brain/runtime/plan_core.ts` (existing Roadmap Phase grammar and Plan normalization); `plugins/immune-brain/runtime/state_ledger.ts` (schema v3, finish, archive, transition, and review evidence shapes); `plugins/immune-brain/runtime/imm_core.ts` (public TypeScript runtime barrel); `tests/plugin-package-runtime.test.ts` (command manifest and package-local wrapper execution); `tests/roadmap-plan-progression-runtime.test.ts` (status/successor/no-write compatibility); `CONTEXT.md` (canonical workflow vocabulary and Architecture Map)
- Verification: `bun test tests/progress-projection-runtime.test.ts tests/plugin-package-runtime.test.ts tests/roadmap-plan-progression-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-001-feat-pi-progress-visualization-phase1-plan.md --json && git diff --check`
- Verification type: automated
- Execution note: test-first
- Agent Hint: imm-executor
- Test scenarios: Covers literal `progress_projection/v1` and bounded shape; Covers byte-stable repeated reads; Covers pending plus exact selected-Step lifecycle precedence; Covers closed-plus-active selection; Covers multiple-active-like rejection; Covers stale finish evidence; Covers legacy Plan with no Roadmap; Covers valid Roadmap Phase criteria and overlapping relations; Covers available Roadmap with `phase_unmapped` diagnostics; Covers traversal, canonical outside-root, final symlink, symlinked parent, pre/post-read identity mismatch, missing, malformed, and limit-exceeded sources; Covers authoritative Plan projection limits; Covers signature/schema failures; Covers recursive file-set/type/symlink-target/content no-write behavior on success and failure; Covers existing `status` shape compatibility; Covers command manifest and package-local wrapper execution.
- failure_behavior: Fail the whole command for invalid authoritative State Ledger/current Plan/signature state, multiple active-like Steps, or authoritative Plan projection limits. Preserve Plan and workflow facts while returning an explicit bounded Roadmap diagnostic when only the optional declared Roadmap source is unavailable, unsafe, malformed, unmatched, or oversized. Never truncate apparently complete facts or return a stale prior projection as current truth.
- security_considerations: Treat Plan/Roadmap Markdown and Ledger extensions as untrusted input; require canonical project-root containment, reject symlinks across the lexical Roadmap path chain, reread canonical identity after content access, clone bounded output fields, enforce 256-item and 8-KiB text limits, exclude raw evidence/session/environment data, avoid shell interpolation, assert no new temp/lock/cache/inbox artifacts, and retain literal-user authority for every mutation path.
- Depends on: none

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-001-feat-pi-progress-visualization-phase1-plan.md --json`
- Focused runtime and package verification: `bun test tests/progress-projection-runtime.test.ts tests/plugin-package-runtime.test.ts tests/roadmap-plan-progression-runtime.test.ts`
- Repository hygiene: `git diff --check`
- Full planned verification: `bun test tests/progress-projection-runtime.test.ts tests/plugin-package-runtime.test.ts tests/roadmap-plan-progression-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-001-feat-pi-progress-visualization-phase1-plan.md --json && git diff --check`

## Roadmap Continuation

- Preserved deferred content: P2 registers the root Pi Extension, resolves the package-local runtime, validates v1, renders `setStatus`/`setWidget`/overlay surfaces, refreshes through events plus a debounced `.imm/memory` directory watcher, cleans resources on shutdown, and proves responsive/error/idle behavior through automated plus human TUI acceptance.
- Open questions: None block P1. Before P2 planning, recheck the installed Pi Extension API and decide the exact compact widget visibility rule; neither decision may alter runtime authority or v1 semantics.
- Promotion criteria: U1 closes with independent QA and required code review; `progress_projection/v1` shape, lifecycle precedence, path safety, deterministic serialization, and no-write evidence are stable; existing status/progression/package tests remain green.
- Candidate next Plan: Phase P2 Pi TUI visualization, created only after explicit user direction.
- Explicit non-goals: Pi UI code, root package Extension registration, mutation actions, Session entries, persisted UI cache, Web dashboard, telemetry, percentages, ETA, other host UIs, or workflow authority changes.

## Notes

- This is not the full Roadmap implementation Plan.
- The P2 candidate does not create, validate, approve, queue, activate, or execute another Plan.
- The user decides whether later work continues in this session or another session.
