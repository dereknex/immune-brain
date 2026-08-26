# Immune-Brain Storage Layout Cutover

## Status

- Proposed Initiative: `imm-storage-layout-cutover`; the slug becomes immutable only after literal-user confirmation before the first remote mutation.
- Initiative carrier: GitHub (global `AGENTS.md` default); no remote mutation is part of this Plan-only pass.
- Slice 1: cutover runtime and one-release automatic migrator.
- Slice 2: immediate successor release removes the migrator and every temporary old-layout test branch after the cutover release has migrated this repository.
- Design risk: High.
- Execution risk: Critical because this changes Kernel authority storage, terminal settlement, and repository evidence migration.
- Upstream: confirmed `imm-brainstorm` manifest `BR-REQ-001` through `BR-DEFER-001` from the 2026-08-26 conversation.

## Result

Every target repository uses `.imm/state/` for ignored worktree-local mutable Kernel authority and `.imm/audit/` for Git-tracked terminal evidence. Terminal settlement transfers one TaskRecord from state to immutable audit evidence with recoverable exact-byte convergence. A one-release automatic migrator relocates owner-free legacy repositories, stops the triggering operation, and requires the migration diff to be committed before managed mutation can continue.

## Non-Goals

- No TaskIntent, TaskRecord, TaskProjection, Spec, or verification-descriptor schema change.
- No `docs/plans/` or `docs/specs/` layout reorganization.
- No online migration of an active Managed task.
- No worktree creation, switching, or deletion; no remote repository mutation.
- No migration CLI, migration Skill, Git index mutation, data backfill, redaction, or rollback command.
- No normal-runtime dual read of the old authority layout.

## Design Views

Selected views: architecture layers, component interfaces, data flow, state transitions, and temporal sequence. All five affect correctness because the change crosses Kernel storage, CLI and Pi host entrypoints, Git evidence migration, and multi-file settlement. No technical-design view is omitted.

## Discovery Evidence

- `CONTEXT.md` identifies `plugins/immune-brain/runtime/kernel/` as the current TaskIntent, Enrollment, TaskRecord, claim, projection, and completion owner, and identifies `.imm/tasks/` plus `.imm/workspace.json` as the current storage layout.
- `plugins/immune-brain/runtime/kernel/application.ts`, `reducer.ts`, `storage.ts`, and `canary_application.ts` respectively own lifecycle application, legal transitions, durable commit/recovery, and the active-to-draining claim transition. `backend_claim.ts`, `enrollment.ts`, `pi_canary_prepare.ts`, `assurance_projection.ts`, both Pi canary host extensions, and `runtime-stub.ts` are sibling readers or mutation owners of the same authority state machine.
- `plugins/immune-brain/runtime/commands/kernel.ts` owns `status`, `audit --legacy`, `intent author`, and `intent validate`; read-only status/audit and mutating authoring require different layout-gate behavior.
- `plugins/immune-brain/runtime/kernel/legacy_audit.ts` is the retained explicit historical v3 audit reader. `automatic_observations.ts` and `observation.ts` retain legacy machine-evidence write surfaces that must stop targeting `.imm/memory/`. The former `runtime/project_migration.ts` v3 island was deleted in commit `0d89a1c` and is not a current implementation surface.
- `plugins/immune-brain/runtime/workspace_scope.ts` excludes old runtime paths from changed-file identity and must move that exclusion to `.imm/state/` without excluding `.imm/audit/`.
- `.gitignore`, `tests/task-record-durability.test.ts`, and `tests/task-record-durability-baseline.json` jointly own repository evidence durability.
- `tests/kernel-canary-terminal-transaction.test.ts`, `kernel-backend-claim.test.ts`, `kernel-migrate.test.ts`, `kernel-shadow-cli.test.ts`, `v4-storage-retirement-legacy-audit.test.ts`, `pi-canary-enroll-extension.test.ts`, and `pi-canary-work-extension.test.ts` are the highest behavioral seams. Additional Kernel tests with direct `.imm/tasks/`, `.imm/workspace.json`, or `.imm/memory/` fixtures are reference-closed migration consumers and must move with the path contract.
- `.imm/templates/iteration-plan-template.md` is still read by `tests/roadmap-plan-boundary-contract.test.ts` although prose Plan creation is retired. `.imm/templates/review-report-template.md` has no production caller.
- `.imm/memory/MEMORY.md` declares `.imm/memory/` authoritative, which conflicts with current v4 authority. Its current architectural claims already have canonical owners in `CONTEXT.md`, TaskRecords, and `docs/solutions/`; its task log remains in Git history.
- `docs/adr/0002-maintenance-surface-ownership.md` requires one canonical implementation with generated mirrors only. `docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md` rejects introducing a second authority store.
- `docs/specs/shrink-kernel-cli-surface.spec.md` previously proposed retaining `status` and `audit`; this design preserves their bounded read-only purpose but changes them to layout status and historical audit rather than legacy authority projection.

