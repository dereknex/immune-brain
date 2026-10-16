# Content-bound delivery authority

**Status**: candidate decomposition. The user approved the four-Slice split, the `manual|auto` preference with `manual` default, hidden-ref Lane commits, and retirement of native Parent delivery consolidation. One dependency delta (S2 now also waits for S3) is pending confirmation before publication. This document grants no execution authority.
**Initiative name**: Content-bound delivery authority
**Immutable slug**: `content-delivery-authority`
**Carrier**: GitHub, selected by root `AGENTS.md` (`Initiative carrier default: github`).
**Planning baseline**: `2f4d4e5` (after #252 merged); recheck affected paths if HEAD changes before Enrollment.
**Document language**: English; user discussion remains Chinese.
**Design risk**: High — settlement and delivery authority semantics, a retired Parent route, batch Git lineage ownership, and a new user preference change across both Hosts.
**Execution posture**: characterization-first for S1 and S2: reproduce the observed dead end (settled critical delivery with no reachable commit path; rejected preflight leaving a commit) at the existing public seam before changing behavior. No RED/GREEN authority steps.
**Design views**: component interfaces, state transitions, data flow.
**Threat model and supported environment**: inputs are the repository's own Git state, Kernel store and tracked instruction files, written by the user or the runtime on the user's machine; no adversary beyond accidental or habitual Git operations by the user. Supported: SHA-1 and SHA-256 Git object formats, UTF-8 paths, macOS and Linux, Claude and Pi Hosts.

## Outcome

Git is a user-owned carrier, never delivery authority. A Slice that settled `done` with an unchanged TaskIntent is delivered, wherever its bytes currently live (any commit, the index, or the working tree). Immune-Brain never requires a commit it made, a clean working tree, a dedicated branch, a commit trailer, or a commit order to proceed, and by default never writes a commit to the user's branch. Users who want runtime-made commits opt in with `Git integration: auto`.

## Sources

No Brainstorm manifest exists. Decisions were confirmed in this Brainstorm/Planner conversation (2026-10-16) and are recorded as Spec-local sources.

| Source | Evidence or decision |
| --- | --- |
| U1 | User decision: "git 操作每个用户的习惯和偏好不同，不应该成为硬门槛阻碍" — Git is user-owned carrier; content bound by Review is the authority. |
| U2 | User decision: keep runtime commits only as an opt-in preference `Git integration: manual\|auto`, default `manual`. |
| U3 | User decision: Lane worktree commits are internal, live only on hidden refs, never on the user's branch; results return to the working tree. |
| U4 | User decision: minimize workflow friction — settled is delivered; no delivery receipt store, no integrate gate, no separate prerequisite/edge-consistency Slice, one dirt rule, report wording folded into behavior Slices, Stop hook nudges once. |
| U5 | User decision: retire the #252 native Parent delivery consolidation (option A). |
| E1 | `runtime/unattended/batch_git.ts:881–933` `observeParentCompletion` counts a Task delivered only through `lookupBatchCommit` or consolidation; settled-but-uncommitted content is "missing". |
| E2 | `runtime/unattended/batch_git.ts:936–985` `observeNativeParent` returns `null` while any non-critical Task is unsettled; `integrate` action plus `advanceNativeParent:1062–1083` gate and `commitBatchChild`. |
| E3 | `runtime/github_issue_tracker.ts:881–920` `assertIsolatedTaskPrerequisites` delegates to `observeParentCompletion` for local and GitHub carriers. |
| E4 | `runtime/unattended/batch_preflight.ts:565–618` `prepareBatchPreflight` commits `.imm/audit/`, `docs/plans/`, `docs/specs/` and child-scope dirt, then rejects `working_tree_dirty` with the commit left behind. |
| E5 | `runtime/assurance/workflow_autocommit.ts` is the single precondition-commit owner; callers `assurance/enrollment_git_base.ts:96–120`, `kernel/storage_layout_migration.ts:205–213`, `unattended/batch_preflight.ts:597`. ADR 0023 and `BASELINE.md` Shared Guards authorize silent precondition commits. |
| E6 | `runtime/unattended/batch_integration.ts` and `batch_lanes.ts` integrate Lane commits by fast-forwarding the checked-out batch branch `imm/<slug>`; `batch_preflight.ts` binds `batch_branch`/`base_head` lineage. |
| E7 | `runtime/assurance/run_continuation.ts:64,278–283` `UNCHANGED_CONTINUATION_LIMIT = 2`; `runtime/claude/run_continuation.ts:270` block reason "Continue the authorized Loop" with no user-wait guidance. Session d23d2572 repeated the same user request three times. |
| E8 | botline evidence (read-only, 2026-10-16): S5 `phase1-admin-access` snapshot = current = `sha256:ee79aad2…88d4ed8` in manual commit `55755cb`; S6 `phase1-enrollment` snapshot = current = `sha256:773e7b84…49b0` staged, with an out-of-scope staged path that makes `taskStatusIdentity` refuse; Issue #251. |
| T1 | Delegated technical choice: final verification binds a scoped content identity of the working tree instead of `HEAD`. |
| T2 | Delegated technical choice: batch progress lives on hidden ref `refs/imm/batches/<batch_id>` built with plumbing (`commit-tree`, temporary index); the user's HEAD, branch and index are never moved by the batch. |
| T3 | Delegated technical choice: the preference is one line `- Git integration: manual` or `- Git integration: auto` in the tracked repository root `AGENTS.md` or `CLAUDE.md`; absent means `manual`; an invalid value means `manual` with a visible diagnostic. |

## User scenarios

| ID | Slice | Mode | Given / When / Then | Acceptance |
| --- | --- | --- | --- | --- |
| SCN-1 | S1 | automated | Given a critical Slice settled `done` whose bytes the user committed by hand (or left staged next to an unrelated staged file), when its dependent Slice enrolls or the Parent is entered, then the prerequisite counts as delivered and no runtime commit or integrate gate occurs. | S1-AC1, S1-AC2 |
| SCN-2 | S2 | automated | Given a dirty working tree whose dirt lies outside every not-yet-executed child's scope, when a batch starts and is rejected or runs, then `git log` on the user's branch gains no commit and the user's branch and index are unchanged. | S2-AC1, S2-AC2 |
| SCN-3 | S4 | automated | Given a bound run waiting on an action only the user can perform, when the session stops twice without progress, then the hook nudges at most once and then pauses. | S4-AC1 |
| SCN-4 | S3 | automated | Given `Git integration: auto`, when a task settles `done`, then exactly its settled scoped paths are committed; given no directive, nothing is committed. | S3-AC1 |
| SCN-5 | S1 | manual | botline S5 and S6 settle through the released plugin from the Parent/Child entry without any history repair. Manual reason: needs the real botline repository, its Kernel store and GitHub carrier. | — |

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D1 | A required Task is delivered iff its settled evidence is `done` and the current TaskIntent content hash equals the settled intent hash. Git commits, consolidation receipts and batch commit evidence are not consulted for delivery. | U1 |
| D2 | Native Parent has no `integrate` action and no integrate gate; settled deliveries need no runtime commit. Parent completion = every required Task delivered (D1) + final verification passed on the current scoped content identity. | U4 |
| D3 | Final verification binds the scoped content identity of the working tree over the union of required Tasks' scopes; a user commit, amend, branch switch with equal content, or stash/unstash round trip leaves it valid; a content change inside the union invalidates it. Legacy reports bound to `head` remain valid only while `HEAD` equals that value. | T1 |
| D4 | Native Parent delivery consolidation is retired: source, schema, MCP/Pi parameters, receipts handling and contract text are deleted. Existing `.consolidation.json` files are ignored. | U5 |
| D5 | Prerequisite checks keep delegating to Parent completion and therefore become settlement-based with D1; no tracker-edge consistency check is added. | U4, E3 |
| D6 | The read-only status identity (`taskStatusIdentity`) never refuses because of out-of-scope staged or dirty paths; it returns them as a warning beside the in-scope identity. Frozen snapshots (Review submission, QA binding) keep the existing authorization-envelope refusal. | E8 |
| D7 | Completion reports state the settled scoped content hash and changed paths and say the user may commit however they prefer; no next action routes to "integrate settled deliveries". | U4 |
| D8 | `Git integration` preference: `manual` (default) — the runtime writes no commit to the user's branch: Enrollment stages the TaskIntent and bound Spec instead of committing them, unborn-HEAD in-scope dirt is claimed as task work, layout migration leaves its diff in the working tree. `auto` — current precondition commits remain and a task settling `done` in the user's working tree commits exactly its settled scoped paths. ADR 0024 supersedes ADR 0023. The confirmed empty root commit for an unborn HEAD is unchanged in both modes. | U2, T3 |
| D9 | Batch preflight never commits. It blocks only on dirty paths inside the scope of a child that has not settled; all other dirt is ignored. | U4, E4 |
| D10 | A batch never switches, creates or commits to a user-visible branch. Its progress and Lane bases live on hidden ref `refs/imm/batches/<batch_id>`; Lane integration advances the hidden ref and applies the Lane's scoped delta to the user's working tree; a conflicting local edit on those paths parks the child with the named paths. Under `auto`, the applied delta is committed through D8's settle commit. | U3, T2 |
| D11 | The Stop hook blocks at most once per unchanged progress digest, then pauses (`UNCHANGED_CONTINUATION_LIMIT = 1`), and the block reason says that waiting on a user-only action is a valid stop that must not repeat the request. | U4, E7 |

## Technical Design

### Component interfaces

- `observeParentCompletion(root, slug, requiredTaskIds)` keeps its signature and `ParentCompletionObservation` shape. `integrated_task_ids` means "delivered" (D1); `final_passed` uses D3. Callers: `batch_kernel_port.ts:66`, `batch_runner.ts:62`, `github_issue_tracker.ts:896,919,1723`, `assurance/run_continuation.ts`.
- `observeNativeParent`/`advanceNativeParent` lose the `integrate` action, the `delivery_consolidation` input and `NativeParentEffects.integrate_task_ids`/`delivery_consolidation`. The native gate remains only for running final verification commands.
- Native Parent final report: `final_verification.content_identity` replaces `head` for new reports; `consolidation_digest` is no longer written and is ignored when read.
- `workspace_scope.ts` `taskStatusIdentity` returns `out_of_scope_paths` instead of throwing on an envelope escape; `assertNoEnvelopeEscape` stays for frozen snapshots.
- New `runtime/git_integration_preference.ts`: `readGitIntegrationPreference(root): { mode: "manual" | "auto"; diagnostic: string | null }`. Consumers: `enrollment_git_base.ts`, `storage_layout_migration.ts`, the settle-commit helper, `batch_lanes.ts`/`batch_runner.ts` apply step. Exposed in `status` output.
- Settle commit (`auto` only): one helper in `assurance/workflow_autocommit.ts` commits the settled snapshot's scoped changed paths with subject `imm(<task_id>): settled delivery`; invoked by both Hosts' completion paths (`claude/kernel_ports.ts`, `.pi-extension/pi-canary-assurance-progression.ts`) and by the batch apply step.

### State transitions

Task: `active → done | stopped` (unchanged). Delivery is derived, not stored: `done ∧ intent hash unchanged ⇒ delivered`. Native Parent actions become `drive | enroll | verify | repair | complete` (no `integrate`). Batch child `settled → integrated` now means "content recorded on the hidden ref (and applied to the working tree for Lanes)".

### Data flow

Settled evidence (Kernel store) → `observeParentCompletion` → prerequisite check / Parent action / continuation hook. Working tree scoped bytes → scoped content identity → final verification binding. Batch: working tree (serial child) or Lane worktree → plumbing tree → hidden ref commit → (Lane) scoped checkout into the user's working tree.

### Settlement-design enumeration (S1, S2)

- **Trigger sources**: Task terminal `done`/`stopped` via `advance_assurance`; user Git operations (commit, amend, reset, stash, branch switch, staging); TaskIntent edits; final verification completion or failure; batch child settle; Lane integration; session stop/end; interruption mid-plumbing.
- **State inventory**: Task lifecycle (unchanged); derived delivery; native Parent action; native final report (content identity binding); batch record hidden-ref head and child states; legacy consolidation receipts (ignored).
- **Terminal ownership**: Kernel settled evidence alone owns delivery. Final verification passing is owned by the recorded final report bound to content identity. Non-authoritative: commit presence, trailers, branch names, HEAD movement, tracker Issue state or edges, consolidation receipts.
- **Same-state-machine coverage**: `batch_git.ts` (`observeParentCompletion`, `observeNativeParent`, `advanceNativeParent`, `integrateSettledCriticalSlices`, `lookupBatchCommit`, `commitBatchChild`), `batch_state.ts` final-report/receipt parsing, `batch_runner.ts`, `batch_lanes.ts`, `batch_integration.ts`, `batch_preflight.ts`, `batch_kernel_port.ts`, `assurance/run_continuation.ts`, `github_issue_tracker.ts` prerequisite and completion paths, `claude/kernel_ports.ts`, `claude/mcp_server.ts`, `claude/interaction.ts`, `.pi-extension/imm-unattended-batch.ts`.

### Retirement completion

- S1 deletes `runtime/unattended/parent_delivery_consolidation.ts`, consolidation read/write in `batch_state.ts`, the `delivery_consolidation` MCP/Pi parameter and rendering, `tests/fixtures/parent-consolidation.ts`, the consolidation `describe` blocks, and the consolidation text in `dist/imm-run-batch.md`. Historical Specs under `docs/specs/` stay as history.
- S1 deletes the native `integrate` branch and its gate text.
- S2 deletes the preflight commit call, the `imm/<slug>` branch creation/switch, and their contract text.
- S3 deletes ADR 0023's authority by superseding it (status `superseded by 0024`) and rewrites the `BASELINE.md` precondition-commit bullet in all three copies.

## Devil's Advocate Audit

- **Rollback resilience**: each Slice is a revertible code change with no store migration; derived delivery means reverting S1 restores commit-based delivery without data repair. S2 hidden refs are disposable; reverting S2 leaves orphan `refs/imm/batches/*` that Git ignores. S3 defaults to `manual`; users wanting the old behavior set `auto`.
- **Verification vanity**: every acceptance names negative controls (changed intent, stopped task, in-scope edit after verification, in-scope dirt of an unsettled child, invalid preference value) so a happy-path-only implementation fails. botline-shaped fixtures (manual commit; staged with an unrelated staged file) reproduce the real failure before the fix.
- **Spec dilution detection**: the user-visible promise — no hard Git gate and no default runtime commit on the user branch — maps to S1-AC1/AC2, S2-AC1/AC2, S3-AC1; retirement is a deletion condition, not an absence test; SCN-5 keeps the real botline recovery visible as manual evidence.
- **Accepted risk (U1)**: Immune-Brain no longer proves bytes are in Git. A user who discards settled bytes is caught by final verification on the current content (D3), not by delivery checks.

## Slices and acceptance mapping

| Slice | Task ID | Result when landed alone | Risk | Blocked by |
| --- | --- | --- | --- | --- |
| S1 | `content-delivery-authority-s1-settled-delivery` | Settled Slices count as delivered regardless of Git; native Parent has no integrate gate; consolidation retired; reports give the content hash. | critical | — |
| S2 | `content-delivery-authority-s2-batch-hidden-ref` | Batches never commit to or switch the user's branch; preflight has one dirt rule and no side effect on rejection. | critical | S1, S3 |
| S3 | `content-delivery-authority-s3-git-integration-preference` | `manual` default writes no runtime commit outside batches; `auto` restores commits and adds settle commits; ADR 0024. | critical | S1 |
| S4 | `content-delivery-authority-s4-stop-hook-single-nudge` | Unchanged progress gets one nudge then a pause, with user-wait guidance. | routine | — |

Agreed seams: S1 — `tests/goal-driven-batch-run.test.ts` (native Parent and prerequisites), `tests/batch-completion-verifier.test.ts` (completion and final binding), `tests/unattended-batch-commit.test.ts` and `tests/claude-batch-authority.test.ts`/`tests/pi-batch-authority.test.ts` (route surface and retirement). S2 — `tests/unattended-batch-run.test.ts`, `tests/unattended-batch-lanes.test.ts`, `tests/unattended-batch-integration.test.ts`. S3 — `tests/git-integration-preference.test.ts` (new), `tests/enrollment-git-base.test.ts`, `tests/kernel-storage-layout-migration.test.ts`, `tests/workflow-autocommit.test.ts`. S4 — `tests/claude-run-continuation.test.ts`, `tests/run-continuation.test.ts`.

## Discovery evidence

Concrete paths are listed in each TaskIntent `scope_hint`. Generated mirrors: `plugins/immune-brain/dist/claude/mcp-server.mjs` (built by `scripts/build-claude-plugin.ts`), `BASELINE.md` copies in `plugins/immune-brain/skills/` and `plugins/immune-brain/dist/` (`scripts/dist-sync-manifest.ts`), `plugins/immune-brain/dist/docs/reference/immune-brain-config.md`. Each runtime Slice carries one `.changeset/*.md`.

## Out of scope

Status isolation for unrelated planning files, earlier goal-length/scenario validation, and leading-space command entry (retro P2/P3) are deferred; no Slice depends on them. Tracker `blocked_by` edge consistency is not checked (D5).
