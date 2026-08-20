# Iteration Plan

## Task

- Summary: Restore legal sequential Plan continuation inside one Roadmap Phase and require final review over the Phase's cumulative changed-file evidence.
- Origin: The nextty.dev Feedback E1 Roadmap split one Phase into U1, U2, and U3 Plans. Finished Plan 005 truthfully declares E2 as its future Phase candidate, so the current runtime rejects E1 U2 as neither the candidate Phase nor a terminated replacement. Advisory review also proved that current-Plan-only review collection would omit U1's 29-file evidence from final E1 review.
- Spec: `docs/specs/archive/2026-08-13-roadmap-same-phase-continuation.spec.md`
- Research: `roadmap-slice/v1` validation intentionally rejects self-successors; approved transition runtime currently accepts only candidate-to-successor Phase equality for finished Plans; State Ledger v3 already persists whitelisted predecessor archives and linear transition records; current review collection reads only current Steps plus marker-visible current follow-ups; prior cross-Plan isolation intentionally clears passes and excludes old follow-ups. The recovery can therefore use explicit transition kinds, a new integrity-protected identity for explicit records, and archive-chain projection without changing Plan metadata, schema version, or historical records.
- Decisions: D1 preserve `Successor candidate` as the next Roadmap Phase and keep self-successor validation. D2 derive same-Phase continuation from equal current Phase plus equal future candidate under the existing Roadmap-source and explicit-user transition boundary. D3 persist a runtime-derived `transition_kind` on new transition records and never infer continuation for legacy records. D4 issue new explicit-kind transitions under a v2 identity domain covering every immutable authority fact, while preserving legacy kind-less v1 records byte-for-byte. D5 collect cumulative review files only along the contiguous explicit `same_phase_continuation` chain ending at the current Plan. D6 reset review passes on every transition; continuation enlarges the new signature, while Phase advance and terminated replacement retain fresh current-Plan scope. D7 keep schema v3 and backwards-compatible unknown-field preservation; do not migrate or rewrite archives, transitions, Plans, or downstream ledgers. D8 fail closed on kind/identity inconsistency, ambiguous incoming edges, missing/mismatched archive references, or cycles. D9 update canonical vocabulary and planning guidance only; no packaged role change is needed because execution/QA authority and CLI grammar remain unchanged.
- Assumptions: Closed Plan archives contain normalized closed Step and current-Plan follow-up execution evidence. Transition history remains append-only and linear under existing duplicate guards. Existing schema-v3 readers preserve unknown transition fields. The user's confirmation authorizes this isolated recovery implementation but does not authorize editing the dirty source worktree or downstream nextty ledger.
- Plan boundary: One runtime authority fix spanning transition eligibility, explicit persisted kind, cumulative review projection, canonical documentation, and regression evidence.
- Boundary rationale: Same-Phase activation without cumulative review would create an unsafe partial fix, while cumulative review without explicit transition semantics could inherit unrelated history. Both behaviors share one State Ledger authority boundary, one rollback unit, and one acceptance matrix.
- Scope pressure: Medium and cohesive: two runtime modules, canonical vocabulary/guidance, focused fixtures/tests, and broad regression suites. No host adapter, State Ledger migration, Plan parser grammar, or downstream project file belongs in this slice.

## Output Language

- Human-readable Spec and Plan prose: English.
- User-facing replies: Chinese.
- Preserved literals: `Plan`, `Phase`, `Step`, `State Ledger`, `Successor candidate`, `transition_kind`, enum values, paths, commands, and code identifiers.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Runtime and tests form one coherent rollback. Existing explicit records containing the additive kind and v2 identity remain readable by older schema-v3 runtimes as unknown fields; rollback restores current-Plan-only review collection without deleting history.
- The atomic transition commit owns archive, kind, and successor installation. Any failure before commit leaves the predecessor ledger byte-identical; a failure after commit follows ordinary successor rework and never deletes the transition.
- Documentation can be reverted with runtime behavior, but historical Specs/Plans and downstream ledgers remain untouched.

### 2. Verification Vanity

- A validator-only test cannot prove continuation. Focused tests must execute three explicit approved transitions, close evidence, inspect persisted kinds, assert exact cumulative signatures, and prove the following Phase resets scope.
- Presence of archive paths is insufficient. Tests must corrupt archive refs, create duplicate incoming edges/cycles, and assert review collection throws rather than silently narrowing scope.
- Existing transition and review suites must remain green, and the full suite must run because `collectReviewChangedFiles` feeds finish, review, follow-up, Compounder, and autowork decisions.

### 3. Spec Dilution Detection

