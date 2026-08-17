# Iteration Plan

## Task

- Summary: Present the host-neutral Progress Projection as a lifecycle-safe Pi TUI status, Widget, and on-demand Roadmap/Plan/Gates Overlay.
- Origin: User explicitly requested planning for Phase P2 Pi TUI Visualization after Phase P1 closed. The finished predecessor established `progress_projection/v1`; this Plan promotes the preserved P2 Roadmap slice without changing runtime authority or workflow state.
- Spec: `docs/specs/2026-08-10-pi-progress-visualization.spec.md`
- Research: Phase P1 is closed and the State Ledger is `idle + intentional_reset` with no active Step or follow-up. `imm-work progress --json` currently returns the finished P1 Plan plus both Roadmap Phases under literal `progress_projection/v1`. The root `package.json` registers `pi.skills` only. Pi package documentation confirms a local path can be installed under an isolated `PI_CODING_AGENT_DIR`, allowing the real resolver to be tested without mutating user settings. The State Ledger write path atomically renames authority files inside the stable `.imm/memory` directory rather than replacing that directory. Installed `@earendil-works/pi-coding-agent` `0.84.1` documentation and examples confirm `ctx.mode`, `session_start`, `session_shutdown`, `tool_execution_end`, `agent_settled`, abort-aware `pi.exec`, `setStatus`, `setWidget`, width-aware components, and `custom(..., { overlay: true })`. Package rules permit an explicit Extension path while retaining Skills and require direct Pi TUI imports to remain peer dependencies. The Planner activation helper classified this as eligible `multi_domain` work but returned `dispatch: false` with `single_model_fallback`, so no advisory child output is used.
- Decisions: D1 register `plugins/immune-brain/.pi-extension/index.ts` through the existing root Pi manifest. D2 keep the Pi adapter translation-only and invoke only `bun <package-runtime> cli imm-work progress --json` through an argument array. D3 guard all process, watcher, and UI startup with `ctx.mode === "tui"`. D4 split host code into process validation, pure views, and lifecycle ownership without adding another runtime abstraction. D5 accept unknown additive v1 fields but reject malformed required fields, wrong contracts, invalid JSON, timeouts, and non-zero exits. D6 publish no stale successful projection after adapter or watcher failure. D7 keep refresh debounced and single-flight with abort plus generation guards, recording watcher directory identity and attempting event-driven reattachment without polling. D8 show compact status for every lifecycle, show the Widget only for executing/review/rework/replan/follow-up or explicit errors, and expose complete bounded facts through `/imm-progress`. D9 use Pi theme and width primitives with keyboard-only Overlay navigation, retaining at most one live Overlay instance. D10 clear every UI key and close/abort each resource idempotently on shutdown. D11 add `@earendil-works/pi-tui` as a peer rather than bundling Pi. D12 keep the full P2 result in one Step because package loading, rendering, refresh, cleanup, and real TUI acceptance form one user-visible rollback boundary.
- Assumptions: Phase P1's exact v1 contract, path safety, deterministic serialization, and no-write evidence remain stable. `bun` is available because the shipped wrappers already require it. Normal runtime writes replace authority files but preserve the `.imm/memory` directory; unexpected directory replacement becomes an explicit UI error until a watcher or Pi refresh event can reattach. The package is loaded from this repository as a local Pi package, so `/reload` re-reads the root manifest and Extension source. Pi `0.84.1` remains the implementation baseline for this slice. No product question blocks P2.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Roadmap source: `docs/specs/2026-08-10-pi-progress-visualization.spec.md` Roadmap
- Current phase: P2
- Plan boundary: One Pi host-consumer contract covering package registration, v1 process validation, bounded TUI views, refresh ownership, cleanup, and real interactive acceptance.
- Boundary rationale: A registered Extension that cannot render, refresh, or clean up is not independently useful; views without the package and lifecycle cannot be accepted by a Pi user. These concerns share one host API, one rollback, and one user-verifiable result while remaining downstream of the closed runtime authority boundary.
- Scope pressure: One high-risk Step adds a focused three-file host adapter, one focused test suite, manifest/package assertions, and one canonical architecture entry. It does not modify `progress_projection/v1`, State Ledger persistence, Plan transitions, wrappers, Skills, or other host adapters.
- Execution scope: Phase P2 only: Pi package Extension and TUI visualization over the existing Progress Projection.
- Deferred phases: none in this Roadmap.
- Successor candidate: none.
- Successor preconditions: none; completion closes the current Roadmap initiative.
- Current-slice warning: This Plan does not add workflow mutation controls, parse Plan or Roadmap Markdown in Pi, persist UI/session state, estimate percentage or ETA, introduce another host UI, or modify the Progress Projection contract.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, JSON keys, Pi API names, and `CONTEXT.md` canonical terms such as `Roadmap`, `Phase`, `Plan`, `Step`, `State Ledger`, `Plan boundary`, and `Progress Projection`

