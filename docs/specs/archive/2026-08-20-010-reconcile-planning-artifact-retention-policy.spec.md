# Spec: Reconcile Planning Artifact Retention Policy (2026-08-20-010)

**Owner**: user
**Status**: Proposed
**Task**: `2026-08-20-010-reconcile-planning-artifact-retention-policy`
**Output Language**: English prose; preserve CLI commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: Low — doc-only rewrite of two governance documents plus one focused consistency test; no runtime, API, persisted state, cross-module contract, or migration.
**Diagram decision**: not_required
**Diagram reason**: No state machine, data flow, or concurrency is introduced. Terminality is a set-union predicate over filenames and citation strings, governed by archival guard tests; prose and a table describe the rule more precisely than a diagram.

## 1. Problem

`docs/reference/planning-artifact-retention.md` still describes the pre-archival policy: "Keep files under `docs/plans/` and `docs/specs/` at their existing paths by default" (line 10), "Use `docs/archives/` for consolidated historical summaries, not as an automatic destination for completed Plans or Specs" (line 14), and a five-condition Move Or Delete Gate that must be proven per file (lines 16-24). The file is unchanged since the first commit and was in no slice's scope.

Slices `003/005/006/007` then bulk-moved 29 prose Plans and 154 specs on a deterministic two-signal rule, leaving:

- `docs/plans/*.md` empty; `docs/plans/` holds only the four canary fixtures (`canary-00[1-4].intent.json`) plus active Kernel intent sidecars,
- `docs/specs/` at 54 active against 236 archived (349 archived Plans).

`docs/adr/0002-maintenance-surface-ownership.md` Decision 1 still reads "Plans and Specs remain durable at their existing paths by default. Future moves or deletions follow `docs/reference/planning-artifact-retention.md`", carrying the contradicted policy as binding. The `Rejected Alternatives` bullet "Bulk archival of completed Plans and Specs: completion does not prove a path has no current consumer" also now contradicts practice.

This is the defect class Phase 0 existed to remove, recreated by the archival work itself. Two invariants the old policy got right and archival respected must be preserved: archival is a `git mv` move never a delete with byte-preserving `R` rename, and inbound references are rewritten rather than left dangling. The current `tests/planning-artifact-archival.test.ts` carries a 3-entry `protectedSpecs` set plus one frozen plan reference that must be named explicitly so a later reader does not undo them.

Only two other documents cite the retention policy (`docs/plans/archive/2026-07-21-001-refactor-maintenance-surface-simplification-plan.md` and `docs/reference/v4-roadmap-taskintent-drafts.md` §2.1b); neither is binding and neither is in scope per the intent.

## 2. Goal

Make retention guidance agree with the repository it governs, preserving the correct invariants and naming standing exemptions.

Either restate `planning-artifact-retention.md` around the signal-based rule actually in force, or supersede it through the ADR, and align the ADR either way so both documents describe one policy. This spec adopts the former (minimal churn, single governance source): rewrite the retention document to define terminality signals, move-only archival, link rewrite, and named exemptions; rewrite ADR 0002 Decision 1 into a governance pointer at the retention document and reconcile its Rejected Alternatives and Consequences with the adopted archival practice. Add a focused consistency test that prevents drift between the two documents and the disk layout.

## 3. Evidence

- `docs/reference/planning-artifact-retention.md` lines 10, 14, 16-24 vs `git ls-files docs/plans/archive | wc -l` = 349 and `ls docs/specs/archive | wc -l` = 236 (verified 2026-08-20). No prose Plan remains in `docs/plans/*.md`.
- `docs/adr/0002-maintenance-surface-ownership.md` Decision 1 and Rejected Alternatives bullet vs above layout.
- `docs/specs/2026-08-20-005-archive-terminal-prose-plans.spec.md` and `docs/specs/2026-08-20-006-archive-terminal-specs.spec.md` establish the two-signal authority:
  - **S1 filename**: normalized plan filename (strip `-plan` / `.plan`, strip `.spec` from spec) substring of normalized plan name.
  - **S2 citation**: plan text contains literal `docs/specs/<name>.spec.md` path.
  - Union `S1 ∨ S2` over the full `docs/plans/archive/` corpus is terminal; `U = active \ union` is undetermined and stays in place with explicit enumeration.
  - TaskIntent sidecar terminality: `.imm/tasks/<id>.json` phase `done`/`stopped` or implementing commit without record → archived (guard in `tests/planning-artifact-archival.test.ts`).
