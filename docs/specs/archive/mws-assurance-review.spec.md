# S4: 精简验收与有据审查

**Status**: Approved Initiative child; candidate for native Enrollment only after canonical validation.
**Design risk**: High — shared contract, persistence, authority or evidence boundaries.
**Diagram decision**: required
**Diagram reason**: Shared commit ordering and state ownership must stay explicit across both Hosts.
**Output language**: English prose; public display title follows the approved Chinese title.
**Execution posture**: characterization-first, then regression-first changes.

## Outcome and boundary

Complete the shortest evidence-driven assurance path with advisory-capable pass verdicts, one independent Reviewer per round and no repeated fresh QA or unsupported rework loops.

Verdict parsing/application, finding/refutation/completion transitions, coordinator and both Host displays; preserve rework budgets and evidence independence.

Initiative: `managed-workflow-simplification`; predecessor: `mws-delivery-scope`. This slice grants no authority to run predecessors, successors, migrate the live workspace or publish a release.

## Technical Design

**Design views**: architecture ownership, shared interfaces, data flow, state and interruption sequence all matter; the following baseline is self-contained for this slice.

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

### QA and Review

QA runs in a disposable materialization of the immutable delivery tree, never against unchecked live worktree source. Git-dependent checks receive a standalone temporary repository with required object provenance, not a new Git worktree or a writable binding to the user's index/refs. Dependency preparation follows the snapshot lockfile, preferably verified offline cache; network or install scripts require an explicit preparation contract. No silent working-tree fallback or writable node_modules/source link.

Preserve minimal environment, runner identity, bounded output, timeout and path/symlink validation. Temporary-directory isolation is not an OS sandbox. Missing prerequisites are actionable errors, not passes.

Every changed delivery/intent/runner identity invalidates prior QA and requires all acceptance descriptors. Only unchanged fresh results can be reused after interruption. No partial cross-snapshot evidence cache is introduced.

Routine uses QA only. Material/critical add one independent readonly Reviewer per round. `pass` may carry advisory findings; only supported blocking findings cause rework. Trigger, caller chain and violated acceptance/security boundary are required but are not themselves proof of truth. Executor writes regression tests; new code receives fresh QA and required review. Refuted findings cannot reblock unchanged evidence; preserve the current rework budget and pause with unresolved facts when exhausted.

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

- **A1**: Routine completes after deterministic QA without Review; material/critical prepare one independent Reviewer per round; pass with advisory settles while valid blocking causes rework and every changed snapshot reruns all acceptance descriptors.
  Verification seam: `tests/host-neutral-assurance-coordinator.test.ts`; `bun test tests/host-neutral-assurance-coordinator.test.ts` (60 seconds, 128 KiB maximum captured output).
- **A2**: Unchanged refuted evidence cannot repeatedly block, new evidence may re-enter review, budget exhaustion pauses instead of passing, and unknown/failed attempts cannot settle the task.
  Verification seam: `tests/kernel-canary-rework-authority.test.ts`; `bun test tests/kernel-canary-rework-authority.test.ts` (60 seconds, 128 KiB maximum captured output).
- **A3**: Both Hosts bind equivalent verdict/run/freshness identities, reuse unchanged committed QA during recovery and preserve required independent Review and native exception decisions.
  Verification seam: `tests/dual-host-assurance-conformance.test.ts`; `bun test tests/dual-host-assurance-conformance.test.ts` (60 seconds, 128 KiB maximum captured output).

## Discovery and reference closure

Entry points and reverse callers were traced from the current source imports, including `#kernel/` package imports, one caller layer and their direct tests. The exact list below includes shared lifecycle owners, both Host boundaries, regression imports and generated mirrors. Imports indicate impact, not permission to refactor unrelated behavior. New modules, if needed, are limited to the explicitly named paths and the responsibilities above. Existing helpers are reused; no speculative framework.

- Primary behavior owner: `plugins/immune-brain/runtime/assurance/coordinator.ts`.
- Primary behavior owner: `plugins/immune-brain/runtime/assurance/qa_findings.ts`.
- Primary behavior owner: `plugins/immune-brain/runtime/assurance/verification.ts`.
- Primary behavior owner: `plugins/immune-brain/runtime/kernel/completion.ts`.
- Primary behavior owner: `plugins/immune-brain/runtime/kernel/refutation.ts`.

