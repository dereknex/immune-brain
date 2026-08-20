# Spec: Assurance Kernel v4 P2B0 Risk-Accepted Canary Core

**Design risk**: Critical - this slice introduces the first production backend claim and new-task Kernel enrollment path.
**Diagram decision**: required
**Diagram reason**: enrollment must coordinate readiness policy, user risk acceptance, Kernel task/workspace creation, and the existing v3 authority guard without dual write.

## 1. Goal

Implement the host-neutral core required to enroll exactly one new managed task into Kernel ownership while preserving v3 as the default for every other task.

The literal user has explicitly directed the project to skip the remaining natural observation time. This Spec accepts only that risk: `observation_window_days` may be waived for one exact Pi canary task. It does not mark readiness `candidate`, rewrite evidence, or waive reconciliation, lifecycle/family coverage, migration digest, rollback rehearsal, authority binding, or human confirmation.

P2B0 exposes no CLI, Pi command, host adapter, LLM-callable tool, OpenCode/RPC route, or production capability issuer. P2B1 will separately wire Pi `ctx.ui.confirm` to this core.

## 2. Scope

### In scope

- a pure canary eligibility projection over the current readiness report and rollout evidence;
- an opaque, single-use enrollment capability consumption contract plus test-only issuer seam;
- atomic creation of one TaskRecord v2, workspace working claim, and Kernel backend claim;
- a v3 preflight guard that refuses managed workflow mutations while the workspace has an active Kernel backend claim;
- recoverable enrollment and drain/stop transactions;
- exact replay, stale identity, crash recovery, and no-dual-write tests.

### Out of scope

- Pi extension/package registration or `ctx.ui.confirm` issuer;
- actual enrollment of a canary task;
- OpenCode, RPC, JSON, print, CLI, or LLM-callable mutation surfaces;
- making readiness status `candidate` before its ordinary gate passes;
- waiving any gate other than the remaining observation-window duration;
- supported-host default routing, terminal import, v3 reconstruction, or backend switching.

## 3. Risk-Accepted Eligibility

`CanaryEligibilityInput` contains:

- the exact readiness report and its canonical digest;
- current migration dry-run digest;
- a valid tracked readiness evidence bundle;
- exact TaskIntent descriptor identity;
- legacy activity projection;
- Kernel store/workspace/backend-claim projection;
- optional inspected enrollment capability.

Ordinary eligibility requires readiness `candidate`.

Risk-accepted eligibility may replace only the unmet `observation_window_days` reason when all of the following hold:

1. readiness is `collecting`, never `blocked`;
2. exact receipt/observation reconciliation has zero gaps, conflicts, malformed records, or version/generation discontinuity;
3. lifecycle and mutation-family coverage already meet their normal thresholds;
4. migration dry-run digest matches a valid readiness evidence bundle;
5. rollback rehearsal evidence is valid and current for the same observer generation/version;
6. the capability binds `waived_gate = "observation_window_days"`, one task ID, intent path/revision/hash, readiness digest, evidence digest, actor, confirmation reference, expiry, and a one-use nonce;
7. no active v3 Step/follow-up or nonterminal plan exists;
8. no Kernel backend claim, TaskRecord, or working owner exists for another task.

The live repository currently has no tracked `docs/evidence/assurance-kernel/readiness.json`; therefore conditions 4-5 remain unmet and live enrollment remains ineligible after P2B0. P2B0 tests inject synthetic `ReadinessEvidenceInput` values and must never call `loadReadinessEvidence` against the live repository root. The elapsed-time waiver does not waive this missing evidence.

No data is rewritten to claim the ordinary gate passed. Enrollment history records the waiver descriptor and the actual readiness status/window.

## 4. Enrollment Capability

`EnrollmentCapability` uses a distinct module-private `ENROLLMENT_CAPABILITY_BRAND` and a distinct `WeakMap`; it must not share the R2C2 mutation-capability brand or registry. It is not JSON/spread serializable and cannot be constructed from flags, payloads, environment, files, journals, sessions, actor labels, or confirmation references. An R2C2 `MutationAuthorityCapabilityV2` is always rejected by enrollment inspect/consume.

