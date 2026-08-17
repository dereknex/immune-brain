# Assurance Kernel v4 P2B2 Pi Canary Lifecycle Routing Specification

## Status

- **Status:** Draft
- **Owner:** Immune-Brain maintainers
- **Date:** 2026-08-12
- **Parent:** `docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md`
- **Predecessors:** `docs/specs/assurance-kernel-v4-p2b0-risk-accepted-canary-core.spec.md`, `docs/specs/assurance-kernel-v4-p2b1-pi-confirmed-enrollment.spec.md`, `docs/specs/assurance-kernel-v4-p2c2-mutation-port.spec.md`
- **Risk:** High

**Design risk**: High. P2B2 publishes the first production mutation route for an enrolled TaskRecord v2, mints QA/review/user authority in Pi, and must release workspace ownership without changing the task's immutable Kernel backend affinity.

**Diagram decision**: required

**Diagram reason**: The design coordinates reducer/CAS mutation, Pi executor routing, host-created isolated assurance children, literal-user confirmation, and an atomic terminal ownership transfer across separate trust and recovery boundaries.

## 1. Goal

Allow one already enrolled Pi canary task to traverse its TaskRecord v2 lifecycle through Kernel-owned mutations while preserving the parent contracts:

- Kernel remains the sole mutation and completion authority for that task;
- Pi TUI is the only production host for P2B privileged authority;
- executor facts, QA/review authority, and literal-user authority remain distinct;
- no generic serialized `TaskActionV2` mutation route is exposed;
- lifecycle state remains exactly `working | review | done | stopped`;
- no lifecycle or routing state is stored in Pi sessions;
- task completion or stop releases workspace routing without changing historical backend affinity;
- v3 remains the default for all newly created managed tasks outside the exact canary.

P2B2 implements a dormant-capable route. It does not enroll a real task. The route becomes live only after the separate `/imm-canary-enroll <task-id>` operation creates a matching TaskRecord v2 and active backend claim.

## 2. Scope

### In scope

- a host-neutral Kernel canary application service over the existing closed `TaskActionV2` reducer and storage port;
- semantic operation inputs that derive event, CAS, Intent, diff, phase, and workspace facts inside the trusted application boundary;
- an explicit mutation-authority registry paired to one lifecycle application service instance, distinct from the P2B1 enrollment-authority domain;
- fail-closed P2B1 preparation over active claim, target TaskRecord, workspace owner, and task-scoped tombstone;
- a user-confirmed, one-way `active -> draining` rollback operation under the Kernel store lock;
- recoverable terminal ownership transfer from the workspace-active claim to a task-scoped terminal backend tombstone;
- a versioned, no-shell verification-descriptor parser bound to the enrolled Intent snapshot;
- one Pi extension route for ordinary executor facts;
- one Pi TUI command for host-created QA/review children;
- one Pi TUI command for literal-user actions through exact `ctx.ui.confirm`;
- a Pi-only Skill contract that routes an active Kernel claim to the canary adapter instead of v3 `imm-work`;
- package, authority, crash-recovery, host-mode, and no-bypass tests.

### Out of scope

- real canary enrollment or creation of live TaskIntent/readiness evidence;
- automatic multi-step orchestration or a second persisted workflow state machine;
- P2C default Kernel routing, additional canary cohorts, or any supported-host promotion decision;
- OpenCode, RPC, JSON, print, CLI, environment, file, journal, or serialized privileged authority;
- v3 Plan/Step synthesis, dual write, backend switching, or fallback after a Kernel mutation failure;
- terminal TaskRecord import, migration, deletion, or mutation outside the reducer;
- cryptographic authentication against malicious same-user code in the trusted Pi process.

## 3. Technical Design