- `tests/planning-artifact-archival.test.ts` `protectedSpecs` (3 entries with per-file justification):
  - `docs/specs/v4-deletion-completion-and-contract-realignment-roadmap.spec.md` — live v4 roadmap referenced by `docs/reference/v4-roadmap-taskintent-drafts.md`, misclassified by filename/citation because a roadmap about deleting v3 necessarily discusses v3.
  - `docs/specs/automatic-subagent-activation.spec.md` — pinned by `scripts/dist-sync-manifest.ts`, `tests/code-review-activation-contract.test.ts`, and packaged copy `plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md`.
  - `docs/specs/opencode-native-plugin.spec.md` — dual-path pinned, resolved via `tests/python-reference-boundary.test.ts` at either `docs/specs/` or `docs/specs/archive/`.
- `tests/plan-validation.test.ts` `REFERENCE_SIGNATURE = "e89bf7809875d215c2ca0275c8f6e86e024dd451934fdc04d8e4a422bbd03a6c"` freezes the migration plan payload that includes its Spec reference; `docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md` is the one archived plan whose `docs/specs/opencode-native-plugin.spec.md` reference is exempt from rewriting to the archive path. Changing that reference changes the signature.
- `docs/reference/v4-roadmap-taskintent-drafts.md` §2.1b is planning memory (non-authority) noting the same contradiction; Intent explicitly scopes it out.

## 4. Technical Design

**Scope**: `docs/reference/planning-artifact-retention.md`, `docs/adr/0002-maintenance-surface-ownership.md`, `tests/retention-policy-consistency.test.ts` (new). No runtime, kernel, or package surface changes.

**Retention document rewrite** (`docs/reference/planning-artifact-retention.md`):

- Title and intro keep durable-evidence framing but state that lifecycle is governed by signal-based terminality, not default path durability.
- **Terminality** section defines:
  - Spec terminality: `terminal(spec) := S1(spec) ∨ S2(spec)` over full `docs/plans/archive/` corpus (S1/S2 definitions verbatim from §3). `U` stays in `docs/specs/` and is enumerated explicitly; archival never guesses for `U`.
  - Plan/Intent terminality: TaskIntent sidecar with `.imm/tasks/<id>.json` phase `done`/`stopped` → archived; pro se Plans: historical, zero remain active; pending intents without record but with implementing commit on a non-planning `scope_hint` path → archived (planning-only commits do not count).
  - Counts snapshot note: as of this slice, 349 archived Plans, 236 archived specs (informational, not normative).
- **Invariants** preserved from old policy and archival practice:
  - I1 Move-only: `git mv docs/plans/<name> docs/plans/archive/<name>` or `git mv docs/specs/<name>.spec.md docs/specs/archive/<name>.spec.md` with no byte change (`R` rename).
  - I2 Link rewrite: inbound `docs/specs/<name>.spec.md` citations in archived Plans are rewritten to `docs/specs/archive/<name>.spec.md` except where frozen by an external signature (see exemptions); stale-link check via `scripts/detect-stale-refs.ts` reports no new unresolved reference beyond pre-existing baseline for the declared scope.
  - I3 Enumerated undetermined: every `U` member is listed explicitly and left in place.
- **Named exemptions** section (at most 3 specs + 1 plan, each with live justification):
  - `docs/specs/v4-deletion-completion-and-contract-realignment-roadmap.spec.md` — live v4 program roadmap, referenced by `docs/reference/v4-roadmap-taskintent-drafts.md`; exempt from S1/S2.
  - `docs/specs/automatic-subagent-activation.spec.md` — pinned by live planning artifacts and packaged copy (see evidence).
  - `docs/specs/opencode-native-plugin.spec.md` — dual-path pinned (`tests/python-reference-boundary.test.ts` resolves either location).
  - `docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md` — frozen plan: its `docs/specs/opencode-native-plugin.spec.md` reference is exempt from archive-path rewriting because it is part of `REFERENCE_SIGNATURE` in `tests/plan-validation.test.ts`.
- **Scope discipline** retained: retention cleanup remains a bounded TaskIntent with explicit candidate list and copy-paste verification; bulk archival not combined with runtime/manifest/packaging/schema changes; Git history is rollback support, not replacement for preserving live links.

**ADR rewrite** (`docs/adr/0002-maintenance-surface-ownership.md`):

- Decision 1: replace durability-at-path claim with governance pointer: "Planning artifact lifecycle (archival vs active) is governed by `docs/reference/planning-artifact-retention.md`, which defines terminality signals, move-only archival, link rewrite, and named exemptions. Non-terminal artifacts remain durable at existing paths by default."
- Rejected Alternatives: rewrite "Bulk archival of completed Plans and Specs" bullet from rejected to adopted form: "Bulk archival on completion alone (without terminality signals) — rejected; current practice archives only when S1/S2 signals or sidecar terminality prove the artifact is terminal and no protected exemption applies."
- Consequences: append "Archival layout (349 Plans / 236 specs) is enforced by `tests/planning-artifact-archival.test.ts` and `tests/retention-policy-consistency.test.ts`; retention policy and ADR 0002 agree and jointly govern future moves."
- No other ADR decisions touched.

