# Assurance Kernel v4 R2C2 Mutation Port Specification

Status: Proposed
Owner: Immune-Brain
Last updated: 2026-08-12

## 1. Purpose

R2C2 closes the last P2A code boundary: every TaskRecord v2 factual mutation is expressed as one closed reducer action, revalidates the Git-owned TaskIntent identity at the mutation boundary, consumes opaque single-use authority when privileged, and commits through one recoverable TaskRecord/workspace CAS transaction.

R2C2 remains production-ineligible. It adds no CLI, host command, routing, enrollment, production authority issuer, terminal import, or generic mutation surface. Pi canary issuance and enrollment remain P2B.

## 2. Scope

### In scope

- additive TaskRecord v2 action types and update invariants;
- pure TaskRecord v2 reducer and event replay identity;
- opaque authority-consumption capability contract with a module-private test issuer;
- single-use consumption of the R2C1 Intent identity token;
- one application port that rereads Intent, validates record/diff/CAS identity, reduces, and commits;
- a dedicated recoverable TaskRecord v2/workspace transaction path;
- explicit v1 compatibility and v2 rejection by v1 writers;
- negative boundary tests proving no production issuer, CLI, route, import, or generic patch surface.

### Out of scope

- TaskRecord v2 creation or enrollment;
- Pi `ctx.ui.confirm` issuer;
- any production host adapter or CLI mutation command;
- backend selection or routing;
- readiness promotion or canary approval;
- terminal import, hydration, restore, or generic snapshot replacement;
- changing TaskRecord v1 behavior.

## 3. Design Risk

**Design risk**: High
**Diagram required**: Yes

## 4. Technical Design

```mermaid
sequenceDiagram
    participant Caller as Trusted Host Callback / Test Harness
    participant App as TaskMutationPortV2
    participant Intent as Secure Intent Reader
    participant Auth as Authority Port
    participant Reducer as Pure Reducer v2
    participant Store as CAS Store v2

    Caller->>Intent: prior read creates opaque prior identity token
    Caller->>App: action + expected content hashes + prior token + optional capability
    App->>Store: acquire the existing exclusive store lock
    App->>Store: reject simultaneous v1/v2 markers; recover one pending marker
    App->>Store: read current TaskRecord v2 + workspace
    App->>App: validate task/workspace content-hash CAS
    App->>Intent: fresh secure reread creates current identity token
    App->>Intent: inspect prior/current token pair without consuming
    App->>App: parse action; check replay/conflict; preflight reducer + invariants
    App->>Auth: inspect optional capability without consuming
    alt exact event already committed
        App-->>Caller: current committed snapshot
    else all preflight checks passed
        App->>Intent: consume required identity token(s)
        App->>Auth: consume required capability
        App->>Store: write v2 transaction marker immediately
        App->>Store: converge exact record/workspace bytes; remove marker
        Store-->>Caller: committed TaskRecord/workspace
    end
```

## 5. Closed Action Vocabulary

`TaskActionV2` is the following strict discriminated union. Every member also contains `event_id: string`, `at: string`, `actor_id: string`, `expected_record_hash: "sha256:<64hex>"`, `expected_workspace_hash: "sha256:<64hex>"`, and `diff_hash: "sha256:<64hex>"`. Unknown fields fail closed. There is no generic patch action.

- `record_evidence { evidence: TaskEvidenceV2 }`
- `record_finding { finding: TaskFinding }`
- `resolve_finding { finding_id: string }`
- `record_approval { approval: TaskApprovalV2 }`
- `record_user_approval { approval: TaskApprovalV2 }`
- `revise_intent { next_intent: TaskIntentV1; next_intent_ref: TaskIntentRefV2 }`
- `approve_breaking_intent_revision { next_intent: TaskIntentV1; next_intent_ref: TaskIntentRefV2 }`
- `submit_review {}`
- `request_rework { findings: NewReviewFinding[] }`
- `complete {}`
- `stop { reason: string }`
- `resolve_user_decision { finding_id: string; resolution: string }`

Factual effects and preconditions are closed:

- evidence, finding, and approval actions append exactly the supplied strict item after identity/role/phase validation;
- ordinary `resolve_finding` changes only one existing non-user-decision finding from open to resolved;
- `record_user_approval`, breaking revision, `stop`, and `resolve_user_decision` require user capability; QA/review approvals require the matching role capability;
- compatible/breaking revision atomically replaces snapshot/ref/top-level `intent_revision`; compatible revision preserves task ID, goal, owner, acceptance IDs/assertions, and non-decreasing risk; breaking revision may only remove/modify acceptance assertions or raise risk — it can never change task ID, owner, or goal (those changes require a new Task);
- `submit_review`, `complete`, and `stop` perform one phase transition plus one history append;
- `request_rework` records one review-response batch containing one or more findings, computes one review round, performs one phase transition, and appends one history item; the batch is one closed factual effect;
- `complete` is legal only when `completionDecisionV2` is complete;
- `resolve_user_decision` resolves exactly one open user-decision finding.

