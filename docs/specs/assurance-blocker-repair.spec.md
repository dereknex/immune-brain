# Spec: Assurance Blocker Recovery

**Task ID**: `assurance-blocker-repair`
**Owner**: user
**Status**: Candidate
**Design risk**: Medium
**Design risk rationale**: The change aligns Pi assurance snapshot identity, failure recovery guidance, and the Planner/Loop delivery-preparation contract. It changes no Kernel state, schema, authority decision, or persisted record, but an inconsistent host adapter or instruction could still block valid work or recommend an unsafe retry.

**Design views**: Component interfaces and temporal sequence are relevant because the Pi adapter passes task identity into workspace snapshot capture and converts runtime failures into one recovery action, while Planner and Loop prepare the same delivery before Assurance. Architecture layers, persisted data flow, and state transitions are omitted because ownership, schemas, and Kernel transitions do not change.

**Diagram decision**: not_required
**Diagram reason**: The repair has one linear preparation and recovery sequence with no new branches or persisted states; the ordered contract below is clearer than a diagram.

## Summary

Managed Pi execution must prepare task-owned Git content before Assurance, build every QA snapshot with the enrolled task identity, and return a recovery action that changes the failed prerequisite. Planner must describe how each verification command and dependency exists in the materialized delivery instead of treating descriptor parsing or a dependency in the development worktree as proof that QA can execute.

## Origin

Session `01a0c828-573f-7174-bf6c-8038f2e89239` exposed a repeated blocker chain:

1. the Agent asked the user to stage policy, planning, and implementation files even though the shared contract permits staging explicit task-owned paths;
2. `freeze_artifacts` reported task-owned unstaged files as `projection_unavailable` with `inspect authority state`;
3. deterministic QA could not resolve `./node_modules/.bin/vitest` because planning checked the development worktree rather than the materialized delivery;
4. after a compatible Intent revision, status projected normally but QA snapshot capture rejected the task's own changed Intent sidecar because the Pi adapter omitted `taskId`; and
5. failed QA returned `run_qa` even though no prerequisite had changed, encouraging an identical retry.

## Discovery Evidence

- `plugins/immune-brain/.pi-extension/imm-canary-work.ts` passes `record.task_id` through `diffSnapshotOf`, but `buildAssuranceSnapshot` currently calls `captureGitTaskSnapshot(root, intent.scope_hint)` without the task ID. `workspace_scope.ts` needs that ID to recognize `docs/plans/<task-id>.intent.json` as the current task's planning sidecar.
- The same adapter maps every projection error to `inspect authority state`, and `nextActionForAssuranceResult` maps generic failed or blocked Assurance to the unchanged Kernel obligation.
- `plugins/immune-brain/BASELINE.md` already permits staging explicit task-owned paths and forbids broad `git add .` or `git add -A`; Loop and Planner need the responsibility and mixed-ownership boundary stated at the point where delivery is prepared.
- `plugins/immune-brain/dist/imm-planner.md` defines focused verification descriptors but does not require evidence that the command and dependencies exist in the materialized delivery, nor distinguish structural eligibility from execution success strongly enough to prevent the observed planning claim.
- `tests/pi-canary-work-extension.test.ts` drives the registered Pi Tool through compatible Intent revision and Assurance progression. `tests/managed-authority-failure-contract.test.ts` owns same-Host recovery wording across the shared contracts.

## Decisions

1. Pass the enrolled `taskId` to QA's `captureGitTaskSnapshot` call. Current-task planning sidecars retain their existing exclusion; another task's sidecar remains outside the authorization envelope.
2. Keep all workspace and authority checks fail-closed. Do not add a scope exception, automatically widen `scope_hint`, or treat every file under `docs/plans/` as task-owned.
3. Classify only stable, known preparation failures in the Pi adapter. Unstaged or untracked task paths direct the caller to stage the listed task-owned paths. Verification resolution failures direct the caller to repair the verification environment before retrying. Authorization-envelope failures direct the caller to revise the Intent for the listed paths. Unknown projection or authority failures retain authority inspection.
4. A failed or blocked operation must not recommend repeating the unchanged obligation when its reported prerequisite is still false.
5. Planner and Loop stage exact task-owned paths they authored or changed before Enrollment or Assurance. They do not stage unrelated files or mixed user changes whose ownership cannot be isolated. Commit, push, and history mutation remain outside this permission.
6. Planner records where each verification executable and dependency comes from in the materialized delivery. `eligible` and `enrollment_ready` describe structure and Enrollment readiness only; only deterministic QA proves execution.
7. `environment.prepare` is explicit when setup is required, uses project-owned deterministic inputs, and declares only required writable paths. It must not use an absolute path to a developer's existing `node_modules`, hide installation inside the check command, or assume network availability.
8. No Kernel core, TaskIntent schema, TaskRecord schema, review contract, approval gate, compatibility layer, or generic scheduler changes.

## Technical Design

### Component interfaces

`buildAssuranceSnapshot(root, taskId, role, projection)` already owns the enrolled task identity. It supplies that same identity to `captureGitTaskSnapshot` so the snapshot layer applies its existing current-sidecar rule consistently with `diffSnapshotOf`. The workspace module remains the sole owner of path matching and envelope rejection.

The Pi adapter converts bounded runtime facts into a Tool `next_action`. A small local recovery classifier may inspect the adapter's existing stable error categories or prefixes; it must preserve the original error text, return exactly one action, and default to authority inspection for unknown projection failures. It does not suppress, retry, or mutate the failed operation.

### Temporal sequence

