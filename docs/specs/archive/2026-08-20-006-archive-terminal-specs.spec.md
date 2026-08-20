# Spec: Archive Terminal Specs (2026-08-20-006)

**Owner**: user
**Status**: Proposed
**Design risk**: Medium — classification across 207 active specs via two-signal union against 273 archived Plans, plus cross-corpus link handling and a pinned-test reconciliation.
**Diagram decision**: not_required
**Diagram reason**: Terminality is a set-union predicate over filenames and citation strings, not a state machine or data flow; a table and file lists describe the rule more precisely than a diagram.

## 1. Goal

Archive the terminal spec corpus, the last unfinished part of the `2026-08-20-003` roadmap item. `docs/specs/` holds 207 active specs against 82 archived after `005` (was 206/82). A spec is terminal when an archived Plan under `docs/plans/archive/` implements it, established by either of two signals; the union is the authority, and whatever the union leaves undetermined must be enumerated explicitly and left in place.

This slice runs after `2026-08-20-005`. That slice's 29 prose Plan moves convert their spec linkages from active to archived and shrink the undetermined set (e.g., `2026-08-05-risk-tiered-workflow-execution` now resolves via the archived `2026-08-05-001-...-plan.md`).

Archival is `git mv docs/specs/<name>.spec.md docs/specs/archive/<name>.spec.md`, never a delete, content preserved.

## 2. Evidence

- Counts re-measured after `005` (2026-08-20): active `207`, archived `82`, archived Plans `273` (was 244). Prior measure (pre-`005`): filename match `113`, citation `117`, union `150/206`, `105/244` Plans cite a spec path.
- Signals:
  - **S1 filename**: normalized Plan filename (strip `-plan` / `.plan`, strip `.spec` from spec) is a substring of normalized Plan name (e.g., spec `2026-08-05-risk-tiered-workflow-execution` contained in plan `2026-08-05-001-refactor-risk-tiered-workflow-execution`).
  - **S2 citation**: plan text contains the literal `docs/specs/<name>.spec.md` path.
- Neither signal alone suffices (113 vs 117), union measured at 148/207 after `005` (vs 150/206 before), confirming the two-signal necessity.
- Only `132/273` archived Plans cite a spec path (was 105/244), so citation coverage remains partial.
- Exposures: `tests/python-reference-boundary.test.ts` pins `docs/specs/opencode-native-plugin.spec.md`; cross-document links across a 206-file corpus (`scripts/detect-stale-refs.ts` reports 727 broken_doc_link pre-existing).
- The instructional-reference exemption list (52 specs) established by `003` must not be touched; those specs document retirement and stay active and exempt.

## 3. Non-Goals

- No change to the 52-spec exemption list.
- No guessing for undetermined specs — enumerate, do not archive.
- No new archival guard file — extend `tests/planning-artifact-archival.test.ts` in place (owned by this slice alongside `005`'s prose guard).
- No behavior change to `imm-plan`, `imm-kernel`, or runtime island modules.
- No spec content edits beyond the move.

## 4. Technical Design

**Invariants**

- I1 Move preserves content: `git mv docs/specs/<terminal>.spec.md docs/specs/archive/<terminal>.spec.md` with no byte change (`R` rename).
- I2 Terminality predicate: `terminal(spec) := S1(spec) ∨ S2(spec)` over the full `docs/plans/archive/` corpus (273 Plans). S1 uses substring-normalized match as above; S2 uses literal `docs/specs/<name>.spec.md` citation.
- I3 Undetermined set: `U = activeSpecs \ union(S1,S2)`. Every `U` member is listed explicitly in the slice output (spec file appendix or commit message trailer) and stays in `docs/specs/`.
- I4 Exemption preservation: any spec on the 52-spec exemption list that would otherwise be terminal is retained in `docs/specs/` and not counted as violation; the exemption test must still pass.
- I5 Pinned test: `tests/python-reference-boundary.test.ts` must resolve `opencode-native-plugin.spec.md` at either `docs/specs/...` or `docs/specs/archive/...` (dual-path).

**Failure behavior**

- Partial move (e.g., 100 of 148) fails the archival test on next run; `git status` shows split and is re-entrant via remaining `git mv`.
- Enumerating less than `|U|` or archiving an `U` member fails the guard (archived count mismatch).
- Link breakage beyond pre-existing baseline is reported by `detect-stale-refs.ts` but does not block this slice's archival invariant; main corpus breakage remains pre-existing 727.

**Enumeration output**

- After archival, the slice records the explicit `U` list (e.g., `UNDETERMINED_SPECS.md` appendix or `git log --stat` trailer) so a future planner need not replay the two-signal scan.

## 5. Acceptance

Maps 1:1 to TaskIntent `2026-08-20-006-archive-terminal-specs`:

- **acc-terminal-specs-archived** — every `S1∨S2` spec lives under `docs/specs/archive/` as a move; `U` remains and is enumerated.
- **acc-pinned-and-exempt-intact** — pinned test dual-path passes; exemption list still passes.
- **acc-links-and-suite-intact** — full suite passes; link scripts report no new unresolved reference beyond pre-existing baseline.

## 6. Verification

- `bun test tests/planning-artifact-archival.test.ts` (60s/65k) — covers acc-terminal-specs-archived + acc-pinned-and-exempt-intact (terminal + undetermined + exempt invariants)
- `bun test` (300s/262144) + `bun run scripts/detect-stale-refs.ts docs/specs` + `bun run scripts/fix-broken-links.ts --preview docs` — covers acc-links-and-suite-intact

## 7. Alternatives Considered

- Single-signal archival (filename only or citation only) — rejected; each leaves ~30% of terminal set undetected per union measurement.
- Direct guess for `U` — rejected; two-signal-then-enumerate rule requires explicit leftover listing, mirroring sidecar archival.
- Separate spec for undetermined — rejected; single spec with explicit enumeration is the durable record.
