# Retire Process Review Transport (`S2`)

- **Task ID**: `retire-process-review-transport`
- **Depends on (`--blocked-by`)**: `explicit-port-review-session` (`S1`)
- **Initiative**: `explicit-port-review-and-retro-hygiene` (`Explicit Port Review and Retro Signal Hygiene`)
- **Design risk**: High
- **Threat model and supported environment**: Inputs come from approved repository/project config (`layered_config.ts`), unattended batch CLI arguments/state (`batch_state.ts`), Host environment probes inside/outside Herdr TUI (`herdr` protocol 22 via `SupervisedSessionPort`), and Kernel assurance checkpoints. Security/authority boundary: forbid silent background `--print` subprocess fallback outside Herdr so every Authority Review and CLI Findings Verification runs in an inspectable explicit Code Agent session (`BR-DEC-1`, `BR-OUT-1`) while failing closed outside Herdr without discarding existing QA attestation.
- **Design views**:
  1. *Configuration & Validation*: Default `LANE_DEFAULTS.review_transport` to `"herdr"` and retire `"process"` in `validateLane` (`layered_config.ts:21,124`) and unattended batch profile helpers (`batch_state.ts:27-52,1138-1165`).
  2. *Fail-Closed Transport Gate*: Retire hidden background `--print` `writeProcessScript` fallback (`cli_review.ts:250-264`) so un-admitted environments fail Review/Verification preparation with `state: "review_preparation_failed"`, `code: "review_transport_unavailable"`, and one same-Host recovery action inside Herdr (`cli_review.ts`, `tests/cli-review-dispatch.test.ts:903-909`).
  3. *Documentation & ADR Sync*: Update Loop contracts (`dist/drive.md`, `dist/drive-batch.md`), canonical reference docs (`docs/reference/*`) plus byte-identical packaged mirrors (`plugins/immune-brain/dist/docs/reference/*` per `scripts/dist-sync-manifest.ts:32,43`), and ADRs (`docs/adr/0037-authority-review-cli-stage.md`, `docs/adr/0039-verification-cli-stage.md`), keeping `docs/adr/0038-supervised-session-port.md` intact (`tests/loop-daemon-contracts.test.ts:48-50`).
  4. *Conformance & Config Verification*: Update `tests/cli-review-dispatch.test.ts`, `tests/layered-config.test.ts`, `tests/dual-host-assurance-conformance.test.ts`, and `tests/helpers/cli-reviewer.ts`.
- **Execution posture**: Serialized after `S1` (`explicit-port-review-session`) on the four shared files (`cli_review.ts`, `layered_config.ts`, `dist/drive.md`, `tests/cli-review-dispatch.test.ts`).

---

## 1. Problem and Evidence

1. **Hidden background `--print` fallback remains default and configurable (`BR-DEC-1`)**:
   - `plugins/immune-brain/runtime/config/layered_config.ts:21` currently sets `LANE_DEFAULTS.review_transport` to `"process"`, and `validateLane` (`layered_config.ts:124`) still admits `v === "process" || v === "herdr"`.
   - `plugins/immune-brain/runtime/assurance/cli_review.ts:250-264` retains `writeProcessScript` background process execution, and `tests/cli-review-dispatch.test.ts:908-909` expects `recovery_action` to suggest falling back to `lanes.review_transport` (`"process"`).
2. **Global mandatory explicit Port policy (`BR-DEC-1`)**:
   - User selected Option `Q1=B` ("Global mandatory explicit Port session, fail-closed"): all Authority Review and CLI Verification executions must launch explicitly via admitted `SupervisedSessionPort` (`herdr`). Running outside Herdr must fail closed with `review_preparation_failed` (`code: "review_transport_unavailable"`), offering one same-Host recovery action inside Herdr while preserving prior QA attestation, rather than silently spawning hidden background `--print` subprocesses.

---

## 2. Architecture & Design Decisions

Each design decision traces to an exact source requirement (`BR-*`) or explicit delegated technical choice:

- **D1 — Retire `"process"` Transport in Lane Config & Batch Profiles** *(Source: `BR-DEC-1`, `BR-REQ-1`)*:
  - Set `LANE_DEFAULTS.review_transport` to `"herdr"` in `plugins/immune-brain/runtime/config/layered_config.ts:21`.
  - Update `validateLane` (`layered_config.ts:124`) to admit only `v === "herdr"`, rejecting `"process"` with clear config validation failure.
  - Update `plugins/immune-brain/runtime/unattended/batch_state.ts` (`parseBatchReviewProfile` `:27-36`, `reviewProfileFromArgs` `:43-52`, `laneBatchReviewProfile` `:1138-1165`) so batch review profiles default to and validate `"herdr"` without reintroducing `"process"`.
