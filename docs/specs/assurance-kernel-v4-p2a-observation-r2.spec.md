# Assurance Kernel v4 P2A Observation Contract R2 Specification

**Design risk**: High
**Diagram decision**: required
**Diagram reason**: terminal authority receipts, replay seeds, automatic observation persistence, and crash recovery cross two v3 commit adapters and determine whether future readiness evidence is trustworthy.

## 1. Status and Scope

This document is the Technical Design authority for R2A only: exact, replayable, receipt-bound automatic observations for every receipt-v2 v3 authority commit.

The broader P2 design remains split into later slices:

- R2B: readiness reconciliation, epoch/lifecycle/family projection, migration/rollback evidence, and read-only reporting;
- R2C: TaskIntent v1, TaskRecord v2, completion identity, reducer actions, and authority consumption;
- P2B: Pi-only canary enrollment and authenticated capability issuance;
- P2C: supported-host default routing;
- P3: legacy retirement and any separately justified terminal import.

R2A does not implement or retain an unclosed readiness route. Partial R1 readiness code is removed as predecessor cleanup and reintroduced only under an R2B Plan.

P2A remains v3-only:

- Ledger remains the sole production workflow authority;
- no production TaskRecord mutation or enrollment exists;
- no host capability issuer exists;
- no privileged CLI/RPC/JSON/print path exists;
- no dual write, backend switch, terminal import, or legacy data rewrite exists.

## 2. Replan Cause

R1 U1 established durable receipt v1 across normal mutation, Ledger-changing migration, and autowork authority CAS. R1 U2 then attempted readiness reconciliation from observation v1.

Strict QA proved observation v1 cannot satisfy exact reconciliation:

- it persists attempt ID and Ledger revision but not terminal receipt record ID, source kind, or exact committed bytes hash;
- a terminal receipt can succeed while observation append fails;
- after a later commit, live Ledger reread cannot reconstruct the original projection;
- starting a promotion epoch at the first successful observation can hide an earlier failed observation;
- legacy hash/attempt-only observations cannot safely qualify;
- readiness policy was therefore built on an incomplete producer contract.

The correction is additive receipt/observation v2 with replay-sufficient terminal seed. Readiness is a successor slice, not part of this Plan.

## 3. Goals and Non-Goals

### 3.1 Goals

1. Persist the qualifying observation generation in receipt v2 before every authority replacement.
2. Persist replay-sufficient exact observation seed in every committed/recovered-committed terminal receipt v2.
3. Emit one strict automatic observation v2 keyed by terminal receipt record ID.
4. Replay missing observations from receipt seed after later commits without rereading historical live Ledger bytes.
5. Apply identical semantics to normal state mutation, project migration, and autowork authority CAS.
6. Keep receipt/observation v1 readable and immutable but permanently nonqualifying.
7. Remove the unclosed R1 readiness module/route/tests so R2A closes one evidence-producer boundary only.

### 3.2 Non-Goals

- Readiness states, 14-day window, lifecycle/family qualification, or promotion candidate calculation.
- Migration digest or rollback rehearsal evidence.
- TaskIntent/TaskRecord v2 or production reducer actions.
- P2B canary, Pi confirmation, capability minting, route enrollment, or backend pinning.
- Rewriting v1 receipts, observations, friction journal, or migration manifests.
- Security against the same OS user arbitrarily changing workspace files.

## 4. Technical Design

### 4.1 Receipt v2 Epoch Boundary

Receipt v2 is additive. Receipt v1 remains readable with existing semantics.

Every receipt-v2 prepared record adds:

```text
observation_generation: "automatic-observation/v2"
```

The field is fsynced before the authority replacement. Therefore a failed first v2 observation remains visible in the denominator; the epoch cannot start at the first successful append.

Every terminal receipt v2 repeats the same generation. A prepared/terminal generation mismatch is invalid and fails closed.

Receipt v1 has no generation and is diagnostic-only for future readiness.

### 4.2 Replay-Sufficient Terminal Seed

A committed or recovered-committed terminal receipt v2 contains one strict `observation_seed` built from the exact committed bytes while they are still the commit adapter's immutable snapshot:

```text
observation_seed
  source_kind
  source_ref
  state_path_identity
  committed_bytes_sha256
  ledger_revision
  plan_path
  source_events[]
  shadow
  divergence
  committed_at
  observer_version
```

