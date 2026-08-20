# Spec: Terminated Replacement Execution Evidence Carry-Forward

**Task ID**: IMM-REPLACEMENT-EVIDENCE-001
**Owner**: Planner
**Status**: Proposed
**Date**: 2026-08-13

**Design risk**: High
**Design rationale**: Execution evidence determines the changed-file set presented to QA and final review. A replacement Plan is commonly activated while the superseded predecessor implementation remains dirty. Comparing only against the replacement activation snapshot can omit unchanged predecessor files from review authority.

**Diagram decision**: not_required
**Diagram reason**: The authority is one conjunctive eligibility check followed by one bounded set union; prose requirements and black-box fixtures express it more precisely than a state diagram.

## 1. Goal

Ensure an explicitly user-authorized terminated replacement can record the complete still-dirty implementation surface inherited from its superseded predecessor, while ordinary Plans and untrusted metadata retain activation-delta-only behavior.

## 2. Current Failure

`imm-work record-execution` derives changed files with `changedFilesSinceSnapshot`. When a replacement Plan activates after predecessor implementation already exists in the dirty workspace, the activation snapshot contains those files. If execution then changes any subset, runtime replaces the executor's complete claim with only the post-activation delta. Final QA and review therefore omit inherited files that remain part of the replacement Result.

The current empty-delta fallback keeps self-reported files, but mixed cases (some post-activation edits plus inherited files) narrow the review surface.

## 3. Technical Design

### 3.1 Replacement authority

Carry-forward is authorized only when all runtime-owned facts agree:

- `validated_plan_snapshot.task.superseded_predecessor` is a normalized Plan path;
- the latest `plan_termination_history` record has `status: superseded` and `authority: user`;
- the latest record passes `immune-brain-plan-termination-v1` digest re-derivation;
- that latest record's `plan_path` equals the declared predecessor path;
- the current Plan path differs from the predecessor path.

The State Ledger and its authority journals are trusted runtime state: executors are not permitted to edit `.imm/memory/` directly. The unkeyed termination digest detects accidental or partial record drift; it is not a user signature and cannot authenticate an actor that has already crossed the runtime-state write boundary. A caller flag or execution evidence field cannot select replacement behavior.

### 3.2 Evidence union

For an authorized replacement, runtime captures one authoritative current Git snapshot and computes:

1. the ordinary post-activation Git delta from that snapshot;
2. executor-claimed files whose strictly canonicalized repository-relative identities were dirty in the activation baseline and remain dirty in that snapshot;
3. the normalized union of those sets.

The same current snapshot object used for the union is persisted as `workspace_evidence_snapshot`. Runtime must not recapture the workspace between deriving `changed_files` and persisting the QA mutation-guard baseline.

The existing Step Scope check applies to the complete union. Claimed paths absent from both the current dirty snapshot and ordinary delta are excluded. Runtime records mixed provenance explicitly so QA knows the inherited subset was claim-selected under persisted replacement authority.

For ordinary Plans, invalid metadata, malformed or digest-invalid termination records, non-user termination, non-superseded termination, stale/non-latest termination, predecessor mismatch, or invalid/escaping claimed paths, behavior remains unchanged: a non-empty Git delta replaces claims. `changed_files_source` is always rebuilt by the runtime and never trusted from caller evidence.

### 3.3 Failure and compatibility

- No State Ledger schema migration or historical rewrite.
- No inheritance from closed Plan archives; this rule covers only workspace content that is still dirty when replacement evidence is recorded.
- Missing/malformed snapshots preserve existing self-reported fallback behavior.
- Head changes preserve existing self-reported fallback behavior.
- An authorized replacement with a valid same-HEAD snapshot filters to the bounded current-dirty set and fails the existing structured evidence gate when that set is empty instead of falling back to stale claims.
- Scope-external paths continue to fail closed.
- Post-evidence workspace mutation continues to invalidate QA pass.

## 4. Requirements

### R1. Complete authorized replacement evidence

A user-superseded predecessor plus matching replacement metadata records the union of post-activation delta and claimed still-dirty activation-baseline files.

### R2. Authority isolation

Ordinary Plans, forged predecessor metadata within the supported runtime-state boundary, malformed or digest-invalid termination records, predecessor mismatch, cancelled termination, non-user authority, and stale termination records cannot enable carry-forward. The termination digest detects drift but is not an authentication primitive for actors with direct authority-state write access.

### R3. Workspace integrity

Cleaned claims absent from the current dirty snapshot, runtime authority files, invalid path identities, and scope-external paths cannot enter the carried review set. Tracked deletions remain dirty Git changes and must stay reviewable. The snapshot used to derive the review set is the exact snapshot persisted for later QA mutation checks.

### R4. Provenance visibility

Mixed derived/carried evidence is distinguishable from fully Git-derived and fully self-reported evidence.

## 5. Non-Goals

- No change to same-Phase continuation archive inheritance.
- No automatic Plan termination, replacement activation, or successor approval.
- No review of committed predecessor changes after HEAD changes.
- No arbitrary user-selected historical Plan evidence.
- No schema version bump.

## 6. Acceptance Criteria

- A fixture with two dirty predecessor files at replacement activation and one post-activation edit records both claimed inherited files plus the edit.
- The same fixture without matching latest user-superseded authority records only the post-activation delta.
- Missing snapshots and HEAD drift preserve self-reported compatibility and overwrite caller-supplied provenance while persisting their single current snapshot for later QA mutation checks.
- Authorized same-HEAD derivation uses one current snapshot for both `changed_files` calculation and `workspace_evidence_snapshot` persistence.
- Bounded aliases such as `./path` and backslashes canonicalize to Git paths; absolute and parent-traversal claims fail closed.
- A claimed file cleaned after activation is not carried.
- A scope-external claimed dirty file is rejected when it enters an authorized union.
- Existing workspace snapshot, execution evidence, transition, QA, and full repository tests pass.
