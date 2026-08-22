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

Ordinary host input stays host-native and does not run natural-language Managed
routing. A new Managed workflow starts only from explicit `imm-brainstorm`,
`imm-planner`, or `imm-loop` Skill entry.

1. **Continue an existing Managed owner**: an active Assurance projection,
   TaskIntent, TaskRecord, reviewer `follow_up`, or other nonterminal Managed
   owner keeps exclusive ownership and resumes through `imm-loop`.
2. **Start explicitly**: the selected Immune-Brain Skill owns bootstrap and
   planning. Absent state is initialized idempotently; complete state is left
   byte-for-byte untouched; partial or incompatible state fails closed.
3. **Preserve authority**: Planner output is a candidate for later literal-user
   Enrollment, and Fast-Track preserves TaskIntent scope, Enrollment, QA,
   Review, authorization, and completion boundaries.

Do not inspect or mutate Immune-Brain state merely because ordinary host input
contains a mutation verb. File count, local verifier count, ordinary retries,
read-only advisors, and unrelated dirty files do not change these boundaries.

### Non-Mutating Host Path

Read-only and explicit no-modification requests stay with the ordinary host
agent. This path creates no Spec, Plan, TaskIntent, TaskRecord, State Ledger,
acceptance evidence, QA job, mandatory Review job, HANDOFF update, or
Compounder state. It may explain, inspect, or review without Enrollment.

### Managed Execution And Completion

The matching Managed owner drives execution, evidence, QA, Review, and
completion without switching to a non-authoritative path. Scope expansion
returns to `imm-planner`; an enrolled task resumes through `imm-loop` from the
current Assurance projection. Do not create or mutate workflow state while
classifying a non-mutating request.

Stage only explicit task-owned paths. Never use `git add .` or `git add -A` in a dirty worktree.

### Host Confirmation Boundary

Require exact host confirmation only for privileged effects:

- publish, release, deployment, or remote-system mutation;
- destructive or irreversible operations and Git history rewrite;
- credential, secret, permission, or access-control changes;
- authority discard, task stop, breaking intent revision, or risk/policy
  override; and
- external writes whose target or impact cannot be safely reversed locally.

Routine Managed enrollment uses one host confirmation bound to the TaskIntent content hash at the Planner's final `ctx.ui.custom` gate. Descriptor rehearsal is reordered after that confirmation; a post-confirmation rehearsal failure invalidates the authorization with zero authority writes, and the routine task then proceeds from that single confirmation through enrollment, execution and QA without a second human stop. Do not request confirmation for local in-scope edits, local verification, ordinary Direct rework, scoped diff review, or completion reporting. Managed evidence, QA, Review, and completion authority remain governed by their Managed contracts; R2 does not weaken them.

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
  CLI flags, JSON keys, file paths, tool names, API names,
  and code identifiers stay literal.
- Preserve `CONTEXT.md` canonical terms such as `Step`, `Plan`, `Spec`,
  `Skill`, `Brainstorm`, `Executor`, `QA`, `Compounder`, `Learning`, and `ADR`;
  add local-language explanations around them when helpful.

## Success Criteria

- Direct work closes only under the Direct completion contract above.
- A Managed Step is ready to execute only when the target result, boundary, and
  verification path are clear enough to avoid speculative edits.
- A Managed Step is closable only when execution evidence proves the recorded
  verification path and the active boundary still matches the Plan.
- Managed scope changes, missing evidence, or structural mismatch return to
  `imm-planner` instead of being hidden inside execution or QA.

## Retirement Completion

For retirement-class work, deletion of source and contract text is a completion condition. A retirement is not complete until the source and its contract text are deleted.

An absence test is transitional scaffolding proving an in-progress deletion rather than a substitute for one. An absence test is transitional evidence of an in-progress deletion and may not stand in place of one. Distinguish an absence assertion that guards something already gone, which is durable and correct, from one that stands in for a deletion still owed, which is a promise recorded as if it were a result.

## Collaboration Posture

- When to ask: ask only when missing information would change the outcome,
  authority boundary, or risk profile.
- When to proceed: proceed on explicit, low-risk assumptions when the next
  evidence path can validate or reject them.
- Keep uncertainty visible in evidence, notes, or Next Action instead of
  silently widening scope.

## Hub skill anatomy

The public Skills `imm-brainstorm`, `imm-planner`, and `imm-loop` carry the
repo's user-facing workflow authority. Execution, QA, review, repair,
exploration, and learning are internal runtime roles dispatched by Loop through
packaged role prompts; they are not additional public Skills. Keep explicit
`Rationalizations`, `Red Flags`, and Verification guidance grounded in
Immune-Brain commands and `.imm` state.

## Shallow Discovery

Prefer shallow discovery before full-file reads. Start with file lists,
`rg` hits, symbol/signature scans, and targeted line ranges; read whole files
only when the narrower evidence path cannot answer the active Step question.
