# Immune-Brain Configuration

Pi, Claude Code and Antigravity read the same two configuration files through
one runtime resolver, recorded in ADR 0041
(`docs/adr/0041-simplified-configuration.md` in the repository, as amended by
ADR 0043):

- the **user file**, `~/.config/immune-brain/config.json`
  (`$XDG_CONFIG_HOME/immune-brain/config.json` when `XDG_CONFIG_HOME` is an
  absolute path), for your agent profiles and personal defaults; and
- the **project file**, `.imm/config.json` at the root of the main checkout,
  for your choices in one repository. It is a local file: keep it out of version
  control so that each developer's choices stay their own. It is read whether or
  not Git tracks it, and a linked worktree reads the main checkout's file.

Either file may be absent. Immune-Brain reads no Immune-Brain-specific
environment override, no agent-local TOML file, and no preference line in
`AGENTS.md` or `CLAUDE.md`. Communication, reply-language and subagent
preferences stay in the Host's agent instruction files (see
[Other Preferences](#other-preferences)).

## Files

Both files take the same keys, except that profiles are defined only in the user
file:

```json
{
  "contract": "immune_brain/user_config/v2",
  "agents": {
    "profiles": {
      "opus": { "host": "claude-code", "model": "<model id>", "effort": "medium" },
      "cheap": { "host": "pi", "model": "<provider>/<model id>", "effort": "low" }
    },
    "reviewer": "opus",
    "planner": "opus",
    "triage": "claude-code:<model id>@low"
  },
  "git_integration": "manual",
  "external_approval": false,
  "initiative_carrier": "github"
}
```

```json
{
  "contract": "immune_brain/project_config/v2",
  "agents": { "reviewer": "opus" },
  "initiative_carrier": "local"
}
```

- The top-level keys are `contract`, `agents`, `git_integration`, `external_approval`, `initiative_carrier` and
  `review_verifier`. Every key is
  optional except `contract`. An unknown key at any level is invalid. The
  retired `herdr` key is still accepted so existing files warn instead of
  failing, but it is never resolved (see below).
- The `loop`, `decision_models`, `batch` and `session_providers` keys are
  retired (ADR 0043). Each is an unknown key: it reports `config_invalid` at
  that key path, and `imm-kernel config --json` exits 1, until
  `imm-kernel config migrate --write` removes it. That command removes a stored
  `herdr`, `loop`, `decision_models`, `batch` or `session_providers` key
  and preserves every other key.
- `agents.profiles` exists only in the user file. The project file refers to a
  user profile by name.
- `herdr` is retired: setting it in either file produces one non-blocking
  `retired_key` warning diagnostic at key path `herdr`, is ignored by the
  resolver, and is omitted from the effective configuration. Authority Review
  and its findings verification always run in a Herdr session.
- `.imm/risk-floor.json` and `.imm/routine-classes.json` stay separate, tracked
  files (see [Risk Floor](#risk-floor)).

A file whose `contract` is a `v1` contract is invalid as a whole. Convert it
with `imm-kernel config migrate`, which prints the converted files, and
`imm-kernel config migrate --write` to write them. The migration also folds in
the retired sources: `projects.<key>` entries of the user file (the current
repository's entry becomes its project file; other entries are listed for you to
move), `agents.presets` and `active`, `lanes`, `.imm/lanes.local.json`, and the
`- Git integration:` and `- Initiative carrier default:` lines in `AGENTS.md` or
`CLAUDE.md`. It deletes none of those sources; remove them once the result is
right. It writes no `loop`, `decision_models`, `batch` or
`session_providers` value and removes those keys from both files.

## Agents

`agents` binds each of four roles to one Host profile:

| Role | Runs |
|---|---|
| `reviewer` | Authority Review, its findings verification, and advisory reviewers |
| `executor` | accepted so existing files stay valid; nothing reads it (ADR 0043) |
| `planner` | accepted so existing files stay valid; nothing reads it (ADR 0043) |
| `triage` | accepted so existing files stay valid; nothing reads it (ADR 0043) |

A role value is one of:

- a profile name defined in the user file's `agents.profiles`;
- shorthand `host[:model][@effort]`, such as `pi`,
  `claude-code:<model id>` or `pi:<provider>/<model id>@high`. The text after
  the last `@` is the effort only when it is a known level (`off`, `minimal`,
  `low`, `medium`, `high`, `xhigh`, `max`); otherwise it stays part of the model.
  A profile name wins over shorthand with the same spelling;
- an object `{ "host": ..., "model": ..., "effort": ... }`.

`host` is `claude-code`, `pi` or `antigravity`; `model` and `effort` are
optional and default to the Host's own defaults. Host, model and effort always
come from one value, so a role never mixes a host from one layer with a model
from another.

Each role resolves on its own: request → project file → user file → built-in.
Without a value, Review reports `review_profile_required`. An invalid role value counts as unset and is
reported as `config_invalid` (or `unknown_profile` for an unknown name).

## Precedence

Every key resolves request → project file → user file → default, the first set
value winning. **Request** values come from the literal current request.

| Key | Merge |
|---|---|
| `agents.<role>` | per role; a whole profile from one layer |
| `initiative_carrier`, `review_verifier` | first set value |
| `git_integration` | stricter wins: `manual` if either file sets it |
| `external_approval` | stricter wins: `false` if either file sets it |

Permission keys take the stricter value so that a local file cannot widen what
your user file allows.

## Inspecting the Effective Configuration

`imm-kernel config --json` prints the resolved configuration (contract
`immune_brain/effective_config/v2`). Every leaf value is
`{ "value": ..., "source": ... }`, where `source` is `project`, `user` or
`default`. The command exits 1 when any diagnostic has severity `error`, else 0.

`agents.roles.<role>` holds `{ host, model, effort, source }`, or `null` when
nothing binds the role; `agents.profiles` is a leaf like any other value.

The status Tool on both Hosts carries the same object as `config` and adds every
`error` diagnostic to its warnings as `config_invalid`.

Each diagnostic is `{ code, severity, file, key_path, message }` with code
`config_invalid`, `unknown_profile` or `retired_key` (`retired_key` is always a
non-blocking warning). An invalid value counts as unset, so the next layer or the
default applies, and its diagnostic stays an error:

- an unknown top-level key such as the retired `loop`, `decision_models`,
  `batch` or `session_providers`, or a file that is not JSON or has the wrong
  `contract`: `config_invalid`, and `imm-kernel config --json` exits 1;
- an `agents` error that leaves Review without a profile: Review reports
  `review_config_invalid` naming the file and key path;
- `git_integration` invalid: `manual`;
- `external_approval` invalid (or either file broken): `false`;
- `initiative_carrier` invalid: none, and the Planner asks.

## Initiative Carrier

The carrier applies only to proposals split across multiple TaskIntents.
Ordinary TaskIntents remain tracked by Kernel TaskRecords. There is no built-in
default: with no value from the request or the configuration, the Planner asks.
Set it in `.imm/config.json` for the repository, or in the user file for
yourself:

```json
{ "contract": "immune_brain/project_config/v2", "initiative_carrier": "github" }
```

A configured `github` value is standing approval for GitHub projection, but the
literal user still confirms the Initiative name, immutable slug, complete
Parent/Child decomposition, granularity, and dependencies before the first remote
mutation. Planner reports the selected carrier and its source. After confirmation
it publishes the complete Issue graph in one idempotent batch and reports the
recommended first unblocked Task, stable dependency order, and parallel groups.
Projection failure is reported with a batch retry action and does not invalidate
the authored planning files, but it blocks Enrollment and execution handoff for
that Initiative until the same complete batch succeeds. It never silently
switches carrier.

## Risk Floor

The paths that force a higher task risk are declared by the project in one
tracked file, `.imm/risk-floor.json`. It is not a preference an Agent reads: the
Kernel enforces it, so it does not live in `AGENTS.md` or `CLAUDE.md`.

```json
{
  "contract": "assurance_kernel/risk_floor/v1",
  "material": { "paths": ["src/auth"], "changed_only": ["db/migrations"] },
  "critical": { "paths": ["infra/prod"], "changed_only": [] }
}
```

- `paths` raises a task whose `scope_hint` can reach the prefix, including
  through a glob, or whose changed paths sit beneath it.
- `changed_only` raises a task only through its changed paths, so a scope that
  merely names the prefix keeps its declared risk.
- Every entry is a literal, normalized, project-relative path prefix with
  forward slashes and no wildcard. Both tiers and both lists are optional.
- A declared risk is only ever raised, never lowered.

The reader fails closed:

- No file means no floor. Every task keeps the risk its TaskIntent declares.
- A file that is not valid JSON, has an unknown field or a wrong type, is not a
  regular file, exceeds 64 KiB, or cannot be read makes every task of the
  project `critical`.
- A file with staged, unstaged or untracked changes is treated the same way
  until it is committed, so an edit made beside a task cannot lower that task's
  floor.
- `.imm/risk-floor.json` itself is always `critical`: a task whose scope can
  reach it, or that changes it, is `critical` whatever the file says.

`imm-kernel inspect --json` reports the prefixes in force as
`risk.floor_prefixes` and the reason an untrusted declaration was refused as
`risk.floor_invalid`. A TaskRecord keeps the risk it was enrolled with; changing
the declaration does not re-grade a task that is already enrolled. ADR 0023
records the decision.

## Routine Allowlist

A TaskIntent that declares `risk: "routine"` settles after deterministic QA,
without Review. The project can make that declaration checkable by listing, in
one tracked file `.imm/routine-classes.json`, the paths where it may stand:

```json
{
  "contract": "assurance_kernel/routine_classes/v1",
  "classes": [{ "id": "docs-only", "paths": ["README.md", "docs/solutions"] }]
}
```

- Each class has a kebab-case `id` and literal, normalized, project-relative
  path prefixes with forward slashes and no wildcard.
- The check runs on the actual diff, not on `scope_hint`. When any changed path
  of a `routine` task (its own TaskIntent and bound Spec excluded) lies outside
  every class, the task is raised to `material`, so it needs Review. Nothing is
  refused and no gate opens.
- The list only raises. It never lowers a risk and leaves `material` and
  `critical` declarations and the risk floor as they are. An empty `classes`
  list lets no `routine` declaration stand on a change.
- The Planner may use the list to suggest `routine`; only the settlement check
  decides.

The reader fails closed the same way the risk floor reader does: no file means
no allowlist, an untrusted file makes every task `critical`, and
`.imm/routine-classes.json` itself is always `critical`.

`imm-kernel inspect --json` reports the declared class ids as
`risk.routine_classes` and the paths that raised a `routine` task as
`risk.outside_routine_allowlist`; the Review brief lists the same paths as `outside_routine_allowlist` next to
`beyond_estimate` when there are any. ADR 0038 records the decision.

## Git Integration

Top-level `git_integration` decides whether the runtime writes commits to your
branch on its own:

```json
{ "contract": "immune_brain/user_config/v2", "git_integration": "manual" }
```

- `manual` is the default, and it wins whenever either file sets it: a project
  file cannot turn `auto` on against a user file that says `manual`. An invalid
  value or an invalid file behaves as `manual` and is reported as a diagnostic.
- With `manual` the runtime writes no commit. Enrollment stages its
  TaskIntent and Spec in the current worktree instead of committing them; storage-layout migration leaves its diff in the working tree
  and lists the paths. A settled task is delivered without any commit: commit
  however you prefer.
- `auto` commits exactly a task's settled scoped paths when it settles `done`,
  as `imm(<task-id>): settled delivery`. Enrollment writes no commit in either
  mode: the repository HEAD stays the task's Git base.
- The status Tool reports the resolved preference as `git_integration` with its
  source.
- An unborn HEAD refuses `drive` until the first commit exists: the task
  starts at the user's HEAD, so nothing creates an empty root commit or stages
  in the user's stead.

ADR 0024 records the decision; ADR 0036 retires the Enrollment commits it
described, and ADR 0041 sets the precedence above.

## External Approval

Top-level `external_approval` is a boolean permission key that lets a local
orchestrator, running as you on this machine, approve through
`imm-kernel --json` instead of a Host's native gate (ADR 0043 Decision 4):

```json
{ "contract": "immune_brain/user_config/v2", "external_approval": true }
```

- `false` is the default and wins whenever either file sets it: a project file
  cannot enable it against a user file that says `false`. A non-boolean value
  or a broken file resolves to `false` and is reported as `config_invalid`.
  `imm-kernel config migrate` keeps the key as it is.
- With `true`, `imm-kernel approve <task-id> --json` enrolls a Git-tracked
  TaskIntent (the TaskRecord records `confirmation_source: "external_approval"`),
  `--finding <finding-id> --resolution <text>` resolves one open user decision,
  and `--stop <reason>` stops the active task and exports its audit evidence.
  `--actor <actor-id>` names the approving actor (default `literal-user`).
  Every result uses contract `assurance_kernel/approval_result/v1`.
- Without `true`, `imm-kernel approve` exits 1 with
  `external_approval_disabled` before any Kernel write. Malformed flags exit 2
  with `invalid_command`.
- `imm-kernel inspect --json` lists an active task's open user decisions as
  `assurance.projection.unresolved_user_decisions`, and
  `imm-kernel inspect --task <task-id> [--run <run-id>] --json` verifies a
  settled task's `.imm/audit/<task-id>/<run-id>/` pair, exiting 1 with
  `task_audit_missing` or `task_audit_invalid`. Inspect never writes state.
- Residual-risk acceptance, breaking revisions, rework and Review-retry grants,
  and QA or Review runs are not reachable through it. Managed and Agent
  sessions never run `imm-kernel approve`; it is for your own orchestrator.

## Other Preferences

- Set reply-language preferences as ordinary `AGENTS.md` communication
  instructions. Machine contracts, schema fields, paths, API names, and code
  identifiers remain literal.
- Project `AGENTS.md` owns standing authorization for bounded advisory
  subagents. Explicit solo instructions and Pi host policy still take
  precedence.
- Agent model selection uses the active Pi session model unless a Pi `Agent`
  invocation explicitly selects another Pi-configured model.
