# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
  When the body contains `<!-- immune-brain:kind=task -->`, also call
  `gh api repos/{owner}/{repo}/issues/<number>` to read `parent_issue_url`, then
  fetch that Parent body and comments before planning or implementation. Verify
  that the Child and Parent carry the same single `initiative-id`, that the
  native relation points to that Parent, and that the Parent contains exactly
  one matching `slice-id`. Stop on missing, duplicate, or conflicting ownership;
  do not implement from the Child alone. Parent Problem, Result, Initiative
  design, Decisions, Testing strategy, and Out of scope are required context.
  TaskIntent remains the execution authority: reconcile a pre-Enrollment conflict
  in Planner, or use Intent revision after Enrollment. Material decisions from
  Parent comments must be folded into the Parent body rather than left as hidden
  comment-only requirements.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Initiative Parent closure

The Planner never closes a GitHub Initiative Parent. The tracker's terminal projection does: after `mark-terminal` closes a Child as completed, it reads the Parent and its Sub-issue list (Issue-scoped reads, no repository listing) and closes the Parent as completed exactly once when every Sub-issue carrying a Slice marker of that Initiative is closed as completed. An open, stopped, not-planned or parked Child keeps the Parent open and causes no Parent write; an already closed Parent and a rerun of the same `mark-terminal` write nothing. A failed Parent read or close is reported as tracker observation beside the Kernel result, never changes it, and is retried by the same `mark-terminal`.

In a lane-mode batch, a Child settled inside its Lane is not closed by that settlement: the Lane's delivery is not on the batch branch yet. The coordinator runs the same `mark-terminal` after it integrates that child's commit, records the confirmed close so it never repeats it, and retries a failed close on the next batch tick. A Child whose Lane is lost or parked is never integrated and stays open. Serial batches and single tasks close at settlement as before, and Parent closure keeps the rules above.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## Existing Initiative amendment (tracker contract)

`imm-tracker publish-initiative --stdin --json` accepts an optional `scenarios`
array on each Task. A scenario is public projection only and can never widen
TaskIntent scope or authority. Each entry has `id` (`BR-SCN-<n>` or `SCN-<n>`),
`actor`, `given`, `when`, `then`, and `mode`. An `automated` scenario names one or
more of that Task's canonical acceptance IDs and renders as a plain bullet; a
`manual` scenario requires `manual_reason`, may name no acceptance ID, and renders
as an unchecked task-list item. The Child shows `## User scenarios` after
`## Acceptance criteria`; the Parent derives one plain bullet per scenario after
`## Testing strategy`. Omitting it renders no section, and a publication where no
Task supplies scenarios is byte-identical to one published without the field. A
malformed scenario, a repeated id, or an acceptance ID the TaskIntent lacks
rejects the whole batch before any remote write. Each Child's ownership marker
block also carries one `<!-- immune-brain:scenarios=<percent-encoded JSON> -->`
per Task holding all of its scenarios verbatim. An amendment reads historical
scenarios only from that marker and never parses the visible section; a Child
without it is treated as having no scenarios, and its bytes are never rewritten.

`imm-tracker publish-initiative --stdin --json` also accepts an optional
`amendment` input for an already-published Initiative. The caller supplies the
approved pending frontier plus read-only historical Child identities, each bound
to the exact expected remote `issue_number`, `title`, `body`, and `state` at the
moment of approval:

```json
{
  "amendment": {
    "parent": { "issue_number": 1, "title": "...", "body": "...", "state": "open" },
    "tasks": [
      { "task_id": "slice-live", "binding": { "issue_number": 2, "title": "...", "body": "...", "state": "open" } },
      { "task_id": "slice-new" }
    ],
    "historical": [
      { "task_id": "slice-done", "binding": { "issue_number": 3, "title": "...", "body": "...", "state": "closed" } }
    ]
  }
}
```

Semantics:

- The amendment requires the open Parent and every bound pending Child to match
  the approved baseline title/body/state exactly before any write; remote drift
  returns `ambiguous_remote_state` with zero mutations. Retry after a partial
  write accepts only the original bound content or the exact requested final
  content. A bound or unbound pending Child left open with a validated terminal
  suffix (a failed terminal close) matches its suffix-free baseline/approved
  content; retrying the original batch converges the terminal-suffixed body
  instead of failing closed on its own partial write.
- Approved pending briefs are updated (title/body only, terminal suffixes
  preserved), new pending Children are created and attached, and pending
  `blocked_by` relations converge to the exact approved set (adds and removals,
  with ownership revalidated before each edge mutation). An unbound new Child
  is re-read immediately before creation: an Issue that appeared meanwhile is
  accepted only when it is the exact approved-final creation of this same batch
  (resumable creation, re-attached and dependency-converged like a bound
  Child); any divergent content fails closed without a duplicate create.
  Structured failure results (never thrown exceptions) cover binding
  constraint violations such as missing or duplicate historical Slice markers.
- Historical Children are never regenerated, detached, or edited: their exact
title, body, state, and dependency relations are preserved byte-for-byte, and
  the Parent keeps every historical Slice entry exactly once. Historical
  prerequisites must be closed; a stopped (not completed) prerequisite is
  rejected instead of silently treated as satisfied.
- Omitted existing pending work, duplicate identities, foreign or ambiguous
  ownership, and closed pending Children are rejected before writes. Without an
  `amendment` input the operation keeps its strict default: an existing Parent
  with different content is `permanent_failure` — the tracker never rewrites it.
- The batch result reports the pending execution order only (first unblocked
  Task, stable order, parallel groups); historical Children never appear as
  runnable work.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`. For an Immune-Brain Task Issue, complete
the Parent lookup and ownership checks from **Read an issue** before returning
the ticket context.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
