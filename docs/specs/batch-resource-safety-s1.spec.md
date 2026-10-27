# Batch resource safety — S1: ownership before resource reuse

**Status**: Candidate; no execution authority. S2 is separately specified in `docs/specs/batch-resource-safety-s2.spec.md` under the user's approved conservative-retention option A.
**Design risk**: High — Git resource ownership, persisted batch provenance, and interruption recovery cross shared runtime boundaries.
**Execution posture**: characterization-first, then regression tests before the smallest shared fix.
**Design views**: interfaces, data flow, and temporal recovery.
**Document language**: English, following Planner's default document policy.

## Outcome and boundary

A batch must not adopt or mutate a user-created same-name Parent branch or Lane merely because its commit equals the requested base. Existing batch records may prove legitimate continuation, subject to current Git identity and lineage checks. Preserve fixed internal names, one final Child delivery commit, and user checkout/index contents.

This is S1 of the confirmed `batch-resource-safety` decomposition, sourced from #220. S1 is independently useful and testable. S2 will protect release/redo against live Executors and unknown ignored files; S1 neither solves nor authorizes that work. No terminal facility, process framework, intent-revision change, naming configuration, remote write, or automatic orphan deletion is included.

## Sources

- U1: User confirmed the S1/S2 decomposition in this session: S1 prevents same-name resource takeover; S2 separately protects cleanup and redo. Confirmed S1 negative cases include same-tip foreign resources and interruption before durable provenance.
- E1: `plugins/immune-brain/runtime/unattended/batch_preflight.ts:665–695` reads active/settled records but allows an existing same-tip Parent for a fresh run.
- E2: `plugins/immune-brain/runtime/unattended/batch_ref.ts:88–107` treats an existing same-tip ref as a retry; `batch_git.ts:179–194` calls it from Git preflight.
- E3: `plugins/immune-brain/runtime/unattended/batch_lanes.ts:834–877` creates the ref before persisting the new running record; `batch_worktrees.ts:26–45` reuses a matching clean Lane path without its own batch provenance argument.
- E4: `tests/batch-parent-branch.test.ts:30–95` covers equal-tip reuse, unequal-tip refusal and integration, but currently equates repeated bare preflight with a legitimate retry.
- E5: `scripts/build-claude-plugin.ts` generates `plugins/immune-brain/dist/claude/mcp-server.mjs`; `docs/agents/derived-files.json` owns that output.
- E6: `docs/adr/0029-record-meaning-requires-contract-bump.md` requires a new contract for a persisted meaning change. This slice must not reinterpret existing record fields as newly created ownership tokens.

## Threat model and supported environment

Local Git refs, worktree registrations and paths may be pre-existing user resources or may change concurrently. Existing validated batch records are runtime provenance, not protection against a malicious actor rewriting the repository and authority store together. Support the repository's existing Git/Bun environment and object-format support; do not add OS-specific process scanning or claim new SHA-256/Windows support. Tests use isolated temporary repositories and fixture-owned files only.

## Decisions and technical design

### D1 — Separate existence from ownership

Source: U1.

Keep current names. Reuse requires a validated existing record whose repository context, Initiative/batch identity, Parent ref or exact Lane binding, and expected Git state match the operation. An existing ref with equal tip but no matching provenance is a collision, not a retry. A prior settled record may establish Parent provenance for a newly authorized continuation only when its recorded delivery lineage and the current expected tip still agree; its authorization never authorizes new work.

For a Lane, require the exact recorded path, branch and base/commit identity before reusing an existing path. Continue checking same repository, canonical path, cleanliness and active claims. Mere presence under `.git/imm/worktrees` is insufficient. Do not overwrite a path whose existing Lane has no matching record.

### D2 — One shared decision at observation and mutation boundaries

Source: delegated technical choice grounded in E1–E3.

Read-only preflight and mutating Git preflight must agree. Carry an internally derived provenance decision from validated records, not a new model-controlled `owned` flag. Reuse existing record readers and expected-head logic; avoid a new marker database or token subsystem.

`batch_preflight.ts` owns admission projection; `batch_lanes.ts` owns durable batch/lane state; `batch_git.ts`/`batch_ref.ts` and `batch_worktrees.ts` own guarded Git effects. Both Host adapters continue through the shared runtime. Git helpers must receive the narrow evidence needed to distinguish exclusive creation from authorized reuse; a standalone repeated helper call is not proof of retry authority.

