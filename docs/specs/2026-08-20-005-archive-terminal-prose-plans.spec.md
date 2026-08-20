# Spec: Archive Terminal Prose Plans (2026-08-20-005)

**Owner**: user
**Status**: Proposed
**Design risk**: Low — move-only archival of 29 prose Plans plus a single guard extension; no runtime behavior, API, persisted state, or cross-module contract changes.
**Diagram decision**: not_required
**Diagram reason**: No state machine, data flow, or concurrency is introduced. The work is 29 `git mv` operations, one test file extension, and two read-only link scripts executed in preview mode.

## 1. Goal

Archive the 29 prose Plans still sitting in `docs/plans/` into `docs/plans/archive/`, completing the unfinished half of `2026-08-20-003`. After archival `docs/plans/` holds only the four canary fixtures (`canary-001..004.intent.json`) and the active Kernel intent sidecars; every archived prose Plan is a byte-preserving move, never a delete.

This slice deliberately does not archive specs. The 206 active specs require a two-signal terminality rule (filename match + citation) that this slice does not own; that rule is `2026-08-20-006`.

## 2. Evidence

- `docs/plans/*.md` currently contains 29 files (27 `*-plan.md` + 2 `*.plan.md`: `2026-08-16-assurance-workflow-hardening.plan.md`, `architecture-deepening-wave-1.plan.md`, `discovery-navigation-layer.plan.md`).
- `docs/plans/archive/` already holds 244 archived Plans (verified `ls | wc -l`).
- 25 of the 29 carry no status marker, 1 says `active`, 2 say `pending` (per intent goal). Phase 1 deleted the legacy prose Plan execution path entirely — the State Ledger and v3 dispatcher are gone and the surviving `imm-plan` binary only validates. No prose Plan can transition again regardless of its stale marker — operative terminality.
- No test pins a real prose Plan path: every `docs/plans/*.md` reference under `tests/` is a synthetic fixture in a temp directory (verified by `grep -rn "docs/plans/" tests/`).
- Cross-document link risk is the real exposure; `scripts/fix-broken-links.ts` and `scripts/detect-stale-refs.ts` already exist and are the intended repair surface.

## 3. Non-Goals

- No spec archival (deferred to `2026-08-20-006`).
- No deletion of prose Plans — move only.
- No new archival guard file — extend `tests/planning-artifact-archival.test.ts` in place so one test owns the invariant for both intent sidecars and prose Plans.
- No change to retired-tool exemption list established by `2026-08-20-003`.
- No behavior change to `imm-plan`, `imm-kernel`, or runtime island modules.

## 4. Technical Design

Low-risk move; no separate component design required beyond the invariants below.

**Invariants**

- I1 Move preserves content: `git mv docs/plans/<name> docs/plans/archive/<name>` with no byte change (verified by `git diff --stat` showing `R` renames).
- I2 No prose Plan remains in `docs/plans/` after archival: `docs/plans/*.md` and `docs/plans/*.plan.md` are empty of prose Plans (canary `.intent.json` excluded).
- I3 Guard is single-owned: `tests/planning-artifact-archival.test.ts` asserts both the intent sidecar invariant (existing) and the new prose Plan invariant; a prose Plan reintroduced into `docs/plans/` fails the guard.
- I4 Links remain intact: `scripts/detect-stale-refs.ts docs` and `scripts/fix-broken-links.ts --preview docs` report no new unresolved reference introduced by the move.

**Failure behavior**

- Partial move (e.g., 15 of 29) fails the guard on next run; `git status` shows split between `docs/plans/` and `archive/` and is re-entrant via remaining `git mv` calls.
- No persisted state beyond Git index; no rollback of runtime claims needed.

## 5. Acceptance

Maps 1:1 to TaskIntent `2026-08-20-005-archive-terminal-prose-plans`:

- **acc-prose-plans-archived** — `docs/plans/` contains no prose Plan; all 29 live under `docs/plans/archive/` as moves.
- **acc-archival-guard-extended** — `tests/planning-artifact-archival.test.ts` asserts the prose Plan invariant.
- **acc-links-and-suite-intact** — full suite passes; link scripts report no new broken reference.

## 6. Verification

- `bun test tests/planning-artifact-archival.test.ts` (60s, 65536) — covers acc-prose-plans-archived + acc-archival-guard-extended
- `bun test` (180s, 65536) + `bun run scripts/detect-stale-refs.ts docs` + `bun run scripts/fix-broken-links.ts --preview docs` — covers acc-links-and-suite-intact

## 7. Alternatives Considered

- Delete instead of archive — rejected; roadmap requires preserved history for auditability.
- New second guard file — rejected; one test must own the invariant (intent scope_hint).
- Archive specs together — rejected; spec terminality needs two-signal rule not owned by this slice.
