# Iteration Plan

## Task

- Summary: Project one closed Roadmap Plan's successor facts into read-only runtime status, host checkpoints, and HANDOFF guidance so progression stops at an explicit user decision without weakening the P2 transition authority.
- Origin: The user requested that the remaining work be re-checked, consolidated into one independent Plan, and executed. Repository evidence shows P1 and P2 implementation Steps are closed, while P3 workflow progression remains the declared successor. The current schema-v2 P2 Ledger was activated through the pre-P2 legacy sync path; that historical bootstrap must remain visible but must not be rewritten into fabricated approval evidence.
- Spec: `docs/specs/2026-07-28-roadmap-plan-boundary-successor.spec.md`
- Research: The current Ledger is a closed, reviewed, intentionally reset P2 Plan with no transition history. P2 correctly declares successor Phase P3, and the Roadmap defines P3 as workflow role and successor handoff integration. `buildLedgerRevision` exists but `imm-work status --json` does not expose it; the `imm-plan` command manifest/help omits the approved-transition arguments; `runAutoworkCommand` returns `complete` and `imm-compounder` whenever no active Step or review gate remains, including after `imm-finish`; and `buildAutoworkSnapshot` contains no successor-decision projection. Existing completion, continuation, transition, package-runtime, role-contract, and HANDOFF template tests provide focused fixtures. An independent read-only architecture probe confirmed the P3 runtime/HANDOFF surfaces and classified the P1-to-P2 bootstrap gap as P4-deferred. High-risk preplan review selected `Hold Scope / revise`: it required a supported pre-activation revision source, an exact fail-closed status API, and Plan-level evidence for the first truthful P2-to-P3 transition. This Plan adopts those findings without expanding into P4. The prior generic-api-key notification is not reproducible in current project diagnostics and the local `gitleaks` CLI is unavailable, so credential rotation or upstream fixture cleanup is not mixed into this Plan.
- Decisions: D1 preserve the closure order `QA/review -> imm-compounder handoff -> imm-finish -> successor decision`. D2 reopen the passed P2 code-review gate through one same-boundary follow-up that exposes only `ledger_revision` before P3 activation; do not manually reproduce the hash. D3 derive P3 `successor_decision` on read without persisting approval-like state. D4 require a canonical current Plan reread, validation, and signature match before projecting successor metadata. D5 make malformed/missing/drifted status fail as a whole with exit `1`, empty stdout, deterministic stderr, and byte-identical authority files. D6 represent a non-terminal finished Plan as `awaiting_user_successor_decision` with literal authority `user`; never auto-dispatch Planner, approval, transition, Compounder, or session behavior. D7 expose only a structured non-executable command template; a concrete validated successor path and explicit user invocation remain mandatory. D8 keep review/follow-up/rework/replan checkpoints higher priority than successor messaging. D9 keep terminal `Successor candidate: none` behavior distinct. D10 update source and packaged workflow contracts plus HANDOFF template without adding an automatic HANDOFF writer. D11 retain the historical P1-to-P2 schema-v2 bootstrap unchanged; Plan-level activation evidence must show exactly one P2 archive and one P2-to-P3 transition with no synthesized P1 record. D12 defer historical migration, cross-host UAT, Roadmap membership/topology, progress views, and secret-scanner installation to separate P4 or maintenance boundaries.
- Assumptions: The user's instruction to create and proceed with the independent new Plan is explicit scope confirmation for P3. Before P3 activation, the host will run one bounded P2 same-boundary follow-up that adds the supported opaque revision to `imm-work status --json`, close independent QA/review, and retain the existing matching `finish_reset` plus `intentional_reset`; a duplicate finish is neither required nor allowed. Planner then validates this Plan and the host performs one revision-bound P2-to-P3 transition using the public status revision. The transition proves local candidate/Phase/Roadmap linkage only. State Ledger remains the workflow authority; HANDOFF remains a human mirror. No open brainstorm question or hypothetical-only verification remains.
- Plan contract: roadmap-slice/v1
- Roadmap source: `docs/specs/2026-07-28-roadmap-plan-boundary-successor.spec.md` Roadmap
- Current phase: P3
- Plan boundary: Read-only successor-decision projection, post-finish workflow stop semantics, role authority wording, and HANDOFF/rehydration mirroring for one linear successor.
- Boundary rationale: U1 establishes one deterministic projection from current Plan plus Ledger before U2 routes workflow and human surfaces through it. Both Steps share one user-decision outcome and one compatibility boundary. Historical adoption/migration and cross-host end-to-end acceptance require different data, review, and rollback semantics and remain P4.
- Scope pressure: High but cohesive: one persisted-authority read surface, command discoverability, runtime checkpoint routing, four role/HANDOFF contracts, package mirrors, and compatibility tests. The breadth is justified by one cross-surface authority invariant; no fixed file or review count is treated as a gate.
- Execution scope: Phase P3 only: workflow progression and successor handoff integration.
- Successor candidate: P4
- Successor preconditions: Phase P3 acceptance criteria pass; closed non-terminal Plans stop at the explicit user boundary after finish; revision/candidate/precondition facts match across runtime and HANDOFF projection; QA/review cannot approve; session-neutral and terminal controls pass; P2 transition tests remain green.
- Current-slice warning: This Plan does not prove Roadmap membership or topology, migrate the historical P1-to-P2 bootstrap, install a secret scanner, perform cross-host UAT, or implement automatic scheduling/session behavior.

