# S3: 弹性 Scope 与完整交付验收

**Status**: Approved Initiative child; candidate for native Enrollment only after canonical validation.
**Design risk**: High — shared contract, persistence, authority or evidence boundaries.
**Diagram decision**: required
**Diagram reason**: Shared commit ordering and state ownership must stay explicit across both Hosts.
**Output language**: English prose; public display title follows the approved Chinese title.
**Execution posture**: characterization-first, then regression-first changes.

## Outcome and boundary

Permit exploration inside an approved module envelope while proving complete, uncontaminated delivery through baseline comparison and immutable-snapshot QA.

Baseline and delivery manifests, risk/authorization checks, snapshot refs, QA materialization and dependency/Git preparation; no whole-repository auto-authorization.

Initiative: `managed-workflow-simplification`; predecessor: `mws-minimal-intent`. This slice grants no authority to run predecessors, successors, migrate the live workspace or publish a release.

## Technical Design

**Design views**: architecture ownership, shared interfaces, data flow, state and interruption sequence all matter; the following baseline is self-contained for this slice.

### Snapshot and storage ordering

```mermaid
sequenceDiagram
    participant Host
    participant Git
    participant DB as SQLite
    participant QA
    Host->>Git: Build and retain immutable delivery objects
    Git-->>Host: Exact object identities
    Host->>DB: CAS-bind run, intent, runner and delivery identity
    DB-->>Host: Durable binding or no-write conflict
    Host->>QA: Execute all descriptors on materialized delivery
    QA-->>Host: Observed bounded results
    Host->>DB: Record complete fresh QA atomically
    Note over Host,DB: material/critical additionally require one Reviewer per round
    Host->>DB: Settle only with required fresh evidence
    Host->>Git: Export terminal audit; retry independently if interrupted
```

Git and SQLite are not a distributed transaction. Failed database binding may leave unreferenced attempt objects but creates no authority. Snapshot refs are namespaced by workspace/run/snapshot. Retain active and audit-referenced snapshots; remove only proven unused local attempt refs with expected-OID deletion.

Audit output uses `.imm/audit/<run-id>/`; same bytes are idempotent, differing bytes conflict. Audit export failure does not reactivate the run. Batch commit waits for the audit attachment it requires. Historical audit paths remain intact.

### Minimal TaskIntent and scope

Future simple tasks are executable with TaskIntent alone. A Spec is required for cross-module external contracts, migrations, multi-state lifecycle changes, or an explicit user design-document request. Risk and document complexity remain separate.

Intent goal, acceptance and scope remain authority. An optional bound Spec has a content identity. Freezing binds Git objects without moving source paths; historical archived documents are not rewritten.

`scope_hint` remains the authorized file/directory/glob envelope. Estimated file lists are advisory execution notes, never a second authority. Adding a helper or test inside an approved directory does not revise the envelope. Changing scope or authorized behavior still requires a complete breaking revision.

Enrollment captures local baseline fingerprints without adding unrelated/unapproved user content to Git. Complete task-period changes are detected before scope filtering. Existing unchanged user edits are excluded without modification. Mixed ownership or reliance on user changes requires a concrete inclusion/authorization decision; the agent cannot silently disclaim changed files.

Delivery manifests cover code, tests and generated outputs with exact modes/OIDs. System-generated terminal audit is a separately verified attachment, not a self-referential part of the source snapshot.

### QA and Review

QA runs in a disposable materialization of the immutable delivery tree, never against unchecked live worktree source. Git-dependent checks receive a standalone temporary repository with required object provenance, not a new Git worktree or a writable binding to the user's index/refs. Dependency preparation follows the snapshot lockfile, preferably verified offline cache; network or install scripts require an explicit preparation contract. No silent working-tree fallback or writable node_modules/source link.

Preserve minimal environment, runner identity, bounded output, timeout and path/symlink validation. Temporary-directory isolation is not an OS sandbox. Missing prerequisites are actionable errors, not passes.