1. Planner authors and validates a Git-tracked TaskIntent whose focused descriptors identify command, dependency source, setup, and writable outputs for the delivery environment.
2. Executor implements and verifies within scope, then stages only explicit task-owned paths.
3. `advance_assurance` freezes and captures a snapshot using the enrolled task identity.
4. If preparation fails, the Tool returns the cause and one action that changes that prerequisite; the caller repairs it before retrying.
5. Deterministic QA remains the only owner of descriptor execution evidence, followed by existing Review and completion behavior.

## Invariants

- Status, freeze, QA, and Review derive task ownership from the same enrolled task identity.
- Another task's planning sidecar cannot enter the delivery unless explicitly authorized.
- Preparation failures do not weaken scope, cleanliness, snapshot, or authority checks.
- Exact task-owned staging never grants commit, push, publication, or Git history authority.
- Structural descriptor validation never claims that a command executed.
- QA recovery advice changes a concrete prerequisite before recommending another attempt.
- Unknown authority and projection failures remain fail-closed.

## Failure And Recovery

- Unstaged or untracked in-scope paths report the listed paths and direct exact task-owned staging; unrelated or mixed-ownership paths remain untouched.
- Missing verification executables or working directories direct descriptor/environment repair; an identical `run_qa` recommendation is forbidden.
- A genuine authorization-envelope escape reports the paths and directs Intent revision through the existing native gate; it is not relabeled as an authority-store failure.
- Unknown projection, claim, CAS, storage, or authority failures retain the existing same-Host inspection path.
- A failed native authority gate remains fail-closed and is never automatically retried.

## Compatibility And Rollback

Tool schemas, Kernel operations, persisted records, verification descriptors, and approval semantics remain unchanged. Existing callers receive more specific `next_action` text for recognized failures; unknown failures preserve current behavior.

Rollback reverts the Pi adapter, contract wording, and focused tests together. No migration or authority repair is required because the task creates no persisted contract or compatibility mechanism.

## Scope

- `docs/specs/assurance-blocker-repair.spec.md`
- `docs/plans/assurance-blocker-repair.intent.json`
- `plugins/immune-brain/.pi-extension/imm-canary-work.ts`
- `plugins/immune-brain/BASELINE.md`
- `plugins/immune-brain/skills/BASELINE.md`
- `plugins/immune-brain/dist/BASELINE.md`
- `plugins/immune-brain/dist/imm-loop.md`
- `plugins/immune-brain/dist/imm-planner.md`
- `tests/pi-canary-work-extension.test.ts`
- `tests/managed-authority-failure-contract.test.ts`

## Out Of Scope

- Kernel core, authority registry, persistence, reducer, or TaskIntent/TaskRecord schema changes;
- automatic scope expansion, automatic commit, push, publication, or history mutation;
- installing dependencies during Enrollment or adding a general dependency cache/environment manager;
- copying dependencies from a developer-specific absolute path as a standard verification strategy;
- changing the current accepted scope of the separate `claude-schema-alignment` task; and
- a compatibility layer or second workflow abstraction.

## Acceptance Mapping

1. **AC1**: Pi snapshot and recovery behavior. A compatible Intent revision that changes the current task sidecar can proceed into QA without adding that sidecar to `scope_hint`; a staged other-task sidecar is still rejected. Recognized unstaged-path, verification-resolution, and authorization-envelope failures return one prerequisite-changing recovery action, while unknown authority failures retain fail-closed inspection.
2. **AC2**: Planner and Loop delivery-preparation contracts. Exact task-owned staging is performed before Enrollment/Assurance without granting commit or broad staging authority; Planner names delivery command/dependency provenance, setup, writable outputs, and the structural-versus-executed evidence distinction.

## Verification Approach

- `bun test tests/pi-canary-work-extension.test.ts`
- `bun test tests/managed-authority-failure-contract.test.ts tests/baseline-packaging-contract.test.ts`
- Post-implementation mirror check: `bun scripts/sync-dist-docs.ts --check`
- Post-implementation type check: `bun run typecheck`
- Diff hygiene: `git diff --check`

The Pi extension test is the highest existing observable seam: it drives the registered Tool through revision, projection, snapshot capture, and failure rendering. The contract tests read the exact packaged instructions used by Planner and Loop and verify mirrored BASELINE content.

## Devil's Advocate Audit

**Rollback resilience**: No schema or persisted-state change exists. Adapter and instruction changes can be reverted together, and every failed operation remains fail-closed during a partial implementation.

**Verification vanity**: A direct unit test of `captureGitTaskSnapshot` would not catch the missing caller argument. AC1 must drive the real Pi Tool after Intent revision and distinguish the current task sidecar from another task. Text-presence checks alone cannot prove runtime recovery behavior; they are limited to the instruction contract in AC2.

**Spec dilution detection**: Merely adding the Intent path to every `scope_hint`, repeating `run_qa`, or copying local `node_modules` would hide the reported symptoms. Closure requires consistent task identity, a prerequisite-changing recovery action, autonomous exact staging, and delivery-owned verification dependencies.

## Brainstorm Trace

- `BR-REQ-1` -> AC1 and AC2 preserve authority checks while eliminating repeated preparation blockers.
- `BR-DEC-1` -> AC1 passes task identity and preserves rejection of another task's sidecar.
- `BR-DEC-2` -> AC2 assigns exact task-owned staging while excluding commit, push, broad staging, and mixed user changes.
- `BR-DEC-3` -> AC2 records delivery command/dependency provenance and reserves execution claims for QA.
- `BR-DEC-4` -> AC1 returns recovery actions that change the failed prerequisite before retry.
- `BR-OUT-1` -> Out of scope excludes Kernel rewrites, approval layers, environment managers, and generic schedulers.
- `BR-OUT-2` -> Out of scope excludes universal scope expansion and developer-absolute dependency copying.
