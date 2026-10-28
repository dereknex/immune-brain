# Isolated Slice prerequisites from the published plan

**Status**: Candidate; no execution authority.
**Task ID**: `isolated-prereq-published-plan`
**Design risk**: Medium — one Enrollment precondition in one module changes the source of its input set; no persisted state, interface, or batch path changes, but the function is an authority guard shared by both Hosts' Enrollment.
**Design views**: data flow (prerequisite-set source → parse → validate → settlement proof).
**Document language**: English, following Planner's default document policy.

## Outcome

On the GitHub carrier, `assertIsolatedTaskPrerequisites` takes an isolated Slice's prerequisite set from the Parent Issue's published `## Slices` line for that Slice, not from native `blocked_by` relations. Adding or removing a native edge no longer changes which prerequisites Enrollment verifies; each prerequisite is still proven by `observeParentCompletion`. The Local carrier and the batch plan projection are unchanged.

## Sources

- **#285** — Problem, "What correct looks like", Acceptance (https://github.com/dereknex/immune-brain/issues/285).
- **Brainstorm manifest** (clarify, 2026-10-28) — `BR-REQ-1..3`, `BR-DEC-1..2`, `BR-OUT-1..2`, `BR-DEFER-1`, `BR-SCN-1..2`.
- Repository evidence:
  - `plugins/immune-brain/runtime/github_issue_tracker.ts:904-910` — the GitHub branch reads `child.blocked_by` from `observeGithubInitiative`, which reads native edges (`:948`); `:907` returns with no check when the set is empty.
  - `plugins/immune-brain/runtime/github_issue_tracker.ts:881-889` — the Local branch reads `Blocked by:` lines from the carrier file (`runtime/local_initiative.ts:47`).
  - `plugins/immune-brain/runtime/github_issue_tracker.ts:1196` — `createInitiativeBody` renders each Slice as `- [ ] <!-- immune-brain:slice-id=<S> --> **<S>**: <result> (blocked by: <task-id>, …)`; present since the first publication commit `0ead322`. Historical Slice lines are carried verbatim on amendment (`:1394-1420`).
  - `plugins/immune-brain/runtime/unattended/batch_plan.ts:72` — the batch projection also uses `observeGithubInitiative` (edges), so the issue's statement that batch reads the Parent Slice list is inaccurate; recorded as `BR-DEFER-1`.
  - Callers: `runtime/claude/kernel_ports.ts`, `.pi-extension/imm-canary-enroll.ts` (signature unchanged).

## Threat model and supported environment

Input is GitHub Issue state in the user's own repository: the Parent body and native relations, editable by any repository writer. The adversary is an accidental or expedient edit (a removed edge, a hand-edited Slice line), not a hostile writer — a writer can edit the Parent plan itself, and the Parent is the plan authority by #285. Supported: Parent bodies rendered by `createInitiativeBody`, including amended Parents with historical Slice lines; GitHub REST via `gh`. A Parent rewritten into a different Slice-list format is out of scope beyond failing closed.

## Decisions and technical design

### D1 — Prerequisite source on GitHub (source: BR-REQ-1, BR-DEC-1)

After resolving the Task's Initiative and Slice as today, read the Parent Issue body (already present in the repository snapshot used for `taskLookup`; no new remote call is required) and select the single line carrying `<!-- immune-brain:slice-id=<slice_id> -->`. The prerequisite set is the comma-separated Task IDs of that line's trailing `(blocked by: …)` annotation; a line with no annotation declares none. Native `blocked_by` relations are not consulted for this set: an edge absent from the Parent adds nothing, and a missing edge removes nothing.

### D2 — Fail closed on an unreadable plan (source: BR-DEC-2; prior art `github_issue_tracker.ts:875-877`)

Enrollment refuses, naming the Slice, when:

- the Parent body carries zero or more than one marker line for the Slice;
- the annotation is present but empty or contains an invalid Task ID (`identifier` rules);
- the annotation names the Task itself, a duplicate, or a Task ID outside the Initiative's Sub-issue topology.

### D3 — Settlement proof unchanged (source: BR-REQ-2)

The selected set goes to `observeParentCompletion` exactly as today, with the same refusal message `Isolated Slice prerequisites are not integrated: <ids>; …`.

### D4 — Batch projection and observation output unchanged (source: BR-OUT-1)

`observeGithubInitiative`'s returned `blocked_by` stays edge-derived, and `batch_plan.ts` is not edited. The new read is private to the isolated-entry path.

### D5 — Local carrier unchanged (source: BR-OUT-2)

The Local branch already reads its published plan; it is not edited.

### D6 — Release (source: delegated; runtime change inlined in `dist/claude/mcp-server.mjs` per `docs/agents/derived-files.json`)

Regenerate the Claude bundle and add a `patch` changeset.

## User scenarios

