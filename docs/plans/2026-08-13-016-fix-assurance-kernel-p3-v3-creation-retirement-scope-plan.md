# Plan: Assurance Kernel P3 v3 Creation Retirement Scope Repair

**plan_format**: v2
**Plan ID**: 2026-08-13-016
**Type**: fix
**Workflow profile**: strict
**Compounder**: required
**Created**: 2026-08-13
**Status**: pending
**Priority**: P1
**Spec**: docs/specs/assurance-kernel-v4-p3-v3-creation-retirement.spec.md
**Predecessor**: docs/plans/2026-08-13-015-feat-assurance-kernel-p3-v3-creation-retirement-plan.md (U1 closed; U2 scope repair required; superseded before sync)

## Goal

Close the existing Assurance Kernel P3 v3-creation retirement implementation by repairing the immutable U2 Scope to include the two test owners that the U2 manifest/layout changes necessarily update — `tests/kernel-r2a-boundary.test.ts` (exact `imm-kernel` subcommand list) and `tests/pi-canary-discovery-regression.test.ts` (extension directory layout after the shared parser extraction) — without changing P3 behavior, the retirement policy contract, or the Pi-only enrollment boundary.

## Task

Replace only predecessor Step U2. Predecessor U1 remains closed evidence for the routing-policy guard and is not repeated by this Plan. Predecessor U3 (policy activation) has not executed and is retained unchanged as this Plan's second Step.

## Output Language

Spec and Plan prose use English. Schema fields, CLI commands, file paths, JSON keys, enum values, Step IDs, and contract identifiers remain literal.

## Origin

Strict execution on predecessor Plan `2026-08-13-015` completed U1 (routing-policy guard, QA pass) and implemented U2 (TaskIntent author/validate, shared verification parser, Planner contract) with all focused and full-suite tests green. Recording U2 execution evidence was rejected by the runtime: `tests/kernel-r2a-boundary.test.ts` and `tests/pi-canary-discovery-regression.test.ts` are changed by U2's manifest/layout updates but are outside the immutable U2 Scope. The predecessor U2 is therefore structurally uncloseable and the Plan was superseded under `boundary_error`; this replacement repairs Scope ownership only.

## Research

- Predecessor U1 is `closed`; replacement work must not recreate or mutate its Plan contract.
- `tests/kernel-r2a-boundary.test.ts` asserts the exact `imm-kernel` subcommand list from the canonical manifest; U2 adds `intent` as a legal subcommand, so this assertion must include it.
- `tests/pi-canary-discovery-regression.test.ts` copies the extension directory into a scratch package; after U2 moved `verification_descriptor/v1` parsing into the shared runtime module, `pi-canary-verification.ts` re-exports `../runtime/verification_descriptor`, so the scratch package must mirror the whole plugin tree.
- Both files are the direct downstream assertions of U2's canonical command surface and shared-parser extraction; they are not unrelated cleanup.
- No other owner was found outside Scope: the U2 focused Verification (18 files), extension `tsc`, dist-docs sync, and full `bun test` all pass with these two files updated.
- Existing P3 Spec behavior and Technical Design remain valid; this is a Plan boundary repair, not a Spec change.

## Decisions

1. Reuse the unchanged P3 Spec and current partial implementation.
2. Replace only predecessor U2 with one independently closable Step; do not copy predecessor U1 into the replacement Plan.
3. Add exactly `tests/kernel-r2a-boundary.test.ts` and `tests/pi-canary-discovery-regression.test.ts` to the predecessor U2 Scope and focused Verification.
4. Retain predecessor U3 unchanged as this Plan's Step 2 with the same Scope, Verification, execution note, failure behavior, and dependency on U2.
5. Do not inherit predecessor execution attempts, QA decisions, or review-gate evidence; rerun all verification fresh under this Plan.
6. Preserve the Pi TUI-only enrollment boundary: default `/imm-canary-new` and explicit-waiver `/imm-canary-enroll`; no other host surface may enroll.

## Assumptions

- The current working-tree implementation remains the intended P3 implementation baseline.
- The two confirmed omitted owners are the complete Scope delta required to close predecessor U2.
- Predecessor U1 behavior remains available and is covered by cumulative verification rather than repeated execution.
- The retirement policy is not installed until U3; until then the live workspace reports `legacy_v3` routing status.

## Plan Boundary

