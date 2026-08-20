# Iteration Plan

## Task

- Summary: Close the Roadmap with executable linear multi-Plan compatibility, recovery, terminal-checkpoint, and shipped host-artifact acceptance without adding historical rewrites or another workflow authority.
- Origin: The user explicitly invoked `imm-planner` after P3 closed at `awaiting_user_successor_decision` and asked what the P4 Plan would be. The P1-P4 Roadmap already defines P4 as compatibility and end-to-end acceptance.
- Spec: `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md`
- Research: The current schema-v3 Ledger names the closed, reviewed, intentionally finished P3 Plan and preserves exactly one truthful P2 archive plus one P2-to-P3 transition; the pre-contract P1-to-P2 bootstrap remains absent. Existing transition, progression, follow-up, finish, runtime-state, OpenCode adapter, host-manifest, wrapper, package-version, and dist-sync tests cover most primitives but do not compose them into one fresh-process terminal sequence. `imm-autowork` currently has no local terminal completion stop after a contracted `Successor candidate: none` Plan is finished, so it can repeat the pre-finish Compounder handoff. OpenCode's agent-callable `imm_plan_validate` transport intentionally lacks literal-user provenance and therefore cannot safely become a successor-approval surface even though the shared CLI supports direct user activation. Read-only probes confirmed the shipped host inventory: Pi package, Codex/Claude Code/Cursor manifests, OpenCode package/adapter, and shared plugin-local wrappers. The probes also suggested a persisted `superseded` state and historical migration fixture; Planner rejects both because P4 must preserve append-only truth and no-backfill compatibility.
- Decisions: D1 keep P4 as one terminal Plan with three outcome Steps sharing one acceptance and rollback boundary. D2 add only a derived local `terminal_plan_complete` checkpoint; do not add schema v4 or claim global `roadmap_complete`. D3 preserve legacy Plan and ordinary schema-v2 behavior; P4 adds no historical adoption/backfill command or marker. D4 treat pre-approval candidate replacement as non-authoritative selection with no Ledger record; after activation, correction is a separately specified, explicitly approved append-only Plan rather than superseded history. D5 build one fresh-process isolated-root acceptance harness that exercises validation-only output, literal revision-bound direct CLI approval, atomic transition, execution/QA/review/finish, duplicate/stale/blocked/interrupted failure paths, terminal completion, and byte preservation. D6 define cross-host acceptance only at the shipped artifact/adapter contract boundary and copy the plugin to a standalone temporary location so tests cannot fall back to the source checkout. D7 keep OpenCode and every agent-callable structured tool validation/status-only unless a future host supplies trustworthy literal-user provenance; P4 proves extra approval-like arguments cannot become activation flags. D8 keep session lifecycle user-owned and prove session neutrality through fresh processes over identical persisted bytes, not session identifiers. D9 require actual wrapper/adapter execution, version validation, dist sync, build, LSP, and exact payload assertions; presence-only checks cannot close P4. D10 keep DAGs, parallel active Plans, scheduling, project-management UI, vendor UI automation, secret-scanner installation, and global Roadmap topology outside P4.
- Assumptions: The user's `imm-planner` invocation confirms P4 planning scope only; it does not approve P3-to-P4 activation. Before execution, the host must read a fresh P3 revision from `imm-work status --json` and the user must literally approve this concrete validated Plan. Bun and the repository's existing `mise` tasks remain the supported local verification environment. No unresolved Brainstorm question blocks decomposition because the accepted Roadmap supplies P4 behavior, promotion criteria, and non-goals.
- Plan contract: roadmap-slice/v1
- Roadmap source: `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md` Roadmap
- Current phase: P4
- Plan boundary: Terminal compatibility and executable acceptance for one linear multi-Plan workflow across persisted lifecycle, recovery, shipped host artifacts, and standalone package surfaces.
- Boundary rationale: Terminal checkpoint semantics, full linear lifecycle evidence, and host/package parity are the three promotion gates required to make one P4 completion claim. U1 establishes the terminal invariant before U2 composes lifecycle behavior; U3 then proves the same invariant survives shipped transports and packaging. They share one authority model, compatibility matrix, review boundary, and rollback rule. DAGs, migration tooling, progress views, and vendor-host UI automation require different authority or environment boundaries and remain excluded.
- Scope pressure: High but cohesive: one runtime checkpoint branch, source/packaged role wording, fresh-process fixtures and helper, five shipped Host entry surfaces, package-copy isolation, and broad compatibility suites. The breadth is acceptance evidence for one terminal Roadmap slice, not a file-count, Step-count, token, review, or session gate.
- Execution scope: Phase P4 only: compatibility and end-to-end acceptance for the existing linear successor contract.
- Deferred phases: none; P4 is the terminal Roadmap Phase.
- Successor candidate: none
- Successor preconditions: none
- Current-slice warning: This terminal Plan does not add DAGs, parallel active Plans, scheduling, session control, historical backfill, Roadmap topology/progress UI, vendor UI automation, or secret-scanner maintenance, and validation does not authorize activation.

