---
status: accepted
---

# Run-Only Entry Guards

Accepted on 2026-10-13 by the repository owner (user decision BR-1 and BR-2 in
`docs/specs/run-only-gates.spec.md`), for Issue #230. It supersedes two
decisions and leaves the rest of their ADRs standing:

- ADR 0020, the rule that a model Skill call for `imm-planner` or
  `imm-brainstorm` revokes the session's run entry (G4 and G5 of
  `docs/specs/planner-skill-self-entry.spec.md`). ADR 0020's other rule, that
  such a call is never denied, is unchanged.
- T3 and D7–D9 of `docs/specs/ceremony-trim-r647.spec.md`, the revision-owner
  guard that denied an in-scope file edit from a plan-entry session with
  `revision_owner_required`.

ADR 0019 is unchanged: Enrollment is still the first step of a literal-user
`imm-run` entry.

## Context

Both guards acted outside `imm-run`. The revocation meant that a
natural-language request to draft a Spec, answered by the model loading the
Planner, ended the run entry the user had typed, so the next Enrollment was
refused until the user entered `imm-run` again. The revision-owner guard
refused a file edit because of which Skill the session had entered last, in a
session that was not executing the task. The repository owner's decision is
that `imm-run` is the only phase that may refuse an action.

## Decision

1. **A model Planner or Brainstorm Skill call changes no entry state.** On
   Claude Code the phase-entry hook returns no decision for it and writes
   nothing to the phase-entry store, with or without an active claim. Pi never
   observed a model Skill read and is unchanged.
2. **The revision-owner guard is retired on both Hosts.** No file-edit tool
   call is denied because of the session's latest entry, and the reason code
   `revision_owner_required` no longer exists. The Lane guard, which denies an
   edit outside a batch Lane, is unchanged and keeps the file-edit PreToolUse
   matcher.
3. **`PhaseEntryState` carries `run_live` only.** `plan_latest` had one reader,
   the retired guard. The log line format `{ v: 1, entry }` is unchanged, so a
   log written before this change still reduces.
4. **A literal plan entry still revokes the run entry.** The user typing
   `/imm-planner` or `/imm-brainstorm` is a change of phase by the only party
   who can enter one. `enroll`, `start_unattended_batch` and the `imm-run`
   Skill still require a live literal run entry.

## Consequences

- A run entry now survives model-initiated re-planning. After it, the native
  Enrollment confirmation is the only gate before a newly planned task starts.
- Two sessions can edit the same in-scope file. Divergence is caught where it
  always was for Bash edits: by the Kernel's scope and delivery checks at
  Review, not at the edit.
- `runtime/assurance/revision_owner.ts` and its two test files are deleted
  because the behaviour is retired. The phase-entry Skill-gate tests and the
  dual-Host conformance test now assert the opposite outcome.
