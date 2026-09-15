# Managed Workflow Simplification — Candidate Design Baseline

**Status**: The literal user approved the Initiative name, slug, all five children and serial dependencies. All five canonical TaskIntent candidates are Git-tracked and validated with `valid: true` and `enrollment_ready: true`. GitHub publication is `tracker_associated`; no Enrollment or implementation has begun.
**Design risk**: High — persistence, concurrency, authority identities, snapshot evidence and dual-host migration change together.
**Diagram decision**: required
**Diagram reason**: The database/Git commit boundary and the staged cutover require explicit ordering and recovery ownership.
**Output language**: English under the Planner default; user-facing summaries remain Chinese.
**Execution posture**: characterization-first for existing authority behavior; regression-first for changed storage, snapshot and verdict behavior.

## Outcome

Replace multi-file authority persistence with a worktree-local SQLite store; make a standalone Spec optional for simple future tasks; separate authorized scope from estimated files and complete delivery; remove advisory-only review loops while retaining evidence-based assurance.

The user-confirmed requirements are recorded in [the proposal](../proposals/managed-workflow-simplification.md). This candidate is the proposed technical baseline for the Initiative. The proposal supplies provenance, not a second execution authority. Each approved child receives its own bound Spec and TaskIntent, so one child's current freeze/archive operation cannot move another child's shared authority artifact.

## Approved Initiative frontier

Confirmed name: **Managed Workflow Simplification**.
Immutable slug: `managed-workflow-simplification`.
Public short name: `工作流简化`.
Parent title: `简化状态、契约、Scope 与验收工作流`.
Carrier: GitHub, selected by repository `AGENTS.md`.
Release unit: one coordinated major release; intermediate commits are not independently published.

| Slice | Proposed task_id | Public result title | Risk | Dependency |
| --- | --- | --- | --- | --- |
| S1 | mws-sqlite-authority | 单一 SQLite 状态与运行身份 | critical | none |
| S2 | mws-minimal-intent | 最小执行契约与稳定产物路径 | material | S1 |
| S3 | mws-delivery-scope | 弹性 Scope 与完整交付验收 | material | S2 |
| S4 | mws-assurance-review | 精简验收与有据审查 | material | S3 |
| S5 | mws-migration-release | 数据迁移、旧机制清理与发布就绪 | critical | S4 |

Stable order: S1 → S2 → S3 → S4 → S5. Execution groups are singletons. Critical children are not eligible for unattended batch; this Initiative does not authorize a batch run, publishing a release, pushing commits, or changing worktrees.

## Technical Design

**Design views**: architecture ownership, interfaces, data flow, lifecycle and temporal recovery are all relevant because storage replacement changes the representation consumed by both Hosts. No additional service or scheduler is introduced.

### Ownership and interfaces

- Kernel retains its reducer's legal lifecycle decisions and native capability/receipt boundary. SQLite replaces persistence mechanics, not user authorization.
- One `.imm/state/kernel.sqlite` per worktree owns runs, lifecycle, monotonic revision, findings, attestations and operation outcomes. Active ownership is derived from an enforced single-active-run constraint.
- `workspace_id` identifies local storage ownership, `task_id` identifies the logical task, and `run_id` identifies one enrolled execution. Mutations bind the exact run rather than resolving the latest task occurrence.
- SQLite uses the shared `node:sqlite` API; release support baseline is Node 24.18.0 and Bun 1.4.2. Validate the actual runtime matrix and packaged Node artifact. No ORM, addon, remote DB, JSON fallback or long-term dual writer.
- Use WAL, FULL synchronous mode, foreign keys and a bounded 5-second busy timeout on local filesystems. No QA or model invocation runs inside a database transaction.
- Store authoritative indexed fields once; reconstruct TaskRecord consistently rather than independently storing contradictory column and JSON values.
- Read/write inputs include run identity and expected revision; stale writes and ownership conflicts fail without side effects. JSON whitespace is no longer a concurrency identity.
- Git owns base/delivery objects; audit files are deterministic exports. Batch progress remains owned by unattended modules and cannot override task authority.
- Schema version, TaskIntent, TaskRecord, verdict and host-envelope changes must be coordinated across parsers, serializers, projections, native tools, CLI and generated artifacts. Existing candidate TaskIntents remain governed by the currently installed Kernel until cutover.

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

## Slice implementation and verification boundaries

S1 establishes the complete new store/run transaction boundary with fixture-based conformance. Entry points include `runtime/kernel/storage.ts`, `storage_paths.ts`, `application.ts`, `enrollment.ts`, `backend_claim.ts`, `reducer.ts`, `types.ts`, `validation.ts` and related authority/host callers. Existing focused seams: `tests/task-record-durability.test.ts`, `tests/kernel-enrollment-transaction.test.ts`, `tests/kernel-canary-terminal-transaction.test.ts`. Add concrete SQLite concurrency/crash tests as part of this slice; old tests alone do not prove the new store.