Rules:

1. `committed_bytes_sha256` must equal the receipt target `after_sha256` for `.imm/memory/current_iteration.json`.
2. `ledger_revision` and projection are computed from the same exact committed bytes.
3. Seed construction never rereads the live Ledger after lock release.
4. Seed canonical bytes participate in terminal receipt record identity and receipt hash chain.
5. Seed failure never changes an already successful v3 authority result. The receipt terminal can record a strict seed error; future readiness remains blocked and no synthetic observation is invented.
6. Aborted/recovered-aborted receipts carry no qualifying seed.

The seed is commit telemetry replay material, not workflow authority. It cannot select a Plan, Step, route, or action.

### 4.3 Automatic Observation v2

Qualifying observations use a dedicated append-only journal under `.imm/memory`, separate from friction/query `.imm/journal.jsonl`:

```text
.imm/memory/.current_iteration.authority_observations.jsonl
```

Observation v2 is strict and closed:

```text
assurance_kernel/v3_authority_observation/v2
  observation_id
  receipt_record_id
  receipt_attempt_id
  receipt_protocol
  receipt_status: committed | recovered_committed
  source_kind
  source_ref
  state_path_identity
  committed_bytes_sha256
  ledger_revision
  plan_path
  source_events[]
  shadow
  divergence
  observer_generation
  observer_version
  committed_at
  observed_at
```

Semantics:

- primary key: terminal `receipt_record_id`;
- identical replay: `duplicate`;
- same receipt record ID with different canonical payload: hard conflict;
- observation identity is domain-separated over canonical observation core;
- all copied seed and receipt fields must match exactly;
- prepared, aborted, recovered-aborted, malformed, unknown-generation, or v1 receipts cannot produce v2 observations;
- journal append and replay never write Ledger, TaskRecord, workspace pointer, Intent, migration manifest, or route state.

### 4.4 Durable Replay

After terminal receipt v2 is fsynced, the adapter best-effort appends observation v2 from the terminal seed.

If append fails:

- the successful v3 command result, exit code, stdout, and Ledger bytes remain unchanged;
- the terminal receipt itself retains all replay material;
- startup/preflight and later authority writes best-effort scan terminal receipt v2 records for missing v2 observations;
- replay reconstructs only from immutable terminal seed and terminal receipt identity;
- replay never reads a later live Ledger to reconstruct historical projection;
- persistent replay failure remains an explicit gap for R2B; it does not create a substitute record.

A later commit may proceed because the durable seed prevents evidence loss. Observation replay remains telemetry and cannot become a workflow write gate.

### 4.5 Writer Symmetry

The same v2 protocol applies to all three production authority writers:

| Writer | Exact bytes owner | Terminal seed point |
|---|---|---|
| `commitStateMutation` | canonical bytes before atomic Ledger replace | after successful replace, before releasing immutable snapshot |
| Ledger-changing `migrateProject` | committed Ledger target bytes in migration transaction | after committed-manifest publication from captured target bytes |
| autowork authority CAS | CAS proposal bytes | after successful receipt-backed CAS replace |

Pure `commitStateIfUnchanged` projection writes remain excluded only while tests prove authority digest unchanged. Raw `saveStateLedgerForTest`/compatibility alias remains test-only. A new production writer invalidates R2A closure.

### 4.6 Legacy Classification

Historical evidence is classified without rewrite:

- `legacy-readable`: receipt v1 and observation v1/hash/attempt-only records; visible to diagnostic commands but never v2 evidence;
- `qualifying`: strict receipt v2 plus strict automatic observation v2;
- `invalid qualifying claim`: a record claiming v2/generation v2 with malformed or mismatched fields; future readiness must block.

Legacy records never satisfy a v2 receipt, extend a v2 epoch, supply lifecycle/family coverage, or conflict with v2 dedup merely because an old attempt alias matches.

### 4.7 R1 Readiness Cleanup

R1 U2 did not close. R2A removes its partial production files/route/tests from the worktree:

- remove the unclosed `kernel/readiness.ts` implementation;
- remove `imm-kernel readiness` dispatch/help support added by R1 U2;
- remove partial readiness policy tests and readiness-specific migration test additions;
- preserve all closed U1 receipt behavior and unrelated existing Kernel status/journal/migrate behavior.

