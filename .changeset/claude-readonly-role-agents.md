---
"immune-brain": minor
---

Ship generated native agent definitions for the read-only roles on the Claude Host.

- The Claude plugin build now also writes `immune-brain-qa`, `immune-brain-ui-review` and `immune-brain-advisory-reviewer`, each body generated from the matching `runtime/prompts/` role prompt the Pi Host dispatches, under fixed frontmatter whose tool allowlist is exactly `Read, Grep, Glob`. These roles declare `no tools` in `INTERNAL_ROLE_PROMPTS`; a native definition cannot express an empty allowlist without inheriting every tool, so read-only-without-shell is the strictest expressible boundary. `--check` fails when a committed definition differs from a fresh generate.
- `runtime/claude/role_agents.ts` maps exactly those three roles to their plugin agent types, and `arch-explorer` to the Host's own `Explore` agent with no shipped definition, so a second definition cannot fork a boundary the Host owns.
- The packaged Loop and Planner contracts and the dispatch protocol, with its packaged mirror identical to its source, state that on the Claude Host a read-only role is dispatched through the `Agent` tool by its plugin agent type, that architecture exploration uses the Host's `Explore` agent, and that the agent definition rather than prompt text bounds the role's tools. They state that on Pi the agent configuration belongs to the user and the boundary remains prompt text.
- `loopRoleSubagentFor`, the Pi dispatch envelope and the reviewer definition are unchanged.
