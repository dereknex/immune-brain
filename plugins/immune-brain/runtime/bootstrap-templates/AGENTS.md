# AGENTS.md

<!-- IMMUNE-BRAIN:START -->
This project uses the Immune-Brain workflow.

- Read `IMMUNE.md` before selecting a route.
- Ordinary host input stays host-native; only explicit `imm-brainstorm`, `imm-planner`, or `imm-loop` Skill entry starts a new Managed workflow.
- Keep an active Assurance projection, TaskIntent, TaskRecord, or reviewer follow-up on its current owner and resume it through `imm-loop`.
- Bootstrap is explicit to Skill entry, idempotent when absent, and rejected when partial or incompatible.
- Navigation Protocol: check `CONTEXT.md` `## Architecture Map` before broad searching; inspect `.imm` discovery state only for an existing Managed owner.
- Ask the minimum blocking question or use a bounded read-only probe when material ambiguity remains, then reapply the route matrix.
- Use `imm-loop` only to continue the matching validated Managed owner.
- Output Language Policy: set the default language for user-facing replies here. Persisted Immune-Brain documents default to English: `HANDOFF.md`, `docs/brainstorms/`, `docs/specs/`, `docs/plans/`, and `docs/solutions/`. A reply language preference does not change document language; add an explicit document-language instruction if these documents should use another language. Keep schema fields, enum values, CLI flags, JSON keys, State Ledger fields, file paths, tool names, API names, code identifiers, and `CONTEXT.md` canonical terms such as `Step`, `Plan`, and `Spec` literal.
- This project authorizes readonly advisory subagents and parallel probes unless the user asks for solo work. If the current host still requires current-session authorization, ask once and record `host_authorization_required`; this project instruction does not override host tool policy.
<!-- IMMUNE-BRAIN:END -->