## Output Language

- Human-readable prose: English
- Preserved literals: schema keys, CLI flags, paths, code identifiers, Phase IDs, and enum values remain exact English literals.

## Devil's Advocate Audit

### 1. Rollback Resilience

- U1 is a read-only successor projection and command-discoverability change built on the P2 follow-up's public revision field. Reverting U1 removes candidate output without changing persisted Ledger bytes or transition history, but operators would temporarily lose supported revision discoverability for later transitions; rollback verification must call this out rather than recommend manual hashing.
- U2 changes checkpoint routing and documentation contracts only. Reverting it restores the prior post-finish `complete` behavior without deleting P2-to-P3 transition evidence.
- No Step rewrites the historical P1-to-P2 bootstrap or adds a second state authority. If a committed P2-to-P3 transition later proves wrong, correction remains append-only rather than rollback-by-deletion.

### 2. Verification Vanity

- Presence checks are insufficient. Tests must construct closed contracted Plans and assert exact revision/projection values, Plan signature drift rejection, terminal controls, review priority, and no Ledger mutation from status/checkpoint reads.
- Workflow tests must cover both sides of `imm-finish`: existing Compounder handoff before intentional reset and `awaiting_user_successor_decision` after intentional reset.
- Contract tests must prove role passes cannot carry transition options and HANDOFF mirrors but does not authorize the command.

### 3. Spec Dilution Detection