- **D2 — Fail Closed Outside Herdr While Preserving QA Attestation** *(Source: `BR-DEC-1`, `BR-OUT-1`)*:
  - Retire `writeProcessScript` (`cli_review.ts:250-264`) and all hidden background `--print` `process` execution fallback paths in `cli_review.ts`.
  - When `herdr` Port admission is unavailable (e.g., outside Herdr / missing Herdr workspace session), `prepareReview` and `prepareVerification` fail closed with `state: "review_preparation_failed"`, `code: "review_transport_unavailable"`, and a single same-Host recovery action instructing the operator to run inside Herdr (`imm-session` / Herdr Host session) with zero suggestion of `lanes.review_transport: process`. Kernel QA attestation remains intact.
  - `runtime/assurance/` maintains zero imports from `runtime/session/` (`BR-OUT-1`).
- **D3 — Synchronize Reference Docs, Loop Contracts, and ADRs** *(Source: `BR-DEC-1`, `BR-REQ-1`, `delegated technical choice`)*:
  - Update `plugins/immune-brain/dist/drive.md` and `plugins/immune-brain/dist/drive-batch.md` to retire legacy `"process"` fallback prose.
  - Update `docs/reference/immune-brain-config.md` + `plugins/immune-brain/dist/docs/reference/immune-brain-config.md` (byte-identical mirror per `scripts/dist-sync-manifest.ts:32`) and `docs/reference/supervised-session-port.md` + `plugins/immune-brain/dist/docs/reference/supervised-session-port.md` (mirror per `scripts/dist-sync-manifest.ts:43`).
  - Record concise retirement/amendment notes in `docs/adr/0037-authority-review-cli-stage.md` and `docs/adr/0039-verification-cli-stage.md` (preserving `docs/adr/0038-supervised-session-port.md` intact as checked by `tests/loop-daemon-contracts.test.ts:48-50`).

---

## 3. Settlement-Design Contract

- **No silent downgrade on missing transport**: If `herdr` provider admission fails during `prepareReview` or `prepareVerification`, `CliReviewHost` / Coordinator MUST NOT mutate worktree/Kernel state into an approved transition or launch an unobserved subprocess. It emits `review_preparation_failed` (`code: "review_transport_unavailable"`), leaves prior QA attestation intact, and surfaces one deterministic same-Host recovery step (`re-enter/run within Herdr`).
- **Retry / re-entry posture**: Once the user restarts in an admitted Herdr workspace and re-invokes `advance_assurance`, `prepareReview` / `prepareVerification` succeeds using existing QA attestation without forcing QA re-run.

---

## 4. Retirement Completion Contract

The following symbols, configuration values, and fallback paths MUST be completely retired by `S2`:

1. `"process"` default value in `LANE_DEFAULTS.review_transport` (`layered_config.ts:21`) -> replaced with `"herdr"`.
2. `"process"` option in `validateLane` (`layered_config.ts:124`) -> rejected cleanly alongside other invalid `review_transport` strings.
3. `writeProcessScript` and hidden background `--print` subprocess spawning fallback in `cli_review.ts:250-264` -> zero production callers or executable `"process"` transport branches remain in `cli_review.ts`.
4. `batch_state.ts` `"process"` transport fallback/default (`parseBatchReviewProfile`, `laneBatchReviewProfile`) -> retired in favor of `"herdr"`.
5. `recovery_action` text directing fallback to `lanes.review_transport: process` (`cli_review.ts`, `tests/cli-review-dispatch.test.ts:909`) -> replaced with one same-Host Herdr recovery action.
6. Stale `"process"` transport helper/fixture scaffolding in `tests/helpers/cli-reviewer.ts` -> retired or constrained cleanly to explicit Port simulation (`tests/layered-config.test.ts:338`, `tests/cli-review-dispatch.test.ts:903-938`, `tests/dual-host-assurance-conformance.test.ts`).

---

## 5. Agreed Seams & Exact File Scope (`15` paths)