## Devil's Advocate Audit

### 1. Rollback Resilience

- Remove the root `pi.extensions` entry and Pi TUI peer, `.pi-extension` files, focused tests, and `CONTEXT.md` entry as one unit. The closed runtime projection remains available and no State Ledger or Plan migration is needed.
- If Pi `0.84.1` behavior differs from the checked installed API, stop and return to Planner instead of adding a version shim. A compatibility layer would require an explicit expiry condition, cleanup milestone, and owner.
- If execution discovers that complete rendering requires Markdown parsing, Session entries, host persistence, or a v1 contract change, route to `replan`; do not widen the adapter.

### 2. Verification Vanity

- Tests must load the real Extension factory with mock Pi contexts, not only snapshot helper strings. They assert the exact `bun` argv, package-local runtime path, timeout and abort wiring, schema rejection, error replacement, event registration, and non-TUI no-op behavior.
- Deterministic fake timers and controllable process promises prove debounce, single-flight refresh, dirty-trigger replay, shutdown abort, generation suppression, idempotent watcher closure, directory identity reattachment, and late-result rejection. A sleep-based happy path is insufficient.
- Width fixtures render ANSI/themed status, Widget, and every Overlay section at narrow and normal widths, asserting visible widths stay bounded and navigation never changes editor dimensions.
- Package tests use an isolated `PI_CODING_AGENT_DIR` local-path install through the real Pi `0.84.1` resolver, then verify that the installed package retains `pi.skills`, resolves the Extension file, declares Pi peer dependencies, and imports the entrypoint.
- A source authority allowlist fails if Extension code reads workflow files or Pi Session trees/IDs, calls `appendEntry`, interpolates a shell command, or exposes any workflow process path other than the exact Progress Projection invocation.
- Human acceptance runs in real Pi after automated checks: `/reload` restores status without duplicate resources, `/imm-progress` opens and keyboard-navigates every section, repeated invocation replaces and disposes the prior Overlay, a legal Ledger transition refreshes the visible lifecycle without another reload, Escape closes cleanly, and a second `/reload` leaves one status/Widget instance.

### 3. Spec Dilution Detection

- P2 fails if it reads conversation or Session trees, invokes any workflow command other than `imm-work progress --json`, uses shell interpolation, evaluates Roadmap criteria, calculates percentage/ETA, silently preserves stale success, replaces the full footer, or adds mutation actions.
- P2 fails if RPC, JSON, or print mode starts a process or watcher, even though some Pi UI calls are no-ops outside TUI.
- P2 does not reinterpret lifecycle, Step closure, Roadmap relations, gates, or errors. Every displayed fact must originate from the validated v1 payload or an explicit local adapter/watcher error.

## Planning Quality Gate

