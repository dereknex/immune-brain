# AGENTS.md

<!-- IMMUNE-BRAIN:START -->
This project uses the Immune-Brain workflow.

- Read `IMMUNE.md` before selecting a route.
- Repository-mutating requests use Managed Path by default; users do not need to say "Managed Path". Run `imm-route --json <request>` (or the equivalent host routing contract) before selecting a Skill.
- Keep read-only, explanation, review-only, Plan-only, and explicit no-modification requests host-native. They do not enroll or create task authority.
- Route materially ambiguous mutations to `imm-brainstorm`; route clear new mutations to `imm-planner`. Planner output is a candidate for later literal-user Enrollment and never enrolls generated artifacts unconditionally.
- Keep an active Assurance projection, TaskIntent, TaskRecord, or reviewer follow-up on its current owner and resume it through `imm-loop`.
- Fast-Track is still Managed: compressed execution does not bypass TaskIntent scope, Enrollment, QA, Review, authorization, or completion.
- `imm-route` bootstraps wholly absent Immune-Brain state idempotently for Managed phases, leaves complete state untouched, and fails closed on partial or incompatible state.
- Navigation Protocol: check `CONTEXT.md` `## Architecture Map` before broad searching; inspect `.imm` discovery state only for an existing Managed owner.
- Ask the minimum blocking question or use a bounded read-only probe when material ambiguity remains, then reapply the route matrix.
- Use `imm-loop` only to continue the matching validated Managed owner.
- Output Language Policy: set the default language for user-facing replies here. Persisted Immune-Brain documents default to English: `HANDOFF.md`, `docs/brainstorms/`, `docs/specs/`, `docs/plans/`, and `docs/solutions/`. A reply language preference does not change document language; add an explicit document-language instruction if these documents should use another language. Keep schema fields, enum values, CLI flags, JSON keys, State Ledger fields, file paths, tool names, API names, code identifiers, and `CONTEXT.md` canonical terms such as `Step`, `Plan`, and `Spec` literal.
- When Immune-Brain `[subagent_activation]` resolves to `auto` and the CLI activation plan returns bounded advisory candidates, this project authorizes readonly advisory subagents or parallel probes unless the user asks for solo work. If the current host still requires current-session authorization, ask once and record `host_authorization_required`; this project instruction does not override host tool policy.
<!-- IMMUNE-BRAIN:END -->