## Output Language

- Human-readable prose: English
- Preserved literals: schema keys, CLI flags, file paths, code identifiers, Host names, Phase IDs, stop reasons, and enum values remain exact English literals.

## Devil's Advocate Audit

### 1. Rollback Resilience

- P3-to-P4 activation is append-only. If P4 implementation fails after activation, recovery stays inside P4 rework/replan or a later correction Plan; rollback must never delete the P3 archive or P3-to-P4 transition.
- U1 is one coherent runtime/role/test change. Reverting it restores the old terminal post-finish checkpoint but leaves Ledger history untouched. Before finish, the existing Compounder handoff remains unchanged.
- U2 uses isolated temporary roots and fresh processes. Partial fixture execution can be deleted without mutating the repository Ledger, installed host settings, HANDOFF, session files, or inbox.
- U3 package-copy and artifact-contract checks are reversible while the common CLI remains authoritative. If U1 is rolled back, every U2/U3 assertion, role statement, or package claim that depends on `terminal_plan_complete` must be removed or explicitly downgraded in the same rollback. If U2 is rolled back, U3 may retain narrow artifact/version parity only and must not claim complete linear-lifecycle acceptance.

### 2. Verification Vanity

- A test that finds a manifest, string, or file is insufficient. U1 must assert exact terminal payload, priority, legacy control, revision parity, repeated-read determinism, and byte-identical authority/external files.
- U2 must execute real plugin-local wrappers in fresh processes, compare before/after Ledger bytes, and inspect archive/transition/Step/review/finish facts. Calling exported helpers alone does not prove session-neutral CLI behavior.
- U3 must run from a copied plugin package outside the checkout, execute its runtime/wrappers, validate every shipped Host artifact version, and prove OpenCode remains validation-only even when approval-like extra arguments are supplied.
- Existing focused suites remain compatibility evidence but cannot substitute for the new composed success and failure paths.

### 3. Spec Dilution Detection

