# Immune-Brain Host Preferences

Pi and Claude Code are supported code-agent hosts. Immune-Brain does not load an
agent-local TOML file or Immune-Brain-specific environment overrides. User and
project preferences belong in the Host's agent instruction files.

Lane preferences are the one exception: they live in a personal, gitignored
preset, `.imm/lanes.local.json`, described under
[Lane Preferences](#lane-preferences) and recorded in
[ADR 0033](../adr/0033-lane-preferences-local-preset.md).

## Precedence

Planner preferences resolve in this order:

1. a literal instruction in the current request;
2. the repository root agent instruction file, whichever the repository tracks:
   `AGENTS.md` or `CLAUDE.md`;
3. the Host's user-level agent instruction file; or
4. an explicit user question.

Hosts differ in which files they auto-load: Pi injects `AGENTS.md`, while Claude
Code auto-loads `CLAUDE.md` and does not read `~/.pi/agent/AGENTS.md` at all. A
Skill therefore reads sources 2 and 3 directly instead of assuming the Host
placed them in context, and reports which sources it checked.

Invalid values are reported rather than guessed. A preference with no documented
default resolves to a user question, never to a silently chosen value.

## Initiative Carrier

The Initiative carrier preference applies only to proposals split across
multiple TaskIntents. Ordinary TaskIntents remain tracked by Kernel
TaskRecords. There is no built-in carrier default; when no directive is found,
Planner asks. Set one of these fixed directives in the repository root
`AGENTS.md` or `CLAUDE.md`:

```md
## Immune-Brain Preferences

- Initiative carrier default: local
```

```md
## Immune-Brain Preferences

- Initiative carrier default: github
```

A repository directive overrides the user-level directive. A configured `github`
default is standing opt-in for GitHub projection, but the literal user still
confirms the Initiative name, immutable slug, complete Parent/Child decomposition,
granularity, and dependencies before the first remote mutation. Planner reports
the selected carrier and its source. After confirmation it publishes the complete
Issue graph in one idempotent batch and reports the recommended first unblocked
Task, stable dependency order, and parallel groups. Projection failure is reported
with a batch retry action and does not invalidate the authored planning files,
but it blocks Enrollment and execution handoff for that Initiative until the same
complete batch succeeds. It never silently switches carrier.

## Lane Preferences

Lane-mode choices are personal and per clone, so they live in
`.imm/lanes.local.json` at the checkout root, not in `AGENTS.md` or `CLAUDE.md`.
Add `.imm/lanes.local.json` to `.gitignore`. The Parent reads the file directly
before the first `start_unattended_batch` call for an Initiative; the batch
runner, the runtime and Lane worktrees read none of it. Instruction-file lane
directives are not read.

```json
{
  "active": "fast",
  "profiles": {
    "fast": { "max_parallel": 4, "executor_host": "claude-code", "executor_model": "<model id>", "executor_effort": "high" },
    "cheap": { "max_parallel": 2, "executor_host": "pi", "executor_effort": "low" }
  }
}
```

- The file has only `active` (optional, a profile name) and `profiles`. With no
  file, or no `active`, a batch runs one Lane at a time on the Parent's own
  Host type with that Host's default model and effort.
- `max_parallel` is passed as `max_parallel` and turns lane mode on. A resumed
  batch keeps the value it recorded.
- `executor_host` is `claude-code` or `pi`. Every Lane uses it, with no
  fallback to the other Host.
- `executor_model` and `executor_effort` apply only when the same profile sets
  `executor_host`, because a model ID belongs to one Host; otherwise they are
  reported and not applied.
- A request may name a profile and state single fields, such as "use `cheap`,
  but max parallel 3", for that batch only. The Parent shows each value with
  its source: `request`, `preset:<profile>` or `default`.
- Malformed JSON, an unknown profile, an unknown key or an invalid value is
  reported and no batch starts.

Final verification commands for a batch come from the request, else the full
test and type-check commands the repository instruction file names in prose,
else none.

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

One line in the tracked repository root `AGENTS.md`, else in the tracked root
`CLAUDE.md`, decides whether the runtime writes commits to your branch on its
own:

```markdown
- Git integration: manual
```

- `manual` is the default, used when the line is absent. The runtime writes no
  commit outside batches. Enrollment stages its TaskIntent and Spec instead of
  committing them; with an unborn HEAD, in-scope changes are claimed as task
  work; storage-layout migration leaves its diff in the working tree and lists
  the paths. A settled task is delivered without any commit: commit however you
  prefer.
- `auto` keeps the precondition commits of ADR 0023 and, when a task settles
  `done`, commits exactly its settled scoped paths as
  `imm(<task-id>): settled delivery`.
- Any other value behaves as `manual`. The status Tool reports it as an
  `invalid_git_integration` warning naming the file and the value.
- The status Tool reports the resolved preference as `git_integration`.
- The confirmed empty root commit for an unborn HEAD is made in both modes.

ADR 0024 records the decision.

## Other Preferences

- Set reply-language preferences as ordinary `AGENTS.md` communication
  instructions. Machine contracts, schema fields, paths, API names, and code
  identifiers remain literal.
- Project `AGENTS.md` owns standing authorization for bounded advisory
  subagents. Explicit solo instructions and Pi host policy still take
  precedence.
- Agent model selection uses the active Pi session model unless a Pi `Agent`
  invocation explicitly selects another Pi-configured model.
