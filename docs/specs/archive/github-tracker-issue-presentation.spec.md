# Spec: GitHub Tracker Issue Presentation

**Task ID**: `github-tracker-issue-presentation`
**Owner**: user
**Status**: Proposed
**Design risk**: Medium

The change re-titles, re-labels, and re-structures Immune-Brain-published
GitHub Issues. The tracker holds write authority over an external mutable
surface and existing binding-convergence semantics treat title/body drift as
`permanent_failure`; a defect could break publication mid-initiative, mislabel
blocked work as ready, or rewrite planning prose that the Parent declares
hand-editable.

## 1. Problem Frame

Initiative publication for `nexttylabs/welltold` (#37–#43) produced Issues
that are hard to read and disconnected from repository conventions:

- Titles embed the full multi-sentence goal/result text (Parent title ≈ 200
  characters) because `issueTitle` concatenates `[<owner>]` with raw
  `projection.result ?? goal` and only enforces GitHub's 256-character limit.
- No labels are ever set, while the repository maintains a live label
  vocabulary (`ready-for-agent`, `blocked`, `needs-spec`, …) that existing
  hand-written Issues use. Declared `Risk` and `blocked_by` never surface as
  observable metadata.
- Task bodies repeat the title twice (H1 plus `## What to build`) and ship
  three boilerplate stanzas (opt-in notice, Lifecycle, Authority boundary)
  per Issue.
- The Parent never links the originating feature Issue (#29) even though the
  initiative id and several Slices reference it, so the same work appears as
  two unrelated open Issues.
- Children are published in an order that does not match declared slice
  order, so the sub-issue list contradicts the execution order stated in the
  Parent.

## 2. Decisions

1. **Display names over prose**: Planner projection supplies a short display
   name per Initiative (`short_name`, `title`) and per Slice (`title`). Titles
   become `[<initiative-short-name>] <display-title>` for the Parent and
   `[<initiative-short-name>] S<n> <slice-display-title>` for Children, where
   `n` is the Slice position in the Parent's Slices checklist (checked
   historical lines included), falling back to the declared batch position
   only for a Slice the Parent does not list. Missing display
   name or a computed title over 80 characters fails closed before any remote
   mutation; titles are never silently truncated. Full result text stays in
   the body only. Because the fields are required at publication time, the
   packaged Planner contract (`plugins/immune-brain/dist/imm-planner.md`) is
   updated in the same change so published Initiatives keep working.
2. **Labels converge from declared state, fail closed on missing labels**:
   Children carry `ready-for-agent`; Children with non-empty `blocked_by`
   additionally carry `blocked`; the Parent carries no state labels. Label
   sets are re-applied idempotently on every convergence pass — creation,
   amendment, and a repeated complete batch — so manual drift is repaired
   without rewriting Issue content. A label absent from the remote repository
   fails the publication before any Issue is mutated and names the missing
   label; the tracker never creates labels.
3. **Body dedup, no information loss**: Task bodies drop the H1 duplicate
   and the `## What to build` section; the opt-in/Lifecycle/Authority
   boilerplate collapses into one short footer line. Parent sections
   (Problem, Result, Initiative design, Decisions, Testing strategy,
   Slices, Out of scope) are preserved verbatim.
4. **Provenance and order**: `projection.source_issue` on the Initiative
   renders a Provenance section (`Derived from #N`, autolinked by GitHub) when
   declared. Children are created in the plan's dependency order, which is
   what `execution.order` reports, so the sub-issue list matches execution
   order. Native `blocked_by` dependency edges already exist and are
   unchanged; labels add the observable blocked signal.
5. **No retro-rewrite**: Already-published Issues are not rewritten by this
   change. New format applies to new publications and to amendment passes
   that carry approved new content. Existing title/body drift keeps its
   current `permanent_failure` semantics.

## 3. Scope

- `plugins/immune-brain/runtime/github_issue_tracker.ts`: title construction,
  label convergence, body templates, provenance rendering, child ordering.
- `tests/github-issue-projection-contract.test.ts`: new focused contract test
  (title composition, label convergence/fail-closed, body dedup, ordering).
- `tests/plugin-package-runtime.test.ts`: regression coverage for unchanged
  binding convergence.

## 4. Out of Scope

- Rewriting or relabeling already-published Issues (e.g. welltold #37–#43).
- Auto-creating repository labels; changing the repository label vocabulary.
  A required label that is missing fails the batch closed before any write.
- Native GitHub blocked-by dependency edges (already implemented; unchanged).
- Planner-side display-name authoring beyond the packaged contract update in
  Decision 1: no new Planner stages, gates, or prompts beyond documenting the
  required projection fields.
- Any change to Kernel authority, binding identity checks, or the
  `permanent_failure` drift semantics.

## 5. Acceptance Mapping

- GTP-1 → title composition and 80-character fail-closed cap.
- GTP-2 → label convergence, idempotent repair, missing-label fail-closed.
- GTP-3 → body template dedup with Parent planning prose preserved.
- GTP-4 → Provenance section, slice-ordered creation, unchanged convergence
  semantics (regression via `tests/plugin-package-runtime.test.ts`).

## 6. References

- `docs/plans/github-tracker-issue-presentation.intent.json`
- `plugins/immune-brain/runtime/github_issue_tracker.ts` (`issueTitle`,
  Parent/Task body templates, publication convergence)
- Evidence: `nexttylabs/welltold` Issues #37–#43 versus #9–#16 conventions.