```mermaid
sequenceDiagram
    participant M as Main Pi agent
    participant X as Pi canary extension
    participant C as Isolated assurance child
    participant U as Literal Pi TUI user
    participant A as Kernel canary application
    participant R as Reducer and completion predicate
    participant S as Kernel store and backend claims

    M->>X: semantic ordinary operation
    X->>A: exact task plus bounded operation
    A->>S: lock and reread TaskRecord/Intent/workspace/claim/diff
    A->>R: derive strict TaskActionV2 and reduce
    R-->>A: branded mutation
    A->>S: CAS commit

    M-->>U: review or QA authority required
    U->>X: /imm-canary-assure task role
    X->>C: new in-memory session with bounded read/verify tools
    C-->>X: structured verdict for exact snapshot
    X->>X: validate provenance and mint one-shot role capability
    X->>A: apply approval or request rework

    M-->>U: literal-user authority required
    U->>X: /imm-canary-authorize task operation
    X->>U: ctx.ui.confirm exact action and snapshot
    U-->>X: affirmative
    X->>X: mint one-shot user capability
    X->>A: apply exact user action

    alt complete or stop
        A->>S: atomic TaskRecord/workspace/claim terminal transaction
        S->>S: active claim removed; task tombstone written
    end
```

### 3.1 One Kernel mutation owner

Add a canary application service that is the only production caller of `applyTaskActionV2`. It accepts a closed semantic operation union rather than caller-constructed `TaskActionV2`:

- `record_evidence` for one current acceptance ID;
- `record_finding` and `resolve_finding` for ordinary findings;
- `submit_review`;
- `request_rework` from a validated assurance-child verdict and a consumed role-bound capability whose action digest covers the complete normalized finding set;
- `record_approval` from a validated QA or review capability;
- `record_user_approval` from a Pi-confirmed user capability;
- `revise_intent` for a securely reread compatible sidecar revision;
- `approve_breaking_intent_revision` from a Pi-confirmed user capability;
- `complete` when the reducer completion predicate passes;
- `stop` and `resolve_user_decision` from a Pi-confirmed user capability;
- `begin_drain` from a Pi-confirmed user capability as a routing-only operation that preserves the current TaskRecord and workspace owner.

All operations except `begin_drain` derive a strict reducer action. `begin_drain` is not a fifth TaskRecord phase and does not invent a reducer action; the same application instance validates the exact current task/record/workspace/Intent/diff/claim snapshot, consumes the user capability, and commits only the recoverable backend-claim transition under the Kernel store lock.

The service derives or securely rereads `event_id`, timestamp, actor identity, current record/workspace hashes, current Intent identity token, trusted Git diff hash, phase, completion projection, backend claim, and action fingerprint. Callers cannot supply raw CAS hashes, authority descriptors, actor labels, confirmation references, arbitrary history, or a generic patch.

Exact committed replay remains idempotent. A stale task, Intent, diff, workspace, phase, projection, claim, event, or capability fails before writes. The reducer and `applyTaskActionV2` remain the semantic and storage authorities; the adapter does not duplicate phase or completion rules.

### 3.2 Paired mutation-authority registry

Replace the shipped mutation test issuer singleton with an explicit registry/application pairing, following the P2B1 enrollment-authority pattern:

```ts
createMutationAuthorityRegistry(): MutationAuthorityRegistry
createCanaryApplication(registry): CanaryApplication
```

A registry owns private capability state and returns issuer/inspect/consume operations bound to that registry. The application accepts only its paired registry. `request_rework` is privileged at the Kernel boundary exactly like `record_approval`: QA or review authority is consumed under the mutation lock and binds the role, exact snapshot, and complete normalized findings digest. Cross-registry capabilities, copied audit descriptors, serialized values, stale snapshots, wrong roles, replay, and expiry fail closed.

The Pi lifecycle extension creates the sole production **mutation-authority** registry/application instance inside its activation closure. This claim is scoped to TaskRecord lifecycle mutations and `begin_drain`; it does not replace or share capability state with the distinct P2B1 enrollment-authority registry. Tests use a mutation fixture under `tests/fixtures/`; packed runtime files contain no `ForTest` issuer and no exported production instance.

The root Pi package is the composition boundary between the two authority domains. `/imm-canary-enroll` consumes an enrollment capability and commits the durable TaskRecord/workspace/active-claim tuple; the lifecycle extension discovers that committed tuple on a later projection read. No capability, registry object, continuation, or Pi session state crosses the handoff.

### 3.3 Ordinary Pi executor route

Register one LLM-callable tool, `imm_kernel_canary`, with a closed schema for:

- read-only `status`;
- `record_evidence`;
- `record_finding`;
- `resolve_finding`;
- `submit_review`;
- compatible `revise_intent`;
- `complete`.