## Permanent Storage Contract

```text
.imm/
├── state/                              # ignored as one directory
│   ├── tasks/<task-id>.json            # active TaskRecord only
│   ├── workspace.json                  # mutable workspace owner
│   ├── active-claim.json               # single workspace claim
│   ├── locks/kernel-store.lock
│   └── transactions/*.json             # recoverable mutable markers
└── audit/                              # tracked, never ignored
    ├── <task-id>/
    │   ├── task-record.json             # terminal TaskRecord bytes
    │   └── terminal-proof.json          # create-once proof bytes
    └── legacy-v3/                       # byte-preserved historical v3 evidence
```

`storage_paths.ts` is the permanent path vocabulary. It validates task IDs and returns repository-contained relative paths. `storage.ts`, `backend_claim.ts`, preparation, projections, and tests must not retain independent path literals for active/terminal Kernel authority.

`terminal-proof.json` is application-immutable: create once, accept exact committed replay, and reject any different existing bytes. The design does not claim filesystem-enforced immutability.

## Component Interfaces

### Permanent layout interface

`storage_paths.ts` supplies active record, workspace, claim, lock, transaction, terminal record, terminal proof, and legacy-audit paths. It has no migration logic.

`inspectStorageLayout(root)` is read-only and returns exactly one of:

- `ready`: no old authority path or pending marker exists and affected tracked audit paths are committed;
- `migration_required`: recognized owner-free old layout exists;
- `migration_blocked_active`: an active claim, nonterminal TaskRecord, non-null workspace owner, or old transaction marker exists;
- `migration_uncommitted`: relocation completed but the affected old/audit paths differ from `HEAD`;
- `recovery_required`: a recognized migration or Kernel transaction marker exists;
- `invalid`: unknown, malformed, symlinked, escaped, case-colliding, or contradictory storage exists.

Every stateful CLI and Pi entrypoint calls this shared inspection before interpreting authority. Read-only commands return the status and perform zero writes. Mutating commands recover a recognized marker or run the one-release migration under both old and new locks, then stop without performing the requested mutation. Normal Kernel readers never fall back to the old layout.

### Temporary migrator interface

`storage_layout_migration.ts` is the only production reader of old mutable layout paths. It is a one-release compatibility module owned by Kernel/runtime maintainers. It exposes read-only inspection plus one internal migration operation; no CLI command or Skill exposes it directly.

The first eligible stateful mutation, including `intent author` or Enrollment when no intent is being authored, invokes it. If migration succeeds, the caller returns `migration_completed` with the exact affected paths and the instruction to commit them and retry. It does not stage or commit Git changes.

Expiry: the immediate successor release after the cutover release. That release deletes the module, all old-layout normalizer text, and temporary old-root test branches. A repository that skipped the cutover release receives `legacy_storage_layout_unsupported` and must install the cutover release first.

### Historical audit interface

`audit --legacy` reads only `.imm/audit/legacy-v3/`, uses bounded no-symlink reads, redacts as today, and cannot create, validate, renew, or settle current authority. `status --json` reports layout/Kernel projection facts and does not project the archived v3 Ledger as current authority. The v3 island modules retain zero external imports; their path relocation is internal.

## Data Flow

### Enrollment and active execution

1. A read-only preparation inspects layout and hashes the layout status into the preparation digest.
2. `migration_required`, `migration_uncommitted`, `recovery_required`, or `invalid` blocks ordinary authority interpretation.
3. A confirmed or otherwise explicit mutating entrypoint may migrate or recover, but it must stop before TaskIntent creation or Enrollment commit.
4. On a clean retry, Enrollment creates the active TaskRecord, workspace owner, and claim under `.imm/state/` through the existing capability and recoverable transaction boundary.
5. Work, freeze/rework, QA, Review, authorization, and stop actions mutate only `.imm/state/` while preserving the single claim.

### Terminal settlement

1. The Kernel writes one terminal marker containing expected active hashes, complete next terminal TaskRecord bytes, terminal-proof bytes, cleared workspace bytes, and artifact relocations.
2. Recovery converges artifact relocations.
3. Recovery creates `.imm/audit/<task-id>/task-record.json` and verifies its hash.
4. Recovery creates the matching `terminal-proof.json` with create-once/exact-replay semantics.
5. Recovery clears workspace ownership and removes the active claim.
6. Recovery removes `.imm/state/tasks/<task-id>.json` only after the audit pair is verified.
7. Recovery removes the terminal marker last.