- P4 may not convert the missing P1-to-P2 record into migration, adoption, or superseded evidence. The gap remains truthful historical compatibility state.
- P4 may not name its derived stop `roadmap_complete`, because runtime does not validate global Roadmap membership, phase order, or topology.
- P4 may not claim live vendor UI/session UAT from local adapter tests. Its cross-host claim is limited to shipped manifests, packages, adapters, wrappers, and fresh-process persisted semantics.
- P4 may not weaken literal user approval, revision CAS, one-active-Plan, review-gate, no-write failure, or session ownership requirements to make the E2E harness easier.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/immune_brain_runtime.ts`; source and packaged `imm-loop`/`imm-work` contracts; OpenCode adapter schema and argv mapping; Pi package plus Codex/Claude Code/Cursor/OpenCode manifests; plugin-local wrappers; package/version/dist-sync scripts; terminal, E2E, host, package, transition, progression, follow-up, finish, and runtime-state tests.
- compatibility: contracted terminal Plans gain one derived post-finish stop; legacy Plans retain existing behavior; schema v2 remains lazy; schema v3 histories remain append-only; no historical artifact is rewritten or eagerly migrated.
- interruption recovery: tests use temporary roots, injected competing writes, real lock cleanup behavior, and fresh CLI processes. A failed test run leaves repository authority files unchanged. An interrupted real P4 execution resumes from the current P4 Step or review boundary.
- rollback path: revert U1 runtime/role/tests coherently and simultaneously remove or downgrade dependent U2/U3 terminal assertions; reverting U2 removes U3's complete-lifecycle claim while allowing only narrow artifact/version parity to remain; never roll back an approved transition by deleting history.
- verification strength: exact JSON payload and byte comparisons, actual wrapper/adapter execution, standalone package copy, manifest/version validation, dist sync, runtime build, Plan validation, LSP, and full compatibility suites.
- design-depth classification: High risk because P4 crosses persisted authority interpretation, compatibility, recovery, terminal workflow semantics, explicit approval transport, package distribution, and multiple host contracts.
- Technical Design baseline: Spec section 5.7 owns terminal projection, historical policy, fresh-process sequence, host/package boundary, and recovery invariants. Any structural deviation returns to Planner before QA pass.
- Mermaid intent: the existing Spec state diagram remains required and sufficient; P4 clarifies the local terminal projection in prose without creating a competing state diagram.
- session neutrality: fresh processes derive identical checkpoints from identical Spec, Plan, Ledger, and package bytes without session IDs, transcript state, or HANDOFF parsing.

## P4 Coverage Matrix

| Roadmap acceptance requirement | Plan coverage | Executable evidence |
| --- | --- | --- |
| Legacy Plans and schema-v2 fixtures retain existing single-Plan paths | U1, U2 | terminal legacy controls plus fresh-process legacy lifecycle |
| One truthful explicitly approved linear sequence with no duplicate activation | U2 | validation-only no-write, revision-bound activation, archive/transition assertions, duplicate rejection |
| Interrupted, stale, blocked, pre-approval replacement, append-only correction, and terminal scenarios | U1, U2 | mainline failure matrix plus existing synthetic linear-history compatibility assertions |
| Pi package, Codex/Claude Code/Cursor manifests/assets, OpenCode adapter, and shared wrappers stay aligned | U3 | standalone package copy, manifest/version, wrapper/runtime, validation-only OpenCode mapping, dist sync |
| Session continuation does not change persisted progression semantics | U1, U2, U3 | repeated fresh-process status/autowork and package-copy comparisons |
| No unresolved high-risk review finding remains | U1-U3 | independent QA per Step plus final exact-signature `imm-code-review` |

## Steps

### Step 1

- Step ID: U1
- Result: Local terminal Plan completion with legacy-compatible checkpoint semantics
- Discovery cache: `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`buildSuccessorDecisionProjection`, `runAutoworkCommand`, `buildAutoworkSnapshot`, and post-finish ordering); `tests/roadmap-plan-progression-runtime.test.ts` (pre/post-finish, terminal, priority, revision, and no-write fixtures); `plugins/immune-brain/dist/imm-loop.md` and `plugins/immune-brain/dist/imm-work.md` (host stop contracts); `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md` section 5.7.1 (terminal invariant)
- Files: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/skills/imm-loop/SKILL.md`, `plugins/immune-brain/dist/imm-loop.md`, `plugins/immune-brain/skills/imm-work/SKILL.md`, `plugins/immune-brain/dist/imm-work.md`, `tests/roadmap-plan-terminal-runtime.test.ts`, `tests/roadmap-plan-progression-runtime.test.ts`
- Verification: `bun test tests/roadmap-plan-terminal-runtime.test.ts tests/roadmap-plan-progression-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-autowork-continuation-runtime.test.ts && git diff --check`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers contracted terminal Plan still emits explicit Compounder handoff before finish; Covers matching finish projects exact `terminal_plan_complete`, null authority/next skill/required input, empty actions, null successor decision, shared opaque revision, and stable Next Action; Covers active/QA/review/follow-up/rework/replan priority; Covers legacy Plans preserve existing behavior; Covers missing/signature-drifted current Plan fails closed; Covers repeated fresh reads are byte-identical and create no Ledger, HANDOFF, session, or inbox write; Covers role contracts stop without dispatch and do not claim global Roadmap completion.
- failure_behavior: If terminal status requires persisted completion state, Roadmap parsing, a session identifier, or weakening the existing pre-finish Compounder boundary, stop and return to Planner. A failed read returns deterministic stderr and writes nothing.
- security_considerations: Terminal output exposes only local Plan identity, finish state, opaque revision, and the absence of a successor. It must not expose archived evidence, transcripts, credentials, environment configuration, or a reusable approval.
- Depends on: none

### Step 2

- Step ID: U2
- Result: Fresh-process linear lifecycle acceptance
- Discovery cache: `tests/roadmap-plan-transition-runtime.test.ts` (strict approval grammar, lock-time rereads, no-write failures, duplicate and history fixtures); `tests/roadmap-plan-transition-state.test.ts` (schema/history compatibility and synthetic linear archive growth); `tests/imm-follow-up-runtime.test.ts` (competing writes, stale locks, correction/review reopening); `tests/finish-dehydrate-runtime.test.ts` (finish/CAS semantics); `plugins/immune-brain/bin/imm-*` (fresh-process production entry)
- Files: `tests/roadmap-plan-e2e.test.ts`, `tests/helpers/roadmap-e2e-harness.ts`, `tests/fixtures/roadmap-e2e/`, existing transition/progression/follow-up/finish fixtures only when reusable helpers need extraction, `plugins/immune-brain/runtime/immune_brain_runtime.ts` or `plugins/immune-brain/runtime/state_ledger.ts` only if the composed harness exposes a real contract defect
- Verification: `bun test tests/roadmap-plan-e2e.test.ts tests/roadmap-plan-transition-state.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/roadmap-plan-progression-runtime.test.ts tests/runtime-state.test.ts tests/imm-follow-up-runtime.test.ts tests/finish-dehydrate-runtime.test.ts && git diff --check`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers legacy/schema-v2 same-Plan lifecycle remains readable without eager v3 upgrade; Covers validation-only successor creates no authority write; Covers fresh status revision plus literal direct-CLI approval commits exactly one archive and transition and installs successor-only pending Steps; Covers complete successor lifecycle reaches U1 terminal stop; Covers duplicate/stale/active/review-pending/replan/replaced-file/competing-writer failures preserve bytes; Covers two validated pre-approval alternatives leave only the selected Plan in history; Covers existing synthetic linear-history tests prove later correction records append without nesting or rewriting and are not presented as a P4 successor; Covers schema-v3 history growth preserves the absent P1-to-P2 bootstrap; Covers fresh processes produce session-neutral status and no external writes.
- failure_behavior: The harness must stop at the first unexpected mutation and emit a stable diagnostic summary containing stage name, redacted argv, exit code, stderr, and before/after authority-file hashes. Temporary roots are deleted normally; setting `IMM_P4_KEEP_FIXTURE=1` preserves one failed synthetic root and prints its path. Runtime defects are repaired inside the existing P2/P3 contracts; no test may normalize an invalid state into success or synthesize missing history.
- security_considerations: Fixtures use synthetic paths and evidence only. Logs must not print full archived evidence, environment secrets, home-directory configuration, or opaque revisions beyond the isolated fixture's expected values.
- Depends on: 1

#### U2 Fresh-process command contract

Every stage uses a new `spawnSync` process, the absolute plugin-local wrapper, the synthetic project as `cwd`, a temporary `HOME`, and a bounded output buffer. `tests/helpers/roadmap-e2e-harness.ts` owns this transport and returns redacted argv, exit/stdout/stderr, and authority-file hashes.

| Stage | Direct command | Required observation |
| --- | --- | --- |
| validate successor | `<plugin>/bin/imm-plan <terminal-plan> --json` | exit 0; Ledger, HANDOFF, session, and inbox bytes unchanged |
| read approval input | `<plugin>/bin/imm-work status --json` | canonical predecessor plus fresh lowercase opaque revision; command template remains non-executable |
| literal user activation | `<plugin>/bin/imm-plan <terminal-plan> --sync --approve-successor --expected-current-plan <predecessor> --expected-ledger-revision <fresh-revision>` | one atomic archive/transition append; terminal Steps pending; no external writes |
| execute and QA | `<plugin>/bin/imm-work activate ...`; `<plugin>/bin/imm-work record-execution --evidence-json ...`; `<plugin>/bin/imm-review pass ...` | exact active/ready/closed state sequence and structured evidence |
| required review | `<plugin>/bin/imm-autowork --json`; `<plugin>/bin/imm-review gate-pass ... --changed-files-signature <fresh-signature>` | review gate and changed-files signature match; stale signature rejected |
| pre-finish boundary | `<plugin>/bin/imm-autowork --json` | `complete` plus explicit `imm-compounder` handoff; no finish implied |
| finish and terminal read | `<plugin>/bin/imm-finish ... --coding-agent <fixture-agent>`; fresh status/autowork processes | matching `finish_reset`, `terminal_plan_complete`, revision parity, no next skill/action |

### Step 3

- Step ID: U3
- Result: Shipped host-artifact acceptance
- Discovery cache: `package.json` (Pi package metadata); `plugins/immune-brain/.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, and `.opencode-plugin/package.json` (shipped Host manifests/assets); `plugins/immune-brain/.opencode-plugin/index.ts` and `runtime.ts` (validation-only structured tool schema and CLI argv mapping); `plugins/immune-brain/tests/host-manifest-consistency.test.ts`, `plugins/immune-brain/tests/opencode-runtime.test.ts`, `tests/opencode-cli-adapter.test.ts`, and `tests/host-runtime-cutover.test.ts` (existing parity seams); `mise.toml`, `scripts/plugin_versioning.ts`, and `scripts/sync-dist-docs.ts` (package validation)
- Files: `tests/roadmap-plan-host-acceptance.test.ts`, `plugins/immune-brain/tests/opencode-runtime.test.ts`, `tests/opencode-cli-adapter.test.ts`, `plugins/immune-brain/tests/host-manifest-consistency.test.ts`, `tests/host-runtime-cutover.test.ts`, Host manifests/package/versioning/public-release files only if executable parity tests expose actual drift; `plugins/immune-brain/.opencode-plugin/index.ts` or `runtime.ts` only if needed to preserve the validation-only boundary
- Verification: `bun test tests/roadmap-plan-host-acceptance.test.ts tests/opencode-cli-adapter.test.ts plugins/immune-brain/tests/opencode-runtime.test.ts plugins/immune-brain/tests/host-manifest-consistency.test.ts tests/host-runtime-cutover.test.ts tests/plugin-package-runtime.test.ts tests/dist-docs-sync-contract.test.ts && bun scripts/plugin_versioning.ts validate && bun scripts/sync-dist-docs.ts --check && mise run check-plugin && git diff --check`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers Pi package metadata and four Host manifests advertise the canonical version and point at shipped assets appropriate to each Host; Covers Codex/Claude Code/Cursor claims stop at manifest/assets and do not claim live vendor loading; Covers a copied plugin outside the checkout resolves only its own runtime and wrappers against a separate target root; Covers copied `imm-work status`, `imm-autowork`, command manifest, and transition help preserve U1/U2 semantics; Covers OpenCode validation-only mapping remains read-only and omits approval/current-plan/revision activation flags even when similarly named extra arguments are supplied; Covers direct user CLI remains the only P3-to-P4 activation route; Covers mapped OpenCode commands remain inside the CLI manifest; Covers dist docs, registries, BASELINE, release template, and version contract remain synchronized; Covers fresh process/package reads are session-neutral and do not write Host configuration.
- failure_behavior: If standalone execution falls back to the source checkout, a claimed Host artifact is absent, version/package parity drifts, or an agent-callable adapter can emit successor approval flags without trustworthy literal-user provenance, fail the Step and return to Planner. Do not weaken package-copy isolation or broaden the Host claim to make the test pass.
- security_considerations: Package tests use temporary HOME/config roots and must not read or write real Host credentials, caches, sessions, installed plugins, or developer-insight inboxes. Structured adapters never transport successor approval in P4; the direct CLI test uses only synthetic opaque fixture values.
- Depends on: 1, 2