This Plan is one coherent replacement slice: the host-neutral TaskIntent authoring-validation contract, its shared parser consumers, the Planner routing contract, and the two downstream test owners share one authority, verification, rollback, and review boundary; then the retained U3 activates the exact reviewed policy bytes. Enrollment authority, v3 storage, and terminal-import decisions remain outside this repair.

## Boundary Rationale

The two added owners are not independent cleanup. They are exact assertions over the U2 canonical command surface and the extension directory layout that U2 necessarily changes; without them the recorded Verification cannot close. Splitting them would leave the authoring Step unverifiable, while widening into enrollment or storage work would cross a separate boundary.

## Scope Pressure

The Step spans the Kernel intent command surface, shared parser, Pi extension consumers, Planner contract, and two manifest/layout assertion owners. Retain one Step because these files jointly prove one published authoring-validation contract and roll back as one unit; the retained U3 stays a separate activation Step because policy bytes must not be staged before the planning route is verified.

## Devil's Advocate Audit

- **Rollback resilience**: The replaced U2 rolls back with the shared parser, canonical command surface, Planner contract, and both assertion owners; no TaskRecord or claim exists to migrate. The retained U3 remains the explicit project transition: if interrupted, exact staged policy bytes keep new v3 sync retired while the already-owned Plan remains work/review/finish-capable.
- **Verification vanity**: File-existence checks are only prerequisites. Focused tests must fail on pre-migration writes, stdin overread or accidental stdin reads by other commands, non-canonical author output, overwrite/symlink races, parser divergence, alternate enrollment surfaces, manifest drift (including the exact `imm-kernel` subcommand list), and extension layout drift. U3 additionally binds exact bytes to a fixed hash in both worktree and index.
- **Spec dilution detection**: P3 still delivers all parent obligations: stop new v3 authority, retain legacy drain/read-only projection, and decide terminal import. The replacement TaskIntent planning path remains executable, privileged enrollment stays Pi-only, and no requirement is narrowed.

## Steps

### Step 1

