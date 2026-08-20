# Spec: Enforce Task-Record Durability on the Repository (2026-08-20-017)

**Owner**: user
**Status**: Proposed
**Task**: `2026-08-20-017-enforce-task-record-durability-on-the-repository`
**Output Language**: English prose; preserve CLI commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: Medium — persisted audit-trail invariant (TaskRecord under `.imm/tasks/`) with repository-wide enumeration and a shrinking baseline contract; single-module test guard but failure hides as green CI.
**Diagram decision**: not_required
**Diagram reason**: Guard is a set-difference over two filesystem enumerations (archived sidecars vs TaskRecords); no state machine, data flow, or concurrency — prose and an example predicate are more precise than a diagram.

## 1. Problem

Slice 014 made TaskRecords trackable (removed the `.imm/tasks/` ignore, rewrote it to transient-only ignores) and shipped `archivalRequiresRecord`. The covering test `tests/task-record-durability.test.ts` only exercises that helper on synthetic inputs and at line 107 asserts `typeof archivalRequiresRecord === "function"`. Nothing points it at the repository.

Result: the repository is today in the state the guard claims to forbid and the test is green. Of 83 `docs/plans/archive/*.intent.json` sidecars, 29 have no surviving `.imm/tasks/<id>.json`. Pattern is exact: every serial-main-worktree task kept its record (005, 006, 010, 014), every parallel-worktree task lost it (007–009, 011–013, 015, 016). 014 made survival possible without making it required. Same defect class as the stale-reference detector before 013: working detector, never pointed at reality.

## 2. Goal

Point the durability check at the repository:

- Enumerate the repository's archived intent sidecars.
- Resolve each to its TaskRecord and fail when one outside an admitted baseline lacks a record.

The 29 existing gaps are unrecoverable (worktrees gone). Admit them as a committed, explicit named list, not a count — a bare count lets a newly lost record hide behind a newly recovered one. Baseline may only shrink.

## 3. Evidence

- `docs/plans/archive/*.intent.json` = 83 files (verified 2026-08-20: `find docs/plans/archive -name "*.intent.json" | wc -l`).
- `.imm/tasks/*.json` (excluding `*.backend-claim.json` and dotfiles) = 55 distinct task ids (same date).
- `archives - tasks` = 29 missing, listed in §4.
- `tests/task-record-durability.test.ts` today: synthetic fixture `2026-08-20-014-track-task-records-for-audit-continuity-missing-probe` + `typeof` check; no `readdirSync(docs/plans/archive)` or real-repo assertion.
- Stale-reference precedent (`scripts/stale-reference-baseline.json`, `scripts/detect-stale-refs.ts`, `tests/stale-reference-ratchet.test.ts`) proves ratchet+explicit-exclusions pattern blocks new rot without mass cleanup.

## 4. Technical Design

**Scope**: `tests/task-record-durability.test.ts` (guard), `tests/task-record-durability-baseline.json` (new baseline). No runtime, kernel, or `.gitignore` change — 014 already tracks `.imm/tasks/` correctly.

**Baseline file** `tests/task-record-durability-baseline.json`:

```json
{
  "baseline": ["2026-08-13-017-v4-only-storage-retirement", "... 29 ids"],
  "scope": "docs/plans/archive/*.intent.json",
  "generated": "2026-08-20",
  "note": "Unrecoverable pre-017 gaps; may only shrink. A new missing id outside this list must fail the guard."
}
```

Requirements:
- Must be an explicit array of task ids, not a numeric threshold (acceptance `acc-baseline-is-an-explicit-list`).
- Committed and Git-tracked.
- Length = 29 initially; shrinking is allowed, growing beyond it is not.

**Guard logic** in `tests/task-record-durability.test.ts`:

1. Load baseline JSON, assert `Array.isArray(baseline)` and `baseline.length === 29` (initially) or at least that every entry is a string matching `/^\d{4}-\d{2}-\d{2}-/` — enforces list-not-count.
2. Enumerate archived sidecars: `readdirSync(join(REPO_ROOT, "docs/plans/archive"))` filtered to `*.intent.json`, map to `taskId = filename.replace(/\.intent\.json$/, "")`. Exclude no fixtures — archive contains only real tasks.
3. For each `taskId`, check `existsSync(join(REPO_ROOT, ".imm/tasks", `${taskId}.json`))`. Existence is the durable prerequisite; a missing file can never be tracked. Contract/content validation is not required for the ratchet (014's helper does it for synthetic unit tests), but the repo guard must at least assert existence so worktree loss is caught at archival visibility.
4. Collect `missing = archived.filter(id => !exists(id))`.
5. Compute `unexpectedMissing = missing.filter(id => !baseline.includes(id))` and `unexpectedExtra?` (baseline entries that are now present are tolerated — they indicate shrink opportunity, not failure).
6. Assert `unexpectedMissing.length === 0` with a message listing the ids. This is the branch that failed before: 014's test used `archivalRequiresRecord("...missing-probe")` synthetic-only; the new test uses the real `missing` set.
7. Retain the original `isIgnored` and `archivalRequiresRecord` synthetic checks (or minimal subset) only as unit coverage for the helper itself, but gate the suite on the repository enumeration — so the same `bun test tests/task-record-durability.test.ts` satisfies both `acc-guard-reads-repository` and `acc-baseline-is-an-explicit-list`.

**Failure behavior**:

- New parallel-worktree loss → new `taskId` in `unexpectedMissing` → test fails with `TaskRecord missing for archived task: <id>`.
- Baseline count drift (someone edits baseline to a number) → `Array.isArray` assertion fails.
- Archiving a terminal sidecar without committing its TaskRecord → same failure on next CI run.
- Restoring a previously missing record (shrink) → `missing` no longer contains that id but baseline still lists it → not a failure; baseline can be trimmed in a follow-up commit.
- No filesystem change → test passes at current 29.

**Verification implications**:

- `bun test tests/task-record-durability.test.ts` becomes the focused descriptor for both acceptances (as declared in TaskIntent).
- Full suite `bun test` remains third acceptance.
- Descriptor budgets stay within isolated-copy ceilings (focused file, 120s/65536B).

**Non-goals**:

- No backfill of the 29 missing records (worktree data gone).
- No change to archival timing or committing intermediate TaskRecord phases.
- No migration of `journal.jsonl`, `workspace.json`, or `migrations/` tracking.

## 5. Acceptance

Maps 1:1 to TaskIntent:

- **acc-guard-reads-repository** — Guard enumerates `docs/plans/archive/*.intent.json` and fails when one outside baseline lacks `.imm/tasks/<id>.json`, not synthetic input only. Verified by `bun test tests/task-record-durability.test.ts`.
- **acc-baseline-is-an-explicit-list** — Baseline is a named list of 29 ids, not a threshold, so new loss cannot be masked by unrelated recovery. Verified by same focused test (array assertion + `unexpectedMissing` check).
- **acc-suite-intact** — Full suite passes. Verified by `bun test` (600s/262144).

## 6. Verification

- `bun test tests/task-record-durability.test.ts` — covers both durability acceptances; asserts repository enumeration, baseline list shape, and zero `unexpectedMissing`.
- `bun test` — covers suite intact.
- Manual re-check: `ls docs/plans/archive/*.intent.json | wc -l` = 83, `ls .imm/tasks/*.json | wc -l` distinct, `git ls-files tests/task-record-durability-baseline.json` is tracked.

## 7. Alternatives Considered

- Bare count threshold (e.g. `missing.length <= 29`) — rejected; lets a new loss hide behind a recovered one, the exact failure mode this slice exists to end.
- Bare `bun test` full-suite gate only — rejected; count exceeds `max_output_bytes` and `output_exceeded` is non-waivable for enrollment per memory #1925.
- Store baseline under `scripts/` — viable but colocating with test (`tests/`) keeps Scope declaration tight and matches `scope_hint` without expanding it.
- Gate on `git ls-files` tracking instead of `existsSync` — rejected as primary gate; existence is prerequisite and works in isolated-copy rehearsal where Git index state may differ; tracking already enforced by 014's `.gitignore` fix and covered by `isIgnored` assertions.

## 8. Devil's Advocate Audit

**Rollback resilience.** Change is additive + test-only: rollback is `git revert` of 2 files (test + baseline). No schema, migration, or persisted state mutation. Baseline shrink is forward-only; growing it requires explicit commit.

**Verification vanity.** Risk: guard degenerates into `expect(typeof fn).toBe("function")`. Mitigated by requiring `readdirSync(docs/plans/archive)` enumeration, `baseline` array assertion, and `unexpectedMissing.length === 0` over real filesystem state. The synthetic helper check remains but does not satisfy the suite alone.

**Spec dilution.** No requirement narrowed. Goal's three invariants preserved verbatim: enumerate archived sidecars, fail outside baseline, baseline is named list that only shrinks. 29 is explicit, not hidden behind a count.