P2B0 provides inspect/consume functions and a test-only issuer that is not exported from the canonical kernel index. The production issuer remains absent until P2B1.

The capability binds:

- task ID and TaskIntent identity;
- readiness and evidence digests;
- waiver kind or ordinary-candidate mode;
- actor and confirmation reference;
- issued/expires timestamps;
- one-use nonce.

All read-only validation completes before consume. Consume occurs immediately before writing the enrollment transaction marker. Failure to write the marker burns the capability; the user must confirm again. Exact committed replay returns before capability checks.

## 5. Backend Claim

The durable workspace claim uses `assurance_kernel/backend_claim/v1` and stores:

- `backend: "kernel"`;
- task ID;
- intent revision/content hash;
- enrollment event ID;
- readiness/evidence digests;
- optional observation-window waiver audit;
- lifecycle status `active | draining | terminal`;
- creation/update timestamps.

Backend affinity is immutable. `draining` disables new enrollment but permits the same Kernel task to finish or receive a user-authorized stop. `terminal` never routes the task back into v3 and never reconstructs Plan/Step state.

## 6. Atomic Enrollment Transaction

A dedicated `assurance_kernel/enrollment_transaction/v1` marker is serialized by the existing Kernel store lock. Enrollment atomically converges:

1. TaskRecord v2 creation from the fresh tracked TaskIntent snapshot;
2. workspace working claim for the same task;
3. Kernel backend claim for the same task.

Preconditions under the lock:

- the v1 workspace marker, v2 mutation marker, and enrollment marker are registered in one mutual-exclusion check; presence of any two marker paths throws `KernelStoreSecurityError` before recovery writes;
- exact TaskIntent reread/token validation;
- no TaskRecord at the task path;
- no working owner or backend claim;
- fresh legacy activity projection shows no active Step/follow-up/nonterminal managed plan;
- readiness/evidence/capability identities still match.

Crash recovery accepts only combinations matching the marker's exact before/after hashes. Contradictory partial bytes fail closed. TaskRecord-only, workspace-only, or backend-claim-only partial commits are recovered before a new operation begins.

## 7. V3 Routing Guard

Canonical v3 managed mutation preflight reads the backend claim before sync, activation, work, review, termination, or autowork authority mutation.

- active/draining Kernel claim: reject v3 managed mutation with an explicit backend-owned error;
- terminal claim for the same historical task: do not reactivate or reconstruct v3 state;
- absent claim: existing v3 behavior is unchanged;
- malformed, symlinked, or contradictory claim/TaskRecord/workspace state: fail closed.

Read-only status/progress/shadow commands remain available.

## 8. Rollback and Rehearsal

Rollback means `disable enrollment + drain/stop`; it never switches an active task to v3.

P2B0 provides a host-neutral rehearsal function operating in an isolated temporary workspace. It proves:

- enrollment transaction crash recovery at every rename boundary;
- v3 guard rejection while Kernel-owned;
- enrollment disabled during drain;
- same-task Kernel completion/authorized stop remains possible;
- no v3 Plan/Step synthesis;
- readiness/receipt/observation sources remain unmodified.

The rehearsal produces strict evidence data but does not write the tracked readiness evidence file. P2B1/operator workflow will review and commit that evidence separately.

## 9. Invariants

- I1: Only `observation_window_days` can be risk-accepted, for one exact task and one use.
- I2: Readiness remains truthful; waiver enrollment never projects `candidate`.
- I3: One workspace has at most one active backend claim.
- I4: TaskRecord, workspace working claim, and backend claim converge through one recoverable enrollment transaction.
- I5: A Kernel-owned task is never mutated or reconstructed by v3.
- I6: Backend affinity never changes during a task lifetime.
- I7: Enrollment privilege cannot be minted from serialized caller input.
- I8: P2B0 exposes no production issuer or host/CLI mutation route.

## 10. Roadmap Continuation

P2B1 adds the project Pi extension package and TUI-only `ctx.ui.confirm` issuer. After P2B1 is reviewed, the literal user must separately approve one exact TaskIntent enrollment in Pi TUI. P2C default routing remains deferred.
