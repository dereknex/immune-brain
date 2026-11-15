---
status: accepted
---

# Interaction Protocol: One Request Shape, Two Channels, a Narrowed GitHub Boundary

**Status:** accepted. Records D3 of
[`docs/specs/loop-agent-scheduling.spec.md`](../specs/loop-agent-scheduling.spec.md)
(S3), from `BR-DEC-6`, `BR-DEC-8` and `BR-DEC-10`. It amends
[ADR 0039](0039-loop-daemon.md) Decision 12 ("People are called only for
judgement, and only on GitHub") and introduces the protocol `local` will
implement as its own channel (S4).

## Context

ADR 0039 Decision 12 calls a person on GitHub for every judgement: a
clarification, a `material`/`critical` approval, a breaking Intent revision, a
disputed review comment, an unrepaired failure, a merge, a new credential. Each
of those was implemented where it was needed — `decision_relay.ts` renders a
Lane decision question and verifies its reply, `events.ts` parses the
`/approve <digest>` marker, `escalation.ts` deduplicates an escalation comment
by marker key, and the Kernel's `tracker_approval` membrane decides whether an
approval counts.

That is four independent comment formats and four places that decide what a
reply may do. The daemon is now adding a second answer channel (a local Host
session, S4) and per-work-item pending interactions (S5), so "which channel may
apply which answer" has to become one decision instead of a per-format habit.

It also has to stay narrow. GitHub is a public comment stream the daemon polls
without a native gate; only the two literal-user decisions the Kernel and the
relay already verify as code may be applied from it. Everything else that needs
the literal user — a stop, a breaking Intent revision, an authorization, a
credential, a risk override — must remain a local act in the owner's own Host
session, because a comment cannot carry the proof that a native confirmation
carries.

## Decision

1. **One request shape.** `InteractionRequest`
   (`runtime/loop_daemon/interaction/protocol.ts`) carries a contract tag, an
   `interaction_id` idempotency key, a `kind`, the `subject` and `binding` it is
   asked against, the prompt and options, the answer form, and its authority.
   `kind` is one of `clarify_question`, `plan_approval`, `lane_decision`,
   `escalation`, `notice`. Authority follows from `kind`, not from the caller:
   `clarify_question` and `escalation` are advisory; `plan_approval`,
   `lane_decision` and `notice` are literal-user.
2. **One channel interface.** `InteractionChannel` is `accepts`, `post`,
   `poll`, `withdraw`, with `id` `github` or `local`. `accepts` answers the
   authority question — may this channel apply an answer — and is consulted
   before any answer is treated as one. `post` returns `posted`,
   `already_posted` or `notice_only`; `poll` returns `pending`, `answered`,
   `stale` or `withdrawn`; `withdraw` retires a request whose binding moved.
3. **The comment is the record.** The `github` channel writes one comment per
   `interaction_id` and reads the request back from that comment's marker line,
   so a restarted daemon needs no request store and a repost is
   `already_posted`. The marker carries the kind, the authority, the subject
   issue and the binding fields; it is an idempotency and binding record, never
   an authorization proof.
4. **`github.accepts` applies exactly two answers.** A `plan_approval` is
   answered by `/approve <plan_digest>`, checked by
   `verifyTrackerApproval()` — ADR 0039 Decision 9: allowlisted author, not the
   daemon identity, created after the plan was published, never edited, digest
   equal. A `lane_decision` is answered by the reply `decision_relay.ts` and
   `events.ts` already parse, checked by `verifyLaneDecisionReply()` — today's
   allowlist, `run_id` and `record_revision` checks. A `clarify_question` is
   accepted as an advisory answer. Every other literal-user operation is posted
   as `notice_only`: `localOnlyNotice()` names the local action, the comment
   says replies are not applied, and `poll` never reports an answer for it.
5. **A moved binding retires the request.** `poll` compares the binding the
   comment was posted with against the binding that holds now. When a
   `plan_digest`, `record_revision` or `issue_revision` moved, `poll` edits the
   comment to a withdrawn notice and reports `stale`; a later `poll` reports
   `withdrawn`. A reply naming a different digest or revision is ignored
   regardless, so a stale question can never collect an answer.
6. **The existing code stays the verifier.** `decision_relay.ts`, the
   `/approve` marker in `events.ts` and `escalation.ts` keep their markers and
   their checks; the channel renders a Lane question with
   `renderLaneDecisionQuestion()`, verifies both answer kinds with the
   functions those modules already own, and takes an escalation's identity from
   `escalationInteractionRequest()`, which reuses that module's stable
   `escalationKey`. Their pre-protocol markers stay readable, so a question or
   an escalation posted before this change is still read by the same code.

## Consequences

- "May this answer be applied?" is one predicate on one interface, so S4's
  `local` channel and S5's per-work-item pending interactions reuse it instead
  of restating the authority rules.
- GitHub answers narrow to `/approve <digest>`, a Lane decision reply and an
  advisory clarification. A stop, breaking Intent revision, authorization,
  credential or risk override is now visible on the Issue as a notice naming
  the local action, and an owner reply to it changes nothing; the owner has to
  act in their own Host session.
- The daemon posts one comment per request. A binding that moves mid-question
  costs one comment edit, not a second comment.
- The comment stream remains the only GitHub request store: losing
  `.imm/state/loop/` loses no interaction record, and no interaction state is
  authority (ADR 0039 Decision 4).
- Call sites are wired as the series lands: the channel selection and the local
  channel arrive with S4, pending interactions per work item with S5.

## Rejected

- **A per-format reply parser per call site.** The duplication is what made the
  GitHub boundary unauditable.
- **Applying any literal-user operation from a GitHub comment.** A comment
  carries no native confirmation, and ADR 0039 Decision 12 is narrowed to what
  code can verify.
- **A daemon-side request store as the posting record.** It would make an
  orchestration file a second record of what was asked, and a restarted daemon
  could not tell a posted request from a lost one.
- **Deleting the pre-protocol markers.** A question posted before this change
  must still be answerable, so the old markers stay readable.