S2 closes Intent/Spec/Record binding and both parser/serializer sides. Entry points include `runtime/kernel/intent.ts`, `spec_binding.ts`, `validation.ts`, `types.ts`, author/validate commands, Planner/Loop sources and package mirrors. Focused seams: `tests/kernel-intent-authoring.test.ts`, `tests/kernel-intent-validation.test.ts`, `tests/planning-artifact-archival.test.ts`. Replace retired move assertions with no-move/content-binding behavior tests; preserve historical evidence checks.

S3 owns baseline-to-delivery completeness and isolated QA materialization. Entry points include `runtime/workspace_scope.ts`, `runtime/assurance/verification.ts`, `review_evidence.ts`, snapshot consumers and host ports. Focused seams: `tests/managed-task-snapshot-isolation.test.ts`, `tests/review-revision-identity-conformance.test.ts`, `tests/pi-canary-verification-descriptor.test.ts`. Add cases for scoped helper/test discovery, mixed user edits, generated omissions and contaminated runtime input.

S4 owns the complete verdict-to-finding-to-obligation-to-display chain. Entry points include `runtime/assurance/coordinator.ts`, `qa_findings.ts`, `verification.ts`, Kernel completion/refutation/parsing, role prompts and Pi/Claude adapters. Focused seams: `tests/host-neutral-assurance-coordinator.test.ts`, `tests/kernel-canary-rework-authority.test.ts`, `tests/dual-host-assurance-conformance.test.ts`. Test advisory pass, real blocker, unchanged refutation, budget stop and fresh-snapshot full QA.

S5 owns migration, retirement and package cutover. Entry points include `runtime/kernel/storage_layout_migration.ts`, CLI entry points, unattended state/run bindings, `runtime/github_issue_tracker.ts`, package manifests/build scripts and affected ADRs. Focused seams: `tests/kernel-storage-layout-migration.test.ts`, `tests/dual-host-assurance-conformance.test.ts`, relevant batch/tracker tests located during exact reference closure. Validate import interruption, backup/restore, incompatible schema, multi-worktree and zero legacy writes.

Every child includes its own active/archive Spec paths under the CURRENT Kernel contract, the generated `plugins/immune-brain/dist/claude/mcp-server.mjs`, actual mirrored source changes, and all affected test paths. Exact sensitive file scope and descriptors are finalized after complete-frontier approval and remaining caller closure; directory names in this document are investigation boundaries, not authorization globs.

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

## Publication and candidate validation record

Parent: [#97](https://github.com/dereknex/immune-brain/issues/97). Tracker completed the exact approved full batch with status `updated`, then read-only verification confirmed all five native Sub-issues, open state, ready/blocked labels and the exact chain below. Immediate post-create observations temporarily missed newly created Issues; each continuation followed read-only confirmation and reused the identical batch without duplicate creation.

| Slice | Child | Candidate Intent | Validated content hash |
| --- | --- | --- | --- |
| S1 | [#98](https://github.com/dereknex/immune-brain/issues/98) | `docs/plans/mws-sqlite-authority.intent.json` | `sha256:3e39174c7a4690603593407a3e68f50ada1b68d8654a4e145e657a82db22c8d4` |
| S2 | [#99](https://github.com/dereknex/immune-brain/issues/99) | `docs/plans/mws-minimal-intent.intent.json` | `sha256:ed0210c9d4458e66a2c578a79f57065b6323afe0f432f7603dbaf620e2465526` |
| S3 | [#100](https://github.com/dereknex/immune-brain/issues/100) | `docs/plans/mws-delivery-scope.intent.json` | `sha256:a4203bf9f53171b8212f1491017ab7bc8409418fbe63a4bbe4281a2fb7327780` |
| S4 | [#101](https://github.com/dereknex/immune-brain/issues/101) | `docs/plans/mws-assurance-review.intent.json` | `sha256:0bb4eb8e9634a951deb417f4042b07f5c8a534bb27e35c219153b88165564739` |
| S5 | [#102](https://github.com/dereknex/immune-brain/issues/102) | `docs/plans/mws-migration-release.intent.json` | `sha256:ed3eee03ad0393ffc6759dc87d180ad3ee1b5caba05113443d9bbaf2419b7480` |

Recommended first task: S1 / #98. Order: #98 → #99 → #100 → #101 → #102; parallel groups are singletons. Validation checked candidate structure and verification eligibility only, not implementation acceptance. Files were staged for canonical ownership, not committed. This publication grants no execution authority.

## Planning and release gates

The user confirmed the named Initiative and all five children in one decision before remote publication. No local Initiative carrier is created because GitHub is selected. After approval, finish exact caller closure, author each TaskIntent only with the canonical Kernel author command, stage owned candidate paths and require `valid: true` and `enrollment_ready: true` for all five.

Publish once with the tracker complete-batch command and verify exact Parent/Child topology, hashes and native dependencies. Planning-only delivery stops after successful candidate validation and publication; no Enrollment is requested.

Focused descriptors must name small concrete test files and bounded outputs, never the full suite/build/install/network. Implementation packaging regenerates Claude bundle before tests and synchronized docs as needed. Final release readiness includes typecheck, full release verification and a major changeset; release execution itself is not authorized by this planning entry.
