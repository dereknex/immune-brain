# Immune-Brain Configuration

Pi, Claude Code and Antigravity read the same two configuration files through
one runtime resolver, recorded in ADR 0041
(`docs/adr/0041-simplified-configuration.md` in the repository):

- the **user file**, `~/.config/immune-brain/config.json`
  (`$XDG_CONFIG_HOME/immune-brain/config.json` when `XDG_CONFIG_HOME` is an
  absolute path), for your agent profiles, decision-model profiles and
  credential environment-variable names; and
- the **project file**, `.imm/config.json` at the root of the main checkout,
  for your choices in one repository. It is a local file: keep it out of version
  control so that each developer's choices stay their own. It is read whether or
  not Git tracks it, and a Lane worktree reads the main checkout's file.

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
    "executor": "cheap",
    "reviewer": "opus",
    "planner": "opus",
    "triage": "claude-code:<model id>@low"
  },
  "session_providers": ["herdr"],
  "batch": { "max_parallel": 3 },
  "decision_models": {
    "profiles": { "edge": { "kind": "clef", "model": "clef", "account_id_env": "CLOUDFLARE_ACCOUNT_ID", "token_env": "CLOUDFLARE_AUTH_TOKEN" } },
    "default_profile": "edge",
    "bindings": { "a14_pr_comment_triage": "edge" },
    "egress": { "clef": ["finding"] }
  },
  "git_integration": "manual",
  "initiative_carrier": "github"
}
```

```json
{
  "contract": "immune_brain/project_config/v2",
  "agents": { "executor": "opus" },
  "batch": { "max_parallel": 2, "final_verification": ["bun run typecheck", "bun test"] },
  "decision_models": { "bindings": { "a4_finding_equivalence": "off" } },
  "initiative_carrier": "local",
  "loop": { "interaction": { "channel": "local" } }
}
```

- The top-level keys are `contract`, `agents`, `session_providers`, `batch`,
  `decision_models`, `git_integration`, `initiative_carrier`, `loop` and
  `review_verifier`. Every key is optional except `contract`. An unknown key at
  any level is invalid. The retired `herdr` key is still accepted so existing
  files warn instead of failing, but it is never resolved (see below).
- `agents.profiles` and `decision_models.profiles` exist only in the user file.
  The project file refers to a user profile by name.
- A `*_env` value names an environment variable (`^[A-Z_][A-Z0-9_]*$`); the file
  never holds the credential itself.
- `session_providers` is a non-empty ordered list of distinct registered
  provider names (`herdr`, `herdr-core`; default `["herdr", "herdr-core"]`). The project
  file replaces the user file. An empty list, an unknown or test-only name
  (`fake`, `process`), a duplicate entry, or a non-array is a blocking
  `config_invalid` error. `imm-kernel config migrate --write` removes a stored
  `herdr` key and preserves every other key.
- `herdr` is retired: setting it in either file produces one non-blocking
  `retired_key` warning diagnostic at key path `herdr`, is ignored by the
  resolver, and is omitted from the effective configuration. A Lane Executor
  started inside Herdr (`HERDR_ENV=1`) runs in an interactive Herdr tab.
  Authority Review and its findings verification
  always run in a Herdr session; the Loop roles always run as processes.
- `batch.max_parallel` is an integer in 1..8 (default 1).
  `batch.final_verification` holds at most 8 plain command strings.
- `loop.interaction.channel` is `"github"` or `"local"` and defaults to `"github"`: it selects where the Loop
  daemon asks you a question. With `local` the daemon writes its requests under
  `.imm/state/loop/interactions/`, your own Host session lists them with `loop_interactions` and answers one
  through `answer_loop_interaction`, and the daemon applies the confirmed answer on its next tick. A
  `plan_approval` is still answered by your own `drive` entry. Any other value is `config_invalid`.
- `.imm/risk-floor.json` and `.imm/routine-classes.json` stay separate, tracked
  files (see [Risk Floor](#risk-floor)).

A file whose `contract` is a `v1` contract is invalid as a whole. Convert it
with `imm-kernel config migrate`, which prints the converted files, and
`imm-kernel config migrate --write` to write them. The migration also folds in
the retired sources: `projects.<key>` entries of the user file (the current
repository's entry becomes its project file; other entries are listed for you to
move), `agents.presets` and `active`, `lanes`, `.imm/lanes.local.json`,
`.imm/decision-models.local.json`, `.imm/decision-bindings.json`,
`decision_models.enabled_points`, and the `- Git integration:` and
`- Initiative carrier default:` lines in `AGENTS.md` or `CLAUDE.md`. It deletes
none of those sources; remove them once the result is right.

## Agents

`agents` binds each of four roles to one Host profile:

| Role | Runs |
|---|---|
| `executor` | every Lane Executor, and the Loop's `repair` work (`pr-fix`, `test-fixer`) |
| `reviewer` | Authority Review, its findings verification, and advisory reviewers |
| `planner` | the Loop's `clarify` and `plan` steps |
| `triage` | the Loop's judging of new issues, PRs and comments |

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
Without a value, the Lane Executor runs on the Parent's own Host type with its
default model, Review reports `review_profile_required`, and the Loop roles
keep their `claude-code` fallback. An invalid role value counts as unset and is
reported as `config_invalid` (or `unknown_profile` for an unknown name).

## Precedence

Every key resolves request → project file → user file → default, the first set
value winning. **Request** values come from the literal current request (see
[Lane Preferences](#lane-preferences)).

| Key | Merge |
|---|---|
| `agents.<role>` | per role; a whole profile from one layer |
| `decision_models.default_profile`, `decision_models.bindings.<point>` | per key |
| `decision_models.egress.<kind>` | per provider kind |
| `session_providers`, `batch.max_parallel`, `batch.final_verification`, `initiative_carrier`, `review_verifier` | first set value |
| `git_integration` | stricter wins: `manual` if either file sets it |
| `loop.auto_enroll_max_risk` | stricter wins: the lower risk |
| `loop.allowed_actors`, `loop.allowed_associations` | stricter wins: the intersection of the layers that set them |

Permission keys take the stricter value so that a local file cannot widen what
your user file allows. `batch.final_verification` falls back to the test and
type-check commands the repository instruction file names in prose, else none.

A decision point bound to `"off"` is disabled and returns `unavailable` /
`point_disabled`; an unbound point uses `default_profile`.

## Inspecting the Effective Configuration

`imm-kernel config --json` prints the resolved configuration (contract
`immune_brain/effective_config/v2`). Every leaf value is
`{ "value": ..., "source": ... }`, where `source` is `project`, `user` or
`default`. The command exits 1 when any diagnostic has severity `error`, else 0.
`--check-env` also reports, per decision-model profile, whether each named
variable is `set` or `unset`, never its value.

`agents.roles.<role>` holds `{ host, model, effort, source }`, or `null` when
nothing binds the role; `agents.profiles` is a leaf like any other value.

The status Tool on both Hosts carries the same object as `config` and adds every
`error` diagnostic to its warnings as `config_invalid`.

Each diagnostic is `{ code, severity, file, key_path, message }` with code
`config_invalid`, `unknown_profile` or `retired_key` (`retired_key` is always a
non-blocking warning). Messages never contain a configured
`*_env` value or any environment variable's value. An invalid value counts as
unset, so the next layer or the default applies, and its diagnostic stays an
error:

- `decision_models` profiles invalid: a decision returns `unavailable` /
  `config_invalid`;
- any error under `agents`, `batch` or `session_providers`, or a file that is not JSON or
  has the wrong `contract`: no batch starts (`lane_config_invalid`), and Review
  reports `review_config_invalid` naming the file and key path;
- `git_integration` invalid: `manual`;
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

## Lane Preferences

The runtime resolves every Lane choice itself; the Parent passes the literal
request through and never resolves configuration for a batch.

- A new batch freezes the resolved `executor` and `reviewer` profiles and
  `batch.max_parallel`. Every Executor generation and every CLI Review of that
  batch runs on them, and a resume keeps them even when the files change.
- `start_unattended_batch` takes `agents: { executor?, reviewer? }` for one
  batch, each a profile name, shorthand or object as in [Agents](#agents). A
  request value replaces that role whole, for that batch alone.
- Every Lane runs the resolved `executor` host with no fallback to another Host.
- Any configuration error under `agents`, `batch` or `session_providers` starts no batch.

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
`risk.outside_routine_allowlist`; the Review brief and each child of a batch
final report list the same paths as `outside_routine_allowlist` next to
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
- With `manual` the runtime writes no commit outside batches.
  Enrollment stages its TaskIntent and Spec inside the Lane instead of
  committing them; storage-layout migration leaves its diff in the working tree
  and lists the paths. A settled task is delivered without any commit: commit
  however you prefer.
- `auto` commits exactly a task's settled scoped paths when it settles `done`,
  as `imm(<task-id>): settled delivery`. Enrollment writes no commit in either
  mode: the repository HEAD stays the task's Git base.
- The status Tool reports the resolved preference as `git_integration` with its
  source.
- An unborn HEAD refuses `drive` until the first commit exists: the Lane starts
  at the user's HEAD, so nothing creates an empty root commit or stages in the
  user's stead.

ADR 0024 records the decision; ADR 0036 retires the Enrollment commits it
described, and ADR 0041 sets the precedence above.

## Other Preferences

- Set reply-language preferences as ordinary `AGENTS.md` communication
  instructions. Machine contracts, schema fields, paths, API names, and code
  identifiers remain literal.
- Project `AGENTS.md` owns standing authorization for bounded advisory
  subagents. Explicit solo instructions and Pi host policy still take
  precedence.
- Agent model selection uses the active Pi session model unless a Pi `Agent`
  invocation explicitly selects another Pi-configured model.