Fresh creation remains exclusive (zero-old-value CAS for refs, Git's exclusive worktree/branch creation). If another actor creates a ref between preflight and mutation, reject even when its tip equals base unless record-backed reuse was independently established. Existing-tip movement remains CAS guarded. Recheck relevant Git facts immediately before mutation. Preserve hidden-ref/legacy semantics unless the same ownership flaw is demonstrated on a reachable supported path; do not retire historical formats here.

### D3 — Conservative interruption recovery, no new persisted meaning

Source: U1.

Order: observe records and Git facts → validate authorization → exclusively create or prove reuse → persist batch/Lane binding → execute existing scheduling. If interrupted after creation but before a durable binding, preserve the orphan and reject automatic adoption on retry. Report its exact identity and the missing provenance; do not silently delete or rename it. If the durable binding exists, existing resume/lineage validation determines whether retry is safe.

Do not add a new ownership record or change batch-state schema meaning in S1. An implementation that requires such a change must return to Planner rather than bypass ADR 0029. This is resource admission/recovery, not a change to Kernel settlement or Executor lifecycle ownership.

### D4 — Minimal repair and packaging

Source: E5.

Patch the shared owner once, update affected callers and existing regression tests, and generate the Claude bundle through its existing script. Add `.changeset/batch-resource-safety-s1.md`. Do not hand-edit the bundle, alter manifests unrelated to this change, or add dependencies. Update directly affected Parent/Lane reuse contract wording only; broad cleanup/session documentation belongs to S2 or the separate #220 follow-up.

## User scenarios

All scenarios source U1 and belong only to S1.

- **SCN-1 (automated → AC1)**: A user already has `imm/<slug>` at the same commit as the requested batch base, without matching batch provenance. Starting the batch refuses without moving refs or changing checkout/index/worktrees.
- **SCN-2 (automated → AC2)**: A user resumes a batch whose recorded Parent/Lane identities still match. It continues without duplicate resource creation; a changed tip/path/branch is rejected instead.
- **SCN-3 (automated → AC2)**: A start was interrupted after resource creation but before its binding was saved. Retry preserves the resource and explicitly reports missing provenance, rather than adopting or cleaning it.

## Verification and acceptance mapping

Use the highest existing behavioral seams and extend their fixtures rather than adding a parallel test harness. Record the characterization result before editing; a case already protected needs a durable regression, not an invented repair.

| Acceptance | Source | Observable invariant and controls | Agreed seams |
| --- | --- | --- | --- |
| AC1 | D1 | Positive: absent resources create normally. Negative: foreign same-tip and different-tip Parents, foreign matching Lane paths/branches, and a ref appearing between observation and creation are refused without Git/workspace mutation. Bound: a valid runtime-owned same-tip resource is not rejected merely for existing. | `tests/batch-parent-branch.test.ts`, `tests/unattended-batch-commit.test.ts` |
| AC2 | D3 | Positive: record-backed active resume and valid settled-Parent continuation work. Negative: orphan after creation-before-persist, mismatched recorded Lane path/branch and divergent Parent tip refuse with resources retained. Bound: interruption after durable binding resumes without duplicate creation; legacy supported paths retain existing safeguards. | `tests/unattended-batch-lanes.test.ts`, `tests/batch-parent-branch.test.ts` |

Every refusal test snapshots relevant refs, worktree registrations, checkout/index and fixture bytes before and after; returned error text alone is insufficient. Update the current bare repeated-preflight reuse assertion: that is not a valid ownership control. Preserve its user checkout/index protection in the legitimate record-backed case. Never remove unrelated clean/dirty integration protections.

Descriptors use host-provided `bun` and `git`, tracked test sources and the existing installed dependencies. No dependency installation, credentials, network or project worktree manipulation is needed. Fixtures create their own temporary repositories, clean up only their own resources in `finally`, and fail rather than skip when prerequisites are missing. Planning validates descriptors but does not execute acceptance.

Implementation verification additionally runs `bun run typecheck`, generates the bundle with `bun scripts/build-claude-plugin.ts`, checks it with `--check`, and runs the focused Pi/Claude batch-authority tests when shared admission behavior changes. Build/typecheck are delivery checks, not substitutes for behavioral acceptance.

## Reference closure / scope estimate

Primary implementation: `runtime/unattended/batch_preflight.ts`, `batch_git.ts`, `batch_ref.ts`, `batch_worktrees.ts`, `batch_lanes.ts`, and `batch_runner.ts` beneath `plugins/immune-brain/`. Read existing `batch_state.ts` record validation as the provenance owner; no new state schema is planned.

Public callers: `plugins/immune-brain/.pi-extension/imm-unattended-batch.ts` and `plugins/immune-brain/runtime/claude/kernel_ports.ts`, both passing through shared preflight/startBatch. No new public tool parameter is required.

Tests: `tests/batch-parent-branch.test.ts`, `tests/unattended-batch-commit.test.ts`, `tests/unattended-batch-lanes.test.ts`, `tests/pi-batch-authority.test.ts`, `tests/claude-batch-authority.test.ts`. Contract: `plugins/immune-brain/dist/imm-run-batch.md`. Derived output and changeset as D4.

## Compatibility, rollback and Devil's Advocate Audit

- **Rollback resilience**: no migration, ref rename or user-resource cleanup. A partial start may leave an orphan; refusal retains it for explicit inspection. Reverting the guard restores the old unsafe behavior, so do not treat a downgrade as a safe automatic recovery action.
- **Verification vanity**: same-tip collision tests exercise actual Git refs and the runner path, not only helper truth tables; positive record-backed retry prevents an always-refuse implementation passing. Race and interrupted-persistence controls cover the checks that static happy-path tests miss.
- **Spec dilution**: AC1 and AC2 together cover every confirmed S1 case, including Lane reuse and interruption. S1 must not be reported as resolving cleanup/Executor safety. S2 remains explicit and cannot be dropped to call the Initiative complete.
- **No temporary bridge**: no dual-write ownership store, compatibility layer or cleanup TODO is introduced. Existing legacy support is not retired by this task.

## Handoff completeness

Confirmed resource-collision protection maps to S1 AC1; legitimate retry and interruption behavior map to S1 AC2. Confirmed cleanup/redo/process and unknown-ignored-file protection belongs only to S2. The user selected option A for S2: retain resources and block destructive redo without trustworthy exit evidence; restoring automatic lifecycle management is explicitly deferred with owner and exit conditions in its Spec. Terminal product selection and Child authorization recovery remain outside this Initiative. The full Initiative is handoff-ready only after both candidates and their overlap projection validate.