The tool is available only when the canonical active backend claim identifies the requested task. It cannot accept or invoke `record_approval`, `record_user_approval`, `approve_breaking_intent_revision`, `stop`, or `resolve_user_decision`. It cannot launch an assurance child or mint any capability. Non-TUI Pi may read status, but production mutation through this canary route requires `ctx.mode === "tui"`; RPC, JSON, and print calls fail before state reads that could lead to mutation.

Tool output is a bounded Kernel projection and committed revision, not raw authority state or opaque capability data.

### 3.4 Host-validated QA and review receipt

Register `/imm-canary-assure <task-id> <qa|review>` as a TUI-only command. Command invocation grants no approval. The extension:

1. locks a snapshot descriptor containing repository identity, task/record/workspace revision, the committed TaskRecord's normalized `intent_snapshot` and `intent_ref`, a fresh secure reread proving the sidecar still matches that snapshot/ref, trusted diff hash, required role, acceptance assertions, and normalized verification descriptors;
2. accepts only `assurance_kernel/verification_descriptor/v1` encoded as the complete `acceptance[].verification` string. The string must parse as strict canonical JSON with this exact shape (unknown fields rejected):

```json
{
  "contract": "assurance_kernel/verification_descriptor/v1",
  "runner_id": "bun",
  "runner_version": "1.3.14",
  "argv": ["test", "tests/focused.test.ts"],
  "cwd": ".",
  "timeout_ms": 120000,
  "max_output_bytes": 262144
}
```

For P2B2 the production runner registry contains only `bun`; extending it is a structural trust-boundary change. `argv` is a non-empty bounded string array; `cwd` is repository-relative and whole-path no-symlink; numeric bounds are finite positive integers within host ceilings. The descriptor cannot name an executable path, environment, shell, redirection, command substitution, glob expansion, or PATH lookup. Free-form verification text is not executable; an existing Intent that cannot be parsed is ineligible for assurance and requires an ordinary Intent revision before enrollment or the separately governed revision flow after enrollment;
3. resolves the fixed `bun` runner ID at extension activation through a host-owned runner resolver, never from descriptor/model/session input, and freezes its absolute realpath, device/inode, executable content hash, and exact version before any assurance invocation. It derives the executable verifier only from the locked TaskRecord snapshot after sidecar equality succeeds and binds canonical descriptor bytes, frozen runner identity, argv, cwd device/inode, sanitized-environment digest, task/Intent/diff/record/workspace identities into the child receipt, findings digest, capability action digest, and post-child mutation-lock revalidation. Runner resolution/identity/version mismatch makes assurance unavailable. This follows the parent contract that TaskIntent is semantic authority and does not invent Git status/blob authentication;
4. creates a fresh Pi `AgentSession` itself with `SessionManager.inMemory(root)` and `SettingsManager.inMemory({}, { projectTrusted: false })`. For each child it creates a distinct `0700` permission-restricted empty `agentDir` outside the repository, proves the directory and every parent segment are non-symlinks and still empty, and never reads the parent settings/loader/agentDir. It constructs a new explicit `DefaultResourceLoader` with the same child agentDir/settings manager; exact `noExtensions: true`, `noSkills: true`, `noPromptTemplates: true`, `noThemes: true`, and `noContextFiles: true`; exact empty `additionalExtensionPaths`, `additionalSkillPaths`, `additionalPromptTemplatePaths`, `additionalThemePaths`, and `extensionFactories`; no `resolveProjectTrust` preload; a literal fixed `systemPrompt`; empty append prompt; and no parent/CLI options. It explicitly `await loader.reload()` and passes that same loaded loader, settings manager, and agentDir to `createAgentSession`. In Pi 0.84.1 the programmatic loader's CLI-enabled resource set comes only from these explicit additional paths, so the pre-load extension path set is empty. This construction, not an override, is the code-execution isolation boundary;
5. also applies `extensionsOverride`, `skillsOverride`, `promptsOverride`, `themesOverride`, `agentsFilesOverride`, `systemPromptOverride`, and `appendSystemPromptOverride` to exact expected outputs, but treats them only as defense/evidence because extension overrides execute after extension loading. It passes unique `tools: [<exact extension-owned custom tool names>]` with same-name bounded `customTools` because `tools: []` would filter those custom tools too, and requires the two name sets to be bidirectionally equal with no duplicates. Before prompting, it proves the child agentDir remains empty, no resource module side effect occurred, loaded extensions/skills/prompts/themes/context are empty, prompt equals the fixed literal, diagnostics are empty, and `session.getActiveToolNames()` plus `session.agent.state.tools` equal the exact expected closed set. Any extra/missing tool, resource, diagnostic, event contribution, side effect, or prompt drift aborts before model execution;
6. exposes only bounded read/diff tools plus the verifier described above, gives the child one role-specific fixed prompt, and requires one strict final JSON verdict;
7. owns a task-scoped invocation registry in the extension activation closure with one linear state transition `open -> committed | cancelled`. Concurrent assure/authorize operations for the same task are rejected. Timeout first wins `open -> cancelled`, then awaits `session.abort()`/idle before disposal. A successful continuation must first win `open -> committed` immediately before capability mint/apply; only that winner may proceed, and application failure leaves the invocation closed so retry requires a new invocation. Every callback, finding application, and approval/user mutation proves or wins the same token state at its linearization point; no memory/file cross-transaction atomicity is claimed;
8. in a `finally` path aborts any still-streaming child, waits for idle, unsubscribes event listeners, disposes the child, and recursively removes the child agentDir on completion, cancellation, abort, timeout, parse failure, or exception. Disposal/removal failure is reported and may leave only non-authoritative empty/cache bytes outside the repository; it cannot reopen or commit the invocation;
9. rejects if the child attempted an unavailable tool, omitted any acceptance, returned an invalid role/schema, or if repository/task/Intent/diff/record/workspace/verifier identities changed;
10. derives a unique child actor and receipt identity from the extension-owned invocation, not child JSON;
11. on pass, mints and consumes one role-bound capability in the same operation that records the approval;
12. on rework, normalizes and bounds every finding, binds the complete finding-set digest into a QA/review capability, and consumes it through the Kernel-privileged `request_rework`; no approval is recorded.