## Validation

- Terminal compatibility: `bun test tests/roadmap-plan-terminal-runtime.test.ts tests/roadmap-plan-progression-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-autowork-continuation-runtime.test.ts`
- Fresh-process E2E and recovery: `bun test tests/roadmap-plan-e2e.test.ts tests/roadmap-plan-transition-state.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/runtime-state.test.ts tests/imm-follow-up-runtime.test.ts tests/finish-dehydrate-runtime.test.ts`
- Host/package acceptance: `bun test tests/roadmap-plan-host-acceptance.test.ts tests/opencode-cli-adapter.test.ts plugins/immune-brain/tests/opencode-runtime.test.ts plugins/immune-brain/tests/host-manifest-consistency.test.ts tests/host-runtime-cutover.test.ts tests/plugin-package-runtime.test.ts tests/dist-docs-sync-contract.test.ts`
- Activation evidence: before Step execution, a literal user-approved P3-to-P4 transition must use a fresh supported status revision, append exactly one P3 archive plus one P3-to-P4 transition, preserve the existing P2 archive/P2-to-P3 transition, install P4 Steps pending, and leave P1 absent. Plan validation alone must not change the current P3 Ledger.
- Complete compatibility matrix: legacy/schema v2, schema v3 history preservation, truthful P3-to-P4 activation, duplicate/stale/blocked/interrupted/pre-approval replacement, existing synthetic append-only correction evidence, contracted terminal, role priority, session-neutral fresh processes, standalone package copy, shipped Host artifact/version parity, OpenCode validation-only authority, and no external writes.
- Package/release parity: `bun scripts/plugin_versioning.ts validate && bun scripts/sync-dist-docs.ts --check && mise run check-plugin`
- Runtime build: `bun build plugins/immune-brain/runtime/immune_brain_runtime.ts plugins/immune-brain/.opencode-plugin/runtime.ts --no-bundle --outdir /tmp/immune-brain-p4-build`
- Plan validation: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-29-002-feat-roadmap-plan-boundary-successor-phase4-plan.md --json`
- Static checks: primary TypeScript LSP on changed runtime/adapters/tests, `lens_diagnostics` with no blocking errors, and `git diff --check`.

## Roadmap Continuation

- Completed predecessor: P3 projection and user-owned successor boundary are closed, independently QA-reviewed, exact-signature code-reviewed, compounded, and intentionally finished. The current checkpoint is `awaiting_user_successor_decision` with candidate P4 and no automatic action.
- Activation boundary: Planner validates this file without sync. If the user later approves activation, reread `ledger_revision` from `imm-work status --json` and invoke `imm-plan docs/plans/2026-07-29-002-feat-roadmap-plan-boundary-successor-phase4-plan.md --sync --approve-successor --expected-current-plan docs/plans/2026-07-29-001-feat-roadmap-plan-boundary-successor-phase3-plan.md --expected-ledger-revision <fresh-revision>`. Approval and activation remain one non-replayable atomic event.
- Preserved deferred content: none inside this Roadmap. Excluded future product ideas remain DAGs, branches, parallel active Plans, scheduling, project-management UI, global topology/progress views, vendor UI automation, and unrelated security maintenance.
- Coverage matrix: the P4 Coverage Matrix above maps every Roadmap acceptance and promotion criterion to U1-U3.
- Open questions: none block validation. Any future request for global Roadmap membership, historical adoption records, or live vendor-host orchestration requires a new Spec and Plan rather than expansion of P4.
- Promotion criteria: U1-U3 close through independent QA; complete E2E, compatibility, standalone package, and shipped host-artifact contract suites pass; runtime/package/static validation passes; no unresolved high-risk review finding remains.
- Candidate next Plan: none; P4 is terminal.
- Explicit non-goals: no automatic P3-to-P4 transition, no historical P1-to-P2 backfill, no schema v4, no `superseded` authority state, no Roadmap parser/topology claim, no host-specific workflow state, no session control, and no automatic scheduling.

## Notes

- This Plan is validation-only until a literal user supplies explicit activation authority. Do not run ordinary cross-Plan `--sync`.
- HANDOFF is a convenience mirror and must not provide the approval revision or successor path when fresh status is available.
- The prior non-reproducible gitleaks notification remains outside this compatibility Plan; a reproducible credential finding requires a separate security-maintenance boundary and possible rotation.