- The fix does not redefine `Successor candidate` as a Plan pointer or permit self-successor metadata.
- It does not treat terminated replacement, Phase equality in legacy history, or matching file signatures as continuation authority.
- It closes both confirmed failures: legal U1-to-U2-to-U3 activation and final cumulative review. Shipping only one fails the Spec.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/imm_core.ts` only if export parity requires it, transition/review tests, fixture Plans, `CONTEXT.md`, and `docs/reference/planning-quality-gate.md`.
- compatibility: Plan validation and CLI grammar remain unchanged; schema v3 and old records remain readable; legacy kind-less edges, Phase advances, terminated replacements, and ordinary cross-Plan isolation do not inherit evidence.
- interruption recovery: lock-time kind rederivation and existing CAS commit prevent partial transition facts. Review collection is read-only and fails before gate/finish mutations on malformed history.
- rollback path: revert runtime, focused tests/fixtures, and canonical docs together; never delete persisted histories or rewrite closed Plans.
- verification strength: black-box approved transitions, direct state primitive corruption tests, exact file unions/signatures, byte-preservation assertions, focused compatibility suites, full repository tests, Plan validation, and `git diff --check`.
- design-depth classification: High because the change affects persisted transition authority and reviewer authorization scope.
- Technical Design baseline: Spec sections 3.1-3.5 own metadata, kind, integrity identity, traversal, compatibility, and failure semantics. Any schema bump, caller-selected kind, inferred legacy continuation, or historical transition rewrite returns to Planner.
- Mermaid intent: the Spec flowchart distinguishes the cumulative continuation chain from fresh-scope boundaries.
- session neutrality: all semantics derive from persisted Plan/State Ledger bytes and literal transition commands, never session state.

## Steps

### Step 1

- Step ID: U1
- Result: Same-Phase Plan continuation with cumulative review authority
- Verification type: automated
- Execution note: test-first
- Discovery cache: `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`isApprovedTransitionPhase`, `runApprovedTransition`, lock-time reconstruction); `plugins/immune-brain/runtime/state_ledger.ts` (`buildClosedPlanArchive`, `buildTransitionRecord`, `validateTransitionState`, `collectReviewChangedFiles`); `tests/roadmap-plan-transition-runtime.test.ts` (approved-transition fixtures and no-write matrix); `tests/roadmap-plan-transition-state.test.ts` (archive/transition integrity and linear history); `tests/imm-loop-review-lifecycle-state.test.ts` and `tests/cross-plan-sync-reset.test.ts` (review-scope isolation); `docs/specs/archive/2026-08-13-roadmap-same-phase-continuation.spec.md` (Technical Design authority)
- Scope: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/imm_core.ts`, `tests/fixtures/roadmap-transition/`, `tests/roadmap-plan-transition-runtime.test.ts`, `tests/roadmap-plan-transition-state.test.ts`, `tests/imm-loop-review-lifecycle-state.test.ts`, `tests/cross-plan-sync-reset.test.ts`, `tests/imm-follow-up-runtime.test.ts`, `tests/imm-loop-completion-gate.test.ts`, `tests/roadmap-plan-progression-runtime.test.ts`, `tests/progress-projection-runtime.test.ts`, `tests/plugin-package-runtime.test.ts`, `tests/state-ledger-migration.test.ts`, `plugins/immune-brain/tests/plan-transition-termination.test.ts`, `CONTEXT.md`, `docs/reference/planning-quality-gate.md`, `plugins/immune-brain/dist/docs/reference/planning-quality-gate.md`
- Verification: `bun test tests/roadmap-plan-transition-runtime.test.ts tests/roadmap-plan-transition-state.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/cross-plan-sync-reset.test.ts tests/imm-follow-up-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/roadmap-plan-progression-runtime.test.ts tests/plugin-package-runtime.test.ts tests/state-ledger-migration.test.ts && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-13-001-fix-roadmap-same-phase-continuation-plan.md --json && git diff --check`
- Test scenarios: Covers finished U1-to-U2 and U2-to-U3 same-Phase transitions with equal future candidate; Covers persisted kinds and v2 integrity IDs for continuation, Phase advance, and terminated replacement; Covers candidate drift rejection before and under lock; Covers exact U1+U2+U3 cumulative changed files and stale pass invalidation; Covers Phase advance, terminated replacement, and legacy kind-less fresh scope; Covers archive-ref/path/signature mismatch, duplicate incoming edge, unknown/inconsistent kind, multi-field identity tampering, and cycle fail-closed behavior; Covers legacy closed follow-ups with `null` execution evidence in both current scope and continuation archives (contributing nothing, never blocking) and present-but-malformed changed_files failing closed; Covers transition failure byte identity; Covers existing parser self-successor rejection and Phase-advance behavior; Covers full repository regression.
- failure_behavior: If cumulative scope cannot be derived from existing whitelisted archives without schema migration, caller input, historical backfill, or recursive evidence copying, stop and return to Planner. Malformed history must reject before review, finish, follow-up, Compounder, or autowork can consume a narrowed set.
- security_considerations: Transition kind and archived evidence affect review authority. Derive kind only from lock-time canonical Plan metadata, resolve only whitelisted archive Step/follow-up evidence, and reject ambiguity rather than choosing an edge or dropping files.
- Depends on: none

## Validation

- Focused runtime and authority: `bun test tests/roadmap-plan-transition-runtime.test.ts tests/roadmap-plan-transition-state.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/cross-plan-sync-reset.test.ts tests/imm-follow-up-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/roadmap-plan-progression-runtime.test.ts tests/plugin-package-runtime.test.ts tests/state-ledger-migration.test.ts`
- Full regression: `bun test`
- Plan validation: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-13-001-fix-roadmap-same-phase-continuation-plan.md --json`
- Static checks: TypeScript diagnostics for changed runtime/tests and `git diff --check`.
- Downstream acceptance after merge: in nextty.dev, validate E1 U2 with `Current phase: feedback-hosted-portal` and `Successor candidate: feedback-hosted-portal-session-submit`, then use a fresh `imm-work status --json` revision plus literal user approval to activate it from Plan 005 without editing Plan 005 or its closed ledger.

## Notes

- The implementation runs only in the isolated `/tmp/immune-brain-roadmap-continuation` worktree/branch. The dirty source worktree and nextty.dev worktree remain unchanged until the recovery is reviewed and integrated.
- User confirmation authorizes recovery implementation, not downstream U2 activation. A fresh downstream revision and explicit transition command remain required.
- No compatibility layer is introduced: the additive kind is permanent transition truth, and legacy kind-less records intentionally remain non-inheriting.
