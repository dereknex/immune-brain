# Tracker Direct Publication

## Status, ownership, and outcome

This is the shared candidate Spec for Initiative `tracker-direct-publication`, a two-Slice plan. The user approved the write-flow decision ("mirror the `to-tickets` write flow, keep marker deduplication") and the two-Slice decomposition. Approval covers local candidate authoring/staging. It does not authorize implementation, Enrollment, Git commits/pushes, or deployment. Each Child requires its own native Enrollment before execution. Persisted documents use English; user-facing interaction remains Chinese.

Outcome: `imm-tracker publish-initiative` publishes an approved Initiative with the same remote write shape as the `to-spec` / `to-tickets` skills — one create per Issue in dependency order, native relations attached from the create response, no read-after-write — while keeping one start-of-run marker lookup so that a rerun never creates a duplicate Issue. Publication no longer fails on its own fixed whole-operation budget.

Carrier: one GitHub Parent with two native Sub-issues (repository default `Initiative carrier default: github`). Execution is serial S1 -> S2.

**Design risk**: High. The change reverses a published tracker contract (readback confirmation and whole-operation deadline) that is mirrored in packaged Planner prose and the generated Claude bundle. It does not touch Kernel authority, Enrollment, TaskRecord, or any persisted schema: tracker output is observation only.

**Design views**: temporal sequence (the ordered remote calls are the whole change) and service interface (the tracker result contract and its failure classes). Architecture layers, data flow and state transitions are omitted: module ownership, Issue body/marker format and the Kernel state machine are unchanged.

**Diagram decision**: not_required

**Diagram reason**: the design is one linear call sequence, fully expressed by the numbered list under Technical design.

**Execution posture**: test-first. The fake-transport call-sequence tests are written or rewritten before the runtime change, because the call sequence is the acceptance.

## Evidence and discovery closure

Reference flow, read from the installed `to-spec` and `to-tickets` skills: the model runs one `gh issue create` per Issue in dependency order, takes the Issue number from the create result, attaches the native Sub-issue and `blocked_by` relations with that number, never rereads the repository, and has no whole-run deadline. It has no retry deduplication and no amendment path.

Current flow, read from `plugins/immune-brain/runtime/github_issue_tracker.ts`:

- `runGithubInitiativePublication` takes one full repository `snapshot()` at start, then calls `runGithubTrackerOperation` for the Parent and once per Child. Each of those calls takes its own full snapshot, and `upsertTask` takes further snapshots after its create/edit and again before returning, plus `confirmAttachment`, `confirmBlockedBy` and `confirmTerminalOwnership` reads. Publication ends with another full snapshot and a per-Child ownership/dependency recheck.
- `snapshot()` spawns three `gh` processes and downloads every Issue and pull request with full bodies. Measured once against `dereknex/immune-brain` on 2026-10-04: about 3.4 seconds and about 857 KB for 134 items, of which about 43 were pull requests.
- The whole publication shares `PUBLICATION_BUDGET_MS = 120_000`; each `gh` call is additionally capped by `GH_TIMEOUT_MS = 20_000` and `MAX_GH_OUTPUT` (8 MiB).
- Estimate by code path, not measured end to end: a fresh six-Child publication issues roughly 140-150 `gh` calls including about 21 full snapshots, which exceeds the 120 second budget. Cost grows with both Child count and repository size.
- Observed on 2026-10-04 while publishing this Initiative (Parent #136, Children #137 and #138): all three Issue creates landed, but each was reported as `retryable_failure` / "could not be confirmed" because the full listing taken immediately after the create did not yet contain the new Issue. Publication needed four runs of the same manifest, with a manual read between runs. The fourth run, which created nothing and only attached one Sub-issue and one `blocked_by`, took 47 seconds for two Children. The read-after-create is therefore a direct cause of failure, not only a cost.
- GitHub's primary rate limit was not the cause (5000/5000 remaining when checked). The failure text the user actually saw was not recorded; the budget exhaustion and host timeout explanations are inferred from code.

Consumers and mirrors:

- `runGithubTrackerCli` (called from `plugins/immune-brain/runtime/v4_runtime.ts`) is the only caller of `runGithubInitiativePublication`.
- `runGithubTrackerOperation` is also called with `op: "mark-terminal"` from `plugins/immune-brain/runtime/claude/kernel_ports.ts` and `plugins/immune-brain/.pi-extension/runtime-stub.ts`. That path and `observeGithubInitiative` are out of scope and must keep their current reads.
- `plugins/immune-brain/dist/imm-planner.md` (Initiative Carrier Preference) states that the tracker "rereads the complete topology"; it is the canonical Planner contract and must be updated with the behavior.
- `plugins/immune-brain/dist/claude/mcp-server.mjs` inlines the runtime; rebuild with `bun scripts/build-claude-plugin.ts`.
- Behavior tests: `tests/github-initiative-recovery.test.ts` and `tests/github-issue-projection-contract.test.ts`. Package/contract tests that reference the publication path or its prose: `tests/plugin-package-runtime.test.ts`, `tests/carrier-enrollment-gate-contract.test.ts`, `tests/skill-dist-consistency.test.ts`, `tests/claude-host-package.test.ts`.
- `docs/specs/workflow-decision-closure.spec.md` (S5) required topology readback and a whole-publication deadline. It is bound to completed work by content identity and is not edited; this Spec supersedes those two requirements for future behavior.

## Brainstorm Trace

| ID | Approved requirement/decision | Coverage |
| --- | --- | --- |
| BR-REQ-1 | Refactor publication to follow the `to-spec` / `to-tickets` write flow | S1, S2 |
| BR-REQ-2 | Publication must stop failing on timeouts and self-imposed limits | S1, S2 |
| BR-DEC-1 | Mirror the write flow but keep marker deduplication; a rerun creates no duplicate Issue | S1 |
| BR-DEC-2 | Remove every post-write full-repository reread, the closing topology recheck and the 120 second whole-operation budget | S1, S2 |
| BR-DEC-3 | Keep the amendment path, converted to the same no-readback flow | S2 |
| BR-DEC-4 | Two Slices: ordinary publication, then amendment | Slice decomposition |
| BR-DEC-5 | The earlier idea of scaling the budget with Child count is withdrawn; there is no whole-operation budget | S1 |
| BR-OUT-1 | Issue body and marker format, `mark-terminal`, `observeGithubInitiative`, Kernel authority and Enrollment are unchanged | All Slices |
| BR-OUT-2 | Retiring the runtime in favor of model-run `gh` commands, and dropping deduplication or amendment, were considered and rejected | Not planned |

## Technical design

### Common invariants

- Local preflight is unchanged and still runs before any remote call: canonical TaskIntent reread, dependency graph validation, title composition and length, body limit, carrier conflict.
- Tracker output remains observation, never authority. Planner outcome names (`tracker_associated`, `tracker_projection_failed`, `awaiting_user_initiative_confirmation`) and the tracker result contract identifier are unchanged.
- One publication call is a finite step sequence with no internal retry. The first failed or timed-out remote call ends the run. Each call keeps the 20 second cap and the cancellation signal; no cumulative deadline exists.
- The number of repository-wide reads in one publication is a constant that does not depend on the number of Children.

### S1: ordinary publication

1. Read once at start: repository identity, the Issue listing, and the label listing. The Issue listing must not download pull requests or fields that marker matching and drift checks do not use.
2. From that single listing, resolve the Parent and every Child by ownership markers. Existing fail-closed checks stay and run here, before any write: duplicate or ambiguous markers, intent-hash mismatch, title/body drift on an already published Issue, missing required labels.
3. Create the Parent if absent, taking number and id from the create response.
4. For each Child in dependency order: if absent, create it once with its final labels and take number and id from the create response; then attach it as a native Sub-issue of the Parent; then create one `blocked_by` relation per blocker, using ids already known from the listing or from earlier create responses.
5. A Child that already existed at start is adopted, not recreated. Its missing relations are found with targeted reads scoped to that Issue or to the Parent's Sub-issue list, never with a repository listing; only missing relations are written.
6. Return the result built from create responses and the start listing. No snapshot, attachment confirmation, dependency confirmation or ownership confirmation follows a write, and no closing topology pass runs.

Failure behavior: a call that fails or times out after the request may have landed is reported as uncertain, with confirmed steps, pending steps and exactly one recovery action — rerun the same approved batch. The rerun's start listing adopts whatever landed. Concurrent edits by another writer during the run are no longer detected; they surface as drift at the start of the next run.

Expected cost for a fresh publication of N Children with D dependency edges: the start reads plus `1 + 2N + D` writes. For six Children in a chain this is about 25 calls instead of roughly 140-150 (estimate).

### S2: amendment

The amendment input, its approval binding and its failure classes are unchanged. Baseline verification of every bound Issue runs once, against the start listing plus targeted relation reads for bound Issues, before any write. Pending briefs are updated with one edit each, new pending Children are created as in S1, and the approved `blocked_by` set is converged using a targeted read of that Child's current blockers. Historical Children are never written. The post-edit snapshots, the per-Child revalidation snapshot before each write and the closing recheck are removed. Baseline drift that appears after the start listing is not detected in the same run.

### Retired tests and replacement coverage

- "a spent whole-publication budget refuses the next remote write": behavior retired with the budget; the per-call timeout and cancellation tests remain.
- "an identity change on the final readback is not reported as success": the final readback is retired; identity mismatch remains covered by the start-of-run check.
- "an unconfirmed readback is uncertain and the replay adopts the landed write": rewritten around a lost create response instead of a failed readback.

S2 retires the amendment tests that asserted a reread after a write. Each one drove
a mutation through a `gh.run` wrapper and expected the tracker to notice it inside
the same run; that is now the start of the next run's job, so the tests are replaced
by start-of-run equivalents:

- "preserves a terminal suffix that lands between the snapshot and the content-write revalidation" (round-9 review-1): a suffix observed at start is preserved by the single rewrite; a suffix landing after the start listing is not seen this run.
- "fails closed before dependency writes when a duplicate Task Issue appears before the pre-write revalidation" (round-9 review-2), "fails closed when an unbound new Child is created closed" (round-5 R2), "resumes an exact concurrent unbound Child creation injected between task snapshot and pre-create re-read" (round-17 review-1b) and "fails closed when the Parent drifts after the task snapshot but before the pre-create re-read" (round-17 review-1a): all inject between the start listing and a write. Repository-wide ambiguity and closed/unapproved membership observed at start still fail closed with zero writes; an injection after the start listing is not re-read this run.
- "fails closed with zero mutations when the Parent is edited after its update and before the Child snapshot" (round-19 review-1) and "fails closed when Parent markers and approved bytes are transferred to a replacement Issue before revalidation" (round-19 review-1): the Parent is read once at start and edited at most once; there is no post-edit Parent read.
- "stops dependency mutations and fails closed when the pending Child drifts before a dependency write" and "fails closed with zero relation writes when the pending Child drifts right after the attachment write" (round-11 review-1): `blocked_by` convergence uses the start read and writes only the difference; it does not re-read the Child before each edge.
- "fails closed when a historical Child's blocked_by relations change during the amendment" and "fails closed when a terminal suffix is injected on the Parent before final verification" (round-21 review-1): no closing recheck runs, so a change that lands mid-run is caught at the start of the next run.
- "converges pending dependencies when the pending content already matches the approved final bytes": kept, with the direct flow's status rules (an unapproved edge present at start is converged, not rejected; unchanged content reports `already_current`).

## Slice decomposition, dependencies, and acceptance mapping

Both Children are `material`. Task IDs are `tracker-direct-publication-s1` and `tracker-direct-publication-s2`.

| Slice | Closable result | Blockers | Acceptance | Focused verification |
| --- | --- | --- | --- | --- |
| S1 | Ordinary publication uses the direct write flow with start-only deduplication and no whole-operation budget | None | TDP-S1-A1 (call sequence, adoption, failure reporting), TDP-S1-A2 (Planner contract and bundle agree with the behavior) | Recovery and projection tests; carrier-gate, dist-consistency and Claude package tests |
| S2 | Amendment uses the same flow with baseline checked once at start | S1 | TDP-S2-A1 | Recovery and projection tests, Claude package test |

Descriptors use `bun test` with explicit file arguments, `prepare` null and no writable paths, following the existing tracker descriptors. Tests use the fake `gh` transport already present in `tests/github-initiative-recovery.test.ts`; no test writes to a real repository.

## Devil's Advocate Audit

- Rollback resilience: the change is confined to one runtime module, its generated bundle, one prose contract and tests. No persisted state, marker or Issue body format changes, so Issues published by either version are readable by the other and a revert needs no migration. S2 can be reverted independently only if S1 stays; after S1 alone the amendment path keeps its old readback behavior behind the removed budget, which is slower but correct.
- Verification vanity: asserting only "publication succeeds" would pass with the old flow. Acceptance instead asserts the exact ordered call list from the fake transport, that no repository listing follows the first write, and that the read count is identical for two and six Children.
- Spec dilution: "follow `to-tickets`" must not shrink to "raise the budget" or "cache the snapshot". Every post-write reread named in the evidence section is removed, and the budget constant is deleted rather than enlarged.
- Lost safety: readback previously caught concurrent writers and half-landed writes within the run. This is accepted by the user's decision; the remaining protection is the start-of-run drift check on the next run, and the result must not claim confirmation it did not perform.
- Scope closure: `mark-terminal` shares `snapshot()` and the confirm helpers. Those helpers stay for that path; S1 must not delete or weaken them, and the `mark-terminal` tests in the two behavior files must pass unchanged.

## Assumptions

A1: the create endpoint response carries both the Issue number and the id needed by the Sub-issue and dependency endpoints; if `gh issue create` cannot return them, the implementation uses `gh api`. A2: the installed `gh` and the repository support a pull-request-free Issue listing; if not, the listing may still include pull requests but must stay a single start-of-run read. A3: call-count figures are estimates from code reading and one timed snapshot, not an end-to-end measurement.

## Planning completion and execution handoff

Author both candidates through `imm-kernel intent author <path> --stdin --json`, stage only this Spec and the two Intents, and require `valid: true` and `enrollment_ready: true`. After the user confirms the Initiative name, slug and decomposition, publish both Children with one `imm-tracker publish-initiative --stdin --json` call. Enrollment and execution need a later explicit trigger and the native gate.
