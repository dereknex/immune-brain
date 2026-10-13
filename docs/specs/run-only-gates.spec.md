# Run-only gates

**Status**: Candidate; not enrolled.
**Design risk**: High — it removes two cross-Host guards from the entry state machine, lets the runtime create Git commits without a separate confirmation, and changes Enrollment, batch-start and storage-migration preconditions that both Hosts share.
**Execution posture**: characterization-first for S2–S4 (pin today's refusal text and the exact dirty sets before replacing the refusal with a commit); test-first for S1 on the pure module and the two Host hooks.
**Document language**: English, following the Planner document-language default.
**Source**: Brainstorm framing of 2026-10-13 in the same Claude Code session (manifest `BR-1`–`BR-7`, `BR-X1`–`BR-X3`, `BR-SCN-1`–`BR-SCN-5`), followed by literal Planner entry. The Initiative name, slug and four-Slice decomposition were confirmed by the user in the Planner on 2026-10-13.
**Relation to earlier work**: supersedes decisions G4 and G5 of `docs/specs/planner-skill-self-entry.spec.md` (ADR 0020) and T3, D7–D9 of `docs/specs/ceremony-trim-r647.spec.md`. It replaces the fail-closed outcome of the TaskIntent `enrollment-dirty-scope-fail-closed` for the paths named in T2. ADR 0019's decision — Enrollment is the first step of a literal-user `imm-run` entry — is unchanged. Earlier Specs and ADRs are not rewritten.

## Outcome

`imm-run` is the only place where Immune-Brain stops the user. Planning and clarification are never denied, and a precondition that today asks the user to commit by hand is satisfied by a commit the runtime makes itself.

- A model Skill call for `imm-planner` or `imm-brainstorm` no longer revokes the session's run entry.
- A session whose latest entry is a plan entry may edit any file; the `revision_owner_required` guard and its source are deleted.
- Enrollment, a new batch start and the storage-layout migration commit the paths they need committed, silently, and continue.
- Dirt that the runtime may not commit stops execution only inside `imm-run`, once, with the paths listed.

## User decisions

| ID | Decision | Source |
|---|---|---|
| BR-1 | Remove the run-entry revocation that a model entry into `imm-planner` or `imm-brainstorm` causes. | Brainstorm Q3, 2026-10-13. |
| BR-2 | Remove the `revision_owner_required` edit guard for plan-entry sessions. | Brainstorm Q3. |
| BR-3 | The Planner and Brainstorm are never blocked by a commit or Git state; the migration diff is committed automatically. | Original request; Brainstorm Q1. |
| BR-4 | Automatic commits are silent: no disclosure, no confirmation. The committable set is workflow-owned files (Spec, TaskIntent, migration and audit diff) plus dirty files inside the task `scope_hint`. | Brainstorm Q2, Q4. |
| BR-5 | An untracked or uncommitted TaskIntent/Spec, in-scope dirt at Enrollment, and the batch working-tree preflight all use BR-4. | Brainstorm Q1. |
| BR-6 | Every denial reachable outside `imm-run` is inventoried on both Hosts and given a disposition. | Brainstorm Q1 (free-text addition). |
| BR-7 | Contract text and ADRs follow: a new ADR supersedes ADR 0020 G4/G5 and ceremony-trim-r647 T3/D7–D9, and the clauses stating that staging grants no commit are rewritten for the automatic commit. | Repository evidence, accepted in the framing. |
| BR-X1 | `imm-run`'s own gates stay: `run_entry_required` on `enroll` and `start_unattended_batch`, the native Enrollment confirmation, and the confirmations for stop, retire and authorization. | Brainstorm scope. |
| BR-X2 | Dirt outside the scope is never committed automatically; if it still blocks a batch it is reported once, inside `imm-run`, with its paths. | Brainstorm Q4. |
| BR-X3 | Push, publication and history rewrite are never automatic. | Brainstorm scope. |
| P1 | The Initiative is `Run-only gates`, slug `run-only-gates`, carried on GitHub, in four serial Slices S1→S2→S3→S4. A literal `/imm-planner` or `/imm-brainstorm` prompt still revokes the run entry; BR-1 removes the model-entry revocation only. | User, Planner decomposition question, 2026-10-13. |

## User scenarios

| ID | Mode | Scenario | Slice | Acceptance |
|---|---|---|---|---|
| BR-SCN-1 | automated | Actor: user in a Claude Code session. Given a live `imm-run` entry and no active claim, when the user asks in natural language for a Spec or TaskIntent and the model loads `imm-planner`, then the Spec and TaskIntent are drafted with no denial, and a later Enrollment in the same session opens the native dialog without a fresh `/imm-run`. | S1 | ROG-S1-A2 |
| BR-SCN-5 | automated | Actor: user in a plan-entry session. Given another session is executing a task, when the user edits a file inside that task's scope, then the edit succeeds without `revision_owner_required`. | S1 | ROG-S1-A3 |
| BR-SCN-2 | automated | Actor: user running `imm-run`. Given a drafted Spec and TaskIntent that are untracked, plus modified files inside the task `scope_hint`, when Enrollment starts, then the user sees Enrollment proceed and `git log` shows a new commit containing exactly those paths, with no request to commit by hand. | S2 | ROG-S2-A2 |
| BR-SCN-3 | automated | Actor: user starting an unattended batch. Given a working tree whose only dirt is workflow files and in-scope files, when the batch starts, then it starts without a `dirty_working_tree` rejection. | S3 | ROG-S3-A1 |
| BR-SCN-4 | automated | Actor: the same user. Given additional dirty files outside every child scope, when the batch starts, then those files are left uncommitted and the user sees one message listing them. | S3 | ROG-S3-A2 |

## Decision trace

| ID | Decision | Source |
|---|---|---|
| D1 | The model-entry revocation is the `appendPhaseEntry(sessionId, "plan", …)` call in `phaseEntryGateHookOutput`; removing it makes a Planner or Brainstorm Skill call a pure pass-through on Claude Code. Pi never observed a model Skill read, so Pi needs no change for BR-1 and the Pi gap recorded in ADR 0020 closes. | Repository evidence: `plugins/immune-brain/runtime/claude/lane_guard.ts:198-207`. |
| D2 | `PhaseEntryState.plan_latest` has one reader, the revision-owner guard. With the guard deleted the field, its reducer branches and the unused `context` parameter of `admitPhaseOperation` are removed. A literal plan entry still sets `run_live: false` (P1). | Repository evidence: `runtime/assurance/phase_entry.ts:66-78,117-121`; `runtime/assurance/revision_owner.ts:38,74`. |
| D3 | BR-2 is retirement-class: `runtime/assurance/revision_owner.ts`, `revisionOwnerHookOutput`, `piRevisionOwnerRefusal`, their call sites, `tests/revision-owner-guard.test.ts`, `tests/revision-owner-contract.test.ts` and the contract sentences in `dist/imm-planner.md` and `dist/imm-run.md` are deleted, not walled off. | Planner Retirement Completion Contract; repository evidence listed in Discovery. |
| D4 | The `Edit\|Write\|MultiEdit\|NotebookEdit` PreToolUse matcher stays in `hooks/hooks.json`: the Lane guard still needs it. Only the hook description changes. | Repository evidence: `runtime/claude/mcp_server.ts:757`. |
| D5 | One host-neutral module, `runtime/assurance/workflow_autocommit.ts`, owns every automatic commit. Callers pass an explicit path list and a subject; the module never derives paths itself. | Delegated technical choice: one owner for the commit invariants I4–I8; co-located with `enrollment_git_base.ts`, the existing precedent for a runtime-made commit. |
| D6 | A commit is made only when a precondition would otherwise fail. A clean precondition makes no commit and no empty commit. The Planner keeps staging its artifacts and still never commits. | Delegated technical choice from BR-4 ("when a commit is needed"); keeps `dist/imm-planner.md:142,198-202` true. |
| D7 | Commits use an explicit pathspec (`git add -- <paths>` for untracked paths, then `git commit --only -- <paths>`), so index content outside the list is neither committed nor unstaged. Hooks run normally; `--no-verify`, `--amend`, `-a`, `git add -A` and `git add .` are never used. Identity follows `identityEnv` in `enrollment_git_base.ts`: existing environment or config, then the automation fallback, never a config write. | Delegated technical choice; repository evidence `runtime/assurance/enrollment_git_base.ts:32-44`; BASELINE Shared Guards on broad staging. |
| D8 | Commit subjects follow the repository's conventional format: `chore(imm): commit Enrollment preconditions for <task-id>`, `chore(imm): commit batch preconditions for <initiative-slug>`, `chore(imm): commit storage-layout migration`. | Delegated technical choice; repository evidence `git log` and `enrollment_git_base.ts:68`. |
| D9 | At Enrollment the commit runs before `preparePiCanary`, so the native confirmation binds the post-commit `git_base_head` and digest. With an unborn HEAD it runs after `initializeEnrollmentGitBase` and re-prepares the same way that function already does. | Repository evidence: `runtime/claude/kernel_ports.ts:392-408`, `.pi-extension/imm-canary-enroll.ts:441-543`, `enrollment_git_base.ts:72-76`. |
| D10 | The Enrollment committable set is: the result of `dirtyScopePaths` for the task, the task's own TaskIntent path, and the Spec path its binding names, each only when dirty. | BR-4; repository evidence `runtime/kernel/enrollment.ts:213-224`, `runtime/workspace_scope.ts:423-431`. |
| D11 | The Kernel refusal in `enrollWithPreconditions` stays as the last line of defence, reworded: it no longer tells the user to commit, and after D9 it is reachable only when the commit itself failed or a path changed in between. | Delegated technical choice: authority code keeps its fail-closed check; BR-5 removes the user-facing demand, not the invariant. |
| D12 | For a new (non-resuming) batch the committable set is: every dirty path under `.imm/audit/`, `docs/plans/` and `docs/specs/`, plus dirty paths matching the union of the enrollable children's `scope_hint`. The commit runs in the Host before the batch binding is prepared, so `base_head` and the plan digest bind the post-commit HEAD. | BR-4, BR-5; repository evidence `runtime/unattended/batch_preflight.ts:588-614,631-632` (the resume branch already treats those three prefixes as workflow paths). |
| D13 | Remaining dirt keeps the `working_tree_dirty` rejection, now with the remaining paths in its reason and a recovery action that names them instead of asking for a commit. The resume-time rejections (`working_tree_unstaged`, `working_tree_out_of_scope`, `authorized_scope_underivable`) are unchanged: they describe in-flight delivery, not a commit demand. | BR-X2; repository evidence `runtime/unattended/batch_reasons.ts:84-100`. |
| D14 | `imm-kernel migrate --storage-layout` commits its affected paths itself and reports `ready`. Every consumer of `migration_uncommitted` (Enrollment on Pi, the Kernel CLI stateful commands, `intent author`) commits the affected paths and continues instead of stopping. | BR-3; repository evidence `runtime/commands/kernel.ts:535,1315-1334,1422-1446`, `.pi-extension/imm-canary-enroll.ts:316-361`. |
| D15 | `intent author` still does not convert a `migration_required` layout implicitly, and `recovery_required`, `migration_blocked_active` and `invalid` stay errors: they are not commit states. The Planner contract tells the Planner to run `imm-kernel migrate --storage-layout` itself and retry, so the user is not interrupted. | Repository evidence: `runtime/commands/kernel.ts:520-522` ("Authoring never migrates implicitly"); BR-3 covers commit and Git state only. |
| D16 | Two ADRs: 0022 for the entry guards (S1), 0023 for the silent automatic commit (S2), amended by S3 and S4 only if their behaviour differs from it. | Delegated technical choice: each ADR lands with the Slice that first makes it true; BR-7. |

### BR-6 inventory: denials reachable outside `imm-run`

| Denial | Where | Host | Disposition |
|---|---|---|---|
| `phase_entry_required` for the Planner or Brainstorm Skill | 5.2.0 only; removed by `planner-skill-self-entry` | Claude | Already gone in 5.3.0. No work. |
| Run-entry revocation on a model Planner/Brainstorm entry | `claude/lane_guard.ts:201-206` | Claude | Removed, S1. |
| `revision_owner_required` on file edits | `claude/lane_guard.ts:178-187`, `.pi-extension/imm-canary-work.ts:369-376` | both | Deleted, S1. |
| Lane guard (edits outside a batch Lane) | `claude/lane_guard.ts` `laneGuardHookOutput` | Claude | Kept: it runs only inside a batch Lane, which is `imm-run` work (BR-X1). |
| `phase_entry_required` for the `imm-run` Skill; `run_entry_required` for `enroll`, `start_unattended_batch` | `assurance/phase_entry.ts:122-128` | both | Kept (BR-X1). |
| `layout_migration_required` / not-ready layout in `intent author` | `commands/kernel.ts:505-545` | both | Commit demand removed, S4 (D14, D15). |
| `routing_policy_invalid` | `managed_task_routing_policy.ts` | both | Kept: it reports a malformed or tampered policy file, not a commit or entry state. Automatic activation already stages the file without asking. |
| `intent author` refusing an existing path; `intent validate` reporting `enrollment_ready: false` for an untracked TaskIntent | `commands/kernel.ts:1174-1191` | both | Kept: the first protects an existing TaskIntent; the second is a read-only projection the Planner satisfies by staging. |
| Tracker publication failing closed on a missing label or carrier conflict | `bin/imm-tracker` | both | Kept: remote validation, reported as a failure with a retry action. |
| "task scope is already dirty before Enrollment … commit, stash or revert" | `kernel/enrollment.ts:213-224` | both | Replaced by an automatic commit, S2. |
| `working_tree_dirty` on a new batch | `unattended/batch_preflight.ts:611-612`, `unattended/batch_git.ts:118-146` | both | Replaced by an automatic commit for the committable set, S3. |
| `migration_uncommitted` stopping Enrollment | `.pi-extension/imm-canary-enroll.ts:355-361`, `commands/kernel.ts:1439-1446` | both | Replaced by an automatic commit, S4. |

## Out of scope

- The gates listed under BR-X1, and every confirmation inside a run.
- Committing dirt outside the committable sets of D10 and D12 (BR-X2).
- Push, publication, history rewrite (BR-X3).
- The literal-entry revocation (P1).
- Resume-time batch rejections (D13) and the delivery staging rules of an enrolled task (`workspace_scope.ts:462-466,603-610`): they are `imm-run` internals and ask for staging, not a commit.
- Refreshing an installed plugin cache. The `phase_entry_required: imm-planner …` message the user saw is 5.2.0 text; a session started after the 5.3.0 update does not produce it.

## Discovery evidence and reference closure

- Entry state machine: `runtime/assurance/phase_entry.ts`; Claude owner `runtime/claude/lane_guard.ts` (hook functions) wired in `runtime/claude/mcp_server.ts:15,757`; Pi owner `.pi-extension/imm-canary-work.ts:139-146,340-376` and its `tool_call` registration.
- Revision-owner guard: `runtime/assurance/revision_owner.ts`; tests `tests/revision-owner-guard.test.ts`, `tests/revision-owner-contract.test.ts`, `tests/dual-host-assurance-conformance.test.ts:21,2784-2819`.
- Entry tests: `tests/phase-entry.test.ts`, `tests/claude-phase-entry-skill-gate.test.ts`, `tests/claude-phase-entry-gate.test.ts`, `tests/pi-phase-entry-gate.test.ts`.
- Entry contract text: `plugins/immune-brain/BASELINE.md:60-62` and its two byte-identical copies (`dist/BASELINE.md`, `skills/BASELINE.md`), `dist/imm-planner.md:15-16,514-523`, `dist/imm-run.md:178-185`, `hooks/hooks.json` description; contract tests `tests/explicit-phase-entry-planner-contract.test.ts`, `tests/explicit-phase-entry-run-contract.test.ts`, `tests/baseline-packaging-contract.test.ts`, `tests/dist-docs-sync-contract.test.ts`.
- Enrollment: Kernel `runtime/kernel/enrollment.ts:186-236`; scope helper `runtime/workspace_scope.ts:45-58,418-431`; Host callers `runtime/claude/kernel_ports.ts:392-420` and `.pi-extension/imm-canary-enroll.ts:430-560`; Git precedent `runtime/assurance/enrollment_git_base.ts`; tests `tests/enrollment-dirty-scope.test.ts`, `tests/enrollment-git-base.test.ts`, `tests/claude-host-authority.test.ts`, `tests/pi-canary-enroll-extension.test.ts`.
- Batch start: `runtime/unattended/batch_preflight.ts:560-650,860-930`, `runtime/unattended/batch_git.ts:80-160`, `runtime/unattended/batch_reasons.ts:84-100`; Host callers `runtime/claude/kernel_ports.ts` (`start_unattended_batch`) and `.pi-extension/imm-unattended-batch.ts`; tests `tests/unattended-batch-run.test.ts`, `tests/unattended-batch-commit.test.ts`, `tests/claude-batch-authority.test.ts`, `tests/pi-batch-authority.test.ts`.
- Migration: `runtime/kernel/storage_layout_migration.ts`, `runtime/kernel/storage_paths.ts:835-852`, `runtime/commands/kernel.ts:500-545,1300-1340,1400-1450`, `.pi-extension/imm-canary-enroll.ts:316-361`; tests `tests/kernel-storage-layout-migration.test.ts`, `tests/kernel-migrate.test.ts`, `tests/kernel-intent-authoring.test.ts`.
- Commit-authority contract text: BASELINE Shared Guards ("Stage only explicit task-owned paths…", "Grant effects separately…") and Host Confirmation Boundary; `dist/imm-run.md:89`; `tests/workflow-effect-boundaries.test.ts:190-210`.
- Packaged mirror: `plugins/immune-brain/dist/claude/mcp-server.mjs` is built from the runtime by `scripts/build-claude-plugin.ts` and checked by `tests/claude-host-package.test.ts`; every Slice that edits bundled runtime rebuilds it. Each Slice adds one `.changeset/*.md`.

## Technical Design

**Design views**: state transitions (entry state; Enrollment and batch preconditions), service/component interfaces (the automatic-commit module and its callers), temporal sequence (commit before binding). Architecture layers and data flow are omitted: no layer boundary moves and no data crosses a new boundary.
**Diagram decision**: required
**Diagram reason**: the order of commit, preparation and native confirmation decides what the confirmation binds, and prose alone hides the unborn-HEAD branch.

```mermaid
sequenceDiagram
    participant U as User
    participant H as Host (enroll)
    participant C as workflow_autocommit
    participant K as Kernel
    U->>H: /imm-run (literal entry)
    H->>C: committable set (D10)
    alt set is non-empty
        C->>C: git add -- paths; git commit --only -- paths
    end
    H->>K: preparePiCanary (binds post-commit HEAD)
    H->>U: native Enrollment confirmation
    U-->>H: accept
    opt unborn HEAD
        H->>K: initializeEnrollmentGitBase
        H->>C: committable set again
        H->>K: re-prepare
    end
    H->>K: enroll (dirty-scope check passes)
```

### Invariants

- I1. No hook, tool or Kernel command denies `imm-planner` or `imm-brainstorm`, and neither changes the session's entry state when the model loads it.
- I2. `enroll` and `start_unattended_batch` are admitted only on a live literal-user run entry; the `imm-run` Skill likewise. A literal plan entry revokes; a later literal run entry restores.
- I3. No file-edit tool call is refused because of the session's entry state. The Lane guard is unaffected.
- I4. An automatic commit contains exactly the paths its caller listed and nothing else, whatever else is staged.
- I5. Paths outside the committable set are byte-identical in the worktree and the index before and after.
- I6. A clean precondition creates no commit.
- I7. A failed commit (hook rejection, identity error, lock) fails the operation with Git's message and creates no authority; nothing is retried with `--no-verify`.
- I8. No automatic commit pushes, amends, rewrites history, switches branch or writes Git config.
- I9. The native confirmation binds the HEAD that exists after the commit.
- I10. No user-facing message asks the user to commit by hand for a path inside a committable set.

### T1. Entry guards (S1; source BR-1, BR-2, D1–D4)

`phaseEntryGateHookOutput` answers null for a Planner or Brainstorm Skill call without touching the store and without reading the active claim. `PhaseEntryState` is `{ run_live }` only; `applyPrompt`, `reducePhaseEntryLog` and `admitPhaseOperation` lose `plan_latest` and `context`. `revision_owner.ts` and both Host adapters for it are deleted with their tests and contract sentences. BASELINE Workflow Activation and Planner Managed Request Routing drop the sentence that a model-entered Planner ends the run entry. ADR 0022 records the change.

### T2. Enrollment commit (S2; source BR-4, BR-5, D5–D11)

Interface: `commitWorkflowPaths(root, { paths, subject, signal? })` returns `{ committed: false }` for an empty or all-clean list, otherwise `{ committed: true, commit, paths }`; it throws with Git's stderr on failure. It rejects a path outside the repository, a symlink escape, an unmerged index and an index carrying `assume-unchanged` or `skip-worktree` flags on a listed path. Both Host `enroll` handlers compute the D10 set and call it at the points D9 names. The Kernel refusal text becomes a statement of the leftover paths (D11). BASELINE Shared Guards and Host Confirmation Boundary state that the runtime may commit a precondition's committable set and that this grants nothing else; `dist/imm-run.md` says the same at its staging rule. ADR 0023 records the decision and the BR-4 risk the user accepted.

### T3. Batch commit (S3; source BR-5, BR-X2, D12, D13)

Both Host `start_unattended_batch` handlers, for a non-resuming batch only, compute the D12 set from the enrollable children's TaskIntents and call `commitWorkflowPaths` before preparing the binding. `working_tree_dirty` then carries the remaining paths. The `git.preflight` clean-tree check in `batch_git.ts` is unchanged and passes because the tree is clean.

### T4. Migration commit (S4; source BR-3, D14, D15)

`migrate --storage-layout` and each `migration_uncommitted` consumer call `commitWorkflowPaths` with the reported `affected_paths` and continue. The journal's next action no longer says "commit". The Planner contract's Kernel TaskIntent Routing section says the Planner runs the migration itself when `intent author` reports `layout_migration_required`.

### Alternatives rejected

- Disclosing the commit in the native Enrollment confirmation (the unborn-HEAD precedent): rejected by the user in favour of a silent commit (BR-4).
- Dropping the dirty-scope precondition instead of committing: the Enrollment baseline would record the paths as user dirt and the task could never deliver them (`kernel/enrollment.ts:213-216`).
- Committing every dirty path: rejected by the user (BR-X2).
- Committing in the Planner right after authoring: more commits than preconditions need (D6).

### Compatibility, interruption, rollback

- A commit followed by a declined, cancelled or failed Enrollment or batch start leaves the commit in place; the result names it, as the unborn-HEAD flow already does. Retrying finds a clean precondition and makes no second commit (I6).
- Each Slice reverts independently with `git revert`; S3 and S4 depend on S2's module, so S2 is reverted last. Reverting S1 restores the guard and the revocation with their tests.
- Sessions started on an older plugin cache keep the old behaviour until restarted; no stored state changes shape except the in-memory `PhaseEntryState`, and an old log line (`{v:1, entry}`) still reduces.

### Settlement enumeration (S2–S4)

Trigger sources: Host `enroll`, Host `start_unattended_batch` (new batch), `migrate --storage-layout`, `intent author` on `migration_uncommitted`; interruptions are cancellation via the Host signal, a Git hook failure and a concurrent workspace change. States: precondition dirty → committed → prepared → confirmed → enrolled/started. Terminal ownership is unchanged: only the native confirmation plus Kernel enrollment settle authority; a successful `git commit` is a local signal and settles nothing.

## Verification and acceptance mapping

| Acceptance | Slice | Seam | Controls |
|---|---|---|---|
| ROG-S1-A1 pure entry state | S1 | `tests/phase-entry.test.ts` | positive: Planner/Brainstorm Skills admitted for fresh, live and null state; negative: `imm-run` Skill and both tools refused without a live entry; bound: literal plan line revokes, later run line restores, legacy log lines still reduce, malformed line is unreadable. |
| ROG-S1-A2 Claude hook, no revocation | S1 | `tests/claude-phase-entry-skill-gate.test.ts`, `tests/claude-phase-entry-gate.test.ts` | positive: after a run entry a model Planner or Brainstorm Skill call leaves the store unchanged and `enroll` is admitted; negative: with no run entry `enroll` is still denied `run_entry_required`; bound: a literal `/imm-planner` prompt still revokes. |
| ROG-S1-A3 guard deleted on both Hosts | S1 | `tests/dual-host-assurance-conformance.test.ts`, `tests/pi-phase-entry-gate.test.ts` | positive: an in-scope edit from a plan-entry session with an active claim is allowed on Claude and Pi; negative: the Lane guard still denies an out-of-Lane edit; bound: the Pi tool gate is unchanged. |
| ROG-S1-A4 contract and package | S1 | `tests/explicit-phase-entry-planner-contract.test.ts`, `tests/explicit-phase-entry-run-contract.test.ts`, `tests/baseline-packaging-contract.test.ts`, `tests/dist-docs-sync-contract.test.ts`, `tests/claude-host-package.test.ts` | contract sentences removed, three BASELINE copies identical, ADR 0022 present, bundle rebuilt. |
| ROG-S2-A1 commit module | S2 | `tests/workflow-autocommit.test.ts` (new) against real temporary repositories | positive: untracked, modified and staged listed paths land in one commit; negative: unrelated staged and unstaged paths stay byte-identical in index and worktree; bound: clean list makes no commit, failing `pre-commit` hook throws and commits nothing, flagged or unmerged index is refused. |
| ROG-S2-A2 Enrollment proceeds | S2 | `tests/enrollment-dirty-scope.test.ts`, `tests/claude-host-authority.test.ts`, `tests/pi-canary-enroll-extension.test.ts`, `tests/enrollment-git-base.test.ts` | positive: untracked Spec and TaskIntent plus modified in-scope file → Enrollment succeeds, HEAD advanced by one commit with exactly those paths, confirmation bound to the new HEAD; negative: out-of-scope dirt is untouched and does not block; bound: unborn HEAD still gets its empty root commit first, and a Kernel-level dirty scope still refuses without the word "commit". |
| ROG-S2-A3 contract | S2 | `tests/workflow-effect-boundaries.test.ts`, `tests/baseline-packaging-contract.test.ts`, `tests/dist-docs-sync-contract.test.ts`, `tests/claude-host-package.test.ts` | BASELINE and `imm-run` state the automatic commit and its limits; ADR 0023 present; bundle rebuilt. |
| ROG-S3-A1 batch starts | S3 | `tests/unattended-batch-run.test.ts`, `tests/claude-batch-authority.test.ts`, `tests/pi-batch-authority.test.ts` | positive: dirt limited to workflow paths and child scopes → one commit, batch bound to the new HEAD, no `working_tree_dirty`; bound: a clean tree makes no commit; a resuming batch makes no commit. |
| ROG-S3-A2 leftover dirt reported | S3 | `tests/unattended-batch-run.test.ts`, `tests/unattended-batch-commit.test.ts` | negative: an out-of-scope dirty file is left byte-identical, the start is rejected once with `working_tree_dirty` naming that path, and the recovery action does not ask for a commit of in-scope paths. |
| ROG-S4-A1 migration commits | S4 | `tests/kernel-storage-layout-migration.test.ts`, `tests/kernel-migrate.test.ts` | positive: migration ends `ready` with its affected paths in one commit; negative: unrelated dirt untouched; bound: `recovery_required` and `migration_blocked_active` still error. |
| ROG-S4-A2 consumers continue | S4 | `tests/kernel-intent-authoring.test.ts`, `tests/pi-canary-enroll-extension.test.ts`, `tests/imm-planner-kernel-intent-contract.test.ts` | positive: `intent author` and Enrollment on a `migration_uncommitted` layout commit and continue; bound: `migration_required` still needs the explicit command, and the Planner contract tells the Planner to run it. |

Every descriptor runs `bun test <files>` from the repository root with no preparation; `bun` is provided by the QA host and the tests use only tracked content and temporary directories.

## Devil's Advocate Audit

- **Rollback resilience**: an automatic commit that precedes a failed Enrollment remains in history. That is the accepted cost of BR-4; I6 makes a retry idempotent and the result names the commit so the user can revert it. A half-landed Initiative is safe at every Slice boundary: after S1 alone the commit demands still exist; after S2 alone batch and migration still ask.
- **Verification vanity**: asserting only "Enrollment succeeded" would pass if the runtime committed the whole tree. ROG-S2-A1 and ROG-S3-A2 therefore compare index and worktree bytes of unrelated paths and the exact path list of the commit. ROG-S1-A2 asserts the store bytes are unchanged, not merely that the Skill call returned null (it returns null today too).
- **Spec dilution**: BR-3 could quietly shrink to "reword the message". D14 requires the commit itself and ROG-S4-A2 requires the consumer to continue. BR-6 could shrink to a list; the inventory gives every row a disposition and a Slice or a reason. BR-2 could shrink to "stop calling the guard"; D3 requires deletion of source, tests and contract text.

## Brainstorm Trace

| Upstream | Closed as | Where |
|---|---|---|
| BR-1 | covered | S1, ROG-S1-A1, ROG-S1-A2 |
| BR-2 | covered | S1, ROG-S1-A3, ROG-S1-A4 |
| BR-3 | covered | S4, ROG-S4-A1, ROG-S4-A2 |
| BR-4 | covered | S2, ROG-S2-A1 (module invariants), reused by S3 and S4 |
| BR-5 | covered | S2 (ROG-S2-A2), S3 (ROG-S3-A1) |
| BR-6 | covered | inventory table above; changed rows map to S1–S4 |
| BR-7 | covered | S1 (ROG-S1-A4, ADR 0022), S2 (ROG-S2-A3, ADR 0023) |
| BR-X1, BR-X3 | out | Out of scope; guarded by I2 and I8 controls |
| BR-X2 | covered | S3, ROG-S3-A2; S2 negative control |
| BR-SCN-1, BR-SCN-5 | covered | S1 |
| BR-SCN-2 | covered | S2 |
| BR-SCN-3, BR-SCN-4 | covered | S3 |

## Delivery boundary

| Slice | TaskIntent | Result when it alone has landed | Remaining gap |
|---|---|---|---|
| S1 | `run-only-gates-s1-entry-guards` | Model planning keeps the run entry; plan-entry sessions edit freely. | All commit demands. |
| S2 | `run-only-gates-s2-enrollment-autocommit` | Single-task Enrollment never asks for a commit. | Batch start and migration. |
| S3 | `run-only-gates-s3-batch-autocommit` | A new batch starts over workflow and in-scope dirt. | Migration. |
| S4 | `run-only-gates-s4-migration-autocommit` | Migration and its consumers commit and continue. | None. |

Order: S1 → S2 → S3 → S4. S3 and S4 are blocked by S2 (shared module); all four share the packaged bundle, so they run serially.
