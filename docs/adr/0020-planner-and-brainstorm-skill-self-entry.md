---
status: accepted
---

# Planner and Brainstorm Skill Self-Entry

Accepted on 2026-10-12 by the repository owner, for the TaskIntent
`planner-skill-self-entry`. It partly supersedes ADR 0019: only the Skill-gate
scope changes. ADR 0019's decision, that Enrollment is the first step of a
literal-user `imm-run` entry, is unchanged, and ADR 0019 is not rewritten.

## Context

After ADR 0019 the Claude Code phase-entry hook denied a model Skill call for
`imm-planner`, `imm-brainstorm` and `imm-run` unless the user's latest prompt
entered that phase. A natural-language request for a Spec or Plan could not load
the Planner, and `imm-run` could not reload in a later turn of a live run. The
user's request to plan is not the risk ADR 0019 closed; the risk is a bare
"confirm" being read as the start of implementation.

## Decision

On Claude Code, `imm-run` is the only phase Skill the literal user must enter.

- The phase-entry hook never denies a model Skill call for `imm-planner` or
  `imm-brainstorm`.
- Such a call made while no Managed claim is active revokes the session's run
  entry, with no same-prompt exception. With an active claim (an Enrolled
  Intent Revision) the run entry stays live. The revocation is the ordinary
  `{ v: 1, entry: "plan" }` log line a literal Planner entry writes. When the
  line cannot be appended the session log is dropped and the call still goes
  through, so the run entry ends absent.
- A model Skill call for `imm-run` is allowed whenever the session's run entry
  is live, not only in the prompt that recorded it.
- The `imm-planner` and `imm-brainstorm` Skill descriptions become
  request-triggered, with a narrow trigger: a request for a Spec, Plan,
  TaskIntent or requirement clarification. `imm-run` and the five standalone
  Skills keep "explicitly requests".
- `enroll`, `start_unattended_batch` and the native dialog are unchanged and
  still need a live run entry.

## Consequences

- Planning something new always needs a fresh `imm-run` entry before
  Enrollment, because a model-entered Planner ends the run entry. An
  interrupted Skill call still leaves the entry revoked, which errs toward one
  extra `imm-run` entry and never toward an unrequested Enrollment.
- An installed Claude plugin cache keeps the old, stricter gate until it is
  refreshed, so a stale cache fails closed.

## Accepted gap: Pi

Pi cannot observe a model reading a Skill file, so it has no hook at the model
Skill call. Only a literal Planner or Brainstorm entry revokes the run entry
there, as before. A model-entered Planner on Pi after an earlier `imm-run` entry
leaves the run entry live. This gap is accepted and recorded here; it is not
counted as delivered.

## Rejected

- Keep the gate and relax it to "plan entry anywhere in the session": still
  blocks the natural-language request that should work.
- No revocation on a model-entered Planner: after one `imm-run` entry a
  model-planned task could be enrolled on a bare "confirm".
- A same-prompt exception to the revocation: restores "plan and execute in one
  request".
- A dedicated revoke record: an older enabled plugin copy would read the whole
  log as unreadable.
- Request-triggered descriptions for all eight Skills: the standalone Skills
  delete or rewrite project content.