Every changed delivery/intent/runner identity invalidates prior QA and requires all acceptance descriptors. Only unchanged fresh results can be reused after interruption. No partial cross-snapshot evidence cache is introduced.

Routine uses QA only. Material/critical add one independent readonly Reviewer per round. `pass` may carry advisory findings; only supported blocking findings cause rework. Trigger, caller chain and violated acceptance/security boundary are required but are not themselves proof of truth. Executor writes regression tests; new code receives fresh QA and required review. Refuted findings cannot reblock unchanged evidence; preserve the current rework budget and pause with unresolved facts when exhausted.

### Multi-worktree, versions and recovery

Each worktree owns its DB; Hosts in that worktree share it. Same logical task across worktrees has distinct runs and refs. No repository-wide business-task deduplication or automatic Issue claiming is introduced. Tracker terminal publication must match the assigned run. Batch authorization still binds the approved child intents/order/base/budget; resume uses each child's recorded run binding.

Database/WAL/SHM and backups remain Git-ignored. Migration source/schema and audit exports are versioned. Git branch changes do not roll back DB state. Old binaries reject new schema; new binaries diagnose legacy layout without automatic migration.

Back up with SQLite-consistent backup or closed/checkpointed storage. Restore requires all accessors stopped and revalidates worktree/Git binding. Restored rows do not restore live host capabilities. New clone/worktree begins without active authority. External directory deletion cannot be intercepted universally.

## Settlement enumeration

| Trigger / observation | State effect | Authority and recovery |
| --- | --- | --- |
| Native Enrollment accepted and committed | candidate → active | Kernel transaction after native capability revalidation; unique owner enforced |
| Freeze / delivery bind | active artifacts → frozen evidence identity | Kernel CAS; Git objects alone confer no permission |
| QA completion | pending observation → durable outcomes | Host-observed runner result; all acceptance results committed atomically |
| QA/Review rework | active remains active; evidence may become stale | Kernel applies supported finding; Executor cannot settle |
| Explicit stop | active → stopped | Current native literal-user authority and Kernel transaction |
| Required evidence complete | active → done | Kernel completion rules only; audit export follows |
| Host/provider failure, timeout, cancellation, shutdown | active or unknown attempt; no fabricated terminal outcome | Reproject committed facts; no inference from promise rejection or elapsed time |
| Commit succeeds, response lost | committed state remains authoritative | Reuse operation identity and committed result |
| Command launched, result not recorded | unknown observation | No exactly-once claim; only safely repeatable verification can rerun |
| Review budget exhausted | active with concrete unresolved obligation | Pause; neither automatic pass nor unbounded retries |
| Audit export interrupted | terminal remains terminal | Idempotent export, never reacquire active claim |

The primary task lifecycle remains active/done/stopped. Operation reservation/dispatched/unknown observations must not become a second lifecycle owner. Scope closure for each child must include sibling transition owners in Kernel, assurance, both Hosts and batch callers, not only edited functions.

## Cutover and retirement

This is a self-hosted migration: a Managed implementation task must not migrate or delete the authority store recording that very task. S1–S5 validate against temporary repositories/databases and can settle under the unchanged installed host. No reload or workspace migration occurs midway through the Initiative.

Intermediate development may contain old/new source paths, never simultaneous writes for one workspace. Owner: Initiative implementation owner. Exit: S5 before the coordinated major release; S5 deletes old runtime writers, file journals, duplicate claim/tombstone authority, archive relocation and manual repair instructions. Do not release intermediate dual-path builds.

After all implementation tasks settle, the user may authorize release/install separately. Actual workspace migration requires all old active tasks/batches settled or explicitly stopped and old host accessors exited. Import raw historical facts into a temporary DB, verify counts/identities/digests, fsync and atomically publish; retry uses recorded import identity. Never rewrite historical runner evidence. Old candidates are converted and revalidated before new Enrollment.