**Consistency test** (`tests/retention-policy-consistency.test.ts`):

- Reads both documents as text and asserts:
  - retention doc contains signal keywords (`S1`/`S2` or `filename.*substring` and `citation`, `union`, `undetermined`, `move` + `never delete`/`R rename`, `rewrite`/`rewritten`) and does not re-assert the old five-condition gate as the sole pre-move requirement, and lists each named exemption path.
  - ADR 0002 does not contain the old durability-only sentence "Plans and Specs remain durable at their existing paths by default" as its Decision 1, and contains a pointer to `planning-artifact-retention.md`.
  - Both documents agree (no contradictory "keep at existing paths by default" in active guidance that conflicts with archival layout).
  - Disk layout sanity (threshold checks to catch drift, not exact counts): `docs/plans/*.md` empty (excluding `.intent.json`), `docs/plans/archive/*.md` length ≥ 29, `docs/specs/archive/*.spec.md` length ≥ 184, active specs include the two spec exemptions at either location where applicable, migration plan exists at archive path.
- Descriptor: `bun test tests/retention-policy-consistency.test.ts` (60s/65k), `automated`. Full suite (`bun test`, 300s/262k) remains the third acceptance's descriptor.

**Failure behavior**:

- Partial rewrite (only one document updated) fails the consistency test (ADR still asserts old policy or retention doc missing signals).
- Omitting an exemption name fails the exemption assertion and risks a later bulk archival incorrectly moving the protected spec.
- Rewriting the frozen migration plan reference fails `tests/plan-validation.test.ts` signature check; test guards this.

**Non-goals**:

- No file moves, deletions, or new archive operations.
- No change to `docs/reference/v4-roadmap-taskintent-drafts.md` or the archived plan that cites retention (non-binding, per intent).
- No change to archival guard logic in `tests/planning-artifact-archival.test.ts` (it remains the enforcement authority; this test is a cross-document consistency check).
- No runtime, kernel, or package surface changes.

## 5. Acceptance

Maps 1:1 to TaskIntent `2026-08-20-010-reconcile-planning-artifact-retention-policy`:

- **acc-retention-policy-matches-practice** — No active retention guidance contradicts the archival layout, and ADR 0002 points at whatever policy now governs rather than asserting durability at existing paths. Verified by `bun test tests/retention-policy-consistency.test.ts`.
- **acc-exemptions-named** — The governing policy names the standing exemptions (live v4 roadmap spec, the three protected specs as currently guarded, and the signature-frozen migration plan) so a later reader does not archive or rewrite them. Verified by the same focused test.
- **acc-suite-intact** — The full suite passes. Verified by `bun test` (300s/262k) — no runtime change, but guards against incidental breakage.

## 6. Verification

- `bun test tests/retention-policy-consistency.test.ts` (60s per descriptor, max_output_bytes 65536) — covers `acc-retention-policy-matches-practice` + `acc-exemptions-named`.
- `bun test` (300s, max_output_bytes 262144) — covers `acc-suite-intact`.
- Manual re-check: `git grep -n "planning-artifact-retention" -- docs/` shows no active binding citation outside the two governed documents and the two non-binding notes already scoped out.

## 7. Alternatives Considered

- Supersede via new ADR deprecating `planning-artifact-retention.md` — rejected; retention doc is the focused governance artifact and ADR is the cross-surface ownership record; deprecating it adds indirection without removing a consumer.
- Keep old five-condition gate alongside signal rule — rejected; gate was never applied to the 29+154 bulk moves and now describes the opposite practice; keeping it as mandatory pre-move text recreates the contradiction.
- Single-document fix (only retention or only ADR) — rejected; Intent requires both documents to describe one policy; fixing one leaves the other contradicting.

## 8. Devil's Advocate Audit

**Rollback resilience.** Doc-only change: rollback is `git revert` of 3 files. No migration, no schema change, no staged data. Recovery path if a future archival needs different signals: edit retention doc and exemptions list, update consistency test thresholds; no runtime rollback needed.

**Verification vanity.** Risk: consistency test degenerates into "file contains substring X" while prose remains wrong. Mitigated by asserting both positive signals (S1/S2/union/move-only/link-rewrite) and negative absence of old durability-only claim in ADR Decision 1, plus disk layout sanity thresholds that fail if the documents claim a layout the filesystem does not have. The suite's existing archival guard (`planning-artifact-archival.test.ts`) remains the load-bearing enforcement of terminality; this test is cross-document agreement, not a duplicate archival oracle.

**Spec dilution.** No requirement narrowed. Signal definitions are copied verbatim from 005/006 evidence and the live guard; invariants (move never delete, rewrite rather than dangle) are preserved explicitly per Intent; exemptions are expanded to the full guarded set (3 specs + 1 plan) rather than the Intent's shorthand 2, preventing a later undo. Roadmap-driven archival is not collapsed into "later" labels.