- **BR-SCN-1** — Actor: Operator enrolling an isolated GitHub Slice. Given: the Parent Slice line declares `(blocked by: T-a)`, T-a is not content-settled, and the native edge to T-a has been removed. When: the Operator starts Enrollment for the dependent Slice. Then: Enrollment refuses with a message naming `T-a` as not integrated. `automated` → AC1.
- **BR-SCN-2** — Actor: Operator enrolling an isolated GitHub Slice. Given: the same Parent declaration, T-a is content-settled, and the edge has been removed. When: the Operator starts Enrollment. Then: Enrollment proceeds without a prerequisite refusal. `automated` → AC1.

## Verification and acceptance mapping

Seam: `assertIsolatedTaskPrerequisites(root, taskId, transport)` with a scripted `GhTransport` (prior art: `ObservationGh` in `tests/unattended-batch-plan.test.ts:90-130`) over the content-settlement Git fixture `tests/fixtures/settled-delivery.ts` (prior art: `tests/goal-driven-batch-run.test.ts:288-345`). This is the function both Hosts call before the native gate, so a regression to edge-derived sets fails the edge-removed cases directly.

| AC | Seam | Controls |
|---|---|---|
| AC1 GitHub source | `tests/goal-driven-batch-run.test.ts` | Positive: annotation T-a, edge removed, T-a settled → resolves. Negative: annotation T-a, edge removed, T-a unsettled → rejects naming T-a. Bound: edge present and matching annotation → settled resolves and unsettled rejects with today's message; an edge to T-a with no annotation → resolves without consulting T-a (D1). |
| AC2 fail closed | `tests/goal-driven-batch-run.test.ts` | Negative: Slice marker absent; marker duplicated; `(blocked by: )` empty; annotation naming a Task outside the Initiative; annotation naming the Task itself. Each rejects naming the Slice. |
| AC3 Local unchanged | `tests/goal-driven-batch-run.test.ts` existing Local cases (`:100-120`) | Unedited assertions still pass: unsettled `Blocked by:` rejects, unrelated/malformed files do not block, malformed naming file rejects. |
| AC4 batch untouched | `git diff --quiet HEAD -- plugins/immune-brain/runtime/unattended/batch_plan.ts` + `tests/unattended-batch-plan.test.ts` | Negative: any edit to `batch_plan.ts`; batch plan from edges (`:127-128`) still projects `final` blocked by `base`. |
| AC5 packaging | `bun scripts/build-claude-plugin.ts --check`; changeset file | Negative: stale bundle; missing or non-patch changeset. |

`bun run typecheck` and the full `bun test` remain the Executor's regression run, not acceptance.

## Reference closure and scope

Runtime: `plugins/immune-brain/runtime/github_issue_tracker.ts`. Generated: `plugins/immune-brain/dist/claude/mcp-server.mjs`. Tests: `tests/goal-driven-batch-run.test.ts`, optionally `tests/fixtures/settled-delivery.ts` if the fixture needs a GitHub-carrier variant. Release: `.changeset/isolated-prereq-published-plan.md`. Callers `runtime/claude/kernel_ports.ts` and `.pi-extension/imm-canary-enroll.ts` keep the same signature and need no edit; `tests/pi-canary-assurance-progression.test.ts:488` pins that call text. No documentation names the isolated prerequisite source (grep over `dist/*.md`, `skills/`, `docs/agents/`, `CONTEXT.md`, `docs/adr/`), so none changes.

## Devil's Advocate Audit

- **Rollback resilience**: one function and its tests; no persisted state or schema. Reverting the commit restores edge-derived sets. A partial change that still reads edges fails AC1's edge-removed unsettled case.
- **Verification vanity**: AC1 removes the edge in every core case, so a test passing against today's code would be a defect; the "edge without annotation" bound proves edges are not merely unioned. AC2 enumerates concrete malformed Parents instead of a blanket clause. AC4 guards batch by diff plus its existing behaviour test.
- **Spec dilution**: every #285 acceptance bullet and every `BR-*` item maps below; the known divergence with batch is recorded as deferred, not dropped.

## Brainstorm Trace

| Item | Mapping |
|---|---|
| BR-REQ-1 | D1, AC1 |
| BR-REQ-2 | D3, AC1 |
| BR-REQ-3 | AC1 (GitHub four cases), AC3 (Local) |
| BR-DEC-1 | D1, AC1 bound |
| BR-DEC-2 | D2, AC2 |
| BR-OUT-1 | D4, AC4 |
| BR-OUT-2 | D5, AC3 |
| BR-DEFER-1 | Deferred: GitHub batch projection still edge-derived; follow-up Issue to be opened by the user if wanted. |
| BR-SCN-1, BR-SCN-2 | AC1 |

## Handoff completeness

Single Slice. Result when landed: on GitHub, removing a native edge no longer bypasses Enrollment's prerequisite check; Local and batch behave as before. Remaining gap: `BR-DEFER-1` only.
