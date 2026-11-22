# Leader plus catalog replace the judging agent

Status: accepted; amends [ADR 0039](0039-loop-daemon.md) Decisions 2, 6 and 7,
and amends [ADR 0041](0041-simplified-configuration.md) Decisions 1, 3 and 7.
Numbered 0041 until Slice `S1` of `docs/specs/loop-leader-uls-alignment.spec.md`
renumbered it: [ADR 0041](0041-simplified-configuration.md) already held that number.
Slice `S3` of `docs/specs/loop-leader.spec.md` (`loop-leader-s3-guarded-dispatch`).

## Context

ADR 0039 gave the Loop daemon fixed agent kinds (Decision 2), a Tier-3
read-only judging session for anything the decision model could not answer
(Decision 6), and a judging re-check of model-skipped decisions at
reconciliation (Decision 7). Slices `S1` and `S2` added the project role
catalog and the resident leader, which journals proposals but executes
nothing. The judging session is now the only Tier-3 path, and every skip it
re-checks is a session the leader could propose a `next` for instead.

## Decision

1. **The judging agent is retired.** `judging_agent.ts` is deleted;
   `judging` leaves the session kinds, roles and limits. A Tier-2
   `needs_judging` outcome applies the D12 point baseline and carries
   `needs_judging: true`, so the record says a baseline decided.
2. **Reconcile becomes a briefing input.** `imm-loop reconcile` (and the
   scheduled pass) collects model-skipped decisions and `needs_judging`
   baselines since the last pass as reconcile candidates. It starts no
   session, dispatches nothing and writes no label. A leader `next` for such
   a target passes the same Tier-0 guards a judging override did.
3. **Fixed kinds become catalog roles.** Decision 2's five agent kinds are
   the catalog bases `leader | clarify | plan | execute | repair | analyze`;
   `execute` still requires Enrollment authority and `repair` still stays on
   the daemon's own branch. A retired `roles.judging` preset binding is
   ignored with one `deprecated_config_source` diagnostic and never makes
   the `agents` table `config_invalid`.
4. **Guarded dispatch executes proposals.** Each leader item runs only behind
   its code guard; a refusal journals its reason and changes nothing. An
   Initiative shape writes the Local carrier plus one Kernel-authored
   TaskIntent per slice; completion comes from session records, never from
   session text.
5. **Project-only role catalog and leader configuration (amends ADR 0041
   Decisions 1, 3 and 7).**
   - `loop.roles` is defined only in the project file (`.imm/config.json`); a
     user-file `loop.roles` key is rejected with an error diagnostic.
   - `loop.budget.max_leader_wakes_per_day` (integer 0–500, default 48; 0
     disables wakes) bounds daily leader sessions.
   - Loop `clarify`, `plan` and `repair` sessions resolve from `loop.roles`
     rather than `agents.planner` / `agents.executor`; legacy bindings on
     `agents.planner`, `agents.executor`, `agents.triage` and preset
     `roles.judging` stay parseable and emit `deprecated_config_source`
     warnings.
   - A rejected `loop.roles.*` entry is excluded from the catalog (falling back
     to the built-in default role when no other role covers that base) and
     emits an error diagnostic without turning `loop.valid` to `false`. Because
     the daemon keeps running, `imm-loop status` (both text and `--json`
     `role_catalog_diagnostics`) must surface `loop.roles` diagnostics
     explicitly alongside `imm-kernel config --json`.

## Consequences

- `max_leader_wakes_per_day: 0` disables the leader; the Tier-2 baseline
  keeps the loop running as it did without a judge.
- A preset that only bound `roles.judging` stays parseable; any other preset
  key is still `config_invalid`.
- `imm-loop status --json` lists running catalog sessions with `target`,
  `role`, `base` and `started_at`.
