# Planning Artifact Retention

Plans and Specs are durable workflow evidence. Their paths may be referenced by
current documentation, tests, packaged material, release records, or support
investigations. Lifecycle is governed by signal-based terminality, not by age or
completion status alone.

## Terminality Signals

An artifact is terminal when a deterministic signal proves it has no live consumer
and no normative role. Only terminal artifacts are archived. Archival is a
`git mv` move never a delete, with byte-preserving `R` rename.

### Specs

A spec under `docs/specs/<name>.spec.md` is terminal when either signal holds
over the full `docs/plans/archive/` corpus (349 archived Plans as of this slice):

- **S1 filename**: normalized spec name (strip `.spec.md`, strip `.spec`) is a
  substring of a normalized archived plan name (strip `-plan` / `.plan` and
  `.md`). Example: spec `2026-08-05-risk-tiered-workflow-execution` is contained
  in plan `2026-08-05-001-refactor-risk-tiered-workflow-execution`.
- **S2 citation**: plan text contains the literal path `docs/specs/<name>.spec.md`.

`terminal(spec) := S1(spec) ∨ S2(spec)` — the union is the authority.
Neither signal alone suffices (filename-only 113 vs citation-only 117 of 206 in
the original measurement; union 148–150). Whatever the union leaves undetermined
`U = activeSpecs \ union(S1,S2)` is enumerated explicitly and stays in
`docs/specs/`; archival never guesses for `U`.

### Plans and TaskIntent Sidecars

- **TaskIntent sidecars** under `docs/plans/<task-id>.intent.json` are terminal
  when `.imm/tasks/<task-id>.json` is `done`/`stopped`, or when no record exists
  but an implementing commit touches a non-planning `scope_hint` path (commits
  touching only `docs/plans/`, `docs/reference/v4-roadmap-taskintent-drafts.md`,
  or `tests/planning-artifact-archival.test.ts` do not count).
- **Prose Plans** (`docs/plans/*.md` / `*.plan.md`) are historical; all 29 were
  archived by `2026-08-20-005` and `docs/plans/*.md` is now empty (canary
  `.intent.json` fixtures excluded). No active prose Plan remains.

## Invariants Preserved

- **I1 Move never delete**: `git mv docs/plans/<name> docs/plans/archive/<name>`
  or `git mv docs/specs/<name>.spec.md docs/specs/archive/<name>.spec.md` with
  no byte change.
- **I2 Link rewrite**: inbound `docs/specs/<name>.spec.md` citations in archived
  Plans are rewritten to `docs/specs/archive/<name>.spec.md` rather than left
  dangling, except where frozen by an external signature (see Exemptions). Stale
  link checks (`scripts/detect-stale-refs.ts`) must report no new unresolved
  reference beyond the pre-existing baseline for the declared scope.
- **I3 Enumerated undetermined**: every `U` member is listed explicitly and left
  in place; `U` is not archived by heuristic.
- **I4 Historical preservation**: put reusable conclusions in `docs/solutions/`;
  do not treat a solution summary as permission to remove its source evidence.

## Named Exemptions

At most two active specs plus one frozen plan reference are exempt from S1/S2
even though the signals would otherwise mark them terminal. Each carries a live
justification; a later bulk archival must not undo them.

An exemption is only as good as its stated reason. The v4 deletion roadmap was
listed here while its program was in flight; when that program closed the
justification expired, and the spec was archived rather than left protected by
text that no longer described it.

- `docs/specs/automatic-subagent-activation.spec.md` — pinned by live planning artifacts: `scripts/dist-sync-manifest.ts`, `tests/code-review-activation-contract.test.ts`, and packaged copy `plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md`.
- `docs/specs/opencode-native-plugin.spec.md` — dual-path pinned; `tests/python-reference-boundary.test.ts` resolves it at either `docs/specs/` or `docs/specs/archive/`.
- `docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md` — frozen plan: its `docs/specs/opencode-native-plugin.spec.md` reference is exempt from archive-path rewriting because it is part of `REFERENCE_SIGNATURE = "e89bf7809875d215c2ca0275c8f6e86e024dd451934fdc04d8e4a422bbd03a6c"` in `tests/plan-validation.test.ts`; rewriting it changes the cross-runtime signature.

Non-terminal artifacts remain durable at their existing paths by default.

## Authority-Owned Lifecycle

An enrolled TaskIntent and the one exact active Spec bound by its `scope_hint`
remain under `docs/plans/` and `docs/specs/` while the task is `working`. Before
QA, the Kernel freezes both artifacts through one recoverable transaction: bytes
move to their `archive/` paths and `TaskRecord.intent_ref.path` changes to the
archived sidecar. Every later Kernel action rereads that recorded path.

Authorized Review rework restores both artifacts before returning to `working`.
Completion is valid only from the frozen location. Stop freezes an active pair
before terminal settlement, so both terminal outcomes leave no active planning
artifact. A relocation conflict or crash fails closed and converges only through
the transaction marker; no background scanner or second status writer may infer
or repair lifecycle state.

Terminal cleanup outside that lifecycle remains a bounded TaskIntent with an
explicit candidate list and a copy-paste verification command. It may accompany
runtime lifecycle work only when both share one declared authority boundary and
the TaskIntent enumerates every moved artifact. Git history is rollback support,
not a replacement for preserving links that remain part of the current
repository.