- Step ID: U2
- Result: Kernel TaskIntent planning has one host-neutral authoring-validation contract.
- Scope: `plugins/immune-brain/runtime/kernel/intent.ts`; `plugins/immune-brain/runtime/verification_descriptor.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/bin/imm-kernel`; `plugins/immune-brain/.pi-extension/pi-canary-verification.ts`; `plugins/immune-brain/.pi-extension/pi-canary-child.ts`; `plugins/immune-brain/.pi-extension/imm-canary-work.ts`; `plugins/immune-brain/.pi-extension/imm-canary-new.ts`; `plugins/immune-brain/.pi-extension/imm-canary-enroll.ts`; `plugins/immune-brain/.pi-extension/runtime-stub.ts`; `plugins/immune-brain/.pi-extension/tsconfig.json`; `plugins/immune-brain/skills/imm-planner/SKILL.md`; `plugins/immune-brain/dist/imm-planner.md`; `tests/kernel-intent-authoring.test.ts`; `tests/kernel-intent-validation.test.ts`; `tests/kernel-verification-descriptor.test.ts`; `tests/kernel-shadow-cli.test.ts`; `tests/kernel-r2c1-boundary.test.ts`; `tests/kernel-r2a-boundary.test.ts`; `tests/pi-canary-discovery-regression.test.ts`; `tests/pi-canary-verification-descriptor.test.ts`; `tests/pi-canary-child-authority.test.ts`; `tests/pi-canary-work-extension.test.ts`; `tests/pi-canary-new-extension.test.ts`; `tests/pi-canary-enroll-extension.test.ts`; `tests/pi-canary-package-boundary.test.ts`; `tests/imm-planner-kernel-intent-contract.test.ts`; `tests/plugin-package-runtime.test.ts`; `tests/host-runtime-cutover.test.ts`; `plugins/immune-brain/tests/skill-registry-consistency.test.ts`; `tests/skill-registry-metadata-contract.test.ts`
- Verification: `test -f plugins/immune-brain/runtime/verification_descriptor.ts && test -f tests/kernel-intent-authoring.test.ts && test -f tests/kernel-intent-validation.test.ts && test -f tests/kernel-verification-descriptor.test.ts && test -f tests/imm-planner-kernel-intent-contract.test.ts && rg -q 'imm-canary-enroll\.ts' plugins/immune-brain/.pi-extension/tsconfig.json && rg -q 'imm-canary-new\.ts' plugins/immune-brain/.pi-extension/tsconfig.json && rg -q 'imm-canary-work\.ts' plugins/immune-brain/.pi-extension/tsconfig.json && rg -q 'runtime-stub\.ts' plugins/immune-brain/.pi-extension/tsconfig.json && bun test tests/kernel-intent-authoring.test.ts tests/kernel-intent-validation.test.ts tests/kernel-verification-descriptor.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-r2c1-boundary.test.ts tests/kernel-r2a-boundary.test.ts tests/pi-canary-discovery-regression.test.ts tests/pi-canary-verification-descriptor.test.ts tests/pi-canary-child-authority.test.ts tests/pi-canary-work-extension.test.ts tests/pi-canary-new-extension.test.ts tests/pi-canary-enroll-extension.test.ts tests/pi-canary-package-boundary.test.ts tests/kernel-intent-v2.test.ts tests/imm-planner-kernel-intent-contract.test.ts tests/plugin-package-runtime.test.ts tests/host-runtime-cutover.test.ts plugins/immune-brain/tests/skill-registry-consistency.test.ts tests/skill-registry-metadata-contract.test.ts tests/dist-docs-sync-contract.test.ts && bun x tsc --noEmit -p plugins/immune-brain/.pi-extension/tsconfig.json && bun scripts/sync-dist-docs.ts --check && bun test && git diff --check`
- Execution note: test-first; implement author and validate behind the canonical `imm-kernel` wrapper/manifest/help surface. Only the exact author branch with explicit `--stdin` may synchronously read bounded file descriptor 0; all other commands must remain non-blocking and stdin-independent. Author must require active Kernel planning routing with no existing managed owner, canonicalize through the shared parser, and exclusively create one destination without parent creation, overwrite, Git staging, enrollment, or workflow-state/journal writes; validate remains zero-write. U2 positive authoring tests install the exact active policy only inside isolated Git fixtures because the live P3 workspace still has v3 ownership. Move strict `verification_descriptor/v1` parsing into the shared runtime module, make all direct Pi consumers import that implementation, and retain at most stable type/parser re-exports from `pi-canary-verification.ts`; Pi-only runner resolution and execution remain extension-owned. Focused import-boundary tests must prove there is no second parser implementation. Preserve the exact Pi enrollment command set and authority split: default no-waiver `/imm-canary-new` and explicit-waiver `/imm-canary-enroll`; both remain TUI-only and no other host surface may enroll. Update the R2C1 canonical CLI boundary so it still rejects lifecycle/authority mutation commands while explicitly allowing bounded Intent author/validate. Package tests must assert exact subcommands, args, examples, wrapper smoke, updated non-shadow-only description, and no RPC/OpenCode enrollment or authoring surface. Update the R2A exact manifest assertion and the extension discovery regression layout to the U2 surface.
- Test scenarios: Covers bounded fd 0 candidate input and oversize-before-parse rejection; Covers help/validate/pre-existing subcommands never reading stdin; Covers missing/invalid policy, active Kernel claim, nonterminal v3 owner, and destination-parent rejection before file creation; Covers strict schema, task/path mismatch, descriptor shell/runner/version/argv/cwd bounds, and duplicate acceptance IDs; Covers deterministic descriptor and TaskIntent canonical bytes; Covers exclusive regular-file creation, existing-file preservation, symlink/parent-swap rejection, and destination-only byte delta; Covers tracked/untracked validation and complete zero-write snapshots; Covers one parser implementation consumed by Pi child/new/enroll/work paths; Covers exact two-command Pi enrollment surface with no-waiver and waiver authority separation; Covers canonical manifest/help/wrapper with the exact `imm-kernel` subcommand list; Covers extension discovery layout after the shared parser extraction; Covers no non-Pi enrollment surface.
- failure_behavior: Any policy, owner, stdin, schema, descriptor, path, or exclusive-create ambiguity rejects without fallback, parent creation, overwrite, journal, workflow-state, or Git-index write. If canonical authoring cannot remain one-file atomic behind the existing synchronous router, stop and return to Planner instead of adding a second entrypoint or direct Skill write.
- security_considerations: Candidate JSON and paths are untrusted. Bind canonical project root, exact task ID/path, no-symlink parent and destination identity, bounded stdin, strict duplicate/unknown-field rejection, deterministic accepted bytes, and no authority capability or enrollment function on the CLI surface.
- Verification type: automated
- Depends on: none

### Step 2

