# Immune-Brain Host Preferences

Pi and Claude Code are supported code-agent hosts. Immune-Brain does not load an
agent-local TOML file or Immune-Brain-specific environment overrides. User and
project preferences belong in the Host's agent instruction files.

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

## Other Preferences

- Set reply-language preferences as ordinary `AGENTS.md` communication
  instructions. Machine contracts, schema fields, paths, API names, and code
  identifiers remain literal.
- Project `AGENTS.md` owns standing authorization for bounded advisory
  subagents. Explicit solo instructions and Pi host policy still take
  precedence.
- Agent model selection uses the active Pi session model unless a Pi `Agent`
  invocation explicitly selects another Pi-configured model.