The active record remains available until the complete terminal audit pair exists. A marker makes all transient duplicates non-authoritative to read-only consumers; only locked recovery may resolve them.

## Authority Precedence

| Observed state | Result |
| --- | --- |
| Migration or Kernel transaction marker present | `recovery_required`; read-only zero-write, mutation recovers under lock |
| Valid claim + matching active record + matching workspace owner, no proof | `active_owner` |
| Valid terminal record + matching proof + null workspace + no claim/active record | `terminal_owner` |
| Matching terminal pair + stale matching claim | `repairable_stale_claim` through the existing native repair authority |
| Old recognized owner-free layout, no marker | `migration_required`; no authority projection |
| Old active owner or old pending transaction | `migration_blocked_active`; use the prior runtime to settle/stop/recover |
| Old and new bytes both present during migration with exact manifest/hash match | recoverable only while the migration marker exists |
| Any duplicate outside a marker, mismatched hash, malformed artifact, symlink, escape, or unknown file | `authority_conflict`/`invalid`; fail closed |
| No owner or evidence in ready layout | `unowned` |

## Legacy Migration State Machine

### Eligibility

Migration acquires the old `.imm/tasks` lock and new `.imm/state` lock in that order and holds both through convergence. It rejects:

- any active/draining claim;
- any nonterminal TaskRecord;
- non-null workspace ownership;
- any old Kernel transaction/repair marker;
- affected staged, unstaged, or untracked Git changes;
- unknown files in `.imm/tasks/`, `.imm/memory/`, or `.imm/templates/` except known lock files;
- symlinked parents/leaves, path escapes, non-regular files, case-fold collisions, or conflicting targets.

Unrelated dirty paths do not block migration.

### Manifest and recovery

Before the first relocation, the migrator writes `.imm/state/transactions/storage-layout-migration.json` with contract/version and a sorted manifest of `{source, target|delete, sha256, size}` entries. It stores no backup bytes. Known terminal TaskRecords and proofs move byte-for-byte into task audit directories. Known machine v3 evidence moves byte-for-byte into `audit/legacy-v3/`. `MEMORY.md` and the two retired templates are deleted; Git history is their rollback/retention source.

Each relocation is exact-byte idempotent: source-only moves, target-only with matching hash is already complete, and matching source+target removes source only after verification. Any content mismatch leaves the marker and fails closed. Directory fsync follows marker creation, rename/create, source deletion, and marker deletion. Recovery replays the same manifest; it never recomputes a broader source set after marker creation.

After convergence, the marker is removed and the original mutation returns `migration_completed`. Subsequent mutation remains blocked as `migration_uncommitted` until Git reports the exact affected source/audit paths equal to `HEAD`.

## Settlement-Design Contract

### Trigger sources

- Start: explicit TaskIntent authoring, native Enrollment confirmation, Enrollment commit, active work mutation, freeze/rework, QA approval, Review approval/rework, critical authorization, stop, and stale-authority repair.
- Interrupt: host cancellation before authority commit, process/session shutdown before commit, filesystem/provider failure, lock contention, stale hashes, or malformed evidence.
- Settle: Kernel completion after all obligations, authorized stop, Enrollment transaction completion, migration completion, or deterministic recovery of an existing marker.
- Timeout and child acknowledgement are not terminal authority; Review and QA affect terminal eligibility only through validated Kernel receipts.

### State inventory and transitions

- Layout: `ready -> active -> terminal`, or `migration_required -> migrating -> migration_uncommitted -> ready`; `migration_blocked_active`, `recovery_required`, and `invalid` are fail-closed observations, not authority transitions.
- Task: `unowned -> active:active -> active:frozen -> done|stopped`. Rework returns `active:frozen -> active:active`. Stale matching claim after terminal pair projects `repairable_stale_claim -> terminal_owner` only through native repair.
- Settlement transaction: `absent -> marker durable -> audit record durable -> proof durable -> workspace/claim cleared -> active record removed -> marker absent`.

### Terminal ownership

The Kernel reducer plus recoverable Kernel storage transaction is the sole terminal settlement authority. QA attestation, native Review receipt, and critical literal-user authorization satisfy obligations but do not themselves write terminality. Promise resolution/rejection, elapsed time, process exit, child acknowledgement, filesystem presence without matching hashes, legacy Ledger status, Git status, and GitHub Issue state are non-authoritative.

### Same-state-machine coverage