The source-to-bundle path is `runtime/*` → `scripts/build-claude-plugin.ts` → `dist/claude/mcp-server.mjs`. Role prompts and BASELINE copies follow `scripts/dist-sync-manifest.ts`. Regenerate owned mirrors before their focused checks. Verification tests that import retired exports are part of the same scope; replace their behavioral coverage rather than leaving invalid imports or weakening checks.

## Exact mutation and lifecycle-review envelope

- `docs/plans/archive/mws-assurance-review.intent.json`
- `docs/plans/mws-assurance-review.intent.json`
- `docs/specs/archive/mws-assurance-review.spec.md`
- `docs/specs/mws-assurance-review.spec.md`
- `plugins/immune-brain/.pi-extension/imm-canary-work.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-interaction.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-invocations.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-native-review.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-qa-findings.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-tool-failure.ts`
- `plugins/immune-brain/.pi-extension/pi-canary-verification.ts`
- `plugins/immune-brain/.pi-extension/runtime-stub.ts`
- `plugins/immune-brain/dist/claude/mcp-server.mjs`
- `plugins/immune-brain/dist/imm-loop.md`
- `plugins/immune-brain/dist/role-prompts/code-review.md`
- `plugins/immune-brain/dist/role-prompts/qa.md`
- `plugins/immune-brain/runtime/assurance/coordinator.ts`
- `plugins/immune-brain/runtime/assurance/host_port.ts`
- `plugins/immune-brain/runtime/assurance/invocations.ts`
- `plugins/immune-brain/runtime/assurance/qa.ts`
- `plugins/immune-brain/runtime/assurance/qa_findings.ts`
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
- `plugins/immune-brain/runtime/loop_contract.ts`
- `plugins/immune-brain/runtime/prompts/code-review.md`
- `plugins/immune-brain/runtime/prompts/qa.md`
- `plugins/immune-brain/runtime/role_prompt_bridge.ts`
- `plugins/immune-brain/runtime/unattended/batch_runner.ts`
- `plugins/immune-brain/runtime/v4_runtime.ts`
- `scripts/build-claude-plugin.ts`
- `tests/__snapshots__/plugin-package-runtime.test.ts.snap`
- `tests/breaking-intent-revision-gate.test.ts`
- `tests/carrier-enrollment-gate-contract.test.ts`
- `tests/claude-batch-authority.test.ts`
- `tests/claude-host-authority.test.ts`
- `tests/claude-host-package.test.ts`
- `tests/dual-host-assurance-conformance.test.ts`
- `tests/github-issue-projection-contract.test.ts`
- `tests/helpers/pi-canary-assurance-harness.ts`
- `tests/host-neutral-assurance-coordinator.test.ts`
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
- `tests/kernel-record-v4.test.ts`
- `tests/kernel-shadow-cli.test.ts`
- `tests/kernel-verification-descriptor.test.ts`
- `tests/packaged-contract-tool-surface.test.ts`
- `tests/pi-canary-assurance-advance.test.ts`
- `tests/pi-canary-assurance-authority.test.ts`
- `tests/pi-canary-assurance-progression.test.ts`
- `tests/pi-canary-enroll-extension.test.ts`
- `tests/pi-canary-lifecycle-package.test.ts`
- `tests/pi-canary-review-outcome-evidence.test.ts`
- `tests/pi-canary-user-authority.test.ts`
- `tests/pi-canary-verification-descriptor.test.ts`
- `tests/pi-canary-work-extension.test.ts`
- `tests/plugin-package-runtime.test.ts`
- `tests/review-revision-identity-conformance.test.ts`
- `tests/risk-downgrade-guard.test.ts`
- `tests/shared-deterministic-qa.test.ts`
- `tests/unattended-batch-run.test.ts`
- `tests/v4-storage-retirement-legacy-audit.test.ts`

## Traceability and completion

Run identity does not authorize same-worktree terminal-task reenrollment. Resume retains the original run_id; existing terminal task-id protection remains unless a separately approved future product change replaces it. Different worktrees may independently bind the same logical task; this does not create repository-wide deduplication.

The user approved the complete five-child frontier, names, risks and dependencies in this session. No separate Brainstorm manifest exists. This Spec maps the confirmed requirements to its acceptance above; shared target decisions are preserved from the Initiative baseline. Current installed Kernel requires this Spec active/archive pair and current v1 candidate wire; target optional-Spec and no-relocation behavior applies to future runtime use after cutover.

Completion requires the accepted behavior and focused QA, retirement of this slice's replaced behavior, consistent generated artifacts, and no live data migration. S5 owns final global legacy deletion and coordinated release readiness; intermediate old/new development source never permits dual writes and is not independently released. No implementation tests have run during planning.