A material task requires one review child. A critical task requires distinct QA and review child invocations plus separately confirmed user approval. Executor identity cannot satisfy QA/review independence, and one child actor cannot satisfy both roles. A model response or arbitrary JSON supplied outside the extension-owned child continuation is never authority.

### 3.5 Literal-user actions

Register `/imm-canary-authorize <task-id> <operation>` as a TUI-only command for exactly:

- `begin-drain`;
- `record-user-approval`;
- `approve-breaking-intent-revision`;
- `resolve-user-decision`;
- `stop`.

Arguments are untrusted selectors and optional human text. The extension uses the same task-scoped invocation registry as assurance commands, rejects concurrent operations for that task, securely rereads the current projection, builds the exact proposed action, shows task/Intent/diff/record identities and consequences, then calls `ctx.ui.confirm` with timeout and abort handling. Timeout/cancel wins `open -> cancelled` before the pending UI promise can resolve. A fresh affirmative result must win `open -> committed` immediately before mint/apply; only that continuation proceeds, and application failure leaves the invocation closed so retry requires a new confirmation. Full snapshot revalidation occurs after confirmation and under the mutation lock.

Cancellation, timeout, abort, late resolution, duplicate handler entry, stale state, replay, or capability/application mismatch performs zero writes. No callback, boolean, `authorized`, `user_confirmed`, actor, nonce, reference, environment variable, session entry, or serialized descriptor substitutes for `ctx.ui.confirm`.

### 3.6 Atomic terminal ownership transfer

The current workspace-wide `.imm/tasks/.backend-claim.json` cannot remain after a canary reaches `done` or `stopped`: a global terminal claim would permanently block v3 and any later exact enrollment. P2B2 refines the pre-live P2B0 claim layout before any real canary exists:

- `.imm/tasks/.backend-claim.json` is the unique workspace-active claim and may be `active | draining` only;
- `begin_drain` requires a matching `active` claim, nonterminal TaskRecord, current workspace ownership, and one exact Pi-confirmed user capability;
- its recoverable claim transition preserves TaskRecord/workspace bytes, records the host-derived drain event/audit identity, and converges `active -> draining` under the same Kernel store lock;
- an exact committed drain replay is idempotent, while a conflicting retry, stale snapshot, claim mismatch, interrupted contradictory bytes, or `draining -> active` request fails closed;
- a draining claim rejects new enrollment and all v3 mutation, but permits the same Kernel task's ordinary facts, assurance/user actions, `complete`, and confirmed `stop`;
- `.imm/tasks/<task-id>.backend-claim.json` is an immutable task-scoped tombstone with `lifecycle_status: "terminal"`, final TaskRecord hash, terminal phase, and terminal event ID;
- P2B1 preparation and revalidation read the active claim, target TaskRecord, workspace owner, and exact-task tombstone as one authoritative owner set; malformed, unreadable, symlinked, contradictory, or drifted inputs are structured rejections and are never normalized to absence;
- a task-scoped tombstone never authorizes mutation and never changes backend affinity;
- a terminal tombstone does not block unrelated v3 work or later separately confirmed canary enrollment for another new task;
- the existing terminal TaskRecord and tombstone prevent reenrollment or v3 reconstruction of the same task.

`complete` and user-confirmed `stop` use the only recoverable backend-claim transaction owner under the Kernel store lock. U1 removes or makes module-private every direct claim writer/remover; enrollment, `begin_drain`, terminalization, and recovery enter the same secure-path transaction module. Workspace-global `parseBackendClaim` accepts only `active | draining` and rejects `terminal`. Each marker binds exact before/after content hashes plus existence for TaskRecord, workspace owner, active claim, and tombstone; recovery validates the complete set before converging any write. The transaction atomically converges the terminal TaskRecord, cleared workspace owner, removed active claim, and created task tombstone. Contradictory partial bytes, claim/task mismatch, two active markers, or tombstone conflict fail closed.

No production P2B claim exists yet, so there is no live state migration. Legacy fixture-shaped workspace-global terminal claims remain malformed/fail-closed; they are not silently upgraded. If deployment discovers a real global terminal claim, implementation must stop and replan a separately approved migration.

### 3.7 Pi Skill routing

Add an `imm-canary-work` Skill contract and package registration. The root Pi package loads the existing enrollment extension and the new lifecycle extension as separate capability domains. Their only handoff is the durable, lock-validated TaskRecord/workspace/backend-claim tuple; neither extension imports or receives the other's registry/capabilities. Its activation gate is deterministic:

- no active Kernel claim: preserve the existing BASELINE/v3 route;
- one valid active/draining Kernel claim: route only the matching task to `imm_kernel_canary` plus the two TUI commands;
- malformed or contradictory claim/TaskRecord/workspace/tombstone state: fail closed and report recovery evidence;
- terminal tombstone only: do not reactivate the historical task and do not block ordinary v3 routing for a different task.

The Skill reads Kernel projection on each continuation. It does not persist `next_action`, approval need, child status, Skill sequence, or session identity. The projection remains advisory; reducer preconditions decide every mutation. `imm-work`/`imm-loop` must not mutate or mirror a Kernel-owned task.

### 3.8 Interruption and rollback

- Before any mutation commit, restart discards in-memory child/user capabilities and requires a fresh child or confirmation.
- After a normal mutation commit, recovery uses TaskRecord/workspace CAS state, never Pi session data.
- During terminal commit, the transaction marker deterministically converges record, workspace, active claim, and tombstone.
- Disabling the extension prevents new canary mutations; it does not switch backend or delete TaskRecord state.
- Rollback retains read-only status and the minimum drain/confirmed-stop path for an already enrolled canary.
- A structural change to the authority, lifecycle, terminalization, or host boundary requires replan; QA cannot approve it as a local implementation deviation.

## 4. Invariants

1. Every TaskRecord fact changes through the TaskRecord v2 reducer and CAS application path.
2. Every backend-claim transition changes through the paired canary application and recoverable Kernel store transaction.
3. Production callers cannot submit arbitrary `TaskActionV2`, CAS identities, audit descriptors, or authority fields.
4. QA/review authority exists only inside an extension-owned isolated-child continuation for one exact snapshot.
5. Literal-user authority exists only after fresh Pi TUI `ctx.ui.confirm` for one exact action.
6. Ordinary executor, QA, review, and user actors remain independently attributable under the completion predicate.
7. Pi sessions, session IDs, model output, command text, and serialized receipts are never workflow authority.
8. A Kernel-owned task is never mutated or reconstructed by v3.
9. Terminal TaskRecord, cleared workspace ownership, active-claim removal, and task tombstone converge through one recoverable transaction.
10. A terminal tombstone preserves backend affinity without blocking unrelated future workspace routing.
11. Direct backend-claim writers/removers are not exported or package-resolvable; every active, draining, and terminal claim transition uses the one secure store transaction owner.
12. P2B2 adds no default Kernel routing, real enrollment side effect, additional host privilege, or second persisted state machine.