The implementation/review scope includes every transition owner (`application.ts`, `reducer.ts`, `storage.ts`, `canary_application.ts`), every authority reader/writer (`storage_paths.ts`, `storage_layout_migration.ts`, `backend_claim.ts`, `completion.ts`, `enrollment.ts`, `pi_canary_prepare.ts`, `assurance_projection.ts`, `legacy_audit.ts`, `automatic_observations.ts`, `observation.ts`), both Pi canary host extensions, `runtime-stub.ts`, the Kernel CLI entrypoint, workspace diff identity, and all focused tests that directly construct or assert old storage paths. The reference-closure inventory is exact in TaskIntent revision 2 whether or not every listed file changes.

## Release Sequence and Rollback

1. Author and enroll Slice 1 under the currently installed old runtime.
2. Implement and settle Slice 1 under that old runtime; source tests use temporary repositories and a bounded one-release repository-layout compatibility assertion.
3. Publish/install the cutover release only after Slice 1 is terminal.
4. The first later mutating operation automatically migrates the now-owner-free repository and stops.
5. Commit the migration-only Git diff, then retry the original operation on the new layout.
6. After any new-layout Enrollment, rollback is roll-forward-only. Before that Enrollment, rollback means restoring the migration commit with Git and downgrading the plugin together. No Kernel rollback command exists.
7. In the immediate successor release, Slice 2 deletes `storage_layout_migration.ts`, temporary old-layout test branches, migration-only diagnostics, and old layout contract text. It proves this repository is already migrated and makes old layout detection a permanent unsupported-layout failure.

The bootstrap compatibility branch is necessary only because the Slice 1 TaskRecord must settle under the installed old runtime. It is not a permanent dual-read path.

## Retirement Contract

Slice 1 deletes the two `.imm/templates/` source files and current tests/docs that present them as live contracts; historical archived Plan/Spec references remain factual. It deletes `.imm/memory/MEMORY.md` after current canonical claims are represented by `CONTEXT.md`, this Spec, and existing `docs/solutions/`. It removes the production active-v2 migration helper because migration rejects all active old tasks; terminal v2 parsing remains only for historical audit records.

Slice 2 deletes the one-release migrator source and contract text. An absence assertion may guard a completed deletion, but no retirement acceptance can pass while the retired source remains.

## Verification Strategy

Focused verification uses the highest existing behavior seams:

- `tests/kernel-canary-terminal-transaction.test.ts`: active/new path ownership, terminal transfer ordering, stale-claim repair, crash replay, and precedence.
- `tests/kernel-storage-layout-migration.test.ts` (new): dry inspection, eligibility, dual-lock migration, exact-byte manifest/replay, dirty paths, symlinks, traversal, case collisions, target collisions, interruption points, no index writes, and commit-before-retry.
- `tests/kernel-shadow-cli.test.ts` and `tests/pi-canary-enroll-extension.test.ts`: shared read-only/mutating gate behavior, zero-write status/validate, automatic migrate-and-stop, and preparation digest binding.
- `tests/v4-storage-retirement-legacy-audit.test.ts`: relocated historical audit remains readable and never authoritative.
- `tests/task-record-durability.test.ts` plus its baseline: task-to-audit pairing, concurrent task-ID merge isolation, state exclusion, and tracked repository evidence. The cutover release permits the repository's pre-activation old layout only through one explicit expiring branch; Slice 2 deletes it.
- `tests/roadmap-plan-boundary-contract.test.ts`, `tests/direct-first-routing-contract.test.ts`, and active-doc stale-reference checks: retired templates and old path contracts are gone from current surfaces.
- `scripts/sync-dist-docs.ts --check`: generated reference mirrors remain byte-aligned.

Slice 1 implementation also runs complete `bun test`, `bun scripts/sync-dist-docs.ts --check`, package/runtime smoke checks, and `git diff --check` before release. Full-suite execution is a release check, not an acceptance verification descriptor, because Kernel QA descriptors must remain focused and acceptance-specific.

## Execution Slices

### Slice 1 - Cutover release

One coherent Critical TaskIntent owns permanent paths, the one-release migrator, settlement changes, host/CLI gates, retirement, docs, and focused tests. These share one authority transition and cannot be independently promoted or rolled back safely.

Implementation order:

1. Add failing focused tests and permanent `storage_paths.ts` plus the read-only layout/precedence contract.
2. Move active authority and terminal settlement to state/audit paths, including recoverable marker replay.
3. Add the one-release migrator and shared CLI/Pi gate; keep legacy audit strictly historical.
4. Update Git ignore/diff identity, repository durability, docs, and retire templates/MEMORY/active-v2 compatibility source.
5. Run focused checks, full release checks, freeze artifacts, and complete assurance under the old installed runtime.

