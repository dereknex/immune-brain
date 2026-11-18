# Simplified configuration

Status: accepted; supersedes [ADR 0034](0034-layered-configuration.md) and the
separate verifier model of ADR 0039 (#284 D1). Issue #564.

## Context

ADR 0034 left five places that could choose a Lane's model (request,
`projects.<key>`, project `lanes`, user presets, legacy files), two role tables
(`agents` and the legacy `lanes` mapping), eight agent roles, per-profile
transports and a `not_applied` rule for values that crossed layers. The Parent
re-implemented the resolution in prose and passed its own Host as
`executor_host`, so the runtime skipped role resolution and a Lane started
without `--model` (#564). Users want a different code agent and model per
project without editing a shared file.

## Decision

1. **Two files, one order.** The user file and a local, unversioned
   `.imm/config.json` read from the main checkout. Every key resolves request →
   project → user → default. `projects.<key>` is retired: per-repository
   choices live in that repository's project file. Nothing checks whether Git
   tracks the project file.
2. **Permission keys take the stricter value.** `git_integration` (`manual`
   wins), `loop.auto_enroll_max_risk` (lower risk wins), and
   `loop.allowed_actors` / `loop.allowed_associations` (intersection).
3. **Four roles.** `executor` (with repair), `reviewer` (with findings
   verification and advisory review), `planner` (clarify and plan) and
   `triage` (judging). A role value is a user profile name, shorthand
   `host[:model][@effort]` (effort only when the text after the last `@` is a
   known level), or an object. Roles merge one by one, each a whole profile
   from one layer. Profiles are defined only in the user file. Presets,
   `active`, `"*"`, per-profile `transport`, the separate verifier model and
   `not_applied` are removed.
4. **Explicit session-provider selection.** Top-level `session_providers` holds a
   non-empty ordered list of distinct registered provider names (`herdr`,
   `herdr-core`), default `["herdr"]`, with the project file replacing the user
   file. Inside Herdr, single-task Lane Executors run in interactive Herdr tabs;
   the former top-level `herdr` switch is retired: setting it warns
   (`retired_key`) and is ignored, and `imm-kernel config migrate --write`
   deletes it. Review always runs in
   Herdr; Loop roles always run as processes.
5. **The runtime is the only resolver.** `start_unattended_batch` takes
   `agents: { executor?, reviewer? }`, each replacing that role whole; the
   flat `executor_*` / `review_*` parameters are removed. The Parent passes
   the request verbatim. A new batch freezes the resolved executor and reviewer
   profiles and `batch.max_parallel`.
6. **Decision models.** Profiles stay in the user file; the project file may
   bind a point to a user profile by name. `bindings.<point>: "off"` replaces
   `enabled_points`. Egress resolves project over user per provider kind.
7. **One failure rule.** An invalid value counts as unset and stays an error
   diagnostic. A batch is refused while `agents`, `batch` or `session_providers`
   has an error, or a file is unreadable or has the wrong contract.
8. **Contract v2 and one migration.** Both files move to `v2`; a `v1` file is
   `config_invalid` with a pointer to `imm-kernel config migrate [--write]`.
   Every legacy reader is deleted: `lanes`, `.imm/lanes.local.json`,
   `.imm/decision-models.local.json`, `.imm/decision-bindings.json` and the
   `AGENTS.md`/`CLAUDE.md` preference lines. The migration reads them once and
   writes nothing without `--write`.

The details are in the
[configuration reference](../reference/immune-brain-config.md).

## Consequences

- Existing user files stop applying until migrated; `imm-kernel config --json`
  and the status Tool report the v1 contract as an error naming the command.
- A team can no longer impose configuration through a tracked project file;
  repository facts that the Kernel enforces stay in `.imm/risk-floor.json` and
  `.imm/routine-classes.json`.
- A Lane's model can no longer be lost between the Parent and the runtime,
  because the Parent no longer resolves it.
