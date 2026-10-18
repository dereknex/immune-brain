---
status: accepted
---

# Run-Entry Decision Hosting

Accepted on 2026-10-17 by the repository owner (decisions Q1–Q14 in
`docs/specs/run-entry-decision-hosting.spec.md`), for Initiative #264. It
amends [ADR 0005](0005-unattended-initiative-batch-run.md) §6,
[ADR 0019](0019-explicit-run-entry-owns-enrollment.md) (the gate on entry) and
[ADR 0024](0024-git-integration-preference.md), and replaces the `hooks.json`
invariant "Hooks never mint authority".

## Context

A literal-user `imm-run` entry already passes through a Host input event the
model cannot forge (`UserPromptSubmit` on Claude Code). The runtime then
opened a native gate for Enrollment, batch start and stale batch retirement,
and a failed gate required the user to type `imm-run` again. In the
session that motivated this ADR the implementation phase cost four typed
entries, four gates and one chat question for work the user had authorized
once. ADR 0019 guards against a model treating chat text as an instruction to
act; a typed slash command is not that case. What the extra gates protected
was the invariant that only a native gate creates authority.

The input event itself cannot be forged, but its durable proof can: the hook
records it in a same-uid private cache file, and the model's Bash tool can
write the same file. No channel the hook can use is closed to that Bash tool,
so no proof the hook writes is one the model cannot reproduce. A token
therefore must not be the only literal-user act behind starting execution.

## Decision

1. **The literal entry authorizes the run's internal steps.** When the Host input event sees
   a literal-user `imm-run`, it mints one entry token bound to the session id
   and the workspace realpath it was typed in. The token sits beside the
   session's phase-entry state in the private cache. No MCP tool or tool
   argument can mint or supply one; a tool argument named `entry_token` or
   `native_decision` is refused. A model that writes the cache file by hand
   can forge a token; Decision 2 limits what a forged token reaches.
2. **Starting execution keeps its native gate; the token covers the run's
   later steps.** `enroll` and `start_unattended_batch` still open one native
   gate per entry, so a forged token can never start work. Under a live token
   `retire_stale_batch` opens no dialog and records a `confirmation_ref` of
   kind `entry_token`, with the Kernel's plan-digest binding unchanged; the
   bounded retries and same-Host recovery of S4 use the same token instead of
   asking for a new typed entry. A forged token can at most retire a batch the
   plan already moved past, which preserves every child state and commit;
   that residual is accepted. Push, PR creation, credential
   use and `approve_breaking_intent_revision` keep their own confirmation.
   Gates that collect a user choice rather than a yes/no — rework exits and
   Lane revision delegation, which the batch gate collects — stay.
3. **The token lives as long as the run, with no time limit.** It survives
   compaction and same-session continuation. `SessionEnd` drops it; a call
   from another workspace realpath, another session, or after the run paused
   at the Stop boundary is refused with `run_entry_required`; a terminal run
   revokes it. A new literal entry replaces it.
4. **A confirmed batch start returns a manifest** listing each child's task
   id, Slice, risk, scope and verification commands. The Loop prints it before
   working; it never blocks.
5. **"Authority comes only from a literal-user entry or a native gate"** replaces "Hooks never mint
   authority" in `hooks.json`. The hook writes the token only on the Host
   input event; the Kernel and MCP server still decide whether it admits.
6. **Later Slices of the same Initiative** extend this ADR: Pi mints the same
   token from its literal input event (S2); a valid critical child joins the
   batch instead of being excluded, amending ADR 0005 §6, and overlapping
   scopes order children implicitly (S3); the continuation hooks allow two
   bounded retries of a side-effect-free refusal per token, and a
   deterministic preflight fix is committed alone as the second exception to
   ADR 0024's `manual` mode, after batch commits (S4). S4 also lets a Claude
   Stop with no new progress yield the turn instead of pausing, so waiting on
   background work no longer forces a new typed entry, and ends the token on
   every pause and on an interrupted Pi turn, so a paused run is refused by the
   MCP server itself and not only by the continuation hook (Spec D12, D13).

### Deviations from the Spec

- **The token does not bind the entry arguments** (Spec D1 as first written).
  The user may name the same work by Issue number, URL, Parent slug or task
  id, so comparing the text would refuse legitimate runs. One active claim per
  workspace already bounds what a token can start.
- **Enrollment and batch start keep their native gate** (Spec D1/D2 as first
  written removed it). Review found the token forgeable by a same-uid model
  write, and the repository owner chose on 2026-10-17 to keep one gate for
  starting execution rather than narrow the threat model.
- **A retirement without a token still opens the native gate** (Spec D2 said
  refuse). Such an admission comes only from an entry recorded before this
  change, and the gate is still a literal-user act.

## Consequences

- One typed `imm-run` plus one native confirmation covers a whole run:
  Enrollment or batch start, later batch retirement and same-Host resume. A
  refused call no longer needs a second typed entry.
- The Enrollment and batch dialogs keep their content, decline and cancel
  behavior and tests; Lane revision delegation stays in the batch dialog.