A source-level boundary test proves `readiness` is not exposed until R2B owns the contract.

### 4.8 Sequence Diagram

```mermaid
sequenceDiagram
    participant C as v3 Commit Adapter
    participant R as Receipt v2 Journal
    participant S as Ledger or Migration Target
    participant A as Automatic Observation v2 Journal

    C->>R: fsync prepared(generation v2, unique attempt)
    C->>S: commit exact bytes
    C->>C: build observation seed from exact committed bytes
    C->>R: fsync terminal(receipt identity, seed)
    C->>A: best-effort append observation v2
    alt append failed or process stopped
        Note over R,A: terminal seed remains replay-sufficient
        C->>A: later best-effort replay from receipt seed
    end
    Note over C,A: no historical live Ledger reread; no workflow authority change
```

## 5. Invariants

1. V3 remains the sole production workflow authority.
2. Every receipt-v2 authority commit declares generation before replacement.
3. Every committed/recovered-committed receipt v2 contains a replay-sufficient seed or an explicit irrecoverable seed error.
4. Every automatic observation v2 binds one terminal receipt record exactly.
5. Historical observation replay never depends on later live Ledger bytes.
6. Receipt/observation v1 remains readable but cannot qualify as v2 evidence.
7. Observation failure cannot alter a successful v3 command.
8. R2A exposes no readiness route, production TaskRecord mutation, issuer, enrollment, import, or backend switch.

## 6. Failure and Recovery Matrix

| Failure point | Authority result | Receipt v2 | Observation v2 | Recovery |
|---|---|---|---|---|
| before prepared fsync | no commit | none | none | command fails normally |
| after prepared, before authority replace | no commit | prepared | none | receipt recovery aborts |
| after replace, before seed/terminal | committed | prepared | none | recover terminal from still-current exact after bytes before next write; explicit seed error if exact reconstruction is impossible |
| after terminal, before observation | committed | terminal with seed | absent | replay from terminal seed after any later commit |
| observation append conflict | committed | terminal with seed | invalid/conflict | v3 succeeds; evidence remains conflicted |
| migration rollback | no successful Ledger commit | aborted/recovered-aborted | none | no qualifying observation |
| projection CAS rejection | no authority commit | no committed receipt | none | caller sees existing CAS result |

## 7. Acceptance Criteria

1. Receipt v1/v2 parse and hash-chain compatibility tests pass without journal rewrite.
2. Prepared receipt v2 generation makes a failed first v2 observation detectable.
3. Terminal seed fields derive from one exact committed byte snapshot and match receipt targets.
4. Normal mutation, migration, autowork CAS, recovery, and duplicate/conflict paths share one v2 observation contract.
5. Observation failure followed by later commits replays the original exact seed without live historical reread.
6. V1 diagnostics remain readable and nonqualifying; invalid v2 claims fail closed.
7. R1 readiness partial route/module/tests are removed and a source-level boundary test proves no readiness route remains.
8. Focused fault tests, full `bun test`, strict QA, final review, and `git diff --check` pass.

## 8. Devil's Advocate Audit

**DA1: Why not continue with attempt-ID observation v1?**

Attempt ID does not prove terminal receipt identity, source, exact committed bytes, or projection provenance.

**DA2: Why not add optional v2 fields to observation v1?**

That would give one persisted contract two meanings. Additive v2 keeps v1 immutable and classifiable.

**DA3: Why store a seed in the terminal receipt?**

Without replay material, terminal success plus observation failure becomes unrecoverable after a later commit. The bounded seed preserves telemetry input without storing a second workflow state.

**DA4: Does a seed make receipts workflow authority?**

No. The seed records commit-time projection facts and cannot drive workflow behavior. Ledger remains the only workflow authority.

**DA5: Why allow later commits while an observation is missing?**

Observation is non-authoritative. The durable seed prevents loss, while persistent gaps remain visible to future readiness. Blocking v3 on telemetry would violate P2A safety.

**DA6: Why remove readiness code instead of repairing it now?**

Two consecutive replans came from coupling producer and policy boundaries. R2A first closes trustworthy evidence production. R2B then consumes that stable contract independently.

**DA7: Why keep friction journal writes?**

They are nonqualifying operational telemetry. R2A's automatic evidence uses a dedicated journal, so query telemetry cannot be mistaken for authority observation.
