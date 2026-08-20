# Iteration Plan

## Task

- Summary: Preserve the complete still-dirty implementation surface when an explicitly user-superseded Plan is replaced after partial implementation.
- Origin: Feedback Hosted Portal E1 U2 was legitimately superseded to add a missing verification owner. Most U2 implementation files were dirty before replacement activation. After additional edits, `imm-work record-execution` would replace the complete claimed 19-file surface with a 13-file post-activation delta, omitting migration metadata, resolver, route, runbook, and test registration files from final review.
- Spec: `docs/specs/2026-08-13-002-terminated-replacement-evidence-carry-forward.spec.md`
- Research: `changedFilesSinceSnapshot` correctly derives post-activation changes; `commands/work.ts` unconditionally replaces claims whenever that set is non-empty; terminated Plan records preserve a runtime-owned literal-user authority fact and predecessor path while the v1 termination digest detects partial drift but is not a user signature; replacement Plan snapshots may declare `task.superseded_predecessor`; Scope checks already fail closed after changed-file selection.
- Decisions: D1 gate carry-forward on matching current replacement metadata plus the latest runtime-owned user-authorized `superseded` termination with a valid v1 drift-detection digest. D2 union only strictly canonicalized claimed files that were dirty at activation and remain dirty in one current Git snapshot. D3 use that same snapshot both to derive the authorized final set and to persist `workspace_evidence_snapshot`. D4 keep ordinary Plan, missing baseline, and HEAD-drift evidence-selection behavior unchanged while persisting the authorized helper's single snapshot. D5 preserve current Scope validation and post-evidence mutation guards. D6 rebuild provenance in runtime. D7 add no schema migration, archive traversal, CLI flag, or historical rewrite.
- Assumptions: Replacement implementation remains uncommitted across predecessor termination and successor activation. The replacement Scope names every inherited implementation path. Newly granted carry-forward authority can require v1 termination digest re-derivation without changing legacy terminal projections.
- Plan boundary: One execution-evidence authority correction across State Ledger termination verification, workspace snapshot helpers, `record-execution`, regression tests, and the validate-only recovery documents.
- Boundary rationale: Replacement authorization and evidence union must ship together; either alone would permit false inheritance or incomplete review.
- Scope pressure: Low and cohesive: State Ledger authority verification, one helper module, one command handler, their runtime wiring, tests, and recovery documents.

## Output Language

- Human-readable Spec and Plan prose: English.
- User-facing replies: Chinese.
- Preserved literals: `Plan`, `Step`, `State Ledger`, `superseded_predecessor`, `changed_files`, and code identifiers.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Runtime and tests revert together without rewriting State Ledger history or downstream evidence.
- Additive provenance values are evidence metadata; older readers preserve them as ordinary fields.

### 2. Verification Vanity

- A unit test of set union is insufficient. Black-box tests must sync/activate a replacement fixture, mutate only a subset after activation, invoke `record-execution`, and inspect persisted evidence.
- Negative fixtures must prove ordinary and forged Plans do not inherit activation-baseline dirt.

### 3. Spec Dilution Detection

