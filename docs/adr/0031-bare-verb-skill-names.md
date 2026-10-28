---
status: accepted
---

# Bare-Verb Skill Names

Accepted on 2026-10-28 by the repository owner (#318, "Decisions (grilling
2026-10-28)", and the Planner deltas G-D1 and G-D2 in
`docs/specs/skill-rename-bare-verbs.spec.md`). It amends the recognition part
of [ADR 0025](0025-run-entry-decision-hosting.md): which literal input counts as
a run or plan entry. Token minting, binding and spending are unchanged.

## Context

The packaged skills carried an `imm-` prefix as a namespace. On Claude Code the
plugin name already namespaces them (`/immune-brain:<skill>`); on Pi there is no
plugin namespace and the first loaded skill of a name wins. The run-entry gate
recognized names by their prefix, so a bare verb that a user's own command or
skill also uses could otherwise mint an entry token for an operation that never
reaches this plugin.

## Decision

The eight skills take bare verb names, with no prefix and no aliases:

| Old | New |
|---|---|
| `imm-brainstorm` | `clarify` |
| `imm-planner` | `draw-up` |
| `imm-run` | `drive` |
| `imm-retro` | `revisit` |
| `imm-doc-slim` | `slim` |
| `imm-doc-prune` | `prune-docs` |
| `imm-test-prune` | `prune-tests` |
| `imm-pr-fix` | `fix-pr` |

Registry `role`, the phase enum `plan | run`, artifact names and the domain terms
Planner and Loop are unchanged.

Run-entry recognition (`runtime/assurance/phase_entry.ts`) reads a leading slash
command:

1. `immune-brain:<name>` enters the packaged phase.
2. `skill:<name>` enters it, except on Pi when a same-named user or project skill
   exists: Pi loads those first, so the prefix reaches the user's skill.
3. A bare `<name>` is read as an alias when a same-named user or project command
   exists; otherwise a same-named user or project skill blocks it; otherwise it
   enters the packaged phase.
4. An alias body enters a phase only when it carries exactly one distinct marked
   mention (`/drive`, `immune-brain:drive`, `skill:drive`) of a phase skill. A
   bare prose word such as "drive the build" is not a mention.
5. Old names, including `imm-loop`, are recognized nowhere.

A local-name reader that cannot read fails closed: no entry and no token from
the shadowable form. The skills guide's naming checklist gains a fifth check: no
same-named local user skill or command.

## Consequences

Users who named old skills in their own commands or prompt templates edit them
by hand; the 6.0.0 breaking note says so. `/immune-brain:drive` on Claude Code is
the shadow-proof entry. Dated history keeps the old names; `CONTEXT.md` maps
them.
