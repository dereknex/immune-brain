# AGENTS.md

<!-- IMMUNE-BRAIN:START -->
This project uses the Immune-Brain workflow.

- Read `IMMUNE.md` before selecting a route.
- Direct Path is the default when no Managed trigger applies. The ordinary host agent implements and verifies the requested local change without creating Spec, Plan, TaskIntent, TaskRecord, State Ledger, QA, mandatory Review, HANDOFF, or Compounder state.
- Keep an existing Managed owner on its current route. Use `imm-planner` only when a Managed trigger applies: explicit planning/audit/Managed intent; security, credentials, permissions, public API/schema/compatibility, persistence/migration, concurrency/recovery, release/deployment/external writes, destructive or irreversible effects, authority/risk override, unresolved material uncertainty, or multiple independently owned domains.
- Multiple files, multiple local verifiers, ordinary retries, optional read-only advisors, and unrelated dirty files do not independently select Managed.
- Navigation Protocol: check `CONTEXT.md` `## Architecture Map` before broad searching; inspect `.imm` discovery state only for an existing Managed owner.
- Ask the minimum blocking question or use a bounded read-only probe when risk is unclear, then reapply the route matrix.
- Use `imm-work` or `imm-canary-work` only to continue the matching validated Managed owner.
- Output Language Policy: set the default language for user-facing replies here. Persisted Immune-Brain documents default to English: `HANDOFF.md`, `docs/brainstorms/`, `docs/specs/`, `docs/plans/`, and `docs/solutions/`. A reply language preference does not change document language; add an explicit document-language instruction if these documents should use another language. Keep schema fields, enum values, CLI flags, JSON keys, State Ledger fields, file paths, tool names, API names, code identifiers, and `CONTEXT.md` canonical terms such as `Step`, `Plan`, and `Spec` literal.
- When Immune-Brain `[subagent_activation]` resolves to `auto` and the CLI activation plan returns bounded advisory candidates, this project authorizes readonly advisory subagents or parallel probes unless the user asks for solo work. If the current host still requires current-session authorization, ask once and record `host_authorization_required`; this project instruction does not override host tool policy.
<!-- IMMUNE-BRAIN:END -->