`task_revision` in evidence and approvals means the current **Intent revision**, matching `record.intent_revision`; it is not a TaskRecord CAS revision. TaskRecord and workspace CAS revisions are canonical serialized content hashes supplied as `expected_record_hash` and `expected_workspace_hash`.

`diff_hash` is never caller-authoritative. The application port computes the current workspace diff hash inside the store lock through an injected trusted diff provider. The action carries `diff_hash` only as an expected value; any mismatch between the expected and freshly computed hash fails closed with zero writes.

`actor_id`, `authority_role`, `confirmation_ref`, or serialized audit data never grant authority.

## 6. Reducer v2

`reduceTaskV2(record, action, authorityAudit?)` is pure and accepts parsed TaskRecord v2 and TaskAction v2 only.

It must:

- enforce phase and factual preconditions;
- derive phase and completion using `completionDecisionV2`;
- enforce review round termination and required approval roles;
- classify intent revision with the R2C1 classifier;
- stale prior evidence and approvals by projection after an intent revision; no persisted stale flags;
- append one history event whose fingerprint binds action, current record hash, intent revision/hash, diff hash where applicable, and authority descriptor where privileged;
- return an identical record for an identical already-committed replay;
- reject conflicting reuse of an event ID;
- return a module-branded `ReducedTaskMutationV2` that cannot be serialized or caller-constructed.

The persisted history audit descriptor is evidence only and cannot authorize another action.

## 7. Intent Identity Consumption

R2C1's `readTaskIntent()` returns a module-private WeakMap-backed identity token. R2C2 adds private inspect/consume functions used only by the application port; no consumer is exported from `kernel/index.ts`.

Ordinary-action protocol:

1. the caller supplies the prior token minted for the Intent identity currently stored in the record;
2. under the store lock, the application securely rereads the sidecar and obtains a fresh current token;
3. private inspection verifies both tokens are genuine, unconsumed, same task/path, and represent the same revision/hash/file identity required by `record.intent_ref`;
4. all action/replay/CAS/reducer/invariant preflight completes;
5. immediately before the transaction marker is written, both tokens are consumed.

Revision-action protocol:

- the prior token must match the old record identity;
- the fresh current token must match `next_intent` and `next_intent_ref` read from the changed sidecar;
- R2C1 classification compares old snapshot to fresh snapshot; compatible and breaking actions must match that classification;
- both old/new identities, including file/parent/root identity, are action-fingerprint inputs.

Token requirements:

- tokens are single-use and consumption is irreversible;
- failed inspection/preflight does not consume a token;
- after token consumption, the application must write the exact v2 transaction marker without another fallible policy step;
- token task/path/revision/hash and file identity must match the old/current identities described above;
- secure reread retains all R2C1 containment, no-follow, FD/path/parent identity, size, schema, Git tracking, and A-to-B-to-A checks;
- JSON serialization, spread, cloning, or caller fabrication cannot create a valid token;
- restart discards all tokens and requires a fresh read.

Failed validation performs zero record/workspace writes. A failed post-consumption marker write burns the token and requires a fresh retry; no write is reported as committed.

## 8. Authority Consumption Port

`MutationAuthorityCapabilityV2` is an opaque module-private branded object backed by WeakMap state and a consumed flag. The public kernel index exports no constructor or issuer.

Capability state binds:

- authority kind: `review`, `qa`, or `user`;
- task ID;
- exact action digest and event ID;
- expected TaskRecord revision and canonical record hash;
- intent revision and content hash;
- diff hash when applicable;
- actor ID;
- confirmation or child-receipt reference;
- expiry timestamp.

The capability port exposes separate private inspection and consumption operations. Parsing, event replay/conflict checks, TaskRecord/workspace content-hash CAS, Intent inspection, pure reducer preflight, and `assertTaskRecordUpdateV2` all complete before irreversible consumption. Exact committed replay returns before capability inspection/consumption. Once consumed, the application immediately writes the transaction marker; a marker-write failure intentionally burns the capability and requires reissue.

Missing, expired, mismatched, fabricated, serialized, cloned, or reused capability fails with zero writes. Preflight failures do not consume a valid capability. A test-only issuer lives in `authority_port.ts`, is not exported from `kernel/index.ts`, and is accepted only by direct module tests. R2C2 creates no production issuer.

Idempotent committed replay is checked before capability consumption: an exact event already present in the current record returns the current committed snapshot. A conflicting event reuse fails. An uncommitted retry requires fresh identity and authority capabilities.

## 9. Application Port and CAS Transaction

`applyTaskActionV2()` is the single TaskRecord v2 mutation port. It is exported from the kernel library for later trusted-host integration but is not exposed through CLI, runtime manifest, RPC, or host adapters.

Within the existing exclusive kernel store lock it:

1. rejects a state where both v1 and v2 transaction markers exist;
2. recovers exactly one pending marker by contract dispatch;
3. reads and strictly parses TaskRecord v2 and workspace state;
4. validates expected TaskRecord/workspace canonical content hashes;
5. securely rereads Intent and inspects prior/current identity tokens;
6. parses the strict action and checks exact committed replay or conflicting event reuse;
7. preflights optional authority, pure reduction, completion, and TaskRecord v2 update invariants without consuming capability/token state;
8. consumes required identity token(s) and authority capability;
9. writes the exact v2 transaction marker immediately;
10. converges exact record/workspace bytes and removes the marker.

V1 remains `.imm/tasks/.workspace-transaction.json` with `workspace_transaction/v1`. V2 uses `.imm/tasks/.workspace-transaction-v2.json` with `workspace_transaction/v2`. Both are serialized by the same store lock. Simultaneous v1/v2 markers fail closed before either is recovered. Each parser rejects the other contract. Recovery ordering is therefore: detect conflict, otherwise recover v1 or v2, then process a new operation. V2 recovery rejects contradictory partial task/workspace bytes and converges only exact marker bytes.

The v2 contract stores `expected_record_hash`, `next_record_content`, `expected_workspace_hash`, and `next_workspace_content`; canonical content hashes are the CAS revisions. It does not accept a union record parser or alter v1 bytes/APIs.

TaskRecord v2 creation remains unavailable in R2C2.

## 10. Update Invariants

`assertTaskRecordUpdateV2(previous, next, action)` enforces:

- contract and task ID immutable;
- `intent_revision` equals snapshot revision and `intent_ref.revision` at all times;
- only intent-revision actions may change intent snapshot/ref/revision;
- non-intent actions preserve exact intent identity;
- compatible revision preserves task ID, goal, owner, acceptance IDs/assertions, and does not lower risk;
- breaking revision requires user authority, but may only remove/modify acceptance assertions or raise risk; it can never change task ID, owner, or goal (those changes require a new Task);
- evidence/approval `task_revision` equals the resulting current Intent revision;
- collections are append-only except resolving one existing finding and the closed `request_rework` review batch;
- no existing evidence, finding, approval, or history entry is rewritten or removed;
- exactly one action-defined factual effect plus one history effect occurs;
- `complete` uses `completionDecisionV2` and all phase transitions remain within working/review/done/stopped;
- workspace working ownership matches the resulting phase.

No persisted TaskRecord mutation counter is introduced. TaskRecord and workspace CAS use canonical serialized content hashes, while `task_revision` remains the Intent revision.

## 11. Failure and Recovery

- Invalid action, stale record/workspace CAS, Intent drift, token mismatch, missing authority, authority mismatch/expiry/reuse, invalid diff binding, reducer rejection, or invariant failure writes nothing.
- A transaction interruption remains recoverable from the v2 transaction marker.
- Recovery never rereads Intent to invent the already-decided next record; the marker contains exact next bytes.
- Host restart discards all in-memory capabilities. The trusted host must reread Intent and, for privileged action, reconfirm/reissue.
- No fallback to v1 or v3 occurs after a v2 mutation attempt.

## 12. Compatibility and Boundary

- Existing v1 types, parser, reducer, storage, tests, and command behavior remain unchanged.
- Existing v1 writers continue to reject TaskRecord v2.
- R2C2 adds no TaskRecord v2 creation path.
- `imm-kernel` command values remain `status`, `readiness`, `journal`, and `migrate`.
- Canonical runtime manifest and host adapters gain no mutation subcommand or issuer.
- No authority capability, intent token, branded reducer result, transaction marker, or audit descriptor is accepted from JSON, CLI flags, environment, files, journal, or session state.

## 13. Acceptance Criteria

- Every closed TaskAction v2 has reducer tests for success, phase rejection, exact replay, and conflicting event reuse.
- Every factual mutation binds record/intent identity and diff hash where applicable.
- Privileged actions reject missing, fabricated, mismatched, expired, serialized, and reused capability.
- Intent tokens reject missing, fabricated, serialized, mismatched, stale, reused, and A-to-B-to-A identity.
- Compatible and breaking revision paths enforce their distinct authority and update invariants.
- TaskRecord v2/workspace CAS rejects stale task or workspace revisions and allows exact committed replay.
- Transaction interruption recovers without partial state.
- V1 API signatures and behavior remain unchanged and v1 writers reject v2.
- No CLI/runtime/host/issuer/import/enrollment surface appears.
- Full repository tests, Plan validation, and diff hygiene pass.

## 14. Roadmap Continuation

R2C2 closes P2A's mutation vocabulary and authority-consumption contract. It does not make Kernel production-routable.

P2B remains blocked on readiness promotion evidence and literal user approval. P2B will add the Pi `ctx.ui.confirm` issuer, enrollment, TaskRecord v2 creation, backend pinning, trusted callback wiring, and drain-only rollback.