### Slice 2 - Immediate successor release

Dependency: cutover release shipped and this repository's automatic migration diff committed. Owner: Kernel/runtime maintainers.

Result: delete the migrator, all migration-success compatibility code, temporary old-root test branch, and corresponding contract text; retain only a permanent fail-closed `legacy_storage_layout_unsupported` detector. This Slice receives its own TaskIntent, verification, rollback, and critical authorization after the dependency is observable. It is not authored in advance.

## Devil's Advocate Audit

### Blocking findings resolved

- Reference-closure drift: Executor proved that the original scope named deleted `project_migration.ts` and nonexistent `kernel-store-security.test.ts` while omitting current lifecycle owners, the retained legacy audit reader, legacy observation writers, and direct old-layout fixture tests. TaskIntent revision 2 replaces those ghost paths with the exact current caller/test inventory before implementation resumes.
- Installed-but-unmigrated ownership: every stateful entrypoint uses one layout gate; read-only paths report without writes, mutation paths migrate/recover then stop.
- Multi-file terminal crash window: the terminal marker has explicit ordered convergence, fsync points, exact replay, and blocks all authority interpretation until recovery.
- Rollback ambiguity: Git plus plugin downgrade is valid only before the first new-layout Enrollment; after that boundary the release is roll-forward-only.
- Mixed authority precedence: the table above defines marker, claim, active record, terminal pair, stale claim, legacy, duplicate, and malformed combinations.

### Advisory accepted

- Migration uses a frozen hash manifest rather than a generic marker.
- Terminal-proof immutability is defined as create-once application behavior.
- Historical parsers are separated from authority resolution and tested as non-authoritative.
- Verification covers every declared migration and settlement interruption boundary.

### Advisory rejected

- An explicit migration command conflicts with confirmed `BR-DEC-004`.
- Migrating only this repository in the cutover commit does not satisfy `BR-REQ-001` for all target projects and cannot safely move the cutover task's active record.
- A bounded old-runtime normal reader conflicts with `BR-OUT-004`; old-path access remains isolated to the one-release migrator and historical audit.

## Brainstorm Trace

| ID | Status | Mapping |
| --- | --- | --- |
| BR-REQ-001 | covered_by_step | Permanent layout and Slice 1 migrator apply to every target repository. |
| BR-REQ-002 | covered_by_step | Permanent Storage Contract and Git verification define ignored state/tracked audit. |
| BR-REQ-003 | covered_by_step | Per-task audit pair is the terminal evidence contract. |
| BR-REQ-004 | covered_by_step | Terminal settlement sequence and marker replay transfer authority atomically. |
| BR-REQ-005 | covered_by_step | Shared gate keeps reads zero-write and automatically migrates eligible mutation. |
| BR-REQ-006 | covered_by_step | `migration_completed` stops the operation; dirty affected paths block retry until committed. |
| BR-REQ-007 | covered_by_step | Verification Strategy covers every named direct failure surface. |
| BR-DEC-001 | captured_as_decision | Active or pending old authority blocks migration. |
| BR-DEC-002 | captured_as_decision | Terminal and legacy machine evidence relocate without schema rewrite. |
| BR-DEC-003 | captured_as_decision | Exact affected Git paths must be clean; index is never mutated; unrelated dirt is allowed. |
| BR-DEC-004 | captured_as_decision | No migration command or Skill; shared mutating gate owns automatic migration. |
| BR-DEC-005 | deferred | Slice 2 deletes the one-release reader in the immediate successor release; dependency is cutover activation. |
| BR-DEC-006 | captured_as_decision | No backup or rollback command; Git plus downgrade before new Enrollment only. |
| BR-DEC-007 | captured_as_decision | Manifest replay accepts exact bytes and rejects any collision mismatch. |
| BR-DEC-008 | captured_as_decision | Existing evidence schemas/bytes and retention remain unchanged; no new sensitive fields. |
| BR-DEC-009 | covered_by_step | Known machine v3 evidence moves to `audit/legacy-v3`; production writes stop. |
| BR-DEC-010 | covered_by_step | Template source and current contract/test ownership are deleted; historical facts remain. |
| BR-OUT-001 | out_of_scope | No authority or planning schema changes. |
| BR-OUT-002 | out_of_scope | No planning directory reorganization or evidence backfill. |
| BR-OUT-003 | out_of_scope | No worktree or remote repository operations. |
| BR-OUT-004 | captured_as_decision | Normal runtime has no old-layout dual read or active online migration. |
| BR-DEFER-001 | deferred | Slice 2 owner, objective dependency, deletion result, and hard-fail successor behavior are explicit above. |