- The fix does not infer replacement from dirty files alone.
- The fix does not inherit archived or committed predecessor changes.
- The fix does not weaken Scope checks or allow caller-selected replacement authority.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/workspace_scope.ts`, `plugins/immune-brain/runtime/commands/work.ts`, runtime-owned helper wiring only if required, `tests/workspace-snapshot-persistence.test.ts`, package mirrors, and this Spec/Plan.
- compatibility: ordinary Plan evidence derivation, missing baseline fallback, HEAD drift fallback, and post-evidence mutation rejection remain unchanged.
- interruption recovery: evidence selection is computed before the existing atomic State Ledger commit; any mismatch rejects without state mutation.
- rollback path: revert runtime/tests/recovery documents; preserve terminated/replacement histories.
- verification strength: black-box Git fixtures, exact evidence unions, negative authority matrix, existing execution/review suites, full repository tests, Plan validation, and `git diff --check`.
- design-depth classification: High because changed-file evidence authorizes QA and final review.
- Technical Design baseline: Spec sections 3.1-3.3 own replacement authority, evidence union, provenance, and compatibility.
- session neutrality: carry-forward eligibility derives from runtime-owned persisted Plan/termination facts under the existing `.imm/memory/` trust boundary and from one current Git snapshot.

## Steps

### Step 1

- Step ID: U1
- Result: Authorized terminated replacement Plans produce a complete scope-checked review surface.
- Verification type: automated
- Execution note: test-first
- Discovery cache: `plugins/immune-brain/runtime/workspace_scope.ts` (`captureGitWorkspaceSnapshot`, `changedFilesSinceSnapshot`); `plugins/immune-brain/runtime/commands/work.ts` (`record-execution`); `plugins/immune-brain/runtime/state_ledger.ts` (`terminateCurrentPlan`); `tests/workspace-snapshot-persistence.test.ts` (Git fixture and evidence guards); `docs/specs/2026-08-13-002-terminated-replacement-evidence-carry-forward.spec.md` (Technical Design authority)
- Scope: `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/workspace_scope.ts`, `plugins/immune-brain/runtime/commands/work.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `tests/workspace-snapshot-persistence.test.ts`, `tests/execution-evidence-runtime.test.ts`, `tests/replan-recovery-runtime.test.ts`, `tests/roadmap-plan-transition-runtime.test.ts`, `tests/plugin-package-runtime.test.ts`, `docs/specs/2026-08-13-002-terminated-replacement-evidence-carry-forward.spec.md`, `docs/plans/2026-08-13-002-fix-terminated-replacement-evidence-carry-forward-plan.md`
- Verification: `bun test tests/workspace-snapshot-persistence.test.ts tests/execution-evidence-runtime.test.ts tests/replan-recovery-runtime.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/plugin-package-runtime.test.ts && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-13-002-fix-terminated-replacement-evidence-carry-forward-plan.md --json && git diff --check`
- Test scenarios: Covers matching latest user-superseded termination plus replacement metadata; Covers mixed post-activation delta and still-dirty predecessor claims; Covers ordinary Plan, forged metadata, cancelled/non-user/mismatched/stale termination isolation; Covers cleaned/missing files exclusion; Covers scope-external carry-forward rejection; Covers provenance visibility; Covers unchanged HEAD-drift and no-baseline fallback; Covers post-evidence mutation rejection; Covers focused and full regression.
- failure_behavior: If complete evidence cannot be derived from persisted termination authority plus current Git snapshots without trusting arbitrary claims, stop and return to Planner. Never narrow review silently.
- security_considerations: Changed files authorize independent review. Derive replacement eligibility from runtime-owned persisted facts, canonicalize and intersect claims with Git-observed dirty paths from one snapshot, reuse that exact snapshot as the QA mutation-guard baseline, and apply Scope after union. The termination digest detects partial drift but is not authority against direct ledger writers.
- Depends on: none

## Validation

- Focused: `bun test tests/workspace-snapshot-persistence.test.ts tests/execution-evidence-runtime.test.ts tests/replan-recovery-runtime.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/plugin-package-runtime.test.ts`
- Full regression: `bun test`
- Plan validation: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-13-002-fix-terminated-replacement-evidence-carry-forward-plan.md --json`
- Static: `git diff --check`
- Downstream acceptance: in nextty.dev, record Feedback E1 U2 evidence and confirm `review_changed_files` includes the complete 19-file product delta before QA/review.

## Notes

- This recovery is implemented only in `/tmp/immune-brain-replacement-evidence` and does not sync over the source repository's active Kernel Plan.
- The current package executes canonical TypeScript runtime source directly through `plugins/immune-brain/bin/*`; no `dist/runtime/immune_brain_runtime.js` artifact exists or is introduced.
- The nextty.dev U2 implementation remains frozen until this runtime authority fix is reviewed and integrated.