1. `plugins/immune-brain/runtime/assurance/cli_review.ts` *(shared with `S1`)* — remove `writeProcessScript` and `"process"` fallback paths; enforce fail-closed `review_transport_unavailable` outside Herdr with one same-Host recovery action.
2. `plugins/immune-brain/runtime/config/layered_config.ts` *(shared with `S1`)* — set `LANE_DEFAULTS.review_transport = "herdr"`, retire `"process"` in `validateLane` (`layered_config.ts:21,124`).
3. `plugins/immune-brain/runtime/unattended/batch_state.ts` — align `parseBatchReviewProfile`, `reviewProfileFromArgs`, `laneBatchReviewProfile` (`batch_state.ts:27-52,1138-1165`) with mandatory `"herdr"` transport.
4. `plugins/immune-brain/dist/drive.md` *(shared with `S1`)* — remove residual `"process"` fallback instructions and align outside-Herdr `review_transport_unavailable` recovery prose.
5. `plugins/immune-brain/dist/drive-batch.md` — remove legacy `"process"` fallback instructions and require `herdr` explicit Port review dispatch in unattended batches.
6. `docs/reference/immune-brain-config.md` — document `lanes.review_transport` as `"herdr"` only (default `"herdr"`).
7. `plugins/immune-brain/dist/docs/reference/immune-brain-config.md` — byte-identical packaged mirror (`scripts/dist-sync-manifest.ts:32`).
8. `docs/reference/supervised-session-port.md` — document mandatory fail-closed explicit Port session requirement for Authority Review & Verification.
9. `plugins/immune-brain/dist/docs/reference/supervised-session-port.md` — byte-identical packaged mirror (`scripts/dist-sync-manifest.ts:43`).
10. `docs/adr/0037-authority-review-cli-stage.md` — add retirement/amendment note superseding hidden headless `--print` `process` execution with explicit Port session (`herdr`).
11. `docs/adr/0039-verification-cli-stage.md` — add retirement/amendment note superseding hidden headless `process` execution with explicit Port session (`herdr`).
12. `tests/cli-review-dispatch.test.ts` *(shared with `S1`)* — update `review_transport_unavailable` assertions (including `:908-909` no longer pointing to `lanes.review_transport` `"process"` fallback), prove fail-closed outside Herdr preserves QA attestation, and prove retired `"process"` mode is rejected.
13. `tests/layered-config.test.ts` — update `:338` default assertion to `"herdr"` and assert `validateLane` rejects `"process"` (`:343`).
14. `tests/dual-host-assurance-conformance.test.ts` — verify dual-host conformance under fail-closed `herdr` admission while preserving QA attestation outside Herdr.
15. `tests/helpers/cli-reviewer.ts` — retire obsolete `"process"` script helper pathways cleanly so test helpers match explicit Port semantics.

---

## 6. User Scenarios (`BR-SCN-2`)

| ID | Actor | Given | When | Then | Mode | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| `BR-SCN-2` | Loop Parent outside Herdr (or with legacy `review_transport: "process"`) | A task with valid QA attestation reaches Authority Review or CLI Verification outside Herdr (no admitted `herdr` provider) | `advance_assurance` prepares the Review or Verification stage (or config validator checks `review_transport: "process"`) | Kernel/Runtime fails closed with `state: "review_preparation_failed"`, `code: "review_transport_unavailable"`, retains QA attestation intact, gives one same-Host Herdr recovery action without falling back to `--print` `process`, and `validateLane` rejects `"process"` | `automated` | `AC1` |

---

## 7. Acceptance & Controls

- **AC1 (Global fail-closed `herdr` enforcement & QA preservation — `BR-DEC-1`, `BR-OUT-1`, `BR-SCN-2`)**:
  - Outside Herdr (no admitted `herdr` session provider), `advance_assurance` Review/Verification preparation fails closed with `state: "review_preparation_failed"`, `code: "review_transport_unavailable"`, preserves QA attestation, and returns one same-Host recovery action without launching any background subprocess (`writeProcessScript` retired) and without suggesting `lanes.review_transport: process`. Zero `runtime/assurance/` imports from `runtime/session/`.
- **AC2 (Config & batch profile retirement of `"process"` — `BR-DEC-1`, `BR-REQ-1`)**:
  - `LANE_DEFAULTS.review_transport` equals `"herdr"` (`layered_config.ts:21`), `validateLane` rejects `"process"` (`layered_config.ts:124`), and `batch_state.ts` (`parseBatchReviewProfile`, `laneBatchReviewProfile`) accepts/propagates only `"herdr"` cleanly.
- **AC3 (Reference, packaged dist mirrors, Loop docs, and ADR alignment — `BR-DEC-1`, `delegated technical choice`)**:
  - `docs/reference/immune-brain-config.md` & `docs/reference/supervised-session-port.md` match their `plugins/immune-brain/dist/docs/reference/*` mirrors byte-for-byte (`tests/dist-docs-sync-contract.test.ts`, `tests/skill-dist-consistency.test.ts:395-438`), `dist/drive.md` & `dist/drive-batch.md` remove `"process"` fallback prose, `docs/adr/0037*` & `0039*` record the explicit Port supersession note, and `docs/adr/0038-supervised-session-port.md` remains intact (`tests/loop-daemon-contracts.test.ts:48-50`).

