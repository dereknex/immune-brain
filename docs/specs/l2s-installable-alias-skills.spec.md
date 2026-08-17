# Spec: Canonical L2S skill entrypoints

> This legacy filename is retained for inbound links. The installable `prep` and
> `run` aliases have been removed; L2S-WF now uses canonical Immune-Brain skills.

## Objective

Keep the lightweight planning-to-execution workflow on the canonical Skill
surface without duplicating routing logic or authority.

## Requirements

### R1. Planning uses `imm-planner`

`imm-planner` owns Spec and Plan creation. It may perform brief direct-entry
clarification; material ambiguity routes to `imm-brainstorm` before planning.
It must stop before implementation edits.

### R2. Execution uses `imm-loop`

`imm-loop` starts from a validated Plan, consumes `imm-autowork` checkpoints,
coordinates execution and isolated QA/review, and reports the
`imm-compounder` handoff after closure.

### R3. Installation exposes only canonical entries

The installer discovers Skills through `skills/*/SKILL.md`. The registry and
distributed registry must not contain removed planning or execution aliases.

### R4. Documentation reflects real usage

User-facing documentation must describe the default path as:

```text
imm-planner -> imm-loop
```

When material ambiguity remains, it must describe:

```text
imm-brainstorm -> imm-planner -> imm-loop
```

## Non-goals

- No new shell aliases.
- No shared runtime dispatcher.
- No replacement of existing authority roles.

## Verification scenarios

- Scenario A: Skill registry consistency passes without alias entries.
- Scenario B: `imm-planner` produces a validated Plan without implementation edits.
- Scenario C: `imm-loop` refuses to start without a validated Plan.
- Scenario D: Current user documentation names only canonical entrypoints.
