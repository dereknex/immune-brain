# Agent Instructions

<!-- IMMUNE-BRAIN:START -->
This project uses the Immune-Brain workflow.

- Read `IMMUNE.md` before selecting a route.
- Ordinary host input stays host-native; only explicit `imm-brainstorm`, `imm-planner`, or `imm-loop` Skill entry starts a new Managed workflow. `imm-pr-fix`, `imm-doc-prune`, and `imm-agent-doc-maintain` are standalone host-native maintenance entries and do not start Managed workflow.
- Keep an active Assurance projection, TaskIntent, TaskRecord, or reviewer follow-up on its current owner; resume it only when the user explicitly enters `imm-loop`.
- Immune-Brain does not install or validate project-wide `AGENTS.md`, `IMMUNE.md`, or `CONTEXT.md` contracts.
- Navigation Protocol: check `CONTEXT.md` `## Architecture Map` before broad searching; inspect `.imm` discovery state only for an existing Managed owner.
- Output Language Policy: set the default language for user-facing replies here. Persisted Immune-Brain documents default to English: `HANDOFF.md`, `docs/brainstorms/`, `docs/specs/`, `docs/plans/`, and `docs/solutions/`. A reply language preference does not change document language; add an explicit document-language instruction if these documents should use another language. Keep schema fields, enum values, CLI flags, JSON keys, State Ledger fields, file paths, tool names, API names, code identifiers, and `CONTEXT.md` canonical terms such as `Step`, `Plan`, and `Spec` literal.
- This project authorizes readonly advisory subagents and parallel probes unless the user asks for solo work. If the current host still requires current-session authorization, ask once and record `host_authorization_required`; this project instruction does not override host tool policy.
- Regression check: run `bun test`; there is no `test` script in `package.json`.
<!-- IMMUNE-BRAIN:END -->

## Immune-Brain Preferences

- Initiative carrier default: github

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `dereknex/immune-brain`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