### Done looks like
- Focused suite passes (`bun test tests/cli-review-dispatch.test.ts tests/layered-config.test.ts tests/dual-host-assurance-conformance.test.ts tests/dist-docs-sync-contract.test.ts tests/skill-dist-consistency.test.ts tests/loop-daemon-contracts.test.ts tests/supervised-session-boundary.test.ts`) plus `bun run typecheck`.
- Positive (`herdr` admitted default succeeds without config override), negative (`"process"` rejected by `validateLane`; outside Herdr fails closed with `review_transport_unavailable` & preserves QA attestation), and bound (zero remaining callers of retired `writeProcessScript` / hidden `--print` fallback) checks pass.

---

## 8. Devil's Advocate Audit

1. *Won't retiring `process` break CI/headless unit tests running outside Herdr?* Existing tests either simulate Herdr admission via explicit fake/provider test seams (`cli-review-dispatch.test.ts`, `dual-host-assurance-conformance.test.ts`, `helpers/cli-reviewer.ts`) or explicitly test fail-closed behavior (`review_transport_unavailable`) when outside Herdr. Updating those test suites in `S2` keeps test coverage authentic without weakening production guarantees (`BR-DEC-1`).
2. *Could failing Review preparation wipe out passing QA so users have to re-run QA after opening Herdr?* Explicit invariant: `review_preparation_failed` returns without revoking valid QA attestation (`reviewPreparationFailed` path in `coordinator.ts:2169-2179`).
3. *Does modifying `docs/reference/*` break packaged sync tests?* Only if `plugins/immune-brain/dist/docs/reference/*` mirrors are omitted. Both mirror files are explicitly included in `S2`'s 15-path scope (`scripts/dist-sync-manifest.ts:32,43`).

**False-compromise check**: No false compromise detected — `"process"` fallback and `writeProcessScript` are completely retired rather than hidden behind an opt-in escape hatch, strictly fulfilling `Q1=B` (`BR-DEC-1`).

---

## 9. Brainstorm Trace

| Item | Ownership | Notes |
| --- | --- | --- |
| `BR-REQ-1` | S1 + **S2** | `S2` locks default/config/batch propagation to `"herdr"` across runtime & docs. |
| `BR-REQ-2` | S1 | Already implemented in `S1` prior to `S2`. |
| `BR-REQ-3` | S3 (`mcp-completion-delivery-workspace-typing`) | Out of `S2` scope (`F2`). |
| `BR-REQ-4` | S4 (`revisit-synthetic-input-filter`) | Out of `S2` scope (`F3`). |
| `BR-DEC-1` | **S2** | Primary deliverable: global fail-closed mandatory Port session (`review_transport_unavailable`), retiring `"process"`. |
| `BR-DEC-2` | S1 | Already implemented in `S1`. |
| `BR-DEC-3` | S1 | Already implemented in `S1`. |
| `BR-DEC-4` | S3 | Composition-root `options.cwd ?? process.cwd()` preserved in `S3`. |
| `BR-DEC-5` | S4 | Preserved `synthetic: true` events in `S4`. |
| `BR-OUT-1` | S1 + **S2** | Enforced via `tests/supervised-session-boundary.test.ts`. |
| `BR-OUT-2` | Excluded | `herdr-core` dialog admission (`#495`) & sign-in dialog detection (`#496`) excluded. |
| `BR-DEFER-1` | Deferred | Full `HostRuntime.this.cwd` / `serveStdio` `callChain` (`mcp_runtime.ts:897-901`) deferred. |
| `BR-Q-1` | Resolved (`none`) | No open questions. |
| `BR-SCN-1` | S1 (`AC1, AC2`) | Covered in `S1`. |
| `BR-SCN-2` | **S2** (`AC1`) | Automated fail-closed outside Herdr + retired `"process"` scenario covered in `S2`. |
| `BR-SCN-3` | S4 (`AC1, AC2`) | Covered in `S4`. |

---

## 10. Completeness and Remaining Gap

- **Covered in S2**: Complete retirement of `"process"` default, validation, `writeProcessScript` fallback, unattended batch defaults, reference/ADR/Loop docs, packaged mirrors, and conformance/unit tests.
- **No remaining runtime gap** in Review/Verification transport after `S2` lands alongside `S1`.

## 11. Rollback

- Revert `S2` commits cleanly in Git (note rollback restores `"process"` fallback while retaining `S1`'s explicit Port capabilities).