- **contract surface**: `package.json`, `plugins/immune-brain/.pi-extension/index.ts`, `plugins/immune-brain/.pi-extension/progress_client.ts`, `plugins/immune-brain/.pi-extension/progress_views.ts`, `tests/pi-progress-extension.test.ts`, `tests/plugin-package-runtime.test.ts`, `tests/progress-projection-runtime.test.ts`, and `CONTEXT.md`.
- **compatibility**: Existing Skill discovery, coding-agent/typebox peer declarations, `imm-work progress`, schema v3, Plan signatures, wrappers, other host adapters, and non-TUI Pi modes remain unchanged. The only package addition is one Extension path plus its direct Pi TUI peer.
- **interruption recovery**: The Extension owns no durable state. Reload or restart aborts pending reads, closes the watcher, clears UI keys, reconstructs from a fresh v1 read, and ignores old-generation callbacks.
- **rollback path**: Revert the manifest/peer additions, `.pi-extension` directory, focused tests, and architecture map entry. No authority-file repair or data migration is required.
- **verification strength**: Real factory loading with mock contexts, exact process argv and failure cases, structural v1 validation, deterministic concurrency controls, watcher replacement events, non-TUI no-op proof, bounded ANSI-visible rendering, keyboard navigation, package resolution, existing projection regressions, Plan validation, repository hygiene, and real TUI acceptance.
- **design-depth classification**: High risk because a long-lived host process could display stale authority, leak resources across reload, or interfere with Pi modes even though the underlying workflow read API is already closed.
- **Technical Design baseline**: Spec R6-R8 and Technical Design 5.5-5.6, refined against installed Pi `0.84.1`, are the sole authority for host behavior and lifecycle precedence.
- **Mermaid intent**: The existing Spec authority diagram remains correct: Pi is a one-way consumer of runtime projection and has no path back to State Ledger, Plan, or Roadmap mutation.
- **Design Conformance**: QA compares implementation against the translation-only boundary, exact command allowlist, TUI-only startup, explicit error replacement, widget visibility table, keyboard model, and idempotent cleanup. Local defects route to `rework`; authority or v1 changes route to `replan`.
- **roadmap information preservation**: P2 carries every remaining Roadmap acceptance criterion: package loading, compact plus complete views, event/watch refresh, shutdown disposal, read-only command proof, automated tests, and human TUI acceptance.
- **executable-slice discipline**: The Step closes only when the Pi package presents the complete lifecycle-safe visualization. Internal modules are implementation structure, not partial milestones.
- **Plan boundary cohesion**: Registration, adapter validation, view rendering, refresh lifecycle, and interactive acceptance share the same Pi host boundary and rollback while remaining isolated from runtime authority.
- **scope-pressure reasoning**: Three source modules keep ownership explicit without introducing a second domain layer; one focused test file owns host behavior while existing package/projection suites protect compatibility.
- **successor authority**: No successor is proposed or activated. Successful completion closes Phase P2 and the Roadmap initiative.
- **session neutrality**: The Extension derives every refresh from project artifacts through v1; Session IDs, conversation entries, and Pi Session persistence never affect output.

## Steps

### Step 1

