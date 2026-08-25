# Immune-Brain Pi Preferences

Pi is the only supported code-agent host. Immune-Brain does not load an
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
confirms the Initiative name and immutable slug before the first remote
mutation. Planner reports the selected carrier and its source. Projection
failure is reported with a retry action; it does not silently switch carrier or
block TaskIntent authoring, Enrollment, or execution.

## Other Preferences

- Set reply-language preferences as ordinary `AGENTS.md` communication
  instructions. Machine contracts, schema fields, paths, API names, and code
  identifiers remain literal.
- Project `AGENTS.md` owns standing authorization for bounded advisory
  subagents. Explicit solo instructions and Pi host policy still take
  precedence.
- Agent model selection uses the active Pi session model unless a Pi `Agent`
  invocation explicitly selects another Pi-configured model.
