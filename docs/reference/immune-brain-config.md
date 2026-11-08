# Immune-Brain Configuration

Pi and Claude Code are supported code-agent hosts. Both read the same two
configuration files through one runtime resolver, recorded in
ADR 0034 (`docs/adr/0034-layered-configuration.md` in the repository):

- the **user file**, `~/.config/immune-brain/config.json`
  (`$XDG_CONFIG_HOME/immune-brain/config.json` when `XDG_CONFIG_HOME` is an
  absolute path), for personal choices and credential environment-variable
  names; and
- the **project file**, `.imm/config.json` at the checkout root, for repository
  facts and policy. It is honoured only when Git tracks it.

Either file may be absent. Immune-Brain reads no Immune-Brain-specific
environment override and no agent-local TOML file. Communication, reply-language
and subagent preferences stay in the Host's agent instruction files (see
[Other Preferences](#other-preferences)).

## User File

```json
{
  "contract": "immune_brain/user_config/v1",
  "decision_models": {
    "profiles": { "edge": { "kind": "clef", "model": "clef", "account_id_env": "CLOUDFLARE_ACCOUNT_ID", "token_env": "CLOUDFLARE_AUTH_TOKEN" } },
    "default_profile": "edge",
    "bindings": { "a14_pr_comment_triage": "edge" },
    "egress": { "clef": ["finding"] }
  },
  "lanes": {
    "active": "fast",
    "profiles": {
      "fast": { "max_parallel": 4, "executor_host": "claude-code", "executor_model": "<model id>", "executor_effort": "high" },
      "cheap": { "max_parallel": 2, "executor_host": "pi", "executor_effort": "low" }
    }
  },
  "initiative_carrier": "github",
  "projects": {
    "github.com/owner/repo": {
      "decision_models": { "default_profile": "edge" },
      "lanes": { "active": "cheap" },
      "initiative_carrier": "local"
    }
  }
}
```

- Every key is optional except `contract`. An unknown key at any level is
  invalid.
- Profiles are defined only at the top level. A `projects` entry may select a
  profile (`default_profile`, `bindings`, `lanes.active`) but not define one.
- A `*_env` value names an environment variable (`^[A-Z_][A-Z0-9_]*$`); the file
  never holds the credential itself.
- A `projects` key is the repository's normalized `origin` fetch URL: scheme,
  `user@`, port and a trailing `.git` or `/` removed, `git@host:owner/repo`
  rewritten to `host/owner/repo`, host lower-cased. With no `origin`, the key is
  the real path of the main checkout root. A Lane worktree gets the same key as
  its main checkout. `imm-kernel config --json` reports the key in use as
  `project_key`.

## Project File

```json
{
  "contract": "immune_brain/project_config/v1",
  "git_integration": "manual",
  "initiative_carrier": "github",
  "decision_models": { "enabled_points": ["a14_pr_comment_triage"], "egress": { "clef": [] } },
  "lanes": { "max_parallel": 2, "executor_host": "pi" },
  "batch": { "final_verification": ["bun run typecheck"] }
}
```

- Every key is optional except `contract`. An unknown key is invalid.
- `batch.final_verification` holds at most 8 plain command strings.
- `.imm/risk-floor.json` stays a separate file (see [Risk Floor](#risk-floor)).

## Precedence

First set wins in each row. **Request** values come from the literal current
request; the Parent or the Planner applies them on top of the resolved files.

| Kind | Keys | Order |
|---|---|---|
| personal | `decision_models.default_profile`, `decision_models.bindings.<point>`, `lanes.active` | request → user per-project → user |
| personal, field-wise | `lanes.max_parallel`, `lanes.executor_host`, `lanes.executor_model`, `lanes.executor_effort` | request → selected user Lane profile → project `lanes` → default |
| repository fact | `initiative_carrier` | request → project → user per-project → user → none (the Planner asks) |
| policy | `git_integration` | project → default (`manual`) |
| policy | `decision_models.enabled_points` | project → default (every registered point) |
| policy ceiling | `decision_models.egress.<kind>` | project list, intersected with the user per-project list if set, else with the user list if set |
| repository fact | `batch.final_verification` | request → project → test and type-check commands the repository instruction file names in prose → none |

- A user egress category outside the project ceiling is dropped and reported as
  `egress_beyond_project_ceiling`. The user file can only narrow egress.
- Project Lane values are defaults, not caps.
- A Lane `executor_model` or `executor_effort` applies only with an
  `executor_host` from the same layer; otherwise it is reported as `not_applied`
  and dropped.

## Inspecting the Effective Configuration

`imm-kernel config --json` prints the resolved configuration. Every leaf value is
`{ "value": ..., "source": ... }`, where `source` is `user`, `user:project`,
`project`, `legacy:<path>` or `default`. The command exits 1 when any diagnostic
has severity `error`, else 0. `--check-env` also reports, per decision-model
profile, whether each named variable is `set` or `unset`, never its value.

The status Tool on both Hosts carries the same object as `config` and adds every
`error` diagnostic to its warnings as `config_invalid`.

Each diagnostic is `{ code, severity, file, key_path, message }` with code
`config_invalid`, `unknown_profile`, `egress_beyond_project_ceiling`,
`not_applied`, `deprecated_config_source` or `legacy_source_ignored`. Messages
never contain a configured `*_env` value or any environment variable's value.
An error fails closed only in its own section:

- `decision_models` invalid: a decision returns `unavailable` / `config_invalid`;
- `lanes` invalid: the Parent reports it and starts no batch;
- `git_integration` invalid: `manual`;
- `initiative_carrier` invalid: none, and the Planner asks;
- a file that is not JSON or has the wrong `contract` fails every section it
  could set.

## Legacy Sources

These sources are read for one major version, each only when no new layer sets
the same section. A value read from one has source `legacy:<path>` and adds a
`deprecated_config_source` warning naming its replacement key with that key's
layer and file: your user file path for a user key, `.imm/config.json` for a
project key. When a new layer sets the section, the legacy source is not used
and `legacy_source_ignored` names it and the same replacement.

| Legacy source | Section it fills | Replacement key |
|---|---|---|
| `.imm/lanes.local.json` | `lanes` profiles and `active` | user `lanes` |
| `.imm/decision-models.local.json` | `decision_models.profiles` | user `decision_models.profiles` |
| `.imm/decision-bindings.json` | `default_profile`, `bindings` and `egress` | user `decision_models`, project `decision_models.egress` |
| `- Git integration:` in tracked `AGENTS.md`/`CLAUDE.md` | `git_integration` | project `git_integration` |
| `- Initiative carrier default:` in tracked `AGENTS.md`/`CLAUDE.md` | `initiative_carrier` | project `initiative_carrier` |

The Planner also reads, as its last step before asking, the deprecated
`Initiative carrier default: local` or `Initiative carrier default: github`
directive in the Host's user-level agent instruction file. A `legacy:AGENTS.md`
or `legacy:CLAUDE.md` carrier is used like any other resolved value; the Planner
reports that source and its deprecation warning.

## Initiative Carrier

The carrier applies only to proposals split across multiple TaskIntents.
Ordinary TaskIntents remain tracked by Kernel TaskRecords. There is no built-in
default: with no value from the request or the configuration, the Planner asks.
Set it in `.imm/config.json` for the repository, or in the user file for
yourself:

```json
{ "contract": "immune_brain/project_config/v1", "initiative_carrier": "github" }
```

A configured `github` value is standing opt-in for GitHub projection, but the
literal user still confirms the Initiative name, immutable slug, complete
Parent/Child decomposition, granularity, and dependencies before the first remote
mutation. Planner reports the selected carrier and its source. After confirmation
it publishes the complete Issue graph in one idempotent batch and reports the
recommended first unblocked Task, stable dependency order, and parallel groups.
Projection failure is reported with a batch retry action and does not invalidate
the authored planning files, but it blocks Enrollment and execution handoff for
that Initiative until the same complete batch succeeds. It never silently
switches carrier.

## Lane Preferences

The Parent resolves Lane choices from `imm-kernel config --json` before the first
`start_unattended_batch` call for an Initiative; the batch runner and Lane
worktrees read no configuration of their own.

- With no `lanes` value, a batch runs one Lane at a time on the Parent's own
  Host type with that Host's default model and effort.
- `max_parallel` is passed as `max_parallel` and turns lane mode on. A resumed
  batch keeps the value it recorded.
- `executor_host` is `claude-code` or `pi`. Every Lane uses it, with no fallback
  to the other Host.
- A request may name a profile and state single fields, such as "use `cheap`,
  but max parallel 3", for that batch only. The Parent shows each value with its
  source.
- An invalid `lanes` section or an unknown profile is reported and no batch
  starts.

Lane-mode agents only create: they close no tab, stop no session and remove no
Lane. The full contract is `plugins/immune-brain/dist/drive-batch.md#lane-preferences`.

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

## Git Integration

`git_integration` in the tracked `.imm/config.json` decides whether the runtime
writes commits to your branch on its own:

```json
{ "contract": "immune_brain/project_config/v1", "git_integration": "manual" }
```

- `manual` is the default. The runtime writes no commit outside batches.
  Enrollment stages its TaskIntent and Spec inside the Lane instead of
  committing them; storage-layout migration leaves its diff in the working tree
  and lists the paths. A settled task is delivered without any commit: commit
  however you prefer.
- `auto` commits exactly a task's settled scoped paths when it settles `done`,
  as `imm(<task-id>): settled delivery`. Enrollment writes no commit in either
  mode: the repository HEAD stays the task's Git base.
- An invalid value behaves as `manual` and is reported as a diagnostic.
- The status Tool reports the resolved preference as `git_integration`.
- An unborn HEAD refuses `drive` until the first commit exists: the Lane starts
  at the user's HEAD, so nothing creates an empty root commit or stages in the
  user's stead.

The legacy line `- Git integration: manual` (or `auto`) in the tracked root
`AGENTS.md`, else `CLAUDE.md`, is still read when `.imm/config.json` sets no
value, with a `deprecated_config_source` warning. ADR 0024 records the decision;
ADR 0034 moves it to the project file and ADR 0036 retires the
Enrollment commits it described.

## Other Preferences

- Set reply-language preferences as ordinary `AGENTS.md` communication
  instructions. Machine contracts, schema fields, paths, API names, and code
  identifiers remain literal.
- Project `AGENTS.md` owns standing authorization for bounded advisory
  subagents. Explicit solo instructions and Pi host policy still take
  precedence.
- Agent model selection uses the active Pi session model unless a Pi `Agent`
  invocation explicitly selects another Pi-configured model.