- Step ID: U1
- Result: Pi presents the authoritative Progress Projection through a lifecycle-safe TUI visualization.
- Scope: `package.json`; `plugins/immune-brain/.pi-extension/index.ts`; `plugins/immune-brain/.pi-extension/progress_client.ts`; `plugins/immune-brain/.pi-extension/progress_views.ts`; `tests/pi-progress-extension.test.ts`; `tests/plugin-package-runtime.test.ts`; `CONTEXT.md`
- Discovery cache: `package.json` (existing Pi Skills registration and peer contract); `plugins/immune-brain/runtime/progress_projection.ts` (literal v1 payload, lifecycle enums, bounds, and diagnostic shape); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`cli imm-work progress --json` argv and read-only routing); `plugins/immune-brain/runtime/state_ledger.ts` (stable memory-directory and atomic authority-file replacement behavior); `plugins/immune-brain/bin/imm-work` (package-local Bun/runtime resolution precedent); `tests/plugin-package-runtime.test.ts` (package-local wrapper and command-manifest assertions); `tests/progress-projection-runtime.test.ts` (v1 fixtures and no-write contract); `CONTEXT.md` (canonical host/runtime authority map); installed Pi `docs/extensions.md`, `docs/tui.md`, `docs/packages.md`, and `examples/extensions/` (version-checked lifecycle, local install, package, width, Widget, and Overlay APIs)
- Verification: `bun test tests/pi-progress-extension.test.ts tests/plugin-package-runtime.test.ts tests/progress-projection-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-002-feat-pi-progress-visualization-phase2-plan.md --json && git diff --check`; after execution evidence, an `imm-ui-review` human TUI pass records `/reload`, `/imm-progress` navigation/close, live Ledger refresh, and duplicate-free cleanup.
- Verification type: automated plus hitl review
- Execution note: test-first
- Agent Hint: imm-executor
- Test scenarios: Covers isolated local-package installation retaining Skills plus Extension and Pi peers; Covers package-local runtime resolution and exact read-only argv; Covers source authority allowlist rejecting workflow-file/Session reads, `appendEntry`, and alternate process paths; Covers wrong contract, malformed required fields, invalid JSON, timeout/abort, and non-zero exit; Covers compact status across every lifecycle; Covers Widget visibility and clearing table; Covers error replacing stale success; Covers event/command/watcher/render/cleanup failures remaining contained; Covers Roadmap/Plan/Gates Overlay content and keyboard navigation; Covers repeated Overlay replacement and prior-instance disposal; Covers narrow ANSI-visible width bounds; Covers TUI-only startup; Covers initial/event/watcher refresh; Covers deterministic debounce, single-flight, and replay; Covers watcher startup failure, leaf-file atomic rename, directory identity change, event-driven reattachment, and absent-directory error; Covers idempotent shutdown, abort, resource closure, UI clearing, and late-generation suppression; Covers real Pi reload, live Ledger transition, Overlay navigation, and close behavior.
- failure_behavior: Contain operational failures from Pi event, command, watcher, render, and cleanup handlers so the agent process continues. Publish a stable bounded error status and Widget for process, validation, timeout, watcher, or reattachment failures; clear prior successful rendering input so stale facts cannot appear current. In non-TUI modes perform no process, watcher, or UI work. On shutdown abort and suppress pending publication, close each resource once, clear owned UI keys, and never write workflow or Session state.
- security_considerations: Treat subprocess stdout and every v1 string/array as untrusted bounded input; require literal `progress_projection/v1`, validate required nested fields and enums, clone only display fields, retain v1 item/text bounds, use package-local `import.meta.url` resolution, pass Bun argv without shell interpolation, set timeout plus abort, reject path/runtime resolution failures, escape or width-bound terminal text through Pi TUI primitives, permit filesystem watch/stat only for directory lifecycle identity, reject direct workflow-file or Session reads, never call mutation commands, and never persist host cache or conversation-derived state.
- Depends on: none

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-002-feat-pi-progress-visualization-phase2-plan.md --json`
- Focused host/package/runtime verification: `bun test tests/pi-progress-extension.test.ts tests/plugin-package-runtime.test.ts tests/progress-projection-runtime.test.ts`
- Repository hygiene: `git diff --check`
- Human TUI acceptance authority: `imm-ui-review` after execution evidence, using `/reload`, repeated `/imm-progress` replacement, keyboard navigation, one legal Ledger lifecycle transition, Escape close, and a second `/reload` to prove cleanup.
- Full planned verification: `bun test tests/pi-progress-extension.test.ts tests/plugin-package-runtime.test.ts tests/progress-projection-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-002-feat-pi-progress-visualization-phase2-plan.md --json && git diff --check`, followed by the recorded human TUI acceptance pass.

## Roadmap Continuation

- Preserved deferred content: none; this Plan promotes the final P2 Roadmap slice.
- Open questions: None block implementation. Any Pi API mismatch, need for host persistence, or required v1 structural change invalidates assumptions and routes to Planner.
- Promotion criteria: U1 passes automated verification and independent QA; required code review accepts package/runtime boundaries; `imm-ui-review` records real TUI acceptance; final completion leaves existing projection/package regressions green.
- Candidate next Plan: none.
- Explicit non-goals: Workflow mutation controls, Plan/QA/successor actions, Session entries, persisted UI cache/preferences, Markdown parsing in Pi, Web dashboards, telemetry, percentages, ETA, other host UIs, compatibility shims, or runtime projection changes.

## Notes

- This is the final implementation Plan for the current two-Phase Roadmap.
- The Plan is created and validated without activating U1; execution still requires explicit user authorization.
- A manual TUI observation is review evidence, not a substitute for automated execution evidence or QA.