No-write rollback may restore the complete old backup with the old binary. After new writes, rollback by overwriting the DB is prohibited; use forward repair or an explicitly designed recovery. Legacy importer is read-only transition code; owner is S5 implementer, removal milestone is the following major release. User backups are not automatically deleted.

## Devil's Advocate Audit

- **Rollback resilience**: separate fixture migration from actual self-hosted cutover; isolate the Git-object/DB binding boundary; failure injection must prove no false authority or duplicate settlement. Preserve original historical bytes before import.
- **Verification vanity**: existing tests are prior art, not proof of new behavior. New assertions must fail on missing SQLite transactions, omitted delivery, stale evidence reuse or advisory-induced rework. Descriptor execution occurs after implementation; planning validates descriptor structure only.
- **Spec dilution detection**: every user outcome maps to S1–S5. Scope flexibility cannot weaken behavior authorization; optional Spec cannot bypass complex design; SQLite cannot replace host receipts; review reduction cannot turn blocking into advisory.
- **Compatibility**: shared Node/Bun API smoke checks already passed, but real concurrency, backup, packaging and restore are still unverified. All changed wire identities require both Hosts and batch/tracker conformance before release.

## Acceptance and verification mapping

Descriptors below are future deterministic QA; they are not executed by Planner. Extend these existing behavioral seams so they fail on the named regression. Current green assertions alone do not establish the new behavior. All descriptors run in the post-implementation QA attempt; no full suite/build/network/install is embedded.

- **A1**: Complete baseline-to-delivery comparison permits new helpers/tests inside the authorized envelope without revision, rejects genuine escape and mixed ownership, preserves existing user edits and never imports unrelated untracked contents into Git.
  Verification seam: `tests/managed-task-snapshot-isolation.test.ts`; `bun test tests/managed-task-snapshot-isolation.test.ts` (60 seconds, 128 KiB maximum captured output).
- **A2**: QA, Review and source delivery share one immutable identity covering generated outputs and file modes; namespaced refs retain objects across Git GC without cross-worktree collision, and terminal audit remains a separately verified attachment.
  Verification seam: `tests/review-revision-identity-conformance.test.ts`; `bun test tests/review-revision-identity-conformance.test.ts` (60 seconds, 128 KiB maximum captured output).
- **A3**: QA executes all descriptors in disposable delivery materialization with isolated Git metadata, lockfile-matched dependency preparation and validated cwd/symlinks; contamination, missing prerequisites, stale runner identity, timeout and excess output fail explicitly without live-worktree fallback.
  Verification seam: `tests/pi-canary-verification-descriptor.test.ts`; `bun test tests/pi-canary-verification-descriptor.test.ts` (60 seconds, 128 KiB maximum captured output).

## Discovery and reference closure

Entry points and reverse callers were traced from the current source imports, including `#kernel/` package imports, one caller layer and their direct tests. The exact list below includes shared lifecycle owners, both Host boundaries, regression imports and generated mirrors. Imports indicate impact, not permission to refactor unrelated behavior. New modules, if needed, are limited to the explicitly named paths and the responsibilities above. Existing helpers are reused; no speculative framework.

- Primary behavior owner: `plugins/immune-brain/runtime/assurance/review_evidence.ts`.
- Primary behavior owner: `plugins/immune-brain/runtime/assurance/verification.ts`.
- Primary behavior owner: `plugins/immune-brain/runtime/kernel/completion.ts`.
- Primary behavior owner: `plugins/immune-brain/runtime/workspace_scope.ts`.

The source-to-bundle path is `runtime/*` → `scripts/build-claude-plugin.ts` → `dist/claude/mcp-server.mjs`. Role prompts and BASELINE copies follow `scripts/dist-sync-manifest.ts`. Regenerate owned mirrors before their focused checks. Verification tests that import retired exports are part of the same scope; replace their behavioral coverage rather than leaving invalid imports or weakening checks.

