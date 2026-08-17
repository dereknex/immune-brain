# Immune-Brain Skill Baseline

## Shared Guards

- Load detailed workflow text from `dist/` only on invocation.
- Ask only when missing information changes outcome or risk.
- Keep edits inside the user-requested Direct scope or the active Managed step boundary.
- Record reproducible evidence before reporting closure.
- Use shallow discovery first.
- Lead with conclusion, evidence, and Next Action.
- Advisory roles do not implement; Managed execution roles do not close QA.
- A discovered Managed trigger stops Direct mutation and routes to `imm-planner`; Managed scope changes return to `imm-planner`.

## Workflow Activation

Direct Path is the default when no Managed trigger applies. Route selection is
an ordered, negative-trigger decision; it is not a caller-selected profile and
creates no workflow state.

Apply this ordered route before selecting an Immune-Brain Skill:

1. **Continue an existing Managed owner**: an active Plan step, TaskIntent,
   TaskRecord, reviewer `follow_up`, or other nonterminal Managed owner keeps
   exclusive ownership. Never switch it to Direct.
2. **Honor explicit Managed intent**: use Managed when the user explicitly asks
   for planning, audit, security/compliance review, cross-session continuity,
   independent closure authority, or the Managed lifecycle.
3. **Route hard Managed triggers**: use Managed when the work involves any of
   these boundaries:
   - security, credentials, permissions, or access control;
   - public API, schema, compatibility, migration, or persisted-state behavior;
   - concurrency, recovery, release, deployment, or external writes;
   - destructive or irreversible effects, Git history rewrite, authority discard, or risk override;
   - multiple independently owned domains that cannot close as one coherent
     task-owned outcome; or
   - an explicit independent review requirement.
4. **Resolve only material uncertainty**: ask the minimum blocking question or
   run a bounded read-only probe. If a hard trigger or material ownership/risk
   uncertainty remains, use Managed.
5. **Otherwise use Direct**: the ordinary host agent implements and verifies the
   request without invoking an Immune-Brain lifecycle Skill.

Do not select Managed merely because the task touches multiple files, needs
multiple local verifier commands, takes ordinary implementation retries, uses
optional read-only advisors, or coexists with unrelated dirty files. Those are
cost signals, not authority or risk boundaries. Do not create or mutate workflow state while selecting the route.

### Direct Execution And Completion

On the Direct Path, the ordinary host agent makes only the requested local
change. It creates no Spec, Plan, TaskIntent, TaskRecord, State Ledger,
acceptance evidence, QA job, mandatory Review job, HANDOFF update, or
Compounder gate. Optional read-only subagents remain advisory and create no
workflow authority.

Direct work is complete only when the requested outcome exists, reproducible task-scoped verification passes, the stable task-owned diff contains no accidental or unrelated change, and there are zero task-owned unresolved failures. The whole Git worktree need not be clean; unrelated pre-existing changes remain untouched and do not invalidate focused evidence.

Ordinary task-owned failures and retries stay Direct. If discovery reveals a
hard Managed trigger, stop further mutation, preserve the current work, and
route to Managed before continuing.

Stage only explicit task-owned paths. Never use `git add .` or `git add -A` in a dirty worktree. A local task-owned commit needs no extra workflow confirmation when the user requested end-to-end delivery or project policy already authorizes it; otherwise leave the verified change ready to commit.

### Host Confirmation Boundary

Require exact host confirmation only for privileged effects:

- publish, release, deployment, or remote-system mutation;
- destructive or irreversible operations and Git history rewrite;
- credential, secret, permission, or access-control changes;
- authority discard, task stop, breaking intent revision, or risk/policy
  override; and
- external writes whose target or impact cannot be safely reversed locally.

Do not request confirmation for local in-scope edits, local verification, ordinary Direct rework, scoped diff review, or completion reporting. Managed evidence, QA, Review, and completion authority remain governed by their Managed contracts; R2 does not weaken them.

## Parallel Read-Only Dispatch

State mutations, step activations, QA decisions, and plan switches remain
strictly sequential. Read-only work — repo exploration, advisory review,
host probing, planner research — may be dispatched in parallel.

Parallel dispatch is restricted by capability, not by a closed Skill list. Every
child delegation packet must enforce read-only advisory behavior: no file edits,
Plan writes, workflow-state mutation, or QA closure. Eligible examples include
Brainstorm and Planner research children, Domain Mappers and architecture
explorers, advisory reviewers, and provider-native read-only explorers such as
Pi `Explore`. Executor, QA, Compounder, owning Planner, and test-fixer children
always run sequentially.

## Output Language Policy

- Honor the configured language for user-facing replies and short summaries.
- Persisted Immune-Brain documents default to English, including `HANDOFF.md`,
  `docs/brainstorms/`, `docs/specs/`, `docs/plans/`, and `docs/solutions/`.
- A reply-language instruction such as "use Chinese when replying" does not
  change document language. Change persisted document language only when the
  current user request, project instructions such as `AGENTS.md`, or host/user
  preference contains an explicit document-language instruction.
- Reply language precedence is: current user instruction, then project
  instructions such as `AGENTS.md`, then host or user-level preference, then
  the repo-wide default output contract. Document language precedence is:
  current explicit document-language instruction, then project explicit
  document-language instruction, then host or user-level explicit
  document-language preference, then English.
- Do not translate or rename machine contracts: schema fields, enum values,
  CLI flags, JSON keys, State Ledger fields, file paths, tool names, API names,
  and code identifiers stay literal.
- Preserve `CONTEXT.md` canonical terms such as `Step`, `Plan`, `Spec`,
  `Skill`, `Brainstorm`, `Executor`, `QA`, `Compounder`, `Learning`, `ADR`,
  and `State Ledger`; add local-language explanations around them when helpful.

## Success Criteria

- Direct work closes only under the Direct completion contract above.
- A Managed Step is ready to execute only when the target result, boundary, and
  verification path are clear enough to avoid speculative edits.
- A Managed Step is closable only when execution evidence proves the recorded
  verification path and the active boundary still matches the Plan.
- Managed scope changes, missing evidence, or structural mismatch return to
  `imm-planner` instead of being hidden inside execution or QA.

## Collaboration Posture

- When to ask: ask only when missing information would change the outcome,
  authority boundary, or risk profile.
- When to proceed: proceed on explicit, low-risk assumptions when the next
  evidence path can validate or reject them.
- Keep uncertainty visible in evidence, notes, or Next Action instead of
  silently widening scope.

## Hub skill anatomy

Hub Skills `imm-work`, `imm-executor`, `imm-planner`, and `imm-qa` carry the
repo's main workflow authority. They must keep explicit `Rationalizations`,
`Red Flags`, and Verification guidance grounded in Immune-Brain commands and
`.imm` state, not generic upstream-only examples.

## Shallow Discovery

Prefer shallow discovery before full-file reads. Start with file lists,
`rg` hits, symbol/signature scans, and targeted line ranges; read whole files
only when the narrower evidence path cannot answer the active Step question.