## 5. Verification Matrix

- semantic operation allowlist and raw-action/unknown-field rejection;
- derived CAS/event/actor/Intent/diff identities and stale-state rejection;
- capability registry pairing, role binding, expiry, replay, cross-registry rejection, and fixture isolation;
- ordinary Pi tool mode/action matrix and privileged-action absence;
- isolated child creation with a fresh `0700` empty no-symlink child agentDir outside the repository, empty untrusted in-memory settings, all `no*` flags, zero additional/factory paths, no trust preload, fixed literal prompt, exact custom-tool allowlist, runtime tool/resource/diagnostic/side-effect assertions, malicious global/project/explicit-path resource fixtures, timeout/abort/idle/unsubscribe/dispose/remove behavior, and no session file;
- versioned no-shell verification descriptor parsing, pinned runner/argv/cwd/environment identity, free-text/PATH/shell rejection, and post-child mutation-lock revalidation;
- child pass/rework/malformed/partial/unknown-tool/stale-snapshot paths, including capability-bound normalized findings and direct `request_rework` rejection;
- executor/review/QA/user independence for routine, material, and critical completion;
- user command mode matrix, exact prompt, cancellation, late resolution, reentry, stale state, and zero-write failure;
- user-confirmed `active -> draining`, exact replay, crash recovery, enrollment/v3 rejection, same-task continuation, and irreversible no-reactivation behavior;
- complete/stop terminal transaction crashes at every rename boundary;
- active/draining claim, exact-task terminal tombstone, TaskRecord, workspace, and P2B1 preparation consistency; malformed owner reads fail explicitly rather than appearing absent;
- one secure backend-claim transaction owner, no exported/direct writer or remover, global-terminal parser rejection, exact four-file before/after marker hashes/existence, and recovery convergence;
- enrollment-authority and lifecycle-mutation-authority registry separation plus durable claim handoff through the root Pi package;
- `imm-canary-work` source/dist/package route parity and v3 no-dual-write guard;
- same-task invocation registry rejects concurrent assure/authorize and covers never-returning provider/tool/UI, timeout-before-abort, late true, late child output, duplicate handlers, stale callback, and dispose failure;
- a generated package tarball is extracted into an isolated root and loaded through the real Pi resource loader to prove both extensions and the Skill are discoverable from shipped bytes;
- a real package consumer enumerates the root package's explicit export map and probes all declared package subpaths; the export map exposes no executable Kernel internal, while host registry inspection after Pi resource loading proves only the specified tool/commands are registered. Registry issuers, generic mutation application, direct claim writers/removers, and terminal transaction internals are neither package-exported nor host-registered. Pi resource discovery continues through the package's `pi` metadata and packed files, not executable package exports. File-path imports by malicious same-user code remain outside the declared threat model;
- synthetic full lifecycle from enrolled `working` through rework and terminal completion;
- live repository smoke proves no TaskRecord, backend claim, tombstone, workspace, Intent, Ledger, receipt, observation, or readiness-evidence mutation;
- full repository tests, extension TypeScript check, actual packed-artifact loader test, package dry-run, Plan validation, and diff hygiene.

## 6. Rollback

1. Disable the `imm-canary-work` Skill and Pi lifecycle extension routes.
2. Preserve read-only Kernel status plus drain/user-confirmed stop for any already enrolled canary.
3. Remove the ordinary executor and child/user authority adapters only after no active/draining claim exists.
4. Preserve terminal TaskRecords and task-scoped tombstones as immutable backend-affinity history.
5. Never reconstruct v3 Plan/Step state, delete canary audit state, or switch an existing task to v3.

## 7. Roadmap Continuation

P2B2 completes the code path needed to operate one explicitly enrolled Pi canary. Actual first enrollment remains a separate literal-user Pi TUI operation, not an implementation Step. P2C remains deferred until a separately declared real-canary observation window proves zero authority bypass, dual write, manual repair, restart, rollback, or terminalization incidents and the literal user approves promotion.
