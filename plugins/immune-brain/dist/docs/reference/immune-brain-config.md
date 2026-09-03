# Immune-Brain Pi Preferences

Pi and Claude Code are supported code-agent hosts. Immune-Brain does not load an
agent-local TOML file or Immune-Brain-specific environment overrides. User and
project preferences belong in Pi-injected `AGENTS.md` instructions.

## Precedence

Planner preferences resolve in this order:

1. a literal instruction in the current request;
2. the repository root `AGENTS.md`;
3. `~/.pi/agent/AGENTS.md`; or
4. the Skill's documented default or an explicit user question.

Invalid values are reported rather than guessed.

## Initiative Carrier

The Initiative carrier preference applies only to proposals split across
multiple TaskIntents. Ordinary TaskIntents remain tracked by Kernel
TaskRecords. Set one of these fixed directives in `AGENTS.md`:

```md
## Immune-Brain Preferences

- Initiative carrier default: local
```

```md
## Immune-Brain Preferences

- Initiative carrier default: github
```

A repository directive overrides the global directive. A configured `github`
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
