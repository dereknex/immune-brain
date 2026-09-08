# Existing Initiative Amendment

Status: approved prerequisite repair; standalone TaskIntent, not a Child of the
blocked Loop Initiative. No tracker publication prerequisite applies to this
repair. User approved implementation; remote publication of the Loop plan remains
a separate post-repair planning action.

**Design risk**: High. This changes an external-write boundary across local
TaskIntent validation, remote ownership, dependency updates, and final observation.
**Design views**: interfaces, data flow, and temporal sequence. No new Kernel
state, host authority, storage layer, or scheduler is introduced.
**Diagram decision**: not_required
**Diagram reason**: one existing publication pipeline with explicit preflight and
post-write verification is adequately described below.

## Outcome and Boundary

Extend the existing complete `publish-initiative` operation with explicit,
caller-supplied amendment inputs. Support updating an existing open Parent and
its approved pending Children, adding pending Children, preserving all historical
Children and native Sub-issue links, and returning execution order for pending
work only. No change to standalone create/upsert default mismatch rejection.
No implementation of the Loop batch product design, no new Skill, no Kernel or
Enrollment changes, no automatic reopening, detachment, history rewrite, or
publication to GitHub during this repair's tests.

## Technical Design

The caller supplies the complete pending frontier plus explicit read-only
historical Child identities. Bind every existing affected Issue, including the
Parent and historical Children, to expected remote identity and content hashes
(title/body/state), so a changed remote brief is not silently treated as consent.
The complete membership must match the observed native topology, except newly
requested pending Children not yet attached. Use existing marker validation,
TaskIntent hash binding, projection sanitization, body limits, and paginated
transport helpers. Reject duplicate identities, omitted existing pending work,
foreign or ambiguous ownership, closed pending Children, unrecognized historical
identities, cycles, and dependencies outside the full Initiative before writes.

Historical Children are not regenerated from current TaskIntent prose. Preserve
their exact title, body, state, terminal suffixes, and dependency relations; they
never appear as new runnable work. Pending dependencies may reference completed
historical prerequisites, but stopped/not-completed prerequisites cannot be
silently treated as satisfied. Parent prose must still identify every historical
Slice exactly once so terminal ownership validation remains valid.

For amendments only, update approved pending briefs and converge the exact
approved dependency set. Revalidate Parent/Slice and native Sub-issue ownership
before dependency removal as well as addition. Never detach a Child or mutate
historical dependency edges. Update only title/body on open pending Issues;
Kernel remains the sole owner of terminal evidence and settlement.

Sequence: validate local input and bindings; snapshot and validate all existing
identities, content, ownership and topology; revalidate before each affected
write; perform bounded updates and existing creation/attachment; re-read all
local hashes and remote content/relations; publish an execution result only on
exact convergence. GitHub offers no atomic multi-Issue transaction: report partial
or ambiguous results honestly, do not roll back over concurrent user edits.
Support retry after partial writes by accepting only explicitly bound original
content or exact requested final content for the same identities; do not accept
arbitrary current content. Preserve existing lost-response handling and status
vocabulary. Document the residual remote read/write race rather than claim CAS.

No compatibility bridge is needed: omitted amendment input retains today's
strict publication semantics. The optional input is a supported operation,
not a temporary bypass. Rollback removes the new optional path; existing remote
Issues remain valid tracker Issues and require no storage migration.

## Reference Closure and Verification

- `plugins/immune-brain/runtime/github_issue_tracker.ts`: publication input,
  CLI dispatch, marker ownership, snapshots, dependency mutation and verification.
- `plugins/immune-brain/runtime/v4_runtime.ts`: existing CLI caller; current
  dispatch forwards to the tracker, so no new command is required.
- `tests/plugin-package-runtime.test.ts`: existing FakeGh exercises public
  publication functions and CLI; extend it to model editing titles, dependency
  removal, historical preservation, retries and concurrent drift.
- `docs/agents/issue-tracker.md`: documented user-approved projection and
  publication protocol; document the explicit amendment contract and hashes.
- `plugins/immune-brain/dist/imm-planner.md`: canonical packaged Planner carrier
  handoff; clarify complete pending plus historical amendment input without
  changing Planner product behavior. No generated mirror exists for this file.
- `tests/carrier-enrollment-gate-contract.test.ts` and
  `tests/skill-dist-consistency.test.ts`: preserve fail-closed carrier handoff
  and packaged contracts. `bun run typecheck` covers exported caller types.

Execution posture: extend existing public fake-transport regression tests before
implementation. Use no real network fixtures. Include default strict rejection,
approved amendment and idempotent repeat, historical byte preservation, exact
pending dependency replacement, foreign/omitted/duplicate ownership rejection,
pre-write drift, partial failure/resume, final drift with no execution output,
and public acceptance validation. Run focused tests, typecheck, then Kernel QA
and snapshot-bound Review before claiming completion.

## Devil's Advocate Audit

Rollback resilience: no local authority or remote history is migrated; partial
remote writes are identified and safely reconciled only against approved inputs.
Verification vanity: public API/CLI tests assert concrete mutations, remote bytes,
relations, and missing execution output on failure, not just success messages.
Spec dilution: preserve both legacy fail-closed behavior and all historical
Children; a helper that only edits text or ignores topology does not satisfy
this repair. The approved Loop six-slice plan is unchanged and stays paused.
