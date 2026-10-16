# Native Parent delivery consolidation

**Status**: candidate; no implementation or execution authority.
**Parent outcome**: finish `workflow-execution-reliability` (#246) without re-enrolling S1–S4 or the settled retirement repair.
**Document language**: English; user discussion remains Chinese.
**Design risk**: Material: native Git effects, delivery attribution and whole-plan completion proof change; Kernel lifecycle, authority store and TaskRecord formats do not.
**Execution posture**: characterization-first at existing Parent and Host seams.

## Outcome and sources

Close the observed gap where a delivered-only Parent cannot integrate two settled, uncommitted deliveries in one checkout. The final composition must receive its own QA and Review, not inherit byte-level approval from two different historical bundles. Include this implementation task itself in the final delivery so the repair does not recreate its own blocker.

| Source | Concrete evidence |
| --- | --- |
| E1 | `runtime/unattended/batch_git.ts`: `advanceNativeParent` commits one task at a time; `commitBatchChild` rejects every dirty path outside that task and binds its exact current diff to QA. |
| E2 | Existing S4 run `run-1910b918-73be-4dee-9fb3-6ec21f33cb0c`, review commit `09c5be690a81de88e56b3d4ee011d0ffc1097f7d`, and retirement-repair run `run-2eb39d3a-919d-4049-a502-897b13a668db`, review commit `c7940ef7ea6011560e6d01d22315d49bfa38e635`: both review revisions have parent `bd8ad00118c727f4f5c4d80f35402c99e39d3a59`, but their generated bundle blobs differ. |
| E3 | `recordParentRepair` requires an active exact enrollment and a genuinely failed final observation. No supported retrospective association exists for this settled standalone repair. Do not fabricate either prerequisite. |
| E4 | `runtime/unattended/batch_state.ts`: native final reports and commit evidence already live under `.imm/state/batches`; `observeParentCompletion` owns final-HEAD proof. |
| E5 | Pi `imm-unattended-batch.ts`, Claude `kernel_ports.ts`, `interaction.ts`, and `mcp_server.ts` carry the native Parent request, confirmation and result. |
| T1 | Delegated technical choice: one bounded consolidation capability in the existing native Parent path, with a newly QA/Review-approved final delivery; no generic transaction engine or scheduler. |

Runtime paths above are under `plugins/immune-brain/`.

**Threat model and supported environment**: trusted local repository operators, repository-owned Git objects and current Kernel records; Host request identities and workspace bytes are untrusted until validated. Retain existing Git object-format and macOS/Linux support. Cover wrong/missing/stopped run, modified audit, unowned dirty path, modified staged blob, changed HEAD, denied/cancelled gate and interrupted receipt persistence. No arbitrary hostile process, sandbox or new encoding support is promised.

## User scenarios

| Scenario | Given / When / Then | Acceptance |
| --- | --- | --- |
| SCN-1 | Retired batch, settled S4 plus independent repair and a settled consolidation task share one checkout; explicit native consolidation integrates one final reviewed composition, preserving every original terminal record. | AC1 |
| SCN-2 | Shared bundle differs between source deliveries; only the new consolidation task's frozen final bytes may become the final bundle. Original QA is not relabelled as proof of those bytes. | AC1 |
| SCN-3 | Confirmation is unavailable, declined or cancelled, or an identity/tree changes across confirmation; no commit, command or source-association mutation occurs. | AC2 |
| SCN-4 | A commit succeeds but receipt persistence is interrupted; explicit re-entry verifies the same commit and contribution digest, repairs only missing observational evidence and makes no duplicate commit. | AC2 |
| SCN-5 | Final verification returns 7 or HEAD changes after a successful result; Parent remains incomplete. Passing verification on the final integrated HEAD permits existing tracker closure. | AC3 |

## Chosen technical design

### 1. A final composition is a new reviewed delivery (E2, T1)

Use one new TaskIntent, `workflow-execution-reliability-parent-consolidation`, for both the bounded native capability and the final source composition. Its explicit scope contains the pending S4 and retirement-repair paths, their exact audit pairs, its own Spec/Intent/changeset, all changed native adapters and generated outputs. Existing source runs remain `done`; never modify their frozen source artifacts, audit records, intents or approvals merely to fit a commit.

The new task's deterministic QA and full initial Review cover the final combined staged tree, including the shared bundle and this task's own implementation. Existing old review evidence remains historical input; the new task is the sole approval for changed final composition bytes. A review must not claim that the final bundle equals the two historical bundle blobs.

### 2. Explicit association through the existing Host entry (E3, E5)

Add an optional `delivery_consolidation` request to `start_unattended_batch`, only for a native Parent with no active batch/Kernel owner. Shape: `{ task_id, run_id, source_runs: [{ task_id, run_id }] }`; the first identity is the settled final-composition task, the others are the explicitly selected prior deliveries. Reject duplicate task identities and self-reference. Ordinary batch, Lane, single-task and existing repair routes remain unchanged when absent.

Both Hosts strictly parse the same request and pass it to the shared native Parent implementation. A user-selected native confirmation must list the exact Parent, source runs, consolidation run, original review identities, current branch/HEAD, complete path/blob/mode manifest, contribution digest and final commands. This association is not a new Enrollment and does not alter historical Parent decomposition or fabricate a prior failed verification.

### 3. Scope and proof before Git effects (E1, E2)

Validate current Intent hashes, source terminal records and exported proofs against each exact committed run. Require `done` and a proof-validated completed consolidation run with the required QA/Review. Check that its exact frozen delivery identity covers the final changed tree and explicitly includes every selected source's pending paths and exact audit pairs. Unselected tasks, unowned staged/untracked paths, unsupported index flags and wrong run/Intent/audit fail closed. Never infer association from a similar task name, goal prose or all audit directories.

Retain the standard single-task `commitBatchChild` guard unchanged for ordinary calls. Consolidation commits the final composition as one scope-bounded native task commit only after native authorization. Its authority is the newly reviewed consolidation scope, not a union of old scopes treated as an approval. Distinguish selected historical source contributions from final-byte ownership in the native receipt.

After confirmation revalidate HEAD, selected identities, staged tree and contribution digest before the first write. Missing commands or unfinished critical tasks never bypass confirmation for Git effects.

### 4. Reuse Git identity and observational evidence (E4, T1)

Extend the existing native commit/report evidence path with a strictly parsed consolidation receipt naming the Parent, selected source task/run/review identities, final consolidation run, final commit/tree, path manifest and contribution digest. This is observational evidence, not a second authority store or a mutation of source settlements. Keep historical report bytes readable without rewriting them and emit optional consolidation data only when present.

Bind the same digest into the native commit identity so an explicit retry can recover an interrupted receipt write by validating the existing commit, its parent/tree, exact source records and consolidation proof. Persist validated association only after the relevant authorized effect; do not create a fake final-failure report to register repair work. Do not add a general-purpose transaction journal, force update refs or rewrite history.

`observeParentCompletion` may recognize a required source task through this verified consolidation receipt. It still verifies that source's current Intent and original terminal proof, the final composition's authority and the integrated final tree. A trailer or receipt alone never proves delivery. Existing standalone/per-child evidence continues through its original route.

### 5. Complete the actual Parent, including this repair (E1, E4)

The native request names both pending source runs and the newly settled consolidation run. The full current dirty path set must fit this already-reviewed composition, including this task's own changed source, generated bundle, candidate files and audit pair; a test must reproduce that third-task condition. This is the exit condition, not another optional follow-up.

After authorized integration, use the existing final-verification runner on the resulting Git HEAD. A failing command leaves Parent incomplete and preserves commits; a successful observation is reusable only on the same HEAD and same contribution identities. Use existing tracker terminal projection for Parent closure. No pushes, release, cache overwrite, manual batch-state edits or re-execution of settled source tasks.

## Public seams and scope discovery

- Native route and completion: `runtime/unattended/batch_git.ts`.
- Request validation and consolidation receipt/manifest: new `runtime/unattended/parent_delivery_consolidation.ts`, imported only by the existing native path; one cohesive module, not a new scheduler.
- Native report parsing/validation: `runtime/unattended/batch_state.ts`.
- Pi adapter/tool schema/confirmation: `.pi-extension/imm-unattended-batch.ts`.
- Claude adapter/options: `runtime/claude/kernel_ports.ts`.
- Claude confirmation data: `runtime/claude/interaction.ts`.
- Claude MCP schema/parser/confirmation renderer: `runtime/claude/mcp_server.ts`.
- Parent execution contract: `dist/imm-run-batch.md`, documenting explicit selection, required fresh consolidation proof and the local-runtime reload requirement; preserve existing ordinary batch/Lane instructions.
- Generated bundle: `dist/claude/mcp-server.mjs`, regenerated with the existing build script.
- Existing tests: `tests/unattended-batch-commit.test.ts`, `tests/goal-driven-batch-run.test.ts`, `tests/pi-batch-authority.test.ts`, `tests/claude-batch-authority.test.ts`, `tests/batch-completion-verifier.test.ts`, `tests/batch-plan-reconfirmation.test.ts`, `tests/claude-host-package.test.ts`.
- The pending S4 and retirement-repair paths and exact audit pairs are listed individually in the TaskIntent, not widened to repository or audit-directory wildcards.

## Acceptance and test plan

| ID | Source | Positive control | Explicit negative/boundary controls | Deterministic seam |
| --- | --- | --- | --- | --- |
| AC1 | E1 | Native Parent with superseded history integrates one newly reviewed composition that includes both selected source runs plus the consolidation task's own changes and audits. Preserve prior commits and source audit bytes. | Different historical bundle blobs require the new final proof; missing/stopped/wrong run, changed Intent, tampered audit, unselected dirty path and staged-tree drift reject. | `tests/unattended-batch-commit.test.ts` |
| AC2 | E5 | Pi and Claude parse and display identical binding data; acceptance allows precisely the same effect. Re-entry after commit/receipt interruption is idempotent. | Missing, denied/cancelled gate, changed HEAD or contribution digest yields no unauthorized commit/command/association; malformed/duplicate selections rejected; no implicit candidate discovery. | `tests/pi-batch-authority.test.ts`, `tests/claude-batch-authority.test.ts`, `tests/unattended-batch-commit.test.ts` |
| AC3 | E4 | Existing Parent closure accepts proof-validated source contributions through the consolidation commit and successful verification on final HEAD. Ordinary paths preserve their prior behavior. | Exit 7, stale HEAD, missing contribution or tampered receipt cannot complete Parent; replay makes no duplicate commit/tracker close. | `tests/goal-driven-batch-run.test.ts`, `tests/batch-completion-verifier.test.ts`, `tests/batch-plan-reconfirmation.test.ts` |

Descriptors use explicit test files and Bun supplied by the QA Host. Tests use project-owned fixtures and existing conditional Host-package seams; no installation, remote API, new model call or release is hidden in a descriptor. Structural candidate validation does not prove these tests have executed. After focused checks, regenerate/check the bundle, run typecheck and full `bun run verify:release`; after settlement, load the reviewed local runtime before calling the changed tool schema.

## Devil's advocate audit

- **Unioning scopes is not approval**: final-byte authority is the consolidation run's fresh QA/Review, with original records unchanged.
- **Self-hosting loop**: the same final run includes this implementation and its audit; the three-delivery regression is mandatory before handoff.
- **Arbitrary closure by task label**: explicit exact run selection, native binding and receipt/tree verification are required; no name-prefix inference.
- **Crash replay**: reconstruct only from the exact native commit/digest and verified proof; reject an unrelated matching-looking commit.
- **Version/loading confusion**: new schema must be used through a newly loaded local runtime, not by modifying the installed package or invoking private helpers from Bash.
- **Oversized fix**: no Kernel state machine/store migration, generalized scheduling, automatic discovery, or new infrastructure dependency.

## Execution and completion boundary

This candidate authorizes nothing until explicit `imm-run` Enrollment. Preserve existing staged work and never overwrite a settled Intent. Planning creates only this Spec and candidate, then stops. Following Enrollment, first reproduce the current two-source-plus-self integration failure, implement the shared native capability, run focused and full verification, complete Kernel QA/Review, then explicitly re-enter Parent with the bound consolidation selection. Parent remains open until its own integrated final-HEAD proof is successful.