- P3 cannot infer a successor Plan path from Phase metadata, auto-run Planner, or consume HANDOFF prose as authority.
- P3 cannot synthesize P1-to-P2 transition history, because declaration, validation, approval, and activation did not occur through the P2 command.
- P3 cannot absorb P4 migration, topology, cross-host UAT, progress UI, scanner installation, or upstream secret cleanup.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/runtime/state_ledger.ts` only if a pure projection helper belongs there, command manifest/help, source and packaged `imm-loop`/`imm-work`/`imm-qa`/`imm-code-review` contracts, canonical and packaged HANDOFF templates, and focused runtime/contract tests.
- compatibility: schema v2 and v3 remain readable; status and autowork reads are byte-identical; legacy and terminal Plans do not receive a fabricated successor decision; existing review and Compounder boundaries remain ordered.
- interruption recovery: U1 has no writer. U2 checkpoint reads remain deterministic. The only Plan activation write is the separately approved P2 transition performed before Step execution through existing lock/CAS semantics.
- rollback path: revert projection, routing, and docs together; never remove or rewrite transition/archive history.
- verification strength: isolated-root runtime tests assert exact payloads and state bytes; package/docs sync tests assert mirrors; role contract tests assert forbidden authority; full transition and workflow compatibility suites remain green.
- design-depth classification: High risk because user-visible workflow progression and approval authority cross runtime, roles, and persisted-state interpretation, even though P3 adds no new persistence schema.

## Steps

### Step 1

- Step ID: U1
- Result: Canonical revision-bound successor decision projection with complete transition grammar
- Discovery cache: `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`buildStatus`, `runWorkCommand`, `COMMAND_MANIFEST`, `runPlanCommand`, and approved-transition parser); `plugins/immune-brain/runtime/state_ledger.ts` (`buildLedgerRevision` and strict current-Plan identity); `tests/roadmap-plan-transition-runtime.test.ts` (approved transition fixtures and no-write assertions); `tests/plugin-package-runtime.test.ts` (CLI manifest/help parity)
- Files: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/runtime/state_ledger.ts` only if the pure projection helper belongs with revision primitives, `tests/roadmap-plan-progression-runtime.test.ts`, `tests/roadmap-plan-transition-runtime.test.ts`, `tests/plugin-package-runtime.test.ts`
- Verification: `bun test tests/roadmap-plan-progression-runtime.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/plugin-package-runtime.test.ts && git diff --check`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers status exposes a lowercase opaque revision without persisting it; Covers valid closed `roadmap-slice/v1` candidate projects current Plan, Phase, successor, preconditions, literal user authority, expected revision, and a structured placeholder target path safe for spaces or shell-significant characters; Covers current Plan reread/validation/signature drift fails with exit `1`, empty stdout, deterministic stderr, no partial revision/projection, and byte-identical Ledger; Covers active/review-pending context never implies transition eligibility; Covers terminal and legacy Plans omit successor approval; Covers manifest/help list every approval option and both accepted value forms; Covers status/help/manifest reads do not write Ledger, HANDOFF, session, or inbox files.
- failure_behavior: If successor facts cannot be derived without trusting stale HANDOFF prose, persisting approval-like state, or inferring a target path, stop and return to Planner. Malformed/missing/drifted current Plans must fail closed without changing authority bytes.
- security_considerations: Status may expose only canonical Plan identity, Phase/candidate/preconditions, opaque revision, and command grammar. It must not expose archived evidence, raw Plan contents, environment values, credentials, session data, or reusable approval.
- Depends on: none

### Step 2

- Step ID: U2
- Result: User-owned finished-Plan successor boundary
- Discovery cache: `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`runAutoworkCommand`, `buildAutoworkSnapshot`, review priority, and intentional-reset handling); `tests/imm-loop-completion-gate.test.ts` (review then Compounder ordering); `tests/imm-autowork-continuation-runtime.test.ts` (checkpoint authority payloads); `plugins/immune-brain/skills/imm-loop/SKILL.md` and packaged mirror (host loop stop contract); `docs/reference/HANDOFF-template.md` and packaged mirror (human projection boundary)
- Files: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/skills/imm-loop/SKILL.md`, `plugins/immune-brain/dist/imm-loop.md`, `plugins/immune-brain/skills/imm-work/SKILL.md`, `plugins/immune-brain/dist/imm-work.md`, `plugins/immune-brain/skills/imm-qa/SKILL.md`, `plugins/immune-brain/dist/imm-qa.md`, `plugins/immune-brain/skills/imm-code-review/SKILL.md`, `plugins/immune-brain/dist/imm-code-review.md`, `docs/reference/HANDOFF-template.md`, `plugins/immune-brain/dist/docs/reference/HANDOFF-template.md`, `tests/roadmap-plan-progression-runtime.test.ts`, `tests/roadmap-plan-progression-contract.test.ts`, `tests/imm-loop-completion-gate.test.ts`, `tests/imm-autowork-continuation-runtime.test.ts`, `tests/dist-docs-sync-contract.test.ts`
- Verification: `bun test tests/roadmap-plan-progression-runtime.test.ts tests/roadmap-plan-progression-contract.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/dist-docs-sync-contract.test.ts tests/roadmap-plan-transition-runtime.test.ts && bun scripts/sync-dist-docs.ts --check && git diff --check`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers closed/reviewed but unfinished Plan retains existing `complete` plus explicit Compounder handoff; Covers post-`imm-finish` non-terminal Plan emits `awaiting_user_successor_decision`, authority user, no automatic next skill, and exact projection; Covers review/follow-up/rework/replan priority over successor messaging; Covers terminal `none` and legacy controls; Covers identical Ledger/Plan bytes produce identical `imm-work status --json` and `imm-autowork --json` semantics across fresh runtime calls without session identity; Covers QA/review pass CLI rejects transition options and cannot persist successor approval/activation; Covers HANDOFF template mirrors projection and labels itself non-authoritative; Covers no automatic HANDOFF/session/inbox write.
- failure_behavior: If implementing the stop requires automatic Planner dispatch, implicit approval, a pending queue, session control, HANDOFF parsing, historical transition synthesis, or P4 topology/migration behavior, stop and return to Planner. Existing review and Compounder ordering must not regress.
- security_considerations: User-facing output must not leak evidence or credentials and must never make a placeholder command executable without a concrete validated successor path. Role contracts must keep literal user approval non-delegable.
- Depends on: 1

## Validation

- Focused status and progression verification: `bun test tests/roadmap-plan-progression-runtime.test.ts tests/roadmap-plan-progression-contract.test.ts`
- Activation evidence: after the supported P2 status revision is available, the approved P2-to-P3 command must upgrade the current Ledger to schema v3, append exactly one P2 archive plus one P2-to-P3 transition, install P3 Steps pending, preserve prior history, and leave no fabricated P1-to-P2 archive or transition.
- Complete compatibility matrix: contracted schema-v2 bootstrap to P3, existing schema-v3 histories, same-Plan sync, legacy terminal Plan, contracted terminal Plan, active/review/follow-up/rework/replan priority, pre-finish Compounder handoff, post-finish user stop, malformed/drifted current Plan, concurrent revision change, role-option rejection, session-neutral repeated reads, and no external writes.
- Existing transition compatibility: `bun test tests/roadmap-plan-transition-state.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/cross-plan-sync-reset.test.ts tests/runtime-state.test.ts`
- Existing workflow compatibility: `bun test tests/imm-loop-completion-gate.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/imm-follow-up-runtime.test.ts tests/plugin-package-runtime.test.ts tests/finish-dehydrate-runtime.test.ts`
- Package/docs parity: `bun test tests/dist-docs-sync-contract.test.ts && bun scripts/sync-dist-docs.ts --check`
- Plan validation: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-29-001-feat-roadmap-plan-boundary-successor-phase3-plan.md --json`
- Static checks: primary TypeScript LSP on changed runtime/tests and `git diff --check`

## Roadmap Continuation

- Completed predecessor: P2 transition substrate and explicit approval command are closed, reviewed, and intentionally reset.
- Activation boundary: Before Plan sync, close the P2 same-boundary revision-status follow-up and its reopened review gate without emitting a duplicate finish. Then read `ledger_revision` from `imm-work status --json` and activate this validated Plan once through `imm-plan <P3-plan> --sync --approve-successor --expected-current-plan <P2-plan> --expected-ledger-revision <revision>`. Record the exact schema-v3 archive/transition assertions as Plan-level activation evidence before U1.
- Deferred successor: P4 compatibility and end-to-end acceptance, including historical bootstrap/migration policy, cross-host UAT, interrupted/correction/terminal scenarios, Roadmap membership/topology, and optional progress views.

## Notes

- The P1-to-P2 bootstrap gap is preserved as historical compatibility evidence; P3 does not backfill or rewrite it.
- The user's current request confirms P3 scope and progression but does not authorize future P3-to-P4 activation.
- `imm-compounder` remains an explicit handoff and is not invoked automatically by this Plan.