## Exact mutation and lifecycle-review envelope

- `docs/plans/archive/mws-delivery-scope.intent.json`
- `docs/plans/mws-delivery-scope.intent.json`
- `docs/specs/archive/mws-delivery-scope.spec.md`
- `docs/specs/mws-delivery-scope.spec.md`
- `plugins/immune-brain/.pi-extension/imm-canary-work.ts`
- `plugins/immune-brain/.pi-extension/imm-unattended-batch.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-interaction.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-invocations.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-native-review.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-tool-failure.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-verification.ts`
- `plugins/immune-brain/.pi-extension/runtime-stub.ts`
- `plugins/immune-brain/dist/claude/mcp-server.mjs`
- `plugins/immune-brain/dist/imm-loop.md`
- `plugins/immune-brain/dist/imm-planner.md`
- `plugins/immune-brain/dist/role-prompts/executor.md`
- `plugins/immune-brain/runtime/assurance/coordinator.ts`
- `plugins/immune-brain/runtime/assurance/delivery_workspace.ts`
- `plugins/immune-brain/runtime/assurance/host_port.ts`
- `plugins/immune-brain/runtime/assurance/invocations.ts`
- `plugins/immune-brain/runtime/assurance/qa.ts`
- `plugins/immune-brain/runtime/assurance/review_evidence.ts`
- `plugins/immune-brain/runtime/assurance/verification.ts`
- `plugins/immune-brain/runtime/authorization_operation.ts`
- `plugins/immune-brain/runtime/claude/capability.ts`
- `plugins/immune-brain/runtime/claude/interaction.ts`
- `plugins/immune-brain/runtime/claude/kernel_ports.ts`
- `plugins/immune-brain/runtime/claude/mcp_server.ts`
- `plugins/immune-brain/runtime/claude/review_host.ts`
- `plugins/immune-brain/runtime/commands/kernel.ts`
- `plugins/immune-brain/runtime/kernel/application.ts`
- `plugins/immune-brain/runtime/kernel/assurance_projection.ts`
- `plugins/immune-brain/runtime/kernel/authority_port.ts`
- `plugins/immune-brain/runtime/kernel/backend_claim.ts`
- `plugins/immune-brain/runtime/kernel/batch_authority.ts`
- `plugins/immune-brain/runtime/kernel/canary_application.ts`
- `plugins/immune-brain/runtime/kernel/capability_registry.ts`
- `plugins/immune-brain/runtime/kernel/completion.ts`
- `plugins/immune-brain/runtime/kernel/enrollment.ts`
- `plugins/immune-brain/runtime/kernel/enrollment_authority.ts`
- `plugins/immune-brain/runtime/kernel/index.ts`
- `plugins/immune-brain/runtime/kernel/intent.ts`
- `plugins/immune-brain/runtime/kernel/intent_token_registry.ts`
- `plugins/immune-brain/runtime/kernel/reducer.ts`
- `plugins/immune-brain/runtime/kernel/refutation.ts`
- `plugins/immune-brain/runtime/kernel/spec_binding.ts`
- `plugins/immune-brain/runtime/kernel/storage.ts`
- `plugins/immune-brain/runtime/kernel/storage_layout_migration.ts`
- `plugins/immune-brain/runtime/kernel/storage_paths.ts`
- `plugins/immune-brain/runtime/kernel/types.ts`
- `plugins/immune-brain/runtime/kernel/validation.ts`
- `plugins/immune-brain/runtime/prompts/executor.md`
- `plugins/immune-brain/runtime/unattended/batch_git.ts`
- `plugins/immune-brain/runtime/unattended/batch_preflight.ts`
- `plugins/immune-brain/runtime/unattended/batch_runner.ts`
- `plugins/immune-brain/runtime/v4_runtime.ts`
- `plugins/immune-brain/runtime/verification_descriptor.ts`
- `plugins/immune-brain/runtime/workspace_scope.ts`
- `scripts/build-claude-plugin.ts`
- `tests/__snapshots__/plugin-package-runtime.test.ts.snap`
- `tests/breaking-intent-revision-gate.test.ts`
- `tests/carrier-enrollment-gate-contract.test.ts`
- `tests/claude-batch-authority.test.ts`
- `tests/claude-host-authority.test.ts`
- `tests/claude-host-package.test.ts`
- `tests/dual-host-assurance-conformance.test.ts`
- `tests/github-issue-projection-contract.test.ts`
- `tests/handoff-scope-exclusion.test.ts`
- `tests/helpers/pi-canary-assurance-harness.ts`
- `tests/host-neutral-assurance-coordinator.test.ts`
- `tests/imm-planner-kernel-intent-contract.test.ts`
- `tests/kernel-assurance-obligation.test.ts`
- `tests/kernel-assurance-projection.test.ts`
- `tests/kernel-canary-application.test.ts`
- `tests/kernel-canary-authority.test.ts`
- `tests/kernel-canary-claim-writer-boundary.test.ts`
- `tests/kernel-canary-drain-transaction.test.ts`
- `tests/kernel-canary-rework-authority.test.ts`
- `tests/kernel-canary-terminal-transaction.test.ts`
- `tests/kernel-inspect.test.ts`
- `tests/kernel-intent-authoring.test.ts`
- `tests/kernel-intent-validation.test.ts`
- `tests/kernel-migrate.test.ts`
- `tests/kernel-p2b0-boundary.test.ts`
- `tests/kernel-r2c1-boundary.test.ts`
- `tests/kernel-r2c2-boundary.test.ts`
- `tests/kernel-r2c2-reducer.test.ts`
- `tests/kernel-record-v3.test.ts`
- `tests/kernel-shadow-cli.test.ts`
- `tests/kernel-verification-descriptor.test.ts`
- `tests/managed-task-snapshot-isolation.test.ts`
- `tests/pi-canary-assurance-advance.test.ts`
- `tests/pi-canary-assurance-authority.test.ts`
- `tests/pi-canary-enroll-extension.test.ts`
- `tests/pi-canary-lifecycle-package.test.ts`
- `tests/pi-canary-review-bundle.test.ts`
- `tests/pi-canary-review-dispatch-resilience.test.ts`
- `tests/pi-canary-review-neighborhood.test.ts`
- `tests/pi-canary-review-outcome-evidence.test.ts`
- `tests/pi-canary-user-authority.test.ts`
- `tests/pi-canary-verification-descriptor.test.ts`
- `tests/pi-canary-work-extension.test.ts`
- `tests/plugin-package-runtime.test.ts`
- `tests/review-revision-identity-conformance.test.ts`
- `tests/risk-downgrade-guard.test.ts`
- `tests/shared-deterministic-qa.test.ts`
- `tests/unattended-batch-commit.test.ts`
- `tests/unattended-batch-run.test.ts`
- `tests/v4-storage-retirement-legacy-audit.test.ts`

## Traceability and completion

Run identity does not authorize same-worktree terminal-task reenrollment. Resume retains the original run_id; existing terminal task-id protection remains unless a separately approved future product change replaces it. Different worktrees may independently bind the same logical task; this does not create repository-wide deduplication.

The user approved the complete five-child frontier, names, risks and dependencies in this session. No separate Brainstorm manifest exists. This Spec maps the confirmed requirements to its acceptance above; shared target decisions are preserved from the Initiative baseline. Current installed Kernel requires this Spec active/archive pair and current v1 candidate wire; target optional-Spec and no-relocation behavior applies to future runtime use after cutover.

Completion requires the accepted behavior and focused QA, retirement of this slice's replaced behavior, consistent generated artifacts, and no live data migration. S5 owns final global legacy deletion and coordinated release readiness; intermediate old/new development source never permits dual writes and is not independently released. No implementation tests have run during planning.