- Step ID: U3
- Result: Exact reviewed policy bytes are the sole staged active route for new managed authority.
- Scope: `docs/plans/managed-task-routing-policy.json`; `docs/specs/assurance-kernel-v4-p3-v3-creation-retirement.spec.md`; `docs/plans/2026-08-13-015-feat-assurance-kernel-p3-v3-creation-retirement-plan.md`; `docs/plans/2026-08-13-016-fix-assurance-kernel-p3-v3-creation-retirement-scope-plan.md`; `docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md`; `tests/v3-retirement-live-boundary.test.ts`; `tests/legacy-v3-projection.test.ts`; `HANDOFF.md`
- Verification: `test -f docs/plans/managed-task-routing-policy.json && git ls-files --error-unmatch docs/plans/managed-task-routing-policy.json && test "$(git diff --cached --name-only)" = 'docs/plans/managed-task-routing-policy.json' && shasum -a 256 docs/plans/managed-task-routing-policy.json | grep -q '^43949f0ef456efb9ca7dccbe1c8bc2355d6acce66486213fb2750a87388ec71e ' && git show :docs/plans/managed-task-routing-policy.json | shasum -a 256 | grep -q '^43949f0ef456efb9ca7dccbe1c8bc2355d6acce66486213fb2750a87388ec71e ' && test -f tests/v3-retirement-live-boundary.test.ts && test -f tests/legacy-v3-projection.test.ts && bun test tests/v3-retirement-live-boundary.test.ts tests/legacy-v3-projection.test.ts tests/v3-plan-creation-retirement.test.ts tests/managed-task-routing-policy.test.ts tests/progress-projection-runtime.test.ts tests/plan-execution-boundary-runtime.test.ts tests/execution-evidence-runtime.test.ts tests/roadmap-plan-terminal-runtime.test.ts plugins/immune-brain/tests/plan-transition-termination.test.ts tests/project-migration-cli.test.ts && plugins/immune-brain/bin/imm-plan --routing-status --json | grep -q '"v3_new_plan_sync": "retired"' && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-13-015-feat-assurance-kernel-p3-v3-creation-retirement-plan.md --json && bun test && git diff --check`
- Execution note: Write exactly the canonical policy bytes from the Technical Design, verify the fixed SHA-256, then run only `git add -- docs/plans/managed-task-routing-policy.json`. Do not commit and do not stage the Spec, Plan, HANDOFF, source, or test paths. Before QA handoff, prove the cached diff contains exactly the policy path and both worktree/index hashes equal the fixed hash. The live-boundary test must install the same active policy in an isolated Git fixture, invoke canonical `runImmCommand("imm-finish", ...)` against a finish-eligible P3-shaped Ledger, prove `idle + intentional_reset`, and prove both policy hashes and staged bytes are unchanged; direct `runFinishCommand` alone is insufficient.
- Test scenarios: Covers exact canonical policy serialization and fixed worktree/index hash; Covers sole staged-path invariant; Covers same-identity P3 work/QA/review before closure; Covers canonical dispatch `imm-finish` with active policy reaching intentional reset; Covers policy/index bytes unchanged across finish; Covers different-identity sync still retired after reset; Covers active, finished, malformed, and historical legacy projection; Covers explicit no terminal-import module, command, TaskRecord, or compatibility writer.
- failure_behavior: Any hash mismatch, index/worktree drift, additional staged path, failed routing status, canonical finish rejection, policy mutation across finish, or post-QA workspace byte change blocks closure. Restore only the fixed policy bytes; for any other changed byte, record a fresh U3 execution attempt over the final workspace, rerun U3 QA, and rerun final full-diff review before closure. Never bypass the guard, unstage another user's path, or synthesize terminal history.
- security_considerations: The Git index mutation is an explicit integration action limited to one named path. The executor must prove exact cached content and preserve all other staged/worktree state; the runtime still has no Git mutation authority.
- Verification type: automated
- Depends on: 1

## Plan Closure Verification

After Step 2 records execution evidence and passes QA, run the final full-diff `imm-code-review`, then treat that reviewed workspace as frozen. Rerun both fixed SHA-256 checks, prove the cached diff still contains only the policy path, and rerun `imm-plan --routing-status --json` immediately before `imm-finish`. The existing review gate is bound only to its normalized changed-file set, so this Plan does not claim automatic content-digest invalidation for arbitrary source files. Operationally, any workspace-byte change after U3 QA or final review blocks closure and requires a fresh U3 execution attempt covering the final changed-file set, fresh U3 QA, and a fresh final full-diff review. Exact policy-byte authority remains independently frozen by the immutable Spec/Plan hash and immediate worktree/index checks. Any policy-byte drift, invalid status, additional staged path, or missing staged path also stops closure.
